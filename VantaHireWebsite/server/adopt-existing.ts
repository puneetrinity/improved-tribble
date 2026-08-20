// One-time Flow production adoption entrypoint. Never imported by runtime.

import { adoptExistingFlowDatabase, resolveAdoptionEnvironment, safeAdoptionError } from "./schema-control/adoption";
import type { MigrationClient } from "./schema-control/runner";

function migrationsDir(): string {
  return (process.env.FLOW_SCHEMA_MIGRATIONS_DIR ?? "").trim() || `${process.cwd()}/server/schema-migrations`;
}

async function connect(url: string): Promise<MigrationClient> {
  const { Client } = await import("pg");
  const useSsl = process.env.DATABASE_SSL === "true" || /sslmode=require/i.test(url) || process.env.NODE_ENV === "production";
  const client = new (Client as any)({
    connectionString: url,
    ssl: useSsl ? { rejectUnauthorized: (process.env.DATABASE_SSL_REJECT_UNAUTHORIZED ?? "true") !== "false" } : undefined,
    connectionTimeoutMillis: 10_000,
  });
  await client.connect();
  return { query: (text, params) => client.query(text, params as any), end: () => client.end() };
}

async function main(): Promise<void> {
  const result = await adoptExistingFlowDatabase({
    migrationsDir: migrationsDir(),
    ...resolveAdoptionEnvironment(),
    connect,
  });
  console.log(`schema-adopt-existing: OK (identity=${result.identityMode}, applied=${result.applied.join(",")})`);
}

main().catch((error) => {
  console.error(`schema-adopt-existing: FAILED — ${safeAdoptionError(error)}`);
  process.exit(1);
});
