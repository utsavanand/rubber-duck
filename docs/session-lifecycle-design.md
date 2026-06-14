# Session lifecycle: stop / resume / archive / delete

## The problem this fixes
Two muddled things:

1. **Stop is a dead end.** Today Stop terminates the agent and the row drops out
   of the Active view; there's no way to pick it back up from the dashboard. Stop
   should *pause* a session you can **resume**, not kill-and-forget.
2. **Delete is ambiguous / destructive.** Delete is the only way to clear a row,
   but it wipes everything. There's no "I'm done for now, declutter but keep it"
   middle ground (archive). And delete was historically offered on sessions
   Rubberduck doesn't control (watched), which caused ghost rows.

## Principle
**Lifecycle actions only apply to sessions Rubberduck controls.** A *launched*
session (Rubberduck owns the terminal/PTY) gets the full lifecycle. A *watched*
session (you started it in your own terminal) follows its real terminal's
lifecycle — Rubberduck observes, it can't stop/resume/delete the process.

## States
`busy` · `idle` · `waiting` · **`stopped`** (new, resumable) ·
**`archived`** (new) · `terminated`

- **stopped** = Rubberduck killed the process *on purpose* and kept everything
  (worktree, branch, conversation id, checkpoints). It is **resumable**.
- **archived** = put away to declutter; everything kept, hidden from default
  views behind an Archived filter. Reachable from stopped or terminated.
- **terminated** = the process ended on its own (agent exited, tab closed). For a
  launched session this is effectively the same as stopped-but-not-by-us; it's
  also resumable if we still have its worktree + session id.
- Permanent delete is **not a state** — it removes the row from memory entirely.

Filter bar: **Active** (busy/idle/waiting) · **Archived** · **All**.
Watched / Launched origin filters remain.

## State machine (launched sessions)

```
            ┌─────────── Resume ──────────┐
            ▼                              │
   busy/idle/waiting ── Stop ──▶ stopped ─┘
        │                          │  └── Archive ──▶ archived ── Unarchive ─┐
        │                          │                      │                   │
        │ (agent exits / tab dies) │                      └── Delete ──▶ (gone)
        ▼                          ▼
     terminated ◀──────────────────┘
        │  └── Resume / Archive / Delete (same options as stopped)
```

- **Stop**: kill the PTY / close the terminal tab. State → `stopped`. Keep the
  worktree, branch, and (claude-code) the conversation session id.
- **Resume**: relaunch the agent in the session's original cwd/worktree. For
  claude-code, pass `--resume <session_id>` so the conversation continues where
  it left off (non-forking sibling of the existing conversation-fork). Reuses the
  same session_key so lineage/history stays attached. State → busy.
- **Archive**: from stopped or terminated → `archived` (hidden). Process already
  dead; nothing to kill.
- **Unarchive**: `archived` → `stopped` (back in view, still resumable).
- **Delete**: permanent — close terminal, remove worktree, wipe events /
  checkpoints / metrics, tombstone the key. Keeps the unmerged-commits confirm.

## Watched sessions (you own the terminal)
- **No Stop / Resume / Delete buttons** — Rubberduck doesn't own the process.
  Shown grayed with a hint: *"To stop or delete, close the terminal yourself."*
- Rubberduck **detects when the terminal is gone** (explicit PID/tty liveness
  check, not just heartbeat silence) → **auto-archive**.
- A watched session is never user-deletable, only auto-archived when its terminal
  actually dies. No tombstone (its live events legitimately keep it alive). This
  removes the ghost-row problem entirely.

## Why Resume needs care per harness
Resume is behind the unified Harness contract — each runtime declares how to
continue a session:
- **claude-code**: `claude --resume <session_id>` (session_id captured from
  hooks; same plumbing the conversation-fork uses, minus `--fork-session`).
- **codex / copilot**: their own resume command (each Harness already declares a
  `restore_command`; reuse/extend it).
- **generic / bring-your-own**: no native resume — Resume just relaunches the
  command in the cwd (fresh conversation). Surface this honestly ("relaunches;
  this agent has no conversation resume").

## UI behavior (the specific thing the user hit)
- A **stopped** (or terminated, launched) row **stays visible**, greyed, with a
  **Resume** button — instead of vanishing. Plus Archive and Delete.
- Stop, once clicked, greys the row's actions immediately (already shipped) and
  transitions to `stopped` rather than dropping it from Active silently.
- The Active filter shows busy/idle/waiting; stopped rows show under All (and a
  possible "Stopped" sub-filter) so you can find and resume them.

## Implementation outline
1. **Schema**: represent `stopped` and `archived` (state values or
   `archived_at` / `stopped_at` columns). `sessions()` reports them;
   `effectiveState` maps them. Keep `repo_path` / `worktree_path` /
   `session_id` on stop so Resume has what it needs.
2. **Stop** (launched): kill PTY / close tab → set `stopped` (today it ends as
   terminated; change to the resumable state). Keep the worktree.
3. **Resume** (launched): `POST /sessions/:key/resume` — rebuild the runtime's
   resume argv (per-harness), relaunch in the saved cwd/worktree under the same
   session_key, clear `stopped`/`archived`.
4. **Archive / Unarchive**: `POST /sessions/:key/archive` and `/unarchive`
   (or a mode on delete). No process action; just the state + filter.
5. **Delete**: unchanged permanent behavior (close terminal, remove worktree,
   wipe, tombstone, unmerged-commit guard).
6. **Watched liveness sweep**: check each watched session's tty/PID; when the
   process is gone, set `archived`. Replaces heartbeat-silence-only for watched.
7. **UI**: Resume button on stopped/terminated launched rows; Archive on
   stopped/terminated/archived; Stop only on live launched; for watched, hide
   Stop/Resume/Delete with the hint. Add the Archived filter.

## Build order (incremental)
- **Phase 1 — Resume** (fixes the reported gap): stopped state + Resume for
  launched sessions, keep stopped rows visible with a Resume button.
- **Phase 2 — Archive**: archived state + filter + archive/unarchive.
- **Phase 3 — Watched lifecycle**: liveness sweep → auto-archive; gate the
  watched buttons.
