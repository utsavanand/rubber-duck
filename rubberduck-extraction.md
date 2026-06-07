# Rubberduck — Extracting Watchtower into a Standalone, Agent-Agnostic Product

**Status:** Proposal / extraction brief
**Audience:** The agent (or engineer) who will build Rubberduck from scratch
**Source material:** `watchtower/` and `hooks/` in the `uv-suite` repo (commit `e444c38`)

---

## 1. What we're building and why

**Rubberduck** is a local-first observability and control plane for AI coding agents. You point any agent session at it — Claude Code, Codex, Cursor, a custom SDK loop, whatever — and Rubberduck shows you, live:

- which sessions are running, idle, or terminated
- what each one is doing right now (tool calls, prompts, errors, permission requests)
- which ones need a human
- periodic summaries of each session ("checkpoints") so you can catch up without reading a transcript
- snapshots of all active work at a moment in time, and a one-click way to resume a dead session

The pitch: *"You're running five agents in five terminals. Rubberduck is the one window that tells you what they're all doing and lets you jump back into any of them."*

It must **not** depend on uv-suite, on Claude Code specifically, or on any particular agent runtime. uv-suite becomes *one consumer* of Rubberduck, not its owner.

### Why this is a clean extraction, not a rewrite

The existing Watchtower server is already almost entirely agent-agnostic. The server (`watchtower/server.js`) validates none of the event payload — it timestamps whatever JSON arrives at `POST /events`, assigns it an id, stores it in a ring buffer, and broadcasts it over SSE. The dashboard reads a handful of well-known fields and degrades gracefully when they're absent.

All the coupling to uv-suite / Claude Code lives at **three edges**, plus some naming. Get those edges behind adapters and the core is portable as-is.

---

## 2. Anatomy of the current implementation

Read these in the source repo before starting; they are the reference implementation, not the spec.

| File | Lines | Role | Portability |
|---|---|---|---|
| `watchtower/server.js` | 263 | HTTP server: `/events` ingest, `/stream` SSE, `/snapshots*`, serves dashboard | **Generic.** Only coupling is the string `"UV Suite Watchtower"` used as a self-probe and the `UVS_*` env var names. |
| `watchtower/dashboard.html` | 1,212 | Single-file SPA dashboard (vanilla JS, SSE client, no build step) | **Generic.** Reads `event_type`, `uvs_session_id`, `lifecycle`, `cwd`, `session_*`, `tool_name`, `tool_input.*`. Needs rename + field-name decisions. |
| `watchtower/snapshot-manager.js` | 305 | Bundle active sessions + events to disk; spawn a terminal to restore one | **Mostly generic.** The restore *command* (`uvs claude <persona>`) is the only hard coupling. |
| `watchtower/auto-checkpoint-runner.js` | 532 | Tier-B timer: read transcript, summarize via `claude -p`, write checkpoint .md | **Two hard couplings:** transcript path + the `claude` summarizer. |
| `watchtower/auto-checkpoint-prompt.md` | 42 | Prompt template for the summarizer | Generic (template). |

And the **ingest side** (shell hooks that produce events):

| File | Role |
|---|---|
| `hooks/watchtower-send.sh` | The single egress point. `curl -X POST $URL/events` with the hook's stdin JSON enriched with session metadata. |
| `hooks/session-start.sh`, `session-end.sh`, `session-end-helper.sh` | Emit lifecycle (`SessionStart` / `SessionEnd`) events and manage local session state. |
| `hooks/session-meta.sh` | Writes session metadata JSON that `watchtower-send.sh` merges into every event. |
| `hooks/auto-checkpoint.sh` | Tier-A mechanical checkpoint (append-only activity log + periodic mechanical .md). |
| `hooks/status-line.sh` | Renders the Claude Code status line (not part of Rubberduck; UV-Suite UX). |

> **Note for the builder:** these hooks are tightly bound to Claude Code's hook system and uv-suite's `.uv-suite-state/` layout. **Do not port them verbatim.** They are the *first ingest adapter's* reference behavior, nothing more. The Rubberduck core never sees a shell hook — it only ever sees `POST /events`.

---

## 3. The contract that already exists (and that we keep)

This is the load-bearing interface. Rubberduck's stability promise is this HTTP contract, not any internal code.

### 3.1 Ingest: `POST /events`

Body is any JSON object. The server adds `_ts` (epoch ms) and `_id` (uuid) and broadcasts it. The dashboard and the snapshot/checkpoint engines understand these fields when present:

| Field | Type | Meaning | Required? |
|---|---|---|---|
| `event_type` | string | `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `Notification`, `Stop`, `SessionEnd`, `AutoCheckpoint`, `SnapshotTaken` | yes (drives everything) |
| `session_id` | string | The agent runtime's own session id (transcript correlation) | strongly recommended |
| `uvs_session_id` | string | Rubberduck's stable session key (survives restarts/relabels) | recommended; falls back to `session_id` |
| `cwd` | string | Working directory of the session | recommended (snapshots/checkpoints need it) |
| `source_app` | string | Short label (basename of cwd today) | optional |
| `session_name` / `session_kind` / `session_purpose` / `session_priority` | string | Human-set session metadata for grouping/labelling | optional |
| `tool_name` | string | For tool events | optional |
| `tool_input` | object | `{ file_path, command, pattern, url, description, path }` — dashboard renders these | optional |
| `lifecycle` | string | `terminated` flips the session badge and removes it from "active" | optional |
| `persona` | string | UV-Suite-specific label; **generalize or drop** (see §6) | optional |

**Action for the new product:** rename `uvs_session_id` → `session_key` (or keep `uvs_session_id` as a documented alias for one release). Decide whether `persona` becomes a generic free-form `tag`/`label`. Everything else carries over unchanged. Document this table as the public event schema.

### 3.2 Read endpoints

- `GET /stream` — SSE. Sends `{type:"init", events:[...last 100]}` on connect, then one `data:` frame per event. 15s keep-alive ping. This is what the dashboard uses.
- `GET /events` — last 100 as JSON (REST fallback / polling clients).

### 3.3 Snapshot endpoints

- `POST /snapshots` — bundle every active session (activity in last 1h) + the event store to `~/.<product>/snapshots/<id>/`; trigger an immediate checkpoint tick first so summaries are fresh.
- `GET /snapshots`, `GET /snapshots/:id` — list / fetch manifest.
- `POST /snapshots/:id/sessions/:sid/restore` — resume a session (see §5.3 — this is adapter territory).

Keep these verbatim. They are agent-agnostic except the restore command.

---

## 4. The three couplings to break

Everything that makes this "uv-suite's Watchtower" instead of "Rubberduck" reduces to three seams. Turn each into a small adapter interface.

### Coupling 1 — Ingest trigger (the big one)

**Today:** events are produced exclusively by Claude Code's hook system. `.claude/settings.json` wires hook events (`PostToolUse`, `SessionStart`, `Stop`, `PermissionRequest`, `Notification`, `UserPromptSubmit`, `PostToolUseFailure`) to `watchtower-send.sh`, which reads Claude's stdin JSON (with its `tool_name` / `tool_input.*` shape) and `CLAUDE_PROJECT_DIR`. Codex and other agents have no equivalent, so **today they emit nothing and are invisible on the dashboard.** This is the single biggest gap.

**Abstraction — `IngestAdapter`.** An adapter's only job is to turn agent activity into `POST /events` calls with the schema in §3.1. Ship these:

1. **`claude-code` adapter** — a thin set of hook scripts (the spiritual successor to `watchtower-send.sh`) that map Claude's hook stdin → the event schema. This is the reference adapter and should be near-identical to today's behavior, minus the `.uv-suite-state` enrichment (see §5.1).
2. **`generic` adapter — a `rubberduck emit` CLI.** `rubberduck emit --type PostToolUse --tool Edit --file foo.ts --session-key abc`. Any agent, script, or runtime that can shell out can produce events. This is the lowest-common-denominator integration and should be documented as the primary path for "any agent."
3. **`transcript-tail` adapter (optional, later)** — for runtimes with no hook system (e.g. Codex), tail the runtime's transcript/log file and synthesize events. More work; defer until a concrete second runtime needs it. Document it as a planned adapter, don't build it speculatively.

The core depends on **none** of these. The adapter contract is literally "make HTTP POSTs in the documented schema." Adapters live in `adapters/<name>/` and are independently installable.

### Coupling 2 — Transcript locator

**Today:** `auto-checkpoint-runner.js:91` hardcodes `~/.claude/projects/<cwd-with-slashes-as-dashes>/<session_id>.jsonl` and a Claude-specific JSONL parser (it already tolerates several Claude message shapes).

**Abstraction — `TranscriptLocator`.** Given `(cwd, session_id, runtime)`, return the transcript file path (or null) and a parser that yields `{role, text, ts}` records. Ship the Claude Code locator first. Make `runtime` a field on the session (derivable from events) so the right locator is chosen. When no locator matches, checkpoints still work — they just fall back to the mechanical/event-only summary the code already produces when the transcript is missing.

### Coupling 3 — Summarizer

**Today:** `runClaudeP()` spawns `claude -p --bare --model haiku --max-budget-usd 0.05` and pipes the prompt to stdin.

**Abstraction — `Summarizer`.** Input: a filled prompt string. Output: `{ok, text}`. Implementations:
- **CLI summarizer** (default): configurable command + args via env, e.g. `RUBBERDUCK_SUMMARIZER_CMD="claude -p --bare --model haiku"`. Keeps the zero-dependency, no-API-key story for Claude/Codex CLI users.
- **HTTP summarizer** (optional): `RUBBERDUCK_SUMMARIZER_URL` + key, for users who'd rather call an API directly.
- **none**: disable semantic summaries; keep mechanical checkpoints only.

The checkpoint runner already degrades gracefully when summarization fails (writes a stub summary + raw conversation). Preserve that.

---

## 5. State, naming, and config to generalize

### 5.1 Session metadata enrichment

`watchtower-send.sh` enriches every event from `.uv-suite-state/sessions/<sid>.json` (name/kind/purpose/priority/persona/git context). That's a uv-suite convention.

**Decision:** the **core should not require** any local metadata store. Metadata should ride on the events themselves (it already can — see §3.1). The `claude-code` adapter may keep a small local metadata file as a convenience for enrichment, but that's an adapter detail, not a core dependency. A bare `rubberduck emit` with just `event_type` + `session_key` must produce a usable dashboard row.

### 5.2 Paths and env vars

Rename the `UVS_*` namespace to `RUBBERDUCK_*` (keep `UVS_*` read as fallback aliases for one release so uv-suite keeps working during migration):

| Today | Rubberduck |
|---|---|
| `UVS_WATCHTOWER_PORT` | `RUBBERDUCK_PORT` (default 4200) |
| `UVS_WATCHTOWER_URL` | `RUBBERDUCK_URL` (default `http://localhost:4200`) |
| `UVS_SESSION_ID` | `RUBBERDUCK_SESSION_KEY` |
| `UVS_AUTO_CHECKPOINT_DISABLED` | `RUBBERDUCK_CHECKPOINT_DISABLED` |
| `UVS_TERMINAL_APP` | `RUBBERDUCK_TERMINAL_APP` |
| `UVS_RESTORE_FROM` | `RUBBERDUCK_RESTORE_FROM` |

Storage locations:
- Snapshots: `~/.uv-suite/snapshots/` → `~/.rubberduck/snapshots/`
- Checkpoints today land in `<cwd>/uv-out/checkpoints/<sid>/`. For Rubberduck, default to `<cwd>/.rubberduck/checkpoints/<session_key>/`, overridable. **Watch out:** `snapshot-manager.js` looks in `uv-out/checkpoints/<sid>` but the runner writes to `uv-out/checkpoints/<sid>` — confirm these agree (there is a latent mismatch risk between `uv-out/checkpoints/<sid>` and `uv-out/sessions/<sid>/checkpoints` referenced in different hooks; **pick one path and use it everywhere**).

### 5.3 Restore command

`snapshot-manager.js` builds `cd <cwd> && UVS_RESTORE_FROM=<sid> uvs claude <persona>` and runs it in a new terminal tab (iTerm/Terminal AppleScript on macOS; gnome-terminal/x-terminal-emulator on Linux; copy-paste fallback elsewhere).

**Abstraction — restore command template.** Make the relaunch command a configurable template per runtime, e.g.:
```
RUBBERDUCK_RESTORE_CMD="cd {cwd} && RUBBERDUCK_RESTORE_FROM={session_key} uvs claude {persona}"
```
The terminal-spawning machinery (AppleScript / Linux emulators / copy-paste fallback) is generic and excellent — keep it as-is. Only the command string is runtime-specific.

### 5.4 Self-probe string

`server.js` detects an already-running instance by GETting `/` and matching the literal `UV Suite Watchtower` in the HTML. Rename to a stable marker (e.g. an `X-Rubberduck` response header instead of HTML-string matching — more robust).

---

## 6. Naming / branding cleanup checklist

- `persona` field → decide: generic `label`/`tag`, or keep as an optional adapter-set field the core treats opaquely. (Recommendation: treat opaquely in core; it's just a string the dashboard shows.)
- Dashboard title, header, stat labels.
- `events.json` on-disk store filename is fine; consider `~/.rubberduck/events.json` instead of next to the server code (today it's written to `watchtower/events.json` inside the package dir — **move it out of the install tree** so reinstalls/npm don't clobber or ship it).
- All `UV Suite Watchtower` / `[auto-checkpoint]` log prefixes.

---

## 7. Proposed Rubberduck repo layout

```
rubberduck/
  bin/rubberduck.js          # CLI: `serve`, `emit`, `snapshot`, `open`
  src/
    server.js                # from watchtower/server.js (deUVSed)
    dashboard.html           # from watchtower/dashboard.html (rebranded)
    snapshots.js             # from snapshot-manager.js (restore templated)
    checkpoints/
      runner.js              # from auto-checkpoint-runner.js (adapters injected)
      prompt.md
    schema.md                # the §3.1 event contract — the public API
  adapters/
    claude-code/             # hook scripts → emit; transcript locator; restore template
    generic/                 # docs for `rubberduck emit`
    README.md                # how to write an adapter (the IngestAdapter contract)
  test/
  README.md
  package.json               # zero runtime deps, like today
```

Keep the **zero-dependency** property. The current server uses only Node built-ins (`http`, `fs`, `path`, `crypto`, `child_process`, `os`). That's a feature — preserve it.

---

## 8. Build order (suggested Acts)

1. **Act 1 — Lift the core, deUVS it.** Copy `server.js` + `dashboard.html`, rename env vars (with aliases), move `events.json` out of the install tree, replace the HTML self-probe with a header, define `schema.md`. Acceptance: `rubberduck serve` runs; `curl POST /events` shows up live on the dashboard; nothing references uv-suite.
2. **Act 2 — The `generic` ingest path.** Build `rubberduck emit`. Acceptance: a 10-line bash loop emitting fake events drives a believable dashboard with sessions, tool calls, errors, and a terminated badge — *with no Claude Code involved.* This proves agent-agnosticism.
3. **Act 3 — The `claude-code` adapter.** Port the hook→emit mapping. Acceptance: a real Claude Code session shows up identically to how Watchtower shows it today.
4. **Act 4 — Checkpoints behind adapters.** Lift the runner; inject `TranscriptLocator` + `Summarizer`; ship the Claude locator + CLI summarizer. Acceptance: semantic checkpoints for a Claude session; graceful mechanical-only fallback when no locator/summarizer is configured.
5. **Act 5 — Snapshots + restore.** Lift snapshot-manager; templatize the restore command. Acceptance: snapshot all, list, and restore-to-new-terminal work on macOS and Linux.
6. **Act 6 (later, on demand) — second runtime.** Only when a concrete non-Claude runtime needs it: a `transcript-tail` or native adapter for it. Don't build speculatively (this would be exactly the kind of unearned abstraction to avoid — wait for the second real consumer).

Then: **uv-suite migrates to depend on Rubberduck** as an external package, deleting its own `watchtower/` and pointing its hooks at the `claude-code` adapter. That migration is the proof the boundary is real.

---

## 9. Things to deliberately NOT do (scope discipline)

- **No auth / multi-user / hosted mode.** It's local-first, single-developer, localhost. Add network/auth only when someone actually runs it on a shared host. Document that as the trigger, don't build it.
- **No database.** The in-memory ring buffer (500 events) + JSON snapshot files are sufficient for the "watch my terminals" use case. Add persistence only when retention/history becomes a stated requirement.
- **No plugin framework for adapters.** Adapters are just "things that POST events" + (for checkpoints) two small injected functions. A directory of scripts and a documented contract is the whole framework. Resist building a registry/loader until there are enough adapters to justify it.
- **No speculative second-runtime adapter.** Build the Claude Code adapter (we have the source) and the generic `emit` CLI. The Codex/Cursor adapters get built when those users show up.
- **No WebSocket.** SSE already auto-reconnects and is simpler; the original chose it deliberately.

---

## 10. Known issues in the source to fix during extraction

These are real bugs/rough edges noticed while reading the source — clean them up rather than carrying them over:

1. **Checkpoint path mismatch.** The runner and snapshot-manager reference `uv-out/checkpoints/<sid>`, while some hooks reference `uv-out/sessions/<sid>/checkpoints`. Pick one canonical path.
2. **`events.json` written inside the package directory** (`watchtower/events.json`). Move to `~/.rubberduck/`.
3. **`auto-checkpoint.sh` (Tier-A) is not wired in `settings.json`** — it's dormant. Decide whether Tier-A mechanical checkpoints are part of Rubberduck or were superseded by Tier-B. (Recommendation: Tier-B/server-side only; drop Tier-A to avoid two checkpoint systems.)
4. **SessionStart is emitted twice** (once enriched by `session-start.sh`, once bare from settings). The new adapter should emit it once.
5. **Self-probe matches an HTML string** — brittle; use a response header.

---

## 11. One-paragraph brief for the building agent

> Build **Rubberduck**, a local-first, zero-dependency Node observability + control plane for AI coding agents, by extracting the existing `watchtower/` code from uv-suite. The server, SSE stream, dashboard, snapshots, and checkpoint engine are already agent-agnostic — keep them. Break the three couplings to Claude Code/uv-suite by introducing adapters: an **IngestAdapter** (ship a `claude-code` hook adapter + a generic `rubberduck emit` CLI; the core only ever sees `POST /events` in the documented schema), a **TranscriptLocator** (Claude Code first), and a **Summarizer** (configurable CLI command by default). Rename the `UVS_*` namespace to `RUBBERDUCK_*` (with one-release aliases), move state out of the install tree, templatize the restore command, and treat `persona` as an opaque label. Preserve zero-dependency and local-only scope: no auth, no DB, no plugin framework, no speculative second-runtime adapter. Prove agent-agnosticism in Act 2 by driving the full dashboard from a fake-event bash loop with no Claude Code involved. Finally, migrate uv-suite to consume Rubberduck as an external package.
