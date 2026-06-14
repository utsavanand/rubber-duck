import { defineConfig, devices } from "@playwright/test";

// E2E tests drive the REAL dashboard against a REAL `rubberduck serve` (started
// in global-setup with an isolated RUBBERDUCK_HOME and a fake agent, so no
// terminal app / LLM / network is involved). The base URL is the test server.
const PORT = process.env.RD_TEST_PORT || "4399";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // one server, shared state — run serially
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
