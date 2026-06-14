"""Isolated git worktrees, one per session. This is what lets several agents
work the same repo on different branches without colliding.

Worktrees live under ~/.rubberduck/worktrees/<repo-name>/<branch>. Each is a
real checkout sharing the repo's object store but with its own working tree and
branch. Pure `git` subprocess calls; no dependencies.
"""

from __future__ import annotations

import contextlib
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path

from rubberduck.helpers import paths


@dataclass(frozen=True)
class Worktree:
    path: Path
    branch: str
    repo_path: Path


class GitError(RuntimeError):
    pass


def _clean_git_env() -> dict[str, str]:
    """Environment with GIT_* repo-pointer vars stripped. When Rubberduck runs
    inside a git hook (or anything that exported GIT_DIR/GIT_INDEX_FILE/…), an
    inherited GIT_DIR would override `-C <repo>` and make git act on the wrong
    repository. Drop those so `-C` always wins."""
    return {
        k: v
        for k, v in os.environ.items()
        if not (k.startswith("GIT_") and k not in ("GIT_SSH", "GIT_SSH_COMMAND"))
    }


def _git(repo: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(repo), *args],
        capture_output=True,
        text=True,
        env=_clean_git_env(),
    )
    if result.returncode != 0:
        raise GitError(f"git {' '.join(args)} failed: {result.stderr.strip()}")
    return result.stdout


class WorktreeManager:
    def __init__(self, root: Path | None = None) -> None:
        self._root = root if root is not None else paths.worktrees_dir()

    def add(self, repo_path: Path, branch: str, *, base: str | None = None) -> Worktree:
        """Create a worktree on a new `branch` off `base` (default: repo HEAD).
        Raises GitError if repo_path is not a git repo or the branch exists."""
        repo = repo_path.resolve()
        if not (repo / ".git").exists():
            raise GitError(f"{repo} is not a git repository")
        dest = self._root / repo.name / branch
        dest.parent.mkdir(parents=True, exist_ok=True)
        args = ["worktree", "add", "-b", branch, str(dest)]
        if base is not None:
            args.append(base)
        _git(repo, *args)
        return Worktree(path=dest, branch=branch, repo_path=repo)

    def list_worktrees(self, repo_path: Path) -> list[Worktree]:
        """The session worktrees under this repo (excludes the main checkout)."""
        repo = repo_path.resolve()
        out = _git(repo, "worktree", "list", "--porcelain")
        return _parse_worktree_list(out, repo)

    def remove(self, repo_path: Path, worktree_path: Path, *, delete_branch: bool = True) -> None:
        repo = repo_path.resolve()
        branch = _branch_at(repo, worktree_path)
        _git(repo, "worktree", "remove", "--force", str(worktree_path))
        if delete_branch and branch is not None:
            _git(repo, "branch", "-D", branch)

    def remove_by_worktree(self, worktree_path: Path, *, delete_branch: bool = True) -> None:
        """Remove a worktree given only its path — resolves the main repo from
        the worktree's shared git dir, so the caller needn't track repo_path."""
        repo = _main_repo_of(worktree_path)
        self.remove(repo, worktree_path, delete_branch=delete_branch)

    def branches(self, repo_path: Path, *, fetch: bool = True) -> list[str]:
        """Branches you can base a new worktree off: local branch names plus
        remote-tracking ones (origin/…). Fetches first (best-effort) so a branch
        just pushed elsewhere shows up. HEAD is listed first when present."""
        repo = repo_path.resolve()
        if not (repo / ".git").exists():
            raise GitError(f"{repo} is not a git repository")
        if fetch:
            # Network call; never let a fetch failure (offline, no remote) block
            # the list — we still have the local branches.
            with contextlib.suppress(GitError):
                _git(repo, "fetch", "--quiet", "--all")
        out = _git(
            repo,
            "for-each-ref",
            "--format=%(refname:short)",
            "refs/heads",
            "refs/remotes",
        )
        names = [
            n
            for n in (line.strip() for line in out.splitlines())
            if n and not n.endswith("/HEAD")  # drop the symbolic origin/HEAD entry
        ]
        head = _git(repo, "rev-parse", "--abbrev-ref", "HEAD").strip()
        # Put the current branch first; keep the rest in git's order.
        return [head, *[n for n in names if n != head]] if head in names else names

    def unmerged_commits(self, worktree_path: Path) -> int:
        """How many commits the worktree's branch has that aren't reachable from
        the main repo's HEAD. >0 means deleting it would discard agent work."""
        repo = _main_repo_of(worktree_path)
        branch = _branch_at(repo, worktree_path)
        if branch is None:
            return 0
        out = _git(repo, "rev-list", "--count", f"HEAD..{branch}").strip()
        return int(out) if out.isdigit() else 0


def _parse_worktree_list(porcelain: str, repo: Path) -> list[Worktree]:
    """Parse `git worktree list --porcelain`. Skips the main worktree (the repo
    itself) — callers want the session worktrees, not the checkout they branched
    from."""
    worktrees: list[Worktree] = []
    path: Path | None = None
    branch: str | None = None
    for line in porcelain.splitlines():
        if line.startswith("worktree "):
            path = Path(line[len("worktree ") :])
        elif line.startswith("branch "):
            branch = line[len("branch refs/heads/") :]
        elif line == "":
            if path is not None and path != repo and branch is not None:
                worktrees.append(Worktree(path=path, branch=branch, repo_path=repo))
            path, branch = None, None
    return worktrees


def _branch_at(repo: Path, worktree_path: Path) -> str | None:
    for wt in _parse_worktree_list(_git(repo, "worktree", "list", "--porcelain"), repo):
        if wt.path == worktree_path.resolve():
            return wt.branch
    return None


def _main_repo_of(worktree_path: Path) -> Path:
    """The main repo a worktree belongs to. --git-common-dir points at the shared
    <repo>/.git; its parent is the repo working tree."""
    common = _git(worktree_path, "rev-parse", "--git-common-dir").strip()
    git_dir = Path(common)
    if not git_dir.is_absolute():
        git_dir = (worktree_path / git_dir).resolve()
    return git_dir.parent
