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
}

export function viewFromPersisted(s: PersistedSession): SessionView {
  return {
    key: s.session_key,
    label: s.source_app || s.session_key.slice(0, 8),
    state: s.state,
    lastEventType: s.last_event_type ?? "",
    lastTool: s.last_tool ?? undefined,
    cwd: s.cwd ?? undefined,
    startedAt: s.started_at,
    updatedAt: s.updated_at,
    eventCount: s.event_count,
  };
}

export function sessionKeyOf(e: RubberduckEvent): string | undefined {
  return e.session_key ?? e.uvs_session_id ?? e.session_id;
}
