"""The harness registry: the single source of truth for which agents Rubberduck
supports. Each entry is one Harness adapter (in runtimes/) that owns both halves
of an agent's integration:

  - drive   — launch/resume, state detection, transcript reading.
  - observe — its `hook_spec`: where its hook config lives and how to merge/strip
              our entries (None for agents with no hook system).

Onboarding a new agent = implement the Harness contract once and add one entry
here. Everything that asks "what agents exist" (the CLI's --agent choices, the
dashboard agent picker via the server, runtime construction, hook install,
transcript reading for checkpoints) resolves through this registry.
"""

from rubberduck.runtimes.base import AgentRuntime, Harness
from rubberduck.runtimes.claude_code import ClaudeCodeRuntime
from rubberduck.runtimes.codex import CodexRuntime
from rubberduck.runtimes.copilot import CopilotRuntime
from rubberduck.runtimes.generic import GenericRuntime

# name -> adapter class. The class is the factory (called with a command) and
# carries the agent's hook_spec as a class attribute, so installable_agents can
# filter without instantiating.
REGISTRY: dict[str, type[Harness]] = {
    "claude-code": ClaudeCodeRuntime,
    "codex": CodexRuntime,
    "copilot": CopilotRuntime,
    # The lowest-common-denominator: any CLI agent, driven only (no hooks, so
    # not watchable). Not offered as an install-hooks choice.
    "generic": GenericRuntime,
}


def runtime_for(name: str | None, command: str) -> AgentRuntime:
    """Build the drive-adapter for `name` (falling back to generic)."""
    cls = REGISTRY.get(name or "", GenericRuntime)
    return cls(command)


def installable_agents() -> list[str]:
    """Agents that can be wired for watched sessions (have a hook adapter)."""
    return [name for name, cls in REGISTRY.items() if cls.hook_spec is not None]
