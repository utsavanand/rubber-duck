from pathlib import Path

from rubberduck.git.worktrees import GitError
from rubberduck.persistence.history import HistoryStore
from rubberduck.server import Server, _branch_name


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


def test_unmerged_check_failure_is_unsafe_not_zero(tmp_path: Path, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    """A failed git check must NOT read as 'zero unmerged commits' — that would
    silently bypass the delete guard and discard the agent's work."""
    store = HistoryStore(tmp_path / "db.sqlite")
    server = Server(history=store)

    wt = tmp_path / "worktrees" / "wt"
    wt.mkdir(parents=True)
    monkeypatch.setattr(server, "_worktree_path_of", lambda row: wt)

    def boom(_path: Path) -> int:
        raise GitError("git exploded")

    monkeypatch.setattr(server.orchestrator.worktrees, "unmerged_commits", boom)

    # -1 sentinel = "couldn't tell", which the delete handler treats as unsafe.
    assert server._worktree_unmerged({"worktree_path": str(wt)}) == -1
