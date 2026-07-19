# Custom harnesses (overlays)

Two layers, two contracts:

| Layer | Contract | Examples | What it owns |
|---|---|---|---|
| Coding harness | `Harness` (`runtimes/base.py`) | claude-code, codex, copilot | Runs the model: launch/resume, state, transcript, hooks, `ApprovalSpec` |
| Custom harness (overlay) | `Overlay` (`overlays.py`) | UV Suite, a team's language wrapper | Wraps a coding harness: its own session identity (name/tags), later launch wrapping + skills |

An overlay never runs a model, so it inherits everything a session needs from
its `base` coding harness. What it declares is only what it *adds*.

## The v1 contract

```python
class Overlay:
    name: str   # registry id, e.g. "uv-suite"
    base: str   # coding harness it wraps, e.g. "claude-code"

    def session_meta(self, *, cwd, overlay_session) -> dict:
        # {"name": ...} at minimum, plus whatever tags it keeps
        # (UV Suite: kind, priority, purpose). {} when unknown.
```

Registered in `overlays.OVERLAYS`. One adapter exists: `UVSuiteOverlay`, which
reads `<cwd>/.uv-suite-state/sessions/<id>.json`.

## How a session gets its overlay — the announcement protocol

The overlay's launcher exports, before starting the base agent:

```sh
export RUBBERDUCK_OVERLAY=uv-suite
export RUBBERDUCK_OVERLAY_SESSION=<the overlay's own session id>
```

Hook processes inherit the env, so the shared hook script forwards both fields
on every event with no per-overlay logic in bash (same principle as
ApprovalSpec: bash stays generic, Python knows the specifics). The server
validates `overlay` against the registry and `overlay_session` against a
path-safe charset (it's interpolated into a filename), persists both on the
session row, and `GET /sessions` attaches `overlay_name` resolved by the
adapter.

Sessions that predate the announcement (today's UV Suite doesn't export yet)
are probed: for each registered overlay whose `base` matches the session's
runtime, the adapter may fall back to its own discovery — UV Suite uses the
`current-session.txt` pointer. Correct for one overlay session per project
directory; two concurrent ones in the same cwd both show the pointed-at name
until their launchers announce.

## Label priority (dashboard)

explicit rename > `overlay_name` > iTerm tab title > cwd folder name > key prefix

## Deferred, with triggers

- **Launch through the overlay** (New session picker offering "claude-code via
  UV Suite"): build when someone wants to *start* overlay sessions from the
  dashboard, not just watch them. Needs one more contract field (the launcher
  argv wrapper).
- **Skills listing** (`skills() -> list[...]`): build together with the
  roadmap's all-skills dashboard view — it's that view's data source.
- **Overlay event vocabulary / custom hooks**: overlays that want to push
  richer data already have an HTTP surface — `POST /events` accepts extra
  fields and `PATCH /sessions/:key` sets the explicit name. Formalize a schema
  only when a second overlay actually needs more than name/tags.
