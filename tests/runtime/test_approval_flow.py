"""Approval workflow through the server: a PermissionRequest surfaces as a
pending approval, and deciding it returns a result. (Injection itself only lands
for live Rubberduck-launched sessions; here we assert the registry + endpoints.)"""

import asyncio
import json
import urllib.error
import urllib.request
from pathlib import Path

from rubberduck.history import HistoryStore
from rubberduck.server import Server


def _post(port: int, path: str, payload: dict[str, object]) -> tuple[int, dict[str, object]]:
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}{path}",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
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
    assert status == 409  # injection couldn't land (session not Rubberduck-launched)


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
