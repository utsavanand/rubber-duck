"""The /agents-md endpoints read and write a folder's AGENTS.md — the shared,
cross-agent instructions for that directory. Verified through real HTTP."""

import asyncio
import json
from pathlib import Path

from rubberduck.persistence.history import HistoryStore
from rubberduck.server import Server


async def _request(port: int, raw: bytes) -> tuple[int, dict]:
    reader, writer = await asyncio.open_connection("127.0.0.1", port)
    writer.write(raw)
    await writer.drain()
    head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 2)
    status = int(head.split(b"\r\n")[0].split()[1])
    length = 0
    for line in head.split(b"\r\n"):
        if line.lower().startswith(b"content-length:"):
            length = int(line.split(b":")[1])
    body = await asyncio.wait_for(reader.readexactly(length), 2) if length else b"{}"
    writer.close()
    return status, json.loads(body)


def test_write_then_read_agents_md(tmp_path: Path) -> None:
    async def scenario() -> tuple[dict, dict, str]:
        store = HistoryStore(tmp_path / "db.sqlite")
        server = Server(history=store)
        token = server.token
        srv = await asyncio.start_server(server.handle, "127.0.0.1", 0)
        port = srv.sockets[0].getsockname()[1]
        async with srv:
            # GET before write: empty, exists=false.
            _, before = await _request(
                port, f"GET /agents-md?dir={tmp_path} HTTP/1.1\r\nHost: x\r\n\r\n".encode()
            )
            # POST writes the file (state-changing -> token required).
            payload = json.dumps({"dir": str(tmp_path), "text": "# rules\nno tabs"}).encode()
            await _request(
                port,
                b"POST /agents-md HTTP/1.1\r\nHost: x\r\n"
                b"X-Rubberduck-Token: " + token.encode() + b"\r\n"
                b"Content-Type: application/json\r\n"
                b"Content-Length: " + str(len(payload)).encode() + b"\r\n\r\n" + payload,
            )
            # GET after write: the text we wrote.
            _, after = await _request(
                port, f"GET /agents-md?dir={tmp_path} HTTP/1.1\r\nHost: x\r\n\r\n".encode()
            )
            return before, after, (tmp_path / "AGENTS.md").read_text()

    before, after, on_disk = asyncio.run(scenario())
    assert before["exists"] is False and before["text"] == ""
    assert after["exists"] is True
    assert after["text"] == "# rules\nno tabs"
    assert on_disk == "# rules\nno tabs"


def test_write_agents_md_rejects_missing_directory(tmp_path: Path) -> None:
    async def scenario() -> int:
        store = HistoryStore(tmp_path / "db.sqlite")
        server = Server(history=store)
        token = server.token
        srv = await asyncio.start_server(server.handle, "127.0.0.1", 0)
        port = srv.sockets[0].getsockname()[1]
        async with srv:
            payload = json.dumps({"dir": str(tmp_path / "nope"), "text": "x"}).encode()
            status, _ = await _request(
                port,
                b"POST /agents-md HTTP/1.1\r\nHost: x\r\n"
                b"X-Rubberduck-Token: " + token.encode() + b"\r\n"
                b"Content-Type: application/json\r\n"
                b"Content-Length: " + str(len(payload)).encode() + b"\r\n\r\n" + payload,
            )
            return status

    assert asyncio.run(scenario()) == 400
