import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

// S2 career-profile UI. Dedicated ReactDOM harness like candidate consent: no legacy
// setup importing the absent testing-library peer.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["client/src/components/candidate-profile/**/*.test.tsx"],
    setupFiles: [],
  },
  resolve: { alias: { "@shared": path.resolve(__dirname, "shared"), "@": path.resolve(__dirname, "client/src") } },
});
