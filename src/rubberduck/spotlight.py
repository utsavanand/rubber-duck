"""Spotlight: copy a session worktree's changes onto the repo's main checkout so
you can run/test the agent's work in your primary tree without merging.

Mechanism: diff the worktree's HEAD-plus-uncommitted state against the main
branch, then `git apply` that patch to the main working tree. Non-destructive to
the worktree; the main tree ends up with the changes unstaged so you can inspect,
test, then commit or `git checkout -- .` to discard.
"""

import subprocess
from pathlib import Path

from rubberduck.worktrees import GitError


def _git(cwd: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(["git", "-C", str(cwd), *args], capture_output=True, text=True)
    if check and result.returncode != 0:
        raise GitError(f"git {' '.join(args)} failed: {result.stderr.strip()}")
    return result


def spotlight_to_main(repo: Path, worktree: Path) -> list[str]:
    """Apply the worktree's full diff (committed + uncommitted, vs the main
    checkout's HEAD) onto the main working tree. Returns the changed file paths.
    Returns [] when there is nothing to sync."""
    base = _git(repo, "rev-parse", "HEAD").stdout.strip()
    # Diff the worktree's working tree against the main checkout's HEAD.
    diff = _git(worktree, "diff", base).stdout
    # Include files the worktree added but hasn't committed (untracked).
    untracked = _git(worktree, "ls-files", "--others", "--exclude-standard").stdout.split()

    if not diff and not untracked:
        return []

    changed: list[str] = []
    if diff:
        apply = subprocess.run(
            ["git", "-C", str(repo), "apply", "--3way"],
            input=diff,
            capture_output=True,
            text=True,
        )
        if apply.returncode != 0:
            raise GitError(f"spotlight apply failed: {apply.stderr.strip()}")
        changed.extend(_changed_paths(diff))

    for rel in untracked:
        (repo / rel).parent.mkdir(parents=True, exist_ok=True)
        (repo / rel).write_bytes((worktree / rel).read_bytes())
        changed.append(rel)

    return sorted(set(changed))


def _changed_paths(diff: str) -> list[str]:
    paths: list[str] = []
    for line in diff.splitlines():
        if line.startswith("+++ b/"):
            paths.append(line[len("+++ b/") :])
    return paths
