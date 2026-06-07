from pathlib import Path

from rubberduck.eventbus import EventBus
from rubberduck.history import HistoryStore, derive_state, session_key_of


def make_bus(store: HistoryStore) -> EventBus:
    return EventBus(sink=store.record)


def test_session_key_falls_back_through_aliases() -> None:
    assert session_key_of({"session_key": "a", "session_id": "b"}) == "a"
    assert session_key_of({"uvs_session_id": "u", "session_id": "b"}) == "u"
    assert session_key_of({"session_id": "b"}) == "b"
    assert session_key_of({}) is None


def test_derive_state_transitions() -> None:
    assert derive_state({"event_type": "SessionStart"}, None) == "busy"
    assert derive_state({"event_type": "PreToolUse"}, "idle") == "busy"
    # A tool finishing keeps the agent busy (mid-turn); only Stop is idle.
    assert derive_state({"event_type": "PostToolUse"}, "busy") == "busy"
    assert derive_state({"event_type": "Stop"}, "busy") == "idle"
    assert derive_state({"event_type": "PermissionRequest"}, "busy") == "waiting"
    assert derive_state({"event_type": "SessionEnd"}, "busy") == "terminated"
    assert derive_state({"lifecycle": "terminated"}, "busy") == "terminated"
    # Unknown event keeps the previous state.
    assert derive_state({"event_type": "Mystery"}, "waiting") == "waiting"


def test_session_row_accumulates_across_events(tmp_path: Path) -> None:
    store = HistoryStore(tmp_path / "db.sqlite")
    bus = make_bus(store)
    bus.publish({"event_type": "SessionStart", "session_key": "s1", "cwd": "/repo"})
    bus.publish({"event_type": "PreToolUse", "session_key": "s1", "tool_name": "Edit"})
    bus.publish({"event_type": "PostToolUse", "session_key": "s1", "tool_name": "Edit"})
    bus.publish({"event_type": "Stop", "session_key": "s1"})

    row = store.session("s1")
    assert row is not None
    assert row["event_count"] == 4
    assert row["state"] == "idle"
    assert row["last_tool"] == "Edit"
    assert row["cwd"] == "/repo"
    assert row["ended_at"] is None


def test_old_db_missing_columns_is_migrated(tmp_path: Path) -> None:
    import sqlite3

    db = tmp_path / "db.sqlite"
    # Simulate a v1 DB: a sessions table without the later columns.
    conn = sqlite3.connect(str(db))
    conn.execute(
        "CREATE TABLE sessions (session_key TEXT PRIMARY KEY, state TEXT, "
        "event_count INTEGER, started_at INTEGER, updated_at INTEGER)"
    )
    conn.commit()
    conn.close()

    # Opening through HistoryStore must add the missing columns, not crash.
    store = HistoryStore(db)
    bus = make_bus(store)
    bus.publish({"event_type": "SessionStart", "session_key": "s", "compare_group": "grp"})

    row = store.session("s")
    assert row is not None
    assert row["compare_group"] == "grp"


def test_runtime_is_persisted_from_event(tmp_path: Path) -> None:
    store = HistoryStore(tmp_path / "db.sqlite")
    bus = make_bus(store)
    bus.publish({"event_type": "SessionStart", "session_key": "s1", "runtime": "generic"})
    row = store.session("s1")
    assert row is not None
    assert row["runtime"] == "generic"


def test_terminated_session_records_ended_at(tmp_path: Path) -> None:
    store = HistoryStore(tmp_path / "db.sqlite")
    bus = make_bus(store)
    bus.publish({"event_type": "SessionStart", "session_key": "s1"})
    bus.publish({"event_type": "SessionEnd", "session_key": "s1"})

    row = store.session("s1")
    assert row is not None
    assert row["state"] == "terminated"
    assert row["ended_at"] is not None
    assert row["ended_at"] >= row["started_at"]


def test_history_survives_reopen(tmp_path: Path) -> None:
    db = tmp_path / "db.sqlite"
    bus = make_bus(HistoryStore(db))
    bus.publish({"event_type": "SessionStart", "session_key": "persisted"})

    reopened = HistoryStore(db)
    keys = [s["session_key"] for s in reopened.sessions()]
    assert keys == ["persisted"]


def test_events_without_session_key_are_stored_but_make_no_session(tmp_path: Path) -> None:
    store = HistoryStore(tmp_path / "db.sqlite")
    bus = make_bus(store)
    bus.publish({"event_type": "Notification"})  # no session key
    assert store.sessions() == []


def test_fork_tree_returns_parent_links(tmp_path: Path) -> None:
    store = HistoryStore(tmp_path / "db.sqlite")
    bus = make_bus(store)
    bus.publish({"event_type": "SessionStart", "session_key": "root"})
    # Lineage is written by Act 5; here we set it directly to prove the query.
    store._conn.execute(
        "INSERT INTO sessions "
        "(session_key, parent_session_key, started_at, updated_at) "
        "VALUES ('child', 'root', 1, 1)"
    )
    store._conn.commit()

    tree = {row["session_key"]: row["parent_session_key"] for row in store.fork_tree()}
    assert tree == {"root": None, "child": "root"}


def test_sweep_dead_terminates_only_stale_heartbeat_sessions(tmp_path: Path) -> None:
    store = HistoryStore(tmp_path / "db.sqlite")
    bus = make_bus(store)
    now = 1_000_000

    # A heartbeat-tracked tab that last pinged 90s ago — killed, should be swept.
    bus.publish({"event_type": "SessionStart", "session_key": "killed", "_ts": now - 200_000})
    store.mark_heartbeat("killed")
    store.touch("killed", now - 90_000)

    # A heartbeat-tracked tab pinging 5s ago — alive, must survive.
    bus.publish({"event_type": "SessionStart", "session_key": "alive", "_ts": now - 200_000})
    store.mark_heartbeat("alive")
    store.touch("alive", now - 5_000)

    # A watched (hook-only) session, quiet for 10 minutes — NOT heartbeat-tracked,
    # must never be swept (that was the original idle-kill mistake).
    bus.publish({"event_type": "SessionStart", "session_key": "watched", "_ts": now - 600_000})

    swept = store.sweep_dead(now, stale_after_ms=60_000)

    assert swept == ["killed"]
    assert store.session("killed")["state"] == "terminated"
    assert store.session("alive")["state"] != "terminated"
    assert store.session("watched")["state"] != "terminated"
