"""Snapshots: freeze the set of recently-active sessions to disk so you can
catch up later or resume a dead one.

A snapshot bundles every session active in the last hour plus its events into
~/.rubberduck/snapshots/<id>/manifest.json. Restore relaunches a session by
running its runtime's restore_command in a new terminal — the terminal-spawning
machinery is generic; only the command string is runtime-specific.
"""

import json
import platform
import subprocess
from pathlib import Path
from typing import Any

from rubberduck import paths
from rubberduck.history import HistoryStore

ACTIVE_WINDOW_MS = 60 * 60 * 1000


class SnapshotManager:
    def __init__(self, history: HistoryStore, root: Path | None = None) -> None:
        self._history = history
        self._root = root if root is not None else paths.snapshots_dir()

    def create(self, *, now_ms: int) -> str:
        """Bundle sessions active within the last hour. `now_ms` is passed in
        rather than read from the clock so snapshots are reproducible/testable."""
        cutoff = now_ms - ACTIVE_WINDOW_MS
        sessions = [s for s in self._history.sessions() if s["updated_at"] >= cutoff]
        snapshot_id = f"snap-{now_ms}"
        dest = self._root / snapshot_id
        dest.mkdir(parents=True, exist_ok=True)
        manifest = {"id": snapshot_id, "created_at": now_ms, "sessions": sessions}
        (dest / "manifest.json").write_text(json.dumps(manifest, indent=2))
        return snapshot_id

    def list(self) -> list[dict[str, Any]]:
        if not self._root.exists():
            return []
        out: list[dict[str, Any]] = []
        for d in sorted(self._root.iterdir()):
            manifest = d / "manifest.json"
            if manifest.is_file():
                data = json.loads(manifest.read_text())
                out.append({"id": data["id"], "created_at": data["created_at"]})
        return out

    def get(self, snapshot_id: str) -> dict[str, Any] | None:
        manifest = self._root / snapshot_id / "manifest.json"
        if not manifest.is_file():
            return None
        return json.loads(manifest.read_text())  # type: ignore[no-any-return]


def restore_command_for(session: dict[str, Any]) -> list[str]:
    """Build the relaunch argv for a session from its runtime. Imported here to
    avoid a hard dependency from the snapshot core on every runtime."""
    from rubberduck.runtimes.claude_code import ClaudeCodeRuntime
    from rubberduck.runtimes.codex import CodexRuntime
    from rubberduck.runtimes.generic import GenericRuntime

    runtime_name = session.get("runtime") or "generic"
    cwd = Path(str(session.get("worktree_path") or session.get("cwd") or "."))
    key = str(session["session_key"])
    if runtime_name == "claude-code":
        return ClaudeCodeRuntime().restore_command(cwd=cwd, session_key=key)
    if runtime_name == "codex":
        return CodexRuntime().restore_command(cwd=cwd, session_key=key)
    return GenericRuntime("true").restore_command(cwd=cwd, session_key=key)


def open_in_terminal(cwd: str, argv: list[str]) -> bool:
    """Open a new terminal in `cwd` running `argv`. Returns True if a terminal
    was spawned, False if we could only fall back to printing the command."""
    command = f"cd {cwd} && {' '.join(argv)}"
    system = platform.system()
    if system == "Darwin":
        script = f'tell app "Terminal" to do script "{command}"'
        return _spawn(["osascript", "-e", script])
    if system == "Linux":
        for term in ("gnome-terminal", "x-terminal-emulator", "xterm"):
            if _spawn([term, "-e", command]):
                return True
    print(f"[rubberduck] to restore, run:\n  {command}")
    return False


def _spawn(argv: list[str]) -> bool:
    try:
        subprocess.Popen(argv, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return True
    except (OSError, FileNotFoundError):
        return False
