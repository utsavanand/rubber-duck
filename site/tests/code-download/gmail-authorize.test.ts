import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, readFile, stat, readdir, rm, symlink, access } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test, type TestContext } from "node:test";
import { GMAIL_SEND_SCOPE, GmailAuthorizationError, parseAuthorizationArguments, runGmailAuthorization, type AuthorizationOptions } from "../../scripts/gmail-authorize.ts";

const CLIENT_ID = "synthetic-client.apps.googleusercontent.com";
const CLIENT_SECRET = "synthetic-client-secret-never-print";
const CODE = "synthetic-authorization-code-never-print";
const REFRESH = "synthetic-refresh-token-never-print";
const ACCESS = "synthetic-access-token-never-print";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const clientJson = { installed: { client_id: CLIENT_ID, client_secret: CLIENT_SECRET, auth_uri: "https://accounts.google.com/o/oauth2/auth", token_uri: TOKEN_URL, redirect_uris: ["http://localhost"] } };
const tokenJson = { access_token: ACCESS, refresh_token: REFRESH, token_type: "Bearer", scope: GMAIL_SEND_SCOPE };
const validToken = () => Response.json(tokenJson);

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "duckterm-gmail-oauth-test-"));
  const clientPath = join(directory, "synthetic-client.json");
  const outputPath = join(directory, "private-credentials.json");
  await writeFile(clientPath, JSON.stringify(clientJson), { mode: 0o600 });
  const controller = new AbortController();
  let completion: Promise<{ error?: unknown }> | undefined;
  t.after(async () => { controller.abort(); await completion; await rm(directory, { recursive: true, force: true }); });
  const messages: string[] = [];
  const auth = Promise.withResolvers<URL>();
  const start = (send: typeof fetch = async () => validToken(), overrides: Partial<AuthorizationOptions> = {}) => {
    completion = runGmailAuthorization({ clientPath, outputPath, callbackTimeoutMs: 2000, tokenTimeoutMs: 1000, signal: controller.signal, ...overrides }, {
      fetch: send,
      print: message => { messages.push(message); if (message.startsWith("https://accounts.google.com/")) auth.resolve(new URL(message)); },
    }).then(() => ({}), error => ({ error }));
    return {
      auth: Promise.race([auth.promise, completion.then(result => { throw result.error ?? new Error("Authorization finished before its URL was printed"); })]),
      completion,
    };
  };
  return { directory, clientPath, outputPath, controller, messages, start };
}

function callback(auth: URL, values: Record<string, string> = { code: CODE }): URL {
  const url = new URL(auth.searchParams.get("redirect_uri")!);
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.protocol, "http:");
  url.search = new URLSearchParams({ state: auth.searchParams.get("state")!, ...values }).toString();
  return url;
}

async function callLocal(url: URL, options: { method?: string; host?: string; path?: string } = {}): Promise<{ status: number; body: string; headers: Record<string, unknown> }> {
  assert.equal(url.hostname, "127.0.0.1", "Tests must never contact Google or any external host");
  return new Promise((accept, reject) => {
    const req = request({ hostname: "127.0.0.1", port: url.port, path: options.path ?? `${url.pathname}${url.search}`, method: options.method ?? "GET", headers: { Host: options.host ?? url.host }, timeout: 1000 }, response => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", data => { body += data; });
      response.on("end", () => accept({ status: response.statusCode!, body, headers: response.headers }));
      response.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("Local test callback timed out")));
    req.on("error", reject);
    req.end();
  });
}

function sanitized(error: unknown, messages: string[]) {
  assert.ok(error instanceof GmailAuthorizationError);
  const output = `${error.message}\n${messages.join("\n")}`;
  for (const secret of [CLIENT_SECRET, CODE, REFRESH, ACCESS, "provider-private-error"]) assert.equal(output.includes(secret), false, "No secret may appear in messages or errors");
}

async function missingFile(path: string) { await assert.rejects(access(path), { code: "ENOENT" }); }

test("CLI requires explicit, unique paths and accepts an optional login hint", () => {
  assert.deepEqual(parseAuthorizationArguments(["--client", "/private/client.json", "--output", "/private/new.json", "--login-hint", "sender+pilot@gmail.com"]), { clientPath: "/private/client.json", outputPath: "/private/new.json", loginHint: "sender+pilot@gmail.com" });
  for (const args of [[], ["--client", "/a"], ["--client", "/a", "--output", "/b", "--output", "/c"], ["--client", "/a", "--output"], ["--unknown", CLIENT_SECRET]]) assert.throws(() => parseAuthorizationArguments(args), error => { sanitized(error, []); return true; });
});

test("real local callback uses state and PKCE, exchanges only send scope, and atomically saves mode 0600 refresh credentials", async t => {
  const f = await fixture(t);
  let auth!: URL;
  let fetches = 0;
  const flow = f.start(async (url, options) => {
    fetches++;
    assert.equal(String(url), TOKEN_URL);
    assert.equal(options?.method, "POST");
    assert.equal(options?.redirect, "error");
    assert.equal(options?.cache, "no-store");
    assert.ok(options?.signal instanceof AbortSignal);
    const body = new URLSearchParams(String(options?.body));
    assert.equal(body.get("client_id"), CLIENT_ID);
    assert.equal(body.get("client_secret"), CLIENT_SECRET);
    assert.equal(body.get("code"), CODE);
    assert.equal(body.get("grant_type"), "authorization_code");
    assert.equal(body.get("redirect_uri"), auth.searchParams.get("redirect_uri"));
    const verifier = body.get("code_verifier")!;
    assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(createHash("sha256").update(verifier).digest("base64url"), auth.searchParams.get("code_challenge"));
    assert.notEqual(verifier, auth.searchParams.get("state"));
    return validToken();
  }, { loginHint: "sender+pilot@gmail.com" });
  auth = await flow.auth;
  assert.equal(auth.origin + auth.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(auth.searchParams.get("scope"), GMAIL_SEND_SCOPE);
  assert.equal(auth.searchParams.get("code_challenge_method"), "S256");
  assert.equal(auth.searchParams.get("access_type"), "offline");
  assert.equal(auth.searchParams.get("prompt"), "consent");
  assert.equal(auth.searchParams.get("response_type"), "code");
  assert.equal(auth.searchParams.get("login_hint"), "sender+pilot@gmail.com");
  assert.match(auth.searchParams.get("state")!, /^[A-Za-z0-9_-]{43}$/);
  const redirect = new URL(auth.searchParams.get("redirect_uri")!);
  assert.ok(Number(redirect.port) > 0);
  assert.equal(redirect.pathname, "/oauth2/callback");
  const wrongState = callback(auth, { code: CODE, state: "incorrect" });
  assert.equal((await callLocal(wrongState)).status, 400);
  assert.equal((await callLocal(callback(auth), { host: "evil.invalid" })).status, 404);
  assert.equal((await callLocal(callback(auth), { method: "POST" })).status, 405);
  assert.equal((await callLocal(callback(auth), { path: "http://[" })).status, 400);
  const duplicateState = callback(auth); duplicateState.searchParams.append("state", auth.searchParams.get("state")!);
  assert.equal((await callLocal(duplicateState)).status, 400);
  assert.equal(fetches, 0);
  const response = await callLocal(callback(auth));
  assert.equal(response.status, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.headers["referrer-policy"], "no-referrer");
  assert.equal(response.body.includes(CODE), false);
  assert.deepEqual(await flow.completion, {});
  assert.equal(fetches, 1);
  assert.deepEqual(JSON.parse(await readFile(f.outputPath, "utf8")), { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, refreshToken: REFRESH, scope: GMAIL_SEND_SCOPE });
  assert.equal((await stat(f.outputPath)).mode & 0o777, 0o600);
  assert.equal((await readdir(f.directory)).some(name => name.includes(".pending-")), false);
  for (const secret of [CLIENT_SECRET, CODE, REFRESH, ACCESS]) assert.equal(f.messages.join("\n").includes(secret), false);
  await assert.rejects(callLocal(callback(auth)), { code: "ECONNREFUSED" });
});

test("malformed, web, oversized, symlink and redirected-provider clients fail before authorization", async t => {
  for (const value of ["not-json", JSON.stringify({ web: clientJson.installed }), " ".repeat(16385), JSON.stringify({ installed: { ...clientJson.installed, token_uri: "https://evil.invalid/token" } })]) {
    await t.test(value.length > 100 ? "invalid client shape or bound" : "invalid JSON", async t => {
      const f = await fixture(t);
      await writeFile(f.clientPath, value);
      const flow = f.start(async () => { assert.fail("No token exchange should run"); });
      void flow.auth.catch(() => {});
      sanitized((await flow.completion).error, f.messages);
      assert.deepEqual(f.messages, []);
      await missingFile(f.outputPath);
    });
  }
  await t.test("symlink input", async t => {
    const f = await fixture(t);
    const alias = join(f.directory, "alias.json"); await symlink(f.clientPath, alias);
    const flow = f.start(undefined, { clientPath: alias }); void flow.auth.catch(() => {});
    sanitized((await flow.completion).error, f.messages);
    assert.deepEqual(f.messages, []);
  });
});

test("existing outputs, symlinks and checkout paths are refused before opening authorization", async t => {
  for (const mode of ["existing", "symlink", "checkout"]) await t.test(mode, async t => {
    const f = await fixture(t);
    let outputPath = f.outputPath;
    if (mode === "existing") await writeFile(outputPath, "keep-existing");
    if (mode === "symlink") await symlink(f.clientPath, outputPath);
    if (mode === "checkout") outputPath = resolve("scripts/do-not-create-credentials.json");
    const flow = f.start(undefined, { outputPath }); void flow.auth.catch(() => {});
    sanitized((await flow.completion).error, f.messages);
    assert.deepEqual(f.messages, []);
    if (mode === "existing") assert.equal(await readFile(outputPath, "utf8"), "keep-existing");
    if (mode === "symlink") assert.deepEqual(JSON.parse(await readFile(f.clientPath, "utf8")), clientJson);
    if (mode === "checkout") await missingFile(outputPath);
  });
});

test("denied and malformed authorized callbacks save nothing and close the listener", async t => {
  const cases: Record<string, string>[] = [{ error: "provider-private-error" }, { code: "" }, { code: CODE, duplicate: "yes" }];
  for (const values of cases) await t.test("rejected callback", async t => {
    const f = await fixture(t);
    const flow = f.start(async () => { assert.fail("No token exchange should run"); });
    const auth = await flow.auth;
    const url = callback(auth, values);
    if (values.duplicate) url.searchParams.append("code", "other");
    const response = await callLocal(url);
    assert.equal(response.status, 400);
    assert.equal(response.body.includes("provider-private-error"), false);
    sanitized((await flow.completion).error, f.messages);
    await missingFile(f.outputPath);
    await assert.rejects(callLocal(url), { code: "ECONNREFUSED" });
  });
});

test("callback timeout and cancellation clean up the listener without a token exchange", async t => {
  for (const cancelled of [false, true]) await t.test(cancelled ? "cancelled" : "timed out", async t => {
    const f = await fixture(t);
    const flow = f.start(async () => { assert.fail("No token exchange should run"); }, { callbackTimeoutMs: cancelled ? 2000 : 40 });
    const auth = await flow.auth;
    if (cancelled) f.controller.abort();
    sanitized((await flow.completion).error, f.messages);
    await missingFile(f.outputPath);
    await assert.rejects(callLocal(callback(auth)), { code: "ECONNREFUSED" });
  });
});

test("token failures, missing refresh credentials, unexpected scopes and oversized bodies fail without secret output", async t => {
  const responses: Array<{ name: string; send: typeof fetch }> = [
    { name: "provider error", send: async () => new Response("provider-private-error", { status: 400 }) },
    { name: "network error", send: async () => { throw new Error(`provider-private-error ${CODE} ${CLIENT_SECRET}`); } },
    { name: "invalid JSON", send: async () => new Response(`provider-private-error ${ACCESS}`) },
    { name: "no refresh token", send: async () => Response.json({ ...tokenJson, refresh_token: undefined }) },
    { name: "missing scope", send: async () => Response.json({ ...tokenJson, scope: undefined }) },
    { name: "wrong scope", send: async () => Response.json({ ...tokenJson, scope: "https://mail.google.com/" }) },
    { name: "additional scope", send: async () => Response.json({ ...tokenJson, scope: `${GMAIL_SEND_SCOPE} openid` }) },
    { name: "oversized body", send: async () => new Response("x".repeat(65537)) },
    { name: "deadline ignores fetch cancellation", send: async () => new Promise<Response>(() => {}) },
  ];
  for (const { name, send } of responses) await t.test(name, async t => {
    const f = await fixture(t);
    const flow = f.start(send, { tokenTimeoutMs: 40 });
    const auth = await flow.auth;
    assert.equal((await callLocal(callback(auth))).status, 200);
    sanitized((await flow.completion).error, f.messages);
    await missingFile(f.outputPath);
    assert.equal((await readdir(f.directory)).some(name => name.includes(".pending-")), false);
  });
});

test("a file created during authorization is never overwritten and temporary secrets are removed", async t => {
  const f = await fixture(t);
  const flow = f.start(async () => { await writeFile(f.outputPath, "raced-existing-file"); return validToken(); });
  const auth = await flow.auth;
  await callLocal(callback(auth));
  sanitized((await flow.completion).error, f.messages);
  assert.equal(await readFile(f.outputPath, "utf8"), "raced-existing-file");
  assert.equal((await readdir(f.directory)).some(name => name.includes(".pending-")), false);
});

test("each attempt gets independent state and PKCE challenge", async t => {
  const first = await fixture(t), second = await fixture(t);
  const firstFlow = first.start(), secondFlow = second.start();
  const [firstAuth, secondAuth] = await Promise.all([firstFlow.auth, secondFlow.auth]);
  assert.notEqual(firstAuth.searchParams.get("state"), secondAuth.searchParams.get("state"));
  assert.notEqual(firstAuth.searchParams.get("code_challenge"), secondAuth.searchParams.get("code_challenge"));
  assert.notEqual(firstAuth.searchParams.get("redirect_uri"), secondAuth.searchParams.get("redirect_uri"));
  first.controller.abort(); second.controller.abort();
  sanitized((await firstFlow.completion).error, first.messages);
  sanitized((await secondFlow.completion).error, second.messages);
});
