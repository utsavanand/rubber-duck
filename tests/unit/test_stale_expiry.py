from pathlib import Path

from rubberduck.eventbus import EventBus
from rubberduck.history import HistoryStore


def test_idle_session_is_expired(tmp_path: Path) -> None:
    store = HistoryStore(tmp_path / "db.sqlite")
    bus = EventBus(sink=store.record)
    bus.publish({"event_type": "SessionStart", "session_key": "old"})

    now = store.session("old")["updated_at"]  # type: ignore[index]
    # Sweep with "now" 30 min later, 20-min idle window -> expired.
    expired = store.expire_stale(now_ms=now + 30 * 60_000, idle_ms=20 * 60_000)
    assert expired == ["old"]
    assert store.session("old")["state"] == "terminated"  # type: ignore[index]


def test_recent_session_is_not_expired(tmp_path: Path) -> None:
    store = HistoryStore(tmp_path / "db.sqlite")
    bus = EventBus(sink=store.record)
    bus.publish({"event_type": "SessionStart", "session_key": "fresh"})

    now = store.session("fresh")["updated_at"]  # type: ignore[index]
    # Only 5 min later, 20-min window -> still active.
    assert store.expire_stale(now_ms=now + 5 * 60_000, idle_ms=20 * 60_000) == []
    assert store.session("fresh")["state"] != "terminated"  # type: ignore[index]


def test_already_terminated_not_re_expired(tmp_path: Path) -> None:
    store = HistoryStore(tmp_path / "db.sqlite")
    bus = EventBus(sink=store.record)
    bus.publish({"event_type": "SessionStart", "session_key": "done"})
    bus.publish({"event_type": "SessionEnd", "session_key": "done"})

    now = store.session("done")["updated_at"]  # type: ignore[index]
    assert store.expire_stale(now_ms=now + 60 * 60_000, idle_ms=20 * 60_000) == []
