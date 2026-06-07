import {
  RubberduckEvent,
  SessionState,
  SessionView,
  sessionKeyOf,
} from "./types";

function deriveState(e: RubberduckEvent, prev?: SessionState): SessionState {
  if (e.lifecycle === "terminated" || e.event_type === "SessionEnd")
    return "terminated";
  switch (e.event_type) {
    case "PermissionRequest":
    case "Notification":
      return "waiting";
    case "PreToolUse":
    case "UserPromptSubmit":
    case "SessionStart":
      return "busy";
    case "Stop":
    case "PostToolUse":
      return "idle";
    default:
      return prev ?? "busy";
  }
}

/** Fold an event into the session map. Pure; returns a new map. */
export function applyEvent(
  sessions: Map<string, SessionView>,
  e: RubberduckEvent,
): Map<string, SessionView> {
  const key = sessionKeyOf(e);
  if (!key) return sessions;

  const next = new Map(sessions);
  const prev = next.get(key);
  next.set(key, {
    key,
    label: e.session_name || e.source_app || key.slice(0, 8),
    state: deriveState(e, prev?.state),
    lastEventType: e.event_type ?? prev?.lastEventType ?? "",
    lastTool: e.tool_name ?? prev?.lastTool,
    cwd: e.cwd ?? prev?.cwd,
    startedAt: prev?.startedAt ?? e._ts,
    updatedAt: e._ts,
    eventCount: (prev?.eventCount ?? 0) + 1,
  });
  return next;
}

export function applyAll(events: RubberduckEvent[]): Map<string, SessionView> {
  return events.reduce(applyEvent, new Map<string, SessionView>());
}
