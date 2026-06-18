import { expect, test } from "@playwright/test";
import { apiPost, base } from "./helpers";

// The Messages view (structured-render foundation, step 1) renders a claude
// session's conversation as HTML from /sessions/:key/messages. This test seeds a
// fake transcript on disk and verifies the toggle renders its text + tool chips.

import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function seedTranscript(cwd: string): void {
  // Mirror Claude's JSONL: a project slug dir under ~/.claude/projects with the
  // cwd's non-alphanumerics turned to dashes.
  const slug = cwd.replace(/[^a-zA-Z0-9]/g, "-");
  const dir = join(homedir(), ".claude", "projects", slug);
  mkdirSync(dir, { recursive: true });
  const lines = [
    { type: "user", message: { role: "user", content: "tell me about this" } },
    {
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "## It is a **demo**\n\nWith a list:\n- one\n- two",
          },
        ],
      },
    },
    {
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "tool_use", name: "Bash", input: { command: "ls" } }],
      },
    },
  ];
  writeFileSync(
    join(dir, "seeded-session.jsonl"),
    lines.map((l) => JSON.stringify(l)).join("\n"),
  );
}

test("messages view renders structured conversation as HTML", async ({
  page,
}) => {
  // Use a real, stable cwd so the slug is predictable; seed a transcript there.
  const cwd = join(homedir(), "rd-msg-e2e");
  mkdirSync(cwd, { recursive: true });
  seedTranscript(cwd);

  const r = await apiPost("/sessions/launch", {
    command: "sh -c 'sleep 30'",
    cwd,
    name: "msg-agent",
    runtime: "claude-code", // so the messages endpoint reads the transcript
    in_terminal: false,
    test: true,
  });
  expect(r.status).toBe(200);

  await page.goto(base());
  await page.locator(".rd-row-name", { hasText: "msg-agent" }).click();
  await page.locator(".rd-view-toggle button", { hasText: "Messages" }).click();

  // The assistant's markdown rendered to HTML (heading + bold + list).
  await expect(page.locator(".rd-msg-text strong")).toContainText("demo", {
    timeout: 8_000,
  });
  await expect(page.locator(".rd-msg-text li").first()).toContainText("one");
  // The tool call shows as a chip.
  await expect(page.locator(".rd-msg-tool-name")).toContainText("Bash");
});
