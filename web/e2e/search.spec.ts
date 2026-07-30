import { expect, test } from "@playwright/test";
import { apiPost, seedSession } from "./helpers";

// The left-panel search box filters sessions by name — and an active query
// searches EVERY lifecycle, so a session the sweep archived (possibly wrongly)
// is still findable by the name you know it by.
test("search narrows the list and finds archived sessions", async ({
  page,
}) => {
  const stamp = Date.now();
  await seedSession(`e2e-search-apple-${stamp}`, {
    name: `Apple sprint ${stamp}`,
  });
  await seedSession(`e2e-search-banana-${stamp}`, {
    name: `Banana fix ${stamp}`,
  });
  // Launched, because only Rubberduck-launched sessions can be archived.
  const hidden = await seedSession(`e2e-search-hidden-${stamp}`, {
    name: `Hidden design ${stamp}`,
    launched: true,
  });
  const archived = await apiPost(`/sessions/${hidden}/archive`);
  expect(archived.status).toBe(200);

  await page.goto("/");
  const box = page.getByPlaceholder("Search sessions by name…");

  await box.fill(`Apple sprint ${stamp}`);
  await expect(
    page.locator(".rd-row", { hasText: "Apple sprint" }),
  ).toBeVisible();
  await expect(page.locator(".rd-row", { hasText: "Banana fix" })).toHaveCount(
    0,
  );

  // Archived sessions never show in Active — but search reaches them.
  await box.fill(`Hidden design ${stamp}`);
  await expect(
    page.locator(".rd-row", { hasText: "Hidden design" }),
  ).toBeVisible();

  // Clearing the query returns to the normal lifecycle view (Active), where
  // neither the archived one nor a stale filter lingers.
  await box.fill("");
  await expect(
    page.locator(".rd-row", { hasText: "Hidden design" }),
  ).toHaveCount(0);
  await expect(
    page.locator(".rd-row", { hasText: `Apple sprint ${stamp}` }),
  ).toBeVisible();
});
