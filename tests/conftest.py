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
