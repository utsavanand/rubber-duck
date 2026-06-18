# Extraction checklist: forking the terminal-forward take into a new repo

Drafted 2026-06-17. Companion to
[terminal-forward-design.md](./terminal-forward-design.md).

**When to fork:** at the START of the terminal build (the first binary-WS +
xterm.js commit) — not before. Until then the new take is "Rubberduck + a design
doc," and forking just drags the legacy along. The terminal implementation is
the first code that is genuinely the new product.

**What the new repo is:** a local single-user app that runs your CLI agents in a
PTY it owns, renders them terminal-forward (xterm.js), and layers structured
smarts (approvals, state, sub-agent tree) from the hook/event stream beside the
terminal. No watched mode, no AppleScript terminal tabs.

---

## MOVE — the core that carries over (verified leaf-clean unless noted)

Python core:

- `core/eventbus.py` (87) — event fan-out. Pure core. Move as-is.
- `core/orchestrator.py` (409) — PTY/tmux supervisor, the heart. Move; this is
  where the raw-byte streaming change lands.
- `core/approvals.py` (179) — approval registry. Move as-is.
- `runtimes/base.py` `runtimes/claude_code.py` `runtimes/generic.py` — the agent
  adapters. Move claude + generic; codex/copilot optional (see DECIDE).
- `harnesses.py` (42) — runtime registry. Move; trim to shipped adapters.
- `git/worktrees.py` `git/gitdetect.py` `git/spotlight.py` — worktree isolation,
  a kept differentiator. Move as-is.
- `persistence/history.py` (648) — SQLite session/event store. Move; it carries
  schema for forks + lineage (needed for the sub-agent tree).
- `persistence/checkpoints.py` (261) — move if keeping checkpoints (it's a real
  feature); otherwise DEFER.
- `transport/httpio.py` (132) — HTTP/SSE primitives. Move as-is.
- `transport/websocket.py` (78) — **DO NOT move as-is.** Replace with a vetted WS
  library in the new repo (binary + bidirectional + keepalive). Keep this file
  only as a reference for the handshake until the lib is wired.
- `helpers/paths.py` `helpers/security.py` `helpers/metrics.py` — small support.
  Move what the moved modules import; drop the rest.
- `llm/summarizer.py` `llm/insights.py` — outcome summaries. Move if keeping
  history summaries; otherwise DEFER.

Web (TypeScript/React):

- `web/src/api.ts` `useEventStream.ts` `sessions.ts` `types.ts` `ui.tsx`
  `useTheme.ts` `main.tsx` — the app spine. Move.
- `web/src/AgentTree.tsx` (621) `ForkTree.tsx` — the lineage tree UI; the
  sub-agent tree extends this. Move.
- `web/src/Approvals.tsx` `SessionDetail.tsx` `App.tsx` — move; rework
  SessionDetail to host the xterm pane.
- `web/src/LaunchModal.tsx` `ForkModal.tsx` `CompareModal.tsx`
  `NewFolderModal.tsx` `SnapshotsModal.tsx` — move the ones whose features
  survive (launch, fork). Snapshots → DECIDE.
- `web/src/LiveOutput.tsx` — **DO NOT move.** Replaced by the xterm.js terminal
  component. Reference only.
- `web/src/Pulse.tsx` (217) — DECIDE (user called it low-utility).

Infra:

- `.claude/rules/*.md` (the slop guardrails) — move; they're good.
- `scripts/check.sh` `scripts/slop_check.py` `scripts/pre-commit` — move; the
  quality gate is worth keeping.
- `pyproject.toml` `web/package.json` — adapt (new name, add WS lib + xterm.js,
  drop unused deps).
- `.github/workflows/ci.yml` — adapt.

---

## DROP — legacy the new take does not carry

- `agents/terminal.py` (334) — the AppleScript open/close/focus/answer-by-tty
  path. The whole macOS-fragility reason for the pivot. Verified leaf: imported
  ONLY by `server.py` and `cli.py`. Delete, and delete its call sites.
- **Watched mode** — the hooks-only-observe path. The new take is launched-only.
  Drop: `agents/hooks_install.py` (188), `hooks/rubberduck-hook.sh`, the
  `install-hooks`/`uninstall-hooks` CLI commands, `doctor.py` (138, it mostly
  checks hook wiring), and the `/events` ingest-from-external-hook path.
  - NOTE: keep the *event vocabulary* and the in-process event emission
    (orchestrator `_emit`). We drop external-hook *ingestion*, not events.
  - NOTE: Claude's `SubagentStart/Stop` for the sub-agent tree still arrive — but
    as a launched session we read them from the agent's own output/transcript,
    not from an installed external hook. Confirm the source during the build.
- `mac/` Swift shell — DECIDE, don't auto-move (see below).
- Heartbeat/tty plumbing in `server.py` — the `with_heartbeat`, tty-tracking, and
  `close/focus_terminal_by_tty` handlers exist only to manage AppleScript tabs.
  Drop with watched/terminal.
- `scripts/seed_demo.py` — demo seeding; regenerate fresh if needed.

---

## REWRITE — don't copy, rebuild clean

- `server.py` (1628) — **the biggest trap. Do NOT copy wholesale.** ~87 lines are
  coupled to terminal/watched/snapshot/tty; the routing table mixes core and
  legacy. Stand up a fresh, smaller server in the new repo and port handlers
  selectively: keep events, sessions, launch, fork, approvals decide, diff,
  worktree; add the binary-WS terminal attach + `/resize`; leave behind every
  `*_terminal_by_tty`, snapshot-restore-in-terminal, and install-hooks route.
  Target: a server you can read top-to-bottom, not 1628 lines.
- `cli.py` (452) — rebuild around the surviving commands (`serve`, `launch`,
  `run`, `dashboard`) minus `install-hooks`/`uninstall-hooks`/`doctor`/`snapshot`
  if those features don't carry.

---

## DECIDE — call these explicitly before the fork

- **codex / copilot adapters** — keep multi-agent agnostic (a stated edge), or
  start claude-only and re-add once the terminal works? Recommend: keep `generic`
  + `claude-code` for MVP; re-add codex/copilot right after (they're ~100 lines
  each and prove "any CLI agent").
- **tmux vs pure-PTY** — orchestrator supports both. tmux survives server
  restarts and is the better default for persistent sessions (Superset/CodeLayer
  both persist). Recommend keep tmux path.
- **Mac shell (`mac/`)** — the `WKWebView` host is real and cheap to keep, but if
  the new take rethinks packaging (e.g. a Tauri shell to bundle the WS/PTY side
  natively), don't carry the Swift. Recommend: keep the existing Swift webview
  for MVP (it works), revisit packaging later.
- **Snapshots, Pulse, checkpoints, LLM summaries** — each is a real feature with
  real code. Keep the ones that serve the new pitch; defer the rest. Pulse:
  user-flagged low-utility → defer. Checkpoints/history: keep (feeds learning).
- **New name** — working title stays Rubberduck; pick at fork time. (Earlier
  shortlist: Concerto, Tutti, Prospero, Calliope — unresolved, not blocking.)

---

## Suggested fork mechanics

1. Fresh repo, not a GitHub fork (clean history, no legacy baggage in the tree).
2. Copy the MOVE list into the new structure; do NOT copy DROP/REWRITE files.
3. First commit: the moved core + a stub server that only does
   events/sessions/launch. Green CI (port `check.sh`).
4. Second commit: the terminal — WS library, raw-byte streaming in the
   orchestrator, `/resize`, xterm.js component. This is the real product start.
5. Carry over `.claude/rules` + the pre-commit gate from commit 1 so quality
   holds from the start.
