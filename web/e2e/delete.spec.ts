import { expect, test } from "@playwright/test";
import { findSession, seedSession, sessions } from "./helpers";

// Delete a session from the UI and verify it's gone from both the DOM and the
// backend. Uses a seeded (watched) session so there's a real row to act on.
test("delete removes the session from the UI and the backend", async ({
  page,
}) => {
  const key = `e2e-delete-${Date.now()}`;
  await seedSession(key, { name: key });

  // Sanity: the backend has it before we delete.
  expect(await findSession((s) => s.session_key === key)).toBeTruthy();

  await page.goto("/");
  // Show all sessions so the seeded one (idle/busy) is visible regardless of
  // the default Active filter.
  await page.getByRole("button", { name: /^All \(/ }).click();

  const row = page.locator(".rd-row", { hasText: key });
  await expect(row).toBeVisible();

  // Actions are hover-revealed; hover the row, then click its Delete.
  await row.hover();
  await row.getByRole("button", { name: "Delete" }).click();

  // UI: the row disappears.
  await expect(row).toHaveCount(0);

  // Backend: it's actually gone (and stays gone — tombstoned).
  await expect
    .poll(async () => (await sessions()).some((s) => s.session_key === key))
    .toBe(false);
});
