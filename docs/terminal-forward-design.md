# Terminal-forward design: own the PTY, render it in the browser

Decided with the user 2026-06-17. This is the design for making Rubberduck the
place you run and talk to your CLI agents — a real terminal per agent, rendered
in the dashboard, with the structured "smarts" (approvals, state, sub-agent
tree) alongside it.

This is a different take on agent orchestration than the existing tools, and may
ultimately live in its own repo. This doc captures the design so it travels.

## The decision, in one line

Run the user's `claude` CLI (their subscription) in a **PTY Rubberduck owns**,
render it **terminal-forward** (xterm.js, like Superset) in the dashboard, and
keep the **hook/event layer** as the structured intelligence beside the terminal
(like Conductor/CodeLayer). Terminal in front; structured data behind.

You are not choosing terminal *vs* structured — a running `claude` emits both at
once (its terminal output AND its hook events). We show the terminal and read
the events.

## Where this lands among the alternatives

- **Superset** — terminal-first (xterm + node-pty), structured panels around it.
  Closest to this design's *surface*.
- **CodeLayer / HumanLayer** — structured chat-first (Go daemon runs `claude`
  with `--output-format stream-json`), no real terminal. We are NOT this.
- **Conductor** — structured chat/diff by default, real terminal on demand.

All of them wrap the agent **CLI** (riding the user's Pro/Max subscription), not
the Claude API directly. So does Rubberduck today (`runtimes/claude_code.py`
launches `claude`). That stays.

## What already exists (verified in code)

The launched path is most of the way there:

- `core/orchestrator.py` `SessionSupervisor` already spawns the agent in a
  **PTY or tmux pane Rubberduck owns**, pumps its output, and can inject input
  (`write_input` → PTY write / tmux `send-keys`).
- The PTY pump (`_pump`, `orchestrator.py`) already reads **raw byte chunks**
  (`async for raw in reader`). The bytes arrive intact.
- Hooks already POST structured events to `POST /events`; the server derives
  state and resolves approvals from them. **Rubberduck already understands the
  data** for Claude Code — via hooks, not stream-json.
- `mac/Sources/Rubberduck/DashboardWindow.swift` already hosts the dashboard in
  a `WKWebView`. The "Mac app with a webview" already exists.

## The three changes that turn this into a real terminal

The current launched path is lossy in exactly three places. Fixing these is the
whole MVP.

### 1. Stream RAW bytes, not lines
Today `_pump` decodes each PTY chunk and `_record_output` treats it as a "line";
`/output` (SSE) wraps each in `{'line': ...}` JSON. xterm.js needs the raw byte
stream (ANSI, cursor moves, colors) untouched.

- Keep reading raw chunks; send them to the browser **as bytes** (binary WS
  frame), not JSON-wrapped lines.
- **Keep a decoded rolling buffer** (the existing `deque`) purely for
  `detect_state` / `tool_in`. Verified: those are substring checks and work fine
  off a buffered text copy, independent of what we send to the browser. So raw
  passthrough does NOT break state detection — the two consumers are separate.

### 2. WebSocket: binary + bidirectional + keepalive
`transport/websocket.py` today is **text-only, server→client only**, and
**discards every incoming client payload** (`read_frame_opcode` reads and throws
away the body). A terminal needs:

- **Binary frames** (opcode 0x2) for terminal bytes.
- **Client→server payloads**: keystrokes and resize, actually read (not
  discarded).
- **ping/pong** keepalive.

This is the one place the "zero runtime dependencies" principle stops paying for
itself. A terminal is a bidirectional binary protocol with masking,
fragmentation, and backpressure — exactly what a WS library does correctly and a
hand-roll gets subtly wrong. **First justified dependency.** (Candidates: a small
vetted WS lib; or `websockets`/`wsproto`. Decide at build time.)

### 3. xterm.js front-end (replaces `LiveOutput.tsx`)
`web/src/LiveOutput.tsx` is a line buffer with a text `<input>` — it can't render
a TUI. Replace with **xterm.js** + `fit` addon:

- Render raw bytes from the WS.
- Send keystrokes back over the WS (`onData`).
- On pane resize, send `{cols, rows}` → server → `TIOCSWINSZ` on the PTY (new
  small `/resize` path).

## The model: terminal + smarts side by side

```
┌──────────────────────────┐   ┌───────────────────────────┐
│  TERMINAL PANE (xterm.js) │   │  SMARTS PANEL (existing)  │
│  • raw bytes, full TUI    │   │  • Approvals (buttons)    │
│  • user types here        │   │  • State badges           │
│  • resize → cols/rows     │   │  • Sub-agent TREE (new)   │
└────────────▲──────────────┘   └─────────▲─────────────────┘
   raw bytes │ keystrokes/resize           │ structured events
   (WS binary, bidirectional)              │ (hooks → /events)
             └──────────────┬──────────────┘
                            ▼
                     ┌───────────────┐
                     │  claude CLI   │  user's subscription
                     │  in a PTY     │  ── also fires hooks ──> /events
                     └───────────────┘
```

The terminal is the interaction surface. The hook/event layer powers the things
a raw terminal can't show on its own: approvals as real buttons, state, and the
sub-agent lineage tree. Same `claude` process feeds both.

## Stack decisions

- **Frontend: TypeScript/React — keep.** xterm.js is TS; the whole web-terminal
  ecosystem (VS Code, Superset) is TS. Already here.
- **Backend: Python/asyncio — keep.** The job is spawn-PTY, shuttle bytes, fan
  out events, talk to SQLite/git. Python's `asyncio` + `pty` handle this at the
  real scale (a handful of local agents, one machine). Rewriting buys nothing a
  user would feel. (Challenge test: what breaks if we don't rewrite? Nothing.)
- **Rust/Go: no — with one documented future trigger.** A small Go/Rust
  **PTY-relay sidecar** (spawn PTY, pump bytes to WS) is the *only* place that
  could earn its keep — and **only if** profiling shows the byte-pump is the
  bottleneck under realistic load (≈20+ busy terminals). Until measured, it is
  speculative complexity. Note: HumanLayer's `hld` is Go because it's a
  background daemon coordinating cloud + multiple clients over REST — a different
  problem at a different scale than our local single-user process. Don't
  cargo-cult it.
- **Mac shell: Swift — already chosen** (`mac/`). Keep for native powers
  (notifications, autostart, jump-to-window).

## Sequencing

1. Build/verify the terminal in a **plain browser** first — Chrome devtools make
   debugging the raw-byte stream, ANSI rendering, and resize far easier than
   inside WKWebView.
2. Then point the existing `DashboardWindow` `WKWebView` at the same dashboard —
   nearly free; it's the same URL. Watch WKWebView quirks: binary WS frames,
   clipboard/paste into xterm, keyboard focus.
3. Sub-agent tree + cross-agent `AGENTS.md` come after the terminal works.

## Explicitly out of scope for this change

- The unified-`Harness`-protocol refactor (`architecture.md` migration path) —
  orthogonal; don't couple two risky changes. Ship the terminal first.
- `--output-format stream-json` — not needed for terminal-forward. Revisit only
  if we later want CodeLayer-grade structured rendering (full diffs in a review
  panel) as a *second* surface.
- Watched mode — frozen, legacy, on the deprecation path. Not extended.

## The differentiators this design enables (the actual point)

Terminal-forward is the table-stakes surface. The uniqueness lives in the smarts
panel and below:

- **Sub-agent lineage tree** — capture Claude's `SubagentStart`/`SubagentStop`
  hooks into the existing `/events` pipeline, tagged with a parent, and render
  nested under the parent in the existing tree UI. Underserved by every
  competitor. Net-new (no `subagent` handling exists today).
- **Cross-agent `AGENTS.md`** — one instructions file injected across launched
  sessions regardless of agent, plus Rubberduck proposing edits over time from
  observed corrections. Net-new.
- **Watch mode** — observing agents you started yourself. Unique today, but being
  deprecated for the confusion it creates; keep only as long as it pays.
