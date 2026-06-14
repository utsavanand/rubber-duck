// Render the dashboard duck (web/public/favicon.svg) into AppIcon.icns so the
// Mac app icon stays in sync with the brand mark. The icns has no other source —
// without this it drifts (it was frozen as an older, tailed duck).
//
// Usage: node make-icon.mjs   (run from mac/, needs web/node_modules playwright)
import { chromium } from "../web/node_modules/playwright/index.mjs";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const svg = readFileSync(join(here, "../web/public/favicon.svg"), "utf8");

// iconutil expects exactly these names/sizes.
const sizes = [
  ["icon_16x16", 16],
  ["icon_16x16@2x", 32],
  ["icon_32x32", 32],
  ["icon_32x32@2x", 64],
  ["icon_128x128", 128],
  ["icon_128x128@2x", 256],
  ["icon_256x256", 256],
  ["icon_256x256@2x", 512],
  ["icon_512x512", 512],
  ["icon_512x512@2x", 1024],
];

const work = mkdtempSync(join(tmpdir(), "rdicon-"));
const iconset = join(work, "AppIcon.iconset");
mkdirSync(iconset);

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, px] of sizes) {
  await page.setViewportSize({ width: px, height: px });
  await page.setContent(
    `<style>html,body{margin:0}svg{display:block}</style>` +
      svg
        .replace(/width="\d+"/, `width="${px}"`)
        .replace(/height="\d+"/, `height="${px}"`),
  );
  const el = await page.$("svg");
  const buf = await el.screenshot({ omitBackground: true });
  writeFileSync(join(iconset, `${name}.png`), buf);
}
await browser.close();

execFileSync("iconutil", [
  "-c",
  "icns",
  iconset,
  "-o",
  join(here, "Resources/AppIcon.icns"),
]);
rmSync(work, { recursive: true, force: true });
console.log("wrote mac/Resources/AppIcon.icns from web/public/favicon.svg");
