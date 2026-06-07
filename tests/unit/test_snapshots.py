from pathlib import Path

from rubberduck.eventbus import EventBus
from rubberduck.history import HistoryStore
from rubberduck.snapshots import ACTIVE_WINDOW_MS, SnapshotManager, restore_command_for


def make_store(tmp_path: Path) -> tuple[HistoryStore, EventBus]:
    store = HistoryStore(tmp_path / "db.sqlite")
    return store, EventBus(sink=store.record)


def test_snapshot_bundles_recent_sessions(tmp_path: Path) -> None:
    store, bus = make_store(tmp_path)
    bus.publish({"event_type": "SessionStart", "session_key": "live"})
    mgr = SnapshotManager(store, root=tmp_path / "snaps")

    now = store.session("live")["updated_at"]  # type: ignore[index]
    snap_id = mgr.create(now_ms=now)

    manifest = mgr.get(snap_id)
    assert manifest is not None
    keys = [s["session_key"] for s in manifest["sessions"]]
    assert keys == ["live"]


def test_snapshot_excludes_stale_sessions(tmp_path: Path) -> None:
    store, bus = make_store(tmp_path)
    bus.publish({"event_type": "SessionStart", "session_key": "old"})
    mgr = SnapshotManager(store, root=tmp_path / "snaps")

    old_ts = store.session("old")["updated_at"]  # type: ignore[index]
    # Snapshot taken well after the active window has passed.
    snap_id = mgr.create(now_ms=old_ts + ACTIVE_WINDOW_MS + 1)

    manifest = mgr.get(snap_id)
    assert manifest is not None
    assert manifest["sessions"] == []


def test_list_returns_created_snapshots(tmp_path: Path) -> None:
    store, bus = make_store(tmp_path)
    bus.publish({"event_type": "SessionStart", "session_key": "s"})
    mgr = SnapshotManager(store, root=tmp_path / "snaps")
    ts = store.session("s")["updated_at"]  # type: ignore[index]
    a = mgr.create(now_ms=ts)
    b = mgr.create(now_ms=ts + 1)

    ids = [snap["id"] for snap in mgr.list()]
    assert set(ids) == {a, b}


def test_restore_command_per_runtime() -> None:
    claude = restore_command_for({"runtime": "claude-code", "session_key": "k", "cwd": "/r"})
    assert claude == ["claude", "--resume", "k"]

    codex = restore_command_for({"runtime": "codex", "session_key": "k", "cwd": "/r"})
    assert codex == ["codex"]
