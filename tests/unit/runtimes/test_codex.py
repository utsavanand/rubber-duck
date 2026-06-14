from pathlib import Path

from rubberduck.runtimes.codex import CodexRuntime


def test_detect_state_from_output_markers() -> None:
    rt = CodexRuntime()
    assert rt.detect_state("Working on it...") == "busy"
    assert rt.detect_state("applying patch to foo.py") == "busy"
    assert rt.detect_state("Allow this command? (y/n)") == "waiting"
    # Settled output with no marker reads as idle.
    assert rt.detect_state("done.\n$ ") == "idle"


def test_waiting_takes_precedence_over_working() -> None:
    rt = CodexRuntime()
    assert rt.detect_state("working\nApprove edit? (y/n)") == "waiting"


def test_launch_appends_prompt() -> None:
    rt = CodexRuntime("codex")
    assert rt.launch_command(cwd=Path("/x"), session_key="s", initial_prompt="add tests") == [
        "codex",
        "add tests",
    ]


def test_codex_has_no_transcript_yet() -> None:
    rt = CodexRuntime()
    assert rt.locate_transcript(cwd=Path("/x"), session_id="s") is None
    assert rt.restore_command(cwd=Path("/x"), session_key="s") == ["codex"]


def test_parse_codex_transcript_extracts_messages(tmp_path):  # type: ignore[no-untyped-def]
    import json

    from rubberduck.runtimes.codex import parse_codex_transcript

    t = tmp_path / "rollout.jsonl"
    t.write_text(
        "\n".join(
            json.dumps(o)
            for o in [
                {"type": "session_meta", "payload": {"id": "x"}},
                {
                    "type": "response_item",
                    "payload": {
                        "type": "message",
                        "role": "user",
                        "content": [{"type": "input_text", "text": "fix the bug"}],
                    },
                },
                {
                    "type": "response_item",
                    "payload": {
                        "type": "message",
                        "role": "assistant",
                        "content": [{"type": "output_text", "text": "Fixed it in store.ts"}],
                    },
                },
                {"type": "event_msg", "payload": {"type": "user_message"}},
            ]
        )
    )
    records = parse_codex_transcript(t)
    assert records == [
        {"role": "user", "text": "fix the bug"},
        {"role": "assistant", "text": "Fixed it in store.ts"},
    ]
