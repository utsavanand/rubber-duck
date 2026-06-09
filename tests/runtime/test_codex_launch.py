"""Act 9 runtime gate: a codex-runtime session drops in via the same launch path
and is tracked with its runtime + an isolated worktree — proving the adapter
boundary holds for a second real runtime."""

import asyncio
import json
import sys
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


def test_codex_session_tracked_with_runtime_and_worktree(git_repo: Path, tmp_path: Path) -> None:
    agent = f"{sys.executable} {FAKE_AGENT}"

    async def scenario() -> dict[str, object]:
        store = HistoryStore(tmp_path / "db.sqlite")
        srv = await asyncio.start_server(Server(history=store).handle, "127.0.0.1", 0)
        port = srv.sockets[0].getsockname()[1]
        async with srv:
            await asyncio.to_thread(
                _post,
                port,
                "/sessions/launch",
                {
                    "command": agent,
                    "runtime": "codex",
                    "repo_path": str(git_repo),
                    "branch": "codex-feature",
                    "session_key": "cdx",
                },
            )
            await asyncio.sleep(0.3)
            sessions = await asyncio.to_thread(_get, port, "/sessions")
        return next(s for s in sessions["sessions"] if s["session_key"] == "cdx")  # type: ignore[attr-defined]

    row = asyncio.run(scenario())
    assert row["runtime"] == "codex"
    assert row["branch"] == "codex-feature"
    assert row["worktree_path"] is not None
    assert Path(str(row["worktree_path"])).name == "codex-feature"
