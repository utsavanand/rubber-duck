"""Durable mirror of the event stream in SQLite at ~/.rubberduck/db.sqlite.

The in-memory EventBus ring is the live tier; this is what survives a restart.
Every published event is inserted here and folded into its session row so that
GET /sessions can list past sessions (including terminated ones) without
replaying the whole event log.

Schema is created idempotently on open. Columns that later Acts fill
(worktree_path, branch, parent_session_key, intention, outcome_summary) exist
now but stay NULL until Acts 4/5/7 populate them.
"""

import json
import sqlite3
from pathlib import Path
from typing import Any

from rubberduck.helpers import paths
from rubberduck.helpers.metrics import classify
from rubberduck.runtimes.base import SessionState

Event = dict[str, Any]

_SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    session_key         TEXT PRIMARY KEY,
    runtime             TEXT,
    repo_path           TEXT,
    worktree_path       TEXT,
    branch              TEXT,
    parent_session_key  TEXT REFERENCES sessions(session_key),
    compare_group       TEXT,
    intention           TEXT,
    outcome_summary     TEXT,
    name                TEXT,
    notes               TEXT,
    state               TEXT NOT NULL DEFAULT 'busy',
    source_app          TEXT,
    cwd                 TEXT,
    last_event_type     TEXT,
    last_tool           TEXT,
    event_count         INTEGER NOT NULL DEFAULT 0,
    started_at          INTEGER NOT NULL,
    updated_at          INTEGER NOT NULL,
    ended_at            INTEGER,
    heartbeat           INTEGER NOT NULL DEFAULT 0,
    last_seen           INTEGER,
    tty                 TEXT
);
CREATE TABLE IF NOT EXISTS events (
    id           TEXT PRIMARY KEY,
    session_key  TEXT,
    event_type   TEXT,
    ts           INTEGER NOT NULL,
    payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_key, ts);
CREATE TABLE IF NOT EXISTS metrics (
    session_key TEXT NOT NULL,
    kind        TEXT NOT NULL,
    count       INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (session_key, kind)
);
CREATE TABLE IF NOT EXISTS checkpoints (
    id          TEXT PRIMARY KEY,
    session_key TEXT NOT NULL,
    label       TEXT NOT NULL,
    summary     TEXT NOT NULL DEFAULT '',
    record_json TEXT NOT NULL DEFAULT '{}',
    markdown_path TEXT,
    created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tombstones (
    session_key TEXT PRIMARY KEY,
    deleted_at  INTEGER NOT NULL
);
"""


def session_key_of(event: Event) -> str | None:
    key = event.get("session_key") or event.get("uvs_session_id") or event.get("session_id")
    return str(key) if key else None


def derive_state(event: Event, prev: SessionState | None) -> SessionState:
    # An explicit lifecycle marker (a deliberate stop/archive/sweep) always wins.
    lifecycle = event.get("lifecycle")
    if lifecycle == "archived":
        return "archived"
    if lifecycle == "stopped":
        return "stopped"
    # A stopped or archived session is at rest: only an explicit resume
    # (SessionStart) revives it. A stray late event — including the resumed-then-
    # exited agent's SessionEnd — must NOT flip it (e.g. archived -> terminated).
    # This guard runs before the SessionEnd/terminated rule on purpose.
    if prev in ("stopped", "archived") and event.get("event_type") != "SessionStart":
        return prev
    if lifecycle == "terminated" or event.get("event_type") == "SessionEnd":
        return "terminated"
    match event.get("event_type"):
        case "PermissionRequest" | "Notification":
            return "waiting"
        case "PreToolUse" | "PostToolUse" | "UserPromptSubmit" | "SessionStart":
            # PostToolUse means a tool just finished — the agent is still mid-turn.
            # Only `Stop` (turn ended) is idle. Treating PostToolUse as idle made
            # sessions flap busy<->idle on every tool call.
            return "busy"
        case "Stop":
            return "idle"
        case _:
            return prev or "busy"


# Columns added to `sessions` after the first release. CREATE TABLE IF NOT
# EXISTS won't add these to a pre-existing DB, so we ALTER them in on open.
_SESSIONS_COLUMNS = {
    "runtime": "TEXT",
    "repo_path": "TEXT",
    "worktree_path": "TEXT",
    "branch": "TEXT",
    "parent_session_key": "TEXT",
    "compare_group": "TEXT",
    "intention": "TEXT",
    "outcome_summary": "TEXT",
    "name": "TEXT",
    "notes": "TEXT",
    "source_app": "TEXT",
    "cwd": "TEXT",
    "last_event_type": "TEXT",
    "last_tool": "TEXT",
    "ended_at": "INTEGER",
    "heartbeat": "INTEGER NOT NULL DEFAULT 0",
    # 1 when Rubberduck launched the session itself (vs a watched/hook session).
    # Set once at creation from the SessionStart event; never cleared, so the
    # watched/launched badge is stable regardless of later events or sweeps.
    "launched": "INTEGER NOT NULL DEFAULT 0",
    # 1 when the session was created for testing/seeding (SessionStart carried
    # test:true). Lets `purge-test` delete all test data deterministically
    # instead of guessing by key prefix, so tests never pollute real history.
    "test": "INTEGER NOT NULL DEFAULT 0",
    "last_seen": "INTEGER",
    "tty": "TEXT",
    # The agent process's pid (the hook's $PPID). For a watched session — which
    # has no heartbeat — this is how the liveness sweep tells a still-running
    # agent from one whose terminal was closed.
    "agent_pid": "INTEGER",
}


class HistoryStore:
    def __init__(self, db_path: Path | None = None) -> None:
        path = db_path if db_path is not None else paths.db_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.executescript(_SCHEMA)
        self._migrate()
        self._conn.commit()

    def _migrate(self) -> None:
        """Add any columns missing from an older sessions table; rebuild the
        checkpoints table if it predates the 'session record' shape."""
        existing = {
            row["name"] for row in self._conn.execute("PRAGMA table_info(sessions)").fetchall()
        }
        for column, sql_type in _SESSIONS_COLUMNS.items():
            if column not in existing:
                self._conn.execute(f"ALTER TABLE sessions ADD COLUMN {column} {sql_type}")

        cp_cols = {
            row["name"] for row in self._conn.execute("PRAGMA table_info(checkpoints)").fetchall()
        }
        # Old checkpoints stored a git-stash sha; the new record table is keyed by
        # `id`. The old rows were disposable rollback points, so drop and recreate.
        if cp_cols and "record_json" not in cp_cols:
            self._conn.execute("DROP TABLE checkpoints")
            self._conn.executescript(_SCHEMA)

    def record(self, event: Event) -> None:
        """Persist an event and fold it into its session row. Called for every
        published event (the EventBus sink)."""
        key = session_key_of(event)
        # A deleted session whose terminal is still alive keeps firing events.
        # Don't let those resurrect the row. SessionEnd lifts the tombstone — the
        # terminal is gone, so a future session reusing the key starts clean.
        if key is not None and self._is_tombstoned(key):
            if event.get("event_type") == "SessionEnd":
                self._lift_tombstone(key)
            return
        self._conn.execute(
            "INSERT OR IGNORE INTO events (id, session_key, event_type, ts, payload_json) "
            "VALUES (?, ?, ?, ?, json(?))",
            (
                event["_id"],
                key,
                event.get("event_type"),
                event["_ts"],
                json.dumps(event),
            ),
        )
        if key is not None:
            self._upsert_session(key, event)
            kind = classify(event)
            if kind is not None:
                self._bump_metric(key, kind)
        self._conn.commit()

    def is_tombstoned(self, key: str) -> bool:
        """Whether a session was deleted and not yet revived by a SessionStart."""
        row = self._conn.execute(
            "SELECT 1 FROM tombstones WHERE session_key = ?", (key,)
        ).fetchone()
        return row is not None

    _is_tombstoned = is_tombstoned  # internal alias (kept for existing callers)

    def _lift_tombstone(self, key: str) -> None:
        self._conn.execute("DELETE FROM tombstones WHERE session_key = ?", (key,))
        self._conn.commit()

    def _bump_metric(self, key: str, kind: str) -> None:
        self._conn.execute(
            "INSERT INTO metrics (session_key, kind, count) VALUES (?, ?, 1) "
            "ON CONFLICT(session_key, kind) DO UPDATE SET count = count + 1",
            (key, kind),
        )

    def metrics(self, key: str) -> dict[str, int]:
        """Per-kind counts (e.g. build/test) recorded for a session."""
        rows = self._conn.execute(
            "SELECT kind, count FROM metrics WHERE session_key = ?", (key,)
        ).fetchall()
        return {r["kind"]: r["count"] for r in rows}

    def session_id_for(self, key: str) -> str | None:
        """The agent runtime's own session id (for transcript correlation), read
        from the most recent event that carried one."""
        row = self._conn.execute(
            "SELECT json_extract(payload_json, '$.session_id') AS sid "
            "FROM events WHERE session_key = ? AND sid IS NOT NULL "
            "ORDER BY ts DESC LIMIT 1",
            (key,),
        ).fetchone()
        return str(row["sid"]) if row and row["sid"] else None

    def add_checkpoint(
        self,
        *,
        checkpoint_id: str,
        session_key: str,
        label: str,
        summary: str,
        record: dict[str, Any],
        markdown_path: str | None,
        created_at: int,
    ) -> None:
        """Persist a checkpoint record (summary + raw record JSON) for a session."""
        self._conn.execute(
            "INSERT INTO checkpoints "
            "(id, session_key, label, summary, record_json, markdown_path, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                checkpoint_id,
                session_key,
                label,
                summary,
                json.dumps(record),
                markdown_path,
                created_at,
            ),
        )
        self._conn.commit()

    def checkpoints(self, key: str) -> list[dict[str, Any]]:
        """A session's checkpoint records, newest first."""
        rows = self._conn.execute(
            "SELECT id, label, summary, record_json, markdown_path, created_at "
            "FROM checkpoints WHERE session_key = ? ORDER BY created_at DESC",
            (key,),
        ).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["record"] = json.loads(d.pop("record_json"))
            out.append(d)
        return out

    def events_for(self, key: str, limit: int = 200) -> list[dict[str, Any]]:
        """The most recent events for a session, oldest-first, for building a
        checkpoint record."""
        rows = self._conn.execute(
            "SELECT payload_json FROM events WHERE session_key = ? ORDER BY ts DESC LIMIT ?",
            (key, limit),
        ).fetchall()
        events = [json.loads(r["payload_json"]) for r in rows]
        events.reverse()
        return events

    def set_intention(self, key: str, intention: str) -> None:
        """Record what a session set out to do (its launch prompt)."""
        self._conn.execute(
            "UPDATE sessions SET intention = ? WHERE session_key = ?", (intention, key)
        )
        self._conn.commit()

    def set_meta(self, key: str, *, name: str | None = None, notes: str | None = None) -> bool:
        """Set a user-given name and/or personal notes on a session (local only,
        never sent anywhere). Returns whether the session exists."""
        if name is not None:
            self._conn.execute("UPDATE sessions SET name = ? WHERE session_key = ?", (name, key))
        if notes is not None:
            self._conn.execute("UPDATE sessions SET notes = ? WHERE session_key = ?", (notes, key))
        self._conn.commit()
        return self.session(key) is not None

    def mark_heartbeat(self, key: str) -> None:
        """Flag a session as heartbeat-tracked (Rubberduck launched it in a tab
        that pings us). Only these are eligible for the killed-tab sweep."""
        self._conn.execute("UPDATE sessions SET heartbeat = 1 WHERE session_key = ?", (key,))
        self._conn.commit()

    def set_state(self, key: str, state: str, *, now: int | None = None) -> bool:
        """Set a session's state directly — for an explicit user action (Stop sets
        'stopped', Resume sets 'busy', Archive sets 'archived'). Distinct from
        event-derived state. Returns whether the session exists.

        Stamps ended_at when a session ends; keeps the existing ended_at when
        archiving an already-ended session; clears it when reviving (busy)."""
        if state in ("stopped", "terminated"):
            cur = self._conn.execute(
                "UPDATE sessions SET state = ?, ended_at = ? WHERE session_key = ?",
                (state, now, key),
            )
        elif state == "busy":
            cur = self._conn.execute(
                "UPDATE sessions SET state = ?, ended_at = NULL WHERE session_key = ?",
                (state, key),
            )
        else:  # archived (and any other) — keep ended_at as-is
            cur = self._conn.execute(
                "UPDATE sessions SET state = ? WHERE session_key = ?", (state, key)
            )
        self._conn.commit()
        return cur.rowcount > 0

    def touch(self, key: str, ts: int, *, tty: str | None = None) -> bool:
        """Record a liveness ping (and the tab's tty, so delete can close it).
        Returns whether the session exists."""
        cur = self._conn.execute(
            "UPDATE sessions SET last_seen = ?, tty = COALESCE(?, tty) WHERE session_key = ?",
            (ts, tty, key),
        )
        self._conn.commit()
        return cur.rowcount > 0

    # States we never sweep — the session is already at rest or put away.
    _AT_REST = ("terminated", "stopped", "archived")

    def sweep_dead(self, now: int, *, stale_after_ms: int) -> list[str]:
        """Heartbeat-tracked (launched) sessions whose tab stopped pinging — the
        tab is gone but the user didn't delete it. Returns their keys (the caller
        publishes a lifecycle event to archive them; kept and resumable, not
        wiped). Never includes watched sessions (no heartbeat); those go through
        the PID sweep."""
        cutoff = now - stale_after_ms
        placeholders = ", ".join("?" for _ in self._AT_REST)
        rows = self._conn.execute(
            f"SELECT session_key FROM sessions WHERE heartbeat = 1 "
            f"AND state NOT IN ({placeholders}) "
            f"AND COALESCE(last_seen, started_at) < ?",
            (*self._AT_REST, cutoff),
        ).fetchall()
        return [r["session_key"] for r in rows]

    def live_watched(self) -> list[dict[str, Any]]:
        """Watched (non-launched) sessions that are still considered running, with
        their recorded agent pid — so the server can check whether the agent
        process is actually alive and archive it if its terminal is gone."""
        placeholders = ", ".join("?" for _ in self._AT_REST)
        rows = self._conn.execute(
            f"SELECT session_key, agent_pid FROM sessions WHERE launched = 0 "
            f"AND state NOT IN ({placeholders}) AND agent_pid IS NOT NULL",
            self._AT_REST,
        ).fetchall()
        return [{"session_key": r["session_key"], "agent_pid": r["agent_pid"]} for r in rows]

    def set_outcome(self, key: str, outcome: str) -> None:
        """Record a session's outcome summary (written when it ends)."""
        self._conn.execute(
            "UPDATE sessions SET outcome_summary = ? WHERE session_key = ?", (outcome, key)
        )
        self._conn.commit()

    def events_summary(self, key: str) -> str:
        """A one-line factual digest of a session's activity, for summaries."""
        row = self._conn.execute(
            "SELECT event_count FROM sessions WHERE session_key = ?", (key,)
        ).fetchone()
        if row is None:
            return "no activity recorded"
        tools = self._conn.execute(
            "SELECT json_extract(payload_json, '$.tool_name') AS tool "
            "FROM events WHERE session_key = ? AND tool IS NOT NULL",
            (key,),
        ).fetchall()
        tool_names = [t["tool"] for t in tools]
        m = self.metrics(key)
        parts = [f"{row['event_count']} events"]
        if tool_names:
            parts.append(f"tools used: {', '.join(sorted(set(tool_names)))}")
        if m:
            parts.append(", ".join(f"{v} {k}s" for k, v in m.items()))
        return "; ".join(parts) + "."

    def _upsert_session(self, key: str, event: Event) -> None:
        row = self._conn.execute(
            "SELECT state, started_at FROM sessions WHERE session_key = ?", (key,)
        ).fetchone()
        prev_state: SessionState | None = row["state"] if row else None
        state = derive_state(event, prev_state)
        ts = int(event["_ts"])
        ended_at = ts if state == "terminated" else None

        if row is None:
            self._conn.execute(
                "INSERT INTO sessions "
                "(session_key, runtime, repo_path, worktree_path, branch, "
                " parent_session_key, compare_group, state, source_app, cwd, "
                " last_event_type, last_tool, event_count, started_at, updated_at, ended_at, "
                " last_seen, launched, test, agent_pid) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)",
                (
                    key,
                    event.get("runtime"),
                    event.get("repo_path"),
                    event.get("worktree_path"),
                    event.get("branch"),
                    event.get("parent_session_key"),
                    event.get("compare_group"),
                    state,
                    event.get("source_app"),
                    event.get("cwd"),
                    event.get("event_type"),
                    event.get("tool_name"),
                    ts,
                    ts,
                    ended_at,
                    ts,
                    1 if event.get("launched") else 0,
                    1 if event.get("test") else 0,
                    event.get("agent_pid"),
                ),
            )
        else:
            self._conn.execute(
                "UPDATE sessions SET "
                "runtime = COALESCE(?, runtime), "
                "repo_path = COALESCE(?, repo_path), "
                "worktree_path = COALESCE(?, worktree_path), "
                "branch = COALESCE(?, branch), "
                "parent_session_key = COALESCE(?, parent_session_key), "
                "compare_group = COALESCE(?, compare_group), "
                "state = ?, "
                # source_app is identity: set once on the first event, never
                # overwritten — later events (hooks) only carry a cwd-basename guess.
                "cwd = COALESCE(?, cwd), "
                "last_event_type = ?, "
                "last_tool = COALESCE(?, last_tool), "
                "event_count = event_count + 1, "
                "updated_at = ?, "
                "ended_at = ?, "
                "last_seen = ?, "
                # Sticky: only ever flips 0 -> 1, so a later hook event can't
                # downgrade a launched session to watched.
                "launched = MAX(launched, ?), "
                "test = MAX(test, ?), "
                "agent_pid = COALESCE(?, agent_pid) "
                "WHERE session_key = ?",
                (
                    event.get("runtime"),
                    event.get("repo_path"),
                    event.get("worktree_path"),
                    event.get("branch"),
                    event.get("parent_session_key"),
                    event.get("compare_group"),
                    state,
                    event.get("cwd"),
                    event.get("event_type"),
                    event.get("tool_name"),
                    ts,
                    ended_at,
                    ts,
                    1 if event.get("launched") else 0,
                    1 if event.get("test") else 0,
                    event.get("agent_pid"),
                    key,
                ),
            )

    def sessions(self) -> list[dict[str, Any]]:
        """All session rows, newest-updated first, each with its metrics."""
        rows = self._conn.execute("SELECT * FROM sessions ORDER BY updated_at DESC").fetchall()
        out = []
        for r in rows:
            row = dict(r)
            row["metrics"] = self.metrics(row["session_key"])
            out.append(row)
        return out

    def session(self, key: str) -> dict[str, Any] | None:
        """One session row by key, or None if there's no such session."""
        row = self._conn.execute("SELECT * FROM sessions WHERE session_key = ?", (key,)).fetchone()
        return dict(row) if row else None

    def fork_tree(self) -> list[dict[str, Any]]:
        """All sessions with their parent_session_key, for the dashboard to
        assemble into a tree. (Lineage is written starting in Act 5.)"""
        rows = self._conn.execute(
            "SELECT session_key, parent_session_key, state, started_at "
            "FROM sessions ORDER BY started_at"
        ).fetchall()
        return [dict(r) for r in rows]

    def delete_session(self, key: str, *, now: int = 0) -> bool:
        """Remove a session and everything attached to it (events, metrics,
        checkpoints). Tombstones the key so a still-running terminal's events
        can't resurrect the row. Returns whether a row was removed."""
        cur = self._conn.execute("DELETE FROM sessions WHERE session_key = ?", (key,))
        self._conn.execute("DELETE FROM events WHERE session_key = ?", (key,))
        self._conn.execute("DELETE FROM metrics WHERE session_key = ?", (key,))
        self._conn.execute("DELETE FROM checkpoints WHERE session_key = ?", (key,))
        self._conn.execute(
            "INSERT OR REPLACE INTO tombstones (session_key, deleted_at) VALUES (?, ?)",
            (key, now),
        )
        self._conn.commit()
        return cur.rowcount > 0

    def purge_test_sessions(self) -> list[str]:
        """Hard-delete every session flagged test=1 and ALL its data (events,
        metrics, checkpoints, and its tombstone) so a test run leaves zero trace.
        Returns the keys purged."""
        keys = [
            r["session_key"]
            for r in self._conn.execute("SELECT session_key FROM sessions WHERE test = 1")
        ]
        for key in keys:
            self._conn.execute("DELETE FROM sessions WHERE session_key = ?", (key,))
            self._conn.execute("DELETE FROM events WHERE session_key = ?", (key,))
            self._conn.execute("DELETE FROM metrics WHERE session_key = ?", (key,))
            self._conn.execute("DELETE FROM checkpoints WHERE session_key = ?", (key,))
            self._conn.execute("DELETE FROM tombstones WHERE session_key = ?", (key,))
        self._conn.commit()
        return keys

    def clear_terminated(self) -> list[str]:
        """Delete all terminated sessions. Returns the keys removed."""
        rows = self._conn.execute(
            "SELECT session_key FROM sessions WHERE state = 'terminated'"
        ).fetchall()
        keys = [r["session_key"] for r in rows]
        for key in keys:
            self.delete_session(key)
        return keys

    def close(self) -> None:
        """Close the underlying SQLite connection."""
        self._conn.close()
