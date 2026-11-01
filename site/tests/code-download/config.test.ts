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

const DEPLOYMENT_HOST = "rubber-duck-ab12cd345-utsavs-projects-b9d729c7.vercel.app";

test("staged production requires explicit deployment mode and resolves only the server deployment URL", () => {
  const canonical = readDownloadConfig(env);
  assert.ok(canonical);
  assert.deepEqual(readDownloadConfig({ ...env, VERCEL_URL: DEPLOYMENT_HOST }), canonical);
  const candidate = readDownloadConfig({ ...env, CODE_DOWNLOAD_ORIGIN: "deployment", VERCEL_URL: DEPLOYMENT_HOST });
  assert.deepEqual(candidate, { ...canonical, origin: `https://${DEPLOYMENT_HOST}` });
  for (const CODE_DOWNLOAD_ORIGIN of [undefined, "", "Deployment", "deployment ", DEPLOYMENT_HOST, `https://${DEPLOYMENT_HOST}`]) {
    assert.equal(readDownloadConfig({ ...env, CODE_DOWNLOAD_ORIGIN, VERCEL_URL: DEPLOYMENT_HOST }), null, CODE_DOWNLOAD_ORIGIN);
  }
});

test("staged production rejects missing, noncanonical and foreign deployment hosts", () => {
  for (const VERCEL_URL of [
    undefined, "", "duckterm.utsava.xyz", "rubber-duck-nine.vercel.app",
    "rubber-duck-git-main-utsavs-projects-b9d729c7.vercel.app",
    "rubber-duck-ab12cd345-other-team.vercel.app",
    "other-project-ab12cd345-utsavs-projects-b9d729c7.vercel.app",
    DEPLOYMENT_HOST.replace("ab12cd345", "ab12cd34"),
    DEPLOYMENT_HOST.replace("ab12cd345", "ab12cd3456"),
    DEPLOYMENT_HOST.replace("ab12cd345", "Ab12cd345"),
    DEPLOYMENT_HOST.toUpperCase(), `www.${DEPLOYMENT_HOST}`, `${DEPLOYMENT_HOST}.`,
    `https://${DEPLOYMENT_HOST}`, `http://${DEPLOYMENT_HOST}`, `${DEPLOYMENT_HOST}:443`,
    `${DEPLOYMENT_HOST}/`, `${DEPLOYMENT_HOST}/api`, `${DEPLOYMENT_HOST}?test=1`, `${DEPLOYMENT_HOST}#test`,
    `${DEPLOYMENT_HOST}.attacker.invalid`, `${DEPLOYMENT_HOST}@attacker.invalid`, `user@${DEPLOYMENT_HOST}`,
    ` ${DEPLOYMENT_HOST}`, `${DEPLOYMENT_HOST} `, `${DEPLOYMENT_HOST}\n`, `${DEPLOYMENT_HOST}\r\n`,
    DEPLOYMENT_HOST.replace("ab12cd345", "ab12 cd345"),
  ]) assert.equal(readDownloadConfig({ ...env, CODE_DOWNLOAD_ORIGIN: "deployment", VERCEL_URL }), null, JSON.stringify(VERCEL_URL));
});

test("deployment mode never enables previews, development or disabled production", () => {
  for (const VERCEL_ENV of [undefined, "", "preview", "development"]) {
    assert.equal(readDownloadConfig({ ...env, CODE_DOWNLOAD_ORIGIN: "deployment", VERCEL_URL: DEPLOYMENT_HOST, VERCEL_ENV }), null);
  }
  for (const CODE_DOWNLOAD_ENABLED of [undefined, "", "false", "TRUE"]) {
    assert.equal(readDownloadConfig({ ...env, CODE_DOWNLOAD_ORIGIN: "deployment", VERCEL_URL: DEPLOYMENT_HOST, CODE_DOWNLOAD_ENABLED }), null);
  }
  assert.equal(readDownloadConfig({ ...env, CODE_DOWNLOAD_ORIGIN: "deployment", VERCEL_URL: DEPLOYMENT_HOST, GMAIL_REFRESH_TOKEN: undefined }), null);
});
