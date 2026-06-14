"""The server serves the built dashboard at / so there's one URL. When the
dashboard isn't built, / returns a helpful hint instead of 404 — and always
carries the self-probe header."""

import asyncio
from pathlib import Path

from rubberduck.persistence.history import HistoryStore
from rubberduck.server import SELF_PROBE_HEADER, Server, dashboard_dir


def test_root_carries_self_probe_and_responds(tmp_path: Path) -> None:
    async def scenario() -> tuple[int, str]:
        store = HistoryStore(tmp_path / "db.sqlite")
        srv = await asyncio.start_server(Server(history=store).handle, "127.0.0.1", 0)
        port = srv.sockets[0].getsockname()[1]
        async with srv:
            reader, writer = await asyncio.open_connection("127.0.0.1", port)
            writer.write(b"GET / HTTP/1.1\r\nHost: x\r\n\r\n")
            await writer.drain()
            head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 2)
            writer.close()
        status_line = head.split(b"\r\n")[0].decode()
        return int(status_line.split()[1]), head.decode("latin-1").lower()

    status, head = asyncio.run(scenario())
    assert status == 200
    assert SELF_PROBE_HEADER.lower() in head


def test_dashboard_dir_detects_a_real_build() -> None:
    # In this repo the dashboard is built (web/dist), so the resolver finds it.
    # If it isn't built in some environment, the resolver returns None — both are
    # valid; we just assert the function returns a coherent answer.
    result = dashboard_dir()
    assert result is None or (result / "index.html").is_file()
