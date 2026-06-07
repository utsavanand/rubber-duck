"""asyncio HTTP/1.1 server.

    POST /events              ingest one JSON event; returns the stamped event
    GET  /events              last 100 events as JSON (polling fallback)
    GET  /sessions            persisted session rows, incl. terminated (SQLite)
    GET  /tree                fork lineage: nodes with parent_session_key
    GET  /approvals           pending permission requests awaiting a decision
    POST /approvals/:id/decide  answer an approval {decision: approve|deny}
    POST /sessions/launch     spawn a supervised agent {command, cwd, ...}
    POST /sessions/compare    launch one prompt as N variants side by side
    POST /sessions/:key/fork  fork a session: child worktree off parent's branch
    POST /sessions/:key/fork-conversation  branch the Claude conversation (--fork-session)
    POST /sessions/:key/stop  terminate a supervised agent
    DELETE /sessions/:key     remove a session and its events/metrics/checkpoints
    POST /sessions/clear-terminated  delete all terminated sessions
    POST /sessions/:key/checkpoint   record what was done (prompts/files/tools/git + summary)
    GET  /sessions/:key/checkpoints   list checkpoint records
    POST /sessions/:key/spotlight     apply worktree changes onto the main checkout
    GET  /sessions/:key/diff          git diff of the session's worktree
    GET  /sessions/:key/output        SSE: live agent output (PTY) lines
    POST /sessions/:key/input         write to the agent's stdin (terminal-attach)
    POST /snapshots           bundle recently-active sessions to disk
    GET  /snapshots           list snapshots
    GET  /snapshots/:id       fetch a snapshot manifest
    POST /snapshots/:id/sessions/:key/restore  relaunch a session in a terminal
    GET  /stream              SSE: {type:"init", events:[...]} then per-event frames
    GET  /ws                  WebSocket: same event stream, bidirectional
    GET  /                    liveness; carries the X-Rubberduck self-probe header

Hand-rolled over asyncio rather than a framework: routing is trivial and SSE
wants direct control of the response stream. Zero runtime dependencies.
"""

import asyncio
import contextlib
import json
import shlex
import subprocess
import time
from pathlib import Path
from typing import Any

from rubberduck import gitdetect
from rubberduck.approvals import ApprovalRegistry
from rubberduck.checkpoints import build_checkpoint
from rubberduck.eventbus import Event, EventBus
from rubberduck.history import HistoryStore
from rubberduck.orchestrator import Orchestrator, StateRuntime
from rubberduck.runtimes.claude_code import ClaudeCodeRuntime
from rubberduck.runtimes.codex import CodexRuntime
from rubberduck.runtimes.generic import GenericRuntime
from rubberduck.snapshots import SnapshotManager, restore_command_for
from rubberduck.spotlight import spotlight_to_main
from rubberduck.terminal import available_terminals, open_in_terminal
from rubberduck.websocket import (
    close_frame,
    encode_text_frame,
    handshake_response,
    read_frame_opcode,
)
from rubberduck.worktrees import GitError


def _build_runtime(name: str, command: str) -> StateRuntime:
    if name == "claude-code":
        return ClaudeCodeRuntime(command)
    if name == "codex":
        return CodexRuntime(command)
    return GenericRuntime(command)


class Route:
    """One routing rule: match a (method, path) and invoke a handler. A path
    matches exactly, or by prefix+suffix for routes with a :segment in the
    middle (e.g. POST /sessions/:key/fork). `call` adapts to each handler's
    arguments so the handlers themselves stay simple."""

    def __init__(
        self,
        method: str,
        matcher: str,
        call: "RouteCall",
        *,
        prefix: str | None = None,
        suffix: str | None = None,
    ) -> None:
        self.method = method
        self.matcher = matcher  # exact path, or "" when prefix/suffix used
        self.prefix = prefix
        self.suffix = suffix
        self.call = call

    def matches(self, method: str, path: str) -> bool:
        if method != self.method:
            return False
        if self.prefix is not None and self.suffix is not None:
            return path.startswith(self.prefix) and path.endswith(self.suffix)
        if self.prefix is not None:
            return path.startswith(self.prefix)
        return path == self.matcher

    def segment(self, path: str) -> str:
        """The :segment captured between prefix and suffix (or '' / the prefix
        remainder for prefix-only routes)."""
        if self.prefix is None:
            return ""
        end = -len(self.suffix) if self.suffix else len(path)
        return path[len(self.prefix) : end]


# Each handler receives (server, reader, writer, headers, body, segment) and
# uses only what it needs. Grouped by concern.
RouteCall = Any  # an async callable; kept loose to allow per-route adapters


def _mid(prefix: str, suffix: str) -> dict[str, str]:
    return {"prefix": prefix, "suffix": suffix}


# fmt: off
_ROUTES: list[Route] = [
    # ── ingest ──
    Route("POST", "/events", lambda s, r, w, h, b, seg: s._ingest(w, b)),
    # ── query ──
    Route("GET", "/events", lambda s, r, w, h, b, seg: s._recent(w)),
    Route("GET", "/sessions", lambda s, r, w, h, b, seg: s._sessions(w)),
    Route("GET", "/tree", lambda s, r, w, h, b, seg: s._tree(w)),
    Route("GET", "/approvals", lambda s, r, w, h, b, seg: s._list_approvals(w)),
    Route("GET", "/terminals", lambda s, r, w, h, b, seg: s._terminals(w)),
    Route("GET", "/snapshots", lambda s, r, w, h, b, seg: s._list_snapshots(w)),
    Route("GET", "", lambda s, r, w, h, b, seg: s._diff(w, seg), **_mid("/sessions/", "/diff")),
    Route("GET", "", lambda s, r, w, h, b, seg: s._list_checkpoints(w, seg),
          **_mid("/sessions/", "/checkpoints")),
    # ── control ──
    Route("POST", "/sessions/launch", lambda s, r, w, h, b, seg: s._launch(w, b)),
    Route("POST", "/sessions/compare", lambda s, r, w, h, b, seg: s._compare(w, b)),
    Route("POST", "/sessions/clear-terminated",
          lambda s, r, w, h, b, seg: s._clear_terminated(w)),
    Route("DELETE", "", lambda s, r, w, h, b, seg: s._delete_session(w, seg),
          prefix="/sessions/"),
    Route("POST", "", lambda s, r, w, h, b, seg: s._fork_conversation(w, seg, b),
          **_mid("/sessions/", "/fork-conversation")),
    Route("POST", "", lambda s, r, w, h, b, seg: s._fork(w, seg, b),
          **_mid("/sessions/", "/fork")),
    Route("POST", "", lambda s, r, w, h, b, seg: s._stop(w, seg),
          **_mid("/sessions/", "/stop")),
    Route("POST", "", lambda s, r, w, h, b, seg: s._checkpoint(w, seg, b),
          **_mid("/sessions/", "/checkpoint")),
    Route("POST", "", lambda s, r, w, h, b, seg: s._spotlight(w, seg),
          **_mid("/sessions/", "/spotlight")),
    Route("POST", "", lambda s, r, w, h, b, seg: s._input(w, seg, b),
          **_mid("/sessions/", "/input")),
    Route("POST", "", lambda s, r, w, h, b, seg: s._decide_approval(w, seg, b),
          **_mid("/approvals/", "/decide")),
    Route("POST", "/snapshots", lambda s, r, w, h, b, seg: s._create_snapshot(w)),
    Route("POST", "", lambda s, r, w, h, b, seg: s._restore(w, seg),
          **_mid("/snapshots/", "/restore")),
    # ── streams ──
    Route("GET", "", lambda s, r, w, h, b, seg: s._output(r, w, seg),
          **_mid("/sessions/", "/output")),
    Route("GET", "/stream", lambda s, r, w, h, b, seg: s._stream(r, w)),
    Route("GET", "/ws", lambda s, r, w, h, b, seg: s._websocket(r, w, h)),
    # ── snapshot fetch (prefix-only; keep AFTER /snapshots/:id/restore) ──
    Route("GET", "", lambda s, r, w, h, b, seg: s._get_snapshot(w, seg), prefix="/snapshots/"),
    # ── dashboard (prefix-only catch for / and /assets/*) ──
    Route("GET", "/", lambda s, r, w, h, b, seg: s._dashboard(w, "/")),
    Route("GET", "", lambda s, r, w, h, b, seg: s._dashboard(w, "/assets/" + seg),
          prefix="/assets/"),
]
# fmt: on


SELF_PROBE_HEADER = "X-Rubberduck"
KEEPALIVE_SECONDS = 15


class Server:
    def __init__(self, bus: EventBus | None = None, history: HistoryStore | None = None) -> None:
        self.history = history if history is not None else HistoryStore()
        self.bus = bus if bus is not None else EventBus(sink=self._sink)
        self.orchestrator = Orchestrator(self.bus, history=self.history)
        self.snapshots = SnapshotManager(self.history)
        self.approvals = ApprovalRegistry(self.orchestrator.inject_key)

    def _sink(self, event: dict[str, Any]) -> None:
        """Fan a published event to the durable store and the approval registry.
        Enrich watched sessions with git state detected from their cwd, so they
        too can show repo/branch and be forked into a worktree."""
        self._enrich_git(event)
        self.history.record(event)
        self.approvals.from_event(event)
        if event.get("event_type") == "SessionEnd":
            key = event.get("session_key") or event.get("session_id")
            if key:
                self.approvals.drop_session(str(key))

    def _enrich_git(self, event: dict[str, Any]) -> None:
        """If an event has a cwd but no repo/branch yet (a watched session),
        detect git state from the cwd and add it. Cached per cwd, so this is
        effectively once per session, not per event."""
        cwd = event.get("cwd")
        if not cwd or event.get("repo_path") or event.get("branch"):
            return
        info = gitdetect.detect(str(cwd))
        if info is not None:
            event["repo_path"] = info.repo_path
            event["branch"] = info.branch
            event.setdefault("source_app", info.repo_name)

    async def handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            request_line = await reader.readline()
            if not request_line:
                return
            method, path = _parse_request_line(request_line)
            headers = await _read_headers(reader)
            body = await _read_body(reader, headers)
            await self._dispatch(method, path, reader, writer, headers, body)
        except (ConnectionResetError, BrokenPipeError, asyncio.IncompleteReadError):
            pass
        finally:
            writer.close()

    async def _dispatch(
        self,
        method: str,
        path: str,
        reader: asyncio.StreamReader,
        writer: asyncio.StreamWriter,
        headers: dict[str, str],
        body: bytes,
    ) -> None:
        for route in self._routes():
            if route.matches(method, path):
                await route.call(self, reader, writer, headers, body, route.segment(path))
                return
        await _write_response(writer, 404, "not found")

    def _routes(self) -> list["Route"]:
        # Grouped by concern. Each Route binds a (method, matcher) to a handler
        # and declares which args it wants — keeps dispatch declarative.
        return _ROUTES

    async def _dashboard(self, writer: asyncio.StreamWriter, path: str) -> None:
        """Serve the built React dashboard so there's one URL. The self-probe
        header rides on every response. Falls back to a hint if not built."""
        dist = dashboard_dir()
        if dist is None:
            await _write_response(
                writer,
                200,
                "Rubberduck server is running. Build the dashboard "
                "(cd web && npm run build) to serve the UI here.",
                extra_headers={SELF_PROBE_HEADER: "1"},
            )
            return
        rel = "index.html" if path == "/" else path.lstrip("/")
        target = (dist / rel).resolve()
        if not str(target).startswith(str(dist.resolve())) or not target.is_file():
            target = dist / "index.html"  # SPA fallback
        await _write_file(writer, target)

    async def _ingest(self, writer: asyncio.StreamWriter, body: bytes) -> None:
        try:
            raw: Any = json.loads(body or b"{}")
        except json.JSONDecodeError:
            await _write_json(writer, 400, {"error": "invalid JSON"})
            return
        if not isinstance(raw, dict):
            await _write_json(writer, 400, {"error": "event must be a JSON object"})
            return
        event = self.bus.publish(raw)
        await _write_json(writer, 200, event)

    async def _recent(self, writer: asyncio.StreamWriter) -> None:
        await _write_json(writer, 200, {"events": self.bus.recent()})

    async def _sessions(self, writer: asyncio.StreamWriter) -> None:
        await _write_json(writer, 200, {"sessions": self.history.sessions()})

    async def _launch(self, writer: asyncio.StreamWriter, body: bytes) -> None:
        try:
            req: Any = json.loads(body or b"{}")
        except json.JSONDecodeError:
            await _write_json(writer, 400, {"error": "invalid JSON"})
            return
        command = req.get("command")
        cwd = req.get("cwd")
        repo_path = req.get("repo_path")
        if not command or (not cwd and not repo_path):
            await _write_json(
                writer, 400, {"error": "command and one of cwd/repo_path are required"}
            )
            return
        try:
            key = await self.orchestrator.launch(
                runtime=_build_runtime(req.get("runtime", "generic"), command),
                cwd=cwd,
                repo_path=repo_path,
                branch=req.get("branch"),
                session_key=req.get("session_key"),
                prompt=req.get("prompt", ""),
            )
        except (GitError, ValueError) as e:
            await _write_json(writer, 400, {"error": str(e)})
            return
        await _write_json(writer, 200, {"session_key": key})

    async def _fork(self, writer: asyncio.StreamWriter, parent_key: str, body: bytes) -> None:
        parent = self.history.session(parent_key)
        if parent is None:
            await _write_json(writer, 404, {"error": f"no session {parent_key}"})
            return
        if not parent.get("repo_path") or not parent.get("branch"):
            await _write_json(writer, 400, {"error": "parent has no worktree to fork from"})
            return
        try:
            req: Any = json.loads(body or b"{}")
        except json.JSONDecodeError:
            await _write_json(writer, 400, {"error": "invalid JSON"})
            return
        command = req.get("command") or "claude"
        repo = Path(str(parent["repo_path"]))
        branch = req.get("branch") or f"fork/{parent_key[:8]}"
        base = str(parent["branch"])

        # Headless: let the orchestrator create the worktree and supervise the
        # agent (used by tests / non-interactive forks).
        if not req.get("in_terminal", True):
            runtime_name = req.get("runtime", parent.get("runtime") or "generic")
            try:
                key = await self.orchestrator.launch(
                    runtime=_build_runtime(runtime_name, command),
                    repo_path=str(repo),
                    branch=branch,
                    base=base,
                    parent_session_key=parent_key,
                    session_key=req.get("session_key"),
                    prompt=req.get("prompt", ""),
                )
            except (GitError, ValueError) as e:
                await _write_json(writer, 400, {"error": str(e)})
                return
            await _write_json(writer, 200, {"session_key": key, "parent_session_key": parent_key})
            return

        # Default: create the worktree and open the agent in a terminal you can
        # drive (an interactive agent like claude needs a real terminal).
        try:
            worktree = self.orchestrator.worktrees.add(repo, branch, base=base)
        except (GitError, ValueError) as e:
            await _write_json(writer, 400, {"error": str(e)})
            return
        opened = open_in_terminal(str(worktree.path), shlex.split(command), app=req.get("terminal"))
        # Record a tracked row so the fork shows its lineage even though the
        # terminal session reports under its own (unpredictable) session id.
        child_key = req.get("session_key") or f"fork-{branch}"
        self.bus.publish(
            {
                "event_type": "SessionStart",
                "session_key": child_key,
                "source_app": repo.name,
                "runtime": parent.get("runtime") or "claude-code",
                "repo_path": str(repo),
                "worktree_path": str(worktree.path),
                "branch": worktree.branch,
                "parent_session_key": parent_key,
                "intention": f"fork of {parent.get('source_app') or parent_key} ({base})",
            }
        )
        await _write_json(
            writer,
            200,
            {
                "session_key": child_key,
                "parent_session_key": parent_key,
                "opened_in_terminal": opened,
                "worktree": str(worktree.path),
                "branch": worktree.branch,
                "command": command,
            },
        )

    async def _fork_conversation(
        self, writer: asyncio.StreamWriter, parent_key: str, body: bytes
    ) -> None:
        """Branch the *conversation* (not the code): open `claude --resume <id>
        --fork-session` in a NEW terminal window so you can interact with the
        forked conversation. Claude is interactive, so it belongs in a real
        terminal, not a headless PTY. Only for a claude-code session whose
        Claude session_id is known."""
        parent = self.history.session(parent_key)
        if parent is None:
            await _write_json(writer, 404, {"error": f"no session {parent_key}"})
            return
        if (parent.get("runtime") or "") != "claude-code":
            await _write_json(
                writer, 400, {"error": "conversation fork is only for claude-code sessions"}
            )
            return
        session_id = self.history.session_id_for(parent_key)
        if not session_id:
            await _write_json(
                writer, 400, {"error": "no Claude session_id recorded for this session yet"}
            )
            return
        req = json.loads(body or b"{}")
        cwd = str(parent.get("cwd") or ".")
        argv = ["claude", "--resume", session_id, "--fork-session"]
        opened = open_in_terminal(cwd, argv, app=req.get("terminal"))
        # Record a row so the conversation fork shows its lineage.
        child_key = f"convfork-{session_id[:8]}"
        self.bus.publish(
            {
                "event_type": "SessionStart",
                "session_key": child_key,
                "source_app": parent.get("source_app") or "fork",
                "runtime": "claude-code",
                "cwd": cwd,
                "parent_session_key": parent_key,
                "intention": f"conversation fork of {parent.get('source_app') or parent_key}",
            }
        )
        await _write_json(
            writer,
            200,
            {
                "session_key": child_key,
                "parent_session_key": parent_key,
                "opened_in_terminal": opened,
                "command": " ".join(argv),
                "cwd": cwd,
            },
        )

    async def _stop(self, writer: asyncio.StreamWriter, session_key: str) -> None:
        stopped = await self.orchestrator.stop(session_key)
        status = 200 if stopped else 404
        await _write_json(writer, status, {"stopped": stopped, "session_key": session_key})

    async def _delete_session(self, writer: asyncio.StreamWriter, session_key: str) -> None:
        # Stop it first if it's live (best-effort), then drop it from the DB.
        await self.orchestrator.stop(session_key)
        deleted = self.history.delete_session(session_key)
        self.approvals.drop_session(session_key)
        status = 200 if deleted else 404
        await _write_json(writer, status, {"deleted": deleted, "session_key": session_key})

    async def _clear_terminated(self, writer: asyncio.StreamWriter) -> None:
        keys = self.history.clear_terminated()
        await _write_json(writer, 200, {"cleared": len(keys), "session_keys": keys})

    async def _tree(self, writer: asyncio.StreamWriter) -> None:
        await _write_json(writer, 200, {"nodes": self.history.fork_tree()})

    async def _terminals(self, writer: asyncio.StreamWriter) -> None:
        await _write_json(writer, 200, {"terminals": available_terminals()})

    async def _list_approvals(self, writer: asyncio.StreamWriter) -> None:
        pending = [
            {
                "id": a.id,
                "session_key": a.session_key,
                "tool_name": a.tool_name,
                "detail": a.detail,
                "created_at": a.created_at,
                # Rubberduck can only answer sessions it launched (owns the PTY/
                # tmux). Hook-watched sessions run in your own terminal, so the
                # UI should not present Approve/Deny as actionable for them.
                "reachable": self.orchestrator.get(a.session_key) is not None,
            }
            for a in self.approvals.pending()
        ]
        await _write_json(writer, 200, {"approvals": pending})

    async def _decide_approval(
        self, writer: asyncio.StreamWriter, approval_id: str, body: bytes
    ) -> None:
        decision = json.loads(body or b"{}").get("decision")
        if decision not in ("approve", "deny"):
            await _write_json(writer, 400, {"error": "decision must be approve or deny"})
            return
        landed = self.approvals.decide(approval_id, decision)
        status = 200 if landed else 409
        await _write_json(writer, status, {"decided": landed, "decision": decision})

    def _worktree_of(self, session_key: str) -> str | None:
        row = self.history.session(session_key)
        if row is None:
            return None
        wt = row.get("worktree_path")
        return str(wt) if wt else None

    async def _checkpoint(
        self, writer: asyncio.StreamWriter, session_key: str, body: bytes
    ) -> None:
        row = self.history.session(session_key)
        if row is None:
            await _write_json(writer, 404, {"error": f"no session {session_key}"})
            return
        label = json.loads(body or b"{}").get("label", "checkpoint")
        cwd = Path(str(row.get("worktree_path") or row.get("cwd") or "."))
        cp = await asyncio.to_thread(
            build_checkpoint,
            session_key=session_key,
            label=label,
            cwd=cwd,
            events=self.history.events_for(session_key),
            intention=str(row.get("intention") or ""),
            now_ms=int(time.time() * 1000),
        )
        self.history.add_checkpoint(
            checkpoint_id=cp.id,
            session_key=cp.session_key,
            label=cp.label,
            summary=cp.summary,
            record=cp.record,
            markdown_path=cp.markdown_path,
            created_at=cp.created_at,
        )
        await _write_json(writer, 200, {"id": cp.id, "label": cp.label, "summary": cp.summary})

    async def _list_checkpoints(self, writer: asyncio.StreamWriter, session_key: str) -> None:
        await _write_json(writer, 200, {"checkpoints": self.history.checkpoints(session_key)})

    async def _spotlight(self, writer: asyncio.StreamWriter, session_key: str) -> None:
        row = self.history.session(session_key)
        if row is None or not row.get("worktree_path") or not row.get("repo_path"):
            await _write_json(writer, 400, {"error": "session has no worktree/repo"})
            return
        try:
            files = spotlight_to_main(
                repo=Path(str(row["repo_path"])), worktree=Path(str(row["worktree_path"]))
            )
        except GitError as e:
            await _write_json(writer, 400, {"error": str(e)})
            return
        await _write_json(writer, 200, {"synced_files": files})

    async def _diff(self, writer: asyncio.StreamWriter, session_key: str) -> None:
        worktree = self._worktree_of(session_key)
        if not worktree:
            await _write_json(writer, 200, {"diff": ""})
            return
        result = await asyncio.to_thread(
            subprocess.run,
            ["git", "-C", worktree, "diff", "HEAD"],
            capture_output=True,
            text=True,
        )
        await _write_json(writer, 200, {"diff": result.stdout})

    async def _input(self, writer: asyncio.StreamWriter, session_key: str, body: bytes) -> None:
        supervisor = self.orchestrator.get(session_key)
        if supervisor is None:
            await _write_json(
                writer, 404, {"error": "no live session (not launched by Rubberduck)"}
            )
            return
        text = json.loads(body or b"{}").get("text", "")
        wrote = supervisor.write_input(text)
        await _write_json(writer, 200 if wrote else 409, {"written": wrote})

    async def _output(
        self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter, session_key: str
    ) -> None:
        supervisor = self.orchestrator.get(session_key)
        if supervisor is None:
            await _write_json(writer, 404, {"error": "no live session to stream"})
            return
        writer.write(
            b"HTTP/1.1 200 OK\r\n"
            b"Content-Type: text/event-stream\r\n"
            b"Cache-Control: no-cache\r\n\r\n"
        )
        await writer.drain()
        feed = supervisor.subscribe_output()
        disconnect = asyncio.ensure_future(reader.read())
        try:
            while True:
                nxt = asyncio.ensure_future(feed.__anext__())
                done, _ = await asyncio.wait(
                    {nxt, disconnect},
                    timeout=KEEPALIVE_SECONDS,
                    return_when=asyncio.FIRST_COMPLETED,
                )
                if disconnect in done:
                    nxt.cancel()
                    break
                if nxt not in done:
                    nxt.cancel()
                    writer.write(b": keepalive\r\n\r\n")
                    await writer.drain()
                    continue
                writer.write(f"data: {json.dumps({'line': nxt.result()})}\n\n".encode())
                await writer.drain()
        finally:
            disconnect.cancel()
            await feed.aclose()

    async def _compare(self, writer: asyncio.StreamWriter, body: bytes) -> None:
        try:
            req: Any = json.loads(body or b"{}")
        except json.JSONDecodeError:
            await _write_json(writer, 400, {"error": "invalid JSON"})
            return
        repo_path = req.get("repo_path")
        prompt = req.get("prompt", "")
        variants = req.get("variants")
        if not repo_path or not isinstance(variants, list) or not variants:
            await _write_json(
                writer, 400, {"error": "repo_path and a non-empty variants list are required"}
            )
            return
        group = req.get("group") or f"cmp-{int(time.time() * 1000)}"
        keys = []
        try:
            for i, v in enumerate(variants):
                key = await self.orchestrator.launch(
                    runtime=_build_runtime(v.get("runtime", "generic"), v["command"]),
                    repo_path=repo_path,
                    branch=f"{group}/{v.get('runtime', 'generic')}-{i}",
                    prompt=prompt,
                    compare_group=group,
                )
                keys.append(key)
        except (GitError, ValueError, KeyError) as e:
            await _write_json(writer, 400, {"error": str(e)})
            return
        await _write_json(writer, 200, {"group": group, "session_keys": keys})

    async def _create_snapshot(self, writer: asyncio.StreamWriter) -> None:
        snapshot_id = self.snapshots.create(now_ms=int(time.time() * 1000))
        await _write_json(writer, 200, {"id": snapshot_id})

    async def _list_snapshots(self, writer: asyncio.StreamWriter) -> None:
        await _write_json(writer, 200, {"snapshots": self.snapshots.list()})

    async def _get_snapshot(self, writer: asyncio.StreamWriter, snapshot_id: str) -> None:
        manifest = self.snapshots.get(snapshot_id)
        if manifest is None:
            await _write_json(writer, 404, {"error": f"no snapshot {snapshot_id}"})
            return
        await _write_json(writer, 200, manifest)

    async def _restore(self, writer: asyncio.StreamWriter, route: str) -> None:
        # route is "<snapshot_id>/sessions/<session_key>"
        parts = route.split("/sessions/")
        if len(parts) != 2:
            await _write_json(writer, 400, {"error": "bad restore path"})
            return
        snapshot_id, session_key = parts
        manifest = self.snapshots.get(snapshot_id)
        if manifest is None:
            await _write_json(writer, 404, {"error": f"no snapshot {snapshot_id}"})
            return
        session = next((s for s in manifest["sessions"] if s["session_key"] == session_key), None)
        if session is None:
            await _write_json(writer, 404, {"error": f"no session {session_key} in snapshot"})
            return
        argv = restore_command_for(session)
        cwd = str(session.get("worktree_path") or session.get("cwd") or ".")
        spawned = open_in_terminal(cwd, argv)
        await _write_json(writer, 200, {"restored": spawned, "command": " ".join(argv)})

    async def _stream(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        writer.write(
            b"HTTP/1.1 200 OK\r\n"
            b"Content-Type: text/event-stream\r\n"
            b"Cache-Control: no-cache\r\n"
            b"Connection: keep-alive\r\n" + f"{SELF_PROBE_HEADER}: 1\r\n\r\n".encode()
        )
        await writer.drain()
        _write_sse(writer, {"type": "init", "events": self.bus.recent()})
        await writer.drain()

        subscription = self.bus.subscribe()
        # An EOF on the client reader means they disconnected; race it against each
        # event wait so we stop promptly instead of blocking until the next keepalive.
        disconnect = asyncio.ensure_future(reader.read())
        try:
            while True:
                nxt = asyncio.ensure_future(subscription.next())
                done, _ = await asyncio.wait(
                    {nxt, disconnect},
                    timeout=KEEPALIVE_SECONDS,
                    return_when=asyncio.FIRST_COMPLETED,
                )
                if disconnect in done:
                    nxt.cancel()
                    break
                if nxt not in done:
                    nxt.cancel()
                    writer.write(b": keepalive\r\n\r\n")
                    await writer.drain()
                    continue
                _write_sse(writer, nxt.result())
                await writer.drain()
        finally:
            disconnect.cancel()
            subscription.close()

    async def _websocket(
        self,
        reader: asyncio.StreamReader,
        writer: asyncio.StreamWriter,
        headers: dict[str, str],
    ) -> None:
        """Bidirectional event stream over WebSocket, a sibling to /stream. Sends
        an init frame, then one text frame per event; closes on client close."""
        key = headers.get("sec-websocket-key")
        if not key:
            await _write_response(writer, 400, "expected a WebSocket upgrade")
            return
        writer.write(handshake_response(key))
        await writer.drain()
        writer.write(encode_text_frame(json.dumps({"type": "init", "events": self.bus.recent()})))
        await writer.drain()

        subscription = self.bus.subscribe()
        incoming = asyncio.ensure_future(read_frame_opcode(reader))
        try:
            while True:
                nxt = asyncio.ensure_future(subscription.next())
                done, _ = await asyncio.wait(
                    {nxt, incoming}, timeout=KEEPALIVE_SECONDS, return_when=asyncio.FIRST_COMPLETED
                )
                if incoming in done:
                    opcode = incoming.result()
                    nxt.cancel()
                    if opcode in (None, 0x8):  # EOF or close frame
                        break
                    incoming = asyncio.ensure_future(read_frame_opcode(reader))
                    continue
                if nxt not in done:
                    nxt.cancel()
                    continue  # keepalive tick; nothing to send
                writer.write(encode_text_frame(json.dumps(nxt.result())))
                await writer.drain()
        finally:
            incoming.cancel()
            subscription.close()
            with contextlib.suppress(OSError):
                writer.write(close_frame())
                await writer.drain()

    async def serve(self, host: str, port: int) -> None:
        adopted = await self.orchestrator.reconcile()
        if adopted:
            print(f"re-adopted {len(adopted)} tmux session(s): {', '.join(adopted)}")
        server = await asyncio.start_server(self.handle, host, port)
        async with server:
            await server.serve_forever()


def _parse_request_line(line: bytes) -> tuple[str, str]:
    parts = line.decode("latin-1").split()
    if len(parts) < 2:
        return "", ""
    return parts[0], parts[1]


async def _read_headers(reader: asyncio.StreamReader) -> dict[str, str]:
    headers: dict[str, str] = {}
    while True:
        line = await reader.readline()
        if line in (b"\r\n", b"\n", b""):
            break
        name, _, value = line.decode("latin-1").partition(":")
        headers[name.strip().lower()] = value.strip()
    return headers


async def _read_body(reader: asyncio.StreamReader, headers: dict[str, str]) -> bytes:
    length = int(headers.get("content-length", "0") or "0")
    return await reader.readexactly(length) if length else b""


def _sse_frame(event: Event) -> bytes:
    return f"data: {json.dumps(event)}\n\n".encode()


def _write_sse(writer: asyncio.StreamWriter, event: Event) -> None:
    writer.write(_sse_frame(event))


async def _write_response(
    writer: asyncio.StreamWriter,
    status: int,
    text: str,
    extra_headers: dict[str, str] | None = None,
) -> None:
    body = text.encode()
    head = f"HTTP/1.1 {status} {_REASON.get(status, 'OK')}\r\n"
    head += f"Content-Length: {len(body)}\r\nContent-Type: text/plain\r\n"
    for name, value in (extra_headers or {}).items():
        head += f"{name}: {value}\r\n"
    head += "Connection: close\r\n\r\n"
    writer.write(head.encode() + body)
    await writer.drain()


async def _write_json(writer: asyncio.StreamWriter, status: int, payload: Any) -> None:
    body = json.dumps(payload).encode()
    head = (
        f"HTTP/1.1 {status} {_REASON.get(status, 'OK')}\r\n"
        f"Content-Length: {len(body)}\r\n"
        "Content-Type: application/json\r\n"
        "Connection: close\r\n\r\n"
    )
    writer.write(head.encode() + body)
    await writer.drain()


_CONTENT_TYPES = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".json": "application/json",
    ".ico": "image/x-icon",
}


def dashboard_dir() -> Path | None:
    """Locate the built dashboard. Prefer the copy bundled in the installed
    package (src/rubberduck/dashboard); fall back to the dev build at web/dist
    so a repo checkout serves the freshly-built UI."""
    packaged = Path(__file__).resolve().parent / "dashboard"
    if (packaged / "index.html").is_file():
        return packaged
    dev = Path(__file__).resolve().parents[2] / "web" / "dist"
    return dev if (dev / "index.html").is_file() else None


async def _write_file(writer: asyncio.StreamWriter, path: Path) -> None:
    body = path.read_bytes()
    ctype = _CONTENT_TYPES.get(path.suffix, "application/octet-stream")
    head = (
        f"HTTP/1.1 200 OK\r\n"
        f"Content-Length: {len(body)}\r\n"
        f"Content-Type: {ctype}\r\n"
        f"{SELF_PROBE_HEADER}: 1\r\n"
        "Connection: close\r\n\r\n"
    )
    writer.write(head.encode() + body)
    await writer.drain()


_REASON = {200: "OK", 400: "Bad Request", 404: "Not Found"}
