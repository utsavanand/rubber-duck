"""Act 5 runtime gate: fork A -> B -> C produces a correct lineage tree, each
session on its own branch off its parent."""

import asyncio
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

from rubberduck.persistence.history import HistoryStore
from rubberduck.runtimes.claude_code import project_slug
from rubberduck.server import Server

FAKE_AGENT = Path(__file__).parent.parent / "fakes" / "fake_agent.py"


def _token() -> str:
    from rubberduck.helpers import security

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


def test_worktree_fork_carries_claude_conversation(
    git_repo: Path, tmp_path: Path, monkeypatch
) -> None:  # type: ignore[no-untyped-def]
    """A worktree fork with carry_context relaunches the parent's conversation in
    the new worktree (claude --resume <id> --fork-session), not a fresh agent."""
    opened: dict = {}
    monkeypatch.setattr(
        "rubberduck.server.open_in_terminal",
        lambda cwd, argv, **kw: opened.update(cwd=cwd, argv=argv) or True,
    )
    # The parent's conversation transcript must exist for it to be resumable.
    fake_home = tmp_path / "home"
    slug = project_slug(git_repo)
    proj = fake_home / ".claude" / "projects" / slug
    proj.mkdir(parents=True)
    (proj / "claude-sid.jsonl").write_text('{"role":"user","text":"hi"}\n')
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: fake_home))

    async def scenario() -> dict[str, object]:
        store = HistoryStore(tmp_path / "db.sqlite")
        srv = await asyncio.start_server(Server(history=store).handle, "127.0.0.1", 0)
        port = srv.sockets[0].getsockname()[1]
        async with srv:
            await asyncio.to_thread(
                _post,
                port,
                "/events",
                {
                    "event_type": "SessionStart",
                    "session_key": "P",
                    "runtime": "claude-code",
                    "session_id": "claude-sid",
                    "repo_path": str(git_repo),
                    "branch": "main",
                    "cwd": str(git_repo),
                },
            )
            return await asyncio.to_thread(
                _post,
                port,
                "/sessions/P/fork",
                {"branch": "ctx-fork", "carry_context": True},
            )

    body = asyncio.run(scenario())
    assert body["carried_context"] is True
    assert opened["argv"] == ["claude", "--resume", "claude-sid", "--fork-session"]
    # ...and it runs in the new worktree, not the parent's cwd.
    assert "ctx-fork" in opened["cwd"]


def test_worktree_fork_no_context_for_codex(
    git_repo: Path, tmp_path: Path, monkeypatch
) -> None:  # type: ignore[no-untyped-def]
    """Codex has no native conversation resume, so carry_context is a no-op — the
    fork launches the base command fresh (carried_context False)."""
    opened: dict = {}
    monkeypatch.setattr(
        "rubberduck.server.open_in_terminal",
        lambda cwd, argv, **kw: opened.update(argv=argv) or True,
    )

    async def scenario() -> dict[str, object]:
        store = HistoryStore(tmp_path / "db.sqlite")
        srv = await asyncio.start_server(Server(history=store).handle, "127.0.0.1", 0)
        port = srv.sockets[0].getsockname()[1]
        async with srv:
            await asyncio.to_thread(
                _post,
                port,
                "/events",
                {
                    "event_type": "SessionStart",
                    "session_key": "P",
                    "runtime": "codex",
                    "session_id": "codex-sid",
                    "repo_path": str(git_repo),
                    "branch": "main",
                    "cwd": str(git_repo),
                },
            )
            return await asyncio.to_thread(
                _post,
                port,
                "/sessions/P/fork",
                {"command": "codex", "branch": "cx-fork", "carry_context": True},
            )

    body = asyncio.run(scenario())
    assert body["carried_context"] is False
    assert opened["argv"] == ["codex"]  # fresh, no resume
