"""Act 11 runtime gates through the server: checkpoint/rollback, spotlight, and
multi-model compare."""

import asyncio
import json
import sys
import urllib.request
from pathlib import Path

from rubberduck.history import HistoryStore
from rubberduck.server import Server

FAKE_AGENT = Path(__file__).parent.parent / "fakes" / "fake_agent.py"


def _post(port: int, path: str, payload: dict[str, object] | None = None) -> dict[str, object]:
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}{path}",
        data=json.dumps(payload or {}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    return json.loads(urllib.request.urlopen(req, timeout=5).read())  # type: ignore[no-any-return]


def _get(port: int, path: str) -> dict[str, object]:
    return json.loads(urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=5).read())  # type: ignore[no-any-return]


def test_checkpoint_records_session_activity(git_repo: Path, tmp_path: Path) -> None:
    agent = f"{sys.executable} {FAKE_AGENT}"

    async def scenario() -> dict:
        store = HistoryStore(tmp_path / "db.sqlite")
        srv = await asyncio.start_server(Server(history=store).handle, "127.0.0.1", 0)
        port = srv.sockets[0].getsockname()[1]
        async with srv:
            await asyncio.to_thread(
                _post,
                port,
                "/sessions/launch",
                {"command": agent, "repo_path": str(git_repo), "branch": "cp", "session_key": "c"},
            )
            await asyncio.sleep(0.3)
            # Some activity to capture.
            await asyncio.to_thread(
                _post,
                port,
                "/events",
                {"event_type": "UserPromptSubmit", "session_key": "c", "prompt": "do the thing"},
            )
            await asyncio.to_thread(_post, port, "/sessions/c/checkpoint", {"label": "progress"})
            checkpoints = await asyncio.to_thread(_get, port, "/sessions/c/checkpoints")
            return checkpoints["checkpoints"][0]  # type: ignore[index,return-value]

    cp = asyncio.run(scenario())
    assert cp["label"] == "progress"
    assert cp["summary"]  # a record was produced
    assert "do the thing" in cp["record"]["prompts"]


def test_spotlight_via_server(git_repo: Path, tmp_path: Path) -> None:
    agent = f"{sys.executable} {FAKE_AGENT}"

    async def scenario() -> str:
        store = HistoryStore(tmp_path / "db.sqlite")
        srv = await asyncio.start_server(Server(history=store).handle, "127.0.0.1", 0)
        port = srv.sockets[0].getsockname()[1]
        async with srv:
            launched = await asyncio.to_thread(
                _post,
                port,
                "/sessions/launch",
                {"command": agent, "repo_path": str(git_repo), "branch": "sl", "session_key": "s"},
            )
            await asyncio.sleep(0.3)
            wt = Path(str(store.session(launched["session_key"])["worktree_path"]))  # type: ignore[index]
            (wt / "README.md").write_text("agent work\n")
            await asyncio.to_thread(_post, port, "/sessions/s/spotlight")
        return (git_repo / "README.md").read_text()

    assert asyncio.run(scenario()) == "agent work\n"


def test_compare_launches_grouped_variants(git_repo: Path, tmp_path: Path) -> None:
    agent = f"{sys.executable} {FAKE_AGENT}"

    async def scenario() -> list[dict[str, object]]:
        store = HistoryStore(tmp_path / "db.sqlite")
        srv = await asyncio.start_server(Server(history=store).handle, "127.0.0.1", 0)
        port = srv.sockets[0].getsockname()[1]
        async with srv:
            await asyncio.to_thread(
                _post,
                port,
                "/sessions/compare",
                {
                    "repo_path": str(git_repo),
                    "prompt": "add a healthcheck",
                    "group": "exp1",
                    "variants": [
                        {"runtime": "generic", "command": agent},
                        {"runtime": "codex", "command": agent},
                    ],
                },
            )
            await asyncio.sleep(0.4)
            sessions = await asyncio.to_thread(_get, port, "/sessions")
        return [s for s in sessions["sessions"] if s.get("compare_group") == "exp1"]  # type: ignore[attr-defined]

    grouped = asyncio.run(scenario())
    assert len(grouped) == 2
    assert {s["runtime"] for s in grouped} == {"generic", "codex"}
    # Distinct sibling branches under the group.
    assert len({s["branch"] for s in grouped}) == 2
