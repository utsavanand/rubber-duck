"""Minimal RFC 6455 WebSocket over the hand-rolled asyncio server. Zero
dependencies — just the handshake and text-frame encoding we need to push events
to a browser.

The event stream (/ws) sends text frames (JSON events) and only needs
`read_frame_opcode` (close detection). The terminal (/sessions/:key/terminal)
adds: `encode_binary_frame` (raw PTY bytes out), `read_frame` (unmasked client
payloads in — keystrokes + resize), and `ping_frame` (keepalive).

This stays a hand-rolled, zero-dependency module as long as it carries only
single, unfragmented frames — which is all our two consumers send. If we ever
need fragmentation/continuation or permessage-deflate, swap in a vetted WS
library rather than growing this. (docs/terminal-forward-design.md)
"""

import asyncio
import base64
import hashlib
import struct

_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


def accept_key(client_key: str) -> str:
    digest = hashlib.sha1((client_key + _GUID).encode()).digest()
    return base64.b64encode(digest).decode()


def handshake_response(client_key: str) -> bytes:
    return (
        "HTTP/1.1 101 Switching Protocols\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        f"Sec-WebSocket-Accept: {accept_key(client_key)}\r\n\r\n"
    ).encode()


def encode_text_frame(text: str) -> bytes:
    """A single, unfragmented, unmasked text frame (server->client)."""
    return _encode_frame(0x1, text.encode())


def encode_binary_frame(payload: bytes) -> bytes:
    """A single, unfragmented, unmasked binary frame (server->client). Used to
    push raw PTY bytes to an xterm.js terminal."""
    return _encode_frame(0x2, payload)


def _encode_frame(opcode: int, payload: bytes) -> bytes:
    header = bytearray([0x80 | opcode])  # FIN + opcode
    length = len(payload)
    if length < 126:
        header.append(length)
    elif length < 65536:
        header.append(126)
        header += struct.pack(">H", length)
    else:
        header.append(127)
        header += struct.pack(">Q", length)
    return bytes(header) + payload


def close_frame() -> bytes:
    return bytes([0x88, 0x00])  # opcode 0x8 (close), empty payload


def ping_frame() -> bytes:
    return bytes([0x89, 0x00])  # opcode 0x9 (ping), empty payload


async def read_frame_opcode(reader: asyncio.StreamReader) -> int | None:
    """Read one incoming (masked) client frame and return its opcode, or None on
    EOF. We don't need the payload — just enough to detect a close (0x8)."""
    try:
        first = await reader.readexactly(1)
        second = await reader.readexactly(1)
    except asyncio.IncompleteReadError:
        return None
    opcode = first[0] & 0x0F
    length = second[0] & 0x7F
    masked = bool(second[0] & 0x80)
    if length == 126:
        length = struct.unpack(">H", await reader.readexactly(2))[0]
    elif length == 127:
        length = struct.unpack(">Q", await reader.readexactly(8))[0]
    if masked:
        await reader.readexactly(4)  # mask key
    if length:
        await reader.readexactly(length)  # discard payload
    return opcode


async def read_frame(reader: asyncio.StreamReader) -> tuple[int, bytes] | None:
    """Read one incoming client frame and return (opcode, unmasked payload), or
    None on EOF. Unlike read_frame_opcode this KEEPS the payload — the terminal
    needs the keystroke/resize bytes the client sends. Client frames are always
    masked (RFC 6455 §5.3); we unmask before returning."""
    try:
        first = await reader.readexactly(1)
        second = await reader.readexactly(1)
    except asyncio.IncompleteReadError:
        return None
    opcode = first[0] & 0x0F
    length = second[0] & 0x7F
    masked = bool(second[0] & 0x80)
    if length == 126:
        length = struct.unpack(">H", await reader.readexactly(2))[0]
    elif length == 127:
        length = struct.unpack(">Q", await reader.readexactly(8))[0]
    mask = await reader.readexactly(4) if masked else b"\x00\x00\x00\x00"
    payload = bytearray(await reader.readexactly(length)) if length else bytearray()
    if masked:
        for i in range(length):
            payload[i] ^= mask[i & 3]
    return opcode, bytes(payload)
