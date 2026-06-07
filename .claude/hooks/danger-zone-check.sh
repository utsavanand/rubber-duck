#!/bin/bash
# UV Suite Hook: Check if a file being modified is in a danger zone
# Event: PreToolUse (Edit|Write)
# If the file appears in DANGER-ZONES.md, warns Claude via systemMessage.

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

DANGER_FILE="DANGER-ZONES.md"
if [ ! -f "$DANGER_FILE" ]; then
  # Check project root
  DANGER_FILE="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}/DANGER-ZONES.md"
fi

if [ ! -f "$DANGER_FILE" ]; then
  exit 0
fi

# Get just the filename/relative path to search for
BASENAME=$(basename "$FILE_PATH")
RELPATH=$(realpath --relative-to="${CLAUDE_PROJECT_DIR:-.}" "$FILE_PATH" 2>/dev/null || echo "$FILE_PATH")

# Search for the file in DANGER-ZONES.md
MATCH=$(grep -i "$BASENAME\|$RELPATH" "$DANGER_FILE" 2>/dev/null)

if [ -n "$MATCH" ]; then
  # File is in a danger zone — warn but don't block
  cat <<EOF
{
  "continue": true,
  "systemMessage": "WARNING: This file is in a DANGER ZONE. Check DANGER-ZONES.md before proceeding. Relevant entry:\n\n${MATCH}\n\nConsider flagging this modification to the human before continuing."
}
EOF
else
  echo '{"continue": true}'
fi

exit 0
