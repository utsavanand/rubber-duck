"""Command-line entry point. Subcommands land in their respective Acts:
serve (Act 1), launch/fork (Acts 3/5), emit (Act 1+)."""

import argparse
import asyncio
import errno
import json
import os
import sys
import urllib.request
from collections.abc import Sequence
from pathlib import Path

from rubberduck import __version__

DEFAULT_PORT = 4200
DEFAULT_HOST = "127.0.0.1"


def _server_url() -> str:
    return os.environ.get(
        "RUBBERDUCK_URL", f"http://127.0.0.1:{os.environ.get('RUBBERDUCK_PORT', DEFAULT_PORT)}"
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="rubberduck")
    parser.add_argument("--version", action="version", version=__version__)
    sub = parser.add_subparsers(dest="command")

    serve = sub.add_parser("serve", help="run the orchestrator server")
    serve.add_argument("--host", default=os.environ.get("RUBBERDUCK_HOST", DEFAULT_HOST))
    serve.add_argument(
        "--port", type=int, default=int(os.environ.get("RUBBERDUCK_PORT", DEFAULT_PORT))
    )

    launch = sub.add_parser("launch", help="launch a supervised agent in a running server")
    launch.add_argument(
        "agent_command",
        metavar="command",
        help="agent invocation, e.g. 'claude' (quote the whole thing)",
    )
    launch.add_argument("--cwd", default=os.getcwd())
    launch.add_argument("--session-key", default=None)
    launch.add_argument("--prompt", default="")

    sub.add_parser("snapshot", help="bundle recently-active sessions to disk")
    sub.add_parser("dashboard", help="build (if needed) and open the dashboard in a browser")

    inst = sub.add_parser(
        "install-hooks", help="wire Claude Code so its sessions stream into Rubberduck"
    )
    inst.add_argument(
        "--global",
        dest="global_scope",
        action="store_true",
        help="install into ~/.claude/settings.json (every project) instead of this repo",
    )

    uninst = sub.add_parser("uninstall-hooks", help="remove Rubberduck's Claude Code hooks")
    uninst.add_argument("--global", dest="global_scope", action="store_true")
    return parser


def _serve(host: str, port: int) -> int:
    from rubberduck.server import Server

    try:
        asyncio.run(Server().serve(host, port, on_listening=_print_listening))
    except KeyboardInterrupt:
        return 0
    except OSError as e:
        if e.errno != errno.EADDRINUSE:
            raise
        _print_port_in_use(host, port)
        return 1
    return 0


def _print_listening(host: str, port: int) -> None:
    print(f"rubberduck serving on http://{host}:{port}", file=sys.stderr)


def _print_port_in_use(host: str, port: int) -> None:
    print(f"Port {port} is already in use.", file=sys.stderr)
    if _rubberduck_responds(host, port):
        print(
            f"\nAnother Rubberduck is already running:\n  open http://{host}:{port}",
            file=sys.stderr,
        )
    print(
        f"\nFree the port or pick another:\n"
        f"  lsof -ti :{port} | xargs kill\n"
        f"  rubberduck serve --port {port + 100}",
        file=sys.stderr,
    )


def _rubberduck_responds(host: str, port: int) -> bool:
    """True if whatever owns the port answers with Rubberduck's self-probe
    header, so we can tell 'already running' from 'foreign process'."""
    try:
        resp = urllib.request.urlopen(f"http://{host}:{port}/", timeout=1)
    except OSError:
        return False
    return bool(resp.headers.get("X-Rubberduck") == "1")


def _auth_headers(content_type: bool = True) -> dict[str, str]:
    from rubberduck import security

    headers = {security.TOKEN_HEADER: security.load_or_create_token()}
    if content_type:
        headers["Content-Type"] = "application/json"
    return headers


def _launch(command: str, cwd: str, session_key: str | None, prompt: str) -> int:
    payload = {"command": command, "cwd": cwd, "session_key": session_key, "prompt": prompt}
    req = urllib.request.Request(
        f"{_server_url()}/sessions/launch",
        data=json.dumps(payload).encode(),
        headers=_auth_headers(),
        method="POST",
    )
    try:
        resp = urllib.request.urlopen(req, timeout=5)
    except OSError as e:
        print(f"could not reach server at {_server_url()}: {e}", file=sys.stderr)
        return 1
    print(json.load(resp)["session_key"])
    return 0


def _snapshot() -> int:
    req = urllib.request.Request(
        f"{_server_url()}/snapshots", data=b"", headers=_auth_headers(False), method="POST"
    )
    try:
        resp = urllib.request.urlopen(req, timeout=10)
    except OSError as e:
        print(f"could not reach server at {_server_url()}: {e}", file=sys.stderr)
        return 1
    print(json.load(resp)["id"])
    return 0


def _install_hooks(global_scope: bool) -> int:
    from rubberduck.hooks_install import install

    path = install(global_scope=global_scope, project_dir=Path.cwd())
    scope = "every project" if global_scope else "this repo"
    print(f"installed Rubberduck hooks for {scope}: {path}")
    print("Now run `rubberduck serve`, then start Claude Code — sessions appear automatically.")
    return 0


def _uninstall_hooks(global_scope: bool) -> int:
    from rubberduck.hooks_install import uninstall

    path = uninstall(global_scope=global_scope, project_dir=Path.cwd())
    print(f"removed Rubberduck hooks from {path}")
    return 0


def _dashboard() -> int:
    import subprocess
    import webbrowser

    from rubberduck.server import dashboard_dir

    if dashboard_dir() is None:
        web = Path(__file__).resolve().parents[2] / "web"
        if not web.exists():
            print("dashboard source (web/) not found", file=sys.stderr)
            return 1
        print("building the dashboard (web/)…", file=sys.stderr)
        build = subprocess.run(["npm", "run", "build"], cwd=web)
        if build.returncode != 0:
            print("dashboard build failed", file=sys.stderr)
            return 1
    url = _server_url()
    try:
        urllib.request.urlopen(f"{url}/", timeout=2)
    except OSError:
        print(f"server not reachable at {url} — start it with `rubberduck serve`", file=sys.stderr)
        return 1
    print(f"opening {url}")
    webbrowser.open(url)
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv if argv is not None else sys.argv[1:])
    if args.command is None:
        parser.print_help()
        return 0
    if args.command == "serve":
        return _serve(args.host, args.port)
    if args.command == "launch":
        return _launch(args.agent_command, args.cwd, args.session_key, args.prompt)
    if args.command == "snapshot":
        return _snapshot()
    if args.command == "dashboard":
        return _dashboard()
    if args.command == "install-hooks":
        return _install_hooks(args.global_scope)
    if args.command == "uninstall-hooks":
        return _uninstall_hooks(args.global_scope)
    print(f"command '{args.command}' is not implemented yet", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
