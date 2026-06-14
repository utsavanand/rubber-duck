import {
  RubberduckEvent,
  SessionState,
  SessionView,
  repoNameFrom,
  sessionKeyOf,
} from "./types";

// After a Stop, a session keeps reading "busy" for this long before settling to
// idle — so a session in active back-and-forth doesn't read idle between turns.
export const IDLE_SETTLE_MS = 5 * 60_000;

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
      // Stays busy now; effectiveState() flips it to idle after the settle grace.
      return "busy";
    default:
      return prev ?? "busy";
  }
}

/** The state to display/filter on, applying the post-Stop settling grace. */
export function effectiveState(s: SessionView, now: number): SessionState {
  if (s.state === "terminated" || s.state === "waiting") return s.state;
  if (s.idleSince !== undefined && now - s.idleSince >= IDLE_SETTLE_MS)
    return "idle";
  return s.state;
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
    // Stamp when the agent stopped; clear it on any new activity. effectiveState
    // uses this to settle to idle only after a quiet grace period.
    idleSince:
      e.event_type === "Stop"
        ? e._ts
        : e.event_type === "SessionEnd"
          ? prev?.idleSince
          : undefined,
    lastEventType: e.event_type ?? prev?.lastEventType ?? "",
    lastTool: e.tool_name ?? prev?.lastTool,
    // Don't let a live event without these fields overwrite the seeded values.
    cwd: prev?.cwd ?? e.cwd,
    branch: prev?.branch ?? e.branch,
    // Keep the runtime once known: a session born from a live event (a launched
    // session's SessionStart) must capture it, or the conversation-fork option
    // (gated on runtime === "claude-code") stays disabled.
    runtime: prev?.runtime ?? e.runtime,
    repoName: prev?.repoName ?? repoNameFrom(e.repo_path, e.source_app),
    worktreePath: prev?.worktreePath ?? e.worktree_path,
    parentKey: prev?.parentKey ?? e.parent_session_key,
    // Sticky: once a session is known launched, stay launched — a later watched
    // hook event for the same key can't downgrade it.
    launched: prev?.launched || e.launched === true,
    startedAt: prev?.startedAt ?? e._ts,
    updatedAt: e._ts,
    eventCount: (prev?.eventCount ?? 0) + 1,
  });
  return next;
}

export function applyAll(events: RubberduckEvent[]): Map<string, SessionView> {
  return events.reduce(applyEvent, new Map<string, SessionView>());
}
