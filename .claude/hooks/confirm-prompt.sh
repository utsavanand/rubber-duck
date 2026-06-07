#!/bin/bash
# UV Suite Hook: Reframe-and-confirm long user prompts before acting.
#
# Reads state from $CLAUDE_PROJECT_DIR/.uv-suite-state/. When mode is "on" and
# the user's prompt exceeds the configured word count, injects a system-context
# instruction that tells Claude to restate the request and wait for confirmation
# before doing any work.
#
# State files (toggled by the /confirm slash command):
#   confirm-mode.txt       — "on" or "off"   (default: on)
#   confirm-threshold.txt  — integer         (default: 50)
#
# Slash commands (lines starting with "/") are always skipped so the toggle
# itself can run without being intercepted.

INPUT=$(cat)
STATE_DIR="${CLAUDE_PROJECT_DIR:-.}/.uv-suite-state"

MODE=$(cat "$STATE_DIR/confirm-mode.txt" 2>/dev/null)
[ -z "$MODE" ] && MODE="on"

THRESHOLD=$(cat "$STATE_DIR/confirm-threshold.txt" 2>/dev/null)
[ -z "$THRESHOLD" ] && THRESHOLD=50

[ "$MODE" = "off" ] && exit 0

if command -v jq >/dev/null 2>&1; then
  PROMPT=$(echo "$INPUT" | jq -r '.prompt // empty' 2>/dev/null)
else
  PROMPT=$(echo "$INPUT" | grep -o '"prompt":"[^"]*"' | head -1 | cut -d'"' -f4)
fi

[ -z "$PROMPT" ] && exit 0

case "$PROMPT" in
  /*) exit 0 ;;
esac

WORDS=$(echo "$PROMPT" | wc -w | tr -d ' ')
[ "$WORDS" -le "$THRESHOLD" ] && exit 0

# Emit Claude Code hook output. additionalContext is appended to the system
# context for this turn. The instructions below shape the *style* of the
# confirmation, not just whether one happens — the response should set
# context, break the ask into bullets, and end with an explicit invitation
# for the user to redirect before any work starts.
ADDITIONAL=$(printf '[uv-suite confirm-mode] The user prompt is %s words (threshold %s). Before any work or tool calls, write a confirmation in this exact shape:

1. Open with one short sentence that restates the goal in your own words — set the frame for what you think the user is asking for.
2. Then a bulleted breakdown (3-7 bullets, one line each) covering: concrete deliverables, the key decisions or assumptions you intend to make, and any open questions or scope choices the user might want to redirect.
3. End with a single explicit prompt: "Want me to change anything before I start, or should I go ahead?"

Do not propose implementation steps, write code, or call tools yet. The point is to confirm understanding so the user can correct course cheaply. Only proceed once the user confirms.

The user can disable this with /confirm off or change the threshold with /confirm <number>.' "$WORDS" "$THRESHOLD")

if command -v jq >/dev/null 2>&1; then
  jq -nc --arg ctx "$ADDITIONAL" '{hookSpecificOutput:{hookEventName:"UserPromptSubmit",additionalContext:$ctx}}'
else
  ESCAPED=$(printf '%s' "$ADDITIONAL" | sed 's/\\/\\\\/g; s/"/\\"/g')
  printf '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"%s"}}' "$ESCAPED"
fi
