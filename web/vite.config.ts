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
    },
  },
});
