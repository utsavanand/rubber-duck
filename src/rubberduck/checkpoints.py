"""Per-worktree checkpoints: snapshot a session's working tree so you can roll
back an agent's changes.

A checkpoint is a commit object made with `git stash create` — it captures the
working tree (tracked changes) without altering the index, HEAD, or the stash
list. Rollback restores that snapshot with `git checkout <commit> -- .` followed
by cleaning newly-added files. Checkpoint refs are recorded in the history DB so
they survive a restart.
"""

import subprocess
from dataclasses import dataclass
from pathlib import Path

from rubberduck.worktrees import GitError


@dataclass(frozen=True)
class Checkpoint:
    commit: str
    label: str
    created_at: int


def _git(cwd: Path, *args: str) -> str:
    result = subprocess.run(["git", "-C", str(cwd), *args], capture_output=True, text=True)
    if result.returncode != 0:
        raise GitError(f"git {' '.join(args)} failed: {result.stderr.strip()}")
    return result.stdout.strip()


def create_checkpoint(worktree: Path, *, label: str, now_ms: int) -> Checkpoint:
    """Snapshot the worktree's tracked changes. Returns a commit that holds them.
    If the tree is clean, `git stash create` prints nothing — we fall back to the
    current HEAD so a checkpoint always resolves to something restorable."""
    commit = _git(worktree, "stash", "create", f"rubberduck checkpoint: {label}")
    if not commit:
        commit = _git(worktree, "rev-parse", "HEAD")
    return Checkpoint(commit=commit, label=label, created_at=now_ms)


def rollback(worktree: Path, commit: str) -> None:
    """Restore the worktree to a checkpoint commit: reset tracked files to the
    snapshot and drop untracked files created since."""
    _git(worktree, "checkout", commit, "--", ".")
    _git(worktree, "clean", "-fd")
