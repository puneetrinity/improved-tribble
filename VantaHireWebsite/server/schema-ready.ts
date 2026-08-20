// Gate 1A0-F — read-only startup readiness entrypoint.
//
// Replaces the old `dist/migrate.js` that ran the mutable bootstrap on every
// web/worker/ai-worker start. This entrypoint opens ONE read-only session with
// the RUNTIME credential, asserts the database is the exact expected,
// fully-migrated target, and exits 0 (ready) or 1 (not ready). It performs no
// DDL, seed, or business-row write. Startup commands run this before the app.

import {
  assertSchemaReady,
  FLOW_CRITICAL_POSTCONDITIONS,
  SchemaNotReadyError,
} from "./schema-control/readiness";
import type { PgLike } from "./schema-control/ledger";
import {
  resolveSchemaEnvironment,
  safeOperationalMessage,
} from "./schema-control/targetIdentity";

function migrationsDir(): string {
  return (process.env.FLOW_SCHEMA_MIGRATIONS_DIR ?? "").trim() || `${process.cwd()}/server/schema-migrations`;
}

async function main(): Promise<void> {
  const environment = resolveSchemaEnvironment(process.env);
  const expectedTargetId = (process.env.FLOW_SCHEMA_TARGET_ID ?? "").trim();
  if (environment !== "development" && !expectedTargetId) {
    console.error("schema-ready: FLOW_SCHEMA_TARGET_ID is required outside development.");
    process.exit(1);
  }
  const url = (process.env.DATABASE_URL ?? "").trim();
  if (!url) {
    console.error("schema-ready: DATABASE_URL (runtime credential) must be set.");
    process.exit(1);
  }

  const { Client } = await import("pg");
  const useSsl =
    process.env.DATABASE_SSL === "true" ||
    /sslmode=require/i.test(url) ||
    process.env.NODE_ENV === "production";
  const client = new (Client as any)({
    connectionString: url,
    ssl: useSsl ? { rejectUnauthorized: (process.env.DATABASE_SSL_REJECT_UNAUTHORIZED ?? "true") !== "false" } : undefined,
    connectionTimeoutMillis: 10_000,
  });
  await client.connect();
  try {
    // PostgreSQL, not application convention, enforces that readiness can
    // execute no DDL/DML even if a future check is implemented incorrectly.
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '10s'");
    await client.query("SET LOCAL lock_timeout = '2s'");
    const pg: PgLike = { query: (t, p) => client.query(t, p as any) };
    try {
      const summary = await assertSchemaReady({
        pg,
        migrationsDir: migrationsDir(),
        environment,
        expectedTargetId: expectedTargetId || "dev-disposable",
        criticalPostconditions: FLOW_CRITICAL_POSTCONDITIONS,
      });
      await client.query("COMMIT");
      console.log(`schema-ready: OK (version ${summary.version}, ${summary.applied} migrations applied)`);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    }
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((err) => {
  if (err instanceof SchemaNotReadyError) {
    console.error(`schema-ready: NOT READY — ${err.message}`);
  } else {
    console.error(`schema-ready: failed — ${safeOperationalMessage(err)}`);
  }
  process.exit(1);
});
