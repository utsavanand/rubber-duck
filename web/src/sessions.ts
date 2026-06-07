import {
  RubberduckEvent,
  SessionState,
  SessionView,
  repoNameFrom,
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
    case "PostToolUse":
    case "UserPromptSubmit":
    case "SessionStart":
      // PostToolUse means a tool just finished — the agent is still mid-turn and
      // about to do more. Only `Stop` (turn ended) drops it to idle. Treating
      // PostToolUse as idle made sessions flap busy↔idle on every tool call.
      return "busy";
    case "Stop":
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
    // Preserve fields seeded from /sessions (metrics, intention, repoName, …);
    // only overwrite what this event actually carries.
    ...prev,
    key,
    // A user-set name always wins; otherwise keep the seeded label, else derive.
    label:
      e.name ||
      prev?.label ||
      e.session_name ||
      e.source_app ||
      key.slice(0, 8),
    state: deriveState(e, prev?.state),
    lastEventType: e.event_type ?? prev?.lastEventType ?? "",
    lastTool: e.tool_name ?? prev?.lastTool,
    // Don't let a live event without these fields overwrite the seeded values.
    cwd: prev?.cwd ?? e.cwd,
    branch: prev?.branch ?? e.branch,
    repoName: prev?.repoName ?? repoNameFrom(e.repo_path, e.source_app),
    worktreePath: prev?.worktreePath ?? e.worktree_path,
    parentKey: prev?.parentKey ?? e.parent_session_key,
    startedAt: prev?.startedAt ?? e._ts,
    updatedAt: e._ts,
    eventCount: (prev?.eventCount ?? 0) + 1,
  });
  return next;
}

export function applyAll(events: RubberduckEvent[]): Map<string, SessionView> {
  return events.reduce(applyEvent, new Map<string, SessionView>());
}
