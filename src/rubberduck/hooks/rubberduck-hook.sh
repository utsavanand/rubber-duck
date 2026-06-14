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

# Rubberduck spawns agents itself for internal work (e.g. `claude -p` to write a
# checkpoint summary). Those subprocesses inherit these hooks and would report a
# phantom session back into Rubberduck. RUBBERDUCK_INTERNAL=1 marks such a
# subprocess so its hooks no-op.
if [ -n "${RUBBERDUCK_INTERNAL:-}" ]; then
  exit 0
fi

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
    --arg etype "$EVENT_TYPE" --arg skey "$SESSION_KEY" --arg rt "$RUNTIME" \
    --argjson apid "$PPID" '
    {
      event_type: $etype,
      session_key: (if $skey == "" then null else $skey end),
      session_id: (.session_id // .sessionId),
      cwd: .cwd,
      source_app: ((.cwd // "") | split("/") | last),
      tool_name: (.tool_name // .toolName),
      tool_input: (.tool_input // .toolInput),
      prompt: .prompt,
      runtime: $rt,
      agent_pid: $apid
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
  PAYLOAD=$(printf '{"event_type":"%s",%s%s"session_id":"%s","cwd":"%s","source_app":"%s","tool_name":"%s","runtime":"%s","agent_pid":%s}' \
    "$EVENT_TYPE" "$SKEY_FIELD" "$PROMPT_FIELD" "$SID" "$CWD" "$APP" "$TOOL" "$RUNTIME" "$PPID")
fi

# The server writes a per-install secret to this file (0600). We read it and
# send it as a header so the server accepts our /events POST — same machine,
# same user, so the file is readable. Missing file => empty token => the post is
# rejected, which is correct (no server, or a server that predates the token).
TOKEN_FILE="${RUBBERDUCK_HOME:-$HOME/.rubberduck}/token"
TOKEN=$(cat "$TOKEN_FILE" 2>/dev/null)

# Record the event in the timeline (fire-and-forget) regardless of type.
curl -s -X POST "$URL/events" \
  -H 'Content-Type: application/json' \
  -H "X-Rubberduck-Token: $TOKEN" \
  -d "$PAYLOAD" >/dev/null 2>&1 &

# ── Blocking approval ────────────────────────────────────────────────────────
# For a pre-exec permission event on a harness that can route approval (Claude's
# PermissionRequest, Copilot's preToolUse), register the request and block until
# the dashboard answers — then emit the harness's decision JSON. This makes the
# dashboard the approval authority. Fail OPEN: on any error/timeout we print
# nothing (the agent falls through to its own inline prompt), so a missing or
# slow Rubberduck never wedges the agent.
case "$EVENT_TYPE" in
  PermissionRequest|preToolUse) ;;
  *) exit 0 ;;
esac
# AskUserQuestion isn't a tool-permission gate — it's the agent asking YOU a
# multiple-choice question. The dashboard can't answer it with allow/deny (the
# agent needs an option), so don't route it: fall through to the terminal prompt
# where the choices render and you actually answer.
case "$PAYLOAD" in *'"tool_name":"AskUserQuestion"'*) exit 0 ;; esac
[ -z "$TOKEN" ] && exit 0  # no server/token -> fall through to the agent's prompt

# Register the request; get an id to poll. (jq required for the blocking path;
# without it we just fall through.)
command -v jq >/dev/null 2>&1 || exit 0
RID=$(printf '%s' "$PAYLOAD" | curl -s -m 5 -X POST "$URL/approvals" \
  -H 'Content-Type: application/json' -H "X-Rubberduck-Token: $TOKEN" \
  -d @- 2>/dev/null | jq -r '.id // empty')
[ -z "$RID" ] && exit 0

# Long-poll for the decision. Cap total wait so the agent isn't blocked forever
# if you never answer (then fall through to its own prompt). ~3 minutes.
DEADLINE=$(( $(date +%s) + 180 ))
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  STATUS=$(curl -s -m 5 "$URL/approvals/$RID/decision" \
    -H "X-Rubberduck-Token: $TOKEN" 2>/dev/null | jq -r '.status // "gone"')
  case "$STATUS" in
    approve)
      # Per-harness allow shape.
      if [ "$RUNTIME" = "copilot" ]; then
        printf '{"permissionDecision":"allow"}'
      else
        printf '{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}'
      fi
      exit 0
      ;;
    deny)
      if [ "$RUNTIME" = "copilot" ]; then
        printf '{"permissionDecision":"deny"}'
      else
        printf '{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"deny"}}}'
      fi
      exit 0
      ;;
    gone)
      exit 0  # request cleared -> fall through to the agent's own prompt
      ;;
    *)
      sleep 1  # pending
      ;;
  esac
done
exit 0  # timed out -> fall through to the agent's own prompt
