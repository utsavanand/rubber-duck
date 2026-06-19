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

  // The latest reply's markdown rendered to HTML (heading + bold + list).
  await expect(page.locator(".rd-msg-text strong")).toContainText("demo", {
    timeout: 8_000,
  });
  await expect(page.locator(".rd-msg-text li").first()).toContainText("one");
  // Tools the agent ran collapse into one compact line, not a row each.
  await expect(page.locator(".rd-msg-tools")).toContainText("Bash");
  // The prompt that started the turn shows as context.
  await expect(page.locator(".rd-msg-prompt")).toContainText("tell me about");
});

test("annotating a span stores it and sends it back to the agent", async ({
  page,
}) => {
  const cwd = join(homedir(), "rd-msg-e2e");
  mkdirSync(cwd, { recursive: true });
  seedTranscript(cwd);
  const launch = await apiPost("/sessions/launch", {
    command: "cat", // echoes the follow-up back, proving it reached stdin
    cwd,
    name: "annot-agent",
    runtime: "claude-code",
    in_terminal: false,
    test: true,
  });
  const key = launch.body.session_key as string;

  await page.goto(base());
  await page.locator(".rd-row-name", { hasText: "annot-agent" }).click();
  await page.locator(".rd-view-toggle button", { hasText: "Messages" }).click();
  await expect(page.locator(".rd-msg-text strong")).toBeVisible({
    timeout: 8_000,
  });

  // Select the bold word, which pops the annotation box.
  await page.locator(".rd-msg-text strong").dblclick();
  await expect(page.locator(".rd-annotate-pop")).toBeVisible();
  await page.locator(".rd-annotate-pop textarea").fill("explain this");
  await page.locator(".rd-annotate-actions button").click();

  // Stored server-side.
  await expect
    .poll(async () => {
      const res = await fetch(`${base()}/sessions/${key}/annotations`);
      const d = await res.json();
      return d.annotations?.length ?? 0;
    })
    .toBeGreaterThan(0);

  // Sent to the agent: cat echoes the follow-up into the terminal.
  await page.locator(".rd-view-toggle button", { hasText: "Terminal" }).click();
  await expect(
    page.locator(".rd-terminal-slot:visible .xterm-rows"),
  ).toContainText("explain this", { timeout: 5_000 });
});
