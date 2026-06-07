#!/bin/bash
# UV Suite helper: read or write session metadata.
# Used by the /session-init slash command.
#
# Usage:
#   session-meta.sh show
#   session-meta.sh clear
#   session-meta.sh set-name     <free text...>
#   session-meta.sh set-kind     long|outcome
#   session-meta.sh set-purpose  <free text...>
#   session-meta.sh set-priority low|med|high
#
# Reads/writes .uv-suite-state/sessions/$UVS_SESSION_ID.json under
# $CLAUDE_PROJECT_DIR (falls back to current-session.txt pointer or a new
# ad-hoc session if neither is available).

STATE_DIR="${CLAUDE_PROJECT_DIR:-.}/.uv-suite-state"
SESSIONS_DIR="$STATE_DIR/sessions"
mkdir -p "$SESSIONS_DIR"

SID="${UVS_SESSION_ID:-}"
if [ -z "$SID" ] && [ -f "$STATE_DIR/current-session.txt" ]; then
  SID=$(cat "$STATE_DIR/current-session.txt" 2>/dev/null)
fi
if [ -z "$SID" ]; then
  SID="ad-hoc-$(date +%s)"
  echo "$SID" > "$STATE_DIR/current-session.txt"
fi

META="$SESSIONS_DIR/$SID.json"
if [ ! -f "$META" ]; then
  CWD_VAL="${CLAUDE_PROJECT_DIR:-$(pwd)}" SID_VAL="$SID" STARTED="$(date +%s)" python3 -c '
import json, os
print(json.dumps({
  "uvs_session_id": os.environ["SID_VAL"],
  "name": "", "kind": "", "purpose": "", "priority": "", "persona": "",
  "cwd": os.environ["CWD_VAL"],
  "started_at": int(os.environ["STARTED"]),
}, indent=2))
' > "$META"
fi

ACTION="$1"
shift || true

print_meta() {
  META_PATH="$META" python3 - <<'PY'
import json, os
d = json.load(open(os.environ["META_PATH"]))
sid = d.get("uvs_session_id", "")[:8]
name     = d.get("name", "") or "(unset)"
kind     = d.get("kind", "") or "(unset)"
purpose  = d.get("purpose", "") or "(unset)"
priority = d.get("priority", "") or "(unset)"
persona  = d.get("persona", "") or "(unset)"
print(f"session: {sid}")
print(f"  name:     {name}")
print(f"  kind:     {kind}")
print(f"  purpose:  {purpose}")
print(f"  priority: {priority}")
print(f"  persona:  {persona}")
PY
}

set_field() {
  FIELD="$1" VAL="$2" META_PATH="$META" python3 - <<'PY'
import json, os
p = os.environ["META_PATH"]
d = json.load(open(p))
field = os.environ["FIELD"]
d[field] = os.environ["VAL"]
json.dump(d, open(p, "w"), indent=2)
print(f"{field}: {d[field] or '(unset)'}")
PY
}

case "$ACTION" in
  ""|show)
    print_meta
    ;;
  clear)
    META_PATH="$META" python3 - <<'PY'
import json, os
p = os.environ["META_PATH"]
d = json.load(open(p))
for k in ("name", "kind", "purpose", "priority"):
    d[k] = ""
json.dump(d, open(p, "w"), indent=2)
print("Cleared name, kind, purpose, priority.")
PY
    ;;
  set-name)
    set_field "name" "$*"
    ;;
  set-kind)
    case "$1" in
      l|long|long-running) VAL="long-running" ;;
      o|outcome)           VAL="outcome" ;;
      "")                  VAL="" ;;
      *) echo "kind '$1' not recognized — use long or outcome"; exit 1 ;;
    esac
    set_field "kind" "$VAL"
    ;;
  set-purpose)
    set_field "purpose" "$*"
    ;;
  set-priority)
    case "$1" in
      l|low)        VAL="low" ;;
      m|med|medium) VAL="med" ;;
      h|high)       VAL="high" ;;
      "")           VAL="" ;;
      *) echo "priority '$1' not recognized — use low, med, or high"; exit 1 ;;
    esac
    set_field "priority" "$VAL"
    ;;
  *)
    echo "Usage: session-meta.sh [show|clear|set-name|set-kind|set-purpose|set-priority] [args]"
    exit 1
    ;;
esac
