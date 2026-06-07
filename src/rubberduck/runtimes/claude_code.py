"""The Claude Code runtime: the richest adapter, because Claude emits structured
hook events and writes a JSONL transcript.

Two things this adds over the generic runtime:

1. Transcript location + parsing. Claude writes the session transcript to
   ~/.claude/projects/<cwd-with-/-as-->/<session_id>.jsonl. Locating and parsing
   it gives the summarizer the real conversation instead of just the PTY log.

2. State from hook events rather than scraped output. In practice Claude Code's
   hooks POST events straight to /events (the claude-code ingest adapter), so the
   server already classifies state via derive_state. detect_state here is only a
   fallback for when this runtime is PTY-supervised without hooks wired.

This is the one place we consciously special-case a single agent (design §4.1);
every other runtime path stays generic.
"""

import json
import shlex
from pathlib import Path

from rubberduck.runtimes.base import SessionState


class ClaudeCodeRuntime:
    name = "claude-code"

    def __init__(self, command: str = "claude") -> None:
        self._argv = shlex.split(command)

    def launch_command(self, *, cwd: Path, session_key: str, initial_prompt: str) -> list[str]:
        argv = list(self._argv)
        if initial_prompt:
            argv += [initial_prompt]
        return argv

    def detect_state(self, recent_output: str) -> SessionState:
        # Fallback only; the hook adapter normally drives state. Treat a trailing
        # prompt-for-input marker as waiting, otherwise assume busy.
        if "│ Do you want" in recent_output or "❯" in recent_output:
            return "waiting"
        return "busy"

    def tool_in(self, recent_output: str) -> str | None:
        return None

    def locate_transcript(self, *, cwd: Path, session_id: str) -> Path | None:
        slug = str(cwd.resolve()).replace("/", "-")
        path = Path.home() / ".claude" / "projects" / slug / f"{session_id}.jsonl"
        return path if path.exists() else None

    def restore_command(self, *, cwd: Path, session_key: str) -> list[str]:
        return [*self._argv, "--resume", session_key]


def parse_transcript(path: Path) -> list[dict[str, str]]:
    """Yield {role, text} records from a Claude JSONL transcript. Tolerates the
    several message shapes Claude has used (string content, or a list of content
    blocks with text parts); skips lines it can't read rather than failing."""
    records: list[dict[str, str]] = []
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        message = obj.get("message", obj)
        role = message.get("role")
        text = _extract_text(message.get("content"))
        if role and text:
            records.append({"role": str(role), "text": text})
    return records


def _extract_text(content: object) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = [
            block["text"]
            for block in content
            if isinstance(block, dict) and block.get("type") == "text" and "text" in block
        ]
        return "\n".join(parts)
    return ""
