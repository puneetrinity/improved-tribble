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

  async function probeExistingRole(prior: Record<string, unknown> | null, denied = false) {
    const statements: string[] = [];
    const client = { query: async (statement: string) => {
      statements.push(statement);
      if (statement.includes("current_database() AS database")) return { rows: [{ database: "local_test", database_oid: "1", address: null, port: null }] };
      if (statement.includes("current_user AS role, r.rolsuper")) return { rows: [{ role: "local_owner", rolsuper: false, rolcreaterole: true }] };
      if (statement.includes("r.oid::text AS oid")) return { rows: prior ? [prior] : [] };
      if (denied && statement.startsWith("ALTER ROLE")) throw new Error("permission denied to alter role");
      if (statement.includes("set_config('flow.runtime_role_name'")) throw new Error("bounded_probe_stop");
      return { rows: [] };
    }, end: async () => {} };
    await expect(provisionRuntimeRole({ migrateUrl: "postgresql://local_owner:test@127.0.0.1/local_test",
      runtimeUrl: "postgresql://local_runtime:test@127.0.0.1/local_test", runtimeRole: "local_runtime", expectedTargetId: "local-test",
      connectMigration: async () => client, connectRuntime: async () => { throw new Error("must_not_connect"); },
    })).rejects.toThrow();
    expect(statements).toContain("ROLLBACK");
    expect(statements).not.toContain("COMMIT");
    return statements;
  }

  it("A2 reconciles an already-safe role without reasserting superuser-only attributes", async () => {
    const statements = await probeExistingRole({ rolcanlogin: true });
    expect(statements.filter(s => s.startsWith("ALTER ROLE"))).toEqual(['ALTER ROLE "local_runtime" LOGIN NOINHERIT']);
    expect(statements.some(s => s.includes("set_config('flow.runtime_role_name'"))).toBe(true);
  });

  it("A2 keeps every restricted attribute on fresh role creation", async () => {
    const statements = await probeExistingRole(null);
    expect(statements).toContain('CREATE ROLE "local_runtime" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS');
  });

  it.each(["rolsuper", "rolcreatedb", "rolcreaterole", "rolreplication", "rolbypassrls", "has_membership",
    "owns_database", "owns_schema", "owns_relation", "owns_routine"])("A2 still refuses hostile %s before alteration", async flag => {
    const statements = await probeExistingRole({ rolcanlogin: true, [flag]: true });
    expect(statements.some(s => /^(ALTER ROLE|CREATE ROLE)/.test(s))).toBe(false);
  });

  it("A2 propagates missing role administration authority without issuing grants", async () => {
    const statements = await probeExistingRole({ rolcanlogin: true }, true);
    expect(statements.some(s => s.startsWith("GRANT "))).toBe(false);
    expect(statements.some(s => s.includes("set_config('flow.runtime_role_name'"))).toBe(false);
  });

  it("keeps immutable writes and mutable delivery functions exact and bounded", () => {
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
    expect(runtimeRoleSource).toContain("c.relname = 'decision_projection_delivery_state'");
    expect(runtimeRoleSource).toContain(`REVOKE ALL PRIVILEGES ON TABLE ${"${DECISION_DELIVERY_TABLE}"} FROM ${"${ident}"}`);
    for (const signature of [
      "claim_decision_projection_delivery(integer,integer)",
      "ack_decision_projection_delivery(uuid,uuid,bigint,bigint,text)",
      "fail_decision_projection_delivery(uuid,uuid,bigint,text,boolean,integer)",
    ]) {
      expect(runtimeRoleSource).toContain(signature);
    }
    expect(runtimeRoleSource).toContain("Decision-delivery table/function presence is inconsistent.");
    expect(runtimeRoleSource).toContain("c.relname IN ('organization_candidate_references','application_resume_versions')");
    expect(runtimeRoleSource).toContain("c.relname = 'organization_candidate_memory_outbox'");
    expect(runtimeRoleSource).toContain("GRANT SELECT,INSERT ON TABLE ${table} TO ${ident}");
    expect(runtimeRoleSource).toContain(
      `GRANT INSERT ON TABLE ${"${ORGANIZATION_CANDIDATE_OUTBOX_TABLE}"} TO ${"${ident}"}`,
    );
    for (const signature of [
      "claim_organization_candidate_memory_intents(text,integer,integer)",
      "ack_organization_candidate_memory_intent(uuid,integer,uuid)",
      "fail_organization_candidate_memory_intent(uuid,integer,text,timestamp with time zone)",
    ]) {
      expect(runtimeRoleSource).toContain(signature);
    }
    expect(runtimeRoleSource).toContain("Organization-candidate table/function presence is inconsistent.");
  });
});
