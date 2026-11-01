import assert from "node:assert/strict";
import { test } from "node:test";
import { readDownloadConfig, readDownloadOrigin } from "../../lib/code-download/config.ts";

const ORIGIN = "https://duckterm.utsava.xyz";
const DEPLOYMENT_HOST = "rubber-duck-ab12cd345-utsavs-projects-b9d729c7.vercel.app";
const env = {
  VERCEL_ENV: "production", DOWNLOAD_CAPTURE_ENABLED: "true",
  CODE_DOWNLOAD_ORIGIN: ORIGIN, GCP_PROJECT_ID: "test-downloads",
  GCP_PROJECT_NUMBER: "123456789012", GCP_SERVICE_ACCOUNT_EMAIL: "downloads@test-downloads.iam.gserviceaccount.com",
  GCP_WORKLOAD_IDENTITY_POOL_ID: "duckterm-vercel", GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: "production",
  GCP_FIRESTORE_DATABASE: "duckterm-downloads",
  CODE_DOWNLOAD_RATE_SECRET: "synthetic-test-secret-never-used-in-production",
};

test("download origin defaults to canonical independently of capture configuration", () => {
  assert.equal(readDownloadOrigin({}), ORIGIN);
  assert.equal(readDownloadOrigin({ CODE_DOWNLOAD_ORIGIN: ORIGIN }), ORIGIN);
  assert.equal(readDownloadOrigin({ VERCEL_URL: DEPLOYMENT_HOST }), ORIGIN);
  assert.equal(readDownloadConfig({}), null);
  assert.equal(readDownloadOrigin({ ...env, DOWNLOAD_CAPTURE_ENABLED: "false" }), ORIGIN);
});

test("capture requires production, its explicit enable switch and complete Google/rate configuration", () => {
  assert.ok(readDownloadConfig(env));
  for (const key of Object.keys(env).filter(key => key !== "CODE_DOWNLOAD_ORIGIN")) {
    const missing: Record<string, string | undefined> = { ...env }; delete missing[key];
    assert.equal(readDownloadConfig(missing), null, key);
  }
  assert.ok(readDownloadConfig({ ...env, CODE_DOWNLOAD_ORIGIN: undefined }));
  for (const VERCEL_ENV of [undefined, "", "preview", "development", "Production"]) assert.equal(readDownloadConfig({ ...env, VERCEL_ENV }), null);
  for (const DOWNLOAD_CAPTURE_ENABLED of [undefined, "", "false", "TRUE", " true "]) assert.equal(readDownloadConfig({ ...env, DOWNLOAD_CAPTURE_ENABLED }), null);
});

test("capture never reads Gmail credentials or the obsolete mail enable switch", () => {
  const guarded = new Proxy<Record<string, string | undefined>>({ ...env }, {
    get(target, property) {
      if (typeof property === "string" && (property.startsWith("GMAIL_") || property === "CODE_DOWNLOAD_ENABLED")) throw new Error("Obsolete mail configuration was accessed");
      return Reflect.get(target, property);
    },
  });
  assert.deepEqual(readDownloadConfig(guarded), readDownloadConfig(env));
  assert.equal(readDownloadOrigin(guarded), ORIGIN);
  const result = readDownloadConfig({ ...env, CODE_DOWNLOAD_ENABLED: "false", GMAIL_FROM: "invalid", GMAIL_REFRESH_TOKEN: "", GMAIL_CLIENT_ID: "", GMAIL_CLIENT_SECRET: "" });
  assert.deepEqual(result, readDownloadConfig(env));
  for (const key of ["from", "clientId", "clientSecret", "refreshToken"]) assert.equal(key in result!, false);
});

test("download config rejects arbitrary origins, mismatched Google identities and weak rate secrets", () => {
  for (const change of [
    { CODE_DOWNLOAD_ORIGIN: "https://attacker.invalid" },
    { GCP_SERVICE_ACCOUNT_EMAIL: "downloads@other-project.iam.gserviceaccount.com" },
    { GCP_PROJECT_NUMBER: "1234/../../" }, { GCP_FIRESTORE_DATABASE: "(default)" },
    { CODE_DOWNLOAD_RATE_SECRET: "short" }, { GCP_PROJECT_ID: " test-downloads" },
  ]) assert.equal(readDownloadConfig({ ...env, ...change }), null);
  for (const CODE_DOWNLOAD_ORIGIN of ["", "https://duckterm.utsava.xyz/", "https://duckterm.utsava.xyz.attacker.invalid", "http://duckterm.utsava.xyz", "null"]) assert.equal(readDownloadOrigin({ CODE_DOWNLOAD_ORIGIN }), null);
});

test("staged production requires explicit deployment mode and its exact immutable server hostname", () => {
  const canonical = readDownloadConfig(env);
  assert.ok(canonical);
  assert.deepEqual(readDownloadConfig({ ...env, VERCEL_URL: DEPLOYMENT_HOST }), canonical);
  const candidateEnv = { ...env, CODE_DOWNLOAD_ORIGIN: "deployment", VERCEL_URL: DEPLOYMENT_HOST };
  assert.equal(readDownloadOrigin(candidateEnv), `https://${DEPLOYMENT_HOST}`);
  assert.deepEqual(readDownloadConfig(candidateEnv), { ...canonical, origin: `https://${DEPLOYMENT_HOST}` });
  for (const CODE_DOWNLOAD_ORIGIN of ["Deployment", "deployment ", DEPLOYMENT_HOST, `https://${DEPLOYMENT_HOST}`]) {
    assert.equal(readDownloadOrigin({ ...candidateEnv, CODE_DOWNLOAD_ORIGIN }), null);
    assert.equal(readDownloadConfig({ ...candidateEnv, CODE_DOWNLOAD_ORIGIN }), null);
  }
});

test("staged origin rejects foreign projects, teams, branch aliases and URL syntax tricks", () => {
  for (const VERCEL_URL of [
    undefined, "", "duckterm.utsava.xyz", "rubber-duck-nine.vercel.app",
    "rubber-duck-git-main-utsavs-projects-b9d729c7.vercel.app",
    "rubber-duck-ab12cd345-other-team.vercel.app",
    "other-project-ab12cd345-utsavs-projects-b9d729c7.vercel.app",
    DEPLOYMENT_HOST.replace("ab12cd345", "ab12cd34"), DEPLOYMENT_HOST.replace("ab12cd345", "ab12cd3456"),
    DEPLOYMENT_HOST.toUpperCase(), `www.${DEPLOYMENT_HOST}`, `${DEPLOYMENT_HOST}.`,
    `https://${DEPLOYMENT_HOST}`, `${DEPLOYMENT_HOST}:443`, `${DEPLOYMENT_HOST}/`, `${DEPLOYMENT_HOST}/api`,
    `${DEPLOYMENT_HOST}?test=1`, `${DEPLOYMENT_HOST}#test`, `${DEPLOYMENT_HOST}.attacker.invalid`,
    `${DEPLOYMENT_HOST}@attacker.invalid`, `user@${DEPLOYMENT_HOST}`, ` ${DEPLOYMENT_HOST}`, `${DEPLOYMENT_HOST} `,
    `${DEPLOYMENT_HOST}\n`, `${DEPLOYMENT_HOST}\r\n`, DEPLOYMENT_HOST.replace("ab12cd345", "ab12 cd345"),
  ]) {
    const candidate = { ...env, CODE_DOWNLOAD_ORIGIN: "deployment", VERCEL_URL };
    assert.equal(readDownloadOrigin(candidate), null, JSON.stringify(VERCEL_URL));
    assert.equal(readDownloadConfig(candidate), null, JSON.stringify(VERCEL_URL));
  }
});

test("a staged origin cannot enable capture on preview or development deployments", () => {
  for (const VERCEL_ENV of [undefined, "", "preview", "development"]) {
    const candidate = { ...env, CODE_DOWNLOAD_ORIGIN: "deployment", VERCEL_URL: DEPLOYMENT_HOST, VERCEL_ENV };
    assert.equal(readDownloadOrigin(candidate), null);
    assert.equal(readDownloadConfig(candidate), null);
  }
});
