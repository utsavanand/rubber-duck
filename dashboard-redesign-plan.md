# Dashboard redesign: three-panel layout

Replaces the single-column session-card grid with a three-panel layout. Decided
with the user 2026-06-09.

## TODO — queued commands (deferred, agreed 2026-06-09)

Queue a command to send to an agent once it finishes its current task. NEW
backend work, not just UI — write up here, build later.

- Store: per-session ordered list of pending command strings. New table or a
  `queue_json` column on sessions.
- Endpoints: `GET/POST /sessions/:key/queue` (list/add), `DELETE …/queue/:i`.
- Trigger: on the session's `Stop` event (turn ended), pop the head of the
  queue and `write_input(cmd + "\n")`. Reuses the existing input-injection path
  (orchestrator `write_input`).
- LIMIT: only works for Rubberduck-LAUNCHED sessions (it owns the PTY). Watched
  sessions can't be driven — disable the queue UI for them, same as the input
  box. Surface why.
- Edge cases: agent never Stops (queue just waits); multiple queued (drain one
  per Stop, or all at once?); queued while mid-PermissionRequest (wait for a
  real Stop, not a Notification).
- UI: inline in the agent row, next to Notes.

## Layout

```
┌─ 🦆 RubberDuckHQ  ● Live ───────────── [◐] [New session] [Snapshots] ┐
├──────────────────┬──────────────────────┬──────────────────────────┤
│ AGENTS (left)    │ NEEDS YOU (middle)   │ PULSE (right)            │
│ tree of sessions │ attention items only │ rolling event ticker     │
└──────────────────┴──────────────────────┴──────────────────────────┘
```

### Left — agent tree
- One row per session. Forks (conversation forks AND worktree forks) nest under
  their parent via existing `parentKey` lineage.
- Active / Idle / All filter (kept from today's segment control).
- Compact row: name, state pill, repo/branch, event count.
- Click row body → opens the existing right-side detail drawer
  (timeline/output/diff/checkpoints/notes). Row does NOT expand inline.
- Action buttons (Open, Fork worktree, Fork conversation, Checkpoint, Spotlight,
  Stop, Delete) live in the drawer / on hover, not crowding the row.

### Middle — needs you
- Only sessions in `waiting` state (PermissionRequest / Notification) or
  idle-waiting. Empty most of the time ("Nothing needs you").
- Reuses the existing `Approvals` component + `/approvals` API for inline
  Approve/Deny on permission requests.

### Right — pulse
- Rolling ticker over the existing `/stream` SSE feed (`useEventStream`).
- Each line: time · agent · latest action (event_type + tool). Auto-scroll,
  cap ~100 lines.

## Scope decisions
- 3-panel REPLACES the main view. Fork-tree tab removed (nesting covers it).
- Compare / Snapshots / New session stay as topbar actions.
- Built all at once with the two bug fixes folded in.

## Bug fixes folded in
1. **Worktree path overflow** — long unbreakable path token overflows the card.
   Fix: `word-break: break-all` + truncate in the row/drawer.
2. **"could not send input — session not live"** — NOT a bug. `_input`
   (server.py:756) only works for Rubberduck-LAUNCHED sessions (it owns the
   PTY). Watched sessions (you ran `claude` yourself, hooks report) have no PTY,
   so stdin can't be written. Fix: only show the input box when the session is
   Rubberduck-owned (`worktreePath` + live supervisor); for watched sessions,
   replace the output/input tab with "runs in your own terminal" copy.

## Data layer — no server changes needed
- `useEventStream` → sessions + live events (powers left + right panels).
- `parentKey` → lineage nesting (already powers Fork-tree tab).
- `/approvals` + `Approvals.tsx` → middle panel.

## Build
`cd web && npm run build` → emits to `src/rubberduck/dashboard/assets/`.
That bundle is what ships in the pip package.
```
