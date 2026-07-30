"""Custom harnesses: suites installed on top of a coding harness.

Two layers:

  - A coding harness (`Harness`, runtimes/) RUNS the model — claude-code,
    codex, copilot. Its extension surface is the Harness contract: launch,
    state, transcript, `hook_spec`, `ApprovalSpec`.
  - A custom harness (this module) is a SUITE installed on top — UV Suite,
    a team's language wrapper. It runs no model; it adds skills/hooks/
    guardrails to the base agent and keeps its own session identity.

The cross-repo contract is the suite's MANIFEST (`duckterm-harness.json`,
established by Rubberterm's suites.py, which consumes the install half):

    {
      "name": "uv-suite",
      "description": "Agents, skills, hooks, and guardrails for Claude Code",
      "install": ["./install.sh", "--project", "{dir}"],   // Rubberterm
      "uninstall": ["./uninstall.sh"],                     // Rubberterm
      "args_choices": {"--persona": ["sport", "professional"]},
      "base": "claude-code",                               // Rubberduck
      "session_meta": {                                    // Rubberduck
        "sessions_dir": ".uv-suite-state/sessions",
        "pointer": ".uv-suite-state/current-session.txt",
        "fields": ["name", "kind", "priority", "purpose"]
      }
    }

Each product reads the fields it consumes and ignores the rest — one manifest
per suite, not one per product. This module models the Rubberduck half
(identity); see docs/custom-harnesses.md for the full field-by-field table.

How a session gets associated with a suite — the announcement protocol: the
suite's launcher exports two env vars before starting the base agent:

    RUBBERDUCK_OVERLAY=<suite name>
    RUBBERDUCK_OVERLAY_SESSION=<the suite's own session id>

Hook processes inherit them, so the shared hook script forwards both on every
event with zero per-suite logic in bash. The server validates the name against
OVERLAYS and the id against a path-safe charset (it lands in a filename),
persists both on the session row, and /sessions attaches `overlay_name`.
Sessions that predate the announcement are probed via the manifest's `pointer`
file — right for one suite session per project dir; concurrent ones in the
same cwd need the env vars to resolve exactly.
"""

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class SessionMetaSpec:
    """Where a suite keeps per-session metadata, relative to the project dir.
    `<sessions_dir>/<session id>.json` holds at least {"name": …}; `pointer`
    (optional) is a file naming the project's current session id, used when a
    session predates the env announcement. `fields` are the keys surfaced to
    the dashboard — `name` must be one of them."""

    sessions_dir: str
    pointer: str | None
    fields: tuple[str, ...]


@dataclass(frozen=True)
class Overlay:
    """One registered custom harness (the manifest's Rubberduck-relevant
    fields). `base` is the coding harness it wraps — everything the base
    declares (transcript, approval, hooks) applies to the session unchanged."""

    name: str
    base: str
    session_meta: SessionMetaSpec

    def read_session_meta(self, *, cwd: Path, overlay_session: str | None) -> dict[str, Any]:
        """The suite's own metadata for a session in `cwd` — {"name": …, tags}
        when known, {} when not (folder-name fallback stays in charge)."""
        spec = self.session_meta
        sid = overlay_session
        if sid is None and spec.pointer:
            try:
                sid = (cwd / spec.pointer).read_text().strip()
            except OSError:
                return {}
        if sid is None or not valid_overlay_session(sid):
            return {}
        try:
            meta = json.loads((cwd / spec.sessions_dir / f"{sid}.json").read_text())
        except (OSError, json.JSONDecodeError):
            return {}
        if not isinstance(meta, dict):
            return {}
        out = {k: meta[k] for k in spec.fields if meta.get(k)}
        return out if out.get("name") else {}


def valid_overlay_session(sid: object) -> bool:
    """The suite session id is interpolated into a file path — reject anything
    that could traverse out of the sessions dir."""
    return isinstance(sid, str) and bool(sid) and all(c.isalnum() or c in "-_" for c in sid)


# Built-in registry. Entries are manifest data, not code — adding a suite is
# adding a dict (or, later, loading its duckterm-harness.json from disk the way
# Rubberterm's suite registration does; the shapes are already identical).
OVERLAYS: dict[str, Overlay] = {
    "uv-suite": Overlay(
        name="uv-suite",
        base="claude-code",
        session_meta=SessionMetaSpec(
            sessions_dir=".uv-suite-state/sessions",
            pointer=".uv-suite-state/current-session.txt",
            fields=("name", "kind", "priority", "purpose"),
        ),
    ),
}


def enrich_with_overlay(row: dict[str, Any]) -> None:
    """Attach overlay_name (and overlay, when detected by probe) to a session
    row in place. Announced suites resolve directly; un-announced rows are
    probed against each registered suite whose base matches the runtime."""
    cwd = row.get("cwd")
    if not cwd:
        return
    announced = row.get("overlay")
    if announced:
        overlay = OVERLAYS.get(str(announced))
        if overlay is None:
            return
        session = row.get("overlay_session")
        meta = overlay.read_session_meta(
            cwd=Path(str(cwd)), overlay_session=str(session) if session else None
        )
        if meta:
            row["overlay_name"] = meta["name"]
        return
    for overlay in OVERLAYS.values():
        if overlay.base != row.get("runtime"):
            continue
        meta = overlay.read_session_meta(cwd=Path(str(cwd)), overlay_session=None)
        if meta:
            row["overlay"] = overlay.name
            row["overlay_name"] = meta["name"]
            return
