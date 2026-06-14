"""Classify tool events into countable metrics (builds, tests).

A session's "how many times did it compile / run tests" comes from counting the
tool events whose command or tool name matches a known pattern. Patterns are
plain substrings so they stay obvious and overridable; the default set covers
the common JS/Python/Rust/Go invocations.
"""

import re
from typing import Any

Event = dict[str, Any]

# kind -> regex over the command string / tool name.
DEFAULT_PATTERNS: dict[str, re.Pattern[str]] = {
    "build": re.compile(
        r"\b(npm run build|yarn build|tsc|vite build|cargo build|go build|make\b|"
        r"gradle|mvn|webpack|rollup)\b"
    ),
    "test": re.compile(
        r"\b(pytest|npm test|yarn test|jest|vitest|cargo test|go test|" r"rspec|mocha|unittest)\b"
    ),
}


def classify(event: Event, patterns: dict[str, re.Pattern[str]] | None = None) -> str | None:
    """Return the metric kind this event counts toward, or None.

    Looks at the tool command (tool_input.command) and the tool name — the
    fields a PreToolUse event carries for a shell/test invocation."""
    if event.get("event_type") not in ("PreToolUse", "PostToolUse"):
        return None
    pats = patterns if patterns is not None else DEFAULT_PATTERNS
    haystack = " ".join(
        str(x)
        for x in (
            event.get("tool_name"),
            (event.get("tool_input") or {}).get("command"),
        )
        if x
    )
    for kind, pattern in pats.items():
        if pattern.search(haystack):
            return kind
    return None
