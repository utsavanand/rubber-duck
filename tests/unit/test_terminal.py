from rubberduck import terminal
from rubberduck.terminal import (
    TITLE_PREFIX,
    _close_iterm_script,
    _close_terminal_script,
    _title_command,
    close_terminal,
)


def test_title_command_tags_tab_with_session_key() -> None:
    cmd = _title_command({"RUBBERDUCK_SESSION_KEY": "abc123"})
    # OSC escape that sets the tab title to rubberduck:<key>.
    assert f"{TITLE_PREFIX}abc123" in cmd
    assert cmd.endswith("; ")


def test_title_command_empty_without_a_session_key() -> None:
    assert _title_command(None) == ""
    assert _title_command({"OTHER": "x"}) == ""


def test_close_scripts_target_the_tagged_title() -> None:
    target = f"{TITLE_PREFIX}sess-9"
    term = _close_terminal_script(target)
    iterm = _close_iterm_script(target)
    # Both look up the tab by the title we set, then close it.
    assert target in term and "close t" in term
    assert target in iterm and "close t" in iterm


def test_close_terminal_is_noop_off_macos(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr(terminal.platform, "system", lambda: "Linux")
    assert close_terminal("anything") is False


def test_close_terminal_runs_osascript_on_macos(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr(terminal.platform, "system", lambda: "Darwin")
    monkeypatch.setattr(terminal, "_iterm_installed", lambda: False)
    spawned: dict = {}

    def fake_spawn(argv: list[str]) -> bool:
        spawned["argv"] = argv
        return True

    monkeypatch.setattr(terminal, "_spawn", fake_spawn)

    assert close_terminal("sess-7", app="terminal") is True
    assert spawned["argv"][0] == "osascript"
    assert f"{TITLE_PREFIX}sess-7" in spawned["argv"][-1]
