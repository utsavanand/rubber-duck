# Rubberduck roadmap

Organized by type of work. `★` marks the current highest-leverage item.

## 🚀 Release & ops

- [x] **Publish to PyPI (0.3.1).** Shipped 0.3.1 with all of `main`'s work +
  latest dashboard. (0.3.0 was uploaded mid-session before the day's fixes, so it
  was stale and couldn't be overwritten — bumped to 0.3.1.) The security gate
  makes upgrading a breaking change — old hook scripts get 401'd until
  `install-hooks` is re-run.

## 🐛 Code fixes

- [ ] **Output tab / "drive from dashboard" only works for PTY-owned sessions.**
  The Output tab appears only when `worktreePath` is set, and `/output` streams
  nothing for terminal-launched sessions (the common case — Rubberduck opens a
  real terminal it doesn't own a PTY for). So typing to the agent from the
  dashboard is effectively unavailable for most sessions. Tied to the
  "In-dashboard agent supervision (own the PTY)" feature below.
- [ ] **Diff tab is partial.** Shows only uncommitted working-tree changes; a
  full diff vs the base branch (including commits) is labeled "coming soon" in
  the UI (`SessionDetail` DiffView).
- [x] **Snapshot restore fixes (PR #11)** — Copilot fell through to a no-op;
  `--resume` used the rd key not the harness conversation id; the restore list
  showed the live dashboard's sessions not the snapshot's; the restored agent
  never registered (no env/heartbeat/SessionStart) so it didn't appear.
- [ ] **Site: removed the Compare button from the dashboard mockup** (`Live.tsx`)
  — keep an eye that the site mockup stays in sync with the real toolbar.
- [ ] **Worktree-test flakiness under concurrent git** — the git tests shell out
  to real git; they collided with git activity once during a hook run. The
  GIT_* env leak is fixed; watch for residual lock races.
- [x] **`serve --reload`** — dev flag that watches `src/rubberduck` and re-execs
  the process on a Python change (stdlib mtime poll, no new deps). Dashboard
  changes are served from `dist/` so they just need a rebuild + refresh.

## 🩺 Onboarding & diagnostics

- [x] **`rubberduck doctor` — one command that verifies the whole setup.** Checks
  `jq`/`curl`, the server on :4200 (self-probe header), the auth token, and each
  agent's installed hook (present, points at the current script, and — for codex —
  not `async:true`). Prints the exact fix per problem; exits non-zero on any FAIL.
  `install-hooks` now ends with "Verify it's wired up: rubberduck doctor".
  - Not done: **Codex *trust* status.** Codex stores trust in `~/.codex/config.toml`
    `[hooks.state]` as a per-entry `trusted_hash` of a normalized form we can't
    reliably recompute — so doctor can't prove trusted vs not. It reports the hook
    is installed/current and points at `/hooks`, rather than claiming a trust state.
- [ ] **Runtime nudge for a stale/untrusted Codex hook.** Even with `doctor`,
  someone updates the hook and forgets to re-trust. Detect at runtime (a Codex
  session started but its hook never reported / hash mismatch) and show a
  dashboard banner: "Codex hook needs re-trusting — sessions won't appear until
  you do." Turns a silent miss into a visible prompt.
- [ ] **`curl | bash` one-liner installer.** Detect OS + package manager
  (brew/apt/dnf), install `jq` + `pipx` + `rubberduckhq`, print next steps.
  Should NOT auto-run `install-hooks`/`serve` (hooks touch agent config; Codex
  needs interactive trust) — it tells the user, and ends by running `doctor`.
  Needs a stable hosted URL + a readable "download then run" alternative.

## ✨ Features

- [ ] **Approve / Deny from the dashboard (blocking, cross-harness).** Today the
  permission hook is fire-and-forget and "Approve" injects keystrokes into the
  terminal (fragile; misses many prompts). Make the pre-exec hook block and let
  Rubberduck return the decision, so the dashboard is the real approval
  authority. Per-harness: Claude Code + Copilot can route approval externally;
  Codex is interactive-only (observe + jump-to-terminal). Behind the unified
  Harness interface (`ApprovalSpec`). Design: `docs/approval-routing-design.md`.
  - [x] Server: decision store + `GET /approvals/:id/decision` (hook long-polls)
    + `/approvals/:id/decide` repointed at it.
  - [ ] `ApprovalSpec` on `Harness`; Claude + Copilot declare it, Codex = None.
  - [x] Hook script: blocks, long-polls, emits per-runtime decision JSON, fail-open;
    PermissionRequest installed async:false. Claude + Copilot route externally.
  - [ ] Optional: lift the per-runtime decision shape into an `ApprovalSpec` on
    Harness (currently branched in the hook script).
- [ ] **Session lifecycle: stop / resume / archive / delete.** Stop is a dead
  end today (kills the agent, row drops from Active, no way back). Make Stop
  *pause* a resumable session, add Archive as the declutter middle-ground, and
  keep Delete as the only destructive one. Design + state machine:
  `docs/session-lifecycle-design.md`.
  - [x] **Phase 1 — Resume**: `stopped` state; Stop keeps the row visible
    (greyed) with a Resume button; `POST /sessions/:key/resume` relaunches in the
    saved worktree, `claude --resume <session_id>` for claude-code. Delete
    double-confirms.
  - [x] **Phase 2 — Archive**: `archived` state + Archived filter +
    archive/unarchive (Unarchive returns it as stopped/resumable).
  - [x] **Phase 3 — Watched lifecycle**: hook sends agent_pid; liveness sweep
    archives a watched session when its agent process is gone, and auto-archives
    launched tabs that stop pinging.
- [ ] **Fork / continue with a different agent.** Switch agents mid-task (Claude
  low on tokens → continue in Codex). Design: `docs/fork-with-agent-design.md`.
  - [ ] Worktree fork: agent picker — new agent gets the code.
  - [ ] Conversation fork: generalize beyond Claude (each runtime declares its
    resume command; all three support native resume).
  - [ ] Cross-agent handoff: worktree + new agent seeded with a handoff summary
    from the checkpoint, distilling the agent's *actual responses* (now captured).
- [ ] **`rubberduck launch` parity with the dashboard.** The CLI `launch` already
  creates a real launched session (`launched=1`, opens a terminal tab in `--cwd`),
  but exposes only `command`/`--cwd`/`--session-key`/`--prompt`. The
  `/sessions/launch` endpoint supports more that the CLI doesn't surface:
  - [ ] `--no-terminal` → `in_terminal: false` (headless/supervised, for CI).
  - [ ] `--repo` / `--branch` / `--base` → auto-create a worktree+branch.
  - [ ] `--terminal` (iterm/terminal) and `--name` / `--notes`.
- [ ] **Discoverability**: `serve` startup hint when no agent hooks are installed.
- [ ] **Per-session token count + compaction warning.** Show context-window
  occupancy per session and warn as it nears the limit (so you can fork to a
  fresh agent before it auto-compacts). No hook event carries usage — it's read
  from the transcript each harness already locates, behind a new
  `context_tokens() -> int | None` on the Harness contract. Surface a
  `(used / limit)` bar + amber ≥80% / red ≥90% in the agent row. Limits are
  hard-coded constants (e.g. Claude 200K). Poll-based, not live: the number lags
  until the transcript is re-read (lazily on render, or on PostToolUse/Stop).
  Confirmed per-harness (2026-06):
  - [ ] **Claude** ✅ — transcript JSONL, last `message.usage`; cumulative
    occupancy = `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`.
  - [ ] **Codex** ✅ — transcript JSONL, last `event_msg` of type `token_count`,
    `info.total_token_usage.total_tokens` (a running total, used directly).
  - [ ] **Copilot** ⚠️ — `~/.copilot/session-state/<id>/events.jsonl`. The full
    `tokenDetails` (input/cache_read/cache_write/output) appears only in the
    `session.shutdown` record — too late to warn. Mid-session, `assistant.message`
    carries only per-turn `outputTokens`, not cumulative context size. So a live
    Copilot bar would be a rough sum-of-output estimate, not real occupancy:
    return None (no bar) until Copilot emits cumulative usage per turn.
- [ ] **Fleet / multi-session "working together" view.** A visual where all your
  active sessions are shown side by side as a live fleet — a fun, at-a-glance way
  to watch several agents make progress at once (vs the current flat list).
  Likely a grid/canvas of session cards animating on each event.
- [ ] **Working-style insights (`rubberduck insights`).** A stub exists
  (`src/rubberduck/llm/insights.py`) with the design but no implementation:
  analyze a user's own history to surface what workflows lead to good outcomes
  and where rework happens, as a `rubberduck insights` report. Open design
  questions in the stub: heuristics vs LLM pass, scope (per-repo/day/all-time),
  storage. Deliberately not wired into server/CLI until designed.
- [ ] **Native Mac app.** A real menubar/desktop app instead of a browser tab:
  launch `serve` on login, show fleet status in the menubar, native
  notifications when a session needs you, and one-click open of the dashboard.
  A Swift package is scaffolded under `mac/` (SwiftUI wrapping the local
  server + dashboard). Decide: ship the dashboard in a WKWebView shell first,
  or build native panels against the existing HTTP/SSE API.
- [ ] **In-dashboard agent supervision (own the PTY).** Today a "launched"
  session is opened in a real terminal tab (`open_in_terminal`) and the agent
  runs there — Rubberduck observes via hooks but doesn't own the process. The
  in-process PTY path (`orchestrator.launch` + `_supervisors`) exists but isn't
  the default and isn't fully wired through the UI. Build it out so Rubberduck
  can run the agent itself and the dashboard becomes the primary surface:
  - [ ] **Live output tab** — stream the agent's stdout/stderr from the PTY
    (the `output` tab only works for PTY-owned sessions; terminal-launched ones
    have nothing to stream).
  - [ ] **Drive the agent from the dashboard** — type input / answer prompts
    in-panel without switching to the terminal.
  - [ ] Make PTY-owned launch a first-class option in New session (vs. "open in
    my terminal").
  This is the Conductor / Superset-style experience — running and watching
  agents entirely inside the app. Until it lands, the `output` tab and
  in-dashboard control are correctly unavailable for terminal-launched
  sessions; see the jump-to-terminal action below as the interim path.

## 🏗️ Architecture

- [ ] **Windows support (deferred).** Native needs ConPTY (pywinpty), Windows
  Terminal launching, and a tmux replacement for persistence — a real project,
  not a patch. Recommended path is **WSL2** (everything works as-is under Linux).
- [x] Unified Harness adapter (one contract per agent) + central registry.
- [x] Role-based package layout.

## ✅ Testing

- [x] **Frontend unit tests (vitest).** Added Vitest (reads vite.config), gating
  in CI (`npm test`) and the local gate. 24 co-located `*.test.ts` cover the pure
  logic: `applyEvent`/`effectiveState` (`sessions.test.ts`), `viewFromPersisted`/
  `repoNameFrom`/`sessionKeyOf` (`types.test.ts`), and the event-stream `reduce`
  (seed/event/remove-tombstone/optimistic-patch). The `reduce` fn was exported
  for testing. Component-render tests stay deferred to Playwright e2e.
- [ ] **More UI specs** for UI-only flows not yet covered: HITL approve/deny,
  pulse click-to-expand, collapse forks, drawer tabs (timeline/diff/notes).
- [ ] Extend the **pytest runtime suite** for any API behavior still only
  covered manually. See `docs/automating-tests-research.md`,
  `docs/manual-test-cases.md`, `docs/test-coverage.md`.
- [x] 3-layer pre-commit gate (`scripts/check.sh`) + coverage doc.
- [x] Playwright E2E: new-session, delete, stop, checkpoint, fork, snapshot,
  deleted-stays-gone.

## Shipped (unreleased — on main, not yet on PyPI)
- Three-panel dashboard (Agents / HITL "Needs human" / Pulse).
- Security: localhost token + same-origin gate (CSRF/injection hardening).
- Multi-agent hooks: `install-hooks --agent {claude-code,codex,copilot}`, with
  the Codex `/hooks` trust step surfaced.
- Watched vs launched sessions, with a sticky `launched` flag + badge (set once
  at creation, never flipped by later events); deleted sessions can't be
  resurrected by their own streaming events.
- Git is opt-in: run-in-place vs worktree, base-branch picker, promote later.
- Fork merged into one action (worktree / promote / conversation).
- New-session agent picker; pulse shows the command + click-to-expand.
- High-quality checkpoints: human prompts + commands + files + the agent's own
  responses (per-harness transcript: Claude/Codex JSONL, Copilot SQLite);
  summaries by default via an auto-detected CLI agent.
- Unified Harness adapter + registry; role-based package + test layout.
- README overhaul; error-handling fixes (fail-closed delete guard).
- Three dashboard bugs fixed (dashboard_dir path, origin allowlist port, delete
  auth token) — all caught by the new E2E tests.
- Checkpoint no longer spawns a phantom session: the summarizer's `claude -p`
  subprocess sets `RUBBERDUCK_INTERNAL=1`, and the hook script no-ops when it
  sees that, so internal agent calls don't report themselves back.

## Shipped (released)
- 0.2.0 and earlier: core orchestrator, watched/launched sessions, worktrees,
  fork tree, checkpoints, snapshots, the original dashboard.
