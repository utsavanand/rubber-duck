"""Storage locations under ~/.rubberduck/, overridable via RUBBERDUCK_HOME."""

import os
from pathlib import Path


def home() -> Path:
    override = os.environ.get("RUBBERDUCK_HOME")
    return Path(override) if override else Path.home() / ".rubberduck"


def db_path() -> Path:
    return home() / "db.sqlite"


def worktrees_dir() -> Path:
    return home() / "worktrees"


def snapshots_dir() -> Path:
    return home() / "snapshots"
