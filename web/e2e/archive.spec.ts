import { expect, test } from "@playwright/test";
import { findSession, seedSession } from "./helpers";

// Archive a session from the UI: it leaves the default views and appears under
// the Archived filter, then Unarchive brings it back (as a stopped row). The
// backend state must follow each step.
test("archive moves a session to the Archived filter, unarchive brings it back", async ({
  page,
}) => {
  // Archive is launched-only — a watched session can't be archived.
  const key = `e2e-archive-${Date.now()}`;
  await seedSession(key, { name: key, launched: true });

  await page.goto("/");
  await page.getByRole("button", { name: /^All \(/ }).click();

  const row = page.locator(".rd-row", { hasText: key });
  await expect(row).toBeVisible();

  // Archive it.
  await row.hover();
  await row.getByRole("button", { name: "Archive" }).click();

  // It leaves the All view...
  await expect(page.locator(".rd-row", { hasText: key })).toHaveCount(0);
  // ...and the backend marks it archived (history kept).
  await expect
    .poll(async () => (await findSession((s) => s.session_key === key))?.state)
    .toBe("archived");

  // It shows under the Archived filter.
  await page.getByRole("button", { name: /^Archived \(/ }).click();
  const archivedRow = page.locator(".rd-row", { hasText: key });
  await expect(archivedRow).toBeVisible();

  // Unarchive brings it back as a stopped (resumable) row.
  await archivedRow.hover();
  await archivedRow.getByRole("button", { name: "Unarchive" }).click();
  await expect
    .poll(async () => (await findSession((s) => s.session_key === key))?.state)
    .toBe("stopped");
});
