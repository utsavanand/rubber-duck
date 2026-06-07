"""tmux-backed sessions survive a server restart: a session launched by one
Orchestrator is re-adopted by a fresh one and remains controllable.

Skipped when tmux isn't installed (the PTY path has no persistence)."""

import asyncio
import shutil
import sys
from pathlib import Path

import pytest

from rubberduck import tmux
from rubberduck.eventbus import EventBus
from rubberduck.history import HistoryStore
from rubberduck.orchestrator import Orchestrator
from rubberduck.runtimes.generic import GenericRuntime

_HAS_TMUX = shutil.which("tmux") is not None
FAKE_AGENT = Path(__file__).parent.parent / "fakes" / "fake_agent.py"


@pytest.mark.skipif(not _HAS_TMUX, reason="tmux not installed")
def test_session_is_readopted_after_restart(tmp_path: Path) -> None:
    # A long-lived agent so it's still running when the second orchestrator starts.
    script = tmp_path / "s.txt"
    script.write_text("[busy]\n" * 100)
    cmd = f"{sys.executable} {FAKE_AGENT} --script {script} --delay 0.2"
    key = "persist-test"

    async def scenario() -> tuple[bool, list[str], bool]:
        store = HistoryStore(tmp_path / "db.sqlite")
        bus1 = EventBus(sink=store.record)
        orch1 = Orchestrator(bus1, history=store)
        await orch1.launch(runtime=GenericRuntime(cmd), cwd=str(tmp_path), session_key=key)
        await asyncio.sleep(0.5)
        alive_after_launch = tmux.session_exists(tmux.target_for(key))

        # Simulate a restart: a brand-new orchestrator over the same tmux/home.
        bus2 = EventBus(sink=store.record)
        orch2 = Orchestrator(bus2, history=store)
        adopted = await orch2.reconcile()
        # The re-adopted supervisor can control the session.
        stopped = await orch2.stop(key)
        return alive_after_launch, adopted, stopped

    try:
        alive, adopted, stopped = asyncio.run(scenario())
        assert alive is True
        assert key in adopted  # the fresh orchestrator re-adopted it
        assert stopped is True  # and could control it
    finally:
        tmux.kill_session(tmux.target_for(key))
