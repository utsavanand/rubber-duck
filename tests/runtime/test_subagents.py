"""Sub-agent capture: SubagentStart/Stop events are recorded against the parent
session (which shares their session_id) as sub-agent rows, not as new sessions,
and SubagentStop flips state to done."""

import tempfile
from pathlib import Path

from rubberduck.persistence.history import HistoryStore


def _store() -> HistoryStore:
    return HistoryStore(Path(tempfile.mkdtemp()) / "db.sqlite")


def test_subagents_attach_to_parent_not_a_new_session() -> None:
    h = _store()
    h.record({"_id": "e1", "_ts": 1, "event_type": "SessionStart", "session_key": "P"})
    h.record(
        {
            "_id": "e2",
            "_ts": 2,
            "event_type": "SubagentStart",
            "session_key": "P",
            "agent_id": "a1",
            "agent_type": "Explore",
            "agent_prompt": "find the auth code",
        }
    )

    # The sub-agent did NOT create a second session row.
    assert len(h.sessions()) == 1
    subs = h.subagents("P")
    assert len(subs) == 1
    assert subs[0]["agent_type"] == "Explore"
    assert subs[0]["agent_prompt"] == "find the auth code"
    assert subs[0]["state"] == "running"


def test_subagent_stop_flips_state_to_done() -> None:
    h = _store()
    h.record({"_id": "e1", "_ts": 1, "event_type": "SessionStart", "session_key": "P"})
    h.record(
        {"_id": "e2", "_ts": 2, "event_type": "SubagentStart", "session_key": "P", "agent_id": "a1"}
    )
    h.record(
        {"_id": "e3", "_ts": 9, "event_type": "SubagentStop", "session_key": "P", "agent_id": "a1"}
    )

    sub = h.subagents("P")[0]
    assert sub["state"] == "done"
    assert sub["ended_at"] == 9


def test_subagents_grouped_by_parent() -> None:
    h = _store()
    for parent in ("P1", "P2"):
        h.record(
            {"_id": f"s-{parent}", "_ts": 1, "event_type": "SessionStart", "session_key": parent}
        )
    h.record(
        {"_id": "a", "_ts": 2, "event_type": "SubagentStart", "session_key": "P1", "agent_id": "x"}
    )
    h.record(
        {"_id": "b", "_ts": 3, "event_type": "SubagentStart", "session_key": "P1", "agent_id": "y"}
    )
    h.record(
        {"_id": "c", "_ts": 4, "event_type": "SubagentStart", "session_key": "P2", "agent_id": "z"}
    )

    grouped = h.subagents_by_session()
    assert len(grouped["P1"]) == 2
    assert len(grouped["P2"]) == 1
