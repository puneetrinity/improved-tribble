import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  adoptExistingFlowDatabase,
  resolveAdoptionEnvironment,
  safeAdoptionError,
} from "../adoption";
import { FLOW_SCHEMA_FROZEN_EVIDENCE } from "../frozenEvidence";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "schema-migrations");

describe("existing Flow adoption controls", () => {
  it("requires the complete explicit production gate", () => {
    expect(() => resolveAdoptionEnvironment({} as NodeJS.ProcessEnv)).toThrow(/ADOPT_EXISTING/);
    const resolved = resolveAdoptionEnvironment({
      NODE_ENV: "production",
      FLOW_SCHEMA_ENVIRONMENT: "production",
      FLOW_SCHEMA_ADOPT_EXISTING: "1",
      FLOW_MIGRATE_DATABASE_URL: "postgresql://owner:redacted@db.internal/flow",
      FLOW_SCHEMA_TARGET_ID: "opaque-target",
      FLOW_RUNTIME_ROLE: "flow_runtime",
      FLOW_SCHEMA_DEPLOYED_SOURCE_SHA: FLOW_SCHEMA_FROZEN_EVIDENCE.deployedSourceSha,
      FLOW_SCHEMA_SOURCE_CATALOG_SHA256: FLOW_SCHEMA_FROZEN_EVIDENCE.sourceCatalogSha256,
      FLOW_SCHEMA_CATALOG_LOCK_SHA256: FLOW_SCHEMA_FROZEN_EVIDENCE.catalogLockSha256,
    } as NodeJS.ProcessEnv);
    expect(resolved.runtimeRole).toBe("flow_runtime");
    expect(resolved.expectedTargetId).toBe("opaque-target");
  });

  it("rejects frozen-evidence drift before opening a database connection", async () => {
    let connected = false;
    await expect(adoptExistingFlowDatabase({
      migrationsDir,
      migrateUrl: "postgresql://owner:redacted@db.internal/flow",
      expectedTargetId: "opaque-target",
      runtimeRole: "flow_runtime",
      deployedSourceSha: "0".repeat(40),
      sourceCatalogSha256: FLOW_SCHEMA_FROZEN_EVIDENCE.sourceCatalogSha256,
      catalogLockSha256: FLOW_SCHEMA_FROZEN_EVIDENCE.catalogLockSha256,
      connect: async () => {
        connected = true;
        throw new Error("must not connect");
      },
    })).rejects.toThrow(/frozen value/);
    expect(connected).toBe(false);
  });

  it("redacts driver credentials from operational failures", () => {
    const safe = safeAdoptionError(
      new Error("connect postgresql://owner:password@host/flow password=hunter2 token=abc"),
    );
    expect(safe).not.toContain("hunter2");
    expect(safe).not.toContain("owner:password");
    expect(safe).not.toContain("token=abc");
  });
});
