import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Client component tests with a plain ReactDOM harness (no testing-library peer, which the
// default config needs and this app doesn't install).
export default defineConfig({
  plugins: [react()],
  test: { environment: "jsdom", include: ["client/src/components/**/__tests__/*.test.tsx"], setupFiles: [] },
  resolve: { alias: { "@shared": path.resolve(__dirname, "shared"), "@": path.resolve(__dirname, "client/src") } },
});
