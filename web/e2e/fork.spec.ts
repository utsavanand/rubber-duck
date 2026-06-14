import { expect, test } from "@playwright/test";
import { apiPost, seedSession } from "./helpers";

// Open the Fork modal for a claude-code session that's on a branch, confirm it
// offers both fork kinds, and submit a Conversation-only fork. A seeded session
// has no real Claude session_id recorded, so /fork-conversation returns HTTP 400
// ("no Claude session_id recorded for this session yet") — verified against the
// live endpoint. The correct UI behavior is to surface that as an error toast,
// which is what we assert. (For a real session with a recorded id, this would
// open a forked conversation in a terminal instead.)
test("fork modal offers both kinds; conversation fork surfaces the backend error", async ({
  page,
}) => {
  const key = `e2e-fork-${Date.now()}`;
  await seedSession(key, {
    name: key,
    branch: "feature/x",
    runtime: "claude-code",
  });

  // Cross-check the backend: conversation fork of a session with no recorded
  // Claude session_id is rejected — that's the case the UI must report.
  const res = await apiPost(`/sessions/${key}/fork-conversation`);
  expect(res.status).toBe(400);
  expect(res.body.error).toContain("no Claude session_id recorded");

  await page.goto("/");
  await page.getByRole("button", { name: /^All \(/ }).click();

  const row = page.locator(".rd-row", { hasText: key });
  await expect(row).toBeVisible();

  await row.hover();
  await row.locator("button", { hasText: "Fork" }).click();

  // The modal opened and offers both fork kinds.
  await expect(page.getByText(`Fork ${key}`)).toBeVisible();
  await expect(page.getByText("Git worktree")).toBeVisible();
  await expect(page.getByText("Conversation only")).toBeVisible();

  // Pick Conversation only, submit.
  await page.getByText("Conversation only").click();
  await page.getByRole("button", { name: "Create fork", exact: true }).click();

  // UI: the server's "no session_id" rejection is shown as an error toast.
  await expect(page.getByText(/Fork failed/)).toBeVisible();
});
