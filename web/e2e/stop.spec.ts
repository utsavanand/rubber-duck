import { expect, test } from "@playwright/test";
import { apiPost, seedSession } from "./helpers";

// A watched session is one Rubberduck doesn't own (you ran the agent yourself).
// Its row is observe-only: no Stop and no Archive, since neither can deliver on
// what it implies (we can't end a process we didn't launch, and archiving would
// only hide a row whose agent keeps running). The backend still refuses /stop
// directly (404, stopped:false), which is why the UI hides the button.
test("watched session is observe-only: no Stop or Archive button", async ({
  page,
}) => {
  const key = `e2e-stop-${Date.now()}`;
  await seedSession(key, { name: key });

  // Backend cross-check: stopping a session Rubberduck doesn't own is a no-op.
  const res = await apiPost(`/sessions/${key}/stop`);
  expect(res.status).toBe(404);
  expect(res.body).toMatchObject({ stopped: false, session_key: key });

  await page.goto("/");
  await page.getByRole("button", { name: /^All \(/ }).click();

  const row = page.locator(".rd-row", { hasText: key });
  await expect(row).toBeVisible();

  // Actions are hover-revealed. Stop and Archive must not be among them.
  await row.hover();
  await expect(
    row.getByRole("button", { name: "Stop", exact: true }),
  ).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Archive" })).toHaveCount(0);
  // Fork stays — branching a watched session is fine.
  await expect(row.getByRole("button", { name: "Fork" })).toBeVisible();
});
