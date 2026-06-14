// Screenshot the marketing site for visual review, using the Playwright that
// web/ already depends on. Headless chromium launches and closes itself — no
// terminal window, no leaked process. Run from the repo root:
//
//   node site/screenshot.mjs [url] [outFile]
//
// Defaults: http://localhost:3001 -> /tmp/rd-site-shot.png (full page).
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, "..", "web", "package.json"));
const { chromium } = require("@playwright/test");

const url = process.argv[2] || "http://localhost:3001";
const out = process.argv[3] || "/tmp/rd-site-shot.png";

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1300, height: 1700 },
    deviceScaleFactor: 2,
  });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(4000); // let looping animations reach a steady frame
  await page.screenshot({ path: out, fullPage: true });
  console.log("wrote", out);
} finally {
  await browser.close();
}
