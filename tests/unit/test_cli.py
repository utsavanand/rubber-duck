import pytest

from rubberduck import __version__
from rubberduck.cli import main


def test_version_flag_prints_version_and_exits_zero(
    capsys: pytest.CaptureFixture[str],
) -> None:
    with pytest.raises(SystemExit) as exc:
        main(["--version"])
    assert exc.value.code == 0
    assert __version__ in capsys.readouterr().out


def test_no_command_prints_help_and_succeeds(capsys: pytest.CaptureFixture[str]) -> None:
    assert main([]) == 0
    assert "usage: rubberduck" in capsys.readouterr().out


def test_unknown_command_is_rejected(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as exc:
        main(["does-not-exist"])
    assert exc.value.code != 0


def test_doctor_returns_nonzero_when_a_check_fails(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    import rubberduck.doctor as doctor

    monkeypatch.setattr(
        doctor, "run", lambda url, agents: [doctor.Result("fail", "boom", "fix it")]
    )
    assert main(["doctor"]) == 1


def test_doctor_returns_zero_when_all_ok(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    import rubberduck.doctor as doctor

    monkeypatch.setattr(doctor, "run", lambda url, agents: [doctor.Result("ok", "fine")])
    assert main(["doctor"]) == 0


def test_restart_starts_a_server_when_none_is_running(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    import rubberduck.cli as cli

    # No server on the port -> restart should skip the stop and just serve.
    monkeypatch.setattr(cli, "_rubberduck_responds", lambda h, p: False)
    served: dict = {}

    def fake_serve(host: str, port: int) -> int:
        served["hp"] = (host, port)
        return 0

    monkeypatch.setattr(cli, "_serve", fake_serve)
    assert main(["restart", "--port", "4321"]) == 0
    assert served["hp"][1] == 4321


def test_run_execs_the_agent_with_passthrough_args(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    import rubberduck.cli as cli

    monkeypatch.setattr(cli.shutil, "which", lambda a: "/usr/bin/" + a)
    monkeypatch.setattr(cli, "_hook_installed", lambda r: True)
    monkeypatch.setattr(cli, "_rubberduck_responds", lambda h, p: True)
    execed: dict = {}
    monkeypatch.setattr(cli.os, "execvp", lambda file, argv: execed.update(file=file, argv=argv))

    main(["run", "claude", "--resume", "xyz"])

    assert execed["file"] == "claude"
    assert execed["argv"] == ["claude", "--resume", "xyz"]


def test_run_warns_when_hooks_missing_then_still_execs(monkeypatch, capsys) -> None:  # type: ignore[no-untyped-def]
    import rubberduck.cli as cli

    monkeypatch.setattr(cli.shutil, "which", lambda a: "/usr/bin/" + a)
    monkeypatch.setattr(cli, "_hook_installed", lambda r: False)  # not installed
    monkeypatch.setattr(cli, "_rubberduck_responds", lambda h, p: True)
    monkeypatch.setattr(cli.os, "execvp", lambda file, argv: None)

    main(["run", "claude"])

    err = capsys.readouterr().err
    assert "hooks aren't installed" in err
    assert "install-hooks --agent claude-code" in err


def test_run_missing_agent_returns_127(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    import rubberduck.cli as cli

    monkeypatch.setattr(cli.shutil, "which", lambda a: None)  # not on PATH
    assert main(["run", "nope"]) == 127
