"""Act 10 runtime gate: snapshot-all, list, fetch, and restore through the
server. Restore returns the relaunch command (terminal spawning itself is
environment-dependent and covered by the open_in_terminal fallback)."""

import asyncio
import json
import urllib.request
from pathlib import Path

from rubberduck.persistence.history import HistoryStore
from rubberduck.server import Server


def _token() -> str:
    from rubberduck.helpers import security

    return security.load_or_create_token()


def _post(port: int, path: str, payload: dict[str, object] | None = None) -> dict[str, object]:
    data = json.dumps(payload or {}).encode()
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}{path}",
        data=data,
        headers={
            "Content-Type": "application/json",
            "X-Rubberduck-Token": _token(),
        },
        method="POST",
    )
    return json.loads(urllib.request.urlopen(req, timeout=5).read())  # type: ignore[no-any-return]


def _get(port: int, path: str) -> dict[str, object]:
    return json.loads(urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=5).read())  # type: ignore[no-any-return]


def test_snapshot_list_and_restore(tmp_path: Path, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    # Don't actually spawn a terminal in CI: force the print fallback.
    monkeypatch.setattr("rubberduck.agents.terminal.platform.system", lambda: "Unknown")
    # Restore resolves the resumable Claude conversation id from the transcript,
    # so seed a fake transcript for this session's cwd under a fake home.
    fake_home = tmp_path / "home"
    cwd = "/repo"
    from rubberduck.runtimes.claude_code import project_slug

    proj = fake_home / ".claude" / "projects" / project_slug(Path(cwd))
    proj.mkdir(parents=True)
    (proj / "claude-conv.jsonl").write_text('{"role":"user","text":"hi"}\n')
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: fake_home))

    async def scenario() -> tuple[dict[str, object], dict[str, object], dict[str, object]]:
        store = HistoryStore(tmp_path / "db.sqlite")
        srv = await asyncio.start_server(Server(history=store).handle, "127.0.0.1", 0)
        port = srv.sockets[0].getsockname()[1]
        async with srv:
            # Seed a claude-code session whose recorded id has a transcript.
            await asyncio.to_thread(
                _post,
                port,
                "/events",
                {
                    "event_type": "SessionStart",
                    "session_key": "s1",
                    "runtime": "claude-code",
                    "session_id": "claude-conv",
                    "cwd": cwd,
                },
            )
            snap = await asyncio.to_thread(_post, port, "/snapshots")
            listing = await asyncio.to_thread(_get, port, "/snapshots")
            restore = await asyncio.to_thread(
                _post, port, f"/snapshots/{snap['id']}/sessions/s1/restore"
            )
        return snap, listing, restore

    snap, listing, restore = asyncio.run(scenario())

    assert snap["id"].startswith("snap-")  # type: ignore[union-attr]
    assert any(s["id"] == snap["id"] for s in listing["snapshots"])  # type: ignore[attr-defined]
    # Restore resolves the real conversation id (claude-conv), not the rd key (s1).
    assert restore["command"] == "claude --resume claude-conv"


def test_restore_resolves_copilot_conversation_id(tmp_path: Path) -> None:
    """Restore must use the harness's own conversation id for --resume, not the
    Rubberduck session_key. For copilot it's read from the recorded session_id."""
    from rubberduck.core.eventbus import EventBus

    store = HistoryStore(tmp_path / "db.sqlite")
    bus = EventBus(sink=store.record)
    bus.publish(
        {
            "event_type": "SessionStart",
            "session_key": "rd-key",
            "runtime": "copilot",
            "session_id": "copilot-conv-123",
        }
    )
    srv = Server(history=store)
    snap_session = {"runtime": "copilot", "session_key": "rd-key", "cwd": "/r"}
    resolved = srv._restore_session_with_resume_id(snap_session)
    assert resolved["session_key"] == "copilot-conv-123"  # not "rd-key"


def test_restore_marks_no_resume_when_no_conversation_id(tmp_path: Path) -> None:
    store = HistoryStore(tmp_path / "db.sqlite")
    srv = Server(history=store)
    # No recorded session_id for this copilot session -> fresh launch.
    resolved = srv._restore_session_with_resume_id(
        {"runtime": "copilot", "session_key": "rd-key", "cwd": "/r"}
    )
    assert resolved.get("_no_resume") is True
