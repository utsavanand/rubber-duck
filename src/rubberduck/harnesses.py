"""The harness registry: the single source of truth for which agents Rubberduck
supports. Each entry ties together an agent's two adapter halves:

  - drive   — the AgentRuntime (runtimes/) used when Rubberduck launches it.
  - observe — the install Harness (agents/hooks_install) used to wire its hooks
              so a watched session streams in.

Onboarding a new agent = add one HarnessSpec here. Everything that asks "what
agents exist" (the CLI's --agent choices, the dashboard agent picker via the
server, runtime construction, transcript reading for checkpoints) resolves
through this registry, so there's no second place to update.

This is the first step of the unification in docs/architecture.md: one registry
now; collapsing the two protocols into a single Harness interface comes next.
"""

from collections.abc import Callable
from dataclasses import dataclass

from rubberduck.agents import hooks_install
from rubberduck.runtimes.base import AgentRuntime
from rubberduck.runtimes.claude_code import ClaudeCodeRuntime
from rubberduck.runtimes.codex import CodexRuntime
from rubberduck.runtimes.copilot import CopilotRuntime
from rubberduck.runtimes.generic import GenericRuntime


@dataclass(frozen=True)
class HarnessSpec:
    """One supported agent. `runtime_factory` builds its drive-adapter from a
    command; `hook_harness` is its observe-adapter (None for agents with no hook
    system — they can be launched/driven but not watched)."""

    name: str
    runtime_factory: Callable[[str], AgentRuntime]
    hook_harness: hooks_install.Harness | None

    def runtime(self, command: str) -> AgentRuntime:
        return self.runtime_factory(command)


REGISTRY: dict[str, HarnessSpec] = {
    "claude-code": HarnessSpec(
        name="claude-code",
        runtime_factory=ClaudeCodeRuntime,
        hook_harness=hooks_install.HARNESSES["claude-code"],
    ),
    "codex": HarnessSpec(
        name="codex",
        runtime_factory=CodexRuntime,
        hook_harness=hooks_install.HARNESSES["codex"],
    ),
    "copilot": HarnessSpec(
        name="copilot",
        runtime_factory=CopilotRuntime,
        hook_harness=hooks_install.HARNESSES["copilot"],
    ),
    # The lowest-common-denominator: any CLI agent, driven only (no hooks, so
    # not watchable). Not offered as an install-hooks choice.
    "generic": HarnessSpec(
        name="generic",
        runtime_factory=GenericRuntime,
        hook_harness=None,
    ),
}


def runtime_for(name: str | None, command: str) -> AgentRuntime:
    """Build the drive-adapter for `name` (falling back to generic)."""
    spec = REGISTRY.get(name or "", REGISTRY["generic"])
    return spec.runtime(command)


def installable_agents() -> list[str]:
    """Agents that can be wired for watched sessions (have a hook adapter)."""
    return [name for name, spec in REGISTRY.items() if spec.hook_harness is not None]
