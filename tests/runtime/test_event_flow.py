"""Act 1 runtime gate: prove agent-agnosticism. A bare HTTP POST drives the
live stream end to end with no agent runtime involved."""

import asyncio
import json
import urllib.error
import urllib.request

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


def _post_event(port: int, payload: dict[str, object]) -> None:
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}/events",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    urllib.request.urlopen(req, timeout=2).read()


def _post_raw_status(port: int, body: bytes) -> int:
    req = urllib.request.Request(f"http://127.0.0.1:{port}/events", data=body, method="POST")
    try:
        return urllib.request.urlopen(req, timeout=2).status
    except urllib.error.HTTPError as e:
        return e.code


def _get(port: int, path: str) -> str:
    return urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=2).read().decode()


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__]))
