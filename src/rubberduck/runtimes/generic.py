"""The lowest-common-denominator runtime: launch any CLI agent and read coarse
state from its output. State is detected from the line protocol that
fake_agent.py emits and that any agent can opt into by printing the same
markers:

    [busy]            working
    [idle]            done, ready for input
    [waiting] ...     blocked on a human
    [tool] <name>     invoked a tool

Agents that need finer-grained detection get their own adapter (Acts 8+).
locate_transcript returns None, so checkpoints fall back to summarizing the
captured PTY log rather than a structured transcript.
"""

import re
import shlex
from pathlib import Path

from rubberduck.runtimes.base import SessionState

_TOOL = re.compile(r"\[tool\]\s+(\S+)")


class GenericRuntime:
    name = "generic"

    def __init__(self, command: str) -> None:
        """`command` is the agent invocation, e.g. "claude" or
        "python fake_agent.py --delay 0.1"."""
        self._argv = shlex.split(command)

    def launch_command(self, *, cwd: Path, session_key: str, initial_prompt: str) -> list[str]:
        return list(self._argv)

    def detect_state(self, recent_output: str) -> SessionState:
        """Classify by the last recognizable marker in the output window."""
        for line in reversed(recent_output.splitlines()):
            stripped = line.strip()
            if stripped.startswith("[idle]"):
                return "idle"
            if stripped.startswith("[waiting]"):
                return "waiting"
            if stripped.startswith("[busy]") or stripped.startswith("[tool]"):
                return "busy"
        return "busy"

    def tool_in(self, recent_output: str) -> str | None:
        match = _TOOL.search(recent_output)
        return match.group(1) if match else None

    def locate_transcript(self, *, cwd: Path, session_id: str) -> Path | None:
        return None

    def read_transcript(self, *, cwd: Path, session_id: str) -> list[dict[str, str]]:
        return []  # a generic CLI keeps no transcript we can read

    def restore_command(self, *, cwd: Path, session_key: str) -> list[str]:
        return list(self._argv)
