import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  provisionRuntimeRole,
  resolveRuntimeRoleProvisioningEnv,
  safeRuntimeRoleError,
} from "../runtimeRole";

describe("runtime-role provisioning controls", () => {
  const runtimeRoleSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "runtimeRole.ts"), "utf8");

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

  it("keeps both immutable decision-write exceptions exact and bounded", () => {
    expect(runtimeRoleSource).toContain("c.relname IN ('decision_events','decision_projection_outbox')");
    expect(runtimeRoleSource).toContain("has_table_privilege($1,c.oid,'INSERT')");
    for (const privilege of ["SELECT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
      expect(runtimeRoleSource).toContain(`NOT has_table_privilege($1,c.oid,'${privilege}')`);
    }
    expect(runtimeRoleSource).toContain("c.relname IN ('decision_event_sequence','decision_projection_outbox_sequence')");
    expect(runtimeRoleSource).toContain("has_sequence_privilege($1,c.oid,'USAGE')");
    expect(runtimeRoleSource).toContain("NOT has_sequence_privilege($1,c.oid,'SELECT')");
    expect(runtimeRoleSource).toContain("NOT has_sequence_privilege($1,c.oid,'UPDATE')");
    expect(runtimeRoleSource).toContain(`GRANT INSERT ON TABLE ${"${DECISION_EVENT_TABLE}"} TO ${"${ident}"}`);
    expect(runtimeRoleSource).toContain(`GRANT USAGE ON SEQUENCE ${"${DECISION_EVENT_SEQUENCE}"} TO ${"${ident}"}`);
    expect(runtimeRoleSource).toContain(`GRANT INSERT ON TABLE ${"${DECISION_OUTBOX_TABLE}"} TO ${"${ident}"}`);
    expect(runtimeRoleSource).toContain(`GRANT USAGE ON SEQUENCE ${"${DECISION_OUTBOX_SEQUENCE}"} TO ${"${ident}"}`);
    expect(runtimeRoleSource).toContain("Decision-outbox table/sequence presence is inconsistent.");
  });
});
