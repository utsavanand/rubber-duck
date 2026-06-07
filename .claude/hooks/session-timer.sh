#!/bin/bash
# UV Suite Hook: Session timer — warn about session duration
# Event: PostToolUse (runs every Nth tool call)
# Escalates: 45min → gentle, 90min → firm, 180min → strong

STATE_DIR="${CLAUDE_PROJECT_DIR:-.}/.uv-suite-state"
START_FILE="$STATE_DIR/session-start.txt"

# Only check every 20th tool call to avoid noise
COUNT_FILE="$STATE_DIR/tool-count.txt"
COUNT=$(cat "$COUNT_FILE" 2>/dev/null || echo "0")
COUNT=$((COUNT + 1))
echo "$COUNT" > "$COUNT_FILE"

if [ $((COUNT % 20)) -ne 0 ]; then
  exit 0
fi

if [ ! -f "$START_FILE" ]; then
  exit 0
fi

START=$(cat "$START_FILE")
NOW=$(date +%s)
ELAPSED=$((NOW - START))
MINUTES=$((ELAPSED / 60))

# Check if we've already shown a warning for this threshold
LAST_WARN_FILE="$STATE_DIR/last-warning.txt"
LAST_WARN=$(cat "$LAST_WARN_FILE" 2>/dev/null || echo "0")

MESSAGE=""
WARN_LEVEL=0

if [ "$MINUTES" -ge 180 ] && [ "$LAST_WARN" -lt 3 ]; then
  MESSAGE="CHECKPOINT (${MINUTES} min): Long session. Commit what you have, then consider a fresh session. /compact if continuing."
  WARN_LEVEL=3
elif [ "$MINUTES" -ge 90 ] && [ "$LAST_WARN" -lt 2 ]; then
  MESSAGE="CHECKPOINT (${MINUTES} min): Good time to commit progress and take a break."
  WARN_LEVEL=2
elif [ "$MINUTES" -ge 45 ] && [ "$LAST_WARN" -lt 1 ]; then
  MESSAGE="CHECKPOINT (${MINUTES} min): Consider committing progress."
  WARN_LEVEL=1
fi

if [ -n "$MESSAGE" ]; then
  echo "$WARN_LEVEL" > "$LAST_WARN_FILE"
  cat <<EOF
{
  "continue": true,
  "systemMessage": "$MESSAGE"
}
EOF
fi

exit 0
