# Test coverage

What's tested, at which layer, and what's left for a human. Keep this current as
tests are added.

## The three layers
| Layer | Where | What it proves | Run |
|---|---|---|---|
| **Unit** | `tests/unit/` (mirrors `src/`) | One module's logic in isolation | `pytest tests/unit` |
| **API / runtime** | `tests/runtime/` | The real asyncio server + DB end-to-end over HTTP (no browser); 11 of 17 boot an actual `Server` | `pytest tests/runtime` |
| **UI** | `web/e2e/` (Playwright) | The real dashboard in a browser → real server, asserting UI **and** backend | `cd web && npm run e2e` |

**Run everything before pushing:** `scripts/check.sh` (lint + types + all three
layers). The git **pre-commit hook** runs the fast subset (`--no-ui`) on every
commit; the UI layer runs in the full gate.

## Scenario → coverage matrix
✅ covered · ⚠️ partial · ✋ human-only (see [manual-test-cases.md](manual-test-cases.md))

### Sessions
| Scenario | Unit | API | UI | Human |
|---|---|---|---|---|
| New session launches (agent picker, folder, command) | | `test_supervisor`, `test_worktree_launch`, `test_codex_launch` | `new-session.spec` | ✋ real terminal tab opens |
| Watched session appears from hook events | | `test_event_flow`, `test_git_enrichment` | | ✋ real claude/codex/copilot |
| Stop a session | `test_server` | `test_session_io` | `stop.spec` | |
| Delete (removes events/worktree, tombstone) | `test_history`, `test_session…` | `test_fork` (lineage) | `delete.spec` | |
| Delete guard on unmerged commits / git-check failure | `test_server` (fail-closed) | | | ✋ real unmerged branch |
| Watched vs launched flag (sticky) | `test_history` | | | |

### Forking
| Scenario | Unit | API | UI | Human |
|---|---|---|---|---|
| Worktree fork (new branch off parent) | `test_worktrees` | `test_fork` | | ✋ terminal opens |
| Conversation fork (resume) | | `test_fork_conversation` | `fork.spec` (modal + error path) | ✋ real claude `--resume` |
| Fork lineage / tree | | `test_fork` | | |

### Checkpoints
| Scenario | Unit | API | UI | Human |
|---|---|---|---|---|
| Capture prompts + commands + files | `test_checkpoints` | `test_runtime_gates_flow` | `checkpoint.spec` | |
| Summary (mechanical fallback) | `test_checkpoints`, `test_summarizer` | `test_summary_flow` | | |
| Summary via CLI agent (auto-detect) | `test_summarizer` | `test_claude_summary` | | ✋ real LLM summary *quality* |
| Capture agent responses from transcript | `test_claude_code`, `test_codex`, `test_copilot` | | | ✋ real transcript on disk |
| Persisted (DB + markdown), survives restart | `test_checkpoints` | | | ✋ real reboot |

### Hooks / harness onboarding
| Scenario | Unit | API | UI | Human |
|---|---|---|---|---|
| install/uninstall writes correct config (3 agents) | `agents/test_hooks_install` | | | |
| Registry: one source of truth, runtime resolution | `test_harnesses` | | | |
| Codex hook trust (`/hooks`) | | | | ✋ interactive trust prompt |

### Dashboard panels
| Scenario | Unit | API | UI | Human |
|---|---|---|---|---|
| Snapshot all / restore | `test_snapshots` | `test_snapshot_flow` | `snapshot.spec` | ✋ restore opens terminal |
| HITL: approve/deny | `test_approvals` | `test_approval_flow` | | ✋ click-through on a launched session |
| Pulse (live events) | `test_eventbus` | `test_event_flow` | | ✋ click-to-expand, live ticker |
| Timeline / diff / notes drawer | | `test_session_io` | | ✋ visual render of each tab |
| Dashboard is served | | `test_dashboard_serving` | (every spec loads it) | |

### Cross-cutting
| Scenario | Unit | API | UI | Human |
|---|---|---|---|---|
| Security: token + same-origin gate | `helpers (security)` | `test_event_flow` (401/403) | (specs send the token) | |
| Git detection / worktree mgmt | `test_gitdetect`, `test_worktrees`, `test_spotlight` | `test_worktree_launch` | | |
| tmux session persistence across restart | `test_tmux` | `test_tmux_persistence` | | ✋ true reboot |
| WebSocket stream | `test_websocket` | `test_websocket_flow` | | |

## Left for human testing (the ✋ list, consolidated)
These can't be automated and live in [manual-test-cases.md](manual-test-cases.md):
- **Real terminal launching** (iTerm/Terminal via osascript) — UI tests run headless; the actual tab opening is visual/OS-coupled.
- **Real agents end-to-end** — a watched claude/codex/copilot session actually streaming; conversation-fork against a real session_id.
- **Codex `/hooks` trust** — an interactive TUI prompt with no automation hook.
- **Reboot / restart persistence** — true machine reboot (tmux survival is API-tested via process restart, not a real reboot).
- **LLM summary quality** — we assert a summary exists; whether it's *good* is a human read.
- **Transcript capture against real on-disk transcripts** — parsers are unit-tested on fixtures; the real files need a real session.
- **Dashboard visuals** — pixel layout, dark mode, the pulse animation, drawer tabs rendering.

## Gaps worth closing later
- No UI spec yet for **HITL approve/deny** or the **pulse click-to-expand** (both are UI-only flows; good Playwright candidates).
- No UI spec for the **drawer tabs** (timeline/diff/notes render).
