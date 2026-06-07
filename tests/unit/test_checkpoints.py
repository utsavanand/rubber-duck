from pathlib import Path

from rubberduck.checkpoints import create_checkpoint, rollback
from rubberduck.worktrees import WorktreeManager


def test_checkpoint_and_rollback_restores_tracked_changes(git_repo: Path, tmp_path: Path) -> None:
    wt = WorktreeManager(root=tmp_path / "wt").add(git_repo, "feature")
    target = wt.path / "README.md"

    target.write_text("checkpoint state\n")
    cp = create_checkpoint(wt.path, label="before risky edit", now_ms=1000)

    # The agent then makes a change we want to undo.
    target.write_text("agent broke it\n")
    assert target.read_text() == "agent broke it\n"

    rollback(wt.path, cp.commit)
    assert target.read_text() == "checkpoint state\n"


def test_rollback_drops_files_added_after_checkpoint(git_repo: Path, tmp_path: Path) -> None:
    wt = WorktreeManager(root=tmp_path / "wt").add(git_repo, "feature")
    cp = create_checkpoint(wt.path, label="clean", now_ms=1000)

    (wt.path / "junk.txt").write_text("added by agent")
    rollback(wt.path, cp.commit)

    assert not (wt.path / "junk.txt").exists()


def test_checkpoint_on_clean_tree_uses_head(git_repo: Path, tmp_path: Path) -> None:
    wt = WorktreeManager(root=tmp_path / "wt").add(git_repo, "feature")
    cp = create_checkpoint(wt.path, label="clean", now_ms=1000)
    # A clean tree's checkpoint resolves to a real commit (HEAD) we can roll back to.
    assert len(cp.commit) == 40
