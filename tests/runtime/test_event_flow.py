"""Act 1 runtime gate: prove agent-agnosticism. A bare HTTP POST drives the
live stream end to end with no agent runtime involved."""

import asyncio
import json
import urllib.error
import urllib.request
from pathlib import Path

import pytest

from rubberduck.server import SELF_PROBE_HEADER, Server


async def _read_sse_frame(reader: asyncio.StreamReader) -> dict[str, object]:
    """Read lines until a `data:` line, return its parsed JSON."""
    while True:
        line = await asyncio.wait_for(reader.readline(), 2)
        if line.startswith(b"data:"):
            return json.loads(line[len(b"data:") :].strip())


def test_post_event_reaches_sse_subscriber_with_no_agent() -> None:
    async def scenario() -> dict[str, object]:
        server = await asyncio.start_server(Server().handle, "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]
        async with server:
            reader, writer = await asyncio.open_connection("127.0.0.1", port)
            writer.write(b"GET /stream HTTP/1.1\r\nHost: x\r\n\r\n")
            await writer.drain()

            await _read_sse_frame(reader)  # the {type:init} frame

            await asyncio.to_thread(_post_event, port, {"event_type": "Stop", "session_key": "s1"})
            frame = await _read_sse_frame(reader)

            writer.close()
            return frame

    frame = asyncio.run(scenario())
    assert frame["session_key"] == "s1"
    assert frame["event_type"] == "Stop"
    assert "_id" in frame and "_ts" in frame


def test_recent_endpoint_returns_posted_events() -> None:
    async def scenario() -> list[dict[str, object]]:
        server = await asyncio.start_server(Server().handle, "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]
        async with server:
            await asyncio.to_thread(
                _post_event, port, {"event_type": "SessionStart", "session_key": "a"}
            )
            await asyncio.to_thread(_post_event, port, {"event_type": "Stop", "session_key": "a"})
            body = await asyncio.to_thread(_get, port, "/events")
        return list(json.loads(body)["events"])

    events = asyncio.run(scenario())
    assert [e["event_type"] for e in events] == ["SessionStart", "Stop"]


def test_tombstoned_session_events_are_dropped(tmp_path: Path) -> None:
    """A deleted session whose hooks keep firing must not stream phantom events
    that rebuild a ghost row in the dashboard."""
    from rubberduck.persistence.history import HistoryStore

    store = HistoryStore(tmp_path / "db.sqlite")
    store.delete_session("ghost")  # tombstone it (no prior row needed)

    async def scenario() -> list[dict[str, object]]:
        server = await asyncio.start_server(Server(history=store).handle, "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]
        async with server:
            # A live session's events get through.
            await asyncio.to_thread(
                _post_event, port, {"event_type": "PreToolUse", "session_key": "live"}
            )
            # The tombstoned session's events are dropped...
            await asyncio.to_thread(
                _post_event, port, {"event_type": "PreToolUse", "session_key": "ghost"}
            )
            # ...but a SessionStart revives it.
            await asyncio.to_thread(
                _post_event, port, {"event_type": "SessionStart", "session_key": "ghost"}
            )
            body = await asyncio.to_thread(_get, port, "/events")
        return list(json.loads(body)["events"])

    events = asyncio.run(scenario())
    keys_types = [(e.get("session_key"), e["event_type"]) for e in events]
    assert ("live", "PreToolUse") in keys_types
    assert ("ghost", "PreToolUse") not in keys_types  # dropped
    assert ("ghost", "SessionStart") in keys_types  # revived


def test_stop_closes_the_terminal_tab_for_a_launched_session(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A session Rubberduck launched into a terminal tab has no PTY supervisor,
    so stop must fall back to closing the tab by its recorded tty (not 404)."""
    import rubberduck.server as server_mod
    from rubberduck.persistence.history import HistoryStore

    store = HistoryStore(tmp_path / "db.sqlite")
    store.record({"event_type": "SessionStart", "session_key": "tabbed", "_ts": 1, "_id": "a"})
    store.mark_heartbeat("tabbed")
    store.touch("tabbed", 2, tty="/dev/ttys042")

    closed: dict = {}

    def fake_close(tty: str) -> bool:
        closed["tty"] = tty
        return True

    monkeypatch.setattr(server_mod, "close_terminal_by_tty", fake_close)

    async def scenario() -> dict[str, object]:
        server = await asyncio.start_server(Server(history=store).handle, "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]
        async with server:
            body = await asyncio.to_thread(_post, port, "/sessions/tabbed/stop")
        return dict(json.loads(body))

    result = asyncio.run(scenario())
    assert result["stopped"] is True
    assert closed["tty"] == "/dev/ttys042"  # closed the right tab
    # Stop is a resumable pause, not a terminate: state is now 'stopped'.
    assert store.session("tabbed")["state"] == "stopped"


def test_resume_relaunches_a_stopped_session(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Resume reopens a stopped launched session in its saved cwd. For
    claude-code it continues the conversation with the recorded session id."""
    import rubberduck.server as server_mod
    from rubberduck.persistence.history import HistoryStore

    store = HistoryStore(tmp_path / "db.sqlite")
    store.record(
        {
            "event_type": "SessionStart",
            "session_key": "resumable",
            "session_id": "claude-sid-123",
            "runtime": "claude-code",
            "cwd": "/tmp/proj",
            "_ts": 1,
            "_id": "a",
        }
    )
    store.mark_heartbeat("resumable")
    store.set_state("resumable", "stopped", now=2)

    opened: dict = {}

    def fake_open(cwd, argv, **kw):  # type: ignore[no-untyped-def]
        opened["cwd"] = cwd
        opened["argv"] = argv
        return True

    monkeypatch.setattr(server_mod, "open_in_terminal", fake_open)

    async def scenario() -> dict[str, object]:
        server = await asyncio.start_server(Server(history=store).handle, "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]
        async with server:
            body = await asyncio.to_thread(_post, port, "/sessions/resumable/resume")
        return dict(json.loads(body))

    result = asyncio.run(scenario())
    assert result["resumed"] is True
    assert opened["cwd"] == "/tmp/proj"
    assert opened["argv"] == ["claude", "--resume", "claude-sid-123"]
    assert store.session("resumable")["state"] == "busy"


def test_stream_init_omits_deleted_session(tmp_path: Path) -> None:
    """A session's SessionStart can sit in the ring buffer when the session is
    later deleted. The /stream init replay must not include it — otherwise a
    fresh page load (empty client tombstone Set) re-creates the deleted row."""
    from rubberduck.persistence.history import HistoryStore

    store = HistoryStore(tmp_path / "db.sqlite")

    async def scenario() -> dict[str, object]:
        srv = Server(history=store)
        server = await asyncio.start_server(srv.handle, "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]
        async with server:
            # Start two sessions — both land in the ring buffer.
            await asyncio.to_thread(
                _post_event, port, {"event_type": "SessionStart", "session_key": "keep"}
            )
            await asyncio.to_thread(
                _post_event, port, {"event_type": "SessionStart", "session_key": "gone"}
            )
            # Delete one (tombstones it) — but its SessionStart stays in the buffer.
            store.delete_session("gone")

            reader, writer = await asyncio.open_connection("127.0.0.1", port)
            writer.write(b"GET /stream HTTP/1.1\r\nHost: x\r\n\r\n")
            await writer.drain()
            init = await _read_sse_frame(reader)
            writer.close()
        return init

    init = asyncio.run(scenario())
    keys = {e.get("session_key") for e in init["events"]}  # type: ignore[union-attr]
    assert "keep" in keys
    assert "gone" not in keys  # the deleted session must not replay


def test_root_carries_self_probe_header() -> None:
    async def scenario() -> str:
        server = await asyncio.start_server(Server().handle, "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]
        async with server:
            reader, writer = await asyncio.open_connection("127.0.0.1", port)
            writer.write(b"GET / HTTP/1.1\r\nHost: x\r\n\r\n")
            await writer.drain()
            head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 2)
            writer.close()
        return head.decode("latin-1").lower()

    head = asyncio.run(scenario())
    assert SELF_PROBE_HEADER.lower() in head


def test_invalid_json_rejected() -> None:
    async def scenario() -> int:
        server = await asyncio.start_server(Server().handle, "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]
        async with server:
            return await asyncio.to_thread(_post_raw_status, port, b"{not json")

    assert asyncio.run(scenario()) == 400


def _token() -> str:
    from rubberduck.helpers import security

    return security.load_or_create_token()


def _post_event(port: int, payload: dict[str, object]) -> None:
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}/events",
        data=json.dumps(payload).encode(),
        headers={
            "Content-Type": "application/json",
            "X-Rubberduck-Token": _token(),
        },
        method="POST",
    )
    urllib.request.urlopen(req, timeout=2).read()


def _post_raw_status(port: int, body: bytes) -> int:
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}/events",
        data=body,
        headers={"X-Rubberduck-Token": _token()},
        method="POST",
    )
    try:
        return urllib.request.urlopen(req, timeout=2).status
    except urllib.error.HTTPError as e:
        return e.code


def _get(port: int, path: str) -> str:
    return urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=2).read().decode()


def _post(port: int, path: str) -> str:
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}{path}",
        data=b"",
        headers={"X-Rubberduck-Token": _token()},
        method="POST",
    )
    return urllib.request.urlopen(req, timeout=2).read().decode()


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__]))
