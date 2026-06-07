#!/bin/bash
# Rubberduck ingest hook. Claude Code runs this on each hook event with the
# event's JSON on stdin; it forwards the event to the Rubberduck server.
#
# Wired automatically by `rubberduck install-hooks`. Self-contained — no
# dependency on uv-suite or any other tooling. Non-blocking and silent on
# failure, so it never interferes with a Claude session if the server is down.
#
# Usage (from settings.json hook config):
#   rubberduck-hook.sh PostToolUse
# The event type is passed as $1; Claude's hook JSON arrives on stdin.

EVENT_TYPE="${1:-Unknown}"
INPUT=$(cat)
URL="${RUBBERDUCK_URL:-http://127.0.0.1:4200}"

if command -v jq >/dev/null 2>&1; then
  PAYLOAD=$(printf '%s' "$INPUT" | jq -c --arg etype "$EVENT_TYPE" '
    {
      event_type: $etype,
      session_id: .session_id,
      cwd: .cwd,
      source_app: (.cwd // "" | split("/") | last),
      tool_name: .tool_name,
      tool_input: .tool_input,
      runtime: "claude-code"
    } | with_entries(select(.value != null))' 2>/dev/null)
fi

# Fallback when jq is missing: extract the load-bearing fields with grep.
if [ -z "$PAYLOAD" ] || [ "$PAYLOAD" = "null" ]; then
  SID=$(printf '%s' "$INPUT" | grep -o '"session_id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
  CWD=$(printf '%s' "$INPUT" | grep -o '"cwd"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
  TOOL=$(printf '%s' "$INPUT" | grep -o '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
  APP=$(basename "$CWD" 2>/dev/null)
  PAYLOAD=$(printf '{"event_type":"%s","session_id":"%s","cwd":"%s","source_app":"%s","tool_name":"%s","runtime":"claude-code"}' \
    "$EVENT_TYPE" "$SID" "$CWD" "$APP" "$TOOL")
fi

curl -s -X POST "$URL/events" \
  -H 'Content-Type: application/json' \
  -d "$PAYLOAD" >/dev/null 2>&1 &

exit 0
