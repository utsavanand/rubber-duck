import { expect, test } from "@playwright/test";
import { seedSession } from "./helpers";

// A session with a `group` renders under a collapsible folder header in the left
// panel, and clicking the header collapses/expands it. (Drag-and-drop assignment
// is exercised manually; here we drive the render path via the API.)
test("a grouped session shows under its folder header and collapses", async ({
  page,
}) => {
  const key = `e2e-group-${Date.now()}`;
  // Move it into a folder the way a drag-drop would (PATCH group on /sessions/:key).
  await seedSession(key, { name: key, group: "Billing" });

  await page.goto("/");
  await page.getByRole("button", { name: /^All \(/ }).click();

  // The folder header appears, with the session nested in its body.
  const header = page.locator(".rd-group-head", { hasText: "Billing" });
  await expect(header).toBeVisible();
  const groupBody = page.locator(".rd-group", { hasText: "Billing" });
  await expect(groupBody.locator(".rd-row", { hasText: key })).toBeVisible();

  // Collapsing the header hides the rows.
  await header.click();
  await expect(
    page.locator(".rd-group-body .rd-row", { hasText: key }),
  ).toHaveCount(0);
});
