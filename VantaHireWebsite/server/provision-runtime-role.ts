// One-run Flow runtime-role provisioning entrypoint. Never imported by runtime.

import type { RuntimeRoleClient } from "./schema-control/runtimeRole";
import {
  provisionRuntimeRole,
  resolveRuntimeRoleProvisioningEnv,
  safeRuntimeRoleError,
} from "./schema-control/runtimeRole";

async function connect(url: string): Promise<RuntimeRoleClient> {
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
  const result = await provisionRuntimeRole({
    ...resolveRuntimeRoleProvisioningEnv(),
    connectMigration: connect,
    connectRuntime: connect,
  });
  console.log(
    `schema-provision-runtime-role: OK (control-plane=${result.controlPlaneReady ? "ready" : "pending-adoption"})`,
  );
}

main().catch((error) => {
  console.error(`schema-provision-runtime-role: FAILED — ${safeRuntimeRoleError(error)}`);
  process.exit(1);
});
