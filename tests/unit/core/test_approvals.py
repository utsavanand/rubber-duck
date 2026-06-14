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


def test_approve_injects_the_yes_key() -> None:
    sent: list[tuple[str, str]] = []
    reg = ApprovalRegistry(inject=lambda key, k: sent.append((key, k)) or True)
    approval = reg.from_event(perm_event("s1"))
    assert approval is not None

    assert reg.decide(approval.id, "approve") is True
    assert sent == [("s1", "1")]  # '1' answers the numbered permission menu
    # Resolved approvals leave the pending list.
    assert reg.pending() == []


def test_deny_injects_escape() -> None:
    sent: list[tuple[str, str]] = []
    reg = ApprovalRegistry(inject=lambda key, k: sent.append((key, k)) or True)
    approval = reg.from_event(perm_event("s1"))
    assert approval is not None
    reg.decide(approval.id, "deny")
    assert sent == [("s1", "Escape")]


def test_decide_fails_when_injection_does_not_land() -> None:
    reg = ApprovalRegistry(inject=lambda _k, _key: False)
    approval = reg.from_event(perm_event("s1"))
    assert approval is not None
    # Injection failed (e.g. session not live) -> approval stays pending.
    assert reg.decide(approval.id, "approve") is False
    assert len(reg.pending()) == 1


def test_dropping_a_session_clears_its_approvals() -> None:
    reg = ApprovalRegistry(inject=lambda _k, _key: True)
    reg.from_event(perm_event("s1"))
    reg.from_event(perm_event("s2"))
    reg.drop_session("s1")
    assert [a.session_key for a in reg.pending()] == ["s2"]
