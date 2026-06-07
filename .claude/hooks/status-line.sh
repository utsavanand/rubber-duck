#!/bin/bash
# UV Suite Hook: Status line — show session label, persona, duration.
# Event: statusLine (rendered continuously)

STATE_DIR="${CLAUDE_PROJECT_DIR:-.}/.uv-suite-state"
SESSIONS_DIR="$STATE_DIR/sessions"
START_FILE="$STATE_DIR/session-start.txt"

# Resolve UVS session id
SID="${UVS_SESSION_ID:-}"
if [ -z "$SID" ] && [ -f "$STATE_DIR/current-session.txt" ]; then
  SID=$(cat "$STATE_DIR/current-session.txt" 2>/dev/null)
fi
META_FILE=""
[ -n "$SID" ] && META_FILE="$SESSIONS_DIR/$SID.json"

# Pull metadata fields if available
NAME=""; PERSONA=""; PRIORITY=""; STARTED_AT=""
if [ -n "$META_FILE" ] && [ -f "$META_FILE" ]; then
  if command -v jq >/dev/null 2>&1; then
    NAME=$(jq -r '.name // ""' "$META_FILE" 2>/dev/null)
    PERSONA=$(jq -r '.persona // ""' "$META_FILE" 2>/dev/null)
    PRIORITY=$(jq -r '.priority // ""' "$META_FILE" 2>/dev/null)
    STARTED_AT=$(jq -r '.started_at // ""' "$META_FILE" 2>/dev/null)
  fi
fi

# Session duration: prefer per-session started_at, fall back to per-cwd legacy file
NOW=$(date +%s)
START=""
if [ -n "$STARTED_AT" ] && [ "$STARTED_AT" != "null" ]; then
  START="$STARTED_AT"
elif [ -f "$START_FILE" ]; then
  START=$(cat "$START_FILE")
fi
if [ -n "$START" ]; then
  ELAPSED=$((NOW - START))
  MINS=$((ELAPSED / 60))
else
  MINS=0
fi

if   [ "$MINS" -ge 180 ]; then SESSION="${MINS}m (!! take a break)"
elif [ "$MINS" -ge 90 ];  then SESSION="${MINS}m (break soon)"
else                           SESSION="${MINS}m"
fi

# Today's total active time (per cwd)
TODAY=$(date +%Y-%m-%d)
TODAY_FILE="$STATE_DIR/active-$TODAY.txt"
TODAY_STR=""
if [ -f "$TODAY_FILE" ]; then
  TODAY_TOTAL=$(cat "$TODAY_FILE")
  TODAY_NOW=$((TODAY_TOTAL + MINS))
  TODAY_STR=" · today ${TODAY_NOW}m"
fi

# Build label
LABEL_PARTS=()
if [ -n "$NAME" ] && [ "$NAME" != "null" ]; then
  LABEL_PARTS+=("$NAME")
else
  LABEL_PARTS+=("(unlabeled)")
fi
[ -n "$PERSONA" ] && [ "$PERSONA" != "null" ] && LABEL_PARTS+=("[$PERSONA]")
[ -n "$PRIORITY" ] && [ "$PRIORITY" != "null" ] && LABEL_PARTS+=("p:$PRIORITY")

# Join with spaces
LABEL_STR="${LABEL_PARTS[*]}"

echo "UV Suite · $LABEL_STR · ${SESSION}${TODAY_STR}"
