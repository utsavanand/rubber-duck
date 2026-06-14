"""Seed the running server with a realistic fleet so the dashboard has
something to show: watched and launched sessions, forks, prompts, real Bash
commands, and a pending permission request. Posts to POST /events (the path the
hooks use) with the per-install token.

Keys are suffixed with a unique run id each run, because deleted sessions are
tombstoned — reusing a key would be suppressed. Run with the server on :4200:

    python scripts/seed_demo.py
"""

import json
import os
import sys
import time
import urllib.request

BASE = "http://127.0.0.1:4200"
CODE = "/Users/you/code/checkout-service"
DOCS = "/Users/you/code/docs"
RUN = str(int(time.time()))[-5:]  # unique per run, dodges tombstones

_token_path = os.path.expanduser(
    os.path.join(os.environ.get("RUBBERDUCK_HOME", "~/.rubberduck"), "token")
)
try:
    TOKEN = open(_token_path).read().strip()
except OSError:
    TOKEN = ""


def post(path, payload, method="POST"):
    req = urllib.request.Request(
        f"{BASE}{path}",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "X-Rubberduck-Token": TOKEN},
        method=method,
    )
    try:
        urllib.request.urlopen(req, timeout=5).read()
    except urllib.error.HTTPError as e:
        print(f"  {method} {path} -> {e.code}", file=sys.stderr)


def emit(**event):
    event.setdefault("_ts", int(time.time() * 1000))
    # Every seeded session is flagged test=1 so `rubberduck purge-test` removes
    # it (and all its data) cleanly — seed data never pollutes real history.
    event.setdefault("test", True)
    post("/events", event)


def k(name):
    return f"{name}-{RUN}"


# (key-stem, display name, parent-stem, cwd, branch, runtime, launched)
SESSIONS = [
    (
        "checkout-refactor",
        "checkout-refactor",
        None,
        CODE,
        "checkout-refactor",
        "claude-code",
        True,
    ),
    (
        "checkout-idem",
        "checkout-refactor · idempotency",
        "checkout-refactor",
        CODE,
        "checkout-idempotency",
        "claude-code",
        True,
    ),
    (
        "checkout-retry",
        "checkout-refactor · retry-path",
        "checkout-refactor",
        CODE,
        "checkout-retry",
        "claude-code",
        True,
    ),
    ("payments-audit", "payments-audit", None, CODE, "payments-audit", "codex", False),
    ("release-notes", "release-notes", None, DOCS, None, "claude-code", False),
    ("dep-upgrade", "dep-upgrade", None, CODE, "dep-upgrade", "copilot", True),
]

for stem, name, parent, cwd, branch, runtime, launched in SESSIONS:
    emit(
        event_type="SessionStart",
        session_key=k(stem),
        cwd=cwd,
        branch=branch,
        runtime=runtime,
        parent_session_key=k(parent) if parent else None,
        # Mirror what the server stamps for a real Rubberduck-launched session.
        launched=launched,
    )

# Human prompts (show in the pulse + feed checkpoints).
for stem, prompt in [
    ("checkout-refactor", "extract the idempotency key handling into its own module"),
    ("payments-audit", "audit the refund path for double-charge bugs"),
    ("dep-upgrade", "bump all deps to latest minor and run the tests"),
]:
    emit(event_type="UserPromptSubmit", session_key=k(stem), prompt=prompt, cwd=CODE)

# Activity with REAL commands, so the pulse shows detail not just "Bash".
ACTIVITY = [
    ("checkout-refactor", "Edit", {"file_path": "src/checkout/idempotency.ts"}),
    ("checkout-refactor", "Bash", {"command": "npm run test -- checkout"}),
    ("payments-audit", "Grep", {"pattern": "refund", "path": "src/payments"}),
    ("checkout-idem", "Read", {"file_path": "src/checkout/store.ts"}),
    ("dep-upgrade", "Bash", {"command": "npm outdated --json"}),
    ("checkout-refactor", "Edit", {"file_path": "src/checkout/store.ts"}),
    ("payments-audit", "Bash", {"command": "psql -c 'SELECT count(*) FROM refunds'"}),
    ("checkout-retry", "Edit", {"file_path": "src/checkout/retry.ts"}),
    ("dep-upgrade", "Bash", {"command": "npm install && npm test"}),
]
for stem, tool, tool_input in ACTIVITY:
    emit(
        event_type="PreToolUse",
        session_key=k(stem),
        tool_name=tool,
        tool_input=tool_input,
        cwd=CODE,
    )
    time.sleep(0.1)

# A launched session needs you (reachable -> Approve/Deny) and a watched one
# also needs you (unreachable -> "watched" badge).
emit(
    event_type="PermissionRequest",
    session_key=k("dep-upgrade"),
    tool_name="Bash",
    tool_input={"command": "rm -rf node_modules && npm ci"},
    cwd=CODE,
)
emit(
    event_type="PermissionRequest",
    session_key=k("payments-audit"),
    tool_name="Bash",
    tool_input={"command": "psql -c 'DROP TABLE refunds_tmp'"},
    cwd=CODE,
)

# release-notes goes quiet (idle after a Stop).
emit(event_type="Stop", session_key=k("release-notes"), cwd=DOCS)

# Persist display names (SessionStart alone doesn't set the display name).
time.sleep(0.3)
for stem, name, *_ in SESSIONS:
    post(f"/sessions/{k(stem)}", {"name": name}, method="PATCH")

print(f"seeded run {RUN}. open the dashboard at :4200")
