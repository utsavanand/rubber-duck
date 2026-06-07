"""Act 2 runtime gate: sessions survive a server restart. Start a server, POST
events, stop it, start a fresh server against the same DB, and confirm
GET /sessions still lists them."""

import asyncio
import json
import urllib.request
from pathlib import Path

from rubberduck.history import HistoryStore
from rubberduck.server import Server


def _post_event(port: int, payload: dict[str, object]) -> None:
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}/events",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    urllib.request.urlopen(req, timeout=2).read()


def _get(port: int, path: str) -> dict[str, object]:
    body = urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=2).read()
    return json.loads(body)  # type: ignore[no-any-return]


def test_sessions_survive_a_restart(tmp_path: Path) -> None:
    db = tmp_path / "db.sqlite"

    async def first_server() -> None:
        store = HistoryStore(db)
        srv = await asyncio.start_server(Server(history=store).handle, "127.0.0.1", 0)
        port = srv.sockets[0].getsockname()[1]
        async with srv:
            await asyncio.to_thread(
                _post_event,
                port,
                {"event_type": "SessionStart", "session_key": "alpha", "cwd": "/a"},
            )
            await asyncio.to_thread(
                _post_event,
                port,
                {"event_type": "SessionStart", "session_key": "beta", "cwd": "/b"},
            )
            await asyncio.to_thread(
                _post_event, port, {"event_type": "SessionEnd", "session_key": "beta"}
            )
        store.close()

    asyncio.run(first_server())

    async def second_server() -> dict[str, object]:
        # A brand-new store + server over the same file — simulates a restart.
        store = HistoryStore(db)
        srv = await asyncio.start_server(Server(history=store).handle, "127.0.0.1", 0)
        port = srv.sockets[0].getsockname()[1]
        async with srv:
            result = await asyncio.to_thread(_get, port, "/sessions")
        store.close()
        return result

    data = asyncio.run(second_server())
    sessions = {s["session_key"]: s for s in data["sessions"]}  # type: ignore[attr-defined]
    assert set(sessions) == {"alpha", "beta"}
    assert sessions["alpha"]["state"] == "busy"
    assert sessions["beta"]["state"] == "terminated"
    assert sessions["beta"]["ended_at"] is not None
