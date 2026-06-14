# Architecture: a harness-agnostic core with per-harness adapters

## The principle
Rubberduck's core knows nothing about any specific agent. It speaks one
vocabulary (sessions + events + transcripts), and every agent — Claude Code,
Codex, Copilot, or one you bring — plugs in through an **adapter**. Onboard a new
harness by writing one adapter; it then "shows up" in Rubberduck like the others.

```
        ┌────────────────────────────────────────────┐
        │                Rubberduck core               │
        │  EventBus · HistoryStore · Orchestrator ·    │  ← harness-agnostic
        │  dashboard · checkpoints · forks             │     (one vocabulary)
        └───────────────▲───────────────▲──────────────┘
                        │               │
            observe (events)      drive (launch/state/transcript)
                        │               │
        ┌───────────────┴───────────────┴──────────────┐
        │                 Harness adapters              │
        │   claude-code   codex   copilot   <yours>     │
        └───────────────────────────────────────────────┘
                        │
        each adapter knows ONE agent's specifics:
        its hook config, event field names, transcript format,
        launch/resume commands, state markers.
```

## The one vocabulary the core speaks
- **Session** — a row keyed by `session_key`, with state (idle/busy/waiting/
  terminated), runtime name, repo/branch/worktree, launched-vs-watched.
- **Event** — `{event_type, session_key, ...}` where event_type is the canonical
  set: SessionStart, UserPromptSubmit, PreToolUse, PostToolUse,
  PermissionRequest, Notification, Stop, SessionEnd.
- **Transcript record** — `{role, text}`, the agent's conversation incl. its own
  responses.
Everything downstream (dashboard, pulse, HITL, checkpoints, forks) is built only
on this vocabulary — never on a specific agent.

## An adapter has two responsibilities

### 1. Observe — get an agent's activity into the core (watched sessions)
The agent reports to Rubberduck via its own hook system. The adapter declares:
- **where its hook config lives** and **how to write/remove our entries**
  (today: `Harness` in `agents/hooks_install.py`).
- **how its event names map to our canonical set** (e.g. Copilot's camelCase
  `sessionStart` → `SessionStart`).
- The shared `rubberduck-hook.sh` posts the normalized event to `POST /events`.

### 2. Drive — let Rubberduck run/inspect an agent (launched sessions)
When Rubberduck launches an agent itself, the adapter declares (today:
`AgentRuntime` in `runtimes/`):
- `launch_command` / `restore_command` — how to start / resume it.
- `detect_state` — read state from its output.
- `read_transcript` — parse its native transcript (JSONL, SQLite, …) into
  `{role, text}`.

## The gap (what this doc is driving toward)
These two responsibilities live in **two unconnected places** — `runtimes/` and
`agents/hooks_install.py` — with no single contract. Adding a harness means
editing both, in different files, and nothing enforces they stay consistent
(same name string, same event mapping).

**Target: one `Harness` adapter per agent** that owns both halves, so onboarding
is "implement one interface, register it once." Sketch:

```python
class Harness(Protocol):
    name: str                       # "codex"
    # observe
    hook_config_path(global_) -> Path
    hook_entries(script) -> dict     # what to merge into the agent's config
    event_map: dict[str, str]        # agent event name -> canonical
    # drive
    launch_command(...) -> list[str]
    resume_command(session_id) -> list[str]   # conversation fork (all 3 support it)
    detect_state(output) -> SessionState
    read_transcript(cwd, session_id) -> list[Record]
```

A central registry maps `name -> Harness`. The CLI (`install-hooks --agent`),
the server (`_build_runtime`), and checkpoints all resolve through it. Adding
"cursor" or "aider" = one file + one registry entry; it then appears in the
agent picker, install-hooks choices, and gets full checkpoint/fork support for
free.

## Onboarding a new harness (the contract, once unified)
1. Create `harnesses/<name>.py` implementing the `Harness` interface.
2. Register it in the harness registry.
3. That's it — it shows up in `install-hooks --agent <name>`, the New-session
   agent picker, watched-session ingestion, checkpoints (transcript capture),
   and conversation-fork.

If the agent has **no hook system**, it can still be *driven* (launched) via the
generic runtime — it just can't be *watched*. Watched support requires the agent
to expose a hook/config mechanism (Claude/Codex/Copilot all do).

## Migration path (incremental, non-breaking)
1. Define the unified `Harness` protocol (superset of today's `AgentRuntime` +
   `Harness`/install pieces).
2. Have each existing agent implement it, delegating to the current code at
   first (no behavior change).
3. Point `install-hooks`, `_build_runtime`, and checkpoint transcript-reading at
   the single registry.
4. Collapse the duplicated name strings / event maps.
5. Document the contract so a contributor can add a harness without reading the
   core.

## Why this matters
- **Extensibility**: new agents are additive, one file, no core changes.
- **Consistency**: one place defines an agent's name, events, transcript — no
  drift between the drive and observe halves.
- **The pitch**: "your harness is compatible with Rubberduck" becomes a concrete
  contract a tool author can implement, not tribal knowledge.
