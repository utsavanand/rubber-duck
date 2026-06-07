#!/bin/bash
# UV Suite Hook: Session end — reflection and total time
# Event: Stop (replaces session-review-reminder.sh with richer behavior)

STATE_DIR="${CLAUDE_PROJECT_DIR:-.}/.uv-suite-state"
START_FILE="$STATE_DIR/session-start.txt"

# Compute session duration
DURATION_MSG=""
if [ -f "$START_FILE" ]; then
  START=$(cat "$START_FILE")
  NOW=$(date +%s)
  ELAPSED=$((NOW - START))
  MINUTES=$((ELAPSED / 60))

  # Add to today's total
  TODAY=$(date +%Y-%m-%d)
  TODAY_FILE="$STATE_DIR/active-$TODAY.txt"
  TODAY_TOTAL=$(cat "$TODAY_FILE" 2>/dev/null || echo "0")
  TODAY_TOTAL=$((TODAY_TOTAL + MINUTES))
  echo "$TODAY_TOTAL" > "$TODAY_FILE"

  DURATION_MSG="Session: ${MINUTES} min. Today: ${TODAY_TOTAL} min. "

  # Reset session state
  rm -f "$START_FILE" "$STATE_DIR/tool-count.txt" "$STATE_DIR/last-warning.txt"
fi

# Check for uncommitted changes
STAGED=$(git diff --cached --stat 2>/dev/null)
UNSTAGED=$(git diff --stat 2>/dev/null)
UNTRACKED=$(git ls-files --others --exclude-standard 2>/dev/null | head -5)

REVIEW_MSG=""
if [ -n "$STAGED" ] || [ -n "$UNSTAGED" ] || [ -n "$UNTRACKED" ]; then
  REVIEW_MSG="Uncommitted changes — consider /review and /slop-check before committing. "
fi

# Checkpoint prompt
CHECKPOINT_MSG="Run /checkpoint to save session state for next time. Run /restore at the start of your next session."

FULL_MSG="${DURATION_MSG}${REVIEW_MSG}${CHECKPOINT_MSG}"

cat <<EOF
{
  "continue": true,
  "systemMessage": "$FULL_MSG"
}
EOF

exit 0
