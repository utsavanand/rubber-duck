from pathlib import Path

import pytest

from rubberduck.worktrees import GitError, WorktreeManager


def test_add_creates_real_worktree_on_new_branch(git_repo: Path, tmp_path: Path) -> None:
    mgr = WorktreeManager(root=tmp_path / "wt")
    wt = mgr.add(git_repo, "feature-x")

    assert wt.path.is_dir()
    assert (wt.path / "README.md").read_text() == "base\n"  # checked out from HEAD
    assert wt.branch == "feature-x"
    # The branch exists in the repo.
    branches = WorktreeManager(root=tmp_path / "wt").list(git_repo)
    assert [w.branch for w in branches] == ["feature-x"]


def test_two_worktrees_are_isolated(git_repo: Path, tmp_path: Path) -> None:
    mgr = WorktreeManager(root=tmp_path / "wt")
    a = mgr.add(git_repo, "feat-a")
    b = mgr.add(git_repo, "feat-b")

    (a.path / "only_in_a.txt").write_text("a")
    assert not (b.path / "only_in_a.txt").exists()
    assert a.path != b.path


def test_remove_deletes_worktree_and_branch(git_repo: Path, tmp_path: Path) -> None:
    mgr = WorktreeManager(root=tmp_path / "wt")
    wt = mgr.add(git_repo, "temp")
    mgr.remove(git_repo, wt.path)

    assert not wt.path.exists()
    assert mgr.list(git_repo) == []


def test_add_rejects_non_git_directory(tmp_path: Path) -> None:
    mgr = WorktreeManager(root=tmp_path / "wt")
    plain = tmp_path / "not-a-repo"
    plain.mkdir()
    with pytest.raises(GitError, match="not a git repository"):
        mgr.add(plain, "x")


def test_add_rejects_duplicate_branch(git_repo: Path, tmp_path: Path) -> None:
    mgr = WorktreeManager(root=tmp_path / "wt")
    mgr.add(git_repo, "dup")
    with pytest.raises(GitError):
        mgr.add(git_repo, "dup")


def test_remove_by_worktree_resolves_repo_from_path(git_repo: Path, tmp_path: Path) -> None:
    # The caller has only the worktree path (not the original repo); removal
    # still finds the main repo via the shared git dir and deletes the branch.
    mgr = WorktreeManager(root=tmp_path / "wt")
    wt = mgr.add(git_repo, "throwaway")
    mgr.remove_by_worktree(wt.path)

    assert not wt.path.exists()
    assert mgr.list(git_repo) == []


def test_unmerged_commits_counts_branch_only_commits(git_repo: Path, tmp_path: Path) -> None:
    mgr = WorktreeManager(root=tmp_path / "wt")
    wt = mgr.add(git_repo, "feature")
    assert mgr.unmerged_commits(wt.path) == 0  # fresh branch == HEAD

    # Commit in the worktree → now it has work not in main.
    import subprocess

    (wt.path / "new.txt").write_text("work")
    subprocess.run(["git", "-C", str(wt.path), "add", "new.txt"], check=True, capture_output=True)
    subprocess.run(
        ["git", "-C", str(wt.path), "commit", "-q", "-m", "agent work"],
        check=True,
        capture_output=True,
    )
    assert mgr.unmerged_commits(wt.path) == 1
