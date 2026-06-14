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

// Seed a watched session straight through the events API (no terminal/agent) so
// fork/stop/delete have a real row to act on. Returns the key.
export async function seedSession(
  key: string,
  fields: Record<string, unknown> = {},
): Promise<string> {
  await api("/events", {
    method: "POST",
    body: JSON.stringify({
      event_type: "SessionStart",
      session_key: key,
      cwd: "/tmp/e2e",
      runtime: "claude-code",
      ...fields,
    }),
  });
  // SessionStart doesn't set the display name; PATCH it like the dashboard does.
  if (fields.name) {
    await api(`/sessions/${key}`, {
      method: "PATCH",
      body: JSON.stringify({ name: fields.name }),
    });
  }
  return key;
}
