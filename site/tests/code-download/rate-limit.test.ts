import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { Timestamp, type Firestore } from "@google-cloud/firestore";
import { createRateLimiter } from "../../lib/code-download/rate-limit.ts";
import { createCodeDownloadHandler } from "../../lib/code-download/handler.ts";

const SECRET = "test-only-high-entropy-hmac-secret-32-bytes";
const START = 1_800_000_000_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
type Stored = { version: number; reservations: number[]; expireAt: Timestamp };
type Reference = { path: string };

function clone(value: Stored): Stored { return { ...value, reservations: [...value.reservations] }; }

// Serialize fake transactions across all limiter instances, stage writes, and
// commit only when the callback succeeds. Any read after a write fails the test.
class FakeFirestore {
  rows = new Map<string, Stored>();
  calls = 0;
  writes = 0;
  fail: "read" | "commit" | null = null;
  private queue: Promise<void> = Promise.resolve();
  collection(name: string) {
    assert.equal(name, "ducktermCodeDownloadLimits");
    return { doc: (id: string): Reference => ({ path: `${name}/${id}` }) };
  }
  async runTransaction<T>(callback: (transaction: {
    getAll(...references: Reference[]): Promise<{ exists: boolean; data(): Stored | undefined }[]>;
    set(reference: Reference, data: Stored): void;
  }) => Promise<T>, options: { maxAttempts: number }): Promise<T> {
    assert.equal(options.maxAttempts, 3);
    this.calls++;
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>(resolve => { release = resolve; });
    await previous;
    const staged = new Map<string, Stored>();
    let read = false;
    try {
      const result = await callback({
        getAll: async (...references) => {
          assert.equal(staged.size, 0, "read attempted after a write");
          assert.equal(references.length, 3, "all dimensions must be read together");
          if (this.fail === "read") throw new Error("Private database read failure");
          read = true;
          return references.map(reference => {
            const value = this.rows.get(reference.path);
            return { exists: value !== undefined, data: () => value && clone(value) };
          });
        },
        set: (reference, data) => { assert.ok(read); staged.set(reference.path, clone(data)); },
      });
      if (this.fail === "commit") throw new Error("Private database commit failure");
      for (const [path, value] of staged) this.rows.set(path, value);
      this.writes += staged.size;
      return result;
    } finally { release(); }
  }
}

function request(ip: string | null = "192.0.2.10", other: Record<string, string> = {}): Request {
  return new Request("https://duckterm.utsava.xyz/api/code-download", { headers: { ...(ip === null ? {} : { "x-vercel-forwarded-for": ip }), ...other } });
}
function fixture() {
  const database = new FakeFirestore();
  let now = START;
  const newLimiter = () => createRateLimiter({ hmacSecret: SECRET }, database as unknown as Firestore, () => now);
  return { database, limit: newLimiter(), newLimiter, at: (value: number) => { now = value; } };
}
function history(database: FakeFirestore, kind: string): Stored[] {
  return [...database.rows].filter(([path]) => path.includes(`/${kind}-`)).map(([, value]) => value);
}

test("concurrent requests through separate instances reserve one email exactly once", async () => {
  const f = fixture();
  const results = await Promise.all(Array.from({ length: 20 }, (_, index) => f.newLimiter()(request(`192.0.2.${index + 1}`), "ada@business.dev")));
  assert.equal(results.filter(result => result.allowed).length, 1);
  assert.equal(f.database.writes, 3);
  assert.equal(f.database.rows.size, 3, "blocked IPs must not create documents");
  for (const result of results.filter(result => !result.allowed)) assert.equal(result.retryAfterSeconds, 300);
});

test("cooldown and rolling daily email quota include exact boundary expiry without charging rejects", async () => {
  const f = fixture();
  assert.deepEqual(await f.limit(request(), "ada@business.dev"), { allowed: true });
  f.at(START + 5 * MINUTE - 1);
  assert.deepEqual(await f.limit(request(), "ada@business.dev"), { allowed: false, retryAfterSeconds: 1 });
  assert.equal(f.database.writes, 3);
  f.at(START + 5 * MINUTE);
  assert.equal((await f.limit(request(), "ada@business.dev")).allowed, true);
  f.at(START + 10 * MINUTE);
  assert.equal((await f.limit(request(), "ada@business.dev")).allowed, true);
  f.at(START + 15 * MINUTE);
  assert.deepEqual(await f.limit(request(), "ada@business.dev"), { allowed: false, retryAfterSeconds: (DAY - 15 * MINUTE) / 1000 });
  assert.equal(f.database.writes, 9);
  f.at(START + DAY);
  assert.equal((await f.newLimiter()(request(), "ada@business.dev")).allowed, true);
  assert.deepEqual(history(f.database, "email")[0].reservations, [START + 5 * MINUTE, START + 10 * MINUTE, START + DAY]);
  assert.equal((await f.limit(request(), "ada@business.dev")).retryAfterSeconds, 300);
});

test("Gmail case, dots, plus tags and googlemail aliases share only the quota identity", async () => {
  const f = fixture();
  const recipient = "Ada.Lovelace+DuckTerm@GoogleMail.com";
  assert.equal((await f.limit(request(), recipient)).allowed, true);
  for (const alias of ["adalovelace@gmail.com", "a.d.a.lovelace+other@gmail.com", "ADALOVELACE@googlemail.com"]) {
    assert.equal((await f.limit(request("192.0.2.11"), alias)).allowed, false);
  }
  assert.equal(recipient, "Ada.Lovelace+DuckTerm@GoogleMail.com");
  assert.equal(f.database.writes, 3);
});

test("non-Gmail identities ignore case but retain dots and plus tags", async () => {
  const f = fixture();
  assert.equal((await f.limit(request(), "Ada+Pilot@business.dev")).allowed, true);
  assert.equal((await f.limit(request(), "ada+pilot@BUSINESS.DEV")).allowed, false);
  assert.equal((await f.limit(request(), "ada@business.dev")).allowed, true);
  assert.equal((await f.limit(request(), "a.da@business.dev")).allowed, true);
});

test("IP hourly limit is atomic across distinct email addresses", async () => {
  const f = fixture();
  const results = await Promise.all(Array.from({ length: 12 }, (_, index) => f.newLimiter()(request(), `person${index}@business.dev`)));
  assert.equal(results.filter(result => result.allowed).length, 5);
  assert.equal(f.database.writes, 15);
  for (const result of results.filter(result => !result.allowed)) assert.equal(result.retryAfterSeconds, 3600);
  f.at(START + HOUR);
  assert.equal((await f.limit(request(), "new@business.dev")).allowed, true);
  assert.deepEqual(history(f.database, "ip")[0].reservations, [START + HOUR]);
});

test("only a single valid Vercel IP is trusted and other forwarding headers cannot substitute", async () => {
  const f = fixture();
  for (const ip of [null, "", "unknown", "192.0.2.1, 192.0.2.2", "192.0.2.1:443", "[2001:db8::1]", "2001:db8::1%en0", "999.2.3.4"]) {
    await assert.rejects(f.limit(request(ip, { "x-forwarded-for": "192.0.2.1", forwarded: "for=192.0.2.1", "x-real-ip": "192.0.2.1" }), "ada@business.dev"), /Trusted client IP unavailable/);
  }
  assert.equal(f.database.calls, 0);
  for (let index = 0; index < 6; index++) {
    const result = await f.limit(request("192.0.2.1", { "x-forwarded-for": `203.0.113.${index + 1}` }), `person${index}@business.dev`);
    assert.equal(result.allowed, index < 5, "spoofed generic forwarding headers changed quota identity");
  }
});

test("IPv6 equivalent spellings and IPv4-mapped IPv6 share IP quotas", async () => {
  const ipv6 = fixture();
  for (let index = 0; index < 5; index++) assert.equal((await ipv6.limit(request("2001:0db8:0000:0000:0000:0000:0000:000A"), `p${index}@business.dev`)).allowed, true);
  assert.equal((await ipv6.limit(request("2001:db8::a"), "blocked@business.dev")).allowed, false);
  const ipv4 = fixture();
  for (let index = 0; index < 5; index++) assert.equal((await ipv4.limit(request("::ffff:192.0.2.10"), `p${index}@business.dev`)).allowed, true);
  assert.equal((await ipv4.limit(request("192.0.2.10"), "blocked@business.dev")).allowed, false);
});

test("global rolling daily cap holds across independent instances and resets only as reservations expire", async () => {
  const f = fixture();
  const results = await Promise.all(Array.from({ length: 110 }, (_, index) => f.newLimiter()(request(`192.0.2.${index + 1}`), `person${index}@business.dev`)));
  assert.equal(results.filter(result => result.allowed).length, 100);
  assert.equal(f.database.writes, 300);
  assert.equal(history(f.database, "global")[0].reservations.length, 100);
  assert.deepEqual(results.at(-1), { allowed: false, retryAfterSeconds: 86400 });
  f.at(START + DAY - 1);
  assert.deepEqual(await f.limit(request("203.0.113.1"), "new@business.dev"), { allowed: false, retryAfterSeconds: 1 });
  assert.equal(f.database.writes, 300);
  f.at(START + DAY);
  assert.equal((await f.limit(request("203.0.113.1"), "new@business.dev")).allowed, true);
  assert.deepEqual(history(f.database, "global")[0].reservations, [START + DAY]);
});

test("Firestore stores domain-separated HMAC IDs and timestamp-only state with correctly scoped TTL", async () => {
  const f = fixture();
  await f.limit(request(), "Ada.Lovelace+Pilot@gmail.com");
  for (const [path, value] of f.database.rows) {
    assert.match(path, /^ducktermCodeDownloadLimits\/(email|ip|global)-[0-9a-f]{64}$/);
    assert.deepEqual(Object.keys(value).sort(), ["expireAt", "reservations", "version"]);
    assert.ok(value.expireAt instanceof Timestamp);
    assert.equal(value.expireAt.toMillis(), START + (path.includes("/ip-") ? HOUR : DAY));
  }
  const expectedEmail = createHmac("sha256", SECRET).update("email\0adalovelace@gmail.com").digest("hex");
  assert.ok(f.database.rows.has(`ducktermCodeDownloadLimits/email-${expectedEmail}`));
  const serialized = JSON.stringify([...f.database.rows]);
  for (const privateValue of ["Ada", "Lovelace", "gmail.com", "192.0.2.10", SECRET]) assert.ok(!serialized.includes(privateValue));
  // TTL cleanup need not have run: stale rows are replaced, not trusted forever.
  f.at(START + 2 * DAY);
  assert.equal((await f.limit(request(), "Ada.Lovelace+Pilot@gmail.com")).allowed, true);
  for (const value of f.database.rows.values()) assert.deepEqual(value.reservations, [START + 2 * DAY]);
});

test("database failures propagate and unsuccessful commits reserve nothing", async () => {
  for (const failure of ["read", "commit"] as const) {
    const f = fixture();
    f.database.fail = failure;
    await assert.rejects(f.limit(request(), "ada@business.dev"), /Private database/);
    assert.equal(f.database.rows.size, 0);
    assert.equal(f.database.writes, 0);
    f.database.fail = null;
    assert.equal((await f.limit(request(), "ada@business.dev")).allowed, true);
  }
});

test("invalid configuration, malformed stored history and clock rollback fail closed", async () => {
  const f = fixture();
  assert.throws(() => createRateLimiter({ hmacSecret: "short" }, f.database as unknown as Firestore), /configuration unavailable/);
  await f.limit(request(), "ada@business.dev");
  const writes = f.database.writes;
  f.at(START - 1);
  await assert.rejects(f.limit(request(), "ada@business.dev"), /state unavailable/);
  f.at(START);
  history(f.database, "email")[0].reservations.push(Number.NaN);
  await assert.rejects(f.limit(request(), "ada@business.dev"), /state unavailable/);
  assert.equal(f.database.writes, writes);
});

function editionRequest(edition: "code" | "full", email: string): Request {
  return new Request("https://duckterm.utsava.xyz/api/code-download", {
    method: "POST", headers: { origin: "https://duckterm.utsava.xyz", "sec-fetch-site": "same-origin", "content-type": "application/json", "x-vercel-forwarded-for": "192.0.2.10" },
    body: JSON.stringify({ email, edition }),
  });
}

test("switching editions cannot bypass an email cooldown, including concurrent requests", async () => {
  const f = fixture();
  const sent: string[] = [];
  const handler = () => createCodeDownloadHandler({ allowedOrigin: "https://duckterm.utsava.xyz" }, {
    rateLimit: f.newLimiter(), lookupMailbox: async () => ({ status: "valid" }),
    sendMail: async ({ edition }) => { sent.push(edition); return { accepted: true }; },
  });
  const responses = await Promise.all([handler()(editionRequest("code", "ada@business.dev")), handler()(editionRequest("full", "ada@business.dev"))]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 429]);
  assert.equal(sent.length, 1);
  assert.equal(f.database.writes, 3);
  assert.equal(f.database.rows.size, 3);
});

test("alternating Code and Full shares the same IP and global reservations", async () => {
  const f = fixture();
  const sent: string[] = [];
  const handle = createCodeDownloadHandler({ allowedOrigin: "https://duckterm.utsava.xyz" }, {
    rateLimit: f.limit, lookupMailbox: async () => ({ status: "valid" }),
    sendMail: async ({ edition }) => { sent.push(edition); return { accepted: true }; },
  });
  for (let index = 0; index < 6; index++) {
    const response = await handle(editionRequest(index % 2 ? "full" : "code", `person${index}@business.dev`));
    assert.equal(response.status, index < 5 ? 200 : 429);
  }
  assert.deepEqual(sent, ["code", "full", "code", "full", "code"]);
  assert.equal(history(f.database, "ip").length, 1);
  assert.equal(history(f.database, "global").length, 1);
  assert.equal(history(f.database, "global")[0].reservations.length, 5);
});
