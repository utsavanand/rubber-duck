import assert from "node:assert/strict";
import { test } from "node:test";
import { createMailboxLookup, type MailboxResolver } from "../../lib/code-download/mailbox.ts";

function dnsError(code: string): Error { return Object.assign(new Error("Private DNS detail"), { code }); }
function resolver(overrides: Partial<MailboxResolver> = {}) {
  const calls: string[] = [];
  const methods: MailboxResolver = {
    resolveMx: async () => [{ exchange: "mail.business.dev.", priority: 10 }],
    resolve4: async () => { throw dnsError("ENODATA"); },
    resolve6: async () => { throw dnsError("ENODATA"); },
    ...overrides,
  };
  const tracked: MailboxResolver = {
    resolveMx: async domain => { calls.push("MX"); return methods.resolveMx(domain); },
    resolve4: async domain => { calls.push("A"); return methods.resolve4(domain); },
    resolve6: async domain => { calls.push("AAAA"); return methods.resolve6(domain); },
  };
  return { calls, lookup: createMailboxLookup(tracked) };
}

test("ordinary MX is valid without A/AAAA fallback", async () => {
  const { lookup, calls } = resolver();
  assert.deepEqual(await lookup("business.dev"), { status: "valid" });
  assert.deepEqual(calls, ["MX"]);
});

test("both resolver representations of null MX reject without address fallback", async () => {
  for (const exchange of [".", ""]) {
    const { lookup, calls } = resolver({ resolveMx: async () => [{ exchange, priority: 0 }], resolve4: async () => ["192.0.2.1"] });
    assert.deepEqual(await lookup("business.dev"), { status: "invalid" });
    assert.deepEqual(calls, ["MX"]);
  }
});

test("absent MX permits either an IPv4 or IPv6 implicit mail exchanger", async () => {
  const ipv4 = resolver({ resolveMx: async () => { throw dnsError("ENODATA"); }, resolve4: async () => ["192.0.2.1"] });
  assert.deepEqual(await ipv4.lookup("business.dev"), { status: "valid" });
  assert.deepEqual(ipv4.calls, ["MX", "A", "AAAA"]);
  const ipv6 = resolver({ resolveMx: async () => [], resolve6: async () => ["2001:db8::1"] });
  assert.deepEqual(await ipv6.lookup("business.dev"), { status: "valid" });
});

test("no mail/address records and nonexistent domains are invalid", async () => {
  assert.deepEqual(await resolver({ resolveMx: async () => [] }).lookup("business.dev"), { status: "invalid" });
  const missing = resolver({ resolveMx: async () => { throw dnsError("ENOTFOUND"); } });
  assert.deepEqual(await missing.lookup("business.dev"), { status: "invalid" });
  assert.deepEqual(missing.calls, ["MX"]);
});

test("transient DNS failures stay retryable and do not masquerade as invalid email", async () => {
  for (const code of ["ETIMEOUT", "ESERVFAIL", "ECONNREFUSED", "EREFUSED"]) {
    const mx = resolver({ resolveMx: async () => { throw dnsError(code); } });
    assert.deepEqual(await mx.lookup("business.dev"), { status: "unavailable" });
    assert.deepEqual(mx.calls, ["MX"]);
    const address = resolver({ resolveMx: async () => [], resolve4: async () => { throw dnsError(code); } });
    assert.deepEqual(await address.lookup("business.dev"), { status: "unavailable" });
  }
  const ipv6StillWorks = resolver({ resolveMx: async () => [], resolve4: async () => { throw dnsError("ETIMEOUT"); }, resolve6: async () => ["2001:db8::1"] });
  assert.deepEqual(await ipv6StillWorks.lookup("business.dev"), { status: "valid" });
});

test("malformed or contradictory MX records fail closed", async () => {
  for (const records of [[{ exchange: "mail host", priority: 0 }], [{ exchange: "mail.business.dev", priority: -1 }], [{ exchange: ".", priority: 0 }, { exchange: "mail.business.dev", priority: 10 }]]) {
    const { lookup, calls } = resolver({ resolveMx: async () => records });
    assert.deepEqual(await lookup("business.dev"), { status: "unavailable" });
    assert.deepEqual(calls, ["MX"]);
  }
});
