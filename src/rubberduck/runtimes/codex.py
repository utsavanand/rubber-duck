"""The Codex runtime. Codex is a CLI agent without Claude's hook system, so
state is detected from its terminal output (coarser than Claude's hook-driven
state) and there is no structured transcript locator yet — summaries fall back
to the activity digest.

This adapter exists to prove the boundary: a second real runtime drops in by
implementing the same contract, with zero changes to the core. When Codex gains
a stable transcript/log format worth parsing, add it here; until then, coarse
output-based state is the honest level of support.
"""

import json
import re
import shlex
from pathlib import Path

from rubberduck.agents.hooks_install import claude_style_build, claude_style_strip
from rubberduck.runtimes.base import Harness, HookSpec, SessionState

# Codex prints a spinner/working line while busy and a prompt glyph when idle.
_WORKING = re.compile(r"(working|thinking|running|applying patch)", re.IGNORECASE)
_WAITING = re.compile(r"(allow|approve|\(y/n\)|continue\?)", re.IGNORECASE)


class CodexRuntime(Harness):
    name = "codex"
    # Codex's config is repo-local-unreliable upstream (openai/codex#17532), but
    # the file shape is identical to Claude's, so it reuses the same build/strip.
    hook_spec = HookSpec(
        global_rel=Path(".codex") / "hooks.json",
        repo_rel=Path(".codex") / "hooks.json",
        build=claude_style_build,
        strip=claude_style_strip,
    )

    def __init__(self, command: str = "codex") -> None:
        self._argv = shlex.split(command)

    def launch_command(self, *, cwd: Path, session_key: str, initial_prompt: str) -> list[str]:
        argv = list(self._argv)
        if initial_prompt:
            argv += [initial_prompt]
        return argv

    def detect_state(self, recent_output: str) -> SessionState:
        for line in reversed(recent_output.splitlines()):
            if _WAITING.search(line):
                return "waiting"
            if _WORKING.search(line):
                return "busy"
        # No working/waiting marker in the window: treat as idle (output settled).
        return "idle"

    def tool_in(self, recent_output: str) -> str | None:
        return None

    def locate_transcript(self, *, cwd: Path, session_id: str) -> Path | None:
        # Codex writes one rollout-*.jsonl per session under a date hierarchy,
        # with the session_id (a UUID) in the filename.
        root = Path.home() / ".codex" / "sessions"
        if not root.exists():
            return None
        matches = sorted(root.glob(f"**/rollout-*-{session_id}.jsonl"))
        return matches[-1] if matches else None

    def read_transcript(self, *, cwd: Path, session_id: str) -> list[dict[str, str]]:
        path = self.locate_transcript(cwd=cwd, session_id=session_id)
        return parse_codex_transcript(path) if path else []

    def restore_command(self, *, cwd: Path, session_key: str) -> list[str]:
        return list(self._argv)


def parse_codex_transcript(path: Path) -> list[dict[str, str]]:
    """Read {role, text} records from a Codex rollout JSONL. Messages are
    `response_item` lines whose payload is {type:"message", role, content:[…]};
    each content block carries text under "text". Skips unreadable lines."""
    records: list[dict[str, str]] = []
    for line in path.read_text(errors="replace").splitlines():
        if not line.strip():
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if obj.get("type") != "response_item":
            continue
        payload = obj.get("payload") or {}
        if payload.get("type") != "message":
            continue
        role = payload.get("role")
        text = _codex_text(payload.get("content"))
        if role and text:
            records.append({"role": str(role), "text": text})
    return records


def _codex_text(content: object) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = [
            str(b["text"])
            for b in content
            if isinstance(b, dict) and isinstance(b.get("text"), str)
        ]
        return "\n".join(parts)
    return ""
