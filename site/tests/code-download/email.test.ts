import assert from "node:assert/strict";
import { test } from "node:test";
import { validateEmail } from "../../lib/code-download/email.ts";

test("accepts real-provider/custom addresses, plus tags and the local part test", () => {
  for (const address of ["Ada+code@gmail.com", "person@icloud.com", "test@gmail.com", "test@small-studio.dev", "first.last@sub.business.co.uk", "a@notmailinator.com"]) {
    assert.deepEqual(validateEmail(address), { valid: true, email: address, domain: address.split("@")[1] });
  }
  assert.deepEqual(validateEmail("  Ada+Code@GMAIL.COM  "), { valid: true, email: "Ada+Code@gmail.com", domain: "gmail.com" });
  assert.deepEqual(validateEmail("Person@BÜCHER.DE"), { valid: true, email: "Person@xn--bcher-kva.de", domain: "xn--bcher-kva.de" });
});

test("rejects malformed email without treating arbitrary local parts as dummy", () => {
  for (const value of [null, {}, 42, "", "missing-at", "a@@gmail.com", "@gmail.com", "a@", "a b@gmail.com", ".a@gmail.com", "a..b@gmail.com", "a.@gmail.com", "a\r\nBcc:b@gmail.com", "a@bad_domain.com", "a@-bad.com", "a@bad-.com", "a@gmail.com.", "a@127.0.0.1", "a@[::1]", "a@gmail.com:443", "a@gmail.com/path", "a@gmail.com%2f", "a@gmail.com?x", "A <a@gmail.com>", `${"a".repeat(65)}@gmail.com`, `a@${"b".repeat(64)}.com`]) {
    assert.deepEqual(validateEmail(value), { valid: false }, String(value));
  }
});

test("rejects reserved and explicit disposable domains, including normalized subdomains", () => {
  for (const domain of ["example.com", "sub.example.net", "example.org", "anything.example", "anything.test", "localhost", "sub.localhost", "anything.invalid", "sub.local", "MAILINATOR.COM", "inbox.mailinator.com", "guerrillamail.com", "sharklasers.com", "10minutemail.com", "yopmail.com", "ｅｘａｍｐｌｅ.com"]) {
    assert.deepEqual(validateEmail(`person@${domain}`), { valid: false }, domain);
  }
});
