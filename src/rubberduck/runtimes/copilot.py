"""The GitHub Copilot CLI runtime. Like Codex, Copilot is hook-driven for state
(see agents/hooks_install.py), but unlike the JSONL agents it stores its
conversation in a SQLite database at ~/.copilot/session-store.db — a `turns`
table with user_message + assistant_response per turn. That's the cleanest
transcript source of the three, so read_transcript reads it directly.
"""

import re
import shlex
import sqlite3
from pathlib import Path

from rubberduck.agents.hooks_install import copilot_build, copilot_strip
from rubberduck.runtimes.base import Harness, HookSpec, SessionState

_WORKING = re.compile(r"(working|thinking|running|generating)", re.IGNORECASE)
_WAITING = re.compile(r"(allow|approve|\(y/n\)|continue\?)", re.IGNORECASE)


class CopilotRuntime(Harness):
    name = "copilot"
    hook_spec = HookSpec(
        global_rel=Path(".copilot") / "hooks" / "rubberduck.json",
        repo_rel=Path(".github") / "hooks" / "rubberduck.json",
        build=copilot_build,
        strip=copilot_strip,
    )

    def __init__(self, command: str = "copilot") -> None:
        self._argv = shlex.split(command)

    def launch_command(self, *, cwd: Path, session_key: str, initial_prompt: str) -> list[str]:
        argv = list(self._argv)
        if initial_prompt:
            argv += ["-p", initial_prompt]
        return argv

    def detect_state(self, recent_output: str) -> SessionState:
        for line in reversed(recent_output.splitlines()):
            if _WAITING.search(line):
                return "waiting"
            if _WORKING.search(line):
                return "busy"
        return "idle"

    def tool_in(self, recent_output: str) -> str | None:
        return None

    def locate_transcript(self, *, cwd: Path, session_id: str) -> Path | None:
        db = Path.home() / ".copilot" / "session-store.db"
        return db if db.exists() else None

    def read_transcript(self, *, cwd: Path, session_id: str) -> list[dict[str, str]]:
        db = self.locate_transcript(cwd=cwd, session_id=session_id)
        if db is None:
            return []
        # Read-only connection so we never disturb Copilot's own DB.
        try:
            conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        except sqlite3.Error:
            return []
        try:
            rows = conn.execute(
                "SELECT user_message, assistant_response FROM turns "
                "WHERE session_id = ? ORDER BY turn_index",
                (session_id,),
            ).fetchall()
        except sqlite3.Error:
            return []
        finally:
            conn.close()
        records: list[dict[str, str]] = []
        for user_message, assistant_response in rows:
            if user_message:
                records.append({"role": "user", "text": str(user_message)})
            if assistant_response:
                records.append({"role": "assistant", "text": str(assistant_response)})
        return records

    def restore_command(self, *, cwd: Path, session_key: str) -> list[str]:
        return [*self._argv, f"--resume={session_key}"]
