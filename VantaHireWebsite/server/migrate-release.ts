// Gate 1A0-F — release migration entrypoint (`db:migrate:release`).
//
// Explicit, bounded, opt-in. Runs ONCE as a release job (never at app startup),
// using the dedicated migration credential. Requires FLOW_MIGRATION_APPLY=1,
// FLOW_MIGRATE_DATABASE_URL and (outside development) FLOW_SCHEMA_TARGET_ID.
// Exits 0 on success, 1 on any mismatch/failure — the app deploy is held on the
// previously verified version until this succeeds.

import { runFromEnv, type MigrationClient } from "./schema-control/runner";
import { safeOperationalMessage } from "./schema-control/targetIdentity";

function migrationsDir(): string {
  return (process.env.FLOW_SCHEMA_MIGRATIONS_DIR ?? "").trim() || `${process.cwd()}/server/schema-migrations`;
}

async function connect(migrateUrl: string): Promise<MigrationClient> {
  const { Client } = await import("pg");
  const useSsl =
    process.env.DATABASE_SSL === "true" ||
    /sslmode=require/i.test(migrateUrl) ||
    process.env.NODE_ENV === "production";
  const client = new (Client as any)({
    connectionString: migrateUrl,
    ssl: useSsl ? { rejectUnauthorized: (process.env.DATABASE_SSL_REJECT_UNAUTHORIZED ?? "true") !== "false" } : undefined,
    connectionTimeoutMillis: 10_000,
  });
  await client.connect();
  return {
    query: (t: string, p?: unknown[]) => client.query(t, p as any),
    end: () => client.end(),
  };
}

async function main(): Promise<void> {
  const result = await runFromEnv(migrationsDir(), connect);
  console.log(
    `migrate-release: OK (identity=${result.identityMode}, applied ${result.applied.length}: ${result.applied.join(",") || "(none)"})`,
  );
}

main().catch((err) => {
  // Never print a DSN or secret from a driver/provider error.
  console.error(`migrate-release: FAILED — ${safeOperationalMessage(err)}`);
  process.exit(1);
});
