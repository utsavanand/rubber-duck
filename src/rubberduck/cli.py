"""Command-line entry point. Subcommands land in their respective Acts:
serve (Act 1), launch/fork (Acts 3/5), emit (Act 1+)."""

import argparse
import asyncio
import json
import os
import sys
import urllib.request
from collections.abc import Sequence

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
    return parser


def _serve(host: str, port: int) -> int:
    from rubberduck.server import Server

    print(f"rubberduck serving on http://{host}:{port}", file=sys.stderr)
    try:
        asyncio.run(Server().serve(host, port))
    except KeyboardInterrupt:
        return 0
    return 0


def _launch(command: str, cwd: str, session_key: str | None, prompt: str) -> int:
    payload = {"command": command, "cwd": cwd, "session_key": session_key, "prompt": prompt}
    req = urllib.request.Request(
        f"{_server_url()}/sessions/launch",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
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
    req = urllib.request.Request(f"{_server_url()}/snapshots", data=b"", method="POST")
    try:
        resp = urllib.request.urlopen(req, timeout=10)
    except OSError as e:
        print(f"could not reach server at {_server_url()}: {e}", file=sys.stderr)
        return 1
    print(json.load(resp)["id"])
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
    print(f"command '{args.command}' is not implemented yet", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
