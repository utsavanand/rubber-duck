# Rubberduck — Orchestrator Design

**Status:** Built — Acts 0–11 complete and on `main`. Act 11 adds checkpoints/rollback, spotlight (sync worktree → main), and multi-model compare.
**Supersedes the scope of:** `rubberduck-extraction.md` (that doc described a passive observer; this describes the active orchestrator it grew into)
**Stack:** Python (server) + React (dashboard) + SQLite (history)

---

## 1. What we're building

Rubberduck is a **local-first orchestrator for AI coding agents**. It launches agents (Claude Code, Codex, or any CLI agent), supervises them, isolates each in its own git worktree, lets you fork a running session into a tree of parallel attempts, and keeps a durable history of every session with a captured **intention → what happened → outcome** summary.

The pitch:

> *"You're running five agents on one repo. Rubberduck launches them into isolated worktrees, shows you which one needs you right now, lets you fork any of them, and remembers what every session was trying to do and how it ended."*

It is **agent-agnostic by default**. It must work with no uv-suite, no Claude Code — a plain machine with Python and a CLI agent. Where a feature is materially better with Claude Code specifically (rich hook events, JSONL transcript summaries), we special-case it **consciously and document it as such**; the generic path always still works.

### What this is NOT (scope discipline)

- **No auth, no multi-user, no hosted mode.** Single developer, localhost. Trigger to revisit: someone runs it on a shared host.
- **No message queue, no microservices, no plugin registry.** One Python process + SQLite. The orchestration complexity (PTY supervision, worktrees, history) is *earned*; distributed-systems machinery is not.
- **No speculative runtime adapters.** Build Claude Code (richest, we have the reference) + a generic CLI path. Codex and others earn dedicated adapters when a real user needs them.

---

## 2. How this relates to the original extraction brief

`rubberduck-extraction.md` proposed lifting uv-suite's `watchtower/` into a passive, agent-agnostic observer: `POST /events` → ring buffer → SSE → dashboard, plus snapshots and checkpoints. That core is **not discarded** — it becomes the *live-status layer inside* the orchestrator (Act 1). The observer is a strict subset of the operator.

Three changes from the brief:

1. **Stack is Python + React**, not zero-dep Node. We lose the "zero dependency" and "single-file no-build dashboard" bragging rights; we gain PTY/subprocess control, stdlib SQLite, and a real tree UI. The dependency set stays thin and the scope discipline above stays in force.
2. **Active, not passive.** Rubberduck spawns and owns agents (PTY, server-owned lifecycle), rather than only receiving events from agents you started elsewhere.
3. **Durable history.** SQLite replaces the in-memory-only ring buffer for anything that must survive a restart (sessions, forks, metrics, summaries). The ring buffer survives as the *live* event tier feeding SSE.

---

## 3. Competitive landscape (researched 2026-06-06)

| Tool | What it is | What we borrow | What we skip |
|---|---|---|---|
| [Superset](https://github.com/superset-sh/superset) (`superset.sh`, ~9.2k★, ELv2, PH #1 Feb 2026) | Desktop workspace, 10+ agents in worktrees, in-app diff/review, browser preview | Worktree-per-session; persistent terminals; task list; multi-runtime | Electron IDE — heavy. We stay headless server + web dashboard. |
| [Conductor](https://conductor.build) (Melty Labs, YC, Mac app) | Parallel Claude/Codex in worktrees | Checkpoints w/ rollback; "Spotlight" (sync worktree→main to test); multi-model compare (same prompt, 2 agents) | Mac-only, closed. Those features become an optional later Act. |
| [ccmanager](https://github.com/kbwo/ccmanager) (OSS, TUI, 8 runtimes) | Session manager across worktrees | **Real per-runtime state detection** (idle/busy/**waiting-on-human**); worktree create/merge/delete; copying agent conversation context between worktrees | TUI-only; no durable history or summaries. |
| [Claude Squad](https://github.com/smtg-ai/claude-squad), [crystal](https://github.com/stravu/crystal), [emdash](https://github.com/generalaction/emdash) (YC W26) | OSS parallel-agent managers | Confirm worktree+manager pattern is the norm | — |

**Our wedge — the gap the field leaves open:** everyone shows *live* parallel agents well; almost nobody keeps **durable session history with intention→outcome summaries**, and nobody surfaces the **fork tree** (which session descended from which) as a first-class artifact. Rubberduck leans into history + lineage rather than being the Nth worktree launcher.

Sources:
- Conductor: https://conductor.build , https://madewithlove.com/blog/conductor-running-multiple-ai-coding-agents-in-parallel/
- Superset: https://github.com/superset-sh/superset , https://superset.sh/
- ccmanager: https://github.com/kbwo/ccmanager
- Landscape: https://github.com/andyrewlee/awesome-agent-orchestrators

---

## 4. Architecture

```
┌────────────────────────────────────────────────────────────────┐
│  React dashboard (web/)  — SSE client                            │
│   • live session grid (idle / busy / WAITING-ON-YOU)             │
│   • fork tree view   • session history + summaries   • metrics   │
│   • actions: launch · fork · stop · open-terminal · merge        │
└───────────────────────────────┬────────────────────────────────┘
                                 │ HTTP + SSE
┌────────────────────────────────────────────────────────────────┐
│  Rubberduck server  (Python, asyncio)                            │
│                                                                  │
│   Orchestrator                                                   │
│     └── SessionSupervisor (one per running agent)                │
│           ├── spawns agent CLI in a PTY                           │
│           ├── detects state (idle / busy / waiting-on-human)     │
│           └── emits events → EventBus                             │
│                                                                  │
│   WorktreeManager   git worktree add/list/remove; fork lineage   │
│   EventBus          in-mem ring (live) ──► SSE  +  ──► HistoryStore│
│   HistoryStore      SQLite: sessions, events, forks, metrics, …  │
│   Summarizer        (injected) intention→outcome capture         │
│                                                                  │
│   AgentRuntime adapter:  launch_cmd · state_detector · transcript│
│     ├── claude-code   (richest: hook events + JSONL transcript)  │
│     ├── codex         (later)                                    │
│     └── generic       (any CLI; coarse state from PTY output)    │
└────────────────────────────────────────────────────────────────┘
  storage:  ~/.rubberduck/{ db.sqlite, worktrees/, snapshots/ }
```

### 4.1 Agnostic-by-default vs. consciously Claude-specific

| Capability | Generic (any CLI agent) | Claude-specific enhancement (justified) |
|---|---|---|
| Launch / stop / supervise | PTY child process, server-owned | same |
| State detection | Coarse: parse PTY output for prompt/idle markers | Fine-grained via Claude Code **hooks** (`PreToolUse`/`PostToolUse`/`Notification`/`Stop` → `POST /events`) |
| Build/compile counts | Best-effort regex on PTY output (flagged approximate) | Exact, from `PostToolUse` tool/command in hook payload |
| Summaries | Summarize the captured PTY log | Summarize the Claude **JSONL transcript** (higher fidelity) |
| Worktrees, forking, history, metrics storage | identical for all runtimes | identical |

Every Claude-specific branch is isolated in the `claude-code` adapter. The core never imports it; it loads whichever `AgentRuntime` the session declares.

### 4.2 The `AgentRuntime` adapter contract

```
class AgentRuntime(Protocol):
    name: str
    def launch_command(self, *, cwd, session_key, initial_prompt) -> list[str]: ...
    def detect_state(self, recent_output: str) -> Literal["idle","busy","waiting"]: ...
    def locate_transcript(self, *, cwd, session_id) -> Path | None: ...     # None ⇒ summarize PTY log
    def restore_command(self, *, cwd, session_key) -> list[str]: ...
```

Three are planned: `generic` (always works), `claude-code` (richest), `codex` (later). No registry/loader framework — a dict of `{name: instance}` is the whole mechanism until there are enough to justify more.

---

## 5. Data model (SQLite — `~/.rubberduck/db.sqlite`)

```
sessions(
  session_key TEXT PRIMARY KEY,        -- stable Rubberduck id
  runtime TEXT,                        -- 'claude-code' | 'codex' | 'generic'
  repo_path TEXT,                      -- original repo
  worktree_path TEXT,                  -- isolated checkout for this session
  branch TEXT,
  parent_session_key TEXT,             -- NULL for roots → builds the fork tree
  intention TEXT,                      -- captured at launch
  outcome_summary TEXT,                -- written at end by Summarizer
  state TEXT,                          -- idle | busy | waiting | terminated
  started_at INTEGER, ended_at INTEGER -- epoch ms
)

events(_id, session_key, event_type, ts, payload_json)   -- durable copy of the live stream
metrics(session_key, kind, count)      -- kind: 'build' | 'test' | 'tool' | …
snapshots(id, created_at, manifest_json)
```

The live SSE tier is still an in-memory ring (last N events) for low latency; `events` is the durable mirror. `parent_session_key` is what makes the fork tree a first-class query, not a UI guess.

---

## 6. Feature → mechanism map

1. **Multiple features on one repo** → `WorktreeManager` runs `git worktree add ~/.rubberduck/worktrees/<repo>/<branch>` per session. One repo, N isolated checkouts.
2. **Fork a running session from the UI** → "Fork" creates a *child*: new branch off the parent's branch, new worktree, optionally copy the parent agent's conversation context (ccmanager-style); records `parent_session_key`.
3. **Fork tree** → recursive query on `parent_session_key`; React renders the lineage. (Our differentiator.)
4. **Session uptime** → `started_at` stamped at launch; live ticker on dashboard; frozen at `ended_at`.
5. **Compile / build counts** → increment `metrics` on build/test tool events (exact for Claude via hooks; approximate regex for generic, labeled as such). Build/test command patterns are per-project config.
6. **History of all sessions** → `sessions` table is durable; survives restarts; full start→end list.
7. **Intention → outcome summary** → capture `intention` at launch (the launch form field / first prompt); at end, `Summarizer` produces `outcome_summary` from transcript (Claude) or PTY log (generic). Degrades to a mechanical event-count summary when no summarizer is configured.

---

## 7. Repo layout

```
rubberduck/
  pyproject.toml               # ruff, black, mypy, pytest config; thin deps
  src/rubberduck/
    __init__.py
    server.py                  # asyncio HTTP + SSE; /events /stream /sessions /fork …
    orchestrator.py            # Orchestrator + SessionSupervisor (PTY lifecycle)
    worktrees.py               # WorktreeManager
    eventbus.py                # in-mem ring → SSE + → HistoryStore
    history.py                 # SQLite HistoryStore (schema §5)
    summarizer.py              # CLI / HTTP / none, injected
    metrics.py                 # build/test/tool counters
    snapshots.py               # bundle / list / restore (restore cmd templated)
    runtimes/
      base.py                  # AgentRuntime Protocol (§4.2)
      generic.py
      claude_code.py           # hooks event mapping + JSONL transcript locator
      codex.py                 # (later)
    cli.py                     # `rubberduck serve | launch | fork | emit | open`
  web/                         # React dashboard (Vite)
    src/{App, SessionGrid, ForkTree, History, …}
    package.json
  tests/
    unit/                      # per-module
    runtime/                   # end-to-end behavior gates (see §8)
    fakes/fake_agent.py        # scriptable stand-in CLI agent for deterministic tests
  README.md
  schema.md                    # the POST /events contract — public API
```

State (`db.sqlite`, `worktrees/`, `snapshots/`) lives in `~/.rubberduck/`, never in the install tree.

---

## 8. Testing strategy

Every Act ships its own tests. Three layers, all run in CI and locally before commit:

### Build-time gates (fast, every commit)
- **`ruff`** — lint.
- **`black --check`** — format.
- **`mypy --strict`** on `src/rubberduck/` — types.
- **slop-check** — the repo's `.claude/rules/*` guardrails (over-engineering, comment/doc/test/error slop). Manual or scripted grep gate.
- **Frontend:** `eslint` + `tsc --noEmit` + `vite build` must succeed.

### Unit tests (pytest, per module)
Test real behavior, not mocks (per `test-slop.md`):
- `worktrees.py`: against a real temp git repo — add creates a real worktree on a real branch; remove cleans it; fork branches off the parent.
- `history.py`: write a session, restart (new connection), read it back; fork lineage query returns correct tree.
- `eventbus.py`: ring evicts oldest past capacity; every event also lands in SQLite.
- `metrics.py`: N build events → counter reads N.
- `runtimes/generic.py`: `detect_state` returns `waiting` on a known prompt marker, `busy` mid-output, `idle` at rest.
- `summarizer.py`: `none` returns mechanical summary; CLI runs the configured command; failure degrades gracefully.

### Runtime gates (end-to-end, per Act)
Driven by `tests/fakes/fake_agent.py` — a scriptable CLI that emits known output/states on cue, so tests are deterministic and need no real LLM:
- Act 1: `curl POST /events` renders live on the dashboard with **no agent** (agnosticism proof).
- Act 2: kill + restart server → past sessions still listed.
- Act 3: launch the fake agent → dashboard shows busy→idle, uptime ticks.
- Act 4: two sessions on one repo → two isolated worktrees, edits don't collide.
- Act 5: fork A→B→C → tree renders correct parent/child, each on its own branch.
- Act 6: trigger N fake builds → counter reads N.
- Act 7: session start→end → row has intention + outcome; mechanical fallback when summarizer off.

---

## 9. Acts (small, independently testable)

| Act | Slice | Runtime gate |
|---|---|---|
| **0** | Python+React scaffold; `ruff`/`black`/`mypy`/`pytest`/`eslint`/`vite` gates; CI; slop-check wired; `fake_agent.py` | All gates green on empty package; CI runs on push |
| **1** | Event core: `POST /events`, SSE `/stream`, React live grid, `~/.rubberduck/` storage | `curl POST /events` renders live, no agent involved |
| **2** | SQLite `HistoryStore` (schema §5); events + sessions persist | Restart server → past sessions still listed with timestamps |
| **3** | `Orchestrator` + `SessionSupervisor`: spawn `generic` agent in PTY; coarse state | Launch fake agent via API → dashboard busy→idle, uptime ticks |
| **4** | `WorktreeManager` add/list/remove; launch session into a worktree | 2 sessions / 1 repo → 2 isolated worktrees, no collision |
| **5** | Fork: child worktree+branch, lineage recorded; React fork-tree view | Fork A→B→C → tree correct, each on own branch |
| **6** | Metrics: build/test/tool counters per session | N fake builds → counter reads N |
| **7** | `Summarizer` (CLI/HTTP/none) + intention capture at launch | start→end → intention + outcome stored; mechanical fallback works |
| **8** | `claude-code` adapter: hook events + JSONL transcript locator | Real Claude session → fine-grained tool events + high-quality summary |
| **9** | `codex` adapter (second real runtime) | Real Codex session tracked (coarser state documented) |
| **10** | Snapshots + restore (templated relaunch command) | Snapshot-all / list / restore-to-terminal on macOS + Linux |
| **11** *(later, optional)* | Conductor-style extras: checkpoints/rollback, "spotlight" (sync worktree→main to test), multi-model compare | Each its own mini-Act, only if wanted |

Acts 0–3 stand up the spine (gates → live view → persistence → launch). 4–7 deliver the headline features (worktrees, forking, metrics, summaries). 8–9 add real runtimes. 10–11 are convenience and polish.

---

## 10. Open decisions deferred to build time

- **HTTP layer:** stdlib `asyncio`/`http.server` (keeps deps minimal) vs. FastAPI+uvicorn (ergonomics). Lean stdlib unless SSE+routing gets painful — decide in Act 1.
- **Fork context copying:** whether forking copies the parent agent's conversation state (ccmanager does this for Claude) or starts the child fresh. Decide in Act 5; likely runtime-specific.
- **`waiting-on-human` detection for generic agents:** how reliably we can detect "agent is blocked on a prompt" from PTY output alone. May stay Claude-only (via `Notification`/`PermissionRequest` hooks) until a generic heuristic proves out — flag, don't over-build.
