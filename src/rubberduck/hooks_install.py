"""Wire Claude Code so every session streams into Rubberduck.

`install-hooks` merges Rubberduck's hook entries into a Claude settings.json
(project-level ./.claude/settings.json, or --global ~/.claude/settings.json).
Each Rubberduck entry is tagged so install is idempotent and uninstall removes
exactly what we added, leaving any other hooks untouched.

The events we forward match what the dashboard renders: session lifecycle
(SessionStart/Stop), prompts, tool use, permission/notification, failures.
"""

import json
from importlib.resources import files
from pathlib import Path
from typing import Any

# The hook events we subscribe to, mapped to the event_type we forward.
_HOOK_EVENTS = [
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


def _rubberduck_entry(event: str, script: str) -> dict[str, Any]:
    return {
        "matcher": "*",
        "hooks": [
            {
                "type": "command",
                "command": f'"{script}" {event}',
                "timeout": 5,
                "async": True,
            }
        ],
    }


def _is_rubberduck_entry(entry: dict[str, Any]) -> bool:
    return any(_MARKER in h.get("command", "") for h in entry.get("hooks", []))


def settings_path(*, global_scope: bool, project_dir: Path) -> Path:
    if global_scope:
        return Path.home() / ".claude" / "settings.json"
    return project_dir / ".claude" / "settings.json"


def _load(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    return json.loads(path.read_text())  # type: ignore[no-any-return]


def install(*, global_scope: bool, project_dir: Path) -> Path:
    path = settings_path(global_scope=global_scope, project_dir=project_dir)
    settings = _load(path)
    hooks: dict[str, Any] = settings.setdefault("hooks", {})
    script = str(hook_script_path())

    for event in _HOOK_EVENTS:
        entries = hooks.setdefault(event, [])
        # Drop any prior Rubberduck entry for this event, then add a fresh one.
        entries[:] = [e for e in entries if not _is_rubberduck_entry(e)]
        entries.append(_rubberduck_entry(event, script))

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(settings, indent=2) + "\n")
    return path


def uninstall(*, global_scope: bool, project_dir: Path) -> Path:
    path = settings_path(global_scope=global_scope, project_dir=project_dir)
    if not path.exists():
        return path
    settings = _load(path)
    hooks: dict[str, Any] = settings.get("hooks", {})
    for event in list(hooks):
        hooks[event] = [e for e in hooks[event] if not _is_rubberduck_entry(e)]
        if not hooks[event]:
            del hooks[event]
    if not hooks:
        settings.pop("hooks", None)
    path.write_text(json.dumps(settings, indent=2) + "\n")
    return path
