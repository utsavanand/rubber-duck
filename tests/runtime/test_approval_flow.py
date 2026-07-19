"""Approval workflow through the server: a PermissionRequest surfaces as a
pending approval, and deciding it returns a result. (Injection itself only lands
for live Rubberduck-launched sessions; here we assert the registry + endpoints.)"""

import asyncio
import json
import urllib.error
import urllib.request
from pathlib import Path

from rubberduck.persistence.history import HistoryStore
from rubberduck.server import Server


def _token() -> str:
    from rubberduck.helpers import security

    return security.load_or_create_token()


def _post(port: int, path: str, payload: dict[str, object]) -> tuple[int, dict[str, object]]:
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}{path}",
        data=json.dumps(payload).encode(),
        headers={
            "Content-Type": "application/json",
            "X-Rubberduck-Token": _token(),
        },
        method="POST",
    )
    try:
        resp = urllib.request.urlopen(req, timeout=5)
        return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def _get(port: int, path: str) -> dict[str, object]:
    return json.loads(urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=5).read())  # type: ignore[no-any-return]


def test_permission_request_surfaces_as_approval(tmp_path: Path) -> None:
    async def scenario() -> tuple[dict[str, object], int]:
        store = HistoryStore(tmp_path / "db.sqlite")
        srv = await asyncio.start_server(Server(history=store).handle, "127.0.0.1", 0)
        port = srv.sockets[0].getsockname()[1]
        async with srv:
            await asyncio.to_thread(
                _post,
                port,
                "/events",
                {
                    "event_type": "PermissionRequest",
                    "session_key": "s1",
                    "tool_name": "Bash",
                    "tool_input": {"command": "git push --force"},
                },
            )
            listing = await asyncio.to_thread(_get, port, "/approvals")
            approval_id = listing["approvals"][0]["id"]  # type: ignore[index]
            # No live session, so injection fails -> 409, approval stays.
            status, _ = await asyncio.to_thread(
                _post, port, f"/approvals/{approval_id}/decide", {"decision": "approve"}
            )
        return listing, status

    listing, status = asyncio.run(scenario())
    approvals = listing["approvals"]  # type: ignore[index]
    assert len(approvals) == 1
    assert approvals[0]["tool_name"] == "Bash"  # type: ignore[index]
    assert approvals[0]["detail"] == "git push --force"  # type: ignore[index]
    # Deciding records the decision (200); the keystroke fallback is best-effort.
    assert status == 200


def _round_trip(tmp_path: Path, runtime: str, decision: str) -> tuple[dict, dict, dict]:
    """Register a blocking request for `runtime`, decide it, and poll the
    decision back the way the hook script does. Returns (before, after, gone)."""

    async def scenario() -> tuple[dict, dict, dict]:
        store = HistoryStore(tmp_path / "db.sqlite")
        srv = await asyncio.start_server(Server(history=store).handle, "127.0.0.1", 0)
        port = srv.sockets[0].getsockname()[1]
        async with srv:
            _, reg = await asyncio.to_thread(
                _post,
                port,
                "/approvals",
                {
                    "session_key": "s1",
                    "tool_name": "WebFetch",
                    "tool_input": {"url": "http://x"},
                    "runtime": runtime,
                },
            )
            rid = reg["id"]  # type: ignore[index]
            before = await asyncio.to_thread(_get, port, f"/approvals/{rid}/decision")
            await asyncio.to_thread(_post, port, f"/approvals/{rid}/decide", {"decision": decision})
            after = await asyncio.to_thread(_get, port, f"/approvals/{rid}/decision")
            gone = await asyncio.to_thread(_get, port, f"/approvals/{rid}/decision")
        return before, after, gone  # type: ignore[return-value]

    return asyncio.run(scenario())


def test_blocking_approval_round_trip(tmp_path: Path) -> None:
    """The real path: a hook registers a request, the dashboard decides it, and
    the hook reads the decision back (then it's forgotten). The decided response
    carries the harness's exact stdout JSON, rendered from its ApprovalSpec."""
    before, after, gone = _round_trip(tmp_path, "claude-code", "approve")
    assert before["status"] == "pending"
    assert after["status"] == "approve"
    assert json.loads(after["output"]) == {  # type: ignore[arg-type]
        "hookSpecificOutput": {
            "hookEventName": "PermissionRequest",
            "decision": {"behavior": "allow"},
        }
    }
    assert gone["status"] == "gone"  # forgotten after the hook consumed it


def test_decision_output_is_per_harness(tmp_path: Path) -> None:
    """Copilot gets its own decision shape; a runtime with no ApprovalSpec (or
    none given) gets no output at all — the hook prints nothing and the agent
    falls through to its inline prompt."""
    _, copilot, _ = _round_trip(tmp_path, "copilot", "deny")
    assert json.loads(copilot["output"]) == {"permissionDecision": "deny"}  # type: ignore[arg-type]

    _, unknown, _ = _round_trip(tmp_path, "", "approve")
    assert unknown["status"] == "approve"
    assert "output" not in unknown


def test_ask_user_question_is_not_registered(tmp_path: Path) -> None:
    """AskUserQuestion is the agent asking the human a question, not a tool gate.
    Registering it returns no id and adds no row to 'Needs human'."""

    async def scenario() -> tuple[object, int]:
        store = HistoryStore(tmp_path / "db.sqlite")
        srv = await asyncio.start_server(Server(history=store).handle, "127.0.0.1", 0)
        port = srv.sockets[0].getsockname()[1]
        async with srv:
            _, reg = await asyncio.to_thread(
                _post,
                port,
                "/approvals",
                {"session_key": "s1", "tool_name": "AskUserQuestion", "tool_input": {}},
            )
            listing = await asyncio.to_thread(_get, port, "/approvals")
        return reg["id"], len(listing["approvals"])  # type: ignore[index,arg-type]

    rid, count = asyncio.run(scenario())
    assert rid is None
    assert count == 0


def test_bad_decision_rejected(tmp_path: Path) -> None:
    async def scenario() -> int:
        store = HistoryStore(tmp_path / "db.sqlite")
        srv = await asyncio.start_server(Server(history=store).handle, "127.0.0.1", 0)
        port = srv.sockets[0].getsockname()[1]
        async with srv:
            status, _ = await asyncio.to_thread(
                _post, port, "/approvals/whatever/decide", {"decision": "maybe"}
            )
        return status

    assert asyncio.run(scenario()) == 400
