#!/bin/bash
# UV Suite Hook: Block dangerous bash commands
# Event: PreToolUse (Bash)
# Blocks rm -rf, DROP TABLE, force push to main, etc.

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if [ -z "$COMMAND" ]; then
  exit 0
fi

# Block patterns
if echo "$COMMAND" | grep -qEi "rm\s+-rf\s+/|rm\s+-rf\s+~|rm\s+-rf\s+\.\s*$"; then
  echo "Blocked: recursive delete of root, home, or current directory" >&2
  exit 2
fi

if echo "$COMMAND" | grep -qEi "drop\s+(table|database)|truncate\s+table"; then
  echo "Blocked: destructive database operation — get human approval first" >&2
  exit 2
fi

if echo "$COMMAND" | grep -qEi "git\s+push\s+.*--force.*\s+(main|master)"; then
  echo "Blocked: force push to main/master" >&2
  exit 2
fi

if echo "$COMMAND" | grep -qEi "git\s+reset\s+--hard\s+origin"; then
  echo "Blocked: hard reset to origin — this discards local work" >&2
  exit 2
fi

exit 0
