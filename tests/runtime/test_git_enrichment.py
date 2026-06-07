"""A watched session (events from a hook, no worktree) gets its repo + branch
auto-detected from its cwd, so it can show repo/branch and be forked."""

import asyncio
import json
import urllib.request
from pathlib import Path

from rubberduck import gitdetect
from rubberduck.history import HistoryStore
from rubberduck.server import Server


def _post(port: int, payload: dict) -> None:
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}/events",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    urllib.request.urlopen(req, timeout=5).read()


def _get(port: int, path: str) -> dict:
    return json.loads(urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=5).read())


def test_watched_session_in_git_repo_gets_repo_and_branch(git_repo: Path, tmp_path: Path) -> None:
    gitdetect._cache.clear()

    async def scenario() -> dict:
        store = HistoryStore(tmp_path / "db.sqlite")
        srv = await asyncio.start_server(Server(history=store).handle, "127.0.0.1", 0)
        port = srv.sockets[0].getsockname()[1]
        async with srv:
            # A hook-style event: just a cwd, no repo_path/branch.
            await asyncio.to_thread(
                _post,
                port,
                {
                    "event_type": "SessionStart",
                    "session_key": "w1",
                    "runtime": "claude-code",
                    "cwd": str(git_repo),
                },
            )
            sessions = await asyncio.to_thread(_get, port, "/sessions")
        return next(s for s in sessions["sessions"] if s["session_key"] == "w1")

    row = asyncio.run(scenario())
    assert Path(str(row["repo_path"])).name == git_repo.name
    assert row["branch"] in ("main", "master")


def test_watched_session_not_in_git_stays_plain(tmp_path: Path) -> None:
    gitdetect._cache.clear()
    plain = tmp_path / "plain"
    plain.mkdir()

    async def scenario() -> dict:
        store = HistoryStore(tmp_path / "db.sqlite")
        srv = await asyncio.start_server(Server(history=store).handle, "127.0.0.1", 0)
        port = srv.sockets[0].getsockname()[1]
        async with srv:
            await asyncio.to_thread(
                _post,
                port,
                {"event_type": "SessionStart", "session_key": "p1", "cwd": str(plain)},
            )
            sessions = await asyncio.to_thread(_get, port, "/sessions")
        return next(s for s in sessions["sessions"] if s["session_key"] == "p1")

    row = asyncio.run(scenario())
    assert row["repo_path"] is None
    assert row["branch"] is None
