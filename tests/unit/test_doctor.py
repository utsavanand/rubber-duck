"""rubberduck doctor: each check must FAIL/WARN on a real problem and OK when
fixed. These drive the check functions with controlled paths so they don't
depend on the host's actual install."""

from pathlib import Path

import pytest

from rubberduck import doctor


def test_missing_jq_is_a_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(doctor.shutil, "which", lambda t: None if t == "jq" else "/usr/bin/" + t)
    jq = next(r for r in doctor._check_system_deps() if "jq" in r.title)
    assert jq.status == "fail"
    assert "brew install jq" in jq.detail


def test_all_deps_present_is_ok(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(doctor.shutil, "which", lambda t: "/usr/bin/" + t)
    assert all(r.status == "ok" for r in doctor._check_system_deps())


def test_server_unreachable_is_a_failure() -> None:
    # Port 1 is never listening; the check must report it down with the fix.
    r = doctor._check_server("http://127.0.0.1:1/")
    assert r.status == "fail"
    assert "rubberduck serve" in r.detail


def test_token_missing_is_a_warning(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(doctor.paths, "home", lambda: tmp_path)  # no token file here
    r = doctor._check_token()
    assert r.status == "warn"


def test_token_present_is_ok(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    (tmp_path / "token").write_text("secret")
    monkeypatch.setattr(doctor.paths, "home", lambda: tmp_path)
    assert doctor._check_token().status == "ok"


def test_hook_not_installed_warns(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    missing = tmp_path / "settings.json"  # doesn't exist
    monkeypatch.setattr(doctor, "settings_path", lambda **kw: missing)
    r = doctor._check_hook_installed("claude-code")
    assert r.status == "warn"
    assert "install-hooks --agent claude-code --global" in r.detail


def test_hook_with_current_script_is_ok(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    script = "/abs/path/rubberduck-hook.sh"
    settings = tmp_path / "settings.json"
    settings.write_text('{"hooks": {"PreToolUse": [{"command": "' + script + ' PreToolUse"}]}}')
    monkeypatch.setattr(doctor, "settings_path", lambda **kw: settings)
    monkeypatch.setattr(doctor, "hook_script_path", lambda: Path(script))
    assert doctor._check_hook_installed("claude-code").status == "ok"


def test_codex_async_true_is_flagged_as_failure(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    # The exact bug from the field: codex hooks with async:true are silently skipped.
    script = "/abs/rubberduck-hook.sh"
    settings = tmp_path / "hooks.json"
    settings.write_text('{"hooks":{"PreToolUse":[{"command":"' + script + '","async": true}]}}')
    monkeypatch.setattr(doctor, "settings_path", lambda **kw: settings)
    monkeypatch.setattr(doctor, "hook_script_path", lambda: Path(script))
    r = doctor._check_hook_installed("codex")
    assert r.status == "fail"
    assert "async" in r.title.lower()


def test_hook_pointing_at_old_path_is_failure(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    settings = tmp_path / "settings.json"
    settings.write_text('{"hooks":{"PreToolUse":[{"command":"/old/rubberduck-hook.sh"}]}}')
    monkeypatch.setattr(doctor, "settings_path", lambda **kw: settings)
    monkeypatch.setattr(doctor, "hook_script_path", lambda: Path("/new/rubberduck-hook.sh"))
    r = doctor._check_hook_installed("claude-code")
    assert r.status == "fail"
    assert "reinstall" in r.detail
