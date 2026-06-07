#!/usr/bin/env python3
"""Grep the tree for slop markers the .claude/rules guardrails name, and fail on
hits. Not a substitute for the /slop-check skill's judgement — a cheap CI gate
that catches the mechanical patterns (vague doc adjectives, assertion-free tests).
"""

import ast
import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent

# doc-slop.md: vague adjectives that should be replaced with specific facts.
DOC_SLOP = re.compile(
    r"\b(robust|scalable|seamless|cutting-edge|state-of-the-art|enterprise-grade|"
    r"battle-tested|production-ready|leverages|utilizes)\b",
    re.IGNORECASE,
)

SKIP_DIRS = {
    ".git",
    ".venv",
    "node_modules",
    "dist",
    ".rubberduck",
    "__pycache__",
    ".claude",
}
# This file and the design doc legitimately name the slop words while describing them.
SKIP_FILES = {"slop_check.py", "rubberduck-design.md", "rubberduck-extraction.md"}


def iter_files(suffixes: tuple[str, ...]) -> list[Path]:
    out: list[Path] = []
    for p in ROOT.rglob("*"):
        if p.is_dir() or p.name in SKIP_FILES:
            continue
        if any(part in SKIP_DIRS for part in p.parts):
            continue
        if p.suffix in suffixes:
            out.append(p)
    return out


def _is_none_compare(node: ast.expr) -> bool:
    return isinstance(node, ast.Compare) and any(
        isinstance(op, ast.Is | ast.IsNot) and isinstance(c, ast.Constant) and c.value is None
        for op, c in zip(node.ops, node.comparators, strict=False)
    )


def _existence_only_tests(path: Path) -> list[str]:
    """Flag a test whose ONLY assertion is `x is None` / `x is not None`.
    Such a test verifies existence, not behavior (test-slop.md). The same
    comparison alongside stronger assertions is a legitimate narrowing guard.
    """
    tree = ast.parse(path.read_text(), filename=str(path))
    out: list[str] = []
    for fn in ast.walk(tree):
        if not (isinstance(fn, ast.FunctionDef) and fn.name.startswith("test_")):
            continue
        asserts = [n for n in ast.walk(fn) if isinstance(n, ast.Assert)]
        if len(asserts) == 1 and _is_none_compare(asserts[0].test):
            out.append(
                f"{path.relative_to(ROOT)}:{asserts[0].lineno}: "
                f"existence-only assert in {fn.name}"
            )
    return out


def main() -> int:
    failures: list[str] = []

    for path in iter_files((".md", ".py", ".ts", ".tsx")):
        for n, line in enumerate(path.read_text().splitlines(), 1):
            if DOC_SLOP.search(line):
                failures.append(f"{path.relative_to(ROOT)}:{n}: vague adjective: {line.strip()}")

    for path in iter_files((".py",)):
        if "test" not in path.name:
            continue
        failures.extend(_existence_only_tests(path))

    if failures:
        print("slop-check failed:", file=sys.stderr)
        for f in failures:
            print(f"  {f}", file=sys.stderr)
        return 1
    print("slop-check: clean")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
