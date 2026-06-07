---
name: checkpoint
description: >
  Save a checkpoint of the current session — what was done, key decisions, current state,
  and what's next. Use before ending a session, before /compact, or at any natural breakpoint.
  Checkpoints are stored per-session under uv-out/checkpoints/<session-id>/, so concurrent
  terminals don't clobber each other. /restore picks up the latest for the current session.
argument-hint: "[optional-label]"
user-invocable: true
allowed-tools:
  - Write(*)
  - Read(*)
  - Bash(git status *)
  - Bash(git diff *)
  - Bash(git log *)
  - Bash(git branch *)
  - Bash(git rev-parse *)
  - Bash(date *)
  - Bash(ls *)
  - Bash(mkdir *)
  - Bash(cat *)
  - Bash(echo *)
  - Bash("$CLAUDE_PROJECT_DIR"/.claude/hooks/checkpoint-helper.sh *)
---

## Resolve session and checkpoint directory

!`"$CLAUDE_PROJECT_DIR"/.claude/hooks/checkpoint-helper.sh dir`

Use the absolute path printed above as `<checkpoint-dir>` for every file path below.
The directory is per-session — two `uv` launches in the same repo write to
different folders, so checkpoints don't collide.

## Session metadata

!`"$CLAUDE_PROJECT_DIR"/.claude/hooks/checkpoint-helper.sh meta`

## Frontmatter to embed at the top of the checkpoint

!`"$CLAUDE_PROJECT_DIR"/.claude/hooks/checkpoint-helper.sh frontmatter`

## Write a checkpoint

Write a file named `<checkpoint-dir>/YYYY-MM-DD-HHMM.md` using the current
timestamp. **Begin the file with the YAML frontmatter block printed above
exactly as shown** — `/restore` parses these fields when picking which
checkpoint to load.

Also write/overwrite `<checkpoint-dir>/latest.md` with the same content,
so the next session's `/restore` always finds the freshest state for this
session.

## Label

$ARGUMENTS

If a label was provided, include it in the filename:
`<checkpoint-dir>/YYYY-MM-DD-HHMM-[label].md`

## Body structure (after the frontmatter)

```markdown
# Checkpoint: [date] [time] [label if provided]

## What was accomplished
- [Bullet list of concrete things done this session]
- [Be specific: "Added webhook retry logic to PaymentService" not "worked on payments"]

## Key decisions made
- [Decision]: [Why] — [What was considered and rejected]
- [Only include decisions that affect future work]

## Current state
- Branch: [current git branch]
- Uncommitted changes: [yes/no, summary if yes]
- Tests: [passing/failing/not run]
- Blockers: [any unresolved issues]

## Files modified
- [List key files changed, not every file]

## What's next
- [Immediate next step — what the next session should start with]
- [Remaining tasks from the current Act/plan]

## Context the next session needs
- [Anything non-obvious that would be lost without this checkpoint]
- [Workarounds in place, temporary decisions, "this looks wrong but it's intentional because..."]
- [Environment setup notes if relevant]
```

## Git state to capture

!`git branch --show-current 2>/dev/null || echo "not a git repo"`

!`git status --short 2>/dev/null | head -20 || echo "no git"`

!`git log --oneline -5 2>/dev/null || echo "no git history"`

## Rules

- Be specific. "Worked on auth" is useless. "Added JWT refresh token rotation with 7-day expiry" is useful.
- Capture WHY decisions were made, not just what. The next session needs the rationale.
- Keep the body under 80 lines. The frontmatter is required and not counted.
- Always include the YAML frontmatter — `/restore` reads it to pick the right checkpoint and to display session context.
