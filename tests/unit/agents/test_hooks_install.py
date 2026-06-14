import json
from pathlib import Path

from rubberduck.agents.hooks_install import (
    _EVENTS,
    install,
    settings_path,
    uninstall,
)


def read_settings(project: Path) -> dict:
    return json.loads((project / ".claude" / "settings.json").read_text())


def test_install_creates_settings_with_all_events(tmp_path: Path) -> None:
    install(global_scope=False, project_dir=tmp_path)
    settings = read_settings(tmp_path)
    assert set(settings["hooks"]) == set(_EVENTS)
    # Each event runs the rubberduck hook with its event type + runtime as args.
    cmd = settings["hooks"]["PostToolUse"][0]["hooks"][0]["command"]
    assert "rubberduck-hook.sh" in cmd
    assert cmd.endswith(" PostToolUse claude-code")


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


def test_codex_uses_hooks_json_with_claude_style_shape(tmp_path: Path) -> None:
    path = install(global_scope=False, project_dir=tmp_path, agent="codex")
    assert path == tmp_path / ".codex" / "hooks.json"
    config = json.loads(path.read_text())
    assert set(config["hooks"]) == set(_EVENTS)
    cmd = config["hooks"]["PreToolUse"][0]["hooks"][0]["command"]
    # Codex shares Claude's event names; runtime is tagged as codex.
    assert cmd.endswith(" PreToolUse codex")


def test_copilot_uses_camelcase_events_and_runtime(tmp_path: Path) -> None:
    path = install(global_scope=False, project_dir=tmp_path, agent="copilot")
    assert path == tmp_path / ".github" / "hooks" / "rubberduck.json"
    config = json.loads(path.read_text())
    assert config["version"] == 1
    # Copilot's event keys are camelCase, but the canonical name is passed to
    # the script so the server sees one vocabulary.
    assert "sessionStart" in config["hooks"]
    cmd = config["hooks"]["preToolUse"][0]["command"]
    assert cmd.endswith(" PreToolUse copilot")


def test_uninstall_is_per_agent(tmp_path: Path) -> None:
    install(global_scope=False, project_dir=tmp_path, agent="codex")
    uninstall(global_scope=False, project_dir=tmp_path, agent="codex")
    config = json.loads((tmp_path / ".codex" / "hooks.json").read_text())
    # All rubberduck entries gone; empty hooks block removed.
    assert config.get("hooks", {}) == {}
