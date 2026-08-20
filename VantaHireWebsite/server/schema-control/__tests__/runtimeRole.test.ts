import { describe, expect, it } from "vitest";

import {
  provisionRuntimeRole,
  resolveRuntimeRoleProvisioningEnv,
  safeRuntimeRoleError,
} from "../runtimeRole";

describe("runtime-role provisioning controls", () => {
  it("requires a one-run production gate and safe role identifier", () => {
    expect(() => resolveRuntimeRoleProvisioningEnv({} as NodeJS.ProcessEnv)).toThrow(/PROVISION=1/);
    expect(() => resolveRuntimeRoleProvisioningEnv({
      NODE_ENV: "production",
      FLOW_SCHEMA_ENVIRONMENT: "production",
      FLOW_RUNTIME_ROLE_PROVISION: "1",
      FLOW_MIGRATE_DATABASE_URL: "postgresql://owner:redacted@db.internal/flow",
      FLOW_RUNTIME_DATABASE_URL: "postgresql://bad-role:redacted@db.internal/flow",
      FLOW_RUNTIME_ROLE: "bad-role",
      FLOW_SCHEMA_TARGET_ID: "opaque",
    } as NodeJS.ProcessEnv)).toThrow(/lowercase PostgreSQL identifier/);
  });

  it("rejects mismatched configured targets before connecting", async () => {
    let connected = false;
    await expect(provisionRuntimeRole({
      migrateUrl: "postgresql://owner:redacted@db-a.internal/flow",
      runtimeUrl: "postgresql://flow_runtime:redacted@db-b.internal/flow",
      runtimeRole: "flow_runtime",
      expectedTargetId: "opaque",
      connectMigration: async () => {
        connected = true;
        throw new Error("must not connect");
      },
      connectRuntime: async () => {
        connected = true;
        throw new Error("must not connect");
      },
    })).rejects.toThrow(/same externally pinned database/);
    expect(connected).toBe(false);
  });

  it("redacts credentials in provisioning failures", () => {
    const safe = safeRuntimeRoleError(
      new Error("postgresql://owner:private@db/flow secret=value password=clear"),
    );
    expect(safe).not.toContain("private");
    expect(safe).not.toContain("secret=value");
    expect(safe).not.toContain("password=clear");
  });
});
