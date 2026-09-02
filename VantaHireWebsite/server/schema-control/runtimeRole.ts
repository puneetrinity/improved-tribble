// Gate 1A0-R-A — secret-safe migration-owner/runtime-role separation.
//
// This module is never imported by a runtime process. It runs only from the
// manual release service with an explicit one-run flag. It never logs or
// returns a DSN/password and refuses role membership, ownership or elevated
// attributes before reconciling the bounded application privileges.

import type { PgLike } from "./ledger";
import { DEFAULT_LOCK_KEY, type MigrationClient } from "./runner";
import { assertRoleName, quoteIdentifier } from "./sqlIdentifier";
import {
  resolveSchemaEnvironment,
  safeOperationalMessage,
  safeTargetFingerprint,
} from "./targetIdentity";

export class RuntimeRoleProvisionError extends Error {}

export interface RuntimeRoleClient extends MigrationClient {}

export interface RuntimeRoleProvisionOptions {
  migrateUrl: string;
  runtimeUrl: string;
  runtimeRole: string;
  expectedTargetId: string;
  connectMigration: (url: string) => Promise<RuntimeRoleClient>;
  connectRuntime: (url: string) => Promise<RuntimeRoleClient>;
  lockKey?: number;
  lockWaitMs?: number;
  statementTimeoutMs?: number;
}

interface ConnectionTarget {
  host: string;
  port: string;
  database: string;
}

interface DatabaseFingerprint {
  databaseOid: string;
  database: string;
  address: string | null;
  port: number | null;
}

const DECISION_EVENT_TABLE = "public.decision_events";
const DECISION_EVENT_SEQUENCE = "public.decision_event_sequence";

function connectionTarget(raw: string): ConnectionTarget {
  try {
    const parsed = new URL(raw);
    if (!/^postgres(?:ql)?:$/.test(parsed.protocol)) throw new Error("protocol");
    const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
    const host = decodeURIComponent(parsed.searchParams.get("host") ?? parsed.hostname).toLowerCase();
    const port = (parsed.searchParams.get("port") ?? parsed.port) || "5432";
    if (!database || !host) throw new Error("target");
    return { host, port, database };
  } catch {
    throw new RuntimeRoleProvisionError(
      "Migration and runtime credentials must be PostgreSQL URLs with an explicit host and database.",
    );
  }
}

function assertSameConfiguredTarget(migrateUrl: string, runtimeUrl: string, runtimeRole: string): void {
  const migration = connectionTarget(migrateUrl);
  const runtime = connectionTarget(runtimeUrl);
  if (
    migration.host !== runtime.host ||
    migration.port !== runtime.port ||
    migration.database !== runtime.database
  ) {
    throw new RuntimeRoleProvisionError(
      "Migration and runtime credentials do not name the same externally pinned database target.",
    );
  }
  try {
    const runtimeUser = decodeURIComponent(new URL(runtimeUrl).username);
    if (runtimeUser !== runtimeRole) throw new Error("user");
    if (!new URL(runtimeUrl).password) throw new Error("password");
  } catch {
    throw new RuntimeRoleProvisionError(
      "Runtime credential must contain the exact configured runtime role and a non-empty protected password.",
    );
  }
}

async function readDatabaseFingerprint(pg: PgLike): Promise<DatabaseFingerprint> {
  const result = await pg.query(`
    SELECT current_database() AS database,
           (SELECT oid::text FROM pg_catalog.pg_database WHERE datname = current_database()) AS database_oid,
           inet_server_addr()::text AS address,
           inet_server_port() AS port
  `);
  const row = result.rows[0] ?? {};
  return {
    databaseOid: String(row.database_oid ?? ""),
    database: String(row.database ?? ""),
    address: row.address ?? null,
    port: row.port === null || row.port === undefined ? null : Number(row.port),
  };
}

function sameDatabase(a: DatabaseFingerprint, b: DatabaseFingerprint): boolean {
  return (
    Boolean(a.databaseOid) &&
    a.databaseOid === b.databaseOid &&
    a.database === b.database &&
    a.address === b.address &&
    a.port === b.port
  );
}

async function readRoleState(pg: PgLike, role: string): Promise<any | null> {
  const result = await pg.query(
    `SELECT r.oid::text AS oid, r.rolcanlogin, r.rolsuper, r.rolcreatedb,
            r.rolcreaterole, r.rolreplication, r.rolbypassrls,
            EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member = r.oid) AS has_membership,
            EXISTS (SELECT 1 FROM pg_catalog.pg_database d WHERE d.datdba = r.oid) AS owns_database,
            EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspowner = r.oid) AS owns_schema,
            EXISTS (
              SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
               WHERE c.relowner=r.oid AND n.nspname IN ('public','schema_control')
            ) AS owns_relation,
            EXISTS (
              SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
               WHERE p.proowner=r.oid AND n.nspname IN ('public','schema_control')
            ) AS owns_routine
       FROM pg_catalog.pg_roles r WHERE r.rolname=$1`,
    [role],
  );
  return result.rows[0] ?? null;
}

function assertSafeExistingRole(state: any | null): void {
  if (!state) return;
  if (
    state.rolsuper ||
    state.rolcreatedb ||
    state.rolcreaterole ||
    state.rolreplication ||
    state.rolbypassrls ||
    state.has_membership ||
    state.owns_database ||
    state.owns_schema ||
    state.owns_relation ||
    state.owns_routine
  ) {
    throw new RuntimeRoleProvisionError(
      "Refusing to reconcile an elevated, member, owner, or otherwise hostile pre-existing runtime role.",
    );
  }
}

async function assertDefaultPrivileges(pg: PgLike, role: string, controlPlanePresent: boolean): Promise<void> {
  const result = await pg.query(
    `SELECT COALESCE(jsonb_object_agg(scope, privileges), '{}'::jsonb) AS grants
       FROM (
         SELECT n.nspname || ':' || d.defaclobjtype::text AS scope,
                jsonb_agg(DISTINCT upper(x.privilege_type) ORDER BY upper(x.privilege_type)) AS privileges
           FROM pg_catalog.pg_default_acl d
           JOIN pg_catalog.pg_roles owner_role ON owner_role.oid=d.defaclrole
           LEFT JOIN pg_catalog.pg_namespace n ON n.oid=d.defaclnamespace
           CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) x
           JOIN pg_catalog.pg_roles grantee_role ON grantee_role.oid=x.grantee
          WHERE owner_role.rolname=current_user AND grantee_role.rolname=$1
            AND n.nspname IN ('public','schema_control')
          GROUP BY n.nspname, d.defaclobjtype
       ) expected`,
    [role],
  );
  const grants = result.rows[0]?.grants ?? {};
  const exact = (key: string, expected: string[]) =>
    JSON.stringify([...(grants[key] ?? [])].sort()) === JSON.stringify([...expected].sort());
  if (
    !exact("public:r", ["DELETE", "INSERT", "SELECT", "UPDATE"]) ||
    !exact("public:S", ["SELECT", "UPDATE", "USAGE"]) ||
    !exact("public:f", ["EXECUTE"]) ||
    (controlPlanePresent && !exact("schema_control:r", ["SELECT"]))
  ) {
    throw new RuntimeRoleProvisionError("Runtime default-privilege contract is incomplete or excessive.");
  }
}

/** Prove the effective role boundary from the migration connection. */
export async function assertRuntimeRoleContract(
  pg: PgLike,
  role: string,
  controlPlaneRequired: boolean,
): Promise<void> {
  const state = await readRoleState(pg, role);
  assertSafeExistingRole(state);
  if (!state?.rolcanlogin) {
    throw new RuntimeRoleProvisionError("Runtime role is absent or cannot log in.");
  }
  const result = await pg.query(
    `SELECT
       has_database_privilege($1, current_database(), 'CONNECT')
       AND has_schema_privilege($1, 'public', 'USAGE')
       AND NOT has_schema_privilege($1, 'public', 'CREATE')
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND c.relkind IN ('r','p')
            AND NOT (
              (
                c.relname='decision_events'
                AND has_table_privilege($1,c.oid,'INSERT')
                AND NOT has_table_privilege($1,c.oid,'SELECT')
                AND NOT has_table_privilege($1,c.oid,'UPDATE')
                AND NOT has_table_privilege($1,c.oid,'DELETE')
                AND NOT has_table_privilege($1,c.oid,'TRUNCATE')
                AND NOT has_table_privilege($1,c.oid,'REFERENCES')
                AND NOT has_table_privilege($1,c.oid,'TRIGGER')
              )
              OR
              (
                c.relname<>'decision_events'
                AND has_table_privilege($1,c.oid,'SELECT')
                AND has_table_privilege($1,c.oid,'INSERT')
                AND has_table_privilege($1,c.oid,'UPDATE')
                AND has_table_privilege($1,c.oid,'DELETE')
                AND NOT has_table_privilege($1,c.oid,'TRUNCATE')
                AND NOT has_table_privilege($1,c.oid,'REFERENCES')
                AND NOT has_table_privilege($1,c.oid,'TRIGGER')
              )
            )
       )
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND c.relkind='S'
            AND NOT (
              (
                c.relname='decision_event_sequence'
                AND has_sequence_privilege($1,c.oid,'USAGE')
                AND NOT has_sequence_privilege($1,c.oid,'SELECT')
                AND NOT has_sequence_privilege($1,c.oid,'UPDATE')
              )
              OR
              (
                c.relname<>'decision_event_sequence'
                AND has_sequence_privilege($1,c.oid,'USAGE')
                AND has_sequence_privilege($1,c.oid,'SELECT')
                AND has_sequence_privilege($1,c.oid,'UPDATE')
              )
            )
       )
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname='public' AND NOT has_function_privilege($1,p.oid,'EXECUTE')
       )
       AND (
         NOT $2::boolean OR (
           has_schema_privilege($1,'schema_control','USAGE')
           AND NOT has_schema_privilege($1,'schema_control','CREATE')
           AND has_table_privilege($1,'schema_control.identity','SELECT')
           AND has_table_privilege($1,'schema_control.applied','SELECT')
           AND has_table_privilege($1,'schema_control.run','SELECT')
           AND NOT has_table_privilege($1,'schema_control.identity','INSERT')
           AND NOT has_table_privilege($1,'schema_control.identity','UPDATE')
           AND NOT has_table_privilege($1,'schema_control.identity','DELETE')
           AND NOT has_table_privilege($1,'schema_control.identity','TRUNCATE')
           AND NOT has_table_privilege($1,'schema_control.identity','REFERENCES')
           AND NOT has_table_privilege($1,'schema_control.identity','TRIGGER')
           AND NOT has_table_privilege($1,'schema_control.applied','INSERT')
           AND NOT has_table_privilege($1,'schema_control.applied','UPDATE')
           AND NOT has_table_privilege($1,'schema_control.applied','DELETE')
           AND NOT has_table_privilege($1,'schema_control.applied','TRUNCATE')
           AND NOT has_table_privilege($1,'schema_control.applied','REFERENCES')
           AND NOT has_table_privilege($1,'schema_control.applied','TRIGGER')
           AND NOT has_table_privilege($1,'schema_control.run','INSERT')
           AND NOT has_table_privilege($1,'schema_control.run','UPDATE')
           AND NOT has_table_privilege($1,'schema_control.run','DELETE')
           AND NOT has_table_privilege($1,'schema_control.run','TRUNCATE')
           AND NOT has_table_privilege($1,'schema_control.run','REFERENCES')
           AND NOT has_table_privilege($1,'schema_control.run','TRIGGER')
         )
       ) AS ok`,
    [role, controlPlaneRequired],
  );
  if (result.rows[0]?.ok !== true) {
    throw new RuntimeRoleProvisionError("Runtime effective-privilege contract is incomplete or excessive.");
  }
  await assertDefaultPrivileges(pg, role, controlPlaneRequired);
}

export async function provisionRuntimeRole(opts: RuntimeRoleProvisionOptions): Promise<{
  controlPlaneReady: boolean;
}> {
  const role = assertRoleName(opts.runtimeRole);
  assertSameConfiguredTarget(opts.migrateUrl, opts.runtimeUrl, role);
  const migration = await opts.connectMigration(opts.migrateUrl);
  const targetFingerprint = safeTargetFingerprint(opts.expectedTargetId);
  let migrationFingerprint: DatabaseFingerprint | null = null;
  let controlPlanePresent = false;
  try {
    await migration.query(`SET statement_timeout = ${Math.max(1, opts.statementTimeoutMs ?? 30_000)}`);
    await migration.query(`SET lock_timeout = ${Math.max(1, opts.lockWaitMs ?? 10_000)}`);
    await migration.query("BEGIN");
    try {
      await migration.query("SELECT pg_advisory_xact_lock($1)", [opts.lockKey ?? DEFAULT_LOCK_KEY]);
      migrationFingerprint = await readDatabaseFingerprint(migration);
      const authority = await migration.query(
        `SELECT current_user AS role, r.rolsuper, r.rolcreaterole
           FROM pg_catalog.pg_roles r WHERE r.rolname=current_user`,
      );
      if (!authority.rows[0] || (!authority.rows[0].rolsuper && !authority.rows[0].rolcreaterole)) {
        throw new RuntimeRoleProvisionError("Migration credential lacks the bounded role-provisioning authority.");
      }
      if (authority.rows[0].role === role) {
        throw new RuntimeRoleProvisionError("Migration owner and runtime role must be distinct.");
      }

      const prior = await readRoleState(migration, role);
      assertSafeExistingRole(prior);
      const ident = quoteIdentifier(role);
      if (!prior) {
        await migration.query(
          `CREATE ROLE ${ident} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
        );
      } else {
        await migration.query(
          `ALTER ROLE ${ident} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
        );
      }
      // Keep the password out of SQL text. The one transaction-local custom
      // GUC feeds dynamic ALTER ROLE; successful logs cannot expose the bind.
      const runtimePassword = decodeURIComponent(new URL(opts.runtimeUrl).password);
      await migration.query(
        "SELECT set_config('flow.runtime_role_name',$1,true), set_config('flow.runtime_role_password',$2,true)",
        [role, runtimePassword],
      );
      await migration.query(`DO $flow$
        BEGIN
          EXECUTE format('ALTER ROLE %I PASSWORD %L',
            current_setting('flow.runtime_role_name'),
            current_setting('flow.runtime_role_password'));
        END
      $flow$`);

      const database = quoteIdentifier(migrationFingerprint.database);
      await migration.query(`REVOKE ALL PRIVILEGES ON DATABASE ${database} FROM ${ident}`);
      await migration.query(`GRANT CONNECT ON DATABASE ${database} TO ${ident}`);
      await migration.query(`REVOKE ALL PRIVILEGES ON SCHEMA public FROM ${ident}`);
      await migration.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
      await migration.query(`GRANT USAGE ON SCHEMA public TO ${ident}`);
      await migration.query(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ${ident}`);
      await migration.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ${ident}`);
      await migration.query(`REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM ${ident}`);
      await migration.query(`GRANT USAGE,SELECT,UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${ident}`);
      await migration.query(`REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM ${ident}`);
      await migration.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${ident}`);
      await migration.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM ${ident}`);
      await migration.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO ${ident}`);
      await migration.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM ${ident}`);
      await migration.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE,SELECT,UPDATE ON SEQUENCES TO ${ident}`);
      await migration.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM ${ident}`);
      await migration.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO ${ident}`);

      // Wave 3A's event authority is intentionally write-only to an ordinary
      // runtime. Older disposable/pre-0007 manifests do not have the objects,
      // so the exception is conditional on the reviewed migration being
      // present. Current startup readiness independently requires them.
      const decisionSpine = await migration.query(
        "SELECT to_regclass($1) AS event_table, to_regclass($2) AS event_sequence",
        [DECISION_EVENT_TABLE, DECISION_EVENT_SEQUENCE],
      );
      const eventTablePresent = Boolean(decisionSpine.rows[0]?.event_table);
      const eventSequencePresent = Boolean(decisionSpine.rows[0]?.event_sequence);
      if (eventTablePresent !== eventSequencePresent) {
        throw new RuntimeRoleProvisionError("Decision-event table/sequence presence is inconsistent.");
      }
      if (eventTablePresent) {
        await migration.query(`REVOKE ALL PRIVILEGES ON TABLE ${DECISION_EVENT_TABLE} FROM ${ident}`);
        await migration.query(`GRANT INSERT ON TABLE ${DECISION_EVENT_TABLE} TO ${ident}`);
        await migration.query(`REVOKE ALL PRIVILEGES ON SEQUENCE ${DECISION_EVENT_SEQUENCE} FROM ${ident}`);
        await migration.query(`GRANT USAGE ON SEQUENCE ${DECISION_EVENT_SEQUENCE} TO ${ident}`);
      }

      controlPlanePresent = Boolean(
        (await migration.query("SELECT to_regnamespace('schema_control') AS schema")).rows[0]?.schema,
      );
      if (controlPlanePresent) {
        await migration.query(`REVOKE ALL PRIVILEGES ON SCHEMA schema_control FROM ${ident}`);
        await migration.query(`GRANT USAGE ON SCHEMA schema_control TO ${ident}`);
        await migration.query(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA schema_control FROM ${ident}`);
        await migration.query(`GRANT SELECT ON ALL TABLES IN SCHEMA schema_control TO ${ident}`);
        await migration.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA schema_control REVOKE ALL ON TABLES FROM ${ident}`);
        await migration.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA schema_control GRANT SELECT ON TABLES TO ${ident}`);
      }
      await assertRuntimeRoleContract(migration, role, controlPlanePresent);
      await migration.query("COMMIT");
    } catch (error) {
      await migration.query("ROLLBACK").catch(() => {});
      throw error;
    }
  } finally {
    await migration.end?.().catch(() => {});
  }

  const runtime = await opts.connectRuntime(opts.runtimeUrl);
  try {
    const runtimeFingerprint = await readDatabaseFingerprint(runtime);
    if (!migrationFingerprint || !sameDatabase(migrationFingerprint, runtimeFingerprint)) {
      throw new RuntimeRoleProvisionError(
        `Runtime credential did not reach the pinned database (${targetFingerprint}).`,
      );
    }
    const who = await runtime.query("SELECT current_user AS role");
    if (who.rows[0]?.role !== role) {
      throw new RuntimeRoleProvisionError("Runtime credential authenticated as an unexpected role.");
    }
  } finally {
    await runtime.end?.().catch(() => {});
  }
  return { controlPlaneReady: controlPlanePresent };
}

export function resolveRuntimeRoleProvisioningEnv(env: NodeJS.ProcessEnv = process.env): {
  migrateUrl: string;
  runtimeUrl: string;
  runtimeRole: string;
  expectedTargetId: string;
} {
  if (env.FLOW_RUNTIME_ROLE_PROVISION !== "1") {
    throw new RuntimeRoleProvisionError("FLOW_RUNTIME_ROLE_PROVISION=1 is required for this one-run command.");
  }
  if (env.NODE_ENV !== "production" || resolveSchemaEnvironment(env) !== "production") {
    throw new RuntimeRoleProvisionError("Runtime-role provisioning requires explicit production environment.");
  }
  const migrateUrl = (env.FLOW_MIGRATE_DATABASE_URL ?? "").trim();
  const runtimeUrl = (env.FLOW_RUNTIME_DATABASE_URL ?? "").trim();
  const runtimeRole = assertRoleName(env.FLOW_RUNTIME_ROLE ?? "");
  const expectedTargetId = (env.FLOW_SCHEMA_TARGET_ID ?? "").trim();
  if (!migrateUrl || !runtimeUrl || !expectedTargetId) {
    throw new RuntimeRoleProvisionError(
      "Migration credential, proposed runtime credential and opaque target id are all required.",
    );
  }
  return { migrateUrl, runtimeUrl, runtimeRole, expectedTargetId };
}

export function safeRuntimeRoleError(error: unknown): string {
  return safeOperationalMessage(error);
}
