"""Detect git state from a directory, so a *watched* session (one Rubberduck
didn't launch) still knows whether it's working in a git repo — and which one.

A Claude hook reports a session's cwd but nothing about git. Running git on it
tells us the repo root, name, and branch, which is what makes fork-worktree and
the repo/branch display available for sessions we only observe.

Results are cached per cwd: a session fires hundreds of events, and the repo it
runs in doesn't change, so we detect once.
"""

import subprocess
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class GitInfo:
    repo_path: str  # absolute path of the repo root
    repo_name: str
    branch: str


_cache: dict[str, GitInfo | None] = {}


def detect(cwd: str) -> GitInfo | None:
    """Return git info for `cwd`, or None if it isn't inside a git repo.
    Cached per cwd."""
    if cwd in _cache:
        return _cache[cwd]
    info = _detect_uncached(cwd)
    _cache[cwd] = info
    return info


def _detect_uncached(cwd: str) -> GitInfo | None:
    def git(*args: str) -> str | None:
        try:
            r = subprocess.run(["git", "-C", cwd, *args], capture_output=True, text=True, timeout=3)
        except (OSError, subprocess.TimeoutExpired):
            return None
        return r.stdout.strip() if r.returncode == 0 else None

    root = git("rev-parse", "--show-toplevel")
    if not root:
        return None
    branch = git("rev-parse", "--abbrev-ref", "HEAD") or "HEAD"
    return GitInfo(repo_path=root, repo_name=Path(root).name, branch=branch)
