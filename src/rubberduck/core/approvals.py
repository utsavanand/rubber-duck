"""Pending approvals: when an agent asks permission to run a tool, the dashboard
lets you answer it without switching to its terminal.

Two ways a request enters the registry:

  1. **Blocking hook** (Claude Code, Copilot): the agent's pre-exec hook POSTs the
     request, gets an id, and long-polls for the decision, then returns it to the
     agent. The dashboard's Approve/Deny writes the decision; the hook picks it up.
     This is the real path — the dashboard *is* the approval authority, no
     keystroke injection.

  2. **Observe-only** (Codex, or a watched session whose harness can't route
     approval): a PermissionRequest event creates a row so you can see it; you
     answer in the terminal. `decide` can still try a keystroke fallback if a
     tty/PTY is available, but the row isn't authoritative.

Approvals are transient and live in memory; they resolve when decided, when the
agent's hook stops polling (it moved on), or when the session ends.
"""

import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Literal

Decision = Literal["approve", "deny"]

# Keystrokes that answer Claude Code's permission prompt (numbered menu: 1=Yes).
# Only used by the legacy keystroke fallback, not the blocking-hook path.
_KEYS = {"approve": "1", "deny": "Escape"}

# The load-bearing field of a tool's input, by tool — so the approval row shows
# *what* is being requested (the URL for a fetch, the command for Bash, etc.)
# instead of a bare tool name. Falls back to the first string value.
_DETAIL_FIELDS = {
    "Bash": "command",
    "WebFetch": "url",
    "WebSearch": "query",
    "Read": "file_path",
    "Edit": "file_path",
    "Write": "file_path",
    "Grep": "pattern",
    "Glob": "pattern",
}


def request_detail(tool_input: dict[str, Any], tool_name: str = "") -> str:
    """A human-readable summary of what a tool wants to do, for the approval row."""
    field_name = _DETAIL_FIELDS.get(tool_name)
    if field_name and tool_input.get(field_name) is not None:
        return str(tool_input[field_name])
    for k in ("command", "url", "query", "file_path", "pattern", "path"):
        if tool_input.get(k) is not None:
            return str(tool_input[k])
    for v in tool_input.values():
        if isinstance(v, str) and v:
            return v
    return ""


@dataclass
class Approval:
    id: str
    session_key: str
    tool_name: str
    detail: str
    created_at: int
    decided: Decision | None = field(default=None)
    # True when a blocking hook is waiting on this decision (the dashboard is the
    # authority). False for observe-only rows (answer in the terminal).
    blocking: bool = field(default=False)


class ApprovalRegistry:
    def __init__(self, inject: Callable[[str, str], bool]) -> None:
        """`inject(session_key, key)` sends a keystroke to a session; the legacy
        fallback for observe-only sessions with a live PTY/tab."""
        self._inject = inject
        self._pending: dict[str, Approval] = {}

    def register(
        self,
        session_key: str,
        tool_name: str,
        tool_input: dict[str, Any],
        created_at: int,
        *,
        blocking: bool,
    ) -> Approval:
        """Create a pending approval (from the blocking hook's POST, or from a
        PermissionRequest event). Returns it with its server-assigned id."""
        approval = Approval(
            id=uuid.uuid4().hex,
            session_key=session_key,
            tool_name=tool_name or "unknown",
            detail=request_detail(tool_input, tool_name),
            created_at=created_at,
            blocking=blocking,
        )
        self._pending[approval.id] = approval
        return approval

    def from_event(self, event: dict[str, Any]) -> Approval | None:
        """Create an observe-only approval row from a PermissionRequest event
        (the non-blocking path: you'll answer in the terminal). Skipped when a
        blocking hook already registered a request for this session — that one is
        authoritative, so we don't want a duplicate observe-only row."""
        if event.get("event_type") != "PermissionRequest":
            return None
        key = event.get("session_key") or event.get("session_id")
        if not key:
            return None
        if any(a.session_key == str(key) and a.blocking for a in self.pending()):
            return None
        return self.register(
            str(key),
            str(event.get("tool_name") or "unknown"),
            event.get("tool_input") or {},
            int(event.get("_ts", 0)),
            blocking=False,
        )

    def get(self, approval_id: str) -> Approval | None:
        return self._pending.get(approval_id)

    def decision_of(self, approval_id: str) -> Decision | None:
        """The decision an approval has been given, for the hook to poll. None
        while still pending; raises KeyError handling is the caller's job."""
        a = self._pending.get(approval_id)
        return a.decided if a else None

    def pending(self) -> list[Approval]:
        """Approvals awaiting a decision."""
        return [a for a in self._pending.values() if a.decided is None]

    def set_decision(self, approval_id: str, decision: Decision) -> bool:
        """Record the user's decision. For a blocking request that's all that's
        needed — the polling hook returns it. For an observe-only request, try
        the keystroke fallback so it still lands in the agent. Returns whether
        the decision was recorded."""
        approval = self._pending.get(approval_id)
        if approval is None or approval.decided is not None:
            return False
        if not approval.blocking:
            # Best-effort keystroke into a PTY we own; ignore failure (the
            # dashboard caller may still answer via tty elsewhere).
            self._inject(approval.session_key, _KEYS[decision])
        approval.decided = decision
        return True

    def forget(self, approval_id: str) -> None:
        """Remove a resolved approval (after the hook has consumed the decision)."""
        self._pending.pop(approval_id, None)

    def drop_session(self, session_key: str) -> None:
        """Remove a terminated session's approvals."""
        self._pending = {aid: a for aid, a in self._pending.items() if a.session_key != session_key}

    def drop_session_before(self, session_key: str, ts: int) -> None:
        """Remove a session's *observe-only* approvals created strictly before
        `ts` — ones the agent has since moved past. Blocking requests are never
        dropped this way; the hook resolves them itself."""
        self._pending = {
            aid: a
            for aid, a in self._pending.items()
            if a.session_key != session_key or a.created_at >= ts or a.blocking
        }

    def drop_abandoned_blocking(self, session_key: str, now: int, max_age_ms: int) -> None:
        """Drop a session's blocking approvals older than `max_age_ms` — the hook
        that registered them has stopped polling (it timed out, the agent moved
        on, or it crashed), so its decision will never be consumed. Without this
        an abandoned blocking request lingers in "Needs human" until the session
        ends. Called when a later event proves the agent is past that request."""
        self._pending = {
            aid: a
            for aid, a in self._pending.items()
            if a.session_key != session_key
            or not a.blocking
            or now - a.created_at < max_age_ms
        }
