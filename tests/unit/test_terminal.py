from rubberduck.agents import terminal
from rubberduck.agents.terminal import (
    _close_iterm_by_tty,
    _close_terminal_by_tty,
    _with_heartbeat,
    close_terminal_by_tty,
)


def test_heartbeat_reports_tty_so_the_tab_can_be_found() -> None:
    cmd = _with_heartbeat("claude", "http://127.0.0.1:4200/heartbeat", "sess-1")
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
