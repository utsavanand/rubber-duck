import assert from "node:assert/strict";
import { test } from "node:test";
import { publicDownload } from "../../lib/code-download/download-link.ts";

test("public release aliases map Code and Full to their own official assets and installed bundle names", () => {
  assert.deepEqual(publicDownload("code"), { edition: "code", name: "DuckTerm Code", bundle: "DuckTerm Code.app", url: "https://github.com/utsavanand/duckterm/releases/latest/download/DuckTerm-Code-macos-arm64.zip" });
  assert.deepEqual(publicDownload("full"), { edition: "full", name: "DuckTerm Full", bundle: "DuckTerm.app", url: "https://github.com/utsavanand/duckterm/releases/latest/download/DuckTerm-Full-macos-arm64.zip" });
});

test("unknown editions and URL-like inputs cannot select an artifact", () => {
  for (const value of [undefined, null, "", "lite", "Code", " full", "__proto__", "constructor", "https://attacker.invalid/evil.zip", ["code"], { edition: "code" }, 1]) assert.equal(publicDownload(value), null);
});
