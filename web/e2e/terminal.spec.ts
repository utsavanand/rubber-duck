import { expect, test } from "@playwright/test";
import { apiPost, base } from "./helpers";

// Drives the REAL terminal in a REAL browser: launches PTY sessions, opens the
// terminal tab, types into xterm, and switches between agents. Catches the
// browser-only bugs (input focus, WS wiring, pane not re-keying on select) that
// curl-level tests miss.

async function launchCat(name: string): Promise<string> {
  // `cat` echoes stdin back through the PTY — so a keystroke we type should
  // appear in the terminal. in_terminal:false => Rubberduck owns the PTY.
  const r = await apiPost("/sessions/launch", {
    command: "cat",
    cwd: "/tmp",
    name,
    in_terminal: false,
    test: true,
  });
  expect(r.status).toBe(200);
  return r.body.session_key as string;
}

test("terminal: typing reaches the agent and echoes back", async ({ page }) => {
  await launchCat("cat-A");
  await page.goto(base());

  // The agent row appears; select it.
  const row = page.locator(".rd-row-name", { hasText: "cat-A" });
  await expect(row).toBeVisible({ timeout: 10_000 });
  await row.click();

  // The xterm terminal mounts in the center pane.
  const term = page.locator(".rd-terminal-pane .xterm");
  await expect(term).toBeVisible({ timeout: 10_000 });

  // Type WITHOUT an explicit terminal click first — selecting the agent should
  // leave the terminal focused so you can type immediately (the real flow).
  await page.keyboard.type("HELLO_RUBBERDUCK");
  await page.keyboard.press("Enter");

  await expect(page.locator(".rd-terminal-pane .xterm-rows")).toContainText(
    "HELLO_RUBBERDUCK",
    { timeout: 5_000 },
  );
});

test("terminal: switching agents shows the other agent's terminal", async ({
  page,
}) => {
  await launchCat("cat-one");
  await launchCat("cat-two");
  await page.goto(base());

  // Select the first, type a unique marker so its buffer is identifiable.
  await page.locator(".rd-row-name", { hasText: "cat-one" }).click();
  const term = page.locator(".rd-terminal-pane .xterm");
  await expect(term).toBeVisible({ timeout: 10_000 });
  await term.click();
  await page.keyboard.type("MARKER_ONE");
  await page.keyboard.press("Enter");
  await expect(page.locator(".rd-terminal-pane .xterm-rows")).toContainText(
    "MARKER_ONE",
    { timeout: 5_000 },
  );

  // Switch to the second agent. Its terminal must NOT show the first's marker
  // (i.e. the pane actually re-mounted for the new session).
  await page.locator(".rd-row-name", { hasText: "cat-two" }).click();
  await term.click();
  await page.keyboard.type("MARKER_TWO");
  await page.keyboard.press("Enter");
  await expect(page.locator(".rd-terminal-pane .xterm-rows")).toContainText(
    "MARKER_TWO",
    { timeout: 5_000 },
  );
  await expect(page.locator(".rd-terminal-pane .xterm-rows")).not.toContainText(
    "MARKER_ONE",
  );
});
