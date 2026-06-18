import { expect, test } from "@playwright/test";
import { apiPost, base } from "./helpers";

// A faithful test of typing into a RAW-MODE TUI (like claude), not `cat`. The
// program reads keystrokes char-by-char in raw mode and prints GOT:<char>, so we
// can confirm a browser keystroke actually reached the agent's stdin. Also logs
// console + WS state to surface browser-side failures.

test("raw-mode TUI: keystrokes reach the agent from the browser", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

  const r = await apiPost("/sessions/launch", {
    command: "python3 /tmp/rawtui.py",
    cwd: "/tmp",
    name: "rawtui",
    in_terminal: false,
    test: true,
  });
  expect(r.status).toBe(200);

  await page.goto(base());
  await page.locator(".rd-row-name", { hasText: "rawtui" }).click();
  const term = page.locator(".rd-terminal-pane .xterm");
  await expect(term).toBeVisible({ timeout: 10_000 });

  // The program prints READY once it's in raw mode.
  await expect(page.locator(".rd-terminal-pane .xterm-rows")).toContainText(
    "READY",
    { timeout: 8_000 },
  );

  // Check the WS is actually OPEN from the browser's view.
  const wsOpen = await page.evaluate(() => {
    // @ts-expect-error test hook
    return window.__rdTermWsState ?? "unknown";
  });
  console.log(
    "WS state from browser:",
    wsOpen,
    "console errors:",
    consoleErrors,
  );

  // Type WITHOUT clicking the terminal first (the real flow).
  await page.keyboard.type("Z");
  await expect(page.locator(".rd-terminal-pane .xterm-rows")).toContainText(
    "GOT:Z",
    { timeout: 5_000 },
  );
});
