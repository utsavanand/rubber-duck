from pathlib import Path

from rubberduck.git.spotlight import spotlight_to_main
from rubberduck.git.worktrees import WorktreeManager


def test_spotlight_copies_worktree_edit_to_main(git_repo: Path, tmp_path: Path) -> None:
    wt = WorktreeManager(root=tmp_path / "wt").add(git_repo, "feature")

    # Agent edits a tracked file in its worktree.
    (wt.path / "README.md").write_text("changed by the agent\n")

    changed = spotlight_to_main(repo=git_repo, worktree=wt.path)

    assert "README.md" in changed
    # The change is now visible in the MAIN checkout, not just the worktree.
    assert (git_repo / "README.md").read_text() == "changed by the agent\n"


def test_spotlight_copies_new_untracked_file(git_repo: Path, tmp_path: Path) -> None:
    wt = WorktreeManager(root=tmp_path / "wt").add(git_repo, "feature")
    (wt.path / "newfile.py").write_text("print('hi')\n")

    changed = spotlight_to_main(repo=git_repo, worktree=wt.path)

    assert "newfile.py" in changed
    assert (git_repo / "newfile.py").read_text() == "print('hi')\n"


def test_spotlight_noop_when_worktree_unchanged(git_repo: Path, tmp_path: Path) -> None:
    wt = WorktreeManager(root=tmp_path / "wt").add(git_repo, "feature")
    assert spotlight_to_main(repo=git_repo, worktree=wt.path) == []
