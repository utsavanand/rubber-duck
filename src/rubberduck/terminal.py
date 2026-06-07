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
    # Tag the tab so we can find and close it later. We set the title from the
    # session key passed via env (RUBBERDUCK_SESSION_KEY), if any.
    title = _title_command(env)
    command = f"cd {_q(cwd)} && {title}{exports}{agent}"
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


TITLE_PREFIX = "rubberduck:"


def _title_command(env: dict[str, str] | None) -> str:
    """Shell to set the tab title to `rubberduck:<key>` so close_terminal can
    find it. Empty when there's no session key to tag with."""
    key = (env or {}).get("RUBBERDUCK_SESSION_KEY")
    if not key:
        return ""
    # OSC 0 sets the window/tab title; printf so it runs before the agent.
    return f'printf "\\033]0;{TITLE_PREFIX}{key}\\007"; '


def close_terminal(session_key: str, *, app: str | None = None) -> bool:
    """Close the terminal tab Rubberduck opened for this session (tagged with
    `rubberduck:<key>` in its title). Returns True if a close was attempted.
    macOS only — no-op elsewhere."""
    if platform.system() != "Darwin":
        return False
    target = f"{TITLE_PREFIX}{session_key}"
    choice = (app or os.environ.get("RUBBERDUCK_TERMINAL") or _default_mac()).lower()
    if choice == "iterm" and _iterm_installed():
        return _spawn(["osascript", "-e", _close_iterm_script(target)])
    return _spawn(["osascript", "-e", _close_terminal_script(target)])


def _close_terminal_script(target: str) -> str:
    esc = _esc(target)
    # Walk Terminal tabs; close the one whose custom title we set. Closing the
    # tab kills the agent running in it.
    return (
        'tell application "Terminal"\n'
        "  repeat with w in windows\n"
        "    repeat with t in tabs of w\n"
        f'      if (custom title of t as string) contains "{esc}" then\n'
        "        close t\n"
        "        return\n"
        "      end if\n"
        "    end repeat\n"
        "  end repeat\n"
        "end tell"
    )


def _close_iterm_script(target: str) -> str:
    esc = _esc(target)
    return (
        'tell application "iTerm"\n'
        "  repeat with w in windows\n"
        "    repeat with t in tabs of w\n"
        "      repeat with s in sessions of t\n"
        f'        if (name of s as string) contains "{esc}" then\n'
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
    ping = (
        f"curl -s -X POST {_q(url)} -H 'Content-Type: application/json' "
        f'-d \'{{"session_key":"{session_key}"}}\' >/dev/null 2>&1'
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
