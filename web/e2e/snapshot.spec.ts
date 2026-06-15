import { expect, test } from "@playwright/test";
import { seedSession, snapshotIds } from "./helpers";

// Take a snapshot from the Snapshots modal and verify it lands in the backend.
// The toast echoes the snapshot id ("Snapshot snap-... created"), and GET
// /snapshots lists one more snapshot than before.
test("snapshot all active sessions creates a snapshot in the backend", async ({
  page,
}) => {
  await seedSession(`e2e-snap-${Date.now()}`, { name: "snap session" });

  const before = await snapshotIds();

  await page.goto("/");
  await page.getByRole("button", { name: "Snapshots" }).click();

  await page
    .getByRole("button", { name: "Snapshot all active sessions" })
    .click();

  // UI: a toast confirms the snapshot id.
  await expect(page.getByText(/^Snapshot snap-.+ created$/)).toBeVisible();

  // Backend: exactly one new snapshot exists.
  await expect
    .poll(async () => (await snapshotIds()).length)
    .toBe(before.length + 1);
  const added = (await snapshotIds()).filter((id) => !before.includes(id));
  expect(added).toHaveLength(1);
  expect(added[0]).toMatch(/^snap-/);

  // Selecting the new snapshot lists the sessions IT captured (read from its
  // manifest), not the live dashboard's session list. Target the modal's select
  // (the one with the "choose a snapshot" placeholder), not the Origin filter.
  await page
    .locator("select")
    .filter({ has: page.locator('option[value=""]') })
    .last()
    .selectOption({ index: 1 });
  await expect(page.getByText("Sessions in this snapshot")).toBeVisible();
  await expect(page.locator("code", { hasText: "snap session" })).toBeVisible();
});
