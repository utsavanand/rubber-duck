/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/events": "http://localhost:4200",
      "/stream": "http://localhost:4200",
      "/sessions": "http://localhost:4200",
      "/snapshots": "http://localhost:4200",
      "/tree": "http://localhost:4200",
      "/approvals": "http://localhost:4200",
      "/terminals": "http://localhost:4200",
      "/browse": "http://localhost:4200",
    },
  },
  test: {
    // jsdom for the few modules that touch localStorage/Date; most tests are
    // pure-logic and would run under 'node' too.
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts",
    // Unit tests live next to source as *.test.ts(x). Playwright e2e specs in
    // web/e2e/ run separately (npm run e2e) and must be excluded here.
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
