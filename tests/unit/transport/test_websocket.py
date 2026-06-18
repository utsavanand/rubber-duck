import asyncio
import struct

from rubberduck.transport.websocket import (
    accept_key,
    encode_binary_frame,
    encode_text_frame,
    read_frame,
)


def test_accept_key_matches_rfc6455_example() -> None:
    # The canonical example from RFC 6455 section 1.3.
    assert accept_key("dGhlIHNhbXBsZSBub25jZQ==") == "s3pPLMBiTxaQ9kYGzzhZRbK+xOo="


def test_encode_short_text_frame() -> None:
    frame = encode_text_frame("hi")
    assert frame[0] == 0x81  # FIN + text opcode
    assert frame[1] == 2  # unmasked length 2
    assert frame[2:] == b"hi"


def test_encode_medium_frame_uses_extended_length() -> None:
    payload = "x" * 200
    frame = encode_text_frame(payload)
    assert frame[1] == 126  # signals a 16-bit length follows
    assert int.from_bytes(frame[2:4], "big") == 200
    assert frame[4:].decode() == payload


def test_encode_binary_frame_sets_binary_opcode() -> None:
    frame = encode_binary_frame(b"\x1b[2J")  # an ANSI clear-screen
    assert frame[0] == 0x82  # FIN + binary opcode
    assert frame[1] == 4  # unmasked length
    assert frame[2:] == b"\x1b[2J"


def _client_frame(opcode: int, payload: bytes, mask: bytes = b"\x01\x02\x03\x04") -> bytes:
    """Build a masked client->server frame, as a browser sends (RFC 6455 §5.3)."""
    masked = bytes(b ^ mask[i & 3] for i, b in enumerate(payload))
    return bytes([0x80 | opcode, 0x80 | len(payload)]) + mask + masked


def _read(raw: bytes | None) -> tuple[int, bytes] | None:
    """Feed raw bytes through read_frame. StreamReader must be built inside the
    loop (3.13 binds it to the running loop), so construct it here."""

    async def run() -> tuple[int, bytes] | None:
        reader = asyncio.StreamReader()
        if raw is not None:
            reader.feed_data(raw)
        reader.feed_eof()
        return await read_frame(reader)

    return asyncio.run(run())


def test_read_frame_unmasks_client_keystrokes() -> None:
    # A real terminal keystroke the browser would send: up-arrow (ESC [ A).
    result = _read(_client_frame(0x2, b"\x1b[A"))
    assert result == (0x2, b"\x1b[A")  # unmasked back to the original keystroke


def test_read_frame_handles_16bit_length() -> None:
    body = bytes(range(256)) * 2  # 512 bytes -> needs the 126 extended length
    mask = b"\x09\x08\x07\x06"
    masked = bytes(b ^ mask[i & 3] for i, b in enumerate(body))
    raw = bytes([0x82, 0x80 | 126]) + struct.pack(">H", len(body)) + mask + masked
    assert _read(raw) == (0x2, body)


def test_read_frame_signals_eof_distinctly_from_a_frame() -> None:
    # The terminal loop relies on None-vs-tuple to tell a closed socket from a
    # real client frame. EOF must NOT decode as an (opcode, payload) tuple.
    on_eof = _read(None)
    on_frame = _read(_client_frame(0x2, b"x"))
    assert on_eof is None
    assert isinstance(on_frame, tuple) and on_frame == (0x2, b"x")
