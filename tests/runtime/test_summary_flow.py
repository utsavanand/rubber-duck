"""Act 7 runtime gate: a session start->end records its intention and an outcome
summary. With no summarizer configured it falls back to a mechanical summary;
with a CLI summarizer it uses that."""

import asyncio
import os
import sys
from collections.abc import Iterator
from pathlib import Path

import pytest

from rubberduck.eventbus import EventBus
from rubberduck.history import HistoryStore
from rubberduck.orchestrator import Orchestrator
from rubberduck.runtimes.generic import GenericRuntime
from rubberduck.worktrees import WorktreeManager

FAKE_AGENT = Path(__file__).parent.parent / "fakes" / "fake_agent.py"


@pytest.fixture
def no_summarizer() -> Iterator[None]:
    saved = {
        k: os.environ.pop(k, None)
        for k in ("RUBBERDUCK_SUMMARIZER_CMD", "RUBBERDUCK_SUMMARIZER_URL")
    }
    try:
        yield
    finally:
        for k, v in saved.items():
            if v is not None:
                os.environ[k] = v


def _run_session(store: HistoryStore, tmp_path: Path, intention: str) -> str:
    bus = EventBus(sink=store.record)
    orch = Orchestrator(bus, worktrees=WorktreeManager(root=tmp_path / "wt"), history=store)
    agent = GenericRuntime(f"{sys.executable} {FAKE_AGENT}")

    async def scenario() -> str:
        key = await orch.launch(runtime=agent, cwd=str(tmp_path), prompt=intention)
        await asyncio.wait_for(orch.get(key)._task, 5)  # type: ignore[union-attr,arg-type]
        # The done-callback writes the summary synchronously after the task ends;
        # yield once so the callback runs.
        await asyncio.sleep(0)
        return key

    return asyncio.run(scenario())


def test_intention_and_mechanical_outcome_recorded(tmp_path: Path, no_summarizer: None) -> None:
    store = HistoryStore(tmp_path / "db.sqlite")
    key = _run_session(store, tmp_path, "add a logout button")

    row = store.session(key)
    assert row is not None
    assert row["intention"] == "add a logout button"
    # Mechanical fallback: states the intent and some activity.
    assert row["outcome_summary"]
    assert "add a logout button" in row["outcome_summary"]


def test_cli_summarizer_outcome_recorded(tmp_path: Path, no_summarizer: None) -> None:
    os.environ["RUBBERDUCK_SUMMARIZER_CMD"] = "printf 'session summarized by cli'"
    store = HistoryStore(tmp_path / "db.sqlite")
    key = _run_session(store, tmp_path, "refactor parser")

    row = store.session(key)
    assert row is not None
    assert row["outcome_summary"] == "session summarized by cli"
