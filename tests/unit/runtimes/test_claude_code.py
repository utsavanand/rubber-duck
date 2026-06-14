import json
from pathlib import Path

from rubberduck.runtimes.claude_code import ClaudeCodeRuntime, parse_transcript


def test_launch_appends_prompt() -> None:
    rt = ClaudeCodeRuntime("claude")
    assert rt.launch_command(cwd=Path("/x"), session_key="s", initial_prompt="fix bug") == [
        "claude",
        "fix bug",
    ]


def test_restore_uses_resume_flag() -> None:
    rt = ClaudeCodeRuntime("claude")
    assert rt.restore_command(cwd=Path("/x"), session_key="abc") == ["claude", "--resume", "abc"]


def test_locate_transcript_builds_dashed_path(tmp_path: Path, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    cwd = Path("/Users/dev/myrepo")
    slug = "-Users-dev-myrepo"
    transcript = tmp_path / ".claude" / "projects" / slug / "sess-1.jsonl"
    transcript.parent.mkdir(parents=True)
    transcript.write_text("{}\n")

    rt = ClaudeCodeRuntime()
    # Present session resolves to its file; an unknown one resolves to None.
    assert rt.locate_transcript(cwd=cwd, session_id="sess-1") == transcript
    assert rt.locate_transcript(cwd=cwd, session_id="nope") is None


def test_parse_transcript_handles_string_and_block_content(tmp_path: Path) -> None:
    t = tmp_path / "t.jsonl"
    lines = [
        json.dumps({"message": {"role": "user", "content": "fix the parser"}}),
        json.dumps(
            {
                "message": {
                    "role": "assistant",
                    "content": [
                        {"type": "text", "text": "Looking at it."},
                        {"type": "tool_use", "name": "Edit"},
                    ],
                }
            }
        ),
        "not json — skipped",
        json.dumps({"message": {"role": "assistant", "content": []}}),  # no text -> skipped
    ]
    t.write_text("\n".join(lines))

    records = parse_transcript(t)
    assert records == [
        {"role": "user", "text": "fix the parser"},
        {"role": "assistant", "text": "Looking at it."},
    ]
