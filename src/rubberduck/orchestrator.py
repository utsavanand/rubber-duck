"""Active orchestration: spawn agents in a PTY and own their lifecycle.

A SessionSupervisor runs one agent process, reads its output, classifies state
via the runtime's detect_state, and emits events into the EventBus. It reuses
the existing event vocabulary (SessionStart / PreToolUse / Stop / Notification /
SessionEnd) so the same derive_state and dashboard logic apply — there is no
second state machine.

PTY rather than plain pipes so interactive agents (which check isatty) behave
the same as in a real terminal.
"""

import asyncio
import os
import pty
import shlex
import signal
import uuid
from collections import deque
from collections.abc import AsyncGenerator
from pathlib import Path
from typing import Protocol

from rubberduck import paths, tmux
from rubberduck.eventbus import EventBus
from rubberduck.history import HistoryStore
from rubberduck.runtimes.base import SessionState
from rubberduck.summarizer import build_prompt, mechanical_summary, summarize
from rubberduck.worktrees import WorktreeManager

# State -> the event_type whose derive_state yields that state. One vocabulary.
_STATE_EVENT = {
    "busy": "PreToolUse",
    "idle": "Stop",
    "waiting": "Notification",
}


class StateRuntime(Protocol):
    name: str

    def launch_command(self, *, cwd: Path, session_key: str, initial_prompt: str) -> list[str]: ...
    def detect_state(self, recent_output: str) -> SessionState: ...
    def tool_in(self, recent_output: str) -> str | None: ...
    def locate_transcript(self, *, cwd: Path, session_id: str) -> Path | None: ...


class SessionSupervisor:
    def __init__(
        self,
        *,
        bus: EventBus,
        runtime: StateRuntime,
        session_key: str,
        cwd: str,
        initial_prompt: str = "",
        extra: dict[str, object] | None = None,
    ) -> None:
        self.bus = bus
        self.runtime = runtime
        self.session_key = session_key
        self.cwd = cwd
        self.initial_prompt = initial_prompt
        self._extra = extra or {}
        self._proc: asyncio.subprocess.Process | None = None
        self._state: SessionState = "busy"
        self._task: asyncio.Task[None] | None = None
        self._primary_fd: int | None = None  # PTY master, for writing input
        self._tmux_target: str | None = None  # set when tmux-backed
        self._pipe_path: str = ""  # tmux pane output file
        self._output = deque[str](maxlen=2000)  # recent output lines, for the UI
        self._output_subs: set[asyncio.Queue[str]] = set()

    def _emit(self, event_type: str, **fields: object) -> None:
        self.bus.publish(
            {
                "event_type": event_type,
                "session_key": self.session_key,
                "source_app": os.path.basename(self.cwd) or self.session_key,
                "cwd": self.cwd,
                "runtime": self.runtime.name,
                **self._extra,
                **fields,
            }
        )

    async def start(self) -> None:
        if tmux.has_tmux():
            await self._start_tmux()
        else:
            await self._start_pty()

    async def _start_pty(self) -> None:
        argv = self.runtime.launch_command(
            cwd=Path(self.cwd), session_key=self.session_key, initial_prompt=self.initial_prompt
        )
        primary, secondary = pty.openpty()
        self._proc = await asyncio.create_subprocess_exec(
            *argv,
            cwd=self.cwd,
            stdin=secondary,
            stdout=secondary,
            stderr=secondary,
            start_new_session=True,
        )
        os.close(secondary)
        self._primary_fd = primary
        self._emit("SessionStart")
        self._task = asyncio.create_task(self._pump(primary))

    async def _start_tmux(self) -> None:
        """Run the agent inside tmux so it survives the server restarting. Output
        streams to a pipe file we tail; input goes via tmux send-keys."""
        argv = self.runtime.launch_command(
            cwd=Path(self.cwd), session_key=self.session_key, initial_prompt=self.initial_prompt
        )
        command = shlex.join(argv)
        self._pipe_path = str(paths.home() / "panes" / f"{self.session_key}.log")
        Path(self._pipe_path).parent.mkdir(parents=True, exist_ok=True)
        Path(self._pipe_path).write_text("")
        self._tmux_target = tmux.spawn_piped(self.session_key, command, self.cwd, self._pipe_path)
        self._emit("SessionStart")
        self._task = asyncio.create_task(self._tail_pipe())

    async def reattach(self) -> None:
        """Reconnect to an already-running tmux session after a server restart.
        Re-tails its pipe and resumes state/output without re-spawning."""
        self._tmux_target = tmux.target_for(self.session_key)
        self._pipe_path = str(paths.home() / "panes" / f"{self.session_key}.log")
        if not Path(self._pipe_path).exists():
            Path(self._pipe_path).parent.mkdir(parents=True, exist_ok=True)
            Path(self._pipe_path).write_text("")
        self._task = asyncio.create_task(self._tail_pipe())

    async def _tail_pipe(self) -> None:
        """Follow the tmux pane's output file, applying the same state/tool
        detection as the PTY pump. Ends when the tmux session is gone."""
        assert self._tmux_target is not None
        target = self._tmux_target
        path = Path(self._pipe_path)
        with path.open("r", errors="replace") as fh:
            fh.seek(0, os.SEEK_END)
            while True:
                line = fh.readline()
                if line:
                    self._record_output(line)
                    tool = self.runtime.tool_in(line)
                    if tool is not None:
                        self._emit("PreToolUse", tool_name=tool)
                    new_state = self.runtime.detect_state(line)
                    if new_state != self._state:
                        self._state = new_state
                        self._emit(_STATE_EVENT[new_state])
                    continue
                if not tmux.session_exists(target):
                    break
                await asyncio.sleep(0.15)
        self._emit("SessionEnd")

    async def _pump(self, primary: int) -> None:
        loop = asyncio.get_running_loop()
        reader = asyncio.StreamReader()
        transport, _ = await loop.connect_read_pipe(
            lambda: asyncio.StreamReaderProtocol(reader), os.fdopen(primary, "rb", 0)
        )
        try:
            async for raw in reader:
                line = raw.decode(errors="replace")
                self._record_output(line)
                tool = self.runtime.tool_in(line)
                if tool is not None:
                    self._emit("PreToolUse", tool_name=tool)
                new_state = self.runtime.detect_state(line)
                if new_state != self._state:
                    self._state = new_state
                    self._emit(_STATE_EVENT[new_state])
        finally:
            transport.close()
            await self._finish()

    def _record_output(self, line: str) -> None:
        self._output.append(line)
        for queue in self._output_subs:
            queue.put_nowait(line)

    def output_tail(self, limit: int = 500) -> list[str]:
        lines = list(self._output)
        return lines[-limit:] if limit < len(lines) else lines

    async def subscribe_output(self) -> AsyncGenerator[str, None]:
        """Yield output lines as the agent emits them. Replays the recent tail
        first so a late subscriber sees context."""
        queue: asyncio.Queue[str] = asyncio.Queue()
        for line in self.output_tail():
            queue.put_nowait(line)
        self._output_subs.add(queue)
        try:
            while True:
                yield await queue.get()
        finally:
            self._output_subs.discard(queue)

    def write_input(self, text: str) -> bool:
        """Write to the agent's stdin (terminal-attach / approvals). Routes to
        tmux send-keys or the PTY depending on how the session is backed."""
        if self._tmux_target is not None and self.running:
            stripped = text.rstrip("\r\n")
            enter = text.endswith(("\r", "\n"))
            if stripped == "\x1b":  # Escape (a denial)
                return tmux.send_special(self._tmux_target, "Escape")
            return tmux.send_keys(self._tmux_target, stripped, enter=enter)
        if self._primary_fd is not None and self.running:
            os.write(self._primary_fd, text.encode())
            return True
        return False

    async def _finish(self) -> None:
        if self._proc is not None:
            await self._proc.wait()
        self._emit("SessionEnd")

    async def stop(self) -> None:
        if self._tmux_target is not None:
            tmux.kill_session(self._tmux_target)
        elif self._proc is not None and self._proc.returncode is None:
            os.killpg(os.getpgid(self._proc.pid), signal.SIGTERM)
        if self._task is not None:
            await self._task

    @property
    def running(self) -> bool:
        if self._tmux_target is not None:
            return tmux.session_exists(self._tmux_target)
        return self._proc is not None and self._proc.returncode is None


class Orchestrator:
    def __init__(
        self,
        bus: EventBus,
        worktrees: WorktreeManager | None = None,
        history: HistoryStore | None = None,
    ) -> None:
        self.bus = bus
        self.worktrees = worktrees if worktrees is not None else WorktreeManager()
        self.history = history
        self._supervisors: dict[str, SessionSupervisor] = {}

    async def reconcile(self) -> list[str]:
        """On startup, re-adopt tmux sessions that outlived a previous server
        run. Each is matched to its DB row (for cwd/runtime) and re-tailed.
        Returns the session keys re-adopted."""
        if not tmux.has_tmux():
            return []
        from rubberduck.runtimes.generic import GenericRuntime

        adopted: list[str] = []
        for key in tmux.list_rubberduck_sessions():
            if key in self._supervisors:
                continue
            row = self.history.session(key) if self.history else None
            cwd = str(row.get("cwd") or ".") if row else "."
            supervisor = SessionSupervisor(
                bus=self.bus, runtime=GenericRuntime("true"), session_key=key, cwd=cwd
            )
            self._supervisors[key] = supervisor
            await supervisor.reattach()
            adopted.append(key)
        return adopted

    async def launch(
        self,
        *,
        runtime: StateRuntime,
        cwd: str | None = None,
        session_key: str | None = None,
        prompt: str = "",
        repo_path: str | None = None,
        branch: str | None = None,
        base: str | None = None,
        parent_session_key: str | None = None,
        compare_group: str | None = None,
        name: str | None = None,
    ) -> str:
        """Launch a supervised agent. If repo_path is given, the agent runs in a
        fresh git worktree on `branch` (default: a branch named for the session),
        forked from `base` (default: repo HEAD); otherwise it runs in `cwd`.
        `parent_session_key` records fork lineage."""
        key = session_key or uuid.uuid4().hex
        extra: dict[str, object] = {}
        if parent_session_key is not None:
            extra["parent_session_key"] = parent_session_key
        if compare_group is not None:
            extra["compare_group"] = compare_group
        if name:
            extra["name"] = name
        run_cwd = cwd

        if repo_path is not None:
            wt_branch = branch or f"rubberduck/{key[:8]}"
            worktree = self.worktrees.add(Path(repo_path), wt_branch, base=base)
            run_cwd = str(worktree.path)
            extra |= {
                "repo_path": str(worktree.repo_path),
                "worktree_path": str(worktree.path),
                "branch": worktree.branch,
                # Label by the repo, not the worktree dir (which is the branch key).
                "source_app": worktree.repo_path.name,
            }
        if run_cwd is None:
            raise ValueError("launch requires either cwd or repo_path")

        supervisor = SessionSupervisor(
            bus=self.bus,
            runtime=runtime,
            session_key=key,
            cwd=run_cwd,
            initial_prompt=prompt,
            extra=extra,
        )
        self._supervisors[key] = supervisor
        await supervisor.start()
        if self.history is not None and prompt:
            self.history.set_intention(key, prompt)
        if self.history is not None and supervisor._task is not None:

            def _on_done(_task: asyncio.Task[None], k: str = key) -> None:
                self._write_summary(k)

            supervisor._task.add_done_callback(_on_done)
        return key

    def _write_summary(self, key: str) -> None:
        """Write the outcome summary after a session ends. Runs the (possibly
        slow) summarizer off the event loop so it never stalls the bus."""
        if self.history is None:
            return
        row = self.history.session(key)
        if row is None:
            return
        intention = str(row.get("intention") or "")
        events_summary = self.history.events_summary(key)
        transcript = self._transcript_text(key, row)
        result = summarize(build_prompt(intention, transcript, events_summary))
        outcome = result.text or mechanical_summary(intention, events_summary)
        self.history.set_outcome(key, outcome)

    def _transcript_text(self, key: str, row: dict[str, object]) -> str:
        """Read the runtime's transcript if it has one; else empty (the generic
        runtime, which makes the summarizer fall back to the activity digest)."""
        supervisor = self._supervisors.get(key)
        session_id = self.history.session_id_for(key) if self.history else None
        cwd = row.get("cwd")
        if supervisor is None or session_id is None or not cwd:
            return ""
        path = supervisor.runtime.locate_transcript(cwd=Path(str(cwd)), session_id=session_id)
        if path is None:
            return ""
        from rubberduck.runtimes.claude_code import parse_transcript

        records = parse_transcript(path)
        return "\n".join(f"{r['role']}: {r['text']}" for r in records)

    async def stop(self, session_key: str) -> bool:
        supervisor = self._supervisors.get(session_key)
        if supervisor is None:
            return False
        await supervisor.stop()
        return True

    def get(self, session_key: str) -> SessionSupervisor | None:
        return self._supervisors.get(session_key)

    def inject_key(self, session_key: str, key: str) -> bool:
        """Send a symbolic key (e.g. '1', 'Escape') to a live session's stdin.
        Used by the approval workflow to answer a permission prompt. Only works
        for sessions Rubberduck launched (it owns their PTY)."""
        supervisor = self._supervisors.get(session_key)
        if supervisor is None:
            return False
        text = {"Escape": "\x1b", "Enter": "\r"}.get(key, key + "\r")
        return supervisor.write_input(text)
