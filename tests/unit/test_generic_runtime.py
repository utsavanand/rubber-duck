from pathlib import Path

from rubberduck.runtimes.generic import GenericRuntime


def test_launch_command_splits_invocation() -> None:
    rt = GenericRuntime("python fake_agent.py --delay 0.1")
    argv = rt.launch_command(cwd=Path("/x"), session_key="s", initial_prompt="")
    assert argv == ["python", "fake_agent.py", "--delay", "0.1"]


def test_detect_state_uses_last_marker() -> None:
    rt = GenericRuntime("agent")
    assert rt.detect_state("[busy]\n[tool] build\n[idle]") == "idle"
    assert rt.detect_state("[idle]\n[busy]") == "busy"
    assert rt.detect_state("[waiting] approve?") == "waiting"


def test_detect_state_defaults_to_busy_without_markers() -> None:
    assert GenericRuntime("agent").detect_state("some noise\nmore noise") == "busy"


def test_tool_in_extracts_tool_name() -> None:
    rt = GenericRuntime("agent")
    assert rt.tool_in("[tool] pytest") == "pytest"
    assert rt.tool_in("no tools here") is None


def test_generic_has_no_transcript_so_checkpoints_fall_back() -> None:
    # No transcript locator -> Act 7 summarizes the PTY log instead of a structured
    # transcript. restore_command mirrors the original invocation.
    rt = GenericRuntime("agent --flag")
    assert rt.locate_transcript(cwd=Path("/x"), session_id="s") is None
    assert rt.restore_command(cwd=Path("/x"), session_key="s") == ["agent", "--flag"]
