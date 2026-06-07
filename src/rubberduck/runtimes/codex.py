"""The Codex runtime. Codex is a CLI agent without Claude's hook system, so
state is detected from its terminal output (coarser than Claude's hook-driven
state) and there is no structured transcript locator yet — summaries fall back
to the activity digest.

This adapter exists to prove the boundary: a second real runtime drops in by
implementing the same contract, with zero changes to the core. When Codex gains
a stable transcript/log format worth parsing, add it here; until then, coarse
output-based state is the honest level of support.
"""

import re
import shlex
from pathlib import Path

from rubberduck.runtimes.base import SessionState

# Codex prints a spinner/working line while busy and a prompt glyph when idle.
_WORKING = re.compile(r"(working|thinking|running|applying patch)", re.IGNORECASE)
_WAITING = re.compile(r"(allow|approve|\(y/n\)|continue\?)", re.IGNORECASE)


class CodexRuntime:
    name = "codex"

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
        # No stable transcript format to parse yet (see module docstring).
        return None

    def restore_command(self, *, cwd: Path, session_key: str) -> list[str]:
        return list(self._argv)
