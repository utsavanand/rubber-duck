import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { test } from "node:test";
import { Storage } from "@google-cloud/storage";
import { GoogleAuth } from "google-auth-library";
import { createDownloadLink } from "../../lib/code-download/download-link.ts";

test("signed download grants a 24-hour read of only the pinned Code artifact generation", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const account = "downloads@synthetic-test.iam.gserviceaccount.com";
  const auth = new GoogleAuth({ credentials: { client_email: account, private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString() } });
  const storage = new Storage({ projectId: "synthetic-test", authClient: auth });
  const release = { bucket: "synthetic-private-bucket", object: "code/DuckTerm-Code-0.4.182-macos-arm64.zip", generation: "9007199254740993" };
  const url = new URL(await createDownloadLink(release, storage)());
  assert.equal(url.origin, "https://storage.googleapis.com");
  assert.equal(decodeURIComponent(url.pathname), `/${release.bucket}/${release.object}`);
  assert.equal(url.searchParams.get("generation"), release.generation);
  assert.equal(url.searchParams.get("X-Goog-Algorithm"), "GOOG4-RSA-SHA256");
  assert.equal(url.searchParams.get("X-Goog-SignedHeaders"), "host");
  assert.ok(Number(url.searchParams.get("X-Goog-Expires")) >= 86398);
  assert.ok(Number(url.searchParams.get("X-Goog-Expires")) <= 86400);
  assert.match(url.searchParams.get("response-content-disposition")!, /^attachment; filename="DuckTerm-Code-/);
  assert.equal(url.searchParams.get("response-content-type"), "application/zip");
  const signature = Buffer.from(url.searchParams.get("X-Goog-Signature")!, "hex");
  url.searchParams.delete("X-Goog-Signature");
  // Verify the actual SDK's RSA signature, not a mocked signing response.
  const { createHash } = await import("node:crypto");
  const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  const query = [...url.searchParams].map(([key, value]) => [encode(key), encode(value)]).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(pair => pair.join("=")).join("&");
  const canonical = ["GET", url.pathname, query, `host:${url.host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const credential = url.searchParams.get("X-Goog-Credential")!;
  const text = ["GOOG4-RSA-SHA256", url.searchParams.get("X-Goog-Date"), credential.slice(account.length + 1), createHash("sha256").update(canonical).digest("hex")].join("\n");
  assert.equal(verify("RSA-SHA256", Buffer.from(text), publicKey, signature), true);
  assert.equal(verify("RSA-SHA256", Buffer.from(text.replace("GOOG4", "BAD4")), publicKey, signature), false);
});

test("a Full artifact or unpinned generation cannot be signed by the Code adapter", async () => {
  const storage = new Storage({ projectId: "synthetic-test" });
  await assert.rejects(createDownloadLink({ bucket: "synthetic", object: "DuckTerm-Full-0.4.182-macos-arm64.zip", generation: "1234" }, storage)());
  await assert.rejects(createDownloadLink({ bucket: "synthetic", object: "DuckTerm-Code-0.4.182-macos-arm64.zip", generation: "latest" }, storage)());
});
