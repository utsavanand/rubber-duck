from rubberduck.core.approvals import ApprovalRegistry


def perm_event(session: str, command: str = "rm -rf build") -> dict:
    return {
        "event_type": "PermissionRequest",
        "session_key": session,
        "tool_name": "Bash",
        "tool_input": {"command": command},
        "_ts": 1000,
    }


def test_permission_event_creates_pending_approval() -> None:
    reg = ApprovalRegistry(inject=lambda _k, _key: True)
    approval = reg.from_event(perm_event("s1"))
    assert approval is not None
    assert approval.tool_name == "Bash"
    assert approval.detail == "rm -rf build"
    assert [a.session_key for a in reg.pending()] == ["s1"]


def test_detail_shows_the_load_bearing_field_per_tool() -> None:
    reg = ApprovalRegistry(inject=lambda _k, _key: True)
    # A WebFetch shows the URL (not a blank, since its input has no `command`).
    fetch = reg.from_event(
        {
            "event_type": "PermissionRequest",
            "session_key": "s1",
            "tool_name": "WebFetch",
            "tool_input": {"url": "https://example.com/docs", "prompt": "summarize"},
            "_ts": 1,
        }
    )
    assert fetch is not None
    assert fetch.tool_name == "WebFetch"
    assert fetch.detail == "https://example.com/docs"
    # Grep shows its pattern; Read shows the file path.
    grep = reg.from_event(
        {
            "event_type": "PermissionRequest",
            "session_key": "s2",
            "tool_name": "Grep",
            "tool_input": {"pattern": "refund", "path": "src"},
            "_ts": 1,
        }
    )
    assert grep is not None and grep.detail == "refund"


def test_non_permission_events_are_ignored() -> None:
    reg = ApprovalRegistry(inject=lambda _k, _key: True)
    assert reg.from_event({"event_type": "Stop", "session_key": "s1"}) is None
    assert reg.pending() == []


def test_observe_only_decision_injects_the_keystroke() -> None:
    # An observe-only row (from a PermissionRequest event) still tries the
    # keystroke fallback so it lands in an agent we own the PTY for.
    sent: list[tuple[str, str]] = []
    reg = ApprovalRegistry(inject=lambda key, k: sent.append((key, k)) or True)
    a = reg.from_event(perm_event("s1"))
    assert a is not None and not a.blocking
    assert reg.set_decision(a.id, "approve") is True
    assert sent == [("s1", "1")]  # '1' answers the numbered permission menu
    assert reg.decision_of(a.id) == "approve"
    assert reg.pending() == []  # decided -> leaves pending


def test_blocking_decision_does_not_inject() -> None:
    # A blocking request is answered by the polling hook, not a keystroke.
    sent: list[tuple[str, str]] = []
    reg = ApprovalRegistry(inject=lambda key, k: sent.append((key, k)) or True)
    a = reg.register("s1", "Bash", {"command": "ls"}, 1, blocking=True)
    assert reg.set_decision(a.id, "deny") is True
    assert sent == []  # no keystroke for blocking requests
    assert reg.decision_of(a.id) == "deny"


def test_decision_of_is_none_while_pending_and_forget_removes() -> None:
    reg = ApprovalRegistry(inject=lambda _k, _key: True)
    a = reg.register("s1", "Bash", {"command": "ls"}, 1, blocking=True)
    assert reg.decision_of(a.id) is None
    reg.set_decision(a.id, "approve")
    assert reg.decision_of(a.id) == "approve"
    reg.forget(a.id)
    assert reg.get(a.id) is None


def test_event_skipped_when_a_blocking_request_exists() -> None:
    # The blocking hook registered the authoritative request; the same session's
    # PermissionRequest event must not add a duplicate observe-only row.
    reg = ApprovalRegistry(inject=lambda _k, _key: True)
    reg.register("s1", "Bash", {"command": "ls"}, 1, blocking=True)
    assert reg.from_event(perm_event("s1")) is None
    assert len(reg.pending()) == 1


def test_dropping_a_session_clears_its_approvals() -> None:
    reg = ApprovalRegistry(inject=lambda _k, _key: True)
    reg.from_event(perm_event("s1"))
    reg.from_event(perm_event("s2"))
    reg.drop_session("s1")
    assert [a.session_key for a in reg.pending()] == ["s2"]


def test_drop_session_before_keeps_a_same_tick_request() -> None:
    # Claude emits PermissionRequest and the requested tool's PreToolUse in the
    # same tick — the resolving sweep must not clear the request it just created.
    reg = ApprovalRegistry(inject=lambda _k, _key: True)
    a = reg.from_event({**perm_event("s1"), "_ts": 1000})
    assert a is not None
    reg.drop_session_before("s1", 1000)  # same ts as the request -> kept
    assert len(reg.pending()) == 1
    reg.drop_session_before("s1", 1001)  # a later event -> resolved, cleared
    assert reg.pending() == []


def test_blocking_request_survives_the_resolve_sweep() -> None:
    # A blocking request must NOT be cleared by drop_session_before — the hook
    # owns its lifecycle (resolves it via the decision), not the activity sweep.
    reg = ApprovalRegistry(inject=lambda _k, _key: True)
    a = reg.register("s1", "Bash", {"command": "ls"}, 1000, blocking=True)
    reg.drop_session_before("s1", 5000)  # later activity
    assert reg.get(a.id) is not None  # still pending


def test_abandoned_blocking_request_is_swept_after_the_poll_deadline() -> None:
    # A blocking request whose hook has stopped polling (older than the poll
    # deadline) is abandoned: a later event sweeps it so it doesn't linger.
    reg = ApprovalRegistry(inject=lambda _k, _key: True)
    fresh = reg.register("s1", "Bash", {"command": "ls"}, 50_000, blocking=True)
    stale = reg.register("s1", "WebFetch", {"url": "http://x"}, 1_000, blocking=True)

    # now=190_000, max_age=180_000 -> stale (age 189s) abandoned, fresh (age 140s) kept.
    reg.drop_abandoned_blocking("s1", now=190_000, max_age_ms=180_000)

    ids = {a.id for a in reg.pending()}
    assert fresh.id in ids
    assert stale.id not in ids


def test_drop_abandoned_blocking_leaves_observe_only_rows() -> None:
    # The abandonment sweep only targets blocking rows; an observe-only row of any
    # age is left for drop_session_before / terminal answer to handle.
    reg = ApprovalRegistry(inject=lambda _k, _key: True)
    obs = reg.from_event({**perm_event("s1"), "_ts": 1})
    assert obs is not None
    reg.drop_abandoned_blocking("s1", now=10_000_000, max_age_ms=180_000)
    assert reg.get(obs.id) is not None
