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


class HistoryStore:
    def __init__(self, db_path: Path | None = None) -> None:
        path = db_path if db_path is not None else paths.db_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.executescript(_SCHEMA)
        self._conn.commit()

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
        self._conn.commit()

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
                "(session_key, runtime, state, source_app, cwd, last_event_type, last_tool, "
                " event_count, started_at, updated_at, ended_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)",
                (
                    key,
                    event.get("runtime"),
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
        return [dict(r) for r in rows]

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
