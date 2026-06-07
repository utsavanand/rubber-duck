"""Server-side directory listing for the New Session path picker. The browser
can't open a native folder dialog, but the server runs on your machine, so it
can list directories for the UI to navigate.

Lists subdirectories of a path, flags which are git repos, and resolves '~'.
Read-only; localhost-only by virtue of where the server binds.
"""

import os
from pathlib import Path
from typing import Any


def listing(path: str | None) -> dict[str, Any]:
    base = Path(path).expanduser() if path else Path.home()
    base = base.resolve()
    if not base.is_dir():
        base = Path.home()

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

    return {
        "path": str(base),
        "parent": str(base.parent) if base.parent != base else None,
        "is_git": _is_git(base),
        "entries": entries,
    }


def _is_git(p: Path) -> bool:
    return (p / ".git").exists() and os.access(p, os.R_OK)
