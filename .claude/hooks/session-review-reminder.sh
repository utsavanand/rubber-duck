#!/bin/bash
# UV Suite Hook: Remind to review before ending session
# Event: Stop
# If there are uncommitted changes, reminds the user to run /review and /slop-check.

# Check for uncommitted changes
STAGED=$(git diff --cached --stat 2>/dev/null)
UNSTAGED=$(git diff --stat 2>/dev/null)
UNTRACKED=$(git ls-files --others --exclude-standard 2>/dev/null | head -5)

if [ -z "$STAGED" ] && [ -z "$UNSTAGED" ] && [ -z "$UNTRACKED" ]; then
  # No changes — nothing to remind about
  exit 0
fi

# Build a summary of what's pending
SUMMARY=""
if [ -n "$STAGED" ]; then
  SUMMARY="Staged changes:\n$STAGED\n"
fi
if [ -n "$UNSTAGED" ]; then
  SUMMARY="${SUMMARY}Unstaged changes:\n$UNSTAGED\n"
fi
if [ -n "$UNTRACKED" ]; then
  SUMMARY="${SUMMARY}Untracked files:\n$UNTRACKED\n"
fi

cat <<EOF
{
  "continue": true,
  "systemMessage": "SESSION END REMINDER: There are uncommitted changes in the working tree.\n\n${SUMMARY}\nConsider running /review and /slop-check before committing."
}
EOF

exit 0
