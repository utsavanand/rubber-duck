"""Server-side directory listing for the New Session path picker. The browser
can't open a native folder dialog, but the server runs on your machine, so it
can list directories for the UI to navigate.

Lists subdirectories of a path, flags which are git repos, and resolves '~'.
Read-only and confined to the user's home directory, so a forged request can't
enumerate arbitrary parts of the filesystem.
"""

import os
from pathlib import Path
from typing import Any


def listing(path: str | None) -> dict[str, Any]:
    home = Path.home().resolve()
    base = Path(path).expanduser().resolve() if path else home
    # Confine browsing to the home tree; anything outside snaps back to home.
    if base != home and not base.is_relative_to(home):
        base = home
    if not base.is_dir():
        base = home

    entries: list[dict[str, Any]] = []
    try:
        children = sorted(
            (p for p in base.iterdir() if p.is_dir() and not p.name.startswith(".")),
            key=lambda p: p.name.lower(),
        )
    except OSError:
        children = []

    for child in children:
        entries.append({"name": child.name, "path": str(child), "is_git": _is_git(child)})

    # Don't expose a parent above home — navigation stops at the home root.
    parent = base.parent if base != home and base.parent != base else None
    return {
        "path": str(base),
        "parent": str(parent) if parent else None,
        "is_git": _is_git(base),
        "entries": entries,
    }


def _is_git(p: Path) -> bool:
    return (p / ".git").exists() and os.access(p, os.R_OK)
