# Session lifecycle: stop / archive / delete

## The problem this fixes
Today "delete" is ambiguous for a session that's still running. Deleting *this*
running session (a watched claude-code session) tombstoned it, but its hooks
kept firing — so it either rebuilt as a ghost row (checkpoint 404) or, after an
over-aggressive event-drop fix, vanished entirely even though it's alive. The
root cause: delete/stop were offered on sessions Rubberduck doesn't control.

## Principle
**Lifecycle actions only apply to sessions Rubberduck controls.** A watched
session follows its real terminal's lifecycle; Rubberduck observes, it doesn't
stop or delete it.

## States
`busy` · `idle` · `waiting` · `terminated` · **`archived`** (new)

- **archived** = the session's terminal is gone but we keep its history
  (checkpoints, notes, events) so you can read it later. Distinct from
  `terminated` (just ended) and from permanent delete (gone from memory).
- Filter bar: **Active** (busy/idle/waiting) · **Archived** · **All**. Watched /
  Launched origin filters remain.

## Launched sessions (Rubberduck owns the terminal/process)
- **Stop** → terminate the agent; close the terminal tab. State → terminated.
- **Delete** → prompt with two choices:
  - **Permanent delete** → close terminal + remove from memory entirely
    (the current delete behavior, incl. the unmerged-commit guard).
  - **Archive** → close terminal, keep in memory; state → archived.

## Watched sessions (you own the terminal)
- **No Stop / Delete buttons** — grayed out with a hint:
  *"To stop or delete, close the terminal yourself."*
- Rubberduck **detects when the terminal is gone** (explicit PID/tty liveness
  check, not just heartbeat silence) → **auto-archive** the session.
- If the server restarts and the agent is still running, its next events
  recreate it as a normal live session. No tombstone for watched sessions.

## Why no tombstone for watched
Tombstones exist to stop a deleted session's stray events from resurrecting it.
But if a watched session is alive, its events *should* keep it alive — that's
the whole point. So: watched sessions are never user-deletable, only
auto-archived when their terminal actually dies. This removes the ghost problem
entirely.

## Implementation outline
1. **Schema**: `archived` is representable. Either a new state value or an
   `archived_at` column; sessions() reports it; effectiveState maps it.
2. **Terminal liveness** (watched): a sweep that checks each watched session's
   recorded tty/PID; when the process is gone, set archived. Replaces relying on
   heartbeat-silence alone for watched sessions.
3. **Launched delete**: the API takes a mode — `permanent` (today's delete) or
   `archive` (close terminal, keep row, set archived). The dashboard's Delete
   opens a small confirm with the two choices.
4. **Stop** (launched): unchanged behavior, ensure terminal closes.
5. **UI gating**: Stop/Delete shown only for launched sessions; for watched they
   are absent/grayed with the hint.
6. **Undo the over-aggressive event-drop**: watched sessions are no longer
   tombstone-able from the UI, so the ingest-drop for tombstoned watched
   sessions isn't needed for them. Keep the drop only for genuinely
   permanent-deleted (launched) sessions. This unbreaks the currently-invisible
   live session.

## The immediate regression
This running session is invisible right now because it was tombstoned (deleted
while live) and the ingest-drop silences its events. Step 6 fixes it: once
watched sessions can't be deleted, the existing tombstone on it should be
cleared and its events flow again.
