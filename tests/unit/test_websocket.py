from rubberduck.transport.websocket import accept_key, encode_text_frame


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
