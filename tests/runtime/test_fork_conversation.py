"""Conversation fork: branch a claude-code session's *context* via
`claude --resume <id> --fork-session`. We assert the guard rails (only
claude-code, only when a Claude session_id is known) without needing a real
claude binary."""

import asyncio
import json
import urllib.error
import urllib.request
from pathlib import Path

from rubberduck.history import HistoryStore
from rubberduck.server import Server


def _post(port: int, path: str, payload: dict | None = None) -> tuple[int, dict]:
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}{path}",
        data=json.dumps(payload or {}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        resp = urllib.request.urlopen(req, timeout=5)
        return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def test_fork_conversation_rejects_non_claude_session(tmp_path: Path) -> None:
    async def scenario() -> tuple[int, dict]:
        store = HistoryStore(tmp_path / "db.sqlite")
        srv = await asyncio.start_server(Server(history=store).handle, "127.0.0.1", 0)
        port = srv.sockets[0].getsockname()[1]
        async with srv:
            await asyncio.to_thread(
                _post,
                port,
                "/events",
                {"event_type": "SessionStart", "session_key": "g1", "runtime": "generic"},
            )
            return await asyncio.to_thread(_post, port, "/sessions/g1/fork-conversation", {})

    status, body = asyncio.run(scenario())
    assert status == 400
    assert "claude-code" in body["error"]


def test_fork_conversation_needs_a_claude_session_id(tmp_path: Path) -> None:
    async def scenario() -> tuple[int, dict]:
        store = HistoryStore(tmp_path / "db.sqlite")
        srv = await asyncio.start_server(Server(history=store).handle, "127.0.0.1", 0)
        port = srv.sockets[0].getsockname()[1]
        async with srv:
            # A claude-code session but no session_id event recorded yet.
            await asyncio.to_thread(
                _post,
                port,
                "/events",
                {"event_type": "SessionStart", "session_key": "c1", "runtime": "claude-code"},
            )
            return await asyncio.to_thread(_post, port, "/sessions/c1/fork-conversation", {})

    status, body = asyncio.run(scenario())
    assert status == 400
    assert "session_id" in body["error"]


def test_fork_conversation_opens_terminal_with_resume_command(
    tmp_path: Path, monkeypatch
) -> None:  # type: ignore[no-untyped-def]
    # Don't actually spawn a terminal: capture the argv instead.
    opened: dict = {}

    def fake_open(cwd: str, argv: list[str]) -> bool:
        opened["cwd"] = cwd
        opened["argv"] = argv
        return True

    monkeypatch.setattr("rubberduck.server.open_in_terminal", fake_open)

    async def scenario() -> dict:
        store = HistoryStore(tmp_path / "db.sqlite")
        srv = await asyncio.start_server(Server(history=store).handle, "127.0.0.1", 0)
        port = srv.sockets[0].getsockname()[1]
        async with srv:
            # A claude-code session WITH a Claude session_id recorded.
            await asyncio.to_thread(
                _post,
                port,
                "/events",
                {
                    "event_type": "SessionStart",
                    "session_key": "c2",
                    "runtime": "claude-code",
                    "session_id": "claude-xyz",
                    "cwd": "/work/repo",
                },
            )
            _, body = await asyncio.to_thread(_post, port, "/sessions/c2/fork-conversation", {})
        return body

    body = asyncio.run(scenario())
    assert body["opened_in_terminal"] is True
    assert opened["argv"] == ["claude", "--resume", "claude-xyz", "--fork-session"]
    assert opened["cwd"] == "/work/repo"
