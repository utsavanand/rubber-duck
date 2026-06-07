#!/bin/bash
# UV Suite Hook: Nag user to label session if metadata.name is empty.
# Event: UserPromptSubmit
#
# Reads the metadata file at .uv-suite-state/sessions/$UVS_SESSION_ID.json.
# If the session has no name, injects an additionalContext nudge once every
# Nth user prompt (default 3) so Claude reminds the user to run /session-init.
# Skips when the prompt is itself a slash command.

INPUT=$(cat)
STATE_DIR="${CLAUDE_PROJECT_DIR:-.}/.uv-suite-state"
SESSIONS_DIR="$STATE_DIR/sessions"

# Resolve session id: env first, then current-session pointer
SID="${UVS_SESSION_ID:-}"
if [ -z "$SID" ] && [ -f "$STATE_DIR/current-session.txt" ]; then
  SID=$(cat "$STATE_DIR/current-session.txt" 2>/dev/null)
fi

[ -z "$SID" ] && exit 0
META_FILE="$SESSIONS_DIR/$SID.json"
[ ! -f "$META_FILE" ] && exit 0

# Skip when the session already has a name
if command -v jq >/dev/null 2>&1; then
  NAME=$(jq -r '.name // ""' "$META_FILE" 2>/dev/null)
else
  NAME=$(grep -o '"name"[[:space:]]*:[[:space:]]*"[^"]*"' "$META_FILE" | head -1 | sed 's/.*"name"[[:space:]]*:[[:space:]]*"\(.*\)"/\1/')
fi
[ -n "$NAME" ] && exit 0

# Skip when the user prompt is itself a slash command
if command -v jq >/dev/null 2>&1; then
  PROMPT=$(echo "$INPUT" | jq -r '.prompt // empty' 2>/dev/null)
else
  PROMPT=$(echo "$INPUT" | grep -o '"prompt":"[^"]*"' | head -1 | cut -d'"' -f4)
fi
case "$PROMPT" in
  /*) exit 0 ;;
esac

# Rate-limit: nag every Nth prompt (default 3)
INTERVAL="${UVS_LABEL_NAG_INTERVAL:-3}"
COUNT_FILE="$SESSIONS_DIR/$SID.prompt-count"
COUNT=$(cat "$COUNT_FILE" 2>/dev/null)
[ -z "$COUNT" ] && COUNT=0
COUNT=$((COUNT + 1))
echo "$COUNT" > "$COUNT_FILE"

# Nag on the 1st prompt and every Nth after
REMAINDER=$((COUNT % INTERVAL))
if [ "$COUNT" -ne 1 ] && [ "$REMAINDER" -ne 1 ]; then
  exit 0
fi

MSG="[uv-suite] This session has no name yet. Briefly remind the user to run /session-init to set name, kind (long-running/outcome), purpose, and priority — these label the session in the watchtower dashboard. One sentence is enough; then proceed with the user's request."

if command -v jq >/dev/null 2>&1; then
  jq -nc --arg ctx "$MSG" '{hookSpecificOutput:{hookEventName:"UserPromptSubmit",additionalContext:$ctx}}'
else
  ESCAPED=$(printf '%s' "$MSG" | sed 's/\\/\\\\/g; s/"/\\"/g')
  printf '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"%s"}}' "$ESCAPED"
fi
