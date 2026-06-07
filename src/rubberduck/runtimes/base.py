"""The AgentRuntime contract: what Rubberduck needs to drive any CLI agent.

One implementation per supported agent (generic, claude-code, codex). The core
never imports a concrete runtime — it loads whichever one a session declares.
"""

from pathlib import Path
from typing import Literal, Protocol, runtime_checkable

SessionState = Literal["idle", "busy", "waiting", "terminated"]


@runtime_checkable
class AgentRuntime(Protocol):
    name: str

    def launch_command(self, *, cwd: Path, session_key: str, initial_prompt: str) -> list[str]: ...

    def detect_state(self, recent_output: str) -> SessionState: ...

    def locate_transcript(self, *, cwd: Path, session_id: str) -> Path | None: ...

    def restore_command(self, *, cwd: Path, session_key: str) -> list[str]: ...
