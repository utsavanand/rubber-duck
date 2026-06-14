import { expect, test } from "@playwright/test";
import { postEvent, seedSession, sessions } from "./helpers";

// Regression: a watched session keeps streaming events from its own hooks. After
// you delete it, those events must NOT resurrect the row in the dashboard (which
// would let you act on a session the backend has already removed — the cause of
// the "no session …" checkpoint error).
test("a deleted watched session is not resurrected by its later events", async ({
  page,
}) => {
  const key = `e2e-ghost-${Date.now()}`;
  await seedSession(key, { name: key });

  await page.goto("/");
  await page.getByRole("button", { name: /^All \(/ }).click();

  const row = page.locator(".rd-row", { hasText: key });
  await expect(row).toBeVisible();

  // Delete it from the UI.
  await row.hover();
  await row.getByRole("button", { name: "Delete" }).click();
  await expect(row).toHaveCount(0);

  // The watched session's hooks keep firing — simulate more events for the key.
  await postEvent({
    event_type: "PreToolUse",
    session_key: key,
    tool_name: "Bash",
  });
  await postEvent({
    event_type: "PreToolUse",
    session_key: key,
    tool_name: "Read",
  });

  // Give the SSE stream time to deliver them.
  await page.waitForTimeout(1000);

  // The row must stay gone (client tombstone holds) ...
  await expect(row).toHaveCount(0);
  // ... and the backend still doesn't have it (server tombstone holds).
  expect((await sessions()).some((s) => s.session_key === key)).toBe(false);
});
