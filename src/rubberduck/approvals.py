"""Pending approvals: when an agent asks for permission, the dashboard should
let you answer it without switching to its terminal.

A PermissionRequest event creates a pending approval. Deciding it injects the
answer back into the agent's session — '1' to approve (the first option of
Claude Code's numbered permission menu) or Escape to deny. The injection goes
through the supervisor's input (PTY) or tmux send-keys, whichever backs the
session.

Approvals are transient and live in memory; they resolve when decided or when
the session ends.
"""

import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Literal

Decision = Literal["approve", "deny"]

# Keystrokes that answer Claude Code's permission prompt (numbered menu: 1=Yes).
_KEYS = {"approve": "1", "deny": "Escape"}


@dataclass
class Approval:
    id: str
    session_key: str
    tool_name: str
    detail: str
    created_at: int
    decided: Decision | None = field(default=None)


class ApprovalRegistry:
    def __init__(self, inject: Callable[[str, str], bool]) -> None:
        """`inject(session_key, key)` sends a keystroke to a session; returns
        whether it landed."""
        self._inject = inject
        self._pending: dict[str, Approval] = {}

    def from_event(self, event: dict[str, Any]) -> Approval | None:
        """Create a pending approval from a PermissionRequest event."""
        if event.get("event_type") != "PermissionRequest":
            return None
        key = event.get("session_key") or event.get("session_id")
        if not key:
            return None
        approval = Approval(
            id=uuid.uuid4().hex,
            session_key=str(key),
            tool_name=str(event.get("tool_name") or "unknown"),
            detail=str((event.get("tool_input") or {}).get("command", "")),
            created_at=int(event.get("_ts", 0)),
        )
        self._pending[approval.id] = approval
        return approval

    def pending(self) -> list[Approval]:
        return [a for a in self._pending.values() if a.decided is None]

    def decide(self, approval_id: str, decision: Decision) -> bool:
        approval = self._pending.get(approval_id)
        if approval is None or approval.decided is not None:
            return False
        landed = self._inject(approval.session_key, _KEYS[decision])
        if landed:
            approval.decided = decision
        return landed

    def drop_session(self, session_key: str) -> None:
        """Remove a terminated session's approvals."""
        self._pending = {aid: a for aid, a in self._pending.items() if a.session_key != session_key}
