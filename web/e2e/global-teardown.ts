import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default async function globalTeardown() {
  const statePath = join(tmpdir(), "rd-e2e-state.json");
  try {
    const { home, pid } = JSON.parse(readFileSync(statePath, "utf8"));
    if (pid) {
      try {
        process.kill(pid);
      } catch {
        // already gone
      }
    }
    if (home) rmSync(home, { recursive: true, force: true });
    rmSync(statePath, { force: true });
  } catch {
    // nothing to clean
  }
}
