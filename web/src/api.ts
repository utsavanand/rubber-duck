// Thin wrapper over the Rubberduck server. Every POST action the backend
// exposes lives here so components never hand-roll fetches.

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      (data as { error?: string }).error ?? `${res.status} ${res.statusText}`,
    );
  }
  return data as T;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export interface LaunchRequest {
  command: string;
  runtime?: "generic" | "claude-code" | "codex";
  repo_path?: string;
  cwd?: string;
  branch?: string;
  prompt?: string;
  session_key?: string;
}

export interface CompareVariant {
  runtime: "generic" | "claude-code" | "codex";
  command: string;
}

export const api = {
  launch: (req: LaunchRequest) =>
    post<{ session_key: string }>("/sessions/launch", req),
  fork: (
    key: string,
    opts: {
      command?: string;
      branch?: string;
      terminal?: string;
      in_terminal?: boolean;
    },
  ) =>
    post<{
      opened_in_terminal?: boolean;
      worktree?: string;
      branch?: string;
      command?: string;
    }>(`/sessions/${key}/fork`, opts),
  forkConversation: (key: string, terminal?: string) =>
    post<{ opened_in_terminal: boolean; command: string; cwd: string }>(
      `/sessions/${key}/fork-conversation`,
      { terminal },
    ),
  terminals: () => get<{ terminals: string[] }>("/terminals"),
  stop: (key: string) => post<{ stopped: boolean }>(`/sessions/${key}/stop`),
  remove: (key: string) =>
    fetch(`/sessions/${key}`, { method: "DELETE" }).then((r) => r.json()),
  clearTerminated: () =>
    post<{ cleared: number }>("/sessions/clear-terminated"),
  checkpoint: (key: string, label: string) =>
    post<{ id: string; label: string; summary: string }>(
      `/sessions/${key}/checkpoint`,
      { label },
    ),
  checkpoints: (key: string) =>
    get<{ checkpoints: CheckpointRecord[] }>(`/sessions/${key}/checkpoints`),
  spotlight: (key: string) =>
    post<{ synced_files: string[] }>(`/sessions/${key}/spotlight`),
  compare: (req: {
    repo_path: string;
    prompt: string;
    variants: CompareVariant[];
  }) =>
    post<{ group: string; session_keys: string[] }>("/sessions/compare", req),
  snapshot: () => post<{ id: string }>("/snapshots"),
  snapshots: () =>
    get<{ snapshots: { id: string; created_at: number }[] }>("/snapshots"),
  restore: (snapshotId: string, key: string) =>
    post<{ command: string }>(
      `/snapshots/${snapshotId}/sessions/${key}/restore`,
    ),
  sessionEvents: (key: string) =>
    get<{ events: RawEvent[] }>("/events").then((d) => ({
      events: d.events.filter((e) => sessionKeyOf(e) === key),
    })),
};

interface RawEvent {
  _id: string;
  _ts: number;
  event_type?: string;
  session_key?: string;
  session_id?: string;
  uvs_session_id?: string;
  tool_name?: string;
}

export interface CheckpointRecord {
  id: string;
  label: string;
  summary: string;
  created_at: number;
  record: {
    intention?: string;
    prompts: string[];
    files: { path: string; edits: number }[];
    tools: { tool: string; count: number }[];
    event_count: number;
    git?: boolean;
    repo?: string;
    branch?: string;
  };
}

export type { RawEvent };

function sessionKeyOf(e: RawEvent): string | undefined {
  return e.session_key ?? e.uvs_session_id ?? e.session_id;
}
