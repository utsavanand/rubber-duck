# Rubberduck roadmap

Organized by type of work. `★` marks the current highest-leverage item.

## 🚀 Release & ops

- ★ **Publish to PyPI (0.3.0).** `main` is far ahead of the published 0.2.0;
  nothing in "Shipped (unreleased)" reaches users until this ships. The security
  gate makes it a breaking change — old hook scripts get 401'd until
  `install-hooks` is re-run, so the changelog must say so.
  - [ ] Bump 0.2.0 → 0.3.0 (pyproject.toml + `__init__.py`).
  - [ ] `scripts/build_package.sh` (rebuild dashboard, bundle, build wheel).
  - [ ] `twine upload` (PyPI token in ~/.pypirc).
  - [ ] Changelog: re-run `install-hooks` after upgrade (token gate).

## 🐛 Code fixes

- [ ] **Worktree-test flakiness under concurrent git** — the git tests shell out
  to real git; they collided with git activity once during a hook run. The
  GIT_* env leak is fixed; watch for residual lock races.
- [x] **`serve --reload`** — dev flag that watches `src/rubberduck` and re-execs
  the process on a Python change (stdlib mtime poll, no new deps). Dashboard
  changes are served from `dist/` so they just need a rebuild + refresh.

## ✨ Features

- [ ] **Fork / continue with a different agent.** Switch agents mid-task (Claude
  low on tokens → continue in Codex). Design: `docs/fork-with-agent-design.md`.
  - [ ] Worktree fork: agent picker — new agent gets the code.
  - [ ] Conversation fork: generalize beyond Claude (each runtime declares its
    resume command; all three support native resume).
  - [ ] Cross-agent handoff: worktree + new agent seeded with a handoff summary
    from the checkpoint, distilling the agent's *actual responses* (now captured).
- [ ] **Discoverability**: `serve` startup hint when no agent hooks are installed.
- [ ] **Per-session token count + compaction warning.** Show tokens used per
  session and warn as it approaches the model's context limit (so you can fork
  to a fresh agent before it auto-compacts). Each harness exposes usage
  differently — Claude's hook payload / transcript carries usage, Codex and
  Copilot have their own — so this lands behind the unified Harness contract:
  add a `token_usage()` (or a usage field on the transcript read) per runtime,
  surface a `(used / limit)` bar + amber/red warning in the agent row.
- [ ] **Fleet / multi-session "working together" view.** A visual where all your
  active sessions are shown side by side as a live fleet — a fun, at-a-glance way
  to watch several agents make progress at once (vs the current flat list).
  Likely a grid/canvas of session cards animating on each event.
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

- [ ] **Frontend unit tests (vitest).** There is no JS test runner today, so the
  event-stream reducer, `applyEvent`, `viewFromPersisted`, and the client
  tombstone logic can only be tested through Playwright (slow, indirect). Add
  vitest + tests for the pure frontend logic — this is what would let us prove a
  fix *fails without the fix* (the ghost-session fix could only be validated by
  reading the reducer because there's no unit harness).
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
- Watched vs launched sessions, with a robust sticky `launched` flag + badge;
  deleted sessions can't be resurrected by their own streaming events.
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
