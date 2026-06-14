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

    async def scenario() -> tuple[dict[str, object], dict[str, object], dict[str, object]]:
        store = HistoryStore(tmp_path / "db.sqlite")
        srv = await asyncio.start_server(Server(history=store).handle, "127.0.0.1", 0)
        port = srv.sockets[0].getsockname()[1]
        async with srv:
            # Seed a claude-code session via events.
            await asyncio.to_thread(
                _post,
                port,
                "/events",
                {
                    "event_type": "SessionStart",
                    "session_key": "s1",
                    "runtime": "claude-code",
                    "cwd": "/repo",
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
    # Restore builds the claude --resume command for the session.
    assert restore["command"] == "claude --resume s1"
