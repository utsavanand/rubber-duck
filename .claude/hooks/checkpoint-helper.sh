#!/bin/bash
# UV Suite helper: locate per-session checkpoint paths and print metadata.
# Used by the /checkpoint and /restore slash commands.
#
# Usage:
#   checkpoint-helper.sh dir       # ensure + print the dir for current session
#   checkpoint-helper.sh meta      # print session metadata as shell-eval'able lines
#   checkpoint-helper.sh frontmatter  # YAML frontmatter to embed at the top of a checkpoint
#   checkpoint-helper.sh latest    # cat the latest checkpoint for current session (with fallback)
#   checkpoint-helper.sh list      # list all sessions that have checkpoints, newest first

resolve_paths() {
  PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
  STATE_DIR="$PROJECT_DIR/.uv-suite-state"
  SID="${UVS_SESSION_ID:-}"
  if [ -z "$SID" ] && [ -f "$STATE_DIR/current-session.txt" ]; then
    SID=$(cat "$STATE_DIR/current-session.txt" 2>/dev/null)
  fi
  CHECKPOINTS_ROOT="$PROJECT_DIR/uv-out/checkpoints"
  SESSION_CP_DIR=""
  [ -n "$SID" ] && SESSION_CP_DIR="$CHECKPOINTS_ROOT/$SID"
  META_FILE=""
  [ -n "$SID" ] && META_FILE="$STATE_DIR/sessions/$SID.json"
}

print_meta_field() {
  # $1 = field name; reads from $META_FILE; empty if missing
  [ -z "$META_FILE" ] || [ ! -f "$META_FILE" ] && { echo ""; return; }
  if command -v jq >/dev/null 2>&1; then
    jq -r --arg k "$1" '.[$k] // ""' "$META_FILE" 2>/dev/null
  else
    grep -o "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" "$META_FILE" | head -1 | sed "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\(.*\)\"/\1/"
  fi
}

resolve_paths

case "$1" in
  dir)
    if [ -n "$SESSION_CP_DIR" ]; then
      mkdir -p "$SESSION_CP_DIR"
      echo "$SESSION_CP_DIR"
    else
      mkdir -p "$CHECKPOINTS_ROOT"
      echo "$CHECKPOINTS_ROOT"
    fi
    ;;
  meta)
    echo "uvs_session_id=${SID:-}"
    echo "session_name=$(print_meta_field name)"
    echo "session_kind=$(print_meta_field kind)"
    echo "session_purpose=$(print_meta_field purpose)"
    echo "session_priority=$(print_meta_field priority)"
    echo "persona=$(print_meta_field persona)"
    ;;
  frontmatter)
    NAME=$(print_meta_field name)
    KIND=$(print_meta_field kind)
    PURPOSE=$(print_meta_field purpose)
    PRIORITY=$(print_meta_field priority)
    PERSONA=$(print_meta_field persona)
    NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    cat <<EOF
---
uvs_session_id: ${SID:-}
session_name: ${NAME}
session_kind: ${KIND}
session_purpose: ${PURPOSE}
session_priority: ${PRIORITY}
persona: ${PERSONA}
checkpoint_at: ${NOW}
---
EOF
    ;;
  latest)
    if [ -n "$SESSION_CP_DIR" ] && [ -f "$SESSION_CP_DIR/latest.md" ]; then
      cat "$SESSION_CP_DIR/latest.md"
    elif [ -f "$CHECKPOINTS_ROOT/latest.md" ]; then
      echo "(no per-session checkpoint for ${SID:-this session}; showing legacy global latest.md)"
      echo
      cat "$CHECKPOINTS_ROOT/latest.md"
    else
      echo "No checkpoint found at $CHECKPOINTS_ROOT. Run /checkpoint to create one."
    fi
    ;;
  list)
    [ ! -d "$CHECKPOINTS_ROOT" ] && { echo "No checkpoints directory at $CHECKPOINTS_ROOT"; exit 0; }
    found=0
    for d in "$CHECKPOINTS_ROOT"/*/; do
      [ -d "$d" ] || continue
      cp_sid=$(basename "$d")
      cp_meta="$STATE_DIR/sessions/$cp_sid.json"
      cp_name=""
      cp_priority=""
      if [ -f "$cp_meta" ]; then
        if command -v jq >/dev/null 2>&1; then
          cp_name=$(jq -r '.name // ""' "$cp_meta" 2>/dev/null)
          cp_priority=$(jq -r '.priority // ""' "$cp_meta" 2>/dev/null)
        else
          cp_name=$(grep -o '"name"[[:space:]]*:[[:space:]]*"[^"]*"' "$cp_meta" | head -1 | sed 's/.*"name"[[:space:]]*:[[:space:]]*"\(.*\)"/\1/')
        fi
      fi
      latest=$(ls -t "$d"*.md 2>/dev/null | head -1)
      [ -z "$latest" ] && continue
      ts=$(stat -f '%Sm' -t '%Y-%m-%d %H:%M' "$latest" 2>/dev/null || stat -c '%y' "$latest" 2>/dev/null | cut -c1-16)
      label="${cp_name:-(unlabeled)}"
      [ -n "$cp_priority" ] && label="$label [p:$cp_priority]"
      mark=" "
      [ "$cp_sid" = "$SID" ] && mark="*"
      echo "$mark ${cp_sid:0:8}  $ts  $label"
      found=1
    done
    [ "$found" -eq 0 ] && echo "No per-session checkpoints yet (current session: ${SID:-none})"
    # Note legacy global checkpoint if present
    if [ -f "$CHECKPOINTS_ROOT/latest.md" ]; then
      ts=$(stat -f '%Sm' -t '%Y-%m-%d %H:%M' "$CHECKPOINTS_ROOT/latest.md" 2>/dev/null || stat -c '%y' "$CHECKPOINTS_ROOT/latest.md" 2>/dev/null | cut -c1-16)
      echo "  legacy   $ts  (pre-metadata global latest.md)"
    fi
    ;;
  *)
    echo "Usage: checkpoint-helper.sh [dir|meta|frontmatter|latest|list]"
    exit 1
    ;;
esac
