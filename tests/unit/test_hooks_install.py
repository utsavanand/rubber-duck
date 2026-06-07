import json
from pathlib import Path

from rubberduck.hooks_install import (
    _HOOK_EVENTS,
    install,
    settings_path,
    uninstall,
)


def read_settings(project: Path) -> dict:
    return json.loads((project / ".claude" / "settings.json").read_text())


def test_install_creates_settings_with_all_events(tmp_path: Path) -> None:
    install(global_scope=False, project_dir=tmp_path)
    settings = read_settings(tmp_path)
    assert set(settings["hooks"]) == set(_HOOK_EVENTS)
    # Each event runs the rubberduck hook with its own event type as the arg.
    cmd = settings["hooks"]["PostToolUse"][0]["hooks"][0]["command"]
    assert "rubberduck-hook.sh" in cmd
    assert cmd.endswith(" PostToolUse")


def test_install_is_idempotent(tmp_path: Path) -> None:
    install(global_scope=False, project_dir=tmp_path)
    install(global_scope=False, project_dir=tmp_path)
    settings = read_settings(tmp_path)
    # Running twice must not duplicate the entry.
    assert len(settings["hooks"]["Stop"]) == 1


def test_install_preserves_existing_user_hooks(tmp_path: Path) -> None:
    claude = tmp_path / ".claude"
    claude.mkdir()
    existing = {
        "hooks": {
            "PostToolUse": [
                {"matcher": "Edit", "hooks": [{"type": "command", "command": "my-linter.sh"}]}
            ]
        }
    }
    (claude / "settings.json").write_text(json.dumps(existing))

    install(global_scope=False, project_dir=tmp_path)
    settings = read_settings(tmp_path)

    commands = [h["command"] for e in settings["hooks"]["PostToolUse"] for h in e["hooks"]]
    assert "my-linter.sh" in commands  # the user's hook survives
    assert any("rubberduck-hook.sh" in c for c in commands)  # ours is added


def test_uninstall_removes_only_rubberduck_hooks(tmp_path: Path) -> None:
    claude = tmp_path / ".claude"
    claude.mkdir()
    existing = {
        "hooks": {
            "PostToolUse": [
                {"matcher": "Edit", "hooks": [{"type": "command", "command": "my-linter.sh"}]}
            ]
        }
    }
    (claude / "settings.json").write_text(json.dumps(existing))

    install(global_scope=False, project_dir=tmp_path)
    uninstall(global_scope=False, project_dir=tmp_path)
    settings = read_settings(tmp_path)

    commands = [h["command"] for e in settings["hooks"]["PostToolUse"] for h in e["hooks"]]
    assert commands == ["my-linter.sh"]  # user's hook intact, ours gone
    # Events that had only rubberduck hooks are removed entirely.
    assert "Stop" not in settings.get("hooks", {})


def test_global_scope_targets_home(tmp_path: Path, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    path = settings_path(global_scope=True, project_dir=Path("/ignored"))
    assert path == tmp_path / ".claude" / "settings.json"
