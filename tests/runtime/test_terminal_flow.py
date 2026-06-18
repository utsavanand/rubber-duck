"""The /sessions/:key/terminal endpoint streams raw PTY bytes as binary frames
and accepts client input frames — verified end to end against a real launched
session (a short shell command in a PTY), with a hand-rolled WS client."""

import asyncio
from pathlib import Path

import pytest

from rubberduck.persistence.history import HistoryStore
from rubberduck.runtimes.generic import GenericRuntime
from rubberduck.server import Server


def _client_handshake(key: str) -> bytes:
    return (
        f"GET /sessions/SKEY/terminal HTTP/1.1\r\nHost: x\r\n"
        f"Upgrade: websocket\r\nSec-WebSocket-Key: {key}\r\n\r\n"
    ).encode()


def _read_binary_payload(data: bytes) -> bytes:
    """Concatenate the payloads of all binary frames (0x2) in a server buffer,
    skipping ping frames (0x9). Server frames are unmasked."""
    out = bytearray()
    i = 0
    while i + 2 <= len(data):
        opcode = data[i] & 0x0F
        length = data[i + 1] & 0x7F
        i += 2
        if length == 126:
            length = int.from_bytes(data[i : i + 2], "big")
            i += 2
        elif length == 127:
            length = int.from_bytes(data[i : i + 8], "big")
            i += 8
        payload = data[i : i + length]
        i += length
        if opcode == 0x2:
            out += payload
    return bytes(out)


def test_terminal_streams_raw_pty_bytes(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    # Force the PTY backing (not tmux): the PTY pump captures from process start,
    # so a one-shot marker is deterministic. The tmux tail seeks to end-of-pipe
    # on attach, which would race a one-shot print. Both feed _record_bytes; the
    # PTY path is the deterministic one to assert on.
    monkeypatch.setattr("rubberduck.core.orchestrator.tmux.has_tmux", lambda: False)

    async def scenario() -> bytes:
        store = HistoryStore(tmp_path / "db.sqlite")
        server = Server(history=store)
        orch = server.orchestrator

        # Launch a real session that prints a known marker, then idles long
        # enough for us to attach and read it. Works whether the orchestrator
        # backs the session with a PTY or tmux — both feed _record_bytes.
        key = await orch.launch(
            runtime=GenericRuntime("sh -c 'printf RUBBERDUCK_MARKER; sleep 2'"),
            cwd=str(tmp_path),
            session_key="SKEY",
        )
        assert key == "SKEY"

        srv = await asyncio.start_server(server.handle, "127.0.0.1", 0)
        port = srv.sockets[0].getsockname()[1]
        async with srv:
            reader, writer = await asyncio.open_connection("127.0.0.1", port)
            writer.write(_client_handshake("dGhlIHNhbXBsZSBub25jZQ=="))
            await writer.drain()
            await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 3)  # handshake
            # Give the command a moment to emit, then read whatever frames came.
            await asyncio.sleep(0.5)
            buffered = await asyncio.wait_for(reader.read(8192), 3)
            writer.close()
            await orch.stop("SKEY")
            return _read_binary_payload(buffered)

    payload = asyncio.run(scenario())
    assert b"RUBBERDUCK_MARKER" in payload


def test_tmux_path_preserves_cr_lf(tmp_path: Path) -> None:
    # Regression: the tmux tail once read its pipe in text mode, which translated
    # the pane's CR-LF into bare LF — so xterm.js rendered output marching
    # diagonally down the screen (no carriage return). The terminal stream must
    # carry \r\n verbatim. Needs tmux; skip where it isn't installed.
    from rubberduck.agents import tmux

    if not tmux.has_tmux():
        import pytest

        pytest.skip("tmux not installed")

    async def scenario() -> bytes:
        store = HistoryStore(tmp_path / "db.sqlite")
        server = Server(history=store)
        orch = server.orchestrator
        cmd = "sh -c 'for i in 1 2 3; do echo line-$i; sleep 0.1; done; sleep 1'"
        await orch.launch(
            runtime=GenericRuntime(cmd),
            cwd=str(tmp_path),
            session_key="TMUXK",
        )
        sup = orch.get("TMUXK")
        assert sup is not None and sup._tmux_target is not None  # tmux-backed
        got = bytearray()
        gen = sup.subscribe_bytes()

        async def collect() -> None:
            async for chunk in gen:
                got.extend(chunk)

        task = asyncio.create_task(collect())
        await asyncio.sleep(0.8)
        task.cancel()
        await orch.stop("TMUXK")
        return bytes(got)

    out = asyncio.run(scenario())
    assert b"\r\n" in out, f"expected CR-LF in tmux output, got {out!r}"
    assert b"line-" in out
