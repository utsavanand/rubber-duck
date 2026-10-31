import { validateEmail } from "./email.ts";
import type { MailboxResult } from "./mailbox.ts";
import { publicDownload, type DownloadEdition } from "./download-link.ts";

export type CodeDownloadConfig = { allowedOrigin: string; timeoutMs?: number };
export type CodeDownloadDependencies = {
  rateLimit(request: Request, normalizedEmail: string): Promise<{ allowed: boolean; retryAfterSeconds?: number }>;
  lookupMailbox(domain: string): Promise<MailboxResult>;
  sendMail(message: { to: string; edition: DownloadEdition }, signal?: AbortSignal): Promise<{ accepted: boolean }>;
};

const MAX_BODY_BYTES = 4096;
const UNAVAILABLE = "We couldn't send the download link. Please try again shortly.";
function json(status: number, body: object, extraHeaders: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...extraHeaders } });
}
function failure(status: number, error: string, extraHeaders?: Record<string, string>): Response {
  return json(status, { ok: false, error }, extraHeaders);
}
function unavailable(): Response { return failure(503, UNAVAILABLE, { "Retry-After": "60" }); }

function configuredOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    const localHTTP = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((!localHTTP && url.protocol !== "https:") || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch { return null; }
}

class BodyError extends Error {
  status: number;
  constructor(status: number) { super("Invalid request body"); this.status = status; }
}

async function beforeDeadline<T>(action: () => Promise<T>, deadline: number, signal: AbortSignal): Promise<T> {
  if (signal.aborted || Date.now() >= deadline) throw new Error("Request deadline exceeded");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: () => void = () => {};
  try {
    const stopped = new Promise<never>((_, reject) => {
      onAbort = () => reject(new Error("Request stopped"));
      timer = setTimeout(onAbort, Math.max(1, deadline - Date.now()));
      signal.addEventListener("abort", onAbort, { once: true });
    });
    return await Promise.race([action(), stopped]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}

async function readBody(request: Request, deadline: number, signal: AbortSignal): Promise<unknown> {
  const length = request.headers.get("content-length");
  if (length !== null) {
    if (!/^\d+$/.test(length)) throw new BodyError(400);
    if (Number(length) > MAX_BODY_BYTES) throw new BodyError(413);
  }
  if (!request.body) throw new BodyError(400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await beforeDeadline(() => reader.read(), deadline, signal);
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        void reader.cancel().catch(() => {});
        throw new BodyError(413);
      }
      chunks.push(value);
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new BodyError(400); }
}

// Import this Node-only core from the API route. Infrastructure adapters own
// trusted IP extraction, persistent limits, provider calls and timeouts.
export function createCodeDownloadHandler(config: CodeDownloadConfig, dependencies: CodeDownloadDependencies): (request: Request) => Promise<Response> {
  return async request => {
    const duration = Number.isFinite(config.timeoutMs) ? Math.max(1, Math.min(24000, config.timeoutMs!)) : 24000;
    const deadline = Date.now() + duration;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), duration);
    const signal = AbortSignal.any([request.signal, controller.signal]);
    const run = <T>(action: () => Promise<T>) => beforeDeadline(action, deadline, signal);
    try {
      if (request.method !== "POST") return failure(405, "Use POST for this request.", { Allow: "POST" });
      const origin = configuredOrigin(config?.allowedOrigin);
      if (!origin || !dependencies || ["rateLimit", "lookupMailbox", "sendMail"].some(key => typeof dependencies[key as keyof CodeDownloadDependencies] !== "function")) return unavailable();
      if (request.headers.get("origin") !== origin || new URL(request.url).origin !== origin || request.headers.get("sec-fetch-site") !== "same-origin") return failure(403, "This request is not allowed.");
      if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json" || ![null, "identity"].includes(request.headers.get("content-encoding"))) return failure(415, "Send this request as JSON.");

      let body: unknown;
      try { body = await readBody(request, Math.min(deadline, Date.now() + 2000), signal); }
      catch (error) { return failure(error instanceof BodyError ? error.status : 400, error instanceof BodyError && error.status === 413 ? "This request is too large." : "This request is invalid."); }
      if (!body || typeof body !== "object" || Array.isArray(body)) return failure(400, "This request is invalid.");
      const fields = body as Record<string, unknown>;
      if (Object.keys(fields).some(key => key !== "email" && key !== "website" && key !== "edition") || (fields.website !== undefined && fields.website !== "")) return failure(400, "This request is invalid.");
      // Preserve the original Code form contract while allowing an explicit
      // Full selection. The allowlist also rejects objects/prototype keys.
      const download = publicDownload(fields.edition === undefined ? "code" : fields.edition);
      if (!download) return failure(400, "This request is invalid.");
      const email = validateEmail(fields.email);
      if (!email.valid) return failure(400, "Enter a valid email address.");

      try {
        // Charge before DNS or sending, including repeated invalid domains.
        // Edition is deliberately absent from the shared quota identity.
        const limit = await run(() => dependencies.rateLimit(request, email.email));
        if (!limit || typeof limit.allowed !== "boolean") return unavailable();
        if (!limit.allowed) {
          const retry = Number.isFinite(limit.retryAfterSeconds) ? Math.max(1, Math.min(86400, Math.ceil(limit.retryAfterSeconds!))) : 60;
          return failure(429, "Too many requests. Please try again later.", { "Retry-After": String(retry) });
        }
        const mailbox = await run(() => dependencies.lookupMailbox(email.domain));
        if (mailbox?.status === "invalid") return failure(400, "Enter a valid email address.");
        if (mailbox?.status !== "valid") return unavailable();
        const delivery = await run(() => dependencies.sendMail({ to: email.email, edition: download.edition }, signal));
        if (delivery?.accepted !== true) return unavailable();
        return json(200, { ok: true, message: "Check your inbox for the download link." });
      } catch {
        // Dependency errors may contain addresses, provider credentials or signed
        // URLs. Do not log or serialize them into the browser response.
        return unavailable();
      }
    } finally { controller.abort(); clearTimeout(timer); }
  };
}
