import { expect, test } from "@playwright/test";
import { apiPost, seedSession } from "./helpers";

// Stop a seeded (watched) session from the UI. Rubberduck doesn't own a watched
// session's process, so the /stop endpoint returns {stopped:false} with HTTP
// 404 — api.stop() throws on the non-2xx, and the row's act() helper surfaces
// that as an error toast. This is the REAL behavior for a non-launched session
// (verified against the live endpoint), so that's exactly what we assert: the
// click reaches the backend, and the UI honestly reports it couldn't stop.
test("stop on a watched session reports it can't be stopped", async ({
  page,
}) => {
  const key = `e2e-stop-${Date.now()}`;
  await seedSession(key, { name: key });

  // Cross-check the backend directly: stopping a session Rubberduck doesn't own
  // is a no-op (stopped:false), which is the behavior the UI must reflect.
  const res = await apiPost(`/sessions/${key}/stop`);
  expect(res.status).toBe(404);
  expect(res.body).toMatchObject({ stopped: false, session_key: key });

  await page.goto("/");
  await page.getByRole("button", { name: /^All \(/ }).click();

  const row = page.locator(".rd-row", { hasText: key });
  await expect(row).toBeVisible();

  // Actions are hover-revealed; hover, then click Stop.
  await row.hover();
  await row.locator("button", { hasText: "Stop" }).click();

  // UI: an error toast appears (api.stop throws on the 404). The session stays
  // — Rubberduck can't terminate a process it didn't launch.
  await expect(page.getByText(/Stopped failed/)).toBeVisible();
  await expect(row).toBeVisible();
});
