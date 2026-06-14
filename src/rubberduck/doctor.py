"""`rubberduck doctor` — one diagnostic that explains why sessions aren't showing.

The install flow has several silent failure modes (server down, missing jq, a
hook not installed, a Codex hook that needs trusting) that all surface the same
way: "my session didn't appear." This collects deterministic checks and, for
each problem, prints the exact fix.

Each check returns a Result; the CLI prints them and exits non-zero if any FAILed.
Checks only assert what can be verified deterministically — e.g. it reports
whether the Codex hook is *installed and current*, not whether it's *trusted*
(Codex hashes a normalized per-entry form we can't reliably recompute), so it
points you at /hooks rather than claiming a trust state it can't prove.
"""

import shutil
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from rubberduck.agents.hooks_install import hook_script_path, settings_path
from rubberduck.helpers import paths

Status = Literal["ok", "warn", "fail"]


@dataclass
class Result:
    status: Status
    title: str
    detail: str = ""  # shown under a warn/fail with the fix


def _check_system_deps() -> list[Result]:
    """The hook's blocking-approval path shells out to jq + curl."""
    out = []
    for tool, why in (
        ("jq", "the hook's blocking-approval path"),
        ("curl", "the hook posts events"),
    ):
        if shutil.which(tool):
            out.append(Result("ok", f"{tool} installed"))
        else:
            out.append(
                Result(
                    "fail",
                    f"{tool} not found — needed for {why}",
                    f"install it: brew install {tool}   (or apt/dnf install {tool})",
                )
            )
    return out


def _check_server(url: str) -> Result:
    """A running Rubberduck answers / with its self-probe header."""
    try:
        resp = urllib.request.urlopen(url, timeout=1)
    except OSError:
        return Result(
            "fail",
            f"no server reachable at {url}",
            "start it: rubberduck serve",
        )
    if resp.headers.get("X-Rubberduck") == "1":
        return Result("ok", f"server reachable at {url}")
    return Result(
        "fail",
        f"{url} is answered by something that isn't Rubberduck",
        "free the port or pick another: rubberduck serve --port 4300",
    )


def _check_token() -> Result:
    """The hook reads ~/.rubberduck/token to authenticate its POSTs."""
    path = paths.home() / "token"
    if not path.exists():
        return Result(
            "warn",
            "auth token not created yet",
            "it's written on first `rubberduck serve`; start the server once",
        )
    try:
        readable = bool(path.read_text().strip())
    except OSError as e:
        return Result(
            "fail", f"token file unreadable: {e}", "check permissions on ~/.rubberduck/token"
        )
    return Result("ok" if readable else "fail", "auth token present")


def _check_hook_installed(agent: str) -> Result:
    """The agent's settings reference our current hook script. Catches both
    'not installed' and 'stale path' (e.g. moved package). For Codex also flags
    the async:true bug, which makes Codex silently skip the hook."""
    path = settings_path(global_scope=True, project_dir=Path.cwd(), agent=agent)
    script = str(hook_script_path())
    if not path.exists():
        return Result(
            "warn",
            f"{agent}: no global hooks installed",
            f"install: rubberduck install-hooks --agent {agent} --global",
        )
    blob = path.read_text()
    if "rubberduck" not in blob:
        return Result(
            "warn",
            f"{agent}: settings exist but no Rubberduck hook",
            f"install: rubberduck install-hooks --agent {agent} --global",
        )
    if script not in blob:
        return Result(
            "fail",
            f"{agent}: hook points at a different/old script path",
            f"reinstall: rubberduck install-hooks --agent {agent} --global",
        )
    if agent == "codex" and '"async": true' in blob:
        return Result(
            "fail",
            "codex: hook has async:true — Codex skips async hooks (events never arrive)",
            "reinstall to drop it: rubberduck install-hooks --agent codex --global",
        )
    if agent == "codex":
        return Result(
            "ok",
            "codex: hook installed (current script)",
            "if codex sessions still don't appear, trust it: start codex, run /hooks, "
            "trust the Rubberduck hook (once per machine; re-trust if the script changes)",
        )
    return Result("ok", f"{agent}: hook installed (current script)")


def run(url: str, agents: list[str]) -> list[Result]:
    results = _check_system_deps()
    results.append(_check_server(url))
    results.append(_check_token())
    for agent in agents:
        results.append(_check_hook_installed(agent))
    return results
