"""Act 5 runtime gate: fork A -> B -> C produces a correct lineage tree, each
session on its own branch off its parent."""

import asyncio
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

from rubberduck.history import HistoryStore
from rubberduck.server import Server

FAKE_AGENT = Path(__file__).parent.parent / "fakes" / "fake_agent.py"


def _token() -> str:
    from rubberduck import security

    return security.load_or_create_token()


def _post(port: int, path: str, payload: dict[str, object]) -> dict[str, object]:
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}{path}",
        data=json.dumps(payload).encode(),
        headers={
            "Content-Type": "application/json",
            "X-Rubberduck-Token": _token(),
        },
        method="POST",
    )
    return json.loads(urllib.request.urlopen(req, timeout=5).read())  # type: ignore[no-any-return]


def _get(port: int, path: str) -> dict[str, object]:
    return json.loads(urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=5).read())  # type: ignore[no-any-return]


def test_fork_chain_builds_lineage(git_repo: Path, tmp_path: Path) -> None:
    agent = f"{sys.executable} {FAKE_AGENT}"

    async def scenario() -> dict[str, object]:
        store = HistoryStore(tmp_path / "db.sqlite")
        server = Server(history=store)
        srv = await asyncio.start_server(server.handle, "127.0.0.1", 0)
        port = srv.sockets[0].getsockname()[1]
        async with srv:
            root = await asyncio.to_thread(
                _post,
                port,
                "/sessions/launch",
                {
                    "command": agent,
                    "repo_path": str(git_repo),
                    "branch": "root",
                    "session_key": "A",
                },
            )
            await asyncio.to_thread(
                _post,
                port,
                f"/sessions/{root['session_key']}/fork",
                {"command": agent, "branch": "child", "session_key": "B", "in_terminal": False},
            )
            await asyncio.to_thread(
                _post,
                port,
                "/sessions/B/fork",
                {
                    "command": agent,
                    "branch": "grandchild",
                    "session_key": "C",
                    "in_terminal": False,
                },
            )
            await asyncio.sleep(0.3)
            return await asyncio.to_thread(_get, port, "/tree")

    tree = asyncio.run(scenario())
    parent = {n["session_key"]: n["parent_session_key"] for n in tree["nodes"]}  # type: ignore[attr-defined]
    assert parent == {"A": None, "B": "A", "C": "B"}


def test_fork_child_branches_off_parent(git_repo: Path, tmp_path: Path) -> None:
    agent = f"{sys.executable} {FAKE_AGENT}"

    async def scenario() -> tuple[dict[str, object], dict[str, object]]:
        store = HistoryStore(tmp_path / "db.sqlite")
        server = Server(history=store)
        srv = await asyncio.start_server(server.handle, "127.0.0.1", 0)
        port = srv.sockets[0].getsockname()[1]
        async with srv:
            await asyncio.to_thread(
                _post,
                port,
                "/sessions/launch",
                {
                    "command": agent,
                    "repo_path": str(git_repo),
                    "branch": "parent",
                    "session_key": "P",
                },
            )
            await asyncio.to_thread(
                _post,
                port,
                "/sessions/P/fork",
                {
                    "command": agent,
                    "branch": "kid",
                    "session_key": "K",
                    "in_terminal": False,  # headless launch (no terminal in tests)
                },
            )
            await asyncio.sleep(0.3)
            sessions = await asyncio.to_thread(_get, port, "/sessions")
        rows = {s["session_key"]: s for s in sessions["sessions"]}  # type: ignore[attr-defined]
        return rows["P"], rows["K"]

    parent, kid = asyncio.run(scenario())
    assert parent["branch"] == "parent"
    assert kid["branch"] == "kid"
    assert kid["parent_session_key"] == "P"
    # Distinct worktrees, same origin repo.
    assert kid["worktree_path"] != parent["worktree_path"]
    assert kid["repo_path"] == parent["repo_path"]


def test_fork_unknown_session_404(git_repo: Path, tmp_path: Path) -> None:
    async def scenario() -> int:
        store = HistoryStore(tmp_path / "db.sqlite")
        server = Server(history=store)
        srv = await asyncio.start_server(server.handle, "127.0.0.1", 0)
        port = srv.sockets[0].getsockname()[1]
        async with srv:
            try:
                await asyncio.to_thread(_post, port, "/sessions/nope/fork", {})
                return 200
            except urllib.error.HTTPError as e:  # type: ignore[attr-defined]
                return e.code

    assert asyncio.run(scenario()) == 404
