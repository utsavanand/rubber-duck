import { expect, test } from "@playwright/test";
import { apiPost, base, postEvent, seedSession } from "./helpers";

// The blocking-approval flow end to end: a pre-exec hook registers a permission
// request, the row surfaces in "Needs human", and the dashboard's decision is
// what the polling hook reads back — including the harness's exact stdout JSON
// rendered from its ApprovalSpec.
test("approving a blocking request hands the hook its decision JSON", async ({
  page,
}) => {
  const key = `e2e-approval-${Date.now()}`;
  await seedSession(key, { name: key });
  const reg = await apiPost("/approvals", {
    session_key: key,
    tool_name: "Bash",
    tool_input: { command: "git push --force" },
    runtime: "claude-code",
  });
  const rid = reg.body.id as string;
  expect(rid).toBeTruthy();

  await page.goto("/");
  const row = page.locator(".rd-approval", { hasText: "git push --force" });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Approve" }).click();

  // What the polling hook sees: the decision plus Claude's stdout shape.
  const decision = await (
    await fetch(`${base()}/approvals/${rid}/decision`)
  ).json();
  expect(decision.status).toBe("approve");
  expect(JSON.parse(decision.output)).toEqual({
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: { behavior: "allow" },
    },
  });

  // Decided -> it leaves "Needs human" on the next poll.
  await expect(row).toHaveCount(0, { timeout: 5000 });
});

// A PermissionRequest event from a session Rubberduck doesn't own is
// observe-only: the row is visible so you know the agent is stuck, but there
// are no Approve/Deny buttons — you answer in its terminal.
test("observe-only permission request has no Approve button", async ({
  page,
}) => {
  const key = `e2e-observe-${Date.now()}`;
  await seedSession(key, { name: key });
  await postEvent({
    event_type: "PermissionRequest",
    session_key: key,
    tool_name: "WebFetch",
    tool_input: { url: "http://observe.example" },
    runtime: "claude-code",
  });

  await page.goto("/");
  const row = page.locator(".rd-approval", { hasText: "observe.example" });
  await expect(row).toBeVisible();
  await expect(row.getByRole("button", { name: "Approve" })).toHaveCount(0);
  await expect(row.locator(".rd-origin.watched")).toBeVisible();
});
