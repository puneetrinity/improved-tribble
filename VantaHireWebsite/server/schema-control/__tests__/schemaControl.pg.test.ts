// Gate 1A0-F — opt-in disposable PostgreSQL integration matrix.
//
// This suite is skipped unless FLOW_SCHEMA_TEST_DISPOSABLE=1 and
// both migration/runtime test URLs are explicitly supplied. Before its first
// write it proves both current_database and current_user start with
// `flow_schema_control_test_`, and the server is local/Unix-socket. It must
// never be pointed at Railway, production, staging, or a shared developer DB.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

import { assertSchemaReady, FLOW_CRITICAL_POSTCONDITIONS } from "../readiness";
import { runReleaseMigration, type MigrationClient } from "../runner";
import { loadManifest, sha256 } from "../manifest";
import { adoptExistingFlowDatabase } from "../adoption";
import { FLOW_SCHEMA_FROZEN_EVIDENCE } from "../frozenEvidence";
import { provisionRuntimeRole } from "../runtimeRole";

const databaseUrl = (process.env.FLOW_SCHEMA_TEST_DATABASE_URL ?? "").trim();
const runtimeDatabaseUrl = (process.env.FLOW_SCHEMA_TEST_RUNTIME_DATABASE_URL ?? "").trim();
const enabled =
  process.env.FLOW_SCHEMA_TEST_DISPOSABLE === "1" &&
  Boolean(databaseUrl) &&
  Boolean(runtimeDatabaseUrl);
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "schema-migrations");
const targetId = "disposable-integration-target";
const scratch: string[] = [];
let safeTargetProven = false;

async function connect(): Promise<MigrationClient> {
  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 2_000 });
  await client.connect();
  return {
    query: (text, params) => client.query(text, params as any),
    end: () => client.end(),
  };
}

async function directClient(): Promise<Client> {
  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 2_000 });
  await client.connect();
  return client;
}

async function runtimeClient(): Promise<Client> {
  const client = new Client({ connectionString: runtimeDatabaseUrl, connectionTimeoutMillis: 2_000 });
  await client.connect();
  return client;
}

function connectionForRole(role: string, password: string): string {
  const parsed = new URL(databaseUrl);
  parsed.username = role;
  parsed.password = password;
  return parsed.toString();
}

async function resetDatabase(): Promise<void> {
  const client = await directClient();
  try {
    await client.query("DROP SCHEMA IF EXISTS schema_control CASCADE");
    await client.query("DROP SCHEMA IF EXISTS public CASCADE");
    await client.query("CREATE SCHEMA public AUTHORIZATION CURRENT_USER");
  } finally {
    await client.end();
  }
}

function credentials(expectedTargetId = targetId) {
  return {
    migrateUrl: databaseUrl,
    expectedTargetId,
    environment: "development" as const,
    allowFreshInitialization: true,
  };
}

function withForwardMigration(name: string, sql: string): string {
  const dir = mkdtempSync(join(tmpdir(), "flow-schema-control-upgrade-"));
  scratch.push(dir);
  for (const file of [
    "0000_baseline.sql",
    "0001_candidate_privacy_flow.sql",
    "0002_resume_access_attempts.sql",
    "0003_application_workflow_assessments.sql",
    "catalog.lock.json",
  ]) {
    copyFileSync(join(migrationsDir, file), join(dir, file));
  }
  const file = `0004_${name}.sql`;
  writeFileSync(join(dir, file), sql);
  const catalogBytes = readFileSync(join(dir, "catalog.lock.json"));
  const currentLock = JSON.parse(readFileSync(join(migrationsDir, "checksums.lock"), "utf8")) as {
    migrations: Record<string, string>;
  };
  writeFileSync(
    join(dir, "checksums.lock"),
    `${JSON.stringify({
      format_version: 1,
      catalog_lock_sha256: sha256(catalogBytes),
      migrations: {
        "0000": currentLock.migrations["0000"],
        "0001": currentLock.migrations["0001"],
        "0002": currentLock.migrations["0002"],
        "0003": currentLock.migrations["0003"],
        "0004": sha256(sql),
      },
    }, null, 2)}\n`,
  );
  return dir;
}

function withBaselineOnlyManifest(): string {
  const dir = mkdtempSync(join(tmpdir(), "flow-schema-control-baseline-only-"));
  scratch.push(dir);
  for (const file of ["0000_baseline.sql", "catalog.lock.json"]) {
    copyFileSync(join(migrationsDir, file), join(dir, file));
  }
  const catalogBytes = readFileSync(join(dir, "catalog.lock.json"));
  const currentLock = JSON.parse(readFileSync(join(migrationsDir, "checksums.lock"), "utf8")) as {
    migrations: Record<string, string>;
  };
  writeFileSync(
    join(dir, "checksums.lock"),
    `${JSON.stringify({
      format_version: 1,
      catalog_lock_sha256: sha256(catalogBytes),
      migrations: { "0000": currentLock.migrations["0000"] },
    }, null, 2)}\n`,
  );
  return dir;
}

async function applicationCatalogFingerprint(client: Client): Promise<string> {
  // Deliberately excludes schema_control and environment-owned ACL/owner facts,
  // matching the adoption contract. It is not the production catalog
  // normalizer; it is an independent disposable assertion that adoption did
  // not change an existing public application object.
  const result = await client.query(`
    SELECT jsonb_build_object(
      'relations', COALESCE((
        SELECT jsonb_agg(jsonb_build_array(c.relkind, c.relname, c.reloptions) ORDER BY c.relkind, c.relname)
          FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
         WHERE n.nspname='public' AND c.relkind IN ('r','p','S','v','m')
      ), '[]'::jsonb),
      'columns', COALESCE((
        SELECT jsonb_agg(jsonb_build_array(c.relname, a.attnum, a.attname,
                 pg_catalog.format_type(a.atttypid,a.atttypmod), a.attnotnull,
                 pg_get_expr(d.adbin,d.adrelid)) ORDER BY c.relname,a.attnum)
          FROM pg_attribute a
          JOIN pg_class c ON c.oid=a.attrelid
          JOIN pg_namespace n ON n.oid=c.relnamespace
          LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
         WHERE n.nspname='public' AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped
      ), '[]'::jsonb),
      'constraints', COALESCE((
        SELECT jsonb_agg(jsonb_build_array(c.relname, con.conname, con.contype,
                 pg_get_constraintdef(con.oid,true)) ORDER BY c.relname,con.conname)
          FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid
          JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
      ), '[]'::jsonb),
      'indexes', COALESCE((
        SELECT jsonb_agg(jsonb_build_array(t.relname,i.relname,pg_get_indexdef(i.oid)) ORDER BY t.relname,i.relname)
          FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_class t ON t.oid=x.indrelid
          JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public'
      ), '[]'::jsonb),
      'triggers', COALESCE((
        SELECT jsonb_agg(jsonb_build_array(c.relname,t.tgname,pg_get_triggerdef(t.oid,true)) ORDER BY c.relname,t.tgname)
          FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
         WHERE n.nspname='public'
      ), '[]'::jsonb),
      'routines', COALESCE((
        SELECT jsonb_agg(jsonb_build_array(p.proname,pg_get_function_identity_arguments(p.oid),pg_get_functiondef(p.oid))
                         ORDER BY p.proname,pg_get_function_identity_arguments(p.oid))
          FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
      ), '[]'::jsonb)
    )::text AS catalog
  `);
  return sha256(String(result.rows[0]?.catalog ?? ""));
}

describe.skipIf(!enabled || !databaseUrl)("schema-control disposable PostgreSQL", () => {
  beforeAll(async () => {
    if (process.env.NODE_ENV !== "test") {
      throw new Error("Disposable schema-control integration requires NODE_ENV=test.");
    }
    const client = await directClient();
    try {
      const result = await client.query(
        `SELECT current_database() AS database, current_user AS role,
                host(inet_server_addr()) AS server_addr`,
      );
      const row = result.rows[0] ?? {};
      if (
        !String(row.database ?? "").startsWith("flow_schema_control_test_") ||
        row.role !== "flow_schema_control_test_runner" ||
        ![null, "127.0.0.1", "::1"].includes(row.server_addr ?? null)
      ) {
        throw new Error(
          "Refusing disposable schema-control integration: database, role, and local-server safety markers did not match.",
        );
      }
    } finally {
      await client.end();
    }
    const runtime = await runtimeClient();
    try {
      const result = await runtime.query(
        `SELECT current_database() AS database, current_user AS role,
                host(inet_server_addr()) AS server_addr`,
      );
      const row = result.rows[0] ?? {};
      if (
        !String(row.database ?? "").startsWith("flow_schema_control_test_") ||
        row.role !== "flow_schema_control_test_runtime" ||
        ![null, "127.0.0.1", "::1"].includes(row.server_addr ?? null)
      ) {
        throw new Error(
          "Refusing disposable schema-control integration: runtime database, role, and local-server safety markers did not match.",
        );
      }
      safeTargetProven = true;
    } finally {
      await runtime.end();
    }
  });

  beforeEach(async () => {
    if (!safeTargetProven) throw new Error("Disposable target proof did not complete; refusing database reset.");
    await resetDatabase();
  });
  afterAll(async () => {
    if (safeTargetProven) await resetDatabase();
    for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
  });

  it("installs the exact baseline once and repeats as a no-op", async () => {
    const first = await runReleaseMigration({ migrationsDir, creds: credentials(), connect });
    expect(first).toEqual({ identityMode: "fresh", applied: ["0000", "0001", "0002", "0003"] });

    const second = await runReleaseMigration({ migrationsDir, creds: credentials(), connect });
    expect(second).toEqual({ identityMode: "adopted", applied: [] });

    const client = await directClient();
    try {
      const ledger = await client.query(
        "SELECT version, apply_mode FROM schema_control.applied ORDER BY version",
      );
      expect(ledger.rows).toEqual([
        { version: "0000", apply_mode: "fresh" },
        { version: "0001", apply_mode: "adopted" },
        { version: "0002", apply_mode: "adopted" },
        { version: "0003", apply_mode: "adopted" },
      ]);
      const businessRows = await client.query(
        "SELECT (SELECT COUNT(*)::integer FROM users) AS users, " +
          "(SELECT COUNT(*)::integer FROM jobs) AS jobs, " +
          "(SELECT COUNT(*)::integer FROM applications) AS applications",
      );
      expect(businessRows.rows[0]).toEqual({ users: 0, jobs: 0, applications: 0 });
      const resumeAudit = await client.query(`
        SELECT
          to_regclass('public.resume_access_attempts')::text AS relation,
          (SELECT COUNT(*)::integer
             FROM pg_constraint
            WHERE conrelid='public.resume_access_attempts'::regclass
              AND conname LIKE 'resume_access_attempts_%_check') AS checks,
          (SELECT COUNT(*)::integer
             FROM pg_indexes
            WHERE schemaname='public' AND tablename='resume_access_attempts') AS indexes
      `);
      expect(resumeAudit.rows[0]).toEqual({
        relation: "resume_access_attempts",
        checks: 6,
        indexes: 4,
      });
      const workflowAssessments = await client.query(`
        SELECT
          to_regclass('public.application_reviewer_notes')::text AS notes_relation,
          to_regclass('public.application_reviewer_ratings')::text AS ratings_relation,
          (SELECT COUNT(*)::integer
             FROM information_schema.columns
            WHERE table_schema='public'
              AND table_name='application_feedback'
              AND column_name='rubric_version'
              AND is_nullable='NO'
              AND column_default LIKE '%legacy-unversioned-v1%') AS feedback_rubric,
          (SELECT COUNT(*)::integer
             FROM pg_constraint
            WHERE conrelid IN (
              'public.application_reviewer_notes'::regclass,
              'public.application_reviewer_ratings'::regclass,
              'public.application_feedback'::regclass
            )
              AND conname IN (
                'application_reviewer_notes_note_length_check',
                'application_reviewer_notes_visibility_check',
                'application_reviewer_ratings_rating_check',
                'application_reviewer_ratings_rubric_version_check',
                'application_feedback_rubric_version_check'
              )) AS checks,
          (SELECT COUNT(*)::integer
             FROM pg_indexes
            WHERE schemaname='public'
              AND tablename IN ('application_reviewer_notes','application_reviewer_ratings')) AS indexes
      `);
      expect(workflowAssessments.rows[0]).toEqual({
        notes_relation: "application_reviewer_notes",
        ratings_relation: "application_reviewer_ratings",
        feedback_rubric: 1,
        checks: 5,
        indexes: 7,
      });
    } finally {
      await client.end();
    }
  }, 120_000);

  it("applies a representative forward migration exactly once", async () => {
    await runReleaseMigration({ migrationsDir, creds: credentials(), connect });
    const upgradeDir = withForwardMigration(
      "representative",
      "CREATE TABLE public.schema_control_upgrade_probe (id integer PRIMARY KEY);\n",
    );
    const upgraded = await runReleaseMigration({
      migrationsDir: upgradeDir,
      creds: credentials(),
      connect,
    });
    expect(upgraded.applied).toEqual(["0004"]);
    const repeat = await runReleaseMigration({
      migrationsDir: upgradeDir,
      creds: credentials(),
      connect,
    });
    expect(repeat.applied).toEqual([]);
  }, 120_000);

  it("serializes two concurrent release runners", async () => {
    const [a, b] = await Promise.all([
      runReleaseMigration({ migrationsDir, creds: credentials(), connect, lockWaitMs: 120_000 }),
      runReleaseMigration({ migrationsDir, creds: credentials(), connect, lockWaitMs: 120_000 }),
    ]);
    expect([...a.applied, ...b.applied]).toEqual(["0000", "0001", "0002", "0003"]);
    const client = await directClient();
    try {
      const applied = await client.query("SELECT COUNT(*)::integer AS n FROM schema_control.applied");
      expect(applied.rows[0]?.n).toBe(4);
      const runs = await client.query(
        "SELECT COUNT(*)::integer AS n, COUNT(*) FILTER (WHERE outcome='success')::integer AS success FROM schema_control.run",
      );
      expect(runs.rows[0]).toEqual({ n: 2, success: 2 });
    } finally {
      await client.end();
    }
  }, 180_000);

  it("rolls back a failed forward migration and blocks readiness", async () => {
    await runReleaseMigration({ migrationsDir, creds: credentials(), connect });
    const brokenDir = withForwardMigration(
      "broken",
      "CREATE TABLE public.should_rollback (id integer); SELECT 1/0;\n",
    );
    await expect(
      runReleaseMigration({ migrationsDir: brokenDir, creds: credentials(), connect }),
    ).rejects.toThrow(/rolled back/);

    const client = await directClient();
    try {
      const state = await client.query(
        "SELECT to_regclass('public.should_rollback') AS leaked, " +
          "(SELECT COUNT(*)::integer FROM schema_control.applied) AS applied",
      );
      expect(state.rows[0]).toEqual({ leaked: null, applied: 4 });
      await expect(
        assertSchemaReady({
          pg: { query: (text, params) => client.query(text, params as any) },
          migrationsDir: brokenDir,
          environment: "development",
          expectedTargetId: targetId,
          criticalPostconditions: [{ name: "intentional failure", check: async () => false }],
        }),
      ).rejects.toThrow();
    } finally {
      await client.end();
    }
  }, 120_000);

  it("rejects a wrong target before application or ledger mutation", async () => {
    await runReleaseMigration({ migrationsDir, creds: credentials(), connect });
    const client = await directClient();
    try {
      const before = await client.query(
        "SELECT (SELECT COUNT(*)::integer FROM schema_control.applied) AS applied, " +
          "(SELECT COUNT(*)::integer FROM schema_control.run) AS runs, " +
          "(SELECT COUNT(*)::integer FROM users) AS users",
      );
      await expect(
        runReleaseMigration({
          migrationsDir,
          creds: credentials("wrong-target"),
          connect,
        }),
      ).rejects.toThrow(/identity does not match/);
      const after = await client.query(
        "SELECT (SELECT COUNT(*)::integer FROM schema_control.applied) AS applied, " +
          "(SELECT COUNT(*)::integer FROM schema_control.run) AS runs, " +
          "(SELECT COUNT(*)::integer FROM users) AS users",
      );
      expect(after.rows[0]).toEqual(before.rows[0]);
    } finally {
      await client.end();
    }
  }, 120_000);

  it("provisions the restricted role and adopts legacy baseline with control-only mutation", async () => {
    const client = await directClient();
    const manifest = loadManifest(migrationsDir);
    const adoptionDir = withBaselineOnlyManifest();
    const adoptedTarget = "disposable-adoption-target";
    try {
      // Model an existing legacy database: exact application baseline, no
      // schema_control metadata and no application/business rows.
      await client.query("BEGIN");
      await client.query(manifest[0]!.sql);
      await client.query("COMMIT");
      const beforeCatalog = await applicationCatalogFingerprint(client);
      const beforeRows = await client.query(
        "SELECT (SELECT COUNT(*)::integer FROM users) AS users, " +
          "(SELECT COUNT(*)::integer FROM jobs) AS jobs, " +
          "(SELECT COUNT(*)::integer FROM applications) AS applications",
      );

      const provision = () => provisionRuntimeRole({
        migrateUrl: databaseUrl,
        runtimeUrl: runtimeDatabaseUrl,
        runtimeRole: "flow_schema_control_test_runtime",
        expectedTargetId: adoptedTarget,
        connectMigration: connect,
        connectRuntime: async () => {
          const runtime = await runtimeClient();
          return {
            query: (text, params) => runtime.query(text, params as any),
            end: () => runtime.end(),
          };
        },
      });
      await expect(provision()).resolves.toEqual({ controlPlaneReady: false });
      await expect(provision()).resolves.toEqual({ controlPlaneReady: false });

      // Hostile pre-existing roles are refused rather than silently demoted.
      await client.query(
        "CREATE ROLE flow_schema_control_test_hostile LOGIN SUPERUSER PASSWORD 'hostile-test-only'",
      );
      try {
        await expect(provisionRuntimeRole({
          migrateUrl: databaseUrl,
          runtimeUrl: connectionForRole("flow_schema_control_test_hostile", "hostile-test-only"),
          runtimeRole: "flow_schema_control_test_hostile",
          expectedTargetId: adoptedTarget,
          connectMigration: connect,
          connectRuntime: connect,
        })).rejects.toThrow(/hostile pre-existing runtime role/);
      } finally {
        await client.query("DROP ROLE flow_schema_control_test_hostile");
      }

      const adopt = () => adoptExistingFlowDatabase({
        migrationsDir: adoptionDir,
        migrateUrl: databaseUrl,
        expectedTargetId: adoptedTarget,
        runtimeRole: "flow_schema_control_test_runtime",
        deployedSourceSha: FLOW_SCHEMA_FROZEN_EVIDENCE.deployedSourceSha,
        sourceCatalogSha256: FLOW_SCHEMA_FROZEN_EVIDENCE.sourceCatalogSha256,
        catalogLockSha256: FLOW_SCHEMA_FROZEN_EVIDENCE.catalogLockSha256,
        connect,
      });

      // A partial control plane is an incident, never a repair shortcut.
      await client.query("CREATE SCHEMA schema_control");
      await expect(adopt()).rejects.toThrow(/already exists wholly or partially/);
      await client.query("DROP SCHEMA schema_control");

      // Force a contract failure after CONTROL_DDL to prove the whole adoption
      // transaction (including schema creation) rolls back.
      await client.query(
        "ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE INSERT ON TABLES FROM flow_schema_control_test_runtime",
      );
      await expect(adopt()).rejects.toThrow(/default-privilege contract/);
      expect(
        (await client.query("SELECT to_regnamespace('schema_control') AS s")).rows[0]?.s,
      ).toBeNull();
      await provision();

      // Frozen source/catalog mismatches fail before a database connection.
      await expect(adoptExistingFlowDatabase({
        migrationsDir: adoptionDir,
        migrateUrl: databaseUrl,
        expectedTargetId: adoptedTarget,
        runtimeRole: "flow_schema_control_test_runtime",
        deployedSourceSha: "0".repeat(40),
        sourceCatalogSha256: FLOW_SCHEMA_FROZEN_EVIDENCE.sourceCatalogSha256,
        catalogLockSha256: FLOW_SCHEMA_FROZEN_EVIDENCE.catalogLockSha256,
        connect: async () => { throw new Error("must not connect"); },
      })).rejects.toThrow(/frozen value/);

      await expect(adopt()).resolves.toEqual({ identityMode: "adopted", applied: ["0000"] });
      await expect(adopt()).rejects.toThrow(/already exists wholly or partially/);

      expect(await applicationCatalogFingerprint(client)).toBe(beforeCatalog);
      const afterRows = await client.query(
        "SELECT (SELECT COUNT(*)::integer FROM users) AS users, " +
          "(SELECT COUNT(*)::integer FROM jobs) AS jobs, " +
          "(SELECT COUNT(*)::integer FROM applications) AS applications",
      );
      expect(afterRows.rows[0]).toEqual(beforeRows.rows[0]);

      const privacyUpgrade = await runReleaseMigration({
        migrationsDir,
        creds: {
          migrateUrl: databaseUrl,
          expectedTargetId: adoptedTarget,
          environment: "production",
          allowFreshInitialization: false,
        },
        connect,
      });
      expect(privacyUpgrade).toEqual({ identityMode: "adopted", applied: ["0001", "0002", "0003"] });
      const noOp = await runReleaseMigration({
        migrationsDir,
        creds: {
          migrateUrl: databaseUrl,
          expectedTargetId: adoptedTarget,
          environment: "production",
          allowFreshInitialization: false,
        },
        connect,
      });
      expect(noOp).toEqual({ identityMode: "adopted", applied: [] });

      // Prove the default-privilege contract through an actual tracked forward
      // migration. Objects remain owned by the migration role while becoming
      // immediately usable by the runtime role.
      const runtimeGrantDir = withForwardMigration(
        "runtime_grant_probe",
        "CREATE SEQUENCE public.schema_control_default_sequence_probe;\n" +
          "CREATE TABLE public.schema_control_default_table_probe " +
          "(id bigint DEFAULT nextval('public.schema_control_default_sequence_probe') PRIMARY KEY);\n" +
          "CREATE FUNCTION public.schema_control_default_function_probe() RETURNS integer " +
          "LANGUAGE sql IMMUTABLE AS 'SELECT 1';\n",
      );
      const forward = await runReleaseMigration({
        migrationsDir: runtimeGrantDir,
        creds: {
          migrateUrl: databaseUrl,
          expectedTargetId: adoptedTarget,
          environment: "production",
          allowFreshInitialization: false,
        },
        connect,
      });
      expect(forward).toEqual({ identityMode: "adopted", applied: ["0004"] });

      const runtime = await runtimeClient();
      try {
        await runtime.query("BEGIN READ ONLY");
        const ready = await assertSchemaReady({
          pg: { query: (text, params) => runtime.query(text, params as any) },
          migrationsDir: runtimeGrantDir,
          environment: "production",
          expectedTargetId: adoptedTarget,
          criticalPostconditions: FLOW_CRITICAL_POSTCONDITIONS,
        });
        expect(ready).toEqual({ version: "0004", applied: 5 });
        await runtime.query("ROLLBACK");

        // Readiness proves privileges catalogically. Positive execution proves
        // the inherited table/sequence/routine grants, while the negative DDL
        // attempt independently confirms the role remains non-owner runtime.
        await runtime.query("BEGIN");
        expect(
          (await runtime.query(
            "INSERT INTO public.schema_control_default_table_probe DEFAULT VALUES RETURNING id",
          )).rows[0]?.id,
        ).toBe("1");
        expect(
          (await runtime.query("SELECT public.schema_control_default_function_probe() AS value"))
            .rows[0]?.value,
        ).toBe(1);
        await runtime.query("SAVEPOINT runtime_must_not_ddl");
        await expect(
          runtime.query("CREATE TABLE public.runtime_must_not_create (id integer)"),
        ).rejects.toMatchObject({ code: "42501" });
        await runtime.query("ROLLBACK TO SAVEPOINT runtime_must_not_ddl");
        await runtime.query("ROLLBACK");

        // Readiness must also fail closed if a later operator accidentally
        // expands the runtime role beyond the exact DML contract.
        await client.query(
          "GRANT TRUNCATE ON public.schema_control_default_table_probe TO flow_schema_control_test_runtime",
        );
        try {
          await runtime.query("BEGIN READ ONLY");
          await expect(assertSchemaReady({
            pg: { query: (text, params) => runtime.query(text, params as any) },
            migrationsDir: runtimeGrantDir,
            environment: "production",
            expectedTargetId: adoptedTarget,
            criticalPostconditions: FLOW_CRITICAL_POSTCONDITIONS,
          })).rejects.toThrow(/Runtime role has application rights/);
          await runtime.query("ROLLBACK");
        } finally {
          await client.query(
            "REVOKE TRUNCATE ON public.schema_control_default_table_probe FROM flow_schema_control_test_runtime",
          );
        }
      } finally {
        await runtime.end();
      }
    } finally {
      await client.end();
    }
  }, 120_000);
});
