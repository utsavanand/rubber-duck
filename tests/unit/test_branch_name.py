from rubberduck.server import _branch_name


def test_branch_name_slugifies_session_name() -> None:
    assert _branch_name("test agent waves 2") == "rubberduck/test-agent-waves-2"
    assert _branch_name("Fix: the Login Bug!") == "rubberduck/fix-the-login-bug"
    assert _branch_name("  spaced  out  ") == "rubberduck/spaced-out"


def test_branch_name_falls_back_to_timestamp_without_a_name() -> None:
    # No usable slug → a unique rubberduck/<timestamp> branch (digits only).
    for name in (None, "", "   ", "!!!"):
        branch = _branch_name(name)
        assert branch.startswith("rubberduck/")
        assert branch[len("rubberduck/") :].isdigit()
