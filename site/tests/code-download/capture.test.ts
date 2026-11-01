import assert from "node:assert/strict";
import { test } from "node:test";
import { Timestamp, type Firestore } from "@google-cloud/firestore";
import { createDownloadRecorder } from "../../lib/code-download/capture.ts";

const NOW = 1_800_000_000_123;
const RETENTION = 30 * 24 * 60 * 60 * 1000;
type RecordInput = Parameters<ReturnType<typeof createDownloadRecorder>>[0];

function fixture(clock: () => number = () => NOW) {
  const documents: { id: string; data: Record<string, unknown> }[] = [];
  const allocated: string[] = [];
  let failure: Error | undefined;
  const database = {
    collection(name: string) {
      assert.equal(name, "ducktermDownloadRequests");
      return { doc(...args: unknown[]) {
        assert.deepEqual(args, [], "PII must never be used as a Firestore document ID");
        const id = `synthetic-auto-id-${allocated.length}`;
        allocated.push(id);
        return { async create(data: Record<string, unknown>) {
          if (failure) throw failure;
          documents.push({ id, data });
        } };
      } };
    },
  };
  return {
    documents, allocated,
    record: createDownloadRecorder(database as unknown as Firestore, clock),
    fail(error: Error) { failure = error; },
  };
}

test("capture records the selected edition and address using an automatic ID and a 30-day expiry", async () => {
  const f = fixture();
  for (const edition of ["code", "full"] as const) {
    await f.record({ email: "Ada.Lovelace+Download@gmail.com", edition });
    const document = f.documents.at(-1)!;
    assert.deepEqual(Object.keys(document.data).sort(), ["edition", "email", "expireAt", "requestedAt", "version"]);
    assert.equal(document.data.version, 1);
    assert.equal(document.data.email, "Ada.Lovelace+Download@gmail.com", "capture must not apply quota-only Gmail alias normalization");
    assert.equal(document.data.edition, edition);
    assert.ok(document.data.requestedAt instanceof Timestamp);
    assert.ok(document.data.expireAt instanceof Timestamp);
    assert.equal(document.data.requestedAt.toMillis(), NOW);
    assert.equal(document.data.expireAt.toMillis(), NOW + RETENTION);
    assert.doesNotMatch(document.id, /Ada|Lovelace|gmail|@|\+/);
  }
  assert.equal(new Set(f.documents.map(document => document.id)).size, 2);
});

test("repeat downloads create independent records with the time of each request", async () => {
  let now = NOW;
  const f = fixture(() => now);
  const input = { email: "reader@business.dev", edition: "code" as const };
  await f.record(input);
  now += 10_000;
  await f.record(input);
  assert.equal(f.documents.length, 2);
  assert.notEqual(f.documents[0].id, f.documents[1].id);
  assert.equal((f.documents[0].data.requestedAt as Timestamp).toMillis(), NOW);
  assert.equal((f.documents[1].data.requestedAt as Timestamp).toMillis(), now);
  assert.equal((f.documents[1].data.expireAt as Timestamp).toMillis(), now + RETENTION);
});

test("invalid address or edition never allocates or writes a capture document", async () => {
  const f = fixture();
  for (const input of [
    null, undefined, {}, [],
    { email: "invalid", edition: "code" },
    { email: "person@example.com", edition: "code" },
    { email: "person@mailinator.com", edition: "full" },
    { email: "reader@gmail.com\r\nBcc: other@gmail.com", edition: "code" },
    { email: "reader@business.dev", edition: "lite" },
    { email: "reader@business.dev", edition: "__proto__" },
    { email: "reader@business.dev", edition: {} },
  ]) await assert.rejects(f.record(input as RecordInput));
  assert.deepEqual(f.documents, []);
  assert.deepEqual(f.allocated, []);
});

test("invalid or unrepresentable request times fail without writing a capture", async () => {
  for (const now of [NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER, 253402300799999]) {
    const f = fixture(() => now);
    await assert.rejects(f.record({ email: "reader@business.dev", edition: "full" }));
    assert.deepEqual(f.documents, [], String(now));
  }
});

test("storage failures propagate without retries or partial success", async () => {
  const f = fixture();
  const error = new Error("Synthetic private storage failure");
  f.fail(error);
  await assert.rejects(f.record({ email: "reader@business.dev", edition: "code" }), value => value === error);
  assert.equal(f.allocated.length, 1);
  assert.deepEqual(f.documents, []);
});
