"""asyncio HTTP/1.1 server.

    POST /events              ingest one JSON event; returns the stamped event
    GET  /events              last 100 events as JSON (polling fallback)
    GET  /sessions            persisted session rows, incl. terminated (SQLite)
    POST /sessions/launch     spawn a supervised agent {command, cwd, ...}
    POST /sessions/:key/stop  terminate a supervised agent
    GET  /stream              SSE: {type:"init", events:[...]} then per-event frames
    GET  /                    liveness; carries the X-Rubberduck self-probe header

Hand-rolled over asyncio rather than a framework: routing is trivial and SSE
wants direct control of the response stream. Zero runtime dependencies.
"""

import asyncio
import json
from typing import Any

from rubberduck.eventbus import Event, EventBus
from rubberduck.history import HistoryStore
from rubberduck.orchestrator import Orchestrator
from rubberduck.runtimes.generic import GenericRuntime

SELF_PROBE_HEADER = "X-Rubberduck"
KEEPALIVE_SECONDS = 15


class Server:
    def __init__(self, bus: EventBus | None = None, history: HistoryStore | None = None) -> None:
        self.history = history if history is not None else HistoryStore()
        self.bus = bus if bus is not None else EventBus(sink=self.history.record)
        self.orchestrator = Orchestrator(self.bus)

    async def handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            request_line = await reader.readline()
            if not request_line:
                return
            method, path = _parse_request_line(request_line)
            headers = await _read_headers(reader)
            body = await _read_body(reader, headers)

            if method == "POST" and path == "/events":
                await self._ingest(writer, body)
            elif method == "GET" and path == "/events":
                await self._recent(writer)
            elif method == "GET" and path == "/sessions":
                await self._sessions(writer)
            elif method == "POST" and path == "/sessions/launch":
                await self._launch(writer, body)
            elif method == "POST" and path.startswith("/sessions/") and path.endswith("/stop"):
                await self._stop(writer, path[len("/sessions/") : -len("/stop")])
            elif method == "GET" and path == "/stream":
                await self._stream(reader, writer)
            elif method == "GET" and path == "/":
                await _write_response(writer, 200, "ok", extra_headers={SELF_PROBE_HEADER: "1"})
            else:
                await _write_response(writer, 404, "not found")
        except (ConnectionResetError, BrokenPipeError, asyncio.IncompleteReadError):
            pass
        finally:
            writer.close()

    async def _ingest(self, writer: asyncio.StreamWriter, body: bytes) -> None:
        try:
            raw: Any = json.loads(body or b"{}")
        except json.JSONDecodeError:
            await _write_json(writer, 400, {"error": "invalid JSON"})
            return
        if not isinstance(raw, dict):
            await _write_json(writer, 400, {"error": "event must be a JSON object"})
            return
        event = self.bus.publish(raw)
        await _write_json(writer, 200, event)

    async def _recent(self, writer: asyncio.StreamWriter) -> None:
        await _write_json(writer, 200, {"events": self.bus.recent()})

    async def _sessions(self, writer: asyncio.StreamWriter) -> None:
        await _write_json(writer, 200, {"sessions": self.history.sessions()})

    async def _launch(self, writer: asyncio.StreamWriter, body: bytes) -> None:
        try:
            req: Any = json.loads(body or b"{}")
        except json.JSONDecodeError:
            await _write_json(writer, 400, {"error": "invalid JSON"})
            return
        command = req.get("command")
        cwd = req.get("cwd")
        if not command or not cwd:
            await _write_json(writer, 400, {"error": "command and cwd are required"})
            return
        key = await self.orchestrator.launch(
            runtime=GenericRuntime(command),
            cwd=cwd,
            session_key=req.get("session_key"),
            prompt=req.get("prompt", ""),
        )
        await _write_json(writer, 200, {"session_key": key})

    async def _stop(self, writer: asyncio.StreamWriter, session_key: str) -> None:
        stopped = await self.orchestrator.stop(session_key)
        status = 200 if stopped else 404
        await _write_json(writer, status, {"stopped": stopped, "session_key": session_key})

    async def _stream(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        writer.write(
            b"HTTP/1.1 200 OK\r\n"
            b"Content-Type: text/event-stream\r\n"
            b"Cache-Control: no-cache\r\n"
            b"Connection: keep-alive\r\n" + f"{SELF_PROBE_HEADER}: 1\r\n\r\n".encode()
        )
        await writer.drain()
        _write_sse(writer, {"type": "init", "events": self.bus.recent()})
        await writer.drain()

        subscription = self.bus.subscribe()
        # An EOF on the client reader means they disconnected; race it against each
        # event wait so we stop promptly instead of blocking until the next keepalive.
        disconnect = asyncio.ensure_future(reader.read())
        try:
            while True:
                nxt = asyncio.ensure_future(subscription.next())
                done, _ = await asyncio.wait(
                    {nxt, disconnect},
                    timeout=KEEPALIVE_SECONDS,
                    return_when=asyncio.FIRST_COMPLETED,
                )
                if disconnect in done:
                    nxt.cancel()
                    break
                if nxt not in done:
                    nxt.cancel()
                    writer.write(b": keepalive\r\n\r\n")
                    await writer.drain()
                    continue
                _write_sse(writer, nxt.result())
                await writer.drain()
        finally:
            disconnect.cancel()
            subscription.close()

    async def serve(self, host: str, port: int) -> None:
        server = await asyncio.start_server(self.handle, host, port)
        async with server:
            await server.serve_forever()


def _parse_request_line(line: bytes) -> tuple[str, str]:
    parts = line.decode("latin-1").split()
    if len(parts) < 2:
        return "", ""
    return parts[0], parts[1]


async def _read_headers(reader: asyncio.StreamReader) -> dict[str, str]:
    headers: dict[str, str] = {}
    while True:
        line = await reader.readline()
        if line in (b"\r\n", b"\n", b""):
            break
        name, _, value = line.decode("latin-1").partition(":")
        headers[name.strip().lower()] = value.strip()
    return headers


async def _read_body(reader: asyncio.StreamReader, headers: dict[str, str]) -> bytes:
    length = int(headers.get("content-length", "0") or "0")
    return await reader.readexactly(length) if length else b""


def _sse_frame(event: Event) -> bytes:
    return f"data: {json.dumps(event)}\n\n".encode()


def _write_sse(writer: asyncio.StreamWriter, event: Event) -> None:
    writer.write(_sse_frame(event))


async def _write_response(
    writer: asyncio.StreamWriter,
    status: int,
    text: str,
    extra_headers: dict[str, str] | None = None,
) -> None:
    body = text.encode()
    head = f"HTTP/1.1 {status} {_REASON.get(status, 'OK')}\r\n"
    head += f"Content-Length: {len(body)}\r\nContent-Type: text/plain\r\n"
    for name, value in (extra_headers or {}).items():
        head += f"{name}: {value}\r\n"
    head += "Connection: close\r\n\r\n"
    writer.write(head.encode() + body)
    await writer.drain()


async def _write_json(writer: asyncio.StreamWriter, status: int, payload: Any) -> None:
    body = json.dumps(payload).encode()
    head = (
        f"HTTP/1.1 {status} {_REASON.get(status, 'OK')}\r\n"
        f"Content-Length: {len(body)}\r\n"
        "Content-Type: application/json\r\n"
        "Connection: close\r\n\r\n"
    )
    writer.write(head.encode() + body)
    await writer.drain()


_REASON = {200: "OK", 400: "Bad Request", 404: "Not Found"}
