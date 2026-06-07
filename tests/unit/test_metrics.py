from pathlib import Path

from rubberduck.eventbus import EventBus
from rubberduck.history import HistoryStore
from rubberduck.metrics import classify


def evt(command: str | None = None, tool: str | None = None, etype: str = "PreToolUse") -> dict:
    e: dict = {"event_type": etype, "session_key": "s"}
    if tool:
        e["tool_name"] = tool
    if command:
        e["tool_input"] = {"command": command}
    return e


def test_classify_build_commands() -> None:
    assert classify(evt(command="npm run build")) == "build"
    assert classify(evt(command="cargo build --release")) == "build"
    assert classify(evt(command="make")) == "build"


def test_classify_test_commands() -> None:
    assert classify(evt(command="pytest tests/")) == "test"
    assert classify(evt(command="go test ./...")) == "test"
    assert classify(evt(command="npm test")) == "test"


def test_classify_ignores_non_tool_events() -> None:
    assert classify(evt(command="pytest", etype="Stop")) is None
    assert classify(evt(command="echo hello")) is None


def test_metrics_count_per_session(tmp_path: Path) -> None:
    store = HistoryStore(tmp_path / "db.sqlite")
    bus = EventBus(sink=store.record)
    bus.publish(evt(command="npm run build"))
    bus.publish(evt(command="npm run build"))
    bus.publish(evt(command="npm run build"))
    bus.publish(evt(command="pytest"))

    assert store.metrics("s") == {"build": 3, "test": 1}


def test_metrics_appear_on_session_rows(tmp_path: Path) -> None:
    store = HistoryStore(tmp_path / "db.sqlite")
    bus = EventBus(sink=store.record)
    bus.publish({"event_type": "SessionStart", "session_key": "s"})
    bus.publish(evt(command="cargo build"))

    row = next(s for s in store.sessions() if s["session_key"] == "s")
    assert row["metrics"] == {"build": 1}
