from rubberduck.agents import terminal
from rubberduck.agents.terminal import (
    _close_iterm_by_tty,
    _close_terminal_by_tty,
    answer_prompt_by_tty,
    close_terminal_by_tty,
    focus_terminal_by_tty,
    open_in_terminal,
    with_heartbeat,
)


def test_answer_prompt_by_tty_sends_the_right_key(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr(terminal.platform, "system", lambda: "Darwin")
    monkeypatch.setattr(terminal, "_iterm_installed", lambda: False)
    spawned: dict = {}
    monkeypatch.setattr(terminal, "_spawn", lambda argv: spawned.update(argv=argv) or True)

    assert answer_prompt_by_tty("/dev/ttys003", "approve", app="terminal") is True
    assert "/dev/ttys003" in spawned["argv"][-1]
    assert "key code 36" in spawned["argv"][-1]  # Return = accept the default Yes

    assert answer_prompt_by_tty("/dev/ttys003", "deny", app="terminal") is True
    assert "key code 53" in spawned["argv"][-1]  # Escape = cancel


def test_answer_prompt_by_tty_rejects_bad_input(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr(terminal.platform, "system", lambda: "Darwin")
    assert answer_prompt_by_tty("", "approve") is False  # no tty
    assert answer_prompt_by_tty("/dev/ttys003", "maybe") is False  # bad decision


def test_focus_by_tty_runs_osascript_selecting_the_tab(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr(terminal.platform, "system", lambda: "Darwin")
    monkeypatch.setattr(terminal, "_iterm_installed", lambda: False)
    spawned: dict = {}

    def fake_spawn(argv: list[str]) -> bool:
        spawned["argv"] = argv
        return True

    monkeypatch.setattr(terminal, "_spawn", fake_spawn)

    assert focus_terminal_by_tty("/dev/ttys009", app="terminal") is True
    script = spawned["argv"][-1]
    assert "/dev/ttys009" in script
    assert "selected of t to true" in script  # selects the tab, not close
    assert "activate" in script


def test_focus_by_tty_is_noop_without_a_tty(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr(terminal.platform, "system", lambda: "Darwin")
    assert focus_terminal_by_tty("") is False


def test_open_in_terminal_titles_the_tab(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    # The user's session name should name the terminal tab: both via an OSC title
    # escape in the command and the app's own title set in the opener.
    monkeypatch.delenv("RUBBERDUCK_NO_TERMINAL", raising=False)
    monkeypatch.setattr(terminal.platform, "system", lambda: "Darwin")
    monkeypatch.setattr(terminal, "_default_mac", lambda: "iterm")
    monkeypatch.setattr(terminal, "_iterm_installed", lambda: True)
    captured: dict = {}

    def fake_iterm(command: str, title: str | None = None) -> bool:
        captured["command"] = command
        captured["title"] = title
        return True

    monkeypatch.setattr(terminal, "_open_iterm", fake_iterm)

    assert open_in_terminal("/tmp", ["claude"], title="login refactor") is True
    assert captured["title"] == "login refactor"
    # OSC sequence carries the title so even plain shells show it.
    assert "login refactor" in captured["command"]
    assert "\\033]0;" in captured["command"]


def test_no_terminal_env_skips_opening_a_window(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    # Tests/CI set RUBBERDUCK_NO_TERMINAL so launching never spawns a real
    # terminal tab (which would leak past the run). It must not even reach _spawn.
    monkeypatch.setenv("RUBBERDUCK_NO_TERMINAL", "1")
    monkeypatch.setattr(terminal.platform, "system", lambda: "Darwin")

    def boom(_argv: list[str]) -> bool:
        raise AssertionError("opened a terminal despite RUBBERDUCK_NO_TERMINAL")

    monkeypatch.setattr(terminal, "_spawn", boom)

    assert open_in_terminal("/tmp", ["claude"]) is False


def test_heartbeat_reports_tty_so_the_tab_can_be_found() -> None:
    cmd = with_heartbeat("claude", "http://127.0.0.1:4200/heartbeat", "sess-1")
    # The ping carries both the session key and the tab's tty via $(tty).
    assert "sess-1" in cmd
    assert "$(tty)" in cmd
    # The trap still tears down the heartbeat loop on exit.
    assert "trap" in cmd and "claude" in cmd


def test_close_scripts_match_on_tty() -> None:
    term = _close_terminal_by_tty("/dev/ttys003")
    iterm = _close_iterm_by_tty("/dev/ttys003")
    assert "/dev/ttys003" in term and "close t" in term and "tty of t" in term
    assert "/dev/ttys003" in iterm and "close t" in iterm and "tty of s" in iterm


def test_close_by_tty_is_noop_off_macos(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr(terminal.platform, "system", lambda: "Linux")
    assert close_terminal_by_tty("/dev/ttys003") is False


def test_close_by_tty_is_noop_without_a_tty(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr(terminal.platform, "system", lambda: "Darwin")
    assert close_terminal_by_tty("") is False


def test_close_by_tty_runs_osascript_on_macos(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr(terminal.platform, "system", lambda: "Darwin")
    monkeypatch.setattr(terminal, "_iterm_installed", lambda: False)
    spawned: dict = {}

    def fake_spawn(argv: list[str]) -> bool:
        spawned["argv"] = argv
        return True

    monkeypatch.setattr(terminal, "_spawn", fake_spawn)

    assert close_terminal_by_tty("/dev/ttys009", app="terminal") is True
    assert spawned["argv"][0] == "osascript"
    assert "/dev/ttys009" in spawned["argv"][-1]
