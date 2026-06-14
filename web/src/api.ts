// Thin wrapper over the Rubberduck server. Every POST action the backend
// exposes lives here so components never hand-roll fetches.

// The per-install secret, injected into index.html by the server. Sent on every
// state-changing request so the server can tell the real dashboard from a
// cross-origin forgery. Read once at module load.
const TOKEN =
  document
    .querySelector('meta[name="rubberduck-token"]')
    ?.getAttribute("content") ?? "";

export function authHeaders(extra?: Record<string, string>): HeadersInit {
  return { "X-Rubberduck-Token": TOKEN, ...extra };
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
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
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export interface LaunchRequest {
  command: string;
  runtime?: "generic" | "claude-code" | "codex";
  repo_path?: string;
  cwd?: string;
  branch?: string;
  base?: string;
  prompt?: string;
  session_key?: string;
  name?: string;
  notes?: string;
  terminal?: string;
  in_terminal?: boolean;
}

export interface BrowseEntry {
  name: string;
  path: string;
  is_git: boolean;
}
export interface BrowseResult {
  path: string;
  parent: string | null;
  is_git: boolean;
  entries: BrowseEntry[];
}

export interface CompareVariant {
  runtime: "generic" | "claude-code" | "codex";
  command: string;
}

export const api = {
  launch: (req: LaunchRequest) =>
    post<{ session_key: string; opened_in_terminal?: boolean }>(
      "/sessions/launch",
      req,
    ),
  browse: (path?: string) =>
    get<BrowseResult>(
      `/browse${path ? `?path=${encodeURIComponent(path)}` : ""}`,
    ),
  branches: (path: string) =>
    get<{ branches: string[] }>(`/branches?path=${encodeURIComponent(path)}`),
  promote: (key: string, opts: { branch?: string; base?: string }) =>
    post<{ worktree: string; branch: string }>(
      `/sessions/${key}/promote`,
      opts,
    ),
  updateSession: (key: string, meta: { name?: string; notes?: string }) =>
    fetch(`/sessions/${key}`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(meta),
    }).then((r) => r.json()),
  getSession: (key: string) =>
    get<{ notes?: string | null; name?: string | null }>(`/sessions/${key}`),
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
  remove: (key: string, force = false) =>
    fetch(`/sessions/${key}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force }),
    }).then(async (r) => ({
      status: r.status,
      ...((await r.json()) as {
        deleted?: boolean;
        unmerged_commits?: number;
        branch?: string | null;
      }),
    })),
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
    get<{ events: RawEvent[] }>(`/sessions/${key}/events`),
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
