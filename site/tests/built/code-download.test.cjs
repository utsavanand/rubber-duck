const assert = require("node:assert/strict");
const { test } = require("node:test");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

test("built email API serializes quota writes and reads existing timestamps before sending", { timeout: 10000 }, async t => {
  const home = mkdtempSync(path.join(tmpdir(), "duckterm-built-mail-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  // This test runs in its own Node test process. Never inherit real credentials.
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, {
    HOME: home, VERCEL_ENV: "production", CODE_DOWNLOAD_ENABLED: "true",
    CODE_DOWNLOAD_ORIGIN: "https://duckterm.utsava.xyz", GCP_PROJECT_ID: "test-downloads",
    GCP_PROJECT_NUMBER: "123456789012", GCP_SERVICE_ACCOUNT_EMAIL: "downloads@test-downloads.iam.gserviceaccount.com",
    GCP_WORKLOAD_IDENTITY_POOL_ID: "duckterm-vercel", GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: "production",
    GCP_FIRESTORE_DATABASE: "duckterm-downloads", CODE_DOWNLOAD_RATE_SECRET: "synthetic-test-secret-never-production",
    GMAIL_CLIENT_ID: "synthetic-client", GMAIL_CLIENT_SECRET: "synthetic-secret",
    GMAIL_REFRESH_TOKEN: "synthetic-refresh", GMAIL_FROM: "sender@gmail.com",
  });
  const denied = () => { throw new Error("Unexpected network access in built-route test"); };
  for (const name of ["node:http", "node:https"]) {
    const transport = require(name);
    t.mock.method(transport, "request", denied);
    t.mock.method(transport, "get", denied);
  }
  for (const method of ["connect", "createConnection"]) t.mock.method(require("node:net"), method, denied);
  const events = [], failures = [], warnings = [];
  t.mock.method(console, "warn", (...args) => warnings.push(args));
  const token = Buffer.from("{}").toString("base64url") + "." + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url") + ".synthetic";
  globalThis[Symbol.for("@vercel/request-context")] = { get: () => ({ headers: { "x-vercel-oidc-token": token } }) };
  t.after(() => { delete globalThis[Symbol.for("@vercel/request-context")]; });
  const { Resolver } = require("node:dns/promises");
  t.mock.method(Resolver.prototype, "resolveMx", async () => [{ exchange: "smtp.gmail.com", priority: 10 }]);
  t.mock.method(Resolver.prototype, "resolve4", denied);
  t.mock.method(Resolver.prototype, "resolve6", denied);
  t.mock.method(globalThis, "fetch", async url => {
    if (String(url) === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "synthetic-gmail" });
    if (String(url) === "https://gmail.googleapis.com/gmail/v1/users/me/messages/send") {
      events.push("mail");
      return Response.json({ id: "synthetic-message" });
    }
    return denied();
  });

  // Load the production artifact, not the TypeScript handler or a dev server.
  const server = path.resolve(__dirname, "../../.next/server");
  const route = require(path.join(server, "app/api/code-download/route.js"));
  const webpack = require(path.join(server, "webpack-runtime.js"));
  const transports = new Set(), databases = new Set();
  // Capture both bundled and external SDK classes, so removing the external
  // package setting reproduces the real serialization failure, not a mock miss.
  for (const module of [...Object.values(require.cache), ...Object.values(webpack.c)]) {
    if (module.exports?.Gaxios?.prototype?.request) transports.add(module.exports.Gaxios);
    if (module.exports?.Firestore?.prototype?.runTransaction) databases.add(module.exports.Firestore);
  }
  assert.ok(transports.size > 0);
  assert.equal(databases.size, 1);
  const documents = new Map();
  for (const Transport of transports) t.mock.method(Transport.prototype, "request", async options => {
    const url = new URL(options.url), headers = new Headers(options.headers);
    let data;
    if (url.href === "https://sts.googleapis.com/v1/token") {
      assert.equal(options.data.get("subject_token"), token);
      assert.equal(options.data.get("scope"), "https://www.googleapis.com/auth/cloud-platform");
      events.push("sts");
      data = { access_token: "synthetic-federated", expires_in: 3600, token_type: "Bearer" };
    } else if (url.hostname === "iamcredentials.googleapis.com") {
      assert.equal(headers.get("authorization"), "Bearer synthetic-federated");
      assert.deepEqual(options.data.scope, ["https://www.googleapis.com/auth/cloud-platform"]);
      events.push("impersonation");
      data = { accessToken: "synthetic-service-account", expireTime: new Date(Date.now() + 3600000).toISOString() };
    } else if (url.hostname === "firestore.googleapis.com") {
      assert.match(url.pathname, /^\/v1\/projects\/test-downloads\/databases\/duckterm-downloads\/documents:/);
      assert.equal(headers.get("authorization"), "Bearer synthetic-service-account");
      const body = JSON.parse(options.body);
      if (url.pathname.endsWith(":batchGet")) {
        assert.equal(body.documents.length, 3);
        assert.ok(body.newTransaction?.readWrite);
        events.push("read");
        data = body.documents.map((name, i) => ({
          ...(documents.has(name) ? { found: documents.get(name) } : { missing: name }),
          readTime: new Date().toISOString(), ...(i === 0 ? { transaction: "ZmFrZQ==" } : {}),
        }));
      } else if (url.pathname.endsWith(":commit")) {
        assert.equal(body.transaction, "ZmFrZQ==");
        const writes = body.writes ?? [];
        for (const { update } of writes) {
          assert.equal(update.fields.version.integerValue, "1");
          assert.ok(update.fields.expireAt.timestampValue);
          assert.ok(update.fields.reservations.arrayValue.values.every(value => /^\d+$/.test(value.integerValue)));
          documents.set(update.name, { ...update, createTime: new Date().toISOString(), updateTime: new Date().toISOString() });
        }
        events.push(writes.length ? "write" : "empty-commit");
        data = { writeResults: writes.map(() => ({ updateTime: new Date().toISOString() })), commitTime: new Date().toISOString() };
      } else if (url.pathname.endsWith(":rollback")) {
        data = {};
      } else return denied();
    } else return denied();
    return Object.assign(new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } }), { data, config: options });
  });
  for (const Database of databases) {
    const run = Database.prototype.runTransaction;
    t.mock.method(Database.prototype, "runTransaction", async function (...args) {
      try { return await run.apply(this, args); }
      catch (error) { failures.push(error.message); throw error; }
    });
  }
  const post = email => route.routeModule.userland.POST(new Request("https://duckterm.utsava.xyz/api/code-download", {
    method: "POST", headers: { origin: "https://duckterm.utsava.xyz", "sec-fetch-site": "same-origin", "content-type": "application/json", "x-vercel-forwarded-for": "192.0.2.10" },
    body: JSON.stringify({ email, edition: "code", website: "" }),
  }));
  assert.equal((await post("fixture@gmail.com")).status, 200, failures.join("\n"));
  assert.equal(documents.size, 3);
  assert.deepEqual(events, ["sts", "impersonation", "read", "write", "mail"]);
  // Existing Firestore Timestamp/Long values must deserialize and preserve
  // cooldown; a new recipient shares the existing IP/global histories.
  assert.equal((await post("fixture@gmail.com")).status, 429, failures.join("\n"));
  assert.equal((await post("secondfixture@gmail.com")).status, 200, failures.join("\n"));
  assert.equal(documents.size, 4);
  assert.equal(events.filter(value => value === "write").length, 2);
  assert.equal(events.filter(value => value === "mail").length, 2);
  assert.deepEqual(failures, []);
  assert.equal(warnings.some(args => args[0] === "code_download_failure"), false);
});
