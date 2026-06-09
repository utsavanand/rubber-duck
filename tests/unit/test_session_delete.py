from pathlib import Path

from rubberduck.eventbus import EventBus
from rubberduck.history import HistoryStore
from rubberduck.server import Server
from rubberduck.worktrees import GitError


def seed(store: HistoryStore) -> EventBus:
    return EventBus(sink=store.record)


def test_delete_removes_session_and_its_events(tmp_path: Path) -> None:
    store = HistoryStore(tmp_path / "db.sqlite")
    bus = seed(store)
    bus.publish({"event_type": "SessionStart", "session_key": "s1"})
    bus.publish({"event_type": "PreToolUse", "session_key": "s1", "tool_name": "Edit"})

    assert store.delete_session("s1") is True
    assert store.session("s1") is None
    # Events for that session are gone too.
    assert store.events_for("s1") == []


def test_delete_missing_session_returns_false(tmp_path: Path) -> None:
    store = HistoryStore(tmp_path / "db.sqlite")
    assert store.delete_session("nope") is False


def test_clear_terminated_removes_only_terminated(tmp_path: Path) -> None:
    store = HistoryStore(tmp_path / "db.sqlite")
    bus = seed(store)
    bus.publish({"event_type": "SessionStart", "session_key": "live"})
    bus.publish({"event_type": "SessionStart", "session_key": "dead"})
    bus.publish({"event_type": "SessionEnd", "session_key": "dead"})

    cleared = store.clear_terminated()
    assert cleared == ["dead"]
    keys = {s["session_key"] for s in store.sessions()}
    assert keys == {"live"}


def test_deleted_session_is_not_resurrected_by_later_events(tmp_path: Path) -> None:
    store = HistoryStore(tmp_path / "db.sqlite")
    bus = seed(store)
    bus.publish({"event_type": "SessionStart", "session_key": "s1", "cwd": "/repo"})

    assert store.delete_session("s1") is True
    # The terminal is still alive and keeps firing — must NOT recreate the row.
    bus.publish({"event_type": "PreToolUse", "session_key": "s1", "tool_name": "Edit"})
    bus.publish({"event_type": "Notification", "session_key": "s1"})
    assert store.session("s1") is None

    # SessionEnd lifts the tombstone (terminal gone); a brand-new session reusing
    # the key may then appear again.
    bus.publish({"event_type": "SessionEnd", "session_key": "s1"})
    assert store.session("s1") is None  # SessionEnd itself doesn't recreate
    bus.publish({"event_type": "SessionStart", "session_key": "s1", "cwd": "/repo"})
    assert store.session("s1") is not None


def test_unmerged_check_failure_is_unsafe_not_zero(tmp_path: Path, monkeypatch) -> None:
    """A failed git check must NOT read as 'zero unmerged commits' — that would
    silently bypass the delete guard and discard the agent's work."""
    store = HistoryStore(tmp_path / "db.sqlite")
    server = Server(history=store)

    wt = tmp_path / "worktrees" / "wt"
    wt.mkdir(parents=True)
    monkeypatch.setattr(server, "_worktree_path_of", lambda row: wt)

    def boom(_path: Path) -> int:
        raise GitError("git exploded")

    monkeypatch.setattr(server.orchestrator.worktrees, "unmerged_commits", boom)

    # -1 sentinel = "couldn't tell", which the delete handler treats as unsafe.
    assert server._worktree_unmerged({"worktree_path": str(wt)}) == -1
