export interface RubberduckEvent {
  _id: string;
  _ts: number;
  event_type?: string;
  session_key?: string;
  session_id?: string;
  uvs_session_id?: string;
  source_app?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  prompt?: string;
  session_name?: string;
  name?: string;
  lifecycle?: string;
  branch?: string;
  repo_path?: string;
  worktree_path?: string;
  parent_session_key?: string;
  launched?: boolean;
  runtime?: string;
}

export type SessionState =
  | "idle"
  | "busy"
  | "waiting"
  | "terminated"
  | "stopped"
  | "archived";

export interface SessionView {
  key: string;
  label: string;
  state: SessionState;
  lastEventType: string;
  lastTool?: string;
  cwd?: string;
  startedAt: number;
  updatedAt: number;
  eventCount: number;
  metrics?: Record<string, number>;
  intention?: string;
  outcome?: string;
  compareGroup?: string;
  runtime?: string;
  branch?: string;
  repoName?: string; // git repo basename, when the session is on a repo
  worktreePath?: string; // set only when the session runs in a Rubberduck worktree
  parentKey?: string; // session this was forked from, if any
  notes?: string; // personal, local-only notes
  idleSince?: number; // ts of the last Stop; drives the idle settling grace
  launched?: boolean; // true if Rubberduck launched it (owns the tab); else watched
  group?: string; // folder label for organizing the left panel; undefined = ungrouped
}

/** A persisted session row from GET /sessions (SQLite, snake_case). */
export interface PersistedSession {
  session_key: string;
  state: SessionState;
  source_app?: string | null;
  cwd?: string | null;
  last_event_type?: string | null;
  last_tool?: string | null;
  event_count: number;
  started_at: number;
  updated_at: number;
  ended_at?: number | null;
  metrics?: Record<string, number>;
  intention?: string | null;
  outcome_summary?: string | null;
  compare_group?: string | null;
  runtime?: string | null;
  branch?: string | null;
  repo_path?: string | null;
  worktree_path?: string | null;
  parent_session_key?: string | null;
  launched?: number | null; // 1 if Rubberduck launched the session (authoritative)
  heartbeat?: number | null; // 1 if a launched tab is heartbeat-tracked (legacy)
  name?: string | null;
  notes?: string | null;
  grp?: string | null;
}

// The repo label for a card. repo_path's basename is the repo name for a plain
// checkout, but for a Rubberduck worktree it's the branch key (…/worktrees/
// <repo>/<branch>) — there, the server's source_app holds the real repo name.
export function repoNameFrom(
  repoPath?: string | null,
  sourceApp?: string | null,
): string | undefined {
  if (repoPath && repoPath.includes("/.rubberduck/worktrees/"))
    return sourceApp ?? undefined;
  if (repoPath) return repoPath.split("/").filter(Boolean).pop();
  return sourceApp ?? undefined;
}

export function viewFromPersisted(s: PersistedSession): SessionView {
  return {
    key: s.session_key,
    label: s.name || s.source_app || s.session_key.slice(0, 8),
    // Server already settled this row's state; if it's idle, backdate idleSince
    // so effectiveState shows idle immediately rather than after a fresh grace.
    state: s.state === "idle" ? "busy" : s.state,
    idleSince: s.state === "idle" ? 0 : undefined,
    lastEventType: s.last_event_type ?? "",
    lastTool: s.last_tool ?? undefined,
    cwd: s.cwd ?? undefined,
    startedAt: s.started_at,
    updatedAt: s.updated_at,
    eventCount: s.event_count,
    metrics: s.metrics,
    intention: s.intention ?? undefined,
    outcome: s.outcome_summary ?? undefined,
    compareGroup: s.compare_group ?? undefined,
    runtime: s.runtime ?? undefined,
    branch: s.branch ?? undefined,
    repoName: repoNameFrom(s.repo_path, s.source_app),
    worktreePath: s.worktree_path ?? undefined,
    // The `launched` column is authoritative; fall back to the legacy heartbeat
    // flag for rows created before the column existed.
    launched: s.launched === 1 || s.heartbeat === 1,
    parentKey: s.parent_session_key ?? undefined,
    notes: s.notes ?? undefined,
    group: s.grp ?? undefined,
  };
}

export function sessionKeyOf(e: RubberduckEvent): string | undefined {
  return e.session_key ?? e.uvs_session_id ?? e.session_id;
}
