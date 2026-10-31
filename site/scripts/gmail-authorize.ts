import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { constants } from "node:fs";
import { open, lstat, realpath, link, unlink } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Google Desktop OAuth: https://developers.google.com/identity/protocols/oauth2/native-app
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REPOSITORY = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export class GmailAuthorizationError extends Error {}
const fail = (message: string): never => { throw new GmailAuthorizationError(message); };
type DesktopClient = { clientId: string; clientSecret: string };
export type AuthorizationOptions = {
  clientPath: string;
  outputPath: string;
  loginHint?: string;
  callbackTimeoutMs?: number;
  tokenTimeoutMs?: number;
  signal?: AbortSignal;
};
export type AuthorizationDependencies = { fetch: typeof fetch; print: (message: string) => void };

function boundedString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\s\x00-\x1f\x7f]/.test(value);
}

async function readClient(path: string): Promise<DesktopClient> {
  if (!isAbsolute(path)) return fail("Supply an absolute path to a Google Desktop OAuth client JSON file.");
  try {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      if (!(await file.stat()).isFile()) return fail("The client file must be a regular Google Desktop OAuth JSON file.");
      const buffer = Buffer.alloc(16385);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      if (bytesRead > 16384) return fail("The client JSON file is too large.");
      const client = JSON.parse(buffer.subarray(0, bytesRead).toString("utf8"))?.installed;
      if (!client || !boundedString(client.client_id, 512) || !client.client_id.endsWith(".apps.googleusercontent.com") || !boundedString(client.client_secret, 4096) ||
        (client.auth_uri !== undefined && client.auth_uri !== AUTH_URL && client.auth_uri !== "https://accounts.google.com/o/oauth2/auth") ||
        (client.token_uri !== undefined && client.token_uri !== TOKEN_URL)) return fail("Supply a valid Google Desktop OAuth client JSON file.");
      return { clientId: client.client_id, clientSecret: client.client_secret };
    } finally { await file.close(); }
  } catch (error) {
    if (error instanceof GmailAuthorizationError) throw error;
    return fail("The Google Desktop OAuth client JSON file could not be read.");
  }
}

async function privateDestination(path: string): Promise<string> {
  if (!isAbsolute(path)) return fail("Supply an absolute path for a new private credentials file.");
  try {
    const output = join(await realpath(dirname(path)), basename(path));
    const repo = await realpath(REPOSITORY);
    const inside = relative(repo, output);
    if (!inside || (!inside.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(inside))) return fail("Save credentials outside the project checkout.");
    try { await lstat(output); return fail("The output path already exists; choose a new private file."); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    return output;
  } catch (error) {
    if (error instanceof GmailAuthorizationError) throw error;
    return fail("The private output directory is unavailable.");
  }
}

function safeState(expected: string, actual: string | null): boolean {
  return actual !== null && Buffer.byteLength(actual) === Buffer.byteLength(expected) && timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

async function authorizeCode(client: DesktopClient, options: AuthorizationOptions, print: AuthorizationDependencies["print"]): Promise<{ code: string; verifier: string; redirectUri: string }> {
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  let redirectUri = "";
  let settled = false;
  let finish!: (error: Error | null, code?: string) => void;
  const callback = new Promise<string>((accept, reject) => {
    finish = (error, code) => { if (settled) return; settled = true; if (error) reject(error); else accept(code!); };
  });
  // A cancelled signal may settle while the listener is still being bound.
  void callback.catch(() => {});
  const server = createServer({ maxHeaderSize: 8192, requestTimeout: 5000, headersTimeout: 5000, keepAliveTimeout: 1000 }, (request, response) => {
    const reply = (status: number, text: string) => {
      response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'", Connection: "close" });
      response.end(text);
    };
    if (settled) return reply(409, "This authorization attempt has finished.");
    if (request.method !== "GET") return reply(405, "Use the authorization redirect from Google.");
    if (!request.url || request.url.length > 8192) return reply(400, "Authorization response not accepted.");
    let url: URL;
    try { url = new URL(request.url, redirectUri); }
    catch { return reply(400, "Authorization response not accepted."); }
    if (url.origin !== new URL(redirectUri).origin || request.headers.host !== new URL(redirectUri).host || url.pathname !== "/oauth2/callback") return reply(404, "Not found.");
    if (url.searchParams.getAll("state").length !== 1 || !safeState(state, url.searchParams.get("state"))) return reply(400, "Authorization response not accepted.");
    if (url.searchParams.has("error")) {
      reply(400, "Authorization was not granted. Return to the terminal.");
      return finish(new GmailAuthorizationError("Google authorization was not granted. No credentials were saved."));
    }
    const code = url.searchParams.get("code");
    if (url.searchParams.getAll("code").length !== 1 || !boundedString(code, 4096)) {
      reply(400, "Authorization response not accepted.");
      return finish(new GmailAuthorizationError("Google returned an invalid authorization response."));
    }
    reply(200, "Authorization received. Return to the terminal to finish saving credentials.");
    finish(null, code);
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const abort = () => finish(new GmailAuthorizationError("Authorization cancelled. No credentials were saved."));
  try {
    await new Promise<void>((accept, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", accept); });
    const address = server.address();
    if (!address || typeof address === "string") return fail("The local authorization callback could not start.");
    redirectUri = `http://127.0.0.1:${address.port}/oauth2/callback`;
    timer = setTimeout(() => finish(new GmailAuthorizationError("Authorization timed out. No credentials were saved.")), options.callbackTimeoutMs ?? 300000);
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    const url = new URL(AUTH_URL);
    url.search = new URLSearchParams({ client_id: client.clientId, redirect_uri: redirectUri, response_type: "code", scope: GMAIL_SEND_SCOPE, state,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", access_type: "offline", prompt: "consent", ...(options.loginHint ? { login_hint: options.loginHint } : {}) }).toString();
    if (!settled) { print("Open this URL in your browser to allow Gmail send-only access:"); print(url.href); }
    return { code: await callback, verifier, redirectUri };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
    await new Promise<void>(accept => { server.close(() => accept()); server.closeAllConnections(); });
  }
}

async function refreshToken(client: DesktopClient, grant: { code: string; verifier: string; redirectUri: string }, options: AuthorizationOptions, send: typeof fetch): Promise<string> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel!: () => void;
  const stopped = new Promise<never>((_, reject) => {
    const stop = () => { controller.abort(); reject(new GmailAuthorizationError("The token exchange did not complete. No credentials were saved.")); };
    timer = setTimeout(stop, options.tokenTimeoutMs ?? 15000);
    cancel = stop;
    options.signal?.addEventListener("abort", cancel, { once: true });
    if (options.signal?.aborted) stop();
  });
  try {
    return await Promise.race([stopped, (async () => {
      const response = await send(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: client.clientId, client_secret: client.clientSecret, code: grant.code, code_verifier: grant.verifier, redirect_uri: grant.redirectUri, grant_type: "authorization_code" }),
        signal: controller.signal, redirect: "error", cache: "no-store" });
      if (!response.ok || !response.body) return fail("Google did not complete the token exchange. No credentials were saved.");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read(); if (done) break;
          size += value.byteLength;
          if (size > 65536) { void reader.cancel().catch(() => {}); return fail("Google returned an invalid token response."); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      const token = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!boundedString(token.refresh_token, 8192) || !boundedString(token.access_token, 8192) || token.token_type !== "Bearer") return fail("Google did not return usable refresh credentials. No credentials were saved.");
      if (typeof token.scope !== "string" || token.scope.trim() !== GMAIL_SEND_SCOPE) return fail("Google did not grant exactly Gmail send-only access. No credentials were saved.");
      return token.refresh_token;
    })()]);
  } finally { clearTimeout(timer); options.signal?.removeEventListener("abort", cancel); controller.abort(); }
}

async function savePrivate(output: string, value: object): Promise<void> {
  const temporary = `${output}.pending-${randomBytes(16).toString("hex")}`;
  let created = false;
  try {
    const file = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    created = true;
    try { await file.chmod(0o600); await file.writeFile(JSON.stringify(value, null, 2) + "\n"); await file.sync(); }
    finally { await file.close(); }
    // link(2) publishes the complete private file without replacing anything.
    await link(temporary, output);
  } catch { return fail("The new private credentials file could not be saved; the selected output was not overwritten."); }
  finally { if (created) await unlink(temporary); }
}

export async function runGmailAuthorization(options: AuthorizationOptions, dependencies: AuthorizationDependencies = { fetch, print: message => console.log(message) }): Promise<void> {
  try {
    for (const [timeout, maximum] of [[options.callbackTimeoutMs, 600000], [options.tokenTimeoutMs, 60000]]) if (timeout !== undefined && (!Number.isInteger(timeout) || timeout < 1 || timeout > maximum!)) return fail("The authorization timeout is invalid.");
    if (options.loginHint !== undefined && (!boundedString(options.loginHint, 254) || !/^[^@]+@[^@]+\.[^@]+$/.test(options.loginHint))) return fail("The optional login hint must be an email address.");
    if (options.signal?.aborted) return fail("Authorization cancelled. No credentials were saved.");
    const output = await privateDestination(options.outputPath);
    const client = await readClient(options.clientPath);
    const grant = await authorizeCode(client, options, dependencies.print);
    const refresh = await refreshToken(client, grant, options, dependencies.fetch);
    if (options.signal?.aborted) return fail("Authorization cancelled. No credentials were saved.");
    await savePrivate(output, { ...client, refreshToken: refresh, scope: GMAIL_SEND_SCOPE });
    dependencies.print("Gmail send-only refresh credentials saved to the selected private file (mode 0600). No email was sent.");
  } catch (error) {
    if (error instanceof GmailAuthorizationError) throw error;
    return fail("Authorization could not be completed. No secret details were printed.");
  }
}

export function parseAuthorizationArguments(args: string[]): AuthorizationOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index], value = args[index + 1];
    if (!["--client", "--output", "--login-hint"].includes(name) || values.has(name) || !value || value.startsWith("--")) return fail("Usage: gmail-authorize --client /absolute/client.json --output /absolute/new-private.json [--login-hint sender@gmail.com]");
    values.set(name, value);
  }
  if (!values.has("--client") || !values.has("--output")) return fail("Usage: gmail-authorize --client /absolute/client.json --output /absolute/new-private.json [--login-hint sender@gmail.com]");
  return { clientPath: values.get("--client")!, outputPath: values.get("--output")!, ...(values.has("--login-hint") ? { loginHint: values.get("--login-hint")! } : {}) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try { await runGmailAuthorization({ ...parseAuthorizationArguments(process.argv.slice(2)), signal: controller.signal }); }
  catch (error) { console.error(error instanceof GmailAuthorizationError ? error.message : "Authorization could not be completed."); process.exitCode = 1; }
  finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
}
