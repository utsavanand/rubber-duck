import os
from collections.abc import Iterator
from pathlib import Path

import pytest

from rubberduck.checkpoints import build_checkpoint


@pytest.fixture(autouse=True)
def no_summarizer() -> Iterator[None]:
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


def events() -> list[dict]:
    return [
        {"event_type": "UserPromptSubmit", "prompt": "add a login form"},
        {"event_type": "PreToolUse", "tool_name": "Edit", "tool_input": {"file_path": "login.tsx"}},
        {"event_type": "PreToolUse", "tool_name": "Edit", "tool_input": {"file_path": "login.tsx"}},
        {"event_type": "PreToolUse", "tool_name": "Bash", "tool_input": {"command": "npm test"}},
        {"event_type": "UserPromptSubmit", "prompt": "now add validation"},
    ]


def test_checkpoint_captures_prompts_files_tools(tmp_path: Path) -> None:
    cp = build_checkpoint(
        session_key="s1",
        label="manual",
        cwd=tmp_path,
        events=events(),
        intention="build auth",
        now_ms=1000,
    )
    r = cp.record
    assert r["prompts"] == ["add a login form", "now add validation"]
    assert r["files"] == [{"path": "login.tsx", "edits": 2}]
    assert {"tool": "Edit", "count": 2} in r["tools"]
    assert r["event_count"] == 5


def test_checkpoint_records_git_state(git_repo: Path, tmp_path: Path) -> None:
    cp = build_checkpoint(
        session_key="s1",
        label="m",
        cwd=git_repo,
        events=events(),
        intention="",
        now_ms=1000,
    )
    assert cp.record["git"] is True
    assert cp.record["repo"] == git_repo.name
    assert cp.record["branch"] in ("main", "master")


def test_checkpoint_notes_non_git_dir(tmp_path: Path) -> None:
    plain = tmp_path / "plain"
    plain.mkdir()
    cp = build_checkpoint(session_key="s1", label="m", cwd=plain, events=[], intention="", now_ms=1)
    assert cp.record["git"] is False
    assert cp.record["path"] == str(plain)


def test_mechanical_summary_when_no_llm(tmp_path: Path) -> None:
    cp = build_checkpoint(
        session_key="s1",
        label="m",
        cwd=tmp_path,
        events=events(),
        intention="build auth",
        now_ms=1,
    )
    # No summarizer configured -> mechanical fallback mentioning intent + activity.
    assert "build auth" in cp.summary
    assert "5 events" in cp.summary


def test_checkpoint_writes_markdown(tmp_path: Path) -> None:
    cp = build_checkpoint(
        session_key="s1",
        label="m",
        cwd=tmp_path,
        events=events(),
        intention="build auth",
        now_ms=1,
    )
    assert cp.markdown_path is not None
    md = Path(cp.markdown_path).read_text()
    assert "add a login form" in md
    assert "login.tsx" in md
    assert (tmp_path / ".rubberduck" / "checkpoints" / "s1" / "latest.md").is_file()
