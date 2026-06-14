"""Act 8 runtime gate: a claude-code session with a JSONL transcript produces a
transcript-based summary; the same machinery falls back to mechanical when no
transcript exists."""

import asyncio
import json
import os
import sys
from collections.abc import Iterator
from pathlib import Path

import pytest

from rubberduck.core.eventbus import EventBus
from rubberduck.core.orchestrator import Orchestrator
from rubberduck.git.worktrees import WorktreeManager
from rubberduck.persistence.history import HistoryStore
from rubberduck.runtimes.claude_code import ClaudeCodeRuntime

FAKE_AGENT = Path(__file__).parent.parent / "fakes" / "fake_agent.py"


@pytest.fixture
def fake_home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Path]:
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path / "home"))
    (tmp_path / "home").mkdir()
    for k in ("RUBBERDUCK_SUMMARIZER_CMD", "RUBBERDUCK_SUMMARIZER_URL"):
        os.environ.pop(k, None)
    yield tmp_path / "home"


def test_claude_session_summary_uses_transcript(tmp_path: Path, fake_home: Path) -> None:
    # A summarizer that echoes its stdin so we can see what the transcript fed it.
    os.environ["RUBBERDUCK_SUMMARIZER_CMD"] = "cat"
    work = tmp_path / "work"
    work.mkdir()

    # Plant a Claude transcript where the locator will look.
    slug = str(work.resolve()).replace("/", "-")
    transcript = fake_home / ".claude" / "projects" / slug / "claude-sess.jsonl"
    transcript.parent.mkdir(parents=True)
    transcript.write_text(
        json.dumps({"message": {"role": "user", "content": "add a healthcheck endpoint"}})
        + "\n"
        + json.dumps({"message": {"role": "assistant", "content": "Added /healthz."}})
        + "\n"
    )

    store = HistoryStore(tmp_path / "db.sqlite")
    bus = EventBus(sink=store.record)
    orch = Orchestrator(bus, worktrees=WorktreeManager(root=tmp_path / "wt"), history=store)
    runtime = ClaudeCodeRuntime(f"{sys.executable} {FAKE_AGENT}")

    async def scenario() -> str:
        key = await orch.launch(runtime=runtime, cwd=str(work), prompt="add healthcheck")
        # Emit the agent's own session_id so the locator can find the transcript.
        bus.publish({"event_type": "SessionStart", "session_key": key, "session_id": "claude-sess"})
        await asyncio.wait_for(orch.get(key)._task, 5)  # type: ignore[union-attr,arg-type]
        await asyncio.sleep(0)
        return key

    key = asyncio.run(scenario())

    row = store.session(key)
    assert row is not None
    # The summary (echoed prompt) contains the transcript text.
    assert "add a healthcheck endpoint" in row["outcome_summary"]
    assert "Added /healthz." in row["outcome_summary"]
