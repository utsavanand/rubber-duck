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


def open_in_terminal(
    cwd: str,
    argv: list[str],
    *,
    app: str | None = None,
    env: dict[str, str] | None = None,
    heartbeat: tuple[str, str] | None = None,
) -> bool:
    """Open a new terminal in `cwd` running `argv`. Returns True if a terminal
    was spawned, False if we could only fall back to printing the command.
    `env` is exported before the command (used to pass RUBBERDUCK_SESSION_KEY so
    the agent's hooks report under Rubberduck's session key). `heartbeat` is
    (url, session_key): the tab pings `url` every 20s while alive so Rubberduck
    can tell a killed tab from a quiet one."""
    exports = "".join(f"export {k}={_q(v)}; " for k, v in (env or {}).items())
    agent = " ".join(_q(a) for a in argv)
    if heartbeat is not None:
        agent = _with_heartbeat(agent, *heartbeat)
    command = f"cd {_q(cwd)} && {exports}{agent}"
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


def close_terminal_by_tty(tty: str, *, app: str | None = None) -> bool:
    """Close the terminal tab whose tty matches (e.g. /dev/ttys003). The tty is
    stable and not clobbered by the agent (unlike the tab title), so this is the
    reliable way to find the tab Rubberduck launched. macOS only."""
    if platform.system() != "Darwin" or not tty:
        return False
    choice = (app or os.environ.get("RUBBERDUCK_TERMINAL") or _default_mac()).lower()
    if choice == "iterm" and _iterm_installed():
        return _spawn(["osascript", "-e", _close_iterm_by_tty(tty)])
    return _spawn(["osascript", "-e", _close_terminal_by_tty(tty)])


def _close_terminal_by_tty(tty: str) -> str:
    esc = _esc(tty)
    return (
        'tell application "Terminal"\n'
        "  repeat with w in windows\n"
        "    repeat with t in tabs of w\n"
        f'      if (tty of t as string) is "{esc}" then\n'
        "        close t\n"
        "        return\n"
        "      end if\n"
        "    end repeat\n"
        "  end repeat\n"
        "end tell"
    )


def _close_iterm_by_tty(tty: str) -> str:
    esc = _esc(tty)
    return (
        'tell application "iTerm"\n'
        "  repeat with w in windows\n"
        "    repeat with t in tabs of w\n"
        "      repeat with s in sessions of t\n"
        f'        if (tty of s as string) is "{esc}" then\n'
        "          close t\n"
        "          return\n"
        "        end if\n"
        "      end repeat\n"
        "    end repeat\n"
        "  end repeat\n"
        "end tell"
    )


def _with_heartbeat(agent: str, url: str, session_key: str) -> str:
    """Wrap the agent command so the tab pings `url` every 20s while alive and
    stops when the agent exits or the tab is killed. The trap kills the loop on
    EXIT; killing the tab takes the whole shell (loop included) down with it."""
    # $(tty) is the tab's device (e.g. /dev/ttys003) — stable and reported on
    # every ping so the server can find and close this exact tab on delete.
    ping = (
        f"curl -s -X POST {_q(url)} -H 'Content-Type: application/json' "
        f'-d "{{\\"session_key\\":\\"{session_key}\\",\\"tty\\":\\"$(tty)\\"}}" '
        ">/dev/null 2>&1"
    )
    return (
        f"( while true; do {ping}; sleep 20; done ) & __rd_hb=$!; "
        f'trap "kill $__rd_hb 2>/dev/null" EXIT; {agent}'
    )


def _default_mac() -> str:
    return "iterm" if _iterm_installed() else "terminal"


def _iterm_installed() -> bool:
    return os.path.isdir("/Applications/iTerm.app") or shutil.which("iterm2") is not None


def _open_terminal(command: str) -> bool:
    # Open as a new TAB in the front Terminal window if one exists (Cmd-T then
    # run); otherwise `do script` makes a fresh window. Activate to bring forward.
    esc = _esc(command)
    script = (
        'tell application "Terminal"\n'
        "  activate\n"
        "  if (count of windows) > 0 then\n"
        '    tell application "System Events" to keystroke "t" using command down\n'
        "    delay 0.2\n"
        f'    do script "{esc}" in front window\n'
        "  else\n"
        f'    do script "{esc}"\n'
        "  end if\n"
        "end tell"
    )
    return _spawn(["osascript", "-e", script])


def _open_iterm(command: str) -> bool:
    # New TAB in the current iTerm window if one is open, else a new window.
    esc = _esc(command)
    script = (
        'tell application "iTerm"\n'
        "  activate\n"
        "  if (count of windows) = 0 then\n"
        "    create window with default profile\n"
        "  else\n"
        "    tell current window to create tab with default profile\n"
        "  end if\n"
        "  tell current session of current window\n"
        f'    write text "{esc}"\n'
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
