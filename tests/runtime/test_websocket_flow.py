"""The /ws endpoint completes the WebSocket handshake and delivers events as
text frames — verified with a hand-rolled client (no ws library)."""

import asyncio
import json
from pathlib import Path

from rubberduck.history import HistoryStore
from rubberduck.server import Server
from rubberduck.websocket import accept_key


def _decode_text_frame(data: bytes) -> tuple[dict, bytes]:
    """Decode one unmasked server text frame; return (json, rest)."""
    length = data[1] & 0x7F
    offset = 2
    if length == 126:
        length = int.from_bytes(data[2:4], "big")
        offset = 4
    payload = data[offset : offset + length]
    return json.loads(payload), data[offset + length :]


def test_handshake_and_event_delivery(tmp_path: Path) -> None:
    async def scenario() -> tuple[str, dict]:
        store = HistoryStore(tmp_path / "db.sqlite")
        srv = await asyncio.start_server(Server(history=store).handle, "127.0.0.1", 0)
        port = srv.sockets[0].getsockname()[1]
        async with srv:
            reader, writer = await asyncio.open_connection("127.0.0.1", port)
            client_key = "dGhlIHNhbXBsZSBub25jZQ=="
            writer.write(
                f"GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\n"
                f"Sec-WebSocket-Key: {client_key}\r\n\r\n".encode()
            )
            await writer.drain()

            head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 2)
            # init frame arrives right after the handshake.
            init_raw = await asyncio.wait_for(reader.read(4096), 2)
            init, _ = _decode_text_frame(init_raw)
            writer.close()
            return head.decode(), init

    head, init = asyncio.run(scenario())
    assert "101 Switching Protocols" in head
    assert f"Sec-WebSocket-Accept: {accept_key('dGhlIHNhbXBsZSBub25jZQ==')}" in head
    assert init["type"] == "init"
