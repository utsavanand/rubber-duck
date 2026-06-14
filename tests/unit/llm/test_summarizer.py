import os
from collections.abc import Iterator

import pytest

from rubberduck.llm.summarizer import (
    build_prompt,
    mechanical_summary,
    summarize,
)


@pytest.fixture
def clean_env(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    # No env backends AND no auto-detectable agent on PATH, so summarize() takes
    # the true no-backend path.
    for k in ("RUBBERDUCK_SUMMARIZER_CMD", "RUBBERDUCK_SUMMARIZER_URL", "RUBBERDUCK_SUMMARIZER"):
        monkeypatch.delenv(k, raising=False)
    import rubberduck.llm.summarizer as s

    monkeypatch.setattr(s.shutil, "which", lambda _b: None)
    yield


def test_no_backend_returns_empty_none(clean_env: None) -> None:
    result = summarize("anything")
    assert result.backend == "none"
    assert result.text == ""


def test_cli_backend_runs_command(clean_env: None) -> None:
    # A trivial "summarizer" that echoes a fixed line.
    os.environ["RUBBERDUCK_SUMMARIZER_CMD"] = "printf 'did the thing'"
    result = summarize("the prompt")
    assert result.backend == "cli"
    assert result.text == "did the thing"


def test_cli_backend_failure_falls_back_to_none(clean_env: None) -> None:
    os.environ["RUBBERDUCK_SUMMARIZER_CMD"] = "false"
    result = summarize("x")
    assert result.backend == "none"


def test_cli_subprocess_marks_itself_internal(clean_env: None) -> None:
    # The summarizer runs an agent (`claude -p`) which inherits Rubberduck's
    # hooks. Without RUBBERDUCK_INTERNAL the subprocess would report a phantom
    # session back into Rubberduck on every checkpoint. Prove the env reaches it.
    os.environ["RUBBERDUCK_SUMMARIZER_CMD"] = 'printf "%s" "$RUBBERDUCK_INTERNAL"'
    result = summarize("x")
    assert result.backend == "cli"
    assert result.text == "1"


def test_mechanical_summary_states_intent_and_activity() -> None:
    s = mechanical_summary("add login", "5 events; tools used: Edit, Bash.")
    assert "add login" in s
    assert "5 events" in s


def test_mechanical_summary_handles_missing_intent() -> None:
    s = mechanical_summary("", "3 events.")
    assert "no stated intent" in s


def test_build_prompt_includes_all_sections() -> None:
    p = build_prompt("ship feature", "user: hi", "10 events.")
    assert "ship feature" in p
    assert "10 events." in p
    assert "user: hi" in p


def test_auto_detects_installed_agent(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    import rubberduck.llm.summarizer as s

    monkeypatch.delenv("RUBBERDUCK_SUMMARIZER_CMD", raising=False)
    monkeypatch.delenv("RUBBERDUCK_SUMMARIZER_URL", raising=False)
    monkeypatch.delenv("RUBBERDUCK_SUMMARIZER", raising=False)
    # Pretend only codex is installed.
    monkeypatch.setattr(s.shutil, "which", lambda b: "/usr/bin/codex" if b == "codex" else None)
    assert s._auto_command() == "codex exec -"


def test_summarizer_off_disables_autodetect_only(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    import rubberduck.llm.summarizer as s

    # off disables the auto-detect fallback...
    monkeypatch.delenv("RUBBERDUCK_SUMMARIZER_CMD", raising=False)
    monkeypatch.delenv("RUBBERDUCK_SUMMARIZER_URL", raising=False)
    monkeypatch.setenv("RUBBERDUCK_SUMMARIZER", "off")
    monkeypatch.setattr(s.shutil, "which", lambda _b: "/usr/bin/claude")
    assert s.summarize("x").backend == "none"

    # ...but an explicitly-set backend still wins.
    monkeypatch.setenv("RUBBERDUCK_SUMMARIZER_CMD", "printf done")
    assert s.summarize("x").text == "done"
