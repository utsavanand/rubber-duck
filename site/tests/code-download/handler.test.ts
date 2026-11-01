import assert from "node:assert/strict";
import { test } from "node:test";
import { createCodeDownloadHandler, type CodeDownloadDependencies } from "../../lib/code-download/handler.ts";
import { DownloadStageError, type DownloadFailureEvent } from "../../lib/code-download/diagnostics.ts";

const ORIGIN = "https://duckterm.utsava.xyz";
const EMAIL = "Ada+Code@gmail.com";
const LINK = `${ORIGIN}/api/code-download/file?token=PRIVATE_SIGNED_TOKEN`;
const PRIVATE_ERROR = `Provider secret PRIVATE_API_KEY for ${EMAIL}: ${LINK}`;
function request(body: unknown = { email: " Ada+Code@GMAIL.COM ", website: "" }, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}/api/code-download`, { method: "POST", headers: { origin: ORIGIN, "sec-fetch-site": "same-origin", "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
}
function harness(overrides: Partial<CodeDownloadDependencies> = {}) {
  const calls: string[] = [];
  const dependencies: CodeDownloadDependencies = {
    rateLimit: async (_request, email) => { calls.push("rate"); assert.equal(email, EMAIL); return { allowed: true }; },
    lookupMailbox: async domain => { calls.push("dns"); assert.equal(domain, "gmail.com"); return { status: "valid" }; },
    sendMail: async message => { calls.push("send"); assert.deepEqual(message, { to: EMAIL, edition: "code" }); return { accepted: true }; },
    reportFailure: () => {},
    ...overrides,
  };
  return { calls, dependencies, handle: createCodeDownloadHandler({ allowedOrigin: ORIGIN }, dependencies) };
}
async function privateResponse(response: Response, status: number) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const text = await response.text();
  for (const secret of [EMAIL, "PRIVATE_SIGNED_TOKEN", "PRIVATE_API_KEY", "https://"]) assert.ok(!text.includes(secret), text);
  return JSON.parse(text) as { ok: boolean; error?: string; message?: string };
}

test("success follows rate limit, DNS and provider acceptance and reveals no URL", async () => {
  const { handle, calls } = harness();
  const body = await privateResponse(await handle(request()), 200);
  assert.equal(body.ok, true);
  assert.match(body.message!, /inbox/);
  assert.deepEqual(calls, ["rate", "dns", "send"]);
});

test("a pending send cannot report success before the provider accepts", { timeout: 1000 }, async () => {
  let accept!: (value: { accepted: boolean }) => void;
  let started!: () => void;
  const startedSending = new Promise<void>(resolve => { started = resolve; });
  const acceptance = new Promise<{ accepted: boolean }>(resolve => { accept = resolve; });
  const { handle } = harness({ sendMail: async () => { started(); return acceptance; } });
  let settled = false;
  const pending = handle(request()).then(response => { settled = true; return response; });
  await startedSending;
  assert.equal(settled, false);
  accept({ accepted: true });
  await privateResponse(await pending, 200);
});

test("origin, Fetch Metadata and content type checks run before dependencies", async () => {
  for (const headers of [{ origin: "https://attacker.invalid" }, { origin: "null" }, { "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" }, { "sec-fetch-site": "none" }] as Record<string, string>[]) {
    const { handle, calls } = harness();
    await privateResponse(await handle(request(undefined, headers)), 403);
    assert.deepEqual(calls, []);
  }
  for (const omitted of ["origin", "sec-fetch-site"]) {
    const { handle, calls } = harness();
    const req = request(); req.headers.delete(omitted);
    await privateResponse(await handle(req), 403);
    assert.deepEqual(calls, []);
  }
  const { handle, calls } = harness();
  await privateResponse(await handle(new Request("https://other.invalid/api/code-download", request())), 403);
  for (const headers of [{ "content-type": "text/plain" }, { "content-encoding": "gzip" }] as Record<string, string>[]) await privateResponse(await handle(request(undefined, headers)), 415);
  assert.deepEqual(calls, []);
});

test("staged production accepts only its exact origin, request URL and same-origin Fetch Metadata", async () => {
  const candidate = "https://rubber-duck-ab12cd345-utsavs-projects-b9d729c7.vercel.app";
  const otherDeployment = candidate.replace("ab12cd345", "zy98xw765");
  const { dependencies, calls } = harness();
  const handle = createCodeDownloadHandler({ allowedOrigin: candidate }, dependencies);
  const makeRequest = (url: string, origin: string | null, site: string | null = "same-origin") => {
    const req = new Request(`${url}/api/code-download`, request());
    if (origin === null) req.headers.delete("origin"); else req.headers.set("origin", origin);
    if (site === null) req.headers.delete("sec-fetch-site"); else req.headers.set("sec-fetch-site", site);
    return req;
  };
  await privateResponse(await handle(makeRequest(candidate, candidate)), 200);
  assert.deepEqual(calls, ["rate", "dns", "send"]);
  calls.length = 0;
  for (const other of [ORIGIN, otherDeployment, "https://rubber-duck-nine.vercel.app", `${candidate}.attacker.invalid`, candidate.replace("https:", "http:"), `${candidate}:444`]) {
    for (const [url, origin] of [[candidate, other], [other, candidate], [other, other]]) {
      const req = makeRequest(url, origin);
      // Forwarded/Host headers must not override the request URL or Origin.
      req.headers.set("host", new URL(candidate).host);
      req.headers.set("x-forwarded-host", new URL(candidate).host);
      req.headers.set("x-forwarded-proto", "https");
      await privateResponse(await handle(req), 403);
    }
  }
  for (const origin of [null, "null", `${candidate}/`]) await privateResponse(await handle(makeRequest(candidate, origin)), 403);
  for (const site of [null, "same-site", "cross-site", "none"]) await privateResponse(await handle(makeRequest(candidate, candidate, site)), 403);
  assert.deepEqual(calls, []);
  const canonical = harness();
  await privateResponse(await canonical.handle(makeRequest(candidate, candidate)), 403);
  assert.deepEqual(canonical.calls, []);
});

test("non-POST, invalid configuration and absent dependencies fail closed", async () => {
  const { handle, dependencies, calls } = harness();
  const method = await handle(new Request(`${ORIGIN}/api/code-download`));
  await privateResponse(method, 405);
  assert.equal(method.headers.get("allow"), "POST");
  for (const allowedOrigin of ["", "not a URL", "https://user:secret@duckterm.utsava.xyz", `${ORIGIN}/extra`, "http://duckterm.utsava.xyz"]) await privateResponse(await createCodeDownloadHandler({ allowedOrigin }, dependencies)(request()), 503);
  await privateResponse(await createCodeDownloadHandler({ allowedOrigin: ORIGIN }, {} as CodeDownloadDependencies)(request()), 503);
  assert.deepEqual(calls, []);
});

test("invalid JSON, email and honeypot fields never reach DNS or sending", async () => {
  for (const body of ["{", "", "null", "[]", "42", {}, { email: "invalid" }, { email: "a@example.com" }, { email: "a@mailinator.com" }, { email: EMAIL, website: "filled" }, { email: EMAIL, website: false }, { email: EMAIL, unexpected: "value" }]) {
    const { handle, calls } = harness();
    await privateResponse(await handle(request(body)), 400);
    assert.deepEqual(calls, []);
  }
});

test("body limit rejects declared and actual stream excess, including a lying Content-Length", async () => {
  const { handle, calls } = harness();
  await privateResponse(await handle(request(undefined, { "content-length": "4097" })), 413);
  await privateResponse(await handle(request(undefined, { "content-length": "invalid" })), 400);
  for (const length of [undefined, "1"]) {
    let cancelled = false;
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(++sent === 1 ? 4096 : 1)); },
      cancel() { cancelled = true; },
    });
    const headers: Record<string, string> = { origin: ORIGIN, "sec-fetch-site": "same-origin", "content-type": "application/json" };
    if (length) headers["content-length"] = length;
    const req = new Request(`${ORIGIN}/api/code-download`, { method: "POST", headers, body, duplex: "half" } as RequestInit & { duplex: "half" });
    await privateResponse(await handle(req), 413);
    assert.equal(cancelled, true);
  }
  assert.deepEqual(calls, []);
});

test("exactly 4096 bytes of valid JSON is accepted; malformed UTF-8 is rejected", async () => {
  const { handle } = harness();
  const json = JSON.stringify({ email: EMAIL });
  await privateResponse(await handle(request(json.padEnd(4096, " "))), 200);
  const invalid = new Request(`${ORIGIN}/api/code-download`, { method: "POST", headers: request().headers, body: new Uint8Array([0xff]) });
  await privateResponse(await handle(invalid), 400);
});

test("rate rejection stops the pipeline before DNS and carries a bounded retry delay", async () => {
  const { handle, calls } = harness({ rateLimit: async () => { calls.push("rate"); return { allowed: false, retryAfterSeconds: 12.1 }; } });
  const response = await handle(request());
  await privateResponse(response, 429);
  assert.equal(response.headers.get("retry-after"), "13");
  assert.deepEqual(calls, ["rate"]);
});

test("invalid domains are rejected while temporary DNS trouble is retryable", async () => {
  for (const [status, expected] of [["invalid", 400], ["unavailable", 503]] as const) {
    const { handle, calls } = harness({ lookupMailbox: async () => { calls.push("dns"); return { status }; } });
    const response = await handle(request());
    await privateResponse(response, expected);
    if (expected === 503) assert.equal(response.headers.get("retry-after"), "60");
    assert.deepEqual(calls, ["rate", "dns"]);
  }
});

test("dependency exceptions stay private and never continue the pipeline", async () => {
  const stages = ["rateLimit", "lookupMailbox", "sendMail"] as const;
  for (const [index, stage] of stages.entries()) {
    const { handle, calls, dependencies } = harness();
    dependencies[stage] = async () => { throw new Error(PRIVATE_ERROR); };
    const body = await privateResponse(await handle(request()), 503);
    assert.equal(body.ok, false);
    assert.deepEqual(calls, ["rate", "dns", "send"].slice(0, index));
  }
});

test("provider rejection cannot produce success", async () => {
  const { handle } = harness({ sendMail: async () => ({ accepted: false }) });
  await privateResponse(await handle(request()), 503);
});

test("only Code and Full can be selected and no client URL reaches delivery", async () => {
  for (const edition of ["code", "full"] as const) {
    const sent: unknown[] = [];
    const { handle, calls } = harness({ sendMail: async message => { calls.push("send"); sent.push(message); return { accepted: true }; } });
    await privateResponse(await handle(request({ email: EMAIL, edition })), 200);
    assert.deepEqual(sent, [{ to: EMAIL, edition }]);
    assert.deepEqual(calls, ["rate", "dns", "send"]);
  }
  for (const edition of [null, "", "lite", "Code", " full", "__proto__", "constructor", {}, ["code"], 1]) {
    const { handle, calls } = harness();
    await privateResponse(await handle(request({ email: EMAIL, edition })), 400);
    assert.deepEqual(calls, []);
  }
  for (const field of ["url", "downloadUrl", "version", "bucket", "generation"]) {
    const { handle, calls } = harness();
    await privateResponse(await handle(request({ email: EMAIL, edition: "full", [field]: "https://attacker.invalid/evil.zip" })), 400);
    assert.deepEqual(calls, []);
  }
});

test("deadline stops a stalled dependency and never sends after it eventually resolves", async () => {
  let finish!: (value: { allowed: boolean }) => void;
  const { calls, dependencies } = harness({ rateLimit: () => new Promise(resolve => { finish = resolve; }) });
  const handle = createCodeDownloadHandler({ allowedOrigin: ORIGIN, timeoutMs: 30 }, dependencies);
  await privateResponse(await handle(request()), 503);
  finish({ allowed: true });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.deepEqual(calls, []);
});

test("aborted requests and stalled bodies never reach sending", async () => {
  const { calls, dependencies } = harness();
  const handle = createCodeDownloadHandler({ allowedOrigin: ORIGIN, timeoutMs: 30 }, dependencies);
  let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; } });
  const req = new Request(`${ORIGIN}/api/code-download`, { method: "POST", headers: request().headers, body, duplex: "half" } as RequestInit & { duplex: "half" });
  await privateResponse(await handle(req), 400);
  assert.equal(cancelled, true);
  const controller = new AbortController(); controller.abort();
  await privateResponse(await handle(new Request(request(), { signal: controller.signal })), 400);
  assert.deepEqual(calls, []);
});

test("dependency failures emit one sanitized stage report without changing private 503 responses", async () => {
  for (const [dependency, stage] of [["rateLimit", "rate_limit"], ["lookupMailbox", "mailbox"], ["sendMail", "gmail"]] as const) {
    const events: DownloadFailureEvent[] = [];
    const { handle } = harness({
      [dependency]: async () => { throw Object.assign(new Error(PRIVATE_ERROR), { code: 7, response: { status: 403, data: { error: { details: [{ reason: "IAM_PERMISSION_DENIED", metadata: { token: PRIVATE_ERROR } }] } } } }); },
      reportFailure: event => events.push(event),
    });
    await privateResponse(await handle(request()), 503);
    assert.deepEqual(events, [{ stage, httpStatus: 403, grpcStatus: 7, reason: "IAM_PERMISSION_DENIED" }]);
  }
  for (const stage of ["trusted_ip", "oidc"] as const) {
    const events: DownloadFailureEvent[] = [];
    const { handle } = harness({ rateLimit: async () => { throw new Error(PRIVATE_ERROR, { cause: new DownloadStageError(stage, new Error(PRIVATE_ERROR)) }); }, reportFailure: event => events.push(event) });
    await privateResponse(await handle(request()), 503);
    assert.deepEqual(events, [{ stage }]);
  }
});

test("success and expected request/quota rejection remain quiet; unavailable results report their stage", async () => {
  const events: DownloadFailureEvent[] = [];
  const reportFailure = (event: DownloadFailureEvent) => { events.push(event); };
  const { handle } = harness({ reportFailure });
  await privateResponse(await handle(request()), 200);
  await privateResponse(await handle(request({ email: "invalid" })), 400);
  await privateResponse(await handle(request(undefined, { origin: "https://other.invalid" })), 403);
  await privateResponse(await harness({ reportFailure, rateLimit: async () => ({ allowed: false }) }).handle(request()), 429);
  await privateResponse(await harness({ reportFailure, lookupMailbox: async () => ({ status: "invalid" }) }).handle(request()), 400);
  assert.deepEqual(events, []);
  await privateResponse(await harness({ reportFailure, lookupMailbox: async () => ({ status: "unavailable" }) }).handle(request()), 503);
  await privateResponse(await harness({ reportFailure, sendMail: async () => ({ accepted: false }) }).handle(request()), 503);
  assert.deepEqual(events, [{ stage: "mailbox" }, { stage: "gmail" }]);
  await privateResponse(await harness({ reportFailure: () => { throw new Error(PRIVATE_ERROR); }, sendMail: async () => ({ accepted: false }) }).handle(request()), 503);
});
