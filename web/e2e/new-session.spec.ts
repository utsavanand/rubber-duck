import { expect, test } from "@playwright/test";
import { sessions } from "./helpers";

// Open New session, confirm the agent picker, choose a folder, launch — and
// verify a real session lands in the backend. The terminal app may or may not
// open depending on the host (it does on a dev Mac, no-ops in CI); either way
// the server publishes the session, which is what we assert.
test("new session: agent picker + launch creates a session", async ({
  page,
}) => {
  const before = (await sessions()).length;

  await page.goto("/");
  await page.getByRole("button", { name: "New session" }).click();

  // The agent picker offers all known agents plus a custom escape hatch.
  await expect(page.locator(".rd-pill")).toHaveText([
    "Claude Code",
    "Codex",
    "Copilot",
    "Custom…",
  ]);

  // Pick a folder: open the browser and use the current (home) directory.
  // (These custom buttons aren't exposed with a button role, so match on text.)
  await page.locator("button", { hasText: "Browse" }).click();
  await page.locator("button", { hasText: "Use this folder" }).click();

  // A git home dir shows a run-mode chooser; pick Run in place to skip a
  // worktree. No-op if the chooser isn't shown (non-git folder).
  const inPlace = page.getByText("Run in place");
  if (await inPlace.isVisible().catch(() => false)) {
    await inPlace.click();
  }

  await page.getByRole("button", { name: "Launch", exact: true }).click();

  await expect
    .poll(async () => (await sessions()).length, { timeout: 8000 })
    .toBeGreaterThan(before);
});
