"""Overlay identity through the server: the hook forwards the announcement env
vars as event fields; the server validates them, persists them on the session
row, and /sessions resolves the overlay's own session name for the label."""

import asyncio
import json
import urllib.request
from pathlib import Path

from rubberduck.persistence.history import HistoryStore
from rubberduck.server import Server


def _token() -> str:
    from rubberduck.helpers import security

    return security.load_or_create_token()


def _post_event(port: int, payload: dict[str, object]) -> None:
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}/events",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "X-Rubberduck-Token": _token()},
        method="POST",
    )
    urllib.request.urlopen(req, timeout=5)


def _sessions(port: int) -> dict[str, dict[str, object]]:
    out = urllib.request.urlopen(f"http://127.0.0.1:{port}/sessions", timeout=5).read()
    return {str(s["session_key"]): s for s in json.loads(out)["sessions"]}


def test_announced_overlay_resolves_name(tmp_path: Path) -> None:
    project = tmp_path / "proj"
    sessions_dir = project / ".uv-suite-state" / "sessions"
    sessions_dir.mkdir(parents=True)
    (sessions_dir / "uvs-1.json").write_text(json.dumps({"name": "Rails sprint"}))

    async def scenario() -> dict[str, dict[str, object]]:
        store = HistoryStore(tmp_path / "db.sqlite")
        srv = await asyncio.start_server(Server(history=store).handle, "127.0.0.1", 0)
        port = srv.sockets[0].getsockname()[1]
        async with srv:
            await asyncio.to_thread(
                _post_event,
                port,
                {
                    "event_type": "SessionStart",
                    "session_key": "s-announced",
                    "cwd": str(project),
                    "runtime": "claude-code",
                    "overlay": "uv-suite",
                    "overlay_session": "uvs-1",
                    "test": True,
                },
            )
            # Unregistered overlay names and path-traversal session ids are
            # dropped at ingest, never persisted or fed to the adapter.
            await asyncio.to_thread(
                _post_event,
                port,
                {
                    "event_type": "SessionStart",
                    "session_key": "s-bogus",
                    "cwd": str(project),
                    "runtime": "claude-code",
                    "overlay": "not-a-real-overlay",
                    "overlay_session": "../../uvs-1",
                    "test": True,
                },
            )
            return await asyncio.to_thread(_sessions, port)

    rows = asyncio.run(scenario())
    assert rows["s-announced"]["overlay"] == "uv-suite"
    assert rows["s-announced"]["overlay_name"] == "Rails sprint"
    assert rows["s-bogus"]["overlay_session"] is None
    # The bogus row falls through to the probe, which resolves nothing here
    # (no current-session.txt pointer), so no overlay name is attached.
    assert "overlay_name" not in rows["s-bogus"]
