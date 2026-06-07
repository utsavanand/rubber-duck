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
  session_name?: string;
  lifecycle?: string;
  branch?: string;
  parent_session_key?: string;
}

export type SessionState = "idle" | "busy" | "waiting" | "terminated";

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
  name?: string | null;
  notes?: string | null;
}

export function viewFromPersisted(s: PersistedSession): SessionView {
  return {
    key: s.session_key,
    label: s.name || s.source_app || s.session_key.slice(0, 8),
    state: s.state,
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
    repoName: s.repo_path
      ? s.repo_path.split("/").filter(Boolean).pop()
      : undefined,
    worktreePath: s.worktree_path ?? undefined,
    parentKey: s.parent_session_key ?? undefined,
    notes: s.notes ?? undefined,
  };
}

export function sessionKeyOf(e: RubberduckEvent): string | undefined {
  return e.session_key ?? e.uvs_session_id ?? e.session_id;
}
