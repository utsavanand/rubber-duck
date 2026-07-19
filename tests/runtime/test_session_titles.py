"""Watched-session labeling from iTerm tab titles: the hook reports the agent's
tty on each event; /sessions matches it against the terminal's tab titles and
attaches `terminal_title` for the dashboard label."""

import asyncio
import json
import urllib.request
from pathlib import Path

import rubberduck.server as server_mod
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


def _sessions(port: int) -> list[dict[str, object]]:
    out = urllib.request.urlopen(f"http://127.0.0.1:{port}/sessions", timeout=5).read()
    return json.loads(out)["sessions"]  # type: ignore[no-any-return]


def test_tty_event_yields_terminal_title(tmp_path: Path, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    """A hook event carrying a tty gets its session labeled with the matching
    iTerm tab title; a session on an unknown tty gets no title (folder-name
    fallback stays in charge client-side)."""
    monkeypatch.setattr(
        server_mod, "terminal_titles", lambda: {"/dev/ttys042": "Entourage Sprint 7/18"}
    )

    async def scenario() -> list[dict[str, object]]:
        store = HistoryStore(tmp_path / "db.sqlite")
        srv = await asyncio.start_server(Server(history=store).handle, "127.0.0.1", 0)
        port = srv.sockets[0].getsockname()[1]
        async with srv:
            await asyncio.to_thread(
                _post_event,
                port,
                {
                    "event_type": "SessionStart",
                    "session_key": "titled",
                    "cwd": "/tmp/railway-deploy",
                    "tty": "/dev/ttys042",
                    "test": True,
                },
            )
            await asyncio.to_thread(
                _post_event,
                port,
                {
                    "event_type": "SessionStart",
                    "session_key": "untitled",
                    "cwd": "/tmp/other",
                    "tty": "/dev/ttys099",
                    "test": True,
                },
            )
            return await asyncio.to_thread(_sessions, port)

    rows = {str(r["session_key"]): r for r in asyncio.run(scenario())}
    assert rows["titled"]["tty"] == "/dev/ttys042"
    assert rows["titled"]["terminal_title"] == "Entourage Sprint 7/18"
    assert "terminal_title" not in rows["untitled"]


def test_malformed_tty_is_dropped_at_ingest(tmp_path: Path, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    """The tty is hook-supplied and later matched/injected into AppleScript, so
    anything outside the /dev/tty… shape is discarded, not stored."""
    monkeypatch.setattr(server_mod, "terminal_titles", dict)

    async def scenario() -> list[dict[str, object]]:
        store = HistoryStore(tmp_path / "db.sqlite")
        srv = await asyncio.start_server(Server(history=store).handle, "127.0.0.1", 0)
        port = srv.sockets[0].getsockname()[1]
        async with srv:
            await asyncio.to_thread(
                _post_event,
                port,
                {
                    "event_type": "SessionStart",
                    "session_key": "evil",
                    "cwd": "/tmp/x",
                    "tty": '/dev/ttys003"; do shell script "rm -rf ~"',
                    "test": True,
                },
            )
            await asyncio.to_thread(
                _post_event,
                port,
                {
                    "event_type": "SessionStart",
                    "session_key": "ok",
                    "cwd": "/tmp/y",
                    "tty": "/dev/ttys050",
                    "test": True,
                },
            )
            return await asyncio.to_thread(_sessions, port)

    rows = {str(r["session_key"]): r for r in asyncio.run(scenario())}
    # The well-formed tty persists; the injection attempt is dropped, not stored.
    assert rows["ok"]["tty"] == "/dev/ttys050"
    assert rows["evil"]["tty"] is None
