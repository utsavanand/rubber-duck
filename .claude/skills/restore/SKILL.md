---
name: restore
description: >
  Restore the latest checkpoint for the current session — shows what was done,
  key decisions, current state, and what's next. With no arguments, picks the
  current `UVS_SESSION_ID`'s most recent checkpoint. Pass a session id prefix
  or name to restore from a different session.
argument-hint: "[<session-id-prefix> | <session-name> | list]"
user-invocable: true
allowed-tools:
  - Read(*)
  - Bash(ls *)
  - Bash(cat *)
  - Bash(grep *)
  - Bash(find *)
  - Bash(git rev-parse *)
  - Bash("$CLAUDE_PROJECT_DIR"/.claude/hooks/checkpoint-helper.sh *)
---

## Available sessions with checkpoints

!`"$CLAUDE_PROJECT_DIR"/.claude/hooks/checkpoint-helper.sh list`

(`*` marks the current session.)

## Latest checkpoint for the current session

!`"$CLAUDE_PROJECT_DIR"/.claude/hooks/checkpoint-helper.sh latest`

## Argument

$ARGUMENTS

## Instructions

1. **If `$ARGUMENTS` is empty or "latest"**: read the checkpoint shown above (the
   current session's `latest.md`). Summarize it in 3-4 sentences: what was
   done, current state, what's next. Then ask: "Ready to pick up from here, or
   do you want to take a different direction?"

2. **If `$ARGUMENTS` is "list"**: just show the user the available-sessions
   list above and ask which one they want to restore.

3. **If `$ARGUMENTS` looks like a session id prefix** (8-char hex / UUID-ish)
   **or a session name**: match it against the list above. Read the
   matching session's `latest.md` from
   `<project>/uv-out/checkpoints/<full-session-id>/latest.md` using the Read
   tool, then summarize as in (1).

4. If no match is found, list the available sessions and ask the user to
   pick one.

When summarizing, include the session's name and purpose from the
frontmatter at the top of the checkpoint — that's the context the next
session needs to know what it's picking up.
