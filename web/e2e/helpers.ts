import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Backend cross-check helpers: talk to the same `rubberduck serve` the UI does,
// so a test can verify a click actually changed server state (not just the DOM).

function state(): { home: string; port: string } {
  return JSON.parse(readFileSync(join(tmpdir(), "rd-e2e-state.json"), "utf8"));
}

export function base(): string {
  return `http://127.0.0.1:${state().port}`;
}

function token(): string {
  return readFileSync(join(state().home, "token"), "utf8").trim();
}

async function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${base()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Rubberduck-Token": token(),
      ...(init?.headers || {}),
    },
  });
}

// Authenticated POST (sends the install token the real dashboard sends), for
// cross-checking what a control endpoint returns. Returns status + parsed body.
export async function apiPost(
  path: string,
  body: Record<string, unknown> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await api(path, { method: "POST", body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

export interface SessionRow {
  session_key: string;
  name?: string | null;
  state: string;
  runtime?: string | null;
  launched?: number | null;
}

export async function sessions(): Promise<SessionRow[]> {
  const res = await fetch(`${base()}/sessions`);
  return (await res.json()).sessions;
}

export async function findSession(
  predicate: (s: SessionRow) => boolean,
): Promise<SessionRow | undefined> {
  return (await sessions()).find(predicate);
}

// Post a raw event for a session (e.g. UserPromptSubmit, PreToolUse) so a
// checkpoint has real prompts/commands to capture. Flagged test=1 so the
// session never counts as real data (the e2e server uses a throwaway home too).
export async function postEvent(event: Record<string, unknown>): Promise<void> {
  await api("/events", {
    method: "POST",
    body: JSON.stringify({ test: true, ...event }),
  });
}

// Seed a watched session straight through the events API (no terminal/agent) so
// fork/stop/delete have a real row to act on. Returns the key.
export async function seedSession(
  key: string,
  fields: Record<string, unknown> = {},
): Promise<string> {
  await postEvent({
    event_type: "SessionStart",
    session_key: key,
    cwd: "/tmp/e2e",
    runtime: "claude-code",
    ...fields,
  });
  // SessionStart doesn't set the display name or group; PATCH them like the
  // dashboard does.
  if (fields.name || fields.group) {
    await api(`/sessions/${key}`, {
      method: "PATCH",
      body: JSON.stringify({ name: fields.name, group: fields.group }),
    });
  }
  return key;
}

export interface Checkpoint {
  id: string;
  label: string;
  summary: string;
  record: {
    prompts: string[];
    commands: string[];
    tools: { tool: string; count: number }[];
    event_count: number;
  };
}

export async function checkpoints(key: string): Promise<Checkpoint[]> {
  const res = await fetch(`${base()}/sessions/${key}/checkpoints`);
  return (await res.json()).checkpoints;
}

export async function snapshotIds(): Promise<string[]> {
  const res = await fetch(`${base()}/snapshots`);
  return (await res.json()).snapshots.map((s: { id: string }) => s.id);
}
