import subprocess
import sys
from pathlib import Path

FAKE_AGENT = Path(__file__).parent / "fake_agent.py"


def run_agent(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(FAKE_AGENT), *args],
        capture_output=True,
        text=True,
    )


def test_default_run_emits_busy_then_idle() -> None:
    result = run_agent()
    assert result.returncode == 0
    assert result.stdout.splitlines() == ["[busy]", "[idle]"]


def test_script_drives_states_in_order(tmp_path: Path) -> None:
    script = tmp_path / "s.txt"
    script.write_text("[busy]\n[tool] build\n[waiting] need approval\n[idle]\n")
    result = run_agent("--script", str(script))
    assert result.returncode == 0
    assert result.stdout.splitlines() == [
        "[busy]",
        "[tool] build",
        "[waiting] need approval",
        "[idle]",
    ]


def test_exit_directive_sets_return_code(tmp_path: Path) -> None:
    script = tmp_path / "s.txt"
    script.write_text("[busy]\nexit 3\n")
    result = run_agent("--script", str(script))
    assert result.returncode == 3


def test_unknown_directive_fails(tmp_path: Path) -> None:
    script = tmp_path / "s.txt"
    script.write_text("[bogus]\n")
    result = run_agent("--script", str(script))
    assert result.returncode == 2
    assert "unknown step" in result.stderr
