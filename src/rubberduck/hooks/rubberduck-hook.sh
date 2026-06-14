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
# Which agent this hook is for (claude-code | codex | copilot). Defaults to
# claude-code so older installs that pass only the event type keep working.
RUNTIME="${2:-claude-code}"
INPUT=$(cat)
URL="${RUBBERDUCK_URL:-http://127.0.0.1:4200}"
# Set by Rubberduck when it launches the agent in a terminal, so the agent's
# hook events attach to the row Rubberduck already created instead of spawning
# a duplicate session under Claude's own id. Empty for self-started sessions.
SESSION_KEY="${RUBBERDUCK_SESSION_KEY:-}"

if command -v jq >/dev/null 2>&1; then
  # Field names differ across agents: Claude/Codex use snake_case (session_id,
  # tool_name); Copilot uses camelCase (sessionId, toolName). Accept either.
  PAYLOAD=$(printf '%s' "$INPUT" | jq -c \
    --arg etype "$EVENT_TYPE" --arg skey "$SESSION_KEY" --arg rt "$RUNTIME" '
    {
      event_type: $etype,
      session_key: (if $skey == "" then null else $skey end),
      session_id: (.session_id // .sessionId),
      cwd: .cwd,
      source_app: ((.cwd // "") | split("/") | last),
      tool_name: (.tool_name // .toolName),
      tool_input: (.tool_input // .toolInput),
      prompt: .prompt,
      runtime: $rt
    } | with_entries(select(.value != null))' 2>/dev/null)
fi

# Fallback when jq is missing: extract the load-bearing fields with grep.
if [ -z "$PAYLOAD" ] || [ "$PAYLOAD" = "null" ]; then
  SID=$(printf '%s' "$INPUT" | grep -o '"session_id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
  CWD=$(printf '%s' "$INPUT" | grep -o '"cwd"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
  TOOL=$(printf '%s' "$INPUT" | grep -o '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
  PROMPT=$(printf '%s' "$INPUT" | grep -o '"prompt"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*:[[:space:]]*"\([^"]*\)"$/\1/')
  APP=$(basename "$CWD" 2>/dev/null)
  SKEY_FIELD=""
  [ -n "$SESSION_KEY" ] && SKEY_FIELD=$(printf '"session_key":"%s",' "$SESSION_KEY")
  PROMPT_FIELD=""
  [ -n "$PROMPT" ] && PROMPT_FIELD=$(printf '"prompt":"%s",' "$PROMPT")
  [ -z "$SID" ] && SID=$(printf '%s' "$INPUT" | grep -o '"sessionId"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
  PAYLOAD=$(printf '{"event_type":"%s",%s%s"session_id":"%s","cwd":"%s","source_app":"%s","tool_name":"%s","runtime":"%s"}' \
    "$EVENT_TYPE" "$SKEY_FIELD" "$PROMPT_FIELD" "$SID" "$CWD" "$APP" "$TOOL" "$RUNTIME")
fi

# The server writes a per-install secret to this file (0600). We read it and
# send it as a header so the server accepts our /events POST — same machine,
# same user, so the file is readable. Missing file => empty token => the post is
# rejected, which is correct (no server, or a server that predates the token).
TOKEN_FILE="${RUBBERDUCK_HOME:-$HOME/.rubberduck}/token"
TOKEN=$(cat "$TOKEN_FILE" 2>/dev/null)

curl -s -X POST "$URL/events" \
  -H 'Content-Type: application/json' \
  -H "X-Rubberduck-Token: $TOKEN" \
  -d "$PAYLOAD" >/dev/null 2>&1 &

exit 0
