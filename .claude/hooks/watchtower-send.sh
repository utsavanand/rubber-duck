#!/bin/bash
# UV Suite Hook Helper: Send event to Watchtower server.
# Called by other hooks or directly from persona hook config.
# Non-blocking. Fails silently if server not running.
#
# Usage from hook config:
#   "command": ".claude/hooks/watchtower-send.sh PostToolUse"
# Hook input JSON arrives via stdin from Claude Code.
#
# Merges UV Suite session metadata (name, kind, purpose, priority, persona)
# from .uv-suite-state/sessions/$UVS_SESSION_ID.json into every payload so
# the dashboard can group + label sessions.

EVENT_TYPE="${1:-Unknown}"
INPUT=$(cat)
WATCHTOWER_URL="${UVS_WATCHTOWER_URL:-http://localhost:4200}"

STATE_DIR="${CLAUDE_PROJECT_DIR:-.}/.uv-suite-state"
SESSIONS_DIR="$STATE_DIR/sessions"

# Resolve UVS session id: env first, then current-session pointer
SID="${UVS_SESSION_ID:-}"
if [ -z "$SID" ] && [ -f "$STATE_DIR/current-session.txt" ]; then
  SID=$(cat "$STATE_DIR/current-session.txt" 2>/dev/null)
fi
META_FILE=""
[ -n "$SID" ] && META_FILE="$SESSIONS_DIR/$SID.json"

PAYLOAD=""
if command -v jq >/dev/null 2>&1; then
  if [ -n "$META_FILE" ] && [ -f "$META_FILE" ]; then
    PAYLOAD=$(echo "$INPUT" | jq -c --arg etype "$EVENT_TYPE" --slurpfile m "$META_FILE" '
      . + {
        event_type: $etype,
        source_app: (.cwd // "" | split("/") | last),
        uvs_session_id:   ($m[0].uvs_session_id // ""),
        session_name:     ($m[0].name // ""),
        session_kind:     ($m[0].kind // ""),
        session_purpose:  ($m[0].purpose // ""),
        session_priority: ($m[0].priority // ""),
        persona:          ($m[0].persona // ""),
        _hook_ts: now
      }' 2>/dev/null)
  else
    PAYLOAD=$(echo "$INPUT" | jq -c --arg etype "$EVENT_TYPE" '
      . + {
        event_type: $etype,
        source_app: (.cwd // "" | split("/") | last),
        _hook_ts: now
      }' 2>/dev/null)
  fi
fi

# Fallback when jq is missing or produced nothing usable
if [ -z "$PAYLOAD" ] || [ "$PAYLOAD" = "null" ]; then
  SESSION_ID=$(echo "$INPUT" | grep -o '"session_id":"[^"]*"' | head -1 | cut -d'"' -f4)
  TOOL_NAME=$(echo "$INPUT" | grep -o '"tool_name":"[^"]*"' | head -1 | cut -d'"' -f4)
  CWD=$(echo "$INPUT" | grep -o '"cwd":"[^"]*"' | head -1 | cut -d'"' -f4)
  SOURCE_APP=$(basename "$CWD" 2>/dev/null)
  PAYLOAD=$(printf '{"event_type":"%s","session_id":"%s","uvs_session_id":"%s","source_app":"%s","tool_name":"%s","cwd":"%s"}' \
    "$EVENT_TYPE" "$SESSION_ID" "$SID" "$SOURCE_APP" "$TOOL_NAME" "$CWD")
fi

curl -s -X POST "$WATCHTOWER_URL/events" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  &>/dev/null &

exit 0
