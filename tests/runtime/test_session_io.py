"""Tier 3 backend: a supervised agent's output is captured and retrievable, and
input can be written to a live agent's stdin (terminal-attach)."""

import asyncio
import sys
from pathlib import Path

from rubberduck.eventbus import EventBus
from rubberduck.orchestrator import Orchestrator
from rubberduck.runtimes.generic import GenericRuntime

FAKE_AGENT = Path(__file__).parent.parent / "fakes" / "fake_agent.py"


def test_output_tail_captures_agent_output(tmp_path: Path) -> None:
    bus = EventBus()
    orch = Orchestrator(bus)
    script = tmp_path / "s.txt"
    script.write_text("[busy]\n[tool] build\n[idle]\n")
    cmd = f"{sys.executable} {FAKE_AGENT} --script {script}"

    async def scenario() -> list[str]:
        key = await orch.launch(runtime=GenericRuntime(cmd), cwd=str(tmp_path))
        sup = orch.get(key)
        assert sup is not None
        await asyncio.wait_for(sup._task, 5)  # type: ignore[arg-type]
        return sup.output_tail()

    output = asyncio.run(scenario())
    joined = "".join(output)
    assert "[busy]" in joined
    assert "[tool] build" in joined
    assert "[idle]" in joined


def test_write_input_returns_false_when_not_running(tmp_path: Path) -> None:
    bus = EventBus()
    orch = Orchestrator(bus)
    cmd = f"{sys.executable} {FAKE_AGENT}"

    async def scenario() -> bool:
        key = await orch.launch(runtime=GenericRuntime(cmd), cwd=str(tmp_path))
        sup = orch.get(key)
        assert sup is not None
        await asyncio.wait_for(sup._task, 5)  # type: ignore[arg-type]
        # Agent has exited; writing input must fail cleanly, not raise.
        return sup.write_input("hello\n")

    assert asyncio.run(scenario()) is False


def test_subscribe_output_replays_then_streams(tmp_path: Path) -> None:
    bus = EventBus()
    orch = Orchestrator(bus)
    script = tmp_path / "s.txt"
    script.write_text("[busy]\n[idle]\n")
    cmd = f"{sys.executable} {FAKE_AGENT} --script {script} --delay 0.05"

    async def scenario() -> list[str]:
        key = await orch.launch(runtime=GenericRuntime(cmd), cwd=str(tmp_path))
        sup = orch.get(key)
        assert sup is not None
        feed = sup.subscribe_output()
        collected: list[str] = []
        try:
            # Pull a couple of lines as they stream.
            for _ in range(2):
                collected.append(await asyncio.wait_for(feed.__anext__(), 5))
        finally:
            await feed.aclose()
            await asyncio.wait_for(sup._task, 5)  # type: ignore[arg-type]
        return collected

    lines = asyncio.run(scenario())
    assert any("[busy]" in line for line in lines)
