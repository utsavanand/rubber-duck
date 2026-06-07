#!/bin/bash
# UV Suite Hook: Fast deterministic slop check
# Event: PostToolUse (Edit|Write)
# Greps for mechanical, unambiguous slop patterns. No LLM, no false positives.

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [ -z "$FILE_PATH" ] || [ ! -f "$FILE_PATH" ]; then
  exit 0
fi

EXT="${FILE_PATH##*.}"
FINDINGS=""

case "$EXT" in
  ts|tsx|js|jsx)
    # toBeTruthy/toBeDefined in test files
    if echo "$FILE_PATH" | grep -qE "\.(test|spec)\.(ts|tsx|js|jsx)$"; then
      MATCH=$(grep -n "\.toBeTruthy()\|\.toBeDefined()" "$FILE_PATH" 2>/dev/null)
      if [ -n "$MATCH" ]; then
        FINDINGS="${FINDINGS}Weak assertion in $FILE_PATH: $MATCH. Test specific values instead. "
      fi
    fi
    # catch-and-rethrow (catch { ...throw } with nothing meaningful between)
    MATCH=$(grep -n "catch.*{" "$FILE_PATH" 2>/dev/null | head -3)
    ;;
  py)
    # bare except: pass
    MATCH=$(grep -n "except:$\|except Exception:$" "$FILE_PATH" 2>/dev/null)
    if [ -n "$MATCH" ]; then
      NEXT=$(grep -A1 "except" "$FILE_PATH" 2>/dev/null | grep -c "pass\|raise")
      if [ "$NEXT" -gt 0 ]; then
        FINDINGS="${FINDINGS}Bare except with pass/raise in $FILE_PATH. "
      fi
    fi
    ;;
esac

if [ -n "$FINDINGS" ]; then
  cat <<EOF
{
  "continue": true,
  "systemMessage": "Slop detected: ${FINDINGS}"
}
EOF
fi

exit 0
