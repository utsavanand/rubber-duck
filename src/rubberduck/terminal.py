"""Open a command in a new terminal window. Used by fork (worktree +
conversation) and snapshot restore so interactive agents land in a real
terminal you can type into.

The terminal app is chosen by:
  1. an explicit `app` argument ("iterm" | "terminal"), else
  2. the RUBBERDUCK_TERMINAL env var, else
  3. iTerm if it's installed, else macOS Terminal.
On Linux it tries the common emulators. Falls back to printing the command.
"""

import os
import platform
import shutil
import subprocess

MAC_TERMINALS = ("iterm", "terminal")


def available_terminals() -> list[str]:
    """Terminal apps we can target on this machine (for a UI picker)."""
    system = platform.system()
    if system == "Darwin":
        out = []
        if _iterm_installed():
            out.append("iterm")
        out.append("terminal")  # always present on macOS
        return out
    if system == "Linux":
        return [t for t in ("gnome-terminal", "x-terminal-emulator", "xterm") if shutil.which(t)]
    return []


def open_in_terminal(cwd: str, argv: list[str], *, app: str | None = None) -> bool:
    """Open a new terminal in `cwd` running `argv`. Returns True if a terminal
    was spawned, False if we could only fall back to printing the command."""
    command = f"cd {_q(cwd)} && {' '.join(_q(a) for a in argv)}"
    system = platform.system()

    if system == "Darwin":
        choice = (app or os.environ.get("RUBBERDUCK_TERMINAL") or _default_mac()).lower()
        if choice == "iterm" and _open_iterm(command):
            return True
        if _open_terminal(command):  # Terminal.app fallback
            return True
    elif system == "Linux":
        for term in available_terminals():
            if _spawn([term, "-e", command]):
                return True

    print(f"[rubberduck] open a terminal and run:\n  {command}")
    return False


def _default_mac() -> str:
    return "iterm" if _iterm_installed() else "terminal"


def _iterm_installed() -> bool:
    return os.path.isdir("/Applications/iTerm.app") or shutil.which("iterm2") is not None


def _open_terminal(command: str) -> bool:
    script = f'tell app "Terminal" to do script "{_esc(command)}"'
    return _spawn(["osascript", "-e", script])


def _open_iterm(command: str) -> bool:
    # Create a new window and run the command in its session.
    script = (
        'tell application "iTerm"\n'
        "  create window with default profile\n"
        "  tell current session of current window\n"
        f'    write text "{_esc(command)}"\n'
        "  end tell\n"
        "end tell"
    )
    return _spawn(["osascript", "-e", script])


def _q(s: str) -> str:
    """Shell-quote a path/arg for the `cd && cmd` string."""
    return "'" + s.replace("'", "'\\''") + "'" if (" " in s or "'" in s) else s


def _esc(s: str) -> str:
    """Escape for embedding inside an AppleScript double-quoted string."""
    return s.replace("\\", "\\\\").replace('"', '\\"')


def _spawn(argv: list[str]) -> bool:
    try:
        subprocess.Popen(argv, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return True
    except (OSError, FileNotFoundError):
        return False
