"""Wire a coding agent so every session streams into Rubberduck.

`install-hooks` merges Rubberduck's hook entries into the agent's hook config,
tagged so install is idempotent and uninstall removes exactly what we added.
The same shipped hook script (`rubberduck-hook.sh`) is reused for every agent:
each agent's hooks deliver the event JSON on stdin and pass the event type as
$1, and the script POSTs it to the server.

Supported agents (each is a Harness below):
  - claude-code: ~/.claude/settings.json (or repo ./.claude/settings.json)
  - codex:       ~/.codex/hooks.json     (repo-local is unreliable upstream;
                 prefer --global — see openai/codex#17532)
  - copilot:     ~/.copilot/hooks/rubberduck.json (or repo .github/hooks/)

All three use a JSON config and deliver event JSON on stdin, so the hook script
is shared; only the config shape and event names differ per harness.
"""

import json
from collections.abc import Callable
from dataclasses import dataclass
from importlib.resources import files
from pathlib import Path
from typing import Any

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


def hook_script_path() -> Path:
    """Absolute path to the shipped hook script (works from an installed wheel)."""
    return Path(str(files("rubberduck").joinpath("hooks/rubberduck-hook.sh")))


@dataclass(frozen=True)
class Harness:
    """One supported agent: where its hook config lives and how to merge/strip
    Rubberduck's entries. `build` and `strip` operate on the parsed JSON config
    so install/uninstall stay symmetric and idempotent.

    `global_rel` is the config path relative to the user home; `repo_rel` is
    relative to the project dir. Paths are resolved at call time (not import) so
    Path.home() is read live — tests can monkeypatch it."""

    name: str
    global_rel: Path
    repo_rel: Path
    build: Callable[[dict[str, Any], str, str], dict[str, Any]]
    strip: Callable[[dict[str, Any]], dict[str, Any]]

    def path(self, *, global_scope: bool, project_dir: Path) -> Path:
        if global_scope:
            return Path.home() / self.global_rel
        return project_dir / self.repo_rel


def _is_ours(command: str) -> bool:
    return _MARKER in command


# ── claude-code & codex: identical {hooks: {Event: [{matcher, hooks:[…]}]}} ──


def _claude_style_build(config: dict[str, Any], script: str, runtime: str) -> dict[str, Any]:
    hooks: dict[str, Any] = config.setdefault("hooks", {})
    for event in _EVENTS:
        entries = hooks.setdefault(event, [])
        entries[:] = [e for e in entries if not _claude_entry_is_ours(e)]
        entries.append(
            {
                "matcher": "*",
                "hooks": [
                    {
                        "type": "command",
                        "command": f'"{script}" {event} {runtime}',
                        "timeout": 5,
                        "async": True,
                    }
                ],
            }
        )
    return config


def _claude_entry_is_ours(entry: dict[str, Any]) -> bool:
    return any(_is_ours(h.get("command", "")) for h in entry.get("hooks", []))


def _claude_style_strip(config: dict[str, Any]) -> dict[str, Any]:
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


def _copilot_build(config: dict[str, Any], script: str, runtime: str) -> dict[str, Any]:
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


def _copilot_strip(config: dict[str, Any]) -> dict[str, Any]:
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


HARNESSES: dict[str, Harness] = {
    "claude-code": Harness(
        name="claude-code",
        global_rel=Path(".claude") / "settings.json",
        repo_rel=Path(".claude") / "settings.json",
        build=_claude_style_build,
        strip=_claude_style_strip,
    ),
    "codex": Harness(
        name="codex",
        global_rel=Path(".codex") / "hooks.json",
        repo_rel=Path(".codex") / "hooks.json",
        build=_claude_style_build,
        strip=_claude_style_strip,
    ),
    "copilot": Harness(
        name="copilot",
        global_rel=Path(".copilot") / "hooks" / "rubberduck.json",
        repo_rel=Path(".github") / "hooks" / "rubberduck.json",
        build=_copilot_build,
        strip=_copilot_strip,
    ),
}


def _load(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    return json.loads(path.read_text())  # type: ignore[no-any-return]


def settings_path(*, global_scope: bool, project_dir: Path, agent: str = "claude-code") -> Path:
    return HARNESSES[agent].path(global_scope=global_scope, project_dir=project_dir)


def install(*, global_scope: bool, project_dir: Path, agent: str = "claude-code") -> Path:
    harness = HARNESSES[agent]
    path = harness.path(global_scope=global_scope, project_dir=project_dir)
    config = harness.build(_load(path), str(hook_script_path()), harness.name)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(config, indent=2) + "\n")
    return path


def uninstall(*, global_scope: bool, project_dir: Path, agent: str = "claude-code") -> Path:
    harness = HARNESSES[agent]
    path = harness.path(global_scope=global_scope, project_dir=project_dir)
    if not path.exists():
        return path
    config = harness.strip(_load(path))
    path.write_text(json.dumps(config, indent=2) + "\n")
    return path
