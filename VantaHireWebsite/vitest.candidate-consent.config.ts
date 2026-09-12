import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

const client = process.env.FLOW_CONSENT_CLIENT_TEST === "1";
export default defineConfig({
  plugins: client ? [react()] : [],
  test: {
    environment: client ? "jsdom" : "node",
    include: client ? ["client/src/components/candidate/CandidateConsentPanel.test.tsx"]
      : ["server/candidate-consent/__tests__/*.test.ts"],
    // Dedicated ReactDOM harness: deliberately no legacy setup importing an absent testing-library peer.
    setupFiles: [],
  },
  resolve: { alias: { "@shared": path.resolve(__dirname, "shared"), "@": path.resolve(__dirname, "client/src") } },
});
