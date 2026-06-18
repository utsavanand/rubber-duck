"""Structured message parsing for the HTML/pagination views: parse_messages
keeps message identity and ordered content blocks (text/tool_use/tool_result),
unlike the flat parse_transcript used by the summarizer."""

import json
import tempfile
from pathlib import Path

from rubberduck.runtimes.claude_code import parse_messages


def _transcript(lines: list[dict]) -> Path:
    f = Path(tempfile.mkdtemp()) / "t.jsonl"
    f.write_text("\n".join(json.dumps(line) for line in lines))
    return f


def test_parse_messages_keeps_blocks_and_skips_bookkeeping() -> None:
    path = _transcript(
        [
            {"type": "mode"},  # bookkeeping — skipped
            {"type": "user", "message": {"role": "user", "content": "hi"}},
            {
                "type": "assistant",
                "message": {"role": "assistant", "content": [{"type": "text", "text": "hello"}]},
            },
            {
                "type": "assistant",
                "message": {
                    "role": "assistant",
                    "content": [{"type": "tool_use", "name": "Bash", "input": {"cmd": "ls"}}],
                },
            },
            {"type": "ai-title"},  # bookkeeping — skipped
        ]
    )
    msgs = parse_messages(path)

    assert [m["role"] for m in msgs] == ["user", "assistant", "assistant"]
    assert msgs[0]["blocks"] == [{"type": "text", "text": "hi"}]
    assert msgs[1]["blocks"] == [{"type": "text", "text": "hello"}]
    assert msgs[2]["blocks"][0]["type"] == "tool_use"
    assert msgs[2]["blocks"][0]["name"] == "Bash"
    # ids are stable line indices (used as annotation anchors).
    assert msgs[0]["id"] == 1 and msgs[1]["id"] == 2
