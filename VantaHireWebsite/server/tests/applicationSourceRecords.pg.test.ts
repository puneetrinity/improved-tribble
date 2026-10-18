// Owner-only applicant source records: exact-schema PostgreSQL proof.
// Opt-in only; refuses any non-local/non-test target before its first write.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";

import { assertSchemaReady, FLOW_CRITICAL_POSTCONDITIONS } from "../schema-control/readiness";
import { loadManifest } from "../schema-control/manifest";
import { runReleaseMigration, type MigrationClient } from "../schema-control/runner";
import { provisionRuntimeRole } from "../schema-control/runtimeRole";

const migrationUrl = (process.env.FLOW_SCHEMA_TEST_DATABASE_URL ?? "").trim();
const runtimeUrl = (process.env.FLOW_SCHEMA_TEST_RUNTIME_DATABASE_URL ?? "").trim();
const enabled = process.env.FLOW_AUTHZ_TEST_DISPOSABLE === "1" && Boolean(migrationUrl) && Boolean(runtimeUrl);
const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "schema-migrations");
const targetId = "flow-application-source-test-target";

let owner: Client | undefined;
let runtime: Client | undefined;
const runtimeRole = () => new URL(runtimeUrl).username;

async function clientFor(url: string): Promise<Client> {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 2_000 });
  await client.connect();
  return client;
}
const wrap = (client: Client): MigrationClient => ({ query: (t, p) => client.query(t, p as never), end: () => client.end() });
const connectMigration = async () => wrap(await clientFor(migrationUrl));
const connectRuntime = async () => wrap(await clientFor(runtimeUrl));

function assertSafeUrl(value: string): URL {
  const parsed = new URL(value);
  const socket = parsed.searchParams.get("host");
  const local = parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]" || Boolean(socket?.startsWith("/"));
  if (!local || !parsed.pathname.includes("_test")) throw new Error("Disposable source-records target refused.");
  return parsed;
}

async function provision(): Promise<void> {
  await provisionRuntimeRole({
    migrateUrl: migrationUrl, runtimeUrl, runtimeRole: runtimeRole(), expectedTargetId: targetId,
    connectMigration, connectRuntime,
  });
}

async function readiness(): Promise<unknown> {
  const client = await clientFor(runtimeUrl);
  try {
    await client.query("BEGIN READ ONLY");
    return await assertSchemaReady({
      pg: { query: (t, p) => client.query(t, p as never) }, migrationsDir, environment: "development",
      expectedTargetId: targetId, criticalPostconditions: FLOW_CRITICAL_POSTCONDITIONS,
    });
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
}

async function refused(statement: string): Promise<string | undefined> {
  try {
    await runtime!.query(statement);
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

const record = (host: string) => JSON.stringify({ version: 1, referrerHost: host, landedAt: new Date().toISOString() });

describe.skipIf(!enabled)("application_source_records exact-schema PostgreSQL", () => {
  beforeAll(async () => {
    if (process.env.NODE_ENV !== "test") throw new Error("Disposable source-records test requires NODE_ENV=test.");
    if (assertSafeUrl(migrationUrl).pathname !== assertSafeUrl(runtimeUrl).pathname) throw new Error("Database mismatch.");
    const reset = await clientFor(migrationUrl);
    try {
      await reset.query("DROP SCHEMA IF EXISTS schema_control CASCADE");
      await reset.query("DROP SCHEMA IF EXISTS public CASCADE");
      await reset.query("CREATE SCHEMA public AUTHORIZATION CURRENT_USER");
    } finally {
      await reset.end();
    }
    const release = await runReleaseMigration({
      migrationsDir,
      creds: { migrateUrl: migrationUrl, expectedTargetId: targetId, environment: "development", allowFreshInitialization: true },
      connect: connectMigration,
    });
    expect(release.applied.at(-1)).toBe("0020");
    await provision();
    owner = await clientFor(migrationUrl);
    runtime = await clientFor(runtimeUrl);
    await owner.query(`
      INSERT INTO organizations (id,name,slug,settings,is_active,signal_tenant_id) VALUES (1,'Src org','src-org','{}'::jsonb,true,NULL);
      INSERT INTO users (id,username,password,role,email_verified,first_name,last_name)
        VALUES (101,'actor@example.invalid','x','recruiter',true,'Src','Actor');
      INSERT INTO jobs (id,organization_id,title,location,type,description,original_jd,posted_by,is_active,status,slug)
        VALUES (1001,1,'Src Role','Remote','full-time','Fixture','Fixture',101,true,'active','src-role');
      INSERT INTO applications (id,organization_id,job_id,name,email,phone,resume_url,status,whatsapp_consent)
        VALUES (2001,1,1001,'A','a@example.invalid','0','https://invalid/a','submitted',false),
               (2002,1,1001,'B','b@example.invalid','0','https://invalid/b','submitted',false),
               (2003,1,1001,'C','c@example.invalid','0','https://invalid/c','submitted',false);
    `);
  }, 120_000);

  afterAll(async () => {
    await runtime?.end();
    await owner?.end();
  });

  it("runtime can only insert; every read/change path is refused", async () => {
    await runtime!.query("INSERT INTO public.application_source_records (application_id, record) VALUES ($1,$2::jsonb)", [2001, record("www.linkedin.com")]);
    expect(await refused("SELECT * FROM public.application_source_records")).toBe("42501");
    expect(await refused("SELECT count(*) FROM public.application_source_records")).toBe("42501");
    expect(await refused("UPDATE public.application_source_records SET record='{}'::jsonb")).toBe("42501");
    expect(await refused("DELETE FROM public.application_source_records")).toBe("42501");
    expect(await refused("TRUNCATE public.application_source_records")).toBe("42501");
    expect(await refused(`INSERT INTO public.application_source_records (application_id, record) VALUES (2002, '${record("x.example.com")}'::jsonb) RETURNING record`)).toBe("42501");
    // A join from applications cannot reach it either.
    expect(await refused("SELECT a.id, s.record FROM applications a JOIN application_source_records s ON s.application_id=a.id")).toBe("42501");
  });

  it("the owner can read it (scoped, read-only)", async () => {
    await owner!.query("BEGIN READ ONLY");
    const rows = (await owner!.query("SELECT record->>'referrerHost' AS host FROM public.application_source_records WHERE application_id=2001")).rows;
    await owner!.query("ROLLBACK");
    expect(rows).toEqual([{ host: "www.linkedin.com" }]);
  });

  it("enforces shape, size and the application link", async () => {
    const insert = (id: number, value: string) =>
      refused(`INSERT INTO public.application_source_records (application_id, record) VALUES (${id}, '${value}'::jsonb)`);
    expect(await insert(2003, "[]")).toBe("23514");
    expect(await insert(2003, JSON.stringify({ big: "x".repeat(3000) }))).toBe("23514");
    expect(await insert(999999, "{}")).toBe("23503");
    expect(await insert(2001, "{}")).toBe("23505");
    await owner!.query("DELETE FROM applications WHERE id=2001");
    expect((await owner!.query("SELECT count(*)::int n FROM public.application_source_records WHERE application_id=2001")).rows[0].n).toBe(0);
  });

  it("a failed tracking insert in a savepoint never cancels the application", async () => {
    const pool = new Pool({ connectionString: runtimeUrl, max: 1 });
    try {
      const db = drizzle(pool);
      await db.transaction(async (tx) => {
        await tx.execute(sql`UPDATE applications SET status='submitted' WHERE id=2002`);
        await expect(tx.transaction(async (sp) => {
          await sp.execute(sql`INSERT INTO public.application_source_records (application_id, record) VALUES (2002, '[]'::jsonb)`);
        })).rejects.toThrow();
        await tx.execute(sql`UPDATE applications SET rating=5 WHERE id=2002`);
      });
    } finally {
      await pool.end();
    }
    expect((await owner!.query("SELECT rating FROM applications WHERE id=2002")).rows[0].rating).toBe(5);
    expect((await owner!.query("SELECT count(*)::int n FROM public.application_source_records WHERE application_id=2002")).rows[0].n).toBe(0);
  });

  it("re-provisioning keeps insert-only and readiness passes", async () => {
    await provision();
    await provision();
    const p = (await owner!.query(`SELECT
      has_table_privilege($1,'public.application_source_records','INSERT') ins,
      has_table_privilege($1,'public.application_source_records','SELECT') sel,
      has_table_privilege($1,'public.application_source_records','UPDATE') upd,
      has_table_privilege($1,'public.application_source_records','DELETE') del`, [runtimeRole()])).rows[0];
    expect(p).toEqual({ ins: true, sel: false, upd: false, del: false });
    await expect(readiness()).resolves.toMatchObject({ version: "0020" });
  });

  it("readiness refuses a direct or inherited read grant", async () => {
    await owner!.query(`GRANT SELECT ON public.application_source_records TO ${runtimeRole()}`);
    await expect(readiness()).rejects.toThrow();
    await provision();
    await expect(readiness()).resolves.toMatchObject({ version: "0020" });
    await owner!.query("DROP ROLE IF EXISTS app_source_reader_test");
    await owner!.query("CREATE ROLE app_source_reader_test NOLOGIN");
    await owner!.query("GRANT SELECT ON public.application_source_records TO app_source_reader_test");
    await owner!.query(`GRANT app_source_reader_test TO ${runtimeRole()} WITH INHERIT TRUE`);
    try {
      await expect(readiness()).rejects.toThrow();
    } finally {
      await owner!.query(`REVOKE app_source_reader_test FROM ${runtimeRole()}`);
      await owner!.query("REVOKE ALL ON public.application_source_records FROM app_source_reader_test");
      await owner!.query("DROP ROLE app_source_reader_test");
    }
    await expect(readiness()).resolves.toMatchObject({ version: "0020" });
  });

  it("no server code reads the table; only the public apply route inserts into it", () => {
    const serverDir = join(here, "..");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (name === "node_modules" || name === "tests" || name === "__tests__") continue;
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|mjs|js)$/.test(name)) files.push(path);
      }
    };
    walk(serverDir);
    const users = files.filter((f) => readFileSync(f, "utf8").includes("application_source_records"))
      .map((f) => f.slice(serverDir.length + 1)).sort();
    expect(users).toEqual(["applications.routes.ts", "schema-control/readiness.ts", "schema-control/runtimeRole.ts"]);
    const route = readFileSync(join(serverDir, "applications.routes.ts"), "utf8");
    expect(route.match(/application_source_records/g)).toHaveLength(1);
    expect(route).toMatch(/INSERT INTO public\.application_source_records/);
  });
});
