import json
from pathlib import Path

from rubberduck.overlays import OVERLAYS, enrich_with_overlay, valid_overlay_session

UV = OVERLAYS["uv-suite"]


def _write_meta(cwd: Path, sid: str, name: str = "Entourage Sprint") -> None:
    sessions = cwd / ".uv-suite-state" / "sessions"
    sessions.mkdir(parents=True)
    (sessions / f"{sid}.json").write_text(
        json.dumps(
            {"uvs_session_id": sid, "name": name, "kind": "long-running", "priority": "high"}
        )
    )


def test_read_session_meta_announced(tmp_path: Path) -> None:
    _write_meta(tmp_path, "abc-123")
    meta = UV.read_session_meta(cwd=tmp_path, overlay_session="abc-123")
    assert meta["name"] == "Entourage Sprint"
    assert meta["priority"] == "high"


def test_read_session_meta_falls_back_to_pointer(tmp_path: Path) -> None:
    _write_meta(tmp_path, "abc-123")
    (tmp_path / ".uv-suite-state" / "current-session.txt").write_text("abc-123\n")
    meta = UV.read_session_meta(cwd=tmp_path, overlay_session=None)
    assert meta["name"] == "Entourage Sprint"


def test_read_session_meta_rejects_traversal_and_garbage(tmp_path: Path) -> None:
    _write_meta(tmp_path, "abc-123")
    # A traversal id must not escape the sessions dir; a name-less or broken
    # meta file yields nothing (the folder-name fallback stays in charge).
    assert UV.read_session_meta(cwd=tmp_path, overlay_session="../../etc/passwd") == {}
    (tmp_path / ".uv-suite-state" / "sessions" / "bad.json").write_text("{not json")
    assert UV.read_session_meta(cwd=tmp_path, overlay_session="bad") == {}
    assert not valid_overlay_session("../../x")
    assert valid_overlay_session("d8a23e86-91da-408c-81bd-1eebf0a305f1")


def test_enrich_probes_unannounced_claude_sessions(tmp_path: Path) -> None:
    """A session that predates the announcement protocol still gets the suite
    name via the pointer probe — but only when the runtime matches the suite's
    base (a codex session in the same cwd is left alone)."""
    _write_meta(tmp_path, "abc-123")
    (tmp_path / ".uv-suite-state" / "current-session.txt").write_text("abc-123")

    row = {"runtime": "claude-code", "cwd": str(tmp_path)}
    enrich_with_overlay(row)
    assert row["overlay"] == "uv-suite"
    assert row["overlay_name"] == "Entourage Sprint"

    codex_row = {"runtime": "codex", "cwd": str(tmp_path)}
    enrich_with_overlay(codex_row)
    assert "overlay_name" not in codex_row


def test_enrich_resolves_announced_overlay(tmp_path: Path) -> None:
    _write_meta(tmp_path, "abc-123")
    row = {
        "runtime": "claude-code",
        "cwd": str(tmp_path),
        "overlay": "uv-suite",
        "overlay_session": "abc-123",
    }
    enrich_with_overlay(row)
    assert row["overlay_name"] == "Entourage Sprint"
