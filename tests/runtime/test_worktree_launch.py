"""Act 4 runtime gate: two sessions on one repo get isolated worktrees, and the
session rows record where each one lives."""

import asyncio
import sys
from pathlib import Path

from rubberduck.core.eventbus import EventBus
from rubberduck.core.orchestrator import Orchestrator
from rubberduck.git.worktrees import WorktreeManager
from rubberduck.persistence.history import HistoryStore
from rubberduck.runtimes.generic import GenericRuntime

FAKE_AGENT = Path(__file__).parent.parent / "fakes" / "fake_agent.py"


def quick_agent() -> GenericRuntime:
    # Emits one busy/idle cycle and exits immediately.
    return GenericRuntime(f"{sys.executable} {FAKE_AGENT}")


def test_two_sessions_get_isolated_worktrees(git_repo: Path, tmp_path: Path) -> None:
    store = HistoryStore(tmp_path / "db.sqlite")
    bus = EventBus(sink=store.record)
    orch = Orchestrator(bus, worktrees=WorktreeManager(root=tmp_path / "wt"))

    async def scenario() -> tuple[dict[str, object], dict[str, object]]:
        a = await orch.launch(runtime=quick_agent(), repo_path=str(git_repo), branch="feat-a")
        b = await orch.launch(runtime=quick_agent(), repo_path=str(git_repo), branch="feat-b")
        await asyncio.wait_for(orch.get(a)._task, 5)  # type: ignore[union-attr,arg-type]
        await asyncio.wait_for(orch.get(b)._task, 5)  # type: ignore[union-attr,arg-type]
        row_a = store.session(a)
        row_b = store.session(b)
        assert row_a is not None and row_b is not None
        return row_a, row_b

    row_a, row_b = asyncio.run(scenario())

    # Distinct worktrees, distinct branches, same origin repo.
    assert row_a["worktree_path"] != row_b["worktree_path"]
    assert {row_a["branch"], row_b["branch"]} == {"feat-a", "feat-b"}
    assert row_a["repo_path"] == row_b["repo_path"] == str(git_repo.resolve())

    # Real, isolated checkouts: a write in one is invisible in the other.
    path_a = Path(str(row_a["worktree_path"]))
    path_b = Path(str(row_b["worktree_path"]))
    (path_a / "scratch.txt").write_text("only a")
    assert not (path_b / "scratch.txt").exists()
    assert (path_a / "README.md").read_text() == (path_b / "README.md").read_text() == "base\n"
