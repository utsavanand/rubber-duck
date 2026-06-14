"""The Harness contract: one adapter per agent, owning both halves.

  - drive   — launch/resume the agent, classify its state, read its transcript.
  - observe — where its hook config lives and how to merge/strip our entries so a
              watched session streams in. `hook_spec` is None for agents with no
              hook system (driven-only, e.g. the generic runtime).

The core never imports a concrete runtime — it loads whichever one a session
declares, via the registry in harnesses.py. The legacy alias `AgentRuntime` is
kept so existing drive-only callers don't need to change.
"""

from abc import ABC, abstractmethod
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

SessionState = Literal["idle", "busy", "waiting", "terminated", "stopped", "archived"]


@dataclass(frozen=True)
class HookSpec:
    """An agent's observe half: where its hook config lives and how to merge/strip
    Rubberduck's entries. `build` and `strip` operate on the parsed JSON config so
    install/uninstall stay symmetric and idempotent.

    `global_rel` is the config path relative to the user home; `repo_rel` is
    relative to the project dir. Paths are resolved at call time (not import) so
    Path.home() is read live — tests can monkeypatch it."""

    global_rel: Path
    repo_rel: Path
    build: Callable[[dict[str, Any], str, str], dict[str, Any]]
    strip: Callable[[dict[str, Any]], dict[str, Any]]

    def path(self, *, global_scope: bool, project_dir: Path) -> Path:
        if global_scope:
            return Path.home() / self.global_rel
        return project_dir / self.repo_rel


class Harness(ABC):
    name: str
    # An agent's observe half; None for driven-only agents (no hook system).
    hook_spec: HookSpec | None = None

    @abstractmethod
    def __init__(self, command: str) -> None: ...

    @abstractmethod
    def launch_command(self, *, cwd: Path, session_key: str, initial_prompt: str) -> list[str]: ...

    @abstractmethod
    def detect_state(self, recent_output: str) -> SessionState: ...

    @abstractmethod
    def tool_in(self, recent_output: str) -> str | None: ...

    @abstractmethod
    def locate_transcript(self, *, cwd: Path, session_id: str) -> Path | None: ...

    @abstractmethod
    def read_transcript(self, *, cwd: Path, session_id: str) -> list[dict[str, str]]:
        """The session's conversation as uniform {role, text} records (including
        the agent's own responses), newest-last. Empty when unavailable. Each
        runtime reads its native format (JSONL, SQLite, …)."""

    @abstractmethod
    def restore_command(self, *, cwd: Path, session_key: str) -> list[str]: ...


AgentRuntime = Harness
