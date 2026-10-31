import assert from "node:assert/strict";
import { test } from "node:test";
import { readDownloadConfig } from "../../lib/code-download/config.ts";

const env = {
  VERCEL_ENV: "production", CODE_DOWNLOAD_ENABLED: "true",
  CODE_DOWNLOAD_ORIGIN: "https://duckterm.utsava.xyz", GCP_PROJECT_ID: "test-downloads",
  GCP_PROJECT_NUMBER: "123456789012", GCP_SERVICE_ACCOUNT_EMAIL: "downloads@test-downloads.iam.gserviceaccount.com",
  GCP_WORKLOAD_IDENTITY_POOL_ID: "duckterm-vercel", GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: "production",
  GCP_FIRESTORE_DATABASE: "duckterm-downloads",
  CODE_DOWNLOAD_RATE_SECRET: "synthetic-test-secret-never-used-in-production", GMAIL_CLIENT_ID: "synthetic-client",
  GMAIL_CLIENT_SECRET: "synthetic-client-secret", GMAIL_REFRESH_TOKEN: "synthetic-refresh", GMAIL_FROM: "sender@gmail.com",
};

test("production download setup requires every field and the explicit enable switch", () => {
  assert.ok(readDownloadConfig(env));
  for (const key of Object.keys(env)) {
    const missing: Record<string, string | undefined> = { ...env }; delete missing[key];
    assert.equal(readDownloadConfig(missing), null, key);
  }
  assert.equal(readDownloadConfig({ ...env, VERCEL_ENV: "preview" }), null);
  assert.equal(readDownloadConfig({ ...env, CODE_DOWNLOAD_ENABLED: "false" }), null);
});

test("download config rejects arbitrary origins, identities and weak rate secrets", () => {
  for (const change of [
    { CODE_DOWNLOAD_ORIGIN: "https://attacker.invalid" },
    { GCP_SERVICE_ACCOUNT_EMAIL: "downloads@other-project.iam.gserviceaccount.com" },
    { GCP_PROJECT_NUMBER: "1234/../../" }, { GCP_FIRESTORE_DATABASE: "(default)" },
    { CODE_DOWNLOAD_RATE_SECRET: "short" },
  ]) assert.equal(readDownloadConfig({ ...env, ...change }), null);
});

test("public downloads need no storage configuration and obsolete storage fields cannot change the destination", () => {
  const config = readDownloadConfig(env);
  assert.ok(config);
  assert.deepEqual(readDownloadConfig({ ...env, CODE_DOWNLOAD_BUCKET: "attacker-bucket", CODE_DOWNLOAD_OBJECT: "evil.zip", CODE_DOWNLOAD_GENERATION: "123" }), config);
  assert.equal("bucket" in config, false);
  assert.equal("object" in config, false);
  assert.equal("generation" in config, false);
});
