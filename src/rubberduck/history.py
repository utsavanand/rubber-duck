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

from rubberduck import paths
from rubberduck.metrics import classify
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
    state               TEXT NOT NULL DEFAULT 'busy',
    source_app          TEXT,
    cwd                 TEXT,
    last_event_type     TEXT,
    last_tool           TEXT,
    event_count         INTEGER NOT NULL DEFAULT 0,
    started_at          INTEGER NOT NULL,
    updated_at          INTEGER NOT NULL,
    ended_at            INTEGER
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
    session_key TEXT NOT NULL,
    commit_sha  TEXT NOT NULL,
    label       TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (session_key, commit_sha)
);
"""


def session_key_of(event: Event) -> str | None:
    key = event.get("session_key") or event.get("uvs_session_id") or event.get("session_id")
    return str(key) if key else None


def derive_state(event: Event, prev: SessionState | None) -> SessionState:
    if event.get("lifecycle") == "terminated" or event.get("event_type") == "SessionEnd":
        return "terminated"
    match event.get("event_type"):
        case "PermissionRequest" | "Notification":
            return "waiting"
        case "PreToolUse" | "UserPromptSubmit" | "SessionStart":
            return "busy"
        case "Stop" | "PostToolUse":
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
    "source_app": "TEXT",
    "cwd": "TEXT",
    "last_event_type": "TEXT",
    "last_tool": "TEXT",
    "ended_at": "INTEGER",
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
        """Add any columns missing from an older sessions table."""
        existing = {
            row["name"] for row in self._conn.execute("PRAGMA table_info(sessions)").fetchall()
        }
        for column, sql_type in _SESSIONS_COLUMNS.items():
            if column not in existing:
                self._conn.execute(f"ALTER TABLE sessions ADD COLUMN {column} {sql_type}")

    def record(self, event: Event) -> None:
        """Persist an event and fold it into its session row. Called for every
        published event (the EventBus sink)."""
        self._conn.execute(
            "INSERT OR IGNORE INTO events (id, session_key, event_type, ts, payload_json) "
            "VALUES (?, ?, ?, ?, json(?))",
            (
                event["_id"],
                session_key_of(event),
                event.get("event_type"),
                event["_ts"],
                json.dumps(event),
            ),
        )
        key = session_key_of(event)
        if key is not None:
            self._upsert_session(key, event)
            kind = classify(event)
            if kind is not None:
                self._bump_metric(key, kind)
        self._conn.commit()

    def _bump_metric(self, key: str, kind: str) -> None:
        self._conn.execute(
            "INSERT INTO metrics (session_key, kind, count) VALUES (?, ?, 1) "
            "ON CONFLICT(session_key, kind) DO UPDATE SET count = count + 1",
            (key, kind),
        )

    def metrics(self, key: str) -> dict[str, int]:
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

    def add_checkpoint(self, key: str, commit: str, label: str, created_at: int) -> None:
        self._conn.execute(
            "INSERT OR REPLACE INTO checkpoints (session_key, commit_sha, label, created_at) "
            "VALUES (?, ?, ?, ?)",
            (key, commit, label, created_at),
        )
        self._conn.commit()

    def checkpoints(self, key: str) -> list[dict[str, Any]]:
        rows = self._conn.execute(
            "SELECT commit_sha, label, created_at FROM checkpoints "
            "WHERE session_key = ? ORDER BY created_at DESC",
            (key,),
        ).fetchall()
        return [dict(r) for r in rows]

    def set_intention(self, key: str, intention: str) -> None:
        self._conn.execute(
            "UPDATE sessions SET intention = ? WHERE session_key = ?", (intention, key)
        )
        self._conn.commit()

    def set_outcome(self, key: str, outcome: str) -> None:
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
                " last_event_type, last_tool, event_count, started_at, updated_at, ended_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)",
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
                "source_app = COALESCE(?, source_app), "
                "cwd = COALESCE(?, cwd), "
                "last_event_type = ?, "
                "last_tool = COALESCE(?, last_tool), "
                "event_count = event_count + 1, "
                "updated_at = ?, "
                "ended_at = ? "
                "WHERE session_key = ?",
                (
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
                    ended_at,
                    key,
                ),
            )

    def sessions(self) -> list[dict[str, Any]]:
        rows = self._conn.execute("SELECT * FROM sessions ORDER BY updated_at DESC").fetchall()
        out = []
        for r in rows:
            row = dict(r)
            row["metrics"] = self.metrics(row["session_key"])
            out.append(row)
        return out

    def session(self, key: str) -> dict[str, Any] | None:
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

    def close(self) -> None:
        self._conn.close()
