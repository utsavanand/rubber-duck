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
import signal
import uuid
from pathlib import Path
from typing import Protocol

from rubberduck.eventbus import EventBus
from rubberduck.runtimes.base import SessionState
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
        self._emit("SessionStart")
        self._task = asyncio.create_task(self._pump(primary))

    async def _pump(self, primary: int) -> None:
        loop = asyncio.get_running_loop()
        reader = asyncio.StreamReader()
        transport, _ = await loop.connect_read_pipe(
            lambda: asyncio.StreamReaderProtocol(reader), os.fdopen(primary, "rb", 0)
        )
        try:
            async for raw in reader:
                line = raw.decode(errors="replace")
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

    async def _finish(self) -> None:
        if self._proc is not None:
            await self._proc.wait()
        self._emit("SessionEnd")

    async def stop(self) -> None:
        if self._proc is not None and self._proc.returncode is None:
            os.killpg(os.getpgid(self._proc.pid), signal.SIGTERM)
        if self._task is not None:
            await self._task

    @property
    def running(self) -> bool:
        return self._proc is not None and self._proc.returncode is None


class Orchestrator:
    def __init__(self, bus: EventBus, worktrees: WorktreeManager | None = None) -> None:
        self.bus = bus
        self.worktrees = worktrees if worktrees is not None else WorktreeManager()
        self._supervisors: dict[str, SessionSupervisor] = {}

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
    ) -> str:
        """Launch a supervised agent. If repo_path is given, the agent runs in a
        fresh git worktree on `branch` (default: a branch named for the session),
        forked from `base` (default: repo HEAD); otherwise it runs in `cwd`.
        `parent_session_key` records fork lineage."""
        key = session_key or uuid.uuid4().hex
        extra: dict[str, object] = {}
        if parent_session_key is not None:
            extra["parent_session_key"] = parent_session_key
        run_cwd = cwd

        if repo_path is not None:
            wt_branch = branch or f"rubberduck/{key[:8]}"
            worktree = self.worktrees.add(Path(repo_path), wt_branch, base=base)
            run_cwd = str(worktree.path)
            extra |= {
                "repo_path": str(worktree.repo_path),
                "worktree_path": str(worktree.path),
                "branch": worktree.branch,
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
        return key

    async def stop(self, session_key: str) -> bool:
        supervisor = self._supervisors.get(session_key)
        if supervisor is None:
            return False
        await supervisor.stop()
        return True

    def get(self, session_key: str) -> SessionSupervisor | None:
        return self._supervisors.get(session_key)
