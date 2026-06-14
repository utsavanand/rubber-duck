"""Wire a coding agent so every session streams into Rubberduck.

`install-hooks` merges Rubberduck's hook entries into the agent's hook config,
tagged so install is idempotent and uninstall removes exactly what we added.
The same shipped hook script (`rubberduck-hook.sh`) is reused for every agent:
each agent's hooks deliver the event JSON on stdin and pass the event type as
$1, and the script POSTs it to the server.

This module owns the JSON-merge logic shared across agents; each agent's own
adapter (in runtimes/) declares which build/strip it uses and where its config
lives, via a `HookSpec`. install/uninstall resolve that spec through the harness
registry, so there's no per-agent table here.

Hook config locations:
  - claude-code: ~/.claude/settings.json (or repo ./.claude/settings.json)
  - codex:       ~/.codex/hooks.json     (repo-local is unreliable upstream;
                 prefer --global — see openai/codex#17532)
  - copilot:     ~/.copilot/hooks/rubberduck.json (or repo .github/hooks/)
"""

import json
from importlib.resources import files
from pathlib import Path
from typing import Any

from rubberduck.runtimes.base import HookSpec

# Canonical event set (Claude's names). Each harness maps these to its own.
_EVENTS = [
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "PostToolUseFailure",
    "PermissionRequest",
    "Notification",
    "Stop",
    "SessionEnd",
]

_MARKER = "rubberduck"  # present in our command string so we can find/remove it

# The pre-exec permission event must BLOCK so the hook can long-poll Rubberduck
# for the user's decision and return it to the agent (the dashboard becomes the
# approval authority). All other events stay fire-and-forget. Timeout must exceed
# the hook's poll cap (~180s) so the agent waits for a real answer.
_BLOCKING_EVENT = "PermissionRequest"
_BLOCKING_TIMEOUT = 200


def hook_script_path() -> Path:
    """Absolute path to the shipped hook script (works from an installed wheel)."""
    return Path(str(files("rubberduck").joinpath("hooks/rubberduck-hook.sh")))


def _is_ours(command: str) -> bool:
    return _MARKER in command


# ── claude-code & codex: identical {hooks: {Event: [{matcher, hooks:[…]}]}} ──


def claude_style_build(config: dict[str, Any], script: str, runtime: str) -> dict[str, Any]:
    # Codex shares the file shape but does NOT support the `async` key — it skips
    # any hook that has one ("async hooks are not supported yet"). So for codex we
    # omit `async` entirely (its hooks run synchronously, bounded by `timeout`);
    # codex also has no blocking-approval support, so there's no blocking event.
    supports_async = runtime != "codex"
    hooks: dict[str, Any] = config.setdefault("hooks", {})
    for event in _EVENTS:
        entries = hooks.setdefault(event, [])
        entries[:] = [e for e in entries if not _claude_entry_is_ours(e)]
        blocking = supports_async and event == _BLOCKING_EVENT
        hook: dict[str, Any] = {
            "type": "command",
            "command": f'"{script}" {event} {runtime}',
            "timeout": _BLOCKING_TIMEOUT if blocking else 5,
        }
        if supports_async:
            # The permission event blocks (waits for the dashboard's decision);
            # everything else is fire-and-forget.
            hook["async"] = not blocking
        entries.append({"matcher": "*", "hooks": [hook]})
    return config


def _claude_entry_is_ours(entry: dict[str, Any]) -> bool:
    return any(_is_ours(h.get("command", "")) for h in entry.get("hooks", []))


def claude_style_strip(config: dict[str, Any]) -> dict[str, Any]:
    hooks: dict[str, Any] = config.get("hooks", {})
    for event in list(hooks):
        hooks[event] = [e for e in hooks[event] if not _claude_entry_is_ours(e)]
        if not hooks[event]:
            del hooks[event]
    if not hooks:
        config.pop("hooks", None)
    return config


# ── copilot: {version, hooks: {camelEvent: [{type, bash, command}]}} ──

# Copilot uses camelCase event names; map our canonical names to theirs. We pass
# the CANONICAL name as $1 to the script so the server sees one vocabulary.
_COPILOT_EVENTS = {
    "SessionStart": "sessionStart",
    "UserPromptSubmit": "userPromptSubmitted",
    "PreToolUse": "preToolUse",
    "PostToolUse": "postToolUse",
    "PostToolUseFailure": "postToolUseFailure",
    "PermissionRequest": "permissionRequest",
    "Notification": "notification",
    "Stop": "agentStop",
    "SessionEnd": "sessionEnd",
}


def copilot_build(config: dict[str, Any], script: str, runtime: str) -> dict[str, Any]:
    config.setdefault("version", 1)
    hooks: dict[str, Any] = config.setdefault("hooks", {})
    for canonical, cop_event in _COPILOT_EVENTS.items():
        entries = hooks.setdefault(cop_event, [])
        entries[:] = [e for e in entries if not _is_ours(e.get("command", "") + e.get("bash", ""))]
        entries.append(
            {
                "type": "command",
                # `command` is Copilot's cross-platform fallback; pass the
                # canonical event name (so the server's vocabulary is uniform)
                # and the runtime so events are attributed to copilot.
                "command": f'"{script}" {canonical} {runtime}',
                "timeoutSec": 5,
            }
        )
    return config


def copilot_strip(config: dict[str, Any]) -> dict[str, Any]:
    hooks: dict[str, Any] = config.get("hooks", {})
    for event in list(hooks):
        hooks[event] = [
            e for e in hooks[event] if not _is_ours(e.get("command", "") + e.get("bash", ""))
        ]
        if not hooks[event]:
            del hooks[event]
    if not hooks:
        config.pop("hooks", None)
        config.pop("version", None)
    return config


def _load(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    return json.loads(path.read_text())  # type: ignore[no-any-return]


def _spec(agent: str) -> tuple[str, HookSpec]:
    from rubberduck.harnesses import REGISTRY

    runtime = REGISTRY[agent]
    if runtime.hook_spec is None:
        raise ValueError(f"agent {agent!r} has no hook system to install")
    return runtime.name, runtime.hook_spec


def settings_path(*, global_scope: bool, project_dir: Path, agent: str = "claude-code") -> Path:
    _, spec = _spec(agent)
    return spec.path(global_scope=global_scope, project_dir=project_dir)


def install(*, global_scope: bool, project_dir: Path, agent: str = "claude-code") -> Path:
    name, spec = _spec(agent)
    path = spec.path(global_scope=global_scope, project_dir=project_dir)
    config = spec.build(_load(path), str(hook_script_path()), name)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(config, indent=2) + "\n")
    return path


def uninstall(*, global_scope: bool, project_dir: Path, agent: str = "claude-code") -> Path:
    _, spec = _spec(agent)
    path = spec.path(global_scope=global_scope, project_dir=project_dir)
    if not path.exists():
        return path
    config = spec.strip(_load(path))
    path.write_text(json.dumps(config, indent=2) + "\n")
    return path
