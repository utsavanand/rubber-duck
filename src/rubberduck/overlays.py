"""Custom harnesses (overlays): wrappers installed on top of a coding harness.

Two layers, two contracts:

  - A coding harness (`Harness`, runtimes/) RUNS the model — claude-code,
    codex, copilot. It owns launch/resume, state, transcripts, hooks, approval.
  - A custom harness / overlay (this module) WRAPS a coding harness — UV Suite
    wrapping claude-code, a team's language-specific wrapper. It doesn't run a
    model, so it inherits everything above from its base; what it adds is its
    own session identity (a name, tags like kind/priority) and, later, launch
    wrapping and skills.

How a session gets associated with an overlay — the announcement protocol:
the overlay's launcher exports two env vars before starting the base agent:

    RUBBERDUCK_OVERLAY=<registry name>            # e.g. uv-suite
    RUBBERDUCK_OVERLAY_SESSION=<its own session id>

The agent's children inherit them, so the shared hook script forwards both on
every event with zero per-overlay logic in bash. The server validates the name
against OVERLAYS and stores both on the session row; /sessions then asks the
adapter for metadata and attaches `overlay` + `overlay_name` for the dashboard.

Deliberately NOT in the v1 contract (build when the trigger lands):
  - launch-through-overlay (trigger: launching UV Suite sessions from the
    dashboard's New session flow),
  - skills listing (trigger: the all-skills dashboard view on the roadmap),
  - a richer overlay event vocabulary. Overlays that want to push data today
    already can: POST /events accepts extra fields and PATCH /sessions/:key
    sets the explicit name — that existing HTTP surface is the "custom hooks"
    integration point.
"""

import json
from pathlib import Path
from typing import Any


class Overlay:
    """One adapter per custom harness. Subclass and register in OVERLAYS."""

    name: str  # registry id, announced via RUBBERDUCK_OVERLAY
    base: str  # registry name of the coding harness it wraps

    def session_meta(self, *, cwd: Path, overlay_session: str | None) -> dict[str, Any]:
        """The overlay's own metadata for a session in `cwd` — at minimum
        {"name": …} when known, {} when not. `overlay_session` is the id the
        launcher announced; None means the session predates the announcement
        protocol and the adapter may fall back to its own discovery."""
        raise NotImplementedError


class UVSuiteOverlay(Overlay):
    """UV Suite (https://github.com/…/uv-suite) wraps claude-code and stores
    per-session metadata at <project>/.uv-suite-state/sessions/<id>.json
    (name, kind, purpose, priority — written by its /session-init skill)."""

    name = "uv-suite"
    base = "claude-code"

    def session_meta(self, *, cwd: Path, overlay_session: str | None) -> dict[str, Any]:
        state = cwd / ".uv-suite-state"
        sid = overlay_session
        if sid is None:
            # Pre-announcement sessions: the pointer names the project's current
            # UV Suite session. Right for the common one-session-per-project
            # case; two concurrent UV Suite sessions in one cwd both get the
            # pointed-at name until their launchers announce (documented).
            try:
                sid = (state / "current-session.txt").read_text().strip()
            except OSError:
                return {}
        if not valid_overlay_session(sid):
            return {}
        try:
            meta = json.loads((state / "sessions" / f"{sid}.json").read_text())
        except (OSError, json.JSONDecodeError):
            return {}
        if not isinstance(meta, dict):
            return {}
        out = {k: meta[k] for k in ("name", "kind", "priority", "purpose") if meta.get(k)}
        return out if out.get("name") else {}


def valid_overlay_session(sid: object) -> bool:
    """The overlay session id is interpolated into a file path — reject
    anything that could traverse out of the sessions dir."""
    return isinstance(sid, str) and bool(sid) and all(c.isalnum() or c in "-_" for c in sid)


OVERLAYS: dict[str, Overlay] = {
    "uv-suite": UVSuiteOverlay(),
}


def enrich_with_overlay(row: dict[str, Any]) -> None:
    """Attach overlay_name (and overlay, when detected by probe) to a session
    row in place. Announced overlays resolve directly; un-announced rows are
    probed against each registered overlay whose base matches the runtime."""
    cwd = row.get("cwd")
    if not cwd:
        return
    announced = row.get("overlay")
    if announced:
        adapter = OVERLAYS.get(str(announced))
        if adapter is None:
            return
        session = row.get("overlay_session")
        meta = adapter.session_meta(
            cwd=Path(str(cwd)), overlay_session=str(session) if session else None
        )
        if meta:
            row["overlay_name"] = meta["name"]
        return
    for adapter in OVERLAYS.values():
        if adapter.base != row.get("runtime"):
            continue
        meta = adapter.session_meta(cwd=Path(str(cwd)), overlay_session=None)
        if meta:
            row["overlay"] = adapter.name
            row["overlay_name"] = meta["name"]
            return
