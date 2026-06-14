"""Point RUBBERDUCK_HOME at a throwaway dir for the whole test session so no
test writes to the developer's real ~/.rubberduck/."""

import os
import subprocess
import tempfile
from collections.abc import Iterator
from pathlib import Path

import pytest


@pytest.fixture(autouse=True, scope="session")
def _isolated_home() -> Iterator[None]:
    with tempfile.TemporaryDirectory(prefix="rubberduck-test-") as d:
        prev = os.environ.get("RUBBERDUCK_HOME")
        os.environ["RUBBERDUCK_HOME"] = d
        try:
            yield
        finally:
            if prev is None:
                os.environ.pop("RUBBERDUCK_HOME", None)
            else:
                os.environ["RUBBERDUCK_HOME"] = prev


@pytest.fixture(autouse=True, scope="session")
def _clean_git_env() -> Iterator[None]:
    """Strip inherited GIT_* repo pointers (GIT_DIR/GIT_INDEX_FILE/…) for the
    whole test session. Without this, running the suite from inside a git hook
    (e.g. pre-commit) leaks the main repo's git context into the worktree tests'
    `git -C <tmp>` calls, making them act on the wrong repo and fail."""
    removed = {
        k: os.environ.pop(k)
        for k in list(os.environ)
        if k.startswith("GIT_") and k not in ("GIT_SSH", "GIT_SSH_COMMAND")
    }
    try:
        yield
    finally:
        os.environ.update(removed)


@pytest.fixture(autouse=True, scope="session")
def _no_summarizer_autodetect() -> Iterator[None]:
    """Disable the summarizer's CLI-agent auto-detection in tests, so a
    checkpoint never shells out to a real claude/codex/copilot on the dev's
    PATH. Tests that exercise the LLM path opt back in explicitly."""
    prev = os.environ.get("RUBBERDUCK_SUMMARIZER")
    os.environ["RUBBERDUCK_SUMMARIZER"] = "off"
    try:
        yield
    finally:
        if prev is None:
            os.environ.pop("RUBBERDUCK_SUMMARIZER", None)
        else:
            os.environ["RUBBERDUCK_SUMMARIZER"] = prev


@pytest.fixture
def git_repo(tmp_path: Path) -> Path:
    """A real git repo with one commit, for worktree tests."""
    repo = tmp_path / "repo"
    repo.mkdir()

    def git(*args: str) -> None:
        subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True)

    git("init", "-q")
    git("config", "user.email", "test@rubberduck.local")
    git("config", "user.name", "Rubberduck Test")
    (repo / "README.md").write_text("base\n")
    git("add", "README.md")
    git("commit", "-q", "-m", "initial")
    return repo
