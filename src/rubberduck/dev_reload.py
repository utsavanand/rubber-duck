"""Dev-only auto-reload for `rubberduck serve --reload`.

Polls the mtimes of every .py under src/rubberduck once a second on a daemon
thread; when one changes, re-execs the current process so code edits take effect
without a manual restart. Stdlib-only (no watchdog) to keep the package
dependency-free. Not for production — it re-runs the exact argv that started the
server, so the new process re-binds the same port.
"""

import os
import sys
import threading
import time
from pathlib import Path

_POLL_SECONDS = 1.0


def _source_mtimes() -> dict[str, float]:
    root = Path(__file__).resolve().parent
    return {str(p): p.stat().st_mtime for p in root.rglob("*.py")}


def changed_path(
    before: dict[str, float], after: dict[str, float]
) -> str | None:
    """The first source file whose mtime changed (or that was added/removed)
    between two scans, or None if nothing changed. Pure, so it's testable."""
    for path, mtime in after.items():
        if before.get(path) != mtime:
            return path
    removed = set(before) - set(after)
    return next(iter(removed), None)


def _watch(initial: dict[str, float]) -> None:
    while True:
        time.sleep(_POLL_SECONDS)
        try:
            current = _source_mtimes()
        except OSError:
            continue  # a file vanished mid-scan (editor swap); try again next tick
        changed = changed_path(initial, current)
        if changed is not None:
            print(
                f"[rubberduck] {Path(changed).name} changed — restarting",
                file=sys.stderr,
                flush=True,
            )
            os.execv(sys.executable, [sys.executable, *sys.argv])


def watch_and_reexec() -> None:
    """Start the file-watch thread. The thread is a daemon so it never blocks
    shutdown; the re-exec replaces the whole process image, so no cleanup is
    needed beyond what the OS does on exec."""
    threading.Thread(target=_watch, args=(_source_mtimes(),), daemon=True).start()
