"""Thin wrapper over tmux for persistent, controllable agent sessions.

A tmux-backed session survives the Rubberduck server restarting and gives a
clean way to inject keystrokes (used by the approval workflow). We isolate our
sessions on a dedicated tmux socket so they never collide with the user's own
tmux server.

Ported from uv-suite's watchtower tmux service. All calls are synchronous
subprocess; drive them from async code via asyncio.to_thread.
"""

import shutil
import subprocess

SOCKET = "rubberduck"
_PREFIX = "rd_"


def has_tmux() -> bool:
    return shutil.which("tmux") is not None


def _tmux(*args: str) -> tuple[bool, str]:
    result = subprocess.run(
        ["tmux", "-L", SOCKET, *args],
        capture_output=True,
        text=True,
    )
    return result.returncode == 0, (result.stdout if result.returncode == 0 else result.stderr)


def target_for(session_id: str) -> str:
    return f"{_PREFIX}{session_id}"


def spawn(session_id: str, command: str, cwd: str) -> str:
    """Create a detached tmux session running `command` in `cwd`. Returns the
    tmux target name."""
    target = target_for(session_id)
    _tmux("new-session", "-d", "-s", target, "-c", cwd, command)
    return target


def send_keys(target: str, keys: str, *, enter: bool = True) -> bool:
    args = ["send-keys", "-t", target, keys]
    if enter:
        args.append("Enter")
    ok, _ = _tmux(*args)
    return ok


def send_special(target: str, key: str) -> bool:
    """Send a named key (e.g. 'Escape', 'Enter') without literal interpretation."""
    ok, _ = _tmux("send-keys", "-t", target, key)
    return ok


def capture_pane(target: str) -> str:
    ok, out = _tmux("capture-pane", "-t", target, "-p")
    return out if ok else ""


def kill_session(target: str) -> bool:
    ok, _ = _tmux("kill-session", "-t", target)
    return ok


def session_exists(target: str) -> bool:
    ok, _ = _tmux("has-session", "-t", target)
    return ok
