"""A scriptable stand-in for a real CLI coding agent.

Lets runtime tests drive a deterministic agent through state transitions
(busy -> idle -> waiting) and tool invocations without spending tokens on a
real LLM. It speaks a tiny line protocol on stdout that the `generic` runtime's
state detector keys off of:

    [busy]            agent is working
    [idle]            agent is done, ready for input
    [waiting] <text>  agent is blocked on a human (prompt / permission)
    [tool] <name>     agent invoked a tool (e.g. "[tool] build")

The script is a sequence of steps read from a file (one per line). Each step is
either a directive above (emitted verbatim to stdout, minus a configurable
per-step delay) or `exit <code>` to terminate. With no script it emits a single
busy->idle cycle and exits 0.

Usage:
    python fake_agent.py [--script PATH] [--delay SECONDS] [--cwd DIR]
"""

import argparse
import sys
import time
from collections.abc import Iterator
from pathlib import Path

VALID_DIRECTIVES = ("[busy]", "[idle]", "[waiting]", "[tool]")


def read_script(path: Path | None) -> list[str]:
    if path is None:
        return ["[busy]", "[idle]"]
    lines = path.read_text().splitlines()
    return [line for line in lines if line.strip() and not line.startswith("#")]


def run(steps: Iterator[str], delay: float) -> int:
    for step in steps:
        if step.startswith("exit"):
            parts = step.split()
            return int(parts[1]) if len(parts) > 1 else 0
        if not step.startswith(VALID_DIRECTIVES):
            print(f"fake_agent: unknown step {step!r}", file=sys.stderr)
            return 2
        print(step, flush=True)
        if delay:
            time.sleep(delay)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="fake_agent")
    parser.add_argument("--script", type=Path, default=None)
    parser.add_argument("--delay", type=float, default=0.0)
    parser.add_argument("--cwd", type=Path, default=None)
    args = parser.parse_args(argv)
    return run(iter(read_script(args.script)), args.delay)


if __name__ == "__main__":
    raise SystemExit(main())
