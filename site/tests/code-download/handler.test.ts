import assert from "node:assert/strict";
import { test } from "node:test";
import { createCodeDownloadHandler, type CodeDownloadDependencies } from "../../lib/code-download/handler.ts";
import { DownloadStageError, type DownloadFailureEvent } from "../../lib/code-download/diagnostics.ts";
import { Timestamp, type Firestore } from "@google-cloud/firestore";
import { createRateLimiter } from "../../lib/code-download/rate-limit.ts";

const ORIGIN = "https://duckterm.utsava.xyz";
const EMAIL = "Ada+Code@gmail.com";
const PRIVATE_ERROR = `PRIVATE_API_KEY for ${EMAIL} https://private.invalid/?token=PRIVATE_TOKEN`;
const HUMAN = { isHuman: true, isBot: false, bypassed: false };
const URLS = {
  code: "https://github.com/utsavanand/duckterm/releases/latest/download/DuckTerm-Code-macos-arm64.zip",
  full: "https://github.com/utsavanand/duckterm/releases/latest/download/DuckTerm-Full-macos-arm64.zip",
};
type BotResult = Awaited<ReturnType<CodeDownloadDependencies["verifyBot"]>>;

function request(body: unknown = { email: " Ada+Code@GMAIL.COM ", website: "" }, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}/api/code-download`, { method: "POST", headers: { origin: ORIGIN, "sec-fetch-site": "same-origin", "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
}
function harness(overrides: Partial<CodeDownloadDependencies> = {}) {
  const calls: string[] = [];
  const dependencies: CodeDownloadDependencies = {
    verifyBot: async () => { calls.push("bot"); return HUMAN; },
    rateLimit: async (_request, email) => { calls.push("rate"); assert.equal(email, EMAIL); return { allowed: true }; },
    lookupMailbox: async domain => { calls.push("dns"); assert.equal(domain, "gmail.com"); return { status: "valid" }; },
    recordDownload: async value => { calls.push("record"); assert.deepEqual(value, { email: EMAIL, edition: "code" }); },
    reportFailure: () => {},
    ...overrides,
  };
  return { calls, dependencies, handle: createCodeDownloadHandler({ allowedOrigin: ORIGIN }, dependencies) };
}
async function privateResponse(response: Response, status: number) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const text = await response.text();
  for (const secret of [EMAIL, "PRIVATE_TOKEN", "PRIVATE_API_KEY", "private.invalid"]) assert.ok(!text.includes(secret), text);
  return JSON.parse(text);
}
async function downloadResponse(response: Response, edition: "code" | "full" = "code") {
  const body = await privateResponse(response, 200);
  assert.deepEqual(body, { ok: true, edition, url: URLS[edition], message: "Your download is ready." });
  assert.equal("captured" in body, false);
  assert.equal("recorded" in body, false);
  return body;
}

test("verified human requests run bot, shared quota, DNS and capture in order before returning the selected public link", async () => {
  for (const edition of ["code", "full"] as const) {
    const recorded: unknown[] = [];
    const { calls, handle, dependencies } = harness({ recordDownload: async value => { calls.push("record"); recorded.push(value); } });
    Object.defineProperty(dependencies, "sendMail", { get() { throw new Error("Mail must never be used by the download flow"); } });
    await downloadResponse(await handle(request({ email: " Ada+Code@GMAIL.COM ", edition })), edition);
    assert.deepEqual(calls, ["bot", "rate", "dns", "record"]);
    assert.deepEqual(recorded, [{ email: EMAIL, edition }]);
  }
});

test("pending bot verification cannot reserve quota, resolve DNS or capture an address", { timeout: 1000 }, async () => {
  let finish!: (value: BotResult) => void;
  let started!: () => void;
  const verifying = new Promise<void>(resolve => { started = resolve; });
  const verification = new Promise<BotResult>(resolve => { finish = resolve; });
  const { calls, handle } = harness({ verifyBot: async () => { calls.push("bot"); started(); return verification; } });
  let settled = false;
  const pending = handle(request()).then(response => { settled = true; return response; });
  await verifying;
  assert.equal(settled, false);
  assert.deepEqual(calls, ["bot"]);
  finish(HUMAN);
  await downloadResponse(await pending);
  assert.deepEqual(calls, ["bot", "rate", "dns", "record"]);
});

test("bot denial, bypass and malformed verification return the same link without quota, DNS or capture", async () => {
  for (const verdict of [
    null, undefined, {}, [], true,
    { isHuman: false, isBot: true, bypassed: false },
    { isHuman: false, isBot: false, bypassed: false },
    { isHuman: true, isBot: true, bypassed: false },
    { isHuman: "true", isBot: false, bypassed: false },
    { isHuman: true, isBot: 0, bypassed: false },
    { isHuman: true, isBot: false },
    { ...HUMAN, bypassed: true }, { ...HUMAN, bypassed: "false" }, { ...HUMAN, bypassed: 0 },
    { ...HUMAN, isVerifiedBot: true },
  ]) {
    const { calls, handle } = harness({ verifyBot: async () => { calls.push("bot"); return verdict as BotResult; } });
    await downloadResponse(await handle(request()));
    assert.deepEqual(calls, ["bot"], JSON.stringify(verdict));
  }
});

test("quota denial and malformed results return the link without DNS or capture", async () => {
  for (const result of [{ allowed: false, retryAfterSeconds: 3600 }, null, undefined, {}, { allowed: "true" }]) {
    const { calls, handle } = harness({ rateLimit: async () => { calls.push("rate"); return result as { allowed: boolean }; } });
    await downloadResponse(await handle(request()));
    assert.deepEqual(calls, ["bot", "rate"]);
  }
});

test("invalid mailbox domains remain a validation error while uncertain DNS returns the link without capture", async () => {
  for (const status of ["invalid", "unavailable"] as const) {
    const { calls, handle } = harness({ lookupMailbox: async () => { calls.push("dns"); return { status }; } });
    const response = await handle(request());
    if (status === "invalid") await privateResponse(response, 400); else await downloadResponse(response);
    assert.deepEqual(calls, ["bot", "rate", "dns"]);
  }
  const { handle, calls } = harness({ lookupMailbox: async () => { calls.push("dns"); return undefined as never; } });
  await downloadResponse(await handle(request()));
  assert.deepEqual(calls, ["bot", "rate", "dns"]);
});

test("dependency errors cannot withhold the public link or run later stages", async () => {
  const stages = ["verifyBot", "rateLimit", "lookupMailbox", "recordDownload"] as const;
  for (const [index, stage] of stages.entries()) {
    const { calls, dependencies, handle } = harness();
    dependencies[stage] = async () => { throw new Error(PRIVATE_ERROR); };
    await downloadResponse(await handle(request()));
    assert.deepEqual(calls, ["bot", "rate", "dns", "record"].slice(0, index));
  }
});

test("Code and Full share actual limiter reservations while both requests still receive their own link", async () => {
  type Stored = { version: number; reservations: number[]; expireAt: Timestamp };
  type Reference = { id: string };
  const rows = new Map<string, Stored>();
  const database = {
    collection(name: string) {
      assert.equal(name, "ducktermCodeDownloadLimits");
      return { doc(id: string) { return { id }; } };
    },
    async runTransaction<T>(callback: (transaction: {
      getAll(...references: Reference[]): Promise<{ exists: boolean; data(): Stored | undefined }[]>;
      set(reference: Reference, value: Stored): void;
    }) => Promise<T>) {
      return callback({
        async getAll(...references) { return references.map(({ id }) => ({ exists: rows.has(id), data: () => rows.get(id) })); },
        set({ id }, value) { rows.set(id, value); },
      });
    },
  };
  const recorded: unknown[] = [];
  let lookups = 0;
  const makeHandler = () => createCodeDownloadHandler({ allowedOrigin: ORIGIN }, {
    verifyBot: async () => HUMAN,
    rateLimit: createRateLimiter({ hmacSecret: "synthetic-test-only-hmac-secret-32-bytes" }, database as unknown as Firestore, () => 1_800_000_000_000),
    lookupMailbox: async () => { lookups++; return { status: "valid" }; },
    recordDownload: async value => { recorded.push(value); },
  });
  for (const edition of ["code", "full"] as const) await downloadResponse(await makeHandler()(request({ email: EMAIL, edition }, { "x-vercel-forwarded-for": "192.0.2.10" })), edition);
  assert.deepEqual(recorded, [{ email: EMAIL, edition: "code" }]);
  assert.equal(lookups, 1, "quota rejection must skip DNS and capture for the second edition");
  assert.equal(rows.size, 3);
  for (const record of rows.values()) assert.deepEqual(record.reservations, [1_800_000_000_000]);
});

test("origin, Fetch Metadata and content type checks run before all dependencies", async () => {
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

test("staged production accepts only its exact request URL, Origin and same-origin Fetch Metadata", async () => {
  const candidate = "https://rubber-duck-ab12cd345-utsavs-projects-b9d729c7.vercel.app";
  const { dependencies, calls } = harness();
  const handle = createCodeDownloadHandler({ allowedOrigin: candidate }, dependencies);
  const makeRequest = (url: string, origin: string | null, site: string | null = "same-origin") => {
    const req = new Request(`${url}/api/code-download`, request());
    if (origin === null) req.headers.delete("origin"); else req.headers.set("origin", origin);
    if (site === null) req.headers.delete("sec-fetch-site"); else req.headers.set("sec-fetch-site", site);
    return req;
  };
  await downloadResponse(await handle(makeRequest(candidate, candidate)));
  assert.deepEqual(calls, ["bot", "rate", "dns", "record"]);
  calls.length = 0;
  for (const other of [ORIGIN, candidate.replace("ab12cd345", "zy98xw765"), "https://rubber-duck-nine.vercel.app", `${candidate}.attacker.invalid`, candidate.replace("https:", "http:"), `${candidate}:444`]) {
    for (const [url, origin] of [[candidate, other], [other, candidate], [other, other]]) {
      const req = makeRequest(url, origin);
      req.headers.set("host", new URL(candidate).host);
      req.headers.set("x-forwarded-host", new URL(candidate).host);
      req.headers.set("x-forwarded-proto", "https");
      await privateResponse(await handle(req), 403);
    }
  }
  for (const origin of [null, "null", `${candidate}/`]) await privateResponse(await handle(makeRequest(candidate, origin)), 403);
  for (const site of [null, "same-site", "cross-site", "none"]) await privateResponse(await handle(makeRequest(candidate, candidate, site)), 403);
  assert.deepEqual(calls, []);
});

test("non-POST, invalid JSON, email and honeypot fields are rejected before bot verification", async () => {
  const { handle, calls } = harness();
  const method = await handle(new Request(`${ORIGIN}/api/code-download`));
  await privateResponse(method, 405);
  assert.equal(method.headers.get("allow"), "POST");
  for (const body of ["{", "", "null", "[]", "42", {}, { email: "invalid" }, { email: "a@example.com" }, { email: "a@mailinator.com" }, { email: EMAIL, website: "filled" }, { email: EMAIL, website: false }, { email: EMAIL, unexpected: "value" }]) await privateResponse(await handle(request(body)), 400);
  assert.deepEqual(calls, []);
});

test("body limits reject declared and actual excess even with a lying Content-Length", async () => {
  const { handle, calls } = harness();
  await privateResponse(await handle(request(undefined, { "content-length": "4097" })), 413);
  await privateResponse(await handle(request(undefined, { "content-length": "invalid" })), 400);
  for (const length of [undefined, "1"]) {
    let cancelled = false, sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(++sent === 1 ? 4096 : 1)); },
      cancel() { cancelled = true; },
    });
    const headers = new Headers(request().headers);
    if (length) headers.set("content-length", length);
    const req = new Request(`${ORIGIN}/api/code-download`, { method: "POST", headers, body, duplex: "half" } as RequestInit & { duplex: "half" });
    await privateResponse(await handle(req), 413);
    assert.equal(cancelled, true);
  }
  assert.deepEqual(calls, []);
});

test("exactly 4096 bytes of valid JSON succeeds while malformed UTF-8 fails", async () => {
  const { handle } = harness();
  await downloadResponse(await handle(request(JSON.stringify({ email: EMAIL }).padEnd(4096, " "))));
  await privateResponse(await handle(new Request(`${ORIGIN}/api/code-download`, { method: "POST", headers: request().headers, body: new Uint8Array([0xff]) })), 400);
});

test("only Code and Full may select links and client-supplied download URLs never reach capture", async () => {
  const { handle, calls } = harness();
  for (const edition of [null, "", "lite", "Code", " full", "__proto__", "constructor", {}, ["code"], 1]) await privateResponse(await handle(request({ email: EMAIL, edition })), 400);
  for (const field of ["url", "downloadUrl", "version", "bucket", "generation"]) await privateResponse(await handle(request({ email: EMAIL, edition: "full", [field]: "https://attacker.invalid/evil.zip" })), 400);
  assert.deepEqual(calls, []);
});

test("each stalled dependency returns the link by the deadline and cannot start a later stage", { timeout: 2000 }, async () => {
  const stages = ["verifyBot", "rateLimit", "lookupMailbox", "recordDownload"] as const;
  const labels = ["bot", "rate", "dns", "record"];
  const results = [HUMAN, { allowed: true }, { status: "valid" }, undefined];
  for (const [index, stage] of stages.entries()) {
    let finish!: (value: unknown) => void;
    const pending = new Promise(resolve => { finish = resolve; });
    const { calls, dependencies } = harness();
    Object.assign(dependencies, { [stage]: async () => { calls.push(labels[index]); return pending; } });
    const handle = createCodeDownloadHandler({ allowedOrigin: ORIGIN, timeoutMs: 25 }, dependencies);
    await downloadResponse(await handle(request()));
    assert.deepEqual(calls, labels.slice(0, index + 1));
    finish(results[index]);
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.deepEqual(calls, labels.slice(0, index + 1), "a late result continued the pipeline");
  }
});

test("aborted requests and stalled bodies do not reach bot verification or capture", async () => {
  const { calls, dependencies } = harness();
  const handle = createCodeDownloadHandler({ allowedOrigin: ORIGIN, timeoutMs: 25 }, dependencies);
  let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; } });
  const req = new Request(`${ORIGIN}/api/code-download`, { method: "POST", headers: request().headers, body, duplex: "half" } as RequestInit & { duplex: "half" });
  await privateResponse(await handle(req), 400);
  assert.equal(cancelled, true);
  const controller = new AbortController(); controller.abort();
  await privateResponse(await handle(new Request(request(), { signal: controller.signal })), 400);
  assert.deepEqual(calls, []);
});

test("dependency failures report only fixed stages and sanitized status codes while returning the link", async () => {
  for (const [dependency, stage] of [["verifyBot", "bot"], ["rateLimit", "rate_limit"], ["lookupMailbox", "mailbox"], ["recordDownload", "record"]] as const) {
    const events: DownloadFailureEvent[] = [];
    const { handle } = harness({
      [dependency]: async () => { throw Object.assign(new Error(PRIVATE_ERROR), { code: 7, response: { status: 403, data: { error: { details: [{ reason: "IAM_PERMISSION_DENIED", metadata: { token: PRIVATE_ERROR } }] } } } }); },
      reportFailure: event => events.push(event),
    });
    await downloadResponse(await handle(request()));
    assert.deepEqual(events, [{ stage, httpStatus: 403, grpcStatus: 7, reason: "IAM_PERMISSION_DENIED" }]);
    assert.doesNotMatch(JSON.stringify(events), /PRIVATE_|Ada|gmail\.com|https:/);
  }
  for (const stage of ["trusted_ip", "oidc"] as const) {
    const events: DownloadFailureEvent[] = [];
    const { handle } = harness({ rateLimit: async () => { throw new Error(PRIVATE_ERROR, { cause: new DownloadStageError(stage, new Error(PRIVATE_ERROR)) }); }, reportFailure: event => events.push(event) });
    await downloadResponse(await handle(request()));
    assert.deepEqual(events, [{ stage }]);
  }
  await downloadResponse(await harness({ reportFailure: () => { throw new Error(PRIVATE_ERROR); }, recordDownload: async () => { throw new Error(PRIVATE_ERROR); } }).handle(request()));
});
