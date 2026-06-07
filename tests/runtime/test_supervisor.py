"""Act 3 runtime gate: launch the fake agent under the supervisor and confirm
its lifecycle (busy -> idle -> exit) shows up as events with no real LLM."""

import asyncio
import sys
from pathlib import Path

from rubberduck.eventbus import Event, EventBus
from rubberduck.orchestrator import Orchestrator
from rubberduck.runtimes.generic import GenericRuntime

FAKE_AGENT = Path(__file__).parent.parent / "fakes" / "fake_agent.py"


def collecting_bus() -> tuple[EventBus, list[Event]]:
    captured: list[Event] = []
    return EventBus(sink=captured.append), captured


def launch_command(script_lines: list[str], tmp_path: Path) -> str:
    script = tmp_path / "agent.txt"
    script.write_text("\n".join(script_lines) + "\n")
    return f"{sys.executable} {FAKE_AGENT} --script {script} --delay 0.02"


def test_supervised_agent_emits_full_lifecycle(tmp_path: Path) -> None:
    bus, events = collecting_bus()

    async def scenario() -> None:
        orch = Orchestrator(bus)
        cmd = launch_command(["[busy]", "[tool] build", "[idle]"], tmp_path)
        key = await orch.launch(runtime=GenericRuntime(cmd), cwd=str(tmp_path), session_key="s1")
        supervisor = orch.get(key)
        assert supervisor is not None
        await asyncio.wait_for(supervisor._task, 5)  # type: ignore[arg-type]

    asyncio.run(scenario())

    types = [e["event_type"] for e in events]
    assert types[0] == "SessionStart"
    assert types[-1] == "SessionEnd"
    # The [tool] build line produces a PreToolUse with the tool name.
    tool_events = [e for e in events if e["event_type"] == "PreToolUse" and "tool_name" in e]
    assert any(e["tool_name"] == "build" for e in tool_events)
    # The [idle] marker flips state, emitting a Stop event.
    assert "Stop" in types
    # Every event carries the session key and runtime.
    assert {e["session_key"] for e in events} == {"s1"}
    assert {e["runtime"] for e in events} == {"generic"}


def test_stop_terminates_a_running_agent(tmp_path: Path) -> None:
    bus, events = collecting_bus()

    async def scenario() -> bool:
        orch = Orchestrator(bus)
        # An agent that keeps printing for ~10s unless stopped early.
        cmd = launch_command(["[busy]"] * 200, tmp_path)
        key = await orch.launch(runtime=GenericRuntime(cmd), cwd=str(tmp_path))
        await asyncio.sleep(0.2)
        running_before = orch.get(key).running  # type: ignore[union-attr]
        await orch.stop(key)
        return running_before

    running_before = asyncio.run(scenario())
    assert running_before is True
    assert events[0]["event_type"] == "SessionStart"
    assert events[-1]["event_type"] == "SessionEnd"
