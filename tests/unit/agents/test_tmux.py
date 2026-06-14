import shutil

import pytest

from rubberduck.agents import tmux

_HAS_TMUX = shutil.which("tmux") is not None


def test_target_naming_is_prefixed() -> None:
    assert tmux.target_for("abc123") == "rd_abc123"


def test_has_tmux_matches_path(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(tmux.shutil, "which", lambda _: "/usr/bin/tmux")
    assert tmux.has_tmux() is True
    monkeypatch.setattr(tmux.shutil, "which", lambda _: None)
    assert tmux.has_tmux() is False


@pytest.mark.skipif(not _HAS_TMUX, reason="tmux not installed")
def test_spawn_capture_kill_roundtrip() -> None:
    # A real end-to-end on the dedicated socket so we never touch the user's tmux.
    target = tmux.spawn("test-rt", "echo hello-from-tmux; sleep 5", cwd="/tmp")
    try:
        assert tmux.session_exists(target)
        # capture may be empty until the command prints; just assert it returns a str.
        assert isinstance(tmux.capture_pane(target), str)
    finally:
        assert tmux.kill_session(target)
        assert not tmux.session_exists(target)
