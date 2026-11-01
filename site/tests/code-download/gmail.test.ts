import assert from "node:assert/strict";
import test from "node:test";
import { createGmailSender } from "../../lib/code-download/gmail.ts";
import { createCodeDownloadHandler } from "../../lib/code-download/handler.ts";
import { publicDownload } from "../../lib/code-download/download-link.ts";

const config = { from: "sender@gmail.com", clientId: "test-client", clientSecret: "test-secret", refreshToken: "test-refresh" };
const message = { to: "Reader+code@icloud.com", edition: "code" as const };

test("Gmail sends the selected public Code or Full link with matching subject and actual app name", async t => {
  for (const edition of ["code", "full"] as const) await t.test(edition, async () => {
    const requests: { url: string; init?: RequestInit }[] = [];
    const send = createGmailSender(config, async (url, init) => {
      requests.push({ url: String(url), init });
      return Response.json(requests.length === 1 ? { access_token: "test-access" } : { id: "accepted-message" });
    });
    assert.deepEqual(await send({ ...message, edition }), { accepted: true });
    assert.equal(requests.length, 2);
    assert.equal(requests[0].url, "https://oauth2.googleapis.com/token");
    const tokenBody = new URLSearchParams(String(requests[0].init?.body));
    assert.equal(tokenBody.get("grant_type"), "refresh_token");
    assert.equal(tokenBody.get("refresh_token"), "test-refresh");
    assert.equal(requests[1].url, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
    assert.equal(new Headers(requests[1].init?.headers).get("Authorization"), "Bearer test-access");
    const raw = JSON.parse(String(requests[1].init?.body)).raw;
    const mime = Buffer.from(raw, "base64url").toString();
    const separator = mime.indexOf("\r\n\r\n");
    const headers = mime.slice(0, separator);
    const body = Buffer.from(mime.slice(separator + 4), "base64").toString();
    assert.match(headers, /To: Reader\+code@icloud.com\r\n/);
    assert.doesNotMatch(headers, /(?:^|\r\n)(?:Cc|Bcc):/i);
    const name = edition === "code" ? "DuckTerm Code" : "DuckTerm Full";
    const bundle = edition === "code" ? "DuckTerm Code.app" : "DuckTerm.app";
    assert.ok(headers.includes(`Subject: Your ${name} download\r\n`));
    assert.ok(body.startsWith(`Your ${name} download\r\n`));
    assert.ok(body.includes(publicDownload(edition)!.url));
    assert.equal(body.includes(publicDownload(edition === "code" ? "full" : "code")!.url), false);
    assert.ok(body.includes(`move ${bundle} to Applications`));
    assert.match(body, /This is the public download link for the latest release\./);
    assert.doesNotMatch(body, /expires|24 hours|storage\.googleapis\.com/);
    assert.match(body, /does not subscribe you/);
    assert.doesNotMatch(mime, /test-secret|test-refresh|test-access/);
    for (const request of requests) {
      assert.equal(request.init?.redirect, "error");
      assert.equal(request.init?.cache, "no-store");
      assert.ok(request.init?.signal);
    }
  });
});

test("bad configuration, header injection and unsupported editions never call Google", async () => {
  let called = 0;
  const fetcher: typeof fetch = async () => { called++; throw new Error("Unexpected request"); };
  for (const input of [{ ...message, to: "reader@gmail.com\r\nBcc: other@gmail.com" }, { ...message, edition: "lite" as "code" }, { ...message, edition: "__proto__" as "code" }]) {
    assert.deepEqual(await createGmailSender(config, fetcher)(input), { accepted: false });
  }
  assert.deepEqual(await createGmailSender({ ...config, refreshToken: "" }, fetcher)(message), { accepted: false });
  assert.equal(called, 0);
});

test("failed authorization cannot send, and provider rejection cannot report acceptance", async () => {
  for (const tokenResponse of [() => new Response("unavailable", { status: 503 }), () => Response.json({}), () => Response.json({ access_token: "unsafe\r\nheader" })]) {
    let requests = 0;
    const result = await createGmailSender(config, async () => { requests++; return tokenResponse(); })(message);
    assert.deepEqual(result, { accepted: false });
    assert.equal(requests, 1);
  }
  for (const mailResponse of [() => new Response("quota", { status: 429 }), () => Response.json({})]) {
    let requests = 0;
    const result = await createGmailSender(config, async () => ++requests === 1 ? Response.json({ access_token: "test-access" }) : mailResponse())(message);
    assert.deepEqual(result, { accepted: false });
    assert.equal(requests, 2);
  }
});

test("a network failure is propagated to the core without an automatic resend", async () => {
  let requests = 0;
  const send = createGmailSender(config, async () => {
    if (++requests === 1) return Response.json({ access_token: "test-access" });
    throw new Error("connection lost after possible acceptance");
  });
  await assert.rejects(send(message));
  assert.equal(requests, 2);
});

test("expired website requests cannot start an email after delayed OAuth completes", async () => {
  let finish!: (response: Response) => void;
  let requests = 0;
  let oauthSignal: AbortSignal | null | undefined;
  const sendMail = createGmailSender(config, async (_url, init) => {
    requests++;
    oauthSignal = init?.signal;
    return new Promise(resolve => { finish = resolve; });
  });
  const handle = createCodeDownloadHandler({ allowedOrigin: "https://duckterm.utsava.xyz", timeoutMs: 30 }, {
    rateLimit: async () => ({ allowed: true }), lookupMailbox: async () => ({ status: "valid" }),
    sendMail,
  });
  const response = await handle(new Request("https://duckterm.utsava.xyz/api/code-download", {
    method: "POST", headers: { origin: "https://duckterm.utsava.xyz", "sec-fetch-site": "same-origin", "content-type": "application/json" },
    body: JSON.stringify({ email: message.to }),
  }));
  assert.equal(response.status, 503);
  assert.equal(requests, 1);
  assert.equal(oauthSignal?.aborted, true);
  finish(Response.json({ access_token: "synthetic-delayed-token" }));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(requests, 1);
});

test("owner/request cancellation is checked before a mail send even if OAuth ignores abort", async () => {
  const controller = new AbortController();
  let requests = 0;
  const sendMail = createGmailSender(config, async () => {
    requests++;
    controller.abort();
    return Response.json({ access_token: "synthetic-token" });
  });
  await assert.rejects(sendMail(message, controller.signal));
  assert.equal(requests, 1);
});
