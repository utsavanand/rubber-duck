---
name: confirm
description: >
  Toggle confirm-mode (reframe-and-confirm long prompts) or change the word threshold.
  When confirm-mode is on and a user prompt exceeds the threshold, the assistant will
  restate the request and wait for confirmation before doing any work.
argument-hint: "[on|off|<number>|status]"
user-invocable: true
allowed-tools:
  - Bash(mkdir *)
  - Bash(echo *)
  - Bash(cat *)
  - Bash(printf *)
---

## Apply /confirm $ARGUMENTS

!`STATE_DIR="${CLAUDE_PROJECT_DIR:-.}/.uv-suite-state"; mkdir -p "$STATE_DIR"; MODE_FILE="$STATE_DIR/confirm-mode.txt"; THRESH_FILE="$STATE_DIR/confirm-threshold.txt"; ARG=$(printf '%s' "$ARGUMENTS" | tr -d '[:space:]'); current_mode() { cat "$MODE_FILE" 2>/dev/null || echo "on"; }; current_thresh() { cat "$THRESH_FILE" 2>/dev/null || echo "50"; }; case "$ARG" in on) echo "on" > "$MODE_FILE"; echo "Confirm mode: ON (threshold: $(current_thresh) words)";; off) echo "off" > "$MODE_FILE"; echo "Confirm mode: OFF";; ''|status) echo "Confirm mode: $(current_mode) (threshold: $(current_thresh) words)";; *) if printf '%s' "$ARG" | grep -qE '^[0-9]+$'; then echo "$ARG" > "$THRESH_FILE"; echo "Threshold set to $ARG words (mode: $(current_mode))"; else echo "Usage: /confirm [on | off | <number> | status]"; fi;; esac`

## Instructions

Show the user the line of output above as the response — that line is the confirmation
that the toggle took effect. Do not add commentary. The change applies to the very
next user prompt; no restart needed.

## What this controls

- `on` / `off` — enable or disable the reframe-and-confirm behavior driven by
  `hooks/confirm-prompt.sh` on every UserPromptSubmit event.
- `<number>` — set the word-count threshold above which prompts trigger a confirmation
  step. Slash commands (`/foo ...`) are always exempt.
- `status` (or no argument) — print the current mode and threshold.

State lives in `${CLAUDE_PROJECT_DIR}/.uv-suite-state/confirm-mode.txt` and
`confirm-threshold.txt`. Defaults if missing: mode `on`, threshold `50`.
