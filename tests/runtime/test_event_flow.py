"""Act 1 runtime gate: prove agent-agnosticism. A bare HTTP POST drives the
live stream end to end with no agent runtime involved."""

import asyncio
import json
import urllib.error
import urllib.request
from pathlib import Path

import pytest

from rubberduck.server import SELF_PROBE_HEADER, Server


async def _read_sse_frame(reader: asyncio.StreamReader) -> dict[str, object]:
    """Read lines until a `data:` line, return its parsed JSON."""
    while True:
        line = await asyncio.wait_for(reader.readline(), 2)
        if line.startswith(b"data:"):
            return json.loads(line[len(b"data:") :].strip())


def test_post_event_reaches_sse_subscriber_with_no_agent() -> None:
    async def scenario() -> dict[str, object]:
        server = await asyncio.start_server(Server().handle, "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]
        async with server:
            reader, writer = await asyncio.open_connection("127.0.0.1", port)
            writer.write(b"GET /stream HTTP/1.1\r\nHost: x\r\n\r\n")
            await writer.drain()

            await _read_sse_frame(reader)  # the {type:init} frame

            await asyncio.to_thread(_post_event, port, {"event_type": "Stop", "session_key": "s1"})
            frame = await _read_sse_frame(reader)

            writer.close()
            return frame

    frame = asyncio.run(scenario())
    assert frame["session_key"] == "s1"
    assert frame["event_type"] == "Stop"
    assert "_id" in frame and "_ts" in frame


def test_recent_endpoint_returns_posted_events() -> None:
    async def scenario() -> list[dict[str, object]]:
        server = await asyncio.start_server(Server().handle, "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]
        async with server:
            await asyncio.to_thread(
                _post_event, port, {"event_type": "SessionStart", "session_key": "a"}
            )
            await asyncio.to_thread(_post_event, port, {"event_type": "Stop", "session_key": "a"})
            body = await asyncio.to_thread(_get, port, "/events")
        return list(json.loads(body)["events"])

    events = asyncio.run(scenario())
    assert [e["event_type"] for e in events] == ["SessionStart", "Stop"]


def test_permission_request_clears_when_the_agent_moves_on() -> None:
    """A PermissionRequest answered in the agent's own terminal (we never see the
    answer) must not linger as a fake 'needs human' approval. The next activity
    event for that session resolves it."""

    async def count_approvals(port: int) -> int:
        body = await asyncio.to_thread(_get, port, "/approvals")
        return len(json.loads(body)["approvals"])

    async def scenario() -> tuple[int, int]:
        server = await asyncio.start_server(Server().handle, "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]
        async with server:
            await asyncio.to_thread(
                _post_event,
                port,
                {
                    "event_type": "PermissionRequest",
                    "session_key": "pa",
                    "tool_name": "Bash",
                    "tool_input": {"command": "npm run build"},
                },
            )
            after_request = await count_approvals(port)
            # The agent ran the command (answered in its terminal) and moved on.
            await asyncio.to_thread(
                _post_event,
                port,
                {"event_type": "PreToolUse", "session_key": "pa", "tool_name": "Bash"},
            )
            after_activity = await count_approvals(port)
        return after_request, after_activity

    after_request, after_activity = asyncio.run(scenario())
    assert after_request == 1  # the request registered
    assert after_activity == 0  # and cleared once the agent moved on


def test_tombstoned_session_events_are_all_dropped(tmp_path: Path) -> None:
    """A deleted session whose hooks keep firing must not leak ANY events — not
    even a SessionStart. Deleted stays deleted (no phantom rows, nothing in the
    Pulse feed); `rubberduck restart` is the way to bring back a live session
    deleted by mistake."""
    from rubberduck.persistence.history import HistoryStore

    store = HistoryStore(tmp_path / "db.sqlite")
    store.delete_session("ghost")  # tombstone it (no prior row needed)

    async def scenario() -> list[dict[str, object]]:
        server = await asyncio.start_server(Server(history=store).handle, "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]
        async with server:
            # A live session's events get through.
            await asyncio.to_thread(
                _post_event, port, {"event_type": "PreToolUse", "session_key": "live"}
            )
            # The tombstoned session's events are ALL dropped, including a
            # later SessionStart (a still-running agent's periodic event).
            await asyncio.to_thread(
                _post_event, port, {"event_type": "PreToolUse", "session_key": "ghost"}
            )
            await asyncio.to_thread(
                _post_event, port, {"event_type": "SessionStart", "session_key": "ghost"}
            )
            body = await asyncio.to_thread(_get, port, "/events")
        return list(json.loads(body)["events"])

    events = asyncio.run(scenario())
    keys = [e.get("session_key") for e in events]
    assert "live" in keys
    assert "ghost" not in keys  # nothing from the deleted session, not even SessionStart


def test_clear_tombstones_revives_deleted_sessions(tmp_path: Path) -> None:
    """rubberduck restart clears tombstones so a still-running agent reappears."""
    from rubberduck.persistence.history import HistoryStore

    store = HistoryStore(tmp_path / "db.sqlite")
    store.delete_session("ghost")
    assert store.is_tombstoned("ghost") is True
    cleared = store.clear_tombstones()
    assert cleared == 1
    assert store.is_tombstoned("ghost") is False  # now its events flow again


def test_stop_closes_the_terminal_tab_for_a_launched_session(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A session Rubberduck launched into a terminal tab has no PTY supervisor,
    so stop must fall back to closing the tab by its recorded tty (not 404)."""
    import rubberduck.server as server_mod
    from rubberduck.persistence.history import HistoryStore

    store = HistoryStore(tmp_path / "db.sqlite")
    store.record({"event_type": "SessionStart", "session_key": "tabbed", "_ts": 1, "_id": "a"})
    store.mark_heartbeat("tabbed")
    store.touch("tabbed", 2, tty="/dev/ttys042")

    closed: dict = {}

    def fake_close(tty: str) -> bool:
        closed["tty"] = tty
        return True

    monkeypatch.setattr(server_mod, "close_terminal_by_tty", fake_close)

    async def scenario() -> dict[str, object]:
        server = await asyncio.start_server(Server(history=store).handle, "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]
        async with server:
            body = await asyncio.to_thread(_post, port, "/sessions/tabbed/stop")
        return dict(json.loads(body))

    result = asyncio.run(scenario())
    assert result["stopped"] is True
    assert closed["tty"] == "/dev/ttys042"  # closed the right tab
    # Stop is a resumable pause, not a terminate: state is now 'stopped'.
    assert store.session("tabbed")["state"] == "stopped"


def test_resume_relaunches_a_stopped_session(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Resume reopens a stopped launched session in its saved cwd. For
    claude-code it continues the conversation with the recorded session id."""
    import rubberduck.server as server_mod
    from rubberduck.persistence.history import HistoryStore

    store = HistoryStore(tmp_path / "db.sqlite")
    store.record(
        {
            "event_type": "SessionStart",
            "session_key": "resumable",
            "session_id": "claude-sid-123",
            "runtime": "claude-code",
            "cwd": "/tmp/proj",
            "_ts": 1,
            "_id": "a",
        }
    )
    store.mark_heartbeat("resumable")
    store.set_state("resumable", "stopped", now=2)

    opened: dict = {}

    def fake_open(cwd, argv, **kw):  # type: ignore[no-untyped-def]
        opened["cwd"] = cwd
        opened["argv"] = argv
        return True

    monkeypatch.setattr(server_mod, "open_in_terminal", fake_open)

    async def scenario() -> dict[str, object]:
        server = await asyncio.start_server(Server(history=store).handle, "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]
        async with server:
            body = await asyncio.to_thread(_post, port, "/sessions/resumable/resume")
        return dict(json.loads(body))

    result = asyncio.run(scenario())
    assert result["resumed"] is True
    assert opened["cwd"] == "/tmp/proj"
    assert opened["argv"] == ["claude", "--resume", "claude-sid-123"]
    assert store.session("resumable")["state"] == "busy"


def test_archive_then_unarchive_round_trip(tmp_path: Path) -> None:
    """Archive hides a session (keeps its history); unarchive brings it back as
    a stopped (resumable) row."""
    from rubberduck.persistence.history import HistoryStore

    store = HistoryStore(tmp_path / "db.sqlite")
    # Archive is launched-only, so seed a launched session.
    store.record(
        {
            "event_type": "SessionStart",
            "session_key": "keep",
            "launched": True,
            "_ts": 1,
            "_id": "a",
        }
    )

    async def scenario() -> tuple[str, str]:
        server = await asyncio.start_server(Server(history=store).handle, "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]
        async with server:
            await asyncio.to_thread(_post, port, "/sessions/keep/archive")
            after_archive = store.session("keep")["state"]
            await asyncio.to_thread(_post, port, "/sessions/keep/unarchive")
            after_unarchive = store.session("keep")["state"]
        return after_archive, after_unarchive

    archived, unarchived = asyncio.run(scenario())
    assert archived == "archived"
    assert unarchived == "stopped"  # back in view, resumable
    assert store.session("keep") is not None  # history kept


def test_watched_session_cannot_be_archived_via_handler(tmp_path: Path) -> None:
    """The Archive HTTP action is launched-only: a watched session is rejected
    with 400 and stays in its current state (not hidden)."""
    from rubberduck.persistence.history import HistoryStore

    store = HistoryStore(tmp_path / "db.sqlite")
    store.record({"event_type": "SessionStart", "session_key": "w", "_ts": 1, "_id": "a"})

    async def scenario() -> int:
        server = await asyncio.start_server(Server(history=store).handle, "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]
        async with server:
            req = urllib.request.Request(
                f"http://127.0.0.1:{port}/sessions/w/archive",
                data=b"",
                headers={"X-Rubberduck-Token": _token()},
                method="POST",
            )
            try:
                return await asyncio.to_thread(
                    lambda: urllib.request.urlopen(req, timeout=2).status
                )
            except urllib.error.HTTPError as e:
                return e.code

    assert asyncio.run(scenario()) == 400
    assert store.session("w")["state"] != "archived"


def test_watched_session_archived_when_its_agent_pid_dies(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A watched session (no heartbeat) is auto-archived when its recorded agent
    pid is no longer alive — its terminal is gone."""
    import rubberduck.server as server_mod
    from rubberduck.persistence.history import HistoryStore

    store = HistoryStore(tmp_path / "db.sqlite")
    # A watched (launched=0) session with a recorded agent pid.
    store.record(
        {"event_type": "SessionStart", "session_key": "w", "agent_pid": 99999, "_ts": 1, "_id": "a"}
    )
    srv = Server(history=store)
    # Pretend the agent process is gone.
    monkeypatch.setattr(server_mod, "_pid_alive", lambda pid: False)

    # Run one sweep iteration's watched check directly.
    for entry in store.live_watched():
        if not server_mod._pid_alive(int(entry["agent_pid"])):
            srv._archive_swept(str(entry["session_key"]))

    assert store.session("w")["state"] == "archived"


def test_stream_init_omits_deleted_session(tmp_path: Path) -> None:
    """A session's SessionStart can sit in the ring buffer when the session is
    later deleted. The /stream init replay must not include it — otherwise a
    fresh page load (empty client tombstone Set) re-creates the deleted row."""
    from rubberduck.persistence.history import HistoryStore

    store = HistoryStore(tmp_path / "db.sqlite")

    async def scenario() -> dict[str, object]:
        srv = Server(history=store)
        server = await asyncio.start_server(srv.handle, "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]
        async with server:
            # Start two sessions — both land in the ring buffer.
            await asyncio.to_thread(
                _post_event, port, {"event_type": "SessionStart", "session_key": "keep"}
            )
            await asyncio.to_thread(
                _post_event, port, {"event_type": "SessionStart", "session_key": "gone"}
            )
            # Delete one (tombstones it) — but its SessionStart stays in the buffer.
            store.delete_session("gone")

            reader, writer = await asyncio.open_connection("127.0.0.1", port)
            writer.write(b"GET /stream HTTP/1.1\r\nHost: x\r\n\r\n")
            await writer.drain()
            init = await _read_sse_frame(reader)
            writer.close()
        return init

    init = asyncio.run(scenario())
    keys = {e.get("session_key") for e in init["events"]}  # type: ignore[union-attr]
    assert "keep" in keys
    assert "gone" not in keys  # the deleted session must not replay


def test_root_carries_self_probe_header() -> None:
    async def scenario() -> str:
        server = await asyncio.start_server(Server().handle, "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]
        async with server:
            reader, writer = await asyncio.open_connection("127.0.0.1", port)
            writer.write(b"GET / HTTP/1.1\r\nHost: x\r\n\r\n")
            await writer.drain()
            head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 2)
            writer.close()
        return head.decode("latin-1").lower()

    head = asyncio.run(scenario())
    assert SELF_PROBE_HEADER.lower() in head


def test_invalid_json_rejected() -> None:
    async def scenario() -> int:
        server = await asyncio.start_server(Server().handle, "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]
        async with server:
            return await asyncio.to_thread(_post_raw_status, port, b"{not json")

    assert asyncio.run(scenario()) == 400


def _launch_capturing_argv(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, payload: dict[str, object]
) -> list[str]:
    """Run a terminal launch with open_in_terminal stubbed, return the argv it
    would have run in the terminal."""
    import rubberduck.server as server_mod
    from rubberduck.persistence.history import HistoryStore

    captured: dict[str, list[str]] = {}
    monkeypatch.setattr(
        server_mod,
        "open_in_terminal",
        lambda cwd, argv, **kw: captured.update(argv=argv) or True,
    )

    async def scenario() -> None:
        store = HistoryStore(tmp_path / "db.sqlite")
        srv = await asyncio.start_server(Server(history=store).handle, "127.0.0.1", 0)
        port = srv.sockets[0].getsockname()[1]
        async with srv:
            req = urllib.request.Request(
                f"http://127.0.0.1:{port}/sessions/launch",
                data=json.dumps(payload).encode(),
                headers={"Content-Type": "application/json", "X-Rubberduck-Token": _token()},
                method="POST",
            )
            await asyncio.to_thread(lambda: urllib.request.urlopen(req, timeout=2).read())

    asyncio.run(scenario())
    return captured["argv"]


def test_terminal_launch_passes_prompt_to_the_agent(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A New-session terminal launch must hand the prompt to the agent, not just
    record it as `intention`. claude appends it as a positional arg."""
    argv = _launch_capturing_argv(
        tmp_path,
        monkeypatch,
        {
            "command": "claude",
            "runtime": "claude-code",
            "cwd": str(tmp_path),
            "prompt": "add a healthcheck endpoint",
            "session_key": "p",
        },
    )
    assert argv == ["claude", "add a healthcheck endpoint"]


def test_terminal_launch_uses_copilot_prompt_flag(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Copilot takes the prompt via `-p`, not positionally — proving the launch
    routes through the runtime adapter, not a hardcoded append."""
    argv = _launch_capturing_argv(
        tmp_path,
        monkeypatch,
        {
            "command": "copilot",
            "runtime": "copilot",
            "cwd": str(tmp_path),
            "prompt": "fix the bug",
            "session_key": "p",
        },
    )
    assert argv == ["copilot", "-p", "fix the bug"]


def test_terminal_launch_without_prompt_runs_bare_command(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """No prompt → the agent opens with just its command (no empty trailing arg)."""
    argv = _launch_capturing_argv(
        tmp_path,
        monkeypatch,
        {"command": "claude", "runtime": "claude-code", "cwd": str(tmp_path), "session_key": "p"},
    )
    assert argv == ["claude"]


def _token() -> str:
    from rubberduck.helpers import security

    return security.load_or_create_token()


def _post_event(port: int, payload: dict[str, object]) -> None:
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}/events",
        data=json.dumps(payload).encode(),
        headers={
            "Content-Type": "application/json",
            "X-Rubberduck-Token": _token(),
        },
        method="POST",
    )
    urllib.request.urlopen(req, timeout=2).read()


def _post_raw_status(port: int, body: bytes) -> int:
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}/events",
        data=body,
        headers={"X-Rubberduck-Token": _token()},
        method="POST",
    )
    try:
        return urllib.request.urlopen(req, timeout=2).status
    except urllib.error.HTTPError as e:
        return e.code


def _get(port: int, path: str) -> str:
    return urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=2).read().decode()


def _post(port: int, path: str) -> str:
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}{path}",
        data=b"",
        headers={"X-Rubberduck-Token": _token()},
        method="POST",
    )
    return urllib.request.urlopen(req, timeout=2).read().decode()


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__]))
