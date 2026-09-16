import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

// FLOW_INDEX_CLIENT_TEST=1 runs the reserved Wave 4D candidates-page ReactDOM harness (jsdom, no testing-library
// peer; package.json is frozen). Otherwise the server index suites run under node.
const client = process.env.FLOW_INDEX_CLIENT_TEST === "1";
export default defineConfig({
  plugins: client ? [react()] : [],
  test: {
    environment: client ? "jsdom" : "node",
    include: client ? ["client/src/pages/candidates-page.test.tsx"] : ["server/candidate-index/__tests__/*.test.ts"],
    setupFiles: [],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
  resolve: { alias: { "@shared": path.resolve(__dirname, "shared"), "@": path.resolve(__dirname, "client/src") } },
});
