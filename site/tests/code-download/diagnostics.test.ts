import assert from "node:assert/strict";
import { test } from "node:test";
import { DownloadStageError, reportDownloadFailure, type DownloadFailureEvent } from "../../lib/code-download/diagnostics.ts";

test("failure reports retain only fixed stages, numeric statuses and allowlisted Google reasons", () => {
  const events: DownloadFailureEvent[] = [];
  reportDownloadFailure("rate_limit", {
    code: 7,
    cause: { response: { status: 403, data: { error: { details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "IAM_PERMISSION_DENIED" }] } } } },
  }, event => events.push(event));
  assert.deepEqual(events, [{ stage: "rate_limit", grpcStatus: 7, httpStatus: 403, reason: "IAM_PERMISSION_DENIED" }]);
});

test("credential-like payloads, messages, URLs, headers and bodies never reach the reporter", () => {
  const events: DownloadFailureEvent[] = [];
  const secret = "private@example.com Bearer PRIVATE_TOKEN https://private.invalid/?key=PRIVATE_KEY 192.0.2.123";
  const error = {
    stage: secret, code: secret, status: "403", reason: secret, stack: secret,
    config: { url: secret, headers: { authorization: secret }, body: secret },
    response: { status: secret, headers: { authorization: secret }, data: { error: { message: secret, details: [{ reason: secret }] } } },
    get message(): never { throw new Error("Messages must not be read"); },
    toJSON(): never { throw new Error("Errors must not be serialized"); },
  };
  reportDownloadFailure("gmail", error, event => events.push(event));
  assert.deepEqual(events, [{ stage: "gmail" }]);
  assert.equal(JSON.stringify(events).includes(secret), false);
  let reads = 0;
  const changing: DownloadFailureEvent[] = [];
  reportDownloadFailure("rate_limit", { get code() { return ++reads === 1 ? 7 : secret; } }, event => changing.push(event));
  assert.deepEqual(changing, [{ stage: "rate_limit", grpcStatus: 7 }]);
  assert.equal(reads, 1);
  for (const value of [-1, 0, 17, 399, 600, NaN, Infinity, 403.5, "403"]) {
    const invalid: DownloadFailureEvent[] = [];
    reportDownloadFailure("mailbox", { code: value, status: value }, event => invalid.push(event));
    assert.deepEqual(invalid, [{ stage: "mailbox" }]);
  }
});

test("known IP and OIDC stages survive SDK cause wrappers without exposing original errors", () => {
  for (const stage of ["trusted_ip", "oidc"] as const) {
    const cause = new DownloadStageError(stage, new Error("PRIVATE_CREDENTIAL"));
    const wrapped = new Error("SDK PRIVATE_REQUEST", { cause });
    const events: DownloadFailureEvent[] = [];
    reportDownloadFailure("rate_limit", wrapped, event => events.push(event));
    assert.deepEqual(events, [{ stage }]);
  }
});

test("bounded cyclic causes, unusual getters and a broken reporter cannot affect requests", () => {
  const cycle: { code: number; cause?: unknown } = { code: 14 }; cycle.cause = cycle;
  const events: DownloadFailureEvent[] = [];
  reportDownloadFailure("rate_limit", cycle, event => events.push(event));
  let deep: unknown = { status: 403 };
  for (let depth = 0; depth < 4; depth++) deep = { cause: deep };
  reportDownloadFailure("rate_limit", deep, event => events.push(event));
  reportDownloadFailure("rate_limit", { get response(): never { throw new Error("PRIVATE"); } }, event => events.push(event));
  assert.deepEqual(events, [{ stage: "rate_limit", grpcStatus: 14 }, { stage: "rate_limit" }, { stage: "rate_limit" }]);
  assert.doesNotThrow(() => reportDownloadFailure("gmail", new Error("PRIVATE"), () => { throw new Error("Reporter failed"); }));
});
