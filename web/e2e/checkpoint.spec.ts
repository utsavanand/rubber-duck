import { expect, test } from "@playwright/test";
import { checkpoints, postEvent, seedSession } from "./helpers";

// Record a checkpoint from the UI and verify the backend captured the session's
// activity. We seed a prompt + a Bash command via the events API (the same path
// the real hooks use), click Checkpoint, then read back GET
// /sessions/:key/checkpoints to confirm the prompt and command landed in the
// checkpoint record — not just that a row was created.
test("checkpoint captures the session's prompts and commands", async ({
  page,
}) => {
  const key = `e2e-checkpoint-${Date.now()}`;
  await seedSession(key, { name: key });
  await postEvent({
    event_type: "UserPromptSubmit",
    session_key: key,
    prompt: "add a login form",
    cwd: "/tmp/e2e",
  });
  await postEvent({
    event_type: "PreToolUse",
    session_key: key,
    tool_name: "Bash",
    tool_input: { command: "npm test" },
    cwd: "/tmp/e2e",
  });

  // Backend starts with no checkpoints for this session.
  expect(await checkpoints(key)).toHaveLength(0);

  await page.goto("/");
  await page.getByRole("button", { name: /^All \(/ }).click();

  const row = page.locator(".rd-row", { hasText: key });
  await expect(row).toBeVisible();

  await row.hover();
  await row.locator("button", { hasText: "Checkpoint" }).click();

  // UI: success toast.
  await expect(page.getByText("Checkpoint recorded")).toBeVisible();

  // Backend: a checkpoint now exists and captured the prompt + the Bash command.
  await expect.poll(async () => (await checkpoints(key)).length).toBe(1);
  const [cp] = await checkpoints(key);
  expect(cp.label).toBe("manual");
  expect(cp.record.prompts).toContain("add a login form");
  expect(cp.record.commands).toContain("npm test");
  expect(cp.record.tools).toContainEqual({ tool: "Bash", count: 1 });
});
