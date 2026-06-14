import os
from collections.abc import Iterator

import pytest

from rubberduck.llm.summarizer import (
    build_prompt,
    mechanical_summary,
    summarize,
)


@pytest.fixture
def clean_env() -> Iterator[None]:
    saved = {
        k: os.environ.pop(k, None)
        for k in ("RUBBERDUCK_SUMMARIZER_CMD", "RUBBERDUCK_SUMMARIZER_URL")
    }
    try:
        yield
    finally:
        for k, v in saved.items():
            if v is not None:
                os.environ[k] = v


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
