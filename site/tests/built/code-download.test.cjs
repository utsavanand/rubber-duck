const assert = require("node:assert/strict");
const { test } = require("node:test");
const path = require("node:path");

test("built immediate-download route verifies Basic BotID and serializes real Firestore quota and capture writes", { timeout: 20000 }, async t => {
  // node --test gives this file its own process. Replace only that process's
  // environment view; never clear inherited variables or rewrite HOME.
  // Guards last for the entire isolated child lifetime, including a failed
  // test deadline; restoring real transports could let late SDK work escape.
  const patch = (owner, method, replacement) => { owner[method] = replacement; };
  const violations = [], events = [], warnings = [], transportFailures = [];
  const settings = {
    NODE_ENV: "production", VERCEL_ENV: "production", DOWNLOAD_CAPTURE_ENABLED: "true",
    CODE_DOWNLOAD_ORIGIN: "https://duckterm.utsava.xyz", GCP_PROJECT_ID: "test-downloads",
    GCP_PROJECT_NUMBER: "123456789012", GCP_SERVICE_ACCOUNT_EMAIL: "downloads@test-downloads.iam.gserviceaccount.com",
    GCP_WORKLOAD_IDENTITY_POOL_ID: "duckterm-vercel", GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: "production",
    GCP_FIRESTORE_DATABASE: "duckterm-downloads", CODE_DOWNLOAD_RATE_SECRET: "synthetic-test-secret-never-production",
  };
  const forbidden = reason => {
    violations.push(reason);
    throw new Error(reason);
  };
  const inspectKey = key => {
    if (typeof key === "string" && (key.startsWith("GMAIL_") || key === "CODE_DOWNLOAD_ENABLED")) forbidden(`Parked mail setting read: ${key}`);
  };
  process.env = new Proxy(settings, {
    get(target, key) { inspectKey(key); return Reflect.get(target, key); },
    has(target, key) { inspectKey(key); return Reflect.has(target, key); },
    getOwnPropertyDescriptor(target, key) { inspectKey(key); return Reflect.getOwnPropertyDescriptor(target, key); },
  });

  // Every unhandled transport is fatal even when the production handler
  // deliberately catches infrastructure errors and returns the public URL.
  const denied = () => forbidden("Unexpected network or mail access in built-route test");
  for (const name of ["node:http", "node:https"]) {
    for (const method of ["request", "get"]) patch(require(name), method, denied);
  }
  for (const method of ["connect", "createConnection"]) patch(require("node:net"), method, denied);
  patch(require("node:net").Socket.prototype, "connect", denied);
  patch(require("node:tls"), "connect", denied);
  for (const method of ["lookup", "resolve", "resolveMx", "resolve4", "resolve6"]) patch(require("node:dns"), method, denied);
  const fs = require("node:fs");
  const checkFile = file => {
    const name = String(file);
    if (/(?:^|[/\\])(?:\.env(?:\.[^/\\]*)?|application_default_credentials\.json|credentials\.json|auth\.json|\.netrc)$/.test(name)) forbidden("Credential file read in built-route test");
  };
  for (const owner of [fs, fs.promises]) {
    for (const method of ["readFile", "open", ...(owner === fs ? ["readFileSync", "openSync"] : [])]) {
      const original = owner[method];
      patch(owner, method, function (file, ...args) { checkFile(file); return original.call(this, file, ...args); });
    }
  }
  const Module = require("node:module"), load = Module._load;
  patch(Module, "_load", function (request, ...args) {
    if (/(?:^|[/\\])(?:gmail(?:-authorize)?|nodemailer)(?:[/.]|$)/i.test(request)) forbidden("Gmail module loaded in immediate-download route");
    return load.call(this, request, ...args);
  });
  patch(console, "warn", (...args) => warnings.push(args));

  const token = Buffer.from("{}").toString("base64url") + "." + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url") + ".synthetic";
  const apiURL = "https://duckterm.utsava.xyz/api/code-download";
  let context;
  globalThis[Symbol.for("@vercel/request-context")] = { get: () => context };
  // A concrete permission failure is non-retryable in the real REST SDK.
  // Transport outages and their retry deadlines are a separate contract.
  const unavailable = Object.assign(new Error("Synthetic dependency refusal"), { status: 403 });
  let bot = "human", broken = "", requestStarted = 0;
  const { Resolver } = require("node:dns/promises");
  patch(Resolver.prototype, "resolveMx", async () => {
    events.push("dns");
    if (broken === "dns") throw unavailable;
    return [{ exchange: "smtp.gmail.com", priority: 10 }];
  });
  patch(Resolver.prototype, "resolve4", denied);
  patch(Resolver.prototype, "resolve6", denied);
  patch(globalThis, "fetch", async (input, options) => {
    const url = new URL(String(input));
    if (url.origin !== "https://api.vercel.com" || url.pathname !== "/bot-protection/v1/is-bot") return denied();
    events.push("bot");
    try {
      assert.equal(options.method, "POST");
      assert.equal(url.searchParams.get("v"), "3");
      const body = JSON.parse(options.body);
      assert.equal(body.forceCheckLevel, "basic");
      assert.equal(body.url, apiURL);
      assert.equal(body.method, "POST");
      assert.equal(body.vercelOidcToken, token);
      assert.equal(new Headers(options.headers).get("x-vercel-oidc-token"), token);
      assert.equal(new Map(body.headers).get("host"), "duckterm.utsava.xyz");
      assert.equal(new Map(body.headers).get("x-is-human"), "synthetic-challenge");
    } catch (error) { transportFailures.push(error.message); throw error; }
    if (broken === "bot") throw unavailable;
    return Response.json({ isBot: bot === "bot", bypassed: bot === "bypassed", isVerifiedBot: bot === "verified" });
  });

  // Load the optimized production artifact and intercept only its HTTP
  // adapters. Firestore's serializers, transactions and Long/Timestamp types
  // remain real, including if a future config accidentally bundles the SDK.
  const server = path.resolve(__dirname, "../../.next/server");
  const route = require(path.join(server, "app/api/code-download/route.js"));
  const webpack = require(path.join(server, "webpack-runtime.js"));
  const transports = new Set(), databases = new Set();
  for (const module of [...Object.values(require.cache), ...Object.values(webpack.c)]) {
    if (module.exports?.Gaxios?.prototype?.request) transports.add(module.exports.Gaxios);
    if (module.exports?.Firestore?.prototype?.runTransaction) databases.add(module.exports.Firestore);
  }
  assert.ok(transports.size > 0);
  assert.equal(databases.size, 1);
  const assertNoMailModules = () => {
    assert.equal(Object.keys(require.cache).some(file => /[/\\](?:gmail(?:-authorize)?|nodemailer)(?:[/.]|$)/i.test(file)), false);
    assert.equal(Object.values(webpack.m).some(factory => /createGmailSender|gmail\.googleapis\.com|GMAIL_(?:CLIENT|REFRESH|FROM)/.test(String(factory))), false);
  };
  assertNoMailModules();
  const documents = new Map(), captures = new Map();
  const prefix = "projects/test-downloads/databases/duckterm-downloads/documents/";
  for (const Transport of transports) patch(Transport.prototype, "request", async options => {
    try {
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
          for (const name of body.documents) {
            assert.ok(name.startsWith(prefix));
            assert.match(name.slice(prefix.length), /^ducktermCodeDownloadLimits\/(?:email|ip|global)-[a-f0-9]{64}$/);
          }
          events.push("read");
          if (broken === "firestore") throw unavailable;
          data = body.documents.map((name, i) => ({
            ...(documents.has(name) ? { found: documents.get(name) } : { missing: name }),
            readTime: new Date().toISOString(), ...(i === 0 ? { transaction: "ZmFrZQ==" } : {}),
          }));
        } else if (url.pathname.endsWith(":commit")) {
          const writes = body.writes ?? [], now = new Date().toISOString();
          if (body.transaction) {
            assert.equal(body.transaction, "ZmFrZQ==");
            for (const { update } of writes) {
              assert.ok(update.name.startsWith(prefix));
              assert.equal(update.fields.version.integerValue, "1");
              assert.ok(Number.isFinite(Date.parse(update.fields.expireAt.timestampValue)));
              assert.ok(update.fields.reservations.arrayValue.values.every(value => /^\d+$/.test(value.integerValue)));
              assert.deepEqual(Object.keys(update.fields).sort(), ["expireAt", "reservations", "version"]);
              assert.equal(JSON.stringify(update).includes("@"), false);
              documents.set(update.name, { ...update, createTime: now, updateTime: now });
            }
            events.push(writes.length ? "quota-write" : "empty-commit");
          } else {
            assert.equal(writes.length, 1);
            const { update, currentDocument } = writes[0];
            assert.deepEqual(currentDocument, { exists: false });
            assert.ok(update.name.startsWith(prefix));
            assert.match(update.name.slice(prefix.length), /^ducktermDownloadRequests\/[A-Za-z0-9]{20}$/);
            assert.equal(captures.has(update.name), false);
            assert.deepEqual(Object.keys(update.fields).sort(), ["edition", "email", "expireAt", "requestedAt", "version"]);
            assert.equal(update.fields.version.integerValue, "1");
            const requested = Date.parse(update.fields.requestedAt.timestampValue);
            assert.ok(requested >= requestStarted && requested <= Date.now());
            assert.equal(Date.parse(update.fields.expireAt.timestampValue) - requested, 30 * 24 * 60 * 60 * 1000);
            events.push("record");
            if (broken === "record") throw unavailable;
            captures.set(update.name, update.fields);
          }
          data = { writeResults: writes.map(() => ({ updateTime: now })), commitTime: now };
        } else if (url.pathname.endsWith(":rollback")) {
          data = {};
        } else return denied();
      } else return denied();
      return Object.assign(new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } }), { data, config: options });
    } catch (error) {
      if (error !== unavailable) transportFailures.push(error.message);
      throw error;
    }
  });
  const post = (email, edition = "code", edgeHeaders = {}) => {
    requestStarted = Date.now();
    context = {
      headers: { host: "duckterm.utsava.xyz", "x-is-human": "synthetic-challenge", "x-vercel-oidc-token": token, ...edgeHeaders },
      url: apiURL,
      mutateResponseHeadersBeforeFlush: callback => callback(new Headers()),
    };
    return route.routeModule.userland.POST(new Request(apiURL, {
      method: "POST", headers: { origin: "https://duckterm.utsava.xyz", "sec-fetch-site": "same-origin", "content-type": "application/json", "x-vercel-forwarded-for": "192.0.2.10" },
      body: JSON.stringify({ email, edition, website: "" }),
    }));
  };
  const ready = async (response, edition = "code") => {
    assert.equal(response.status, 200, transportFailures.join("\n"));
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {
      ok: true, edition,
      url: `https://github.com/utsavanand/duckterm/releases/latest/download/DuckTerm-${edition === "code" ? "Code" : "Full"}-macos-arm64.zip`,
      message: "Your download is ready.",
    });
  };

  await t.test("human capture uses Basic BotID before quota, DNS and a create-only 30-day record", async () => {
    await ready(await post("Fixture.Name+tag@gmail.com"));
    assert.equal(documents.size, 3);
    assert.equal(captures.size, 1);
    assert.equal([...captures.values()][0].email.stringValue, "Fixture.Name+tag@gmail.com");
    assert.equal([...captures.values()][0].edition.stringValue, "code");
    assert.deepEqual(events, ["bot", "sts", "impersonation", "read", "quota-write", "dns", "record"]);
    assert.equal(warnings.some(args => args[0] === "code_download_failure"), false);
  });
  await t.test("existing Long/Timestamp quota state returns the same URL during cooldown without another record", async () => {
    events.length = 0;
    await ready(await post("Fixture.Name+tag@gmail.com"));
    assert.equal(captures.size, 1);
    assert.equal(events[0], "bot");
    assert.ok(events.includes("read"));
    assert.equal(events.some(event => ["quota-write", "dns", "record"].includes(event)), false);
    assert.equal(warnings.some(args => args[0] === "code_download_failure"), false);
  });
  await t.test("Full returns only the fixed Full URL and records its distinct edition", async () => {
    events.length = 0;
    await ready(await post("secondfixture@gmail.com", "full"), "full");
    assert.equal(captures.size, 2);
    assert.equal([...captures.values()][1].edition.stringValue, "full");
    assert.equal([...captures.values()][1].email.stringValue, "secondfixture@gmail.com");
    assert.equal(events[0], "bot");
    assert.equal(warnings.some(args => args[0] === "code_download_failure"), false);
  });
  for (const verdict of ["bot", "bypassed", "verified"]) await t.test(`${verdict} request gets its public URL without Firestore or DNS`, async () => {
    bot = verdict; events.length = 0;
    await ready(await post("blockedfixture@gmail.com"));
    assert.deepEqual(events, ["bot"]);
    assert.equal(captures.size, 2);
  });
  bot = "human";
  await t.test("missing challenges skip the SDK without logging attacker-supplied method headers", async () => {
    const bait = "synthetic-private-address@gmail.com";
    for (const challenge of [undefined, ""]) {
      events.length = 0;
      const warningCount = warnings.length;
      await ready(await post("blockedfixture@gmail.com", "code", { "x-is-human": challenge, "x-method": bait }));
      assert.deepEqual(events, []);
      assert.equal(warnings.length, warningCount);
      assert.equal(captures.size, 2);
    }
    assert.equal(JSON.stringify(warnings).includes(bait), false);
  });
  await t.test("invalid input never reaches BotID", async () => {
    events.length = 0;
    assert.equal((await post("not-an-address")).status, 400);
    assert.equal((await post("fixture@gmail.com", "https://attacker.invalid/file")).status, 400);
    assert.deepEqual(events, []);
  });
  await t.test("disabled capture keeps downloads available without reading the parked mail flag", async () => {
    settings.DOWNLOAD_CAPTURE_ENABLED = "false"; events.length = 0;
    await ready(await post("disabledfixture@gmail.com", "full"), "full");
    assert.deepEqual(events, ["bot"]);
    settings.DOWNLOAD_CAPTURE_ENABLED = "true";
  });
  await t.test("incomplete capture configuration still returns the download without Firestore or DNS", async () => {
    const project = settings.GCP_PROJECT_ID;
    delete settings.GCP_PROJECT_ID; events.length = 0;
    await ready(await post("missingconfig@gmail.com"));
    assert.deepEqual(events, ["bot"]);
    settings.GCP_PROJECT_ID = project;
  });
  for (const dependency of ["bot", "firestore", "dns", "record"]) await t.test(`${dependency} refusal leaves the fixed public download available`, async () => {
    broken = dependency; documents.clear(); captures.clear(); events.length = 0;
    await ready(await post("unavailablefixture@gmail.com"));
    assert.equal(captures.size, 0);
    assert.equal(events[0], "bot");
    if (dependency === "bot") assert.deepEqual(events, ["bot"]);
    if (dependency === "firestore") assert.equal(events.some(event => ["dns", "record"].includes(event)), false);
    if (dependency === "dns") assert.equal(events.includes("record"), false);
    if (dependency === "record") assert.ok(events.includes("record"));
    broken = "";
  });
  assert.deepEqual(violations, []);
  assert.deepEqual(transportFailures, []);
  assertNoMailModules();
  const diagnostics = JSON.stringify(warnings);
  for (const value of ["Fixture.Name+tag@gmail.com", "secondfixture@gmail.com", "unavailablefixture@gmail.com", token, "synthetic-service-account"]) assert.equal(diagnostics.includes(value), false);
});
