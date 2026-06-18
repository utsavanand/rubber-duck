"""Annotations are stored and sent back to the agent as a follow-up prompt."""

import asyncio
import json
import tempfile
from pathlib import Path

from rubberduck.persistence.history import HistoryStore
from rubberduck.runtimes.generic import GenericRuntime
from rubberduck.server import Server


class _W:
    def __init__(self) -> None:
        self.data = b""

    def write(self, b: bytes) -> None:
        self.data += b

    async def drain(self) -> None:
        pass


def test_annotation_stored_and_sent_to_agent() -> None:
    async def scenario() -> tuple[int, bytes]:
        store = HistoryStore(Path(tempfile.mkdtemp()) / "db.sqlite")
        server = Server(history=store)
        await server.orchestrator.launch(runtime=GenericRuntime("cat"), cwd="/tmp", session_key="S")
        sup = server.orchestrator.get("S")
        assert sup is not None
        await asyncio.sleep(0.3)
        got = bytearray()
        gen = sup.subscribe_bytes()

        async def collect() -> None:
            async for chunk in gen:
                got.extend(chunk)

        task = asyncio.create_task(collect())
        w = _W()
        body = json.dumps({"quote": "the leak", "note": "fix it"}).encode()
        await server._add_annotation(w, "S", body)  # type: ignore[arg-type]
        await asyncio.sleep(0.4)
        task.cancel()
        await server.orchestrator.stop("S")
        return len(store.annotations("S")), bytes(got)

    count, echoed = asyncio.run(scenario())
    assert count == 1  # stored
    # cat echoes the composed follow-up, proving it reached the agent's stdin.
    assert b'Re: "the leak" \xe2\x80\x94 fix it' in echoed or b"fix it" in echoed
