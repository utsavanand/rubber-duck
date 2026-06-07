#!/bin/bash
# UV Suite Hook: Fast deterministic doc-slop check
# Event: PostToolUse (Write) — Spike persona
# Greps for vague adjectives and buzzwords in documentation files. No LLM.

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [ -z "$FILE_PATH" ] || [ ! -f "$FILE_PATH" ]; then
  exit 0
fi

EXT="${FILE_PATH##*.}"

# Only check markdown and text files
case "$EXT" in
  md|txt|rst|adoc) ;;
  *) exit 0 ;;
esac

FINDINGS=""

# Vague adjectives that say nothing
MATCH=$(grep -in "robust\|scalable\|comprehensive\|extensible\|maintainable\|enterprise-grade\|battle-tested\|cutting-edge\|state-of-the-art" "$FILE_PATH" 2>/dev/null | head -3)
if [ -n "$MATCH" ]; then
  FINDINGS="${FINDINGS}Vague adjectives — replace with specific facts: $(echo "$MATCH" | head -1 | sed 's/"/\\"/g'). "
fi

# Evasive verbs
MATCH=$(grep -in "leverages\|utilizes\|facilitates\|empowers\|enables seamless" "$FILE_PATH" 2>/dev/null | head -3)
if [ -n "$MATCH" ]; then
  FINDINGS="${FINDINGS}Evasive verbs — say what it actually does: $(echo "$MATCH" | head -1 | sed 's/"/\\"/g'). "
fi

# Authority appeals without specifics
MATCH=$(grep -in "best practices\|industry-standard\|widely adopted\|production-ready" "$FILE_PATH" 2>/dev/null | head -3)
if [ -n "$MATCH" ]; then
  FINDINGS="${FINDINGS}Name the specific practice instead of citing authority: $(echo "$MATCH" | head -1 | sed 's/"/\\"/g'). "
fi

if [ -n "$FINDINGS" ]; then
  cat <<EOF
{
  "continue": true,
  "systemMessage": "Doc slop: ${FINDINGS}"
}
EOF
fi

exit 0
