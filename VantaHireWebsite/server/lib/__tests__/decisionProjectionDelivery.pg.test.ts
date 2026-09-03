// Wave 3C — exact PostgreSQL lifecycle for leased, generation-fenced delivery.
// Opt-in only; every mutation is fenced to a local disposable *_test database.

import { randomUUID } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";

import { loadManifest } from "../../schema-control/manifest";
import { assertSchemaReady, FLOW_CRITICAL_POSTCONDITIONS } from "../../schema-control/readiness";
import { runReleaseMigration, type MigrationClient } from "../../schema-control/runner";
import { provisionRuntimeRole } from "../../schema-control/runtimeRole";

const migrationUrl = (process.env.FLOW_SCHEMA_TEST_DATABASE_URL ?? "").trim();
const runtimeUrl = (process.env.FLOW_SCHEMA_TEST_RUNTIME_DATABASE_URL ?? "").trim();
const enabled = process.env.FLOW_AUTHZ_TEST_DISPOSABLE === "1" && Boolean(migrationUrl) && Boolean(runtimeUrl);
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "schema-migrations");
const currentLedger = loadManifest(migrationsDir).length;
const targetId = "flow-decision-projection-delivery-test-target";

let owner: Client | undefined;
let pre0009Dir: string | undefined;
let legacyIntentId = "";
let safeTargetProven = false;

async function clientFor(connectionString: string): Promise<Client> {
  const client = new Client({ connectionString, connectionTimeoutMillis: 2_000 });
  await client.connect();
  return client;
}

async function connectMigration(): Promise<MigrationClient> {
  const client = await clientFor(migrationUrl);
  return { query: (text, params) => client.query(text, params as never), end: () => client.end() };
}

async function connectRuntime(): Promise<MigrationClient> {
  const client = await clientFor(runtimeUrl);
  return { query: (text, params) => client.query(text, params as never), end: () => client.end() };
}

function assertSafeUrl(value: string, label: string): URL {
  const parsed = new URL(value);
  const socket = parsed.searchParams.get("host");
  const local = parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]" || Boolean(socket?.startsWith("/"));
  if (!local || !parsed.pathname.includes("_test")) throw new Error(`Disposable 3C ${label} target refused.`);
  return parsed;
}

async function resetDatabase(): Promise<void> {
  const client = await clientFor(migrationUrl);
  try {
    await client.query("DROP SCHEMA IF EXISTS schema_control CASCADE");
    await client.query("DROP SCHEMA IF EXISTS public CASCADE");
    await client.query("CREATE SCHEMA public AUTHORIZATION CURRENT_USER");
  } finally {
    await client.end();
  }
}

function pre0009Manifest(): string {
  const dir = mkdtempSync(join(tmpdir(), "flow-3c-pre-0009-"));
  const manifest = loadManifest(migrationsDir).filter((entry) => Number(entry.version) < 9);
  for (const entry of manifest) copyFileSync(join(migrationsDir, entry.file), join(dir, entry.file));
  copyFileSync(join(migrationsDir, "catalog.lock.json"), join(dir, "catalog.lock.json"));
  const lock = JSON.parse(readFileSync(join(migrationsDir, "checksums.lock"), "utf8")) as {
    format_version: number; catalog_lock_sha256: string; migrations: Record<string, string>;
  };
  writeFileSync(join(dir, "checksums.lock"), `${JSON.stringify({
    format_version: lock.format_version,
    catalog_lock_sha256: lock.catalog_lock_sha256,
    migrations: Object.fromEntries(Object.entries(lock.migrations).filter(([version]) => Number(version) < 9)),
  }, null, 2)}\n`);
  return dir;
}

async function provision(): Promise<void> {
  await provisionRuntimeRole({
    migrateUrl: migrationUrl,
    runtimeUrl,
    runtimeRole: new URL(runtimeUrl).username,
    expectedTargetId: targetId,
    connectMigration,
    connectRuntime,
  });
}

async function readinessAsRuntime(): Promise<{ version: string; applied: number }> {
  const runtime = await clientFor(runtimeUrl);
  try {
    await runtime.query("BEGIN READ ONLY");
    const ready = await assertSchemaReady({
      pg: { query: (text, params) => runtime.query(text, params as never) },
      migrationsDir,
      environment: "development",
      expectedTargetId: targetId,
      criticalPostconditions: FLOW_CRITICAL_POSTCONDITIONS,
    });
    await runtime.query("ROLLBACK");
    return ready;
  } finally {
    await runtime.end();
  }
}

async function installActors(): Promise<void> {
  await owner!.query(`
    INSERT INTO organizations (id,name,slug,settings,is_active,signal_tenant_id) VALUES
      (1,'Delivery A','delivery-a','{}'::jsonb,true,NULL),
      (2,'Delivery B','delivery-b','{}'::jsonb,true,NULL);
    INSERT INTO users (id,username,password,role,email_verified,first_name,last_name) VALUES
      (101,'actor@example.invalid','x','recruiter',true,'Delivery','Actor'),
      (301,'candidate@example.invalid','x','candidate',true,'Fixture','Candidate');
    INSERT INTO organization_members
      (id,organization_id,user_id,role,seat_assigned,credits_allocated,credits_used,credits_rollover,invited_by)
    VALUES (1,1,101,'owner',true,0,0,0,NULL);
    INSERT INTO jobs
      (id,organization_id,title,location,type,description,original_jd,posted_by,is_active,status,slug)
    VALUES (1001,1,'Delivery Role','Remote','full-time','Fixture','Fixture',101,false,'pending','delivery-role');
    INSERT INTO pipeline_stages (id,organization_id,name,"order",is_default,created_by) VALUES
      (1,1,'Applied',1,false,101),(2,1,'Interview',2,false,101);
    INSERT INTO applications
      (id,organization_id,job_id,user_id,name,email,phone,resume_url,resume_filename,extracted_resume_text,
       status,current_stage,recruiter_notes,rating,submitted_by_recruiter,created_by_user_id,source,
       source_metadata,whatsapp_consent,platform_discovery_consent)
    VALUES (2001,1,1001,301,'Fixture Candidate','fixture@example.invalid','000','https://invalid/fixture',
      'fixture.pdf','FIXTURE RESUME','submitted',1,ARRAY['FIXTURE NOTE'],2,true,101,'delivery_fixture',
      '{}'::jsonb,false,false);
  `);
}

async function insertIntent(organizationId: number, subjectId: number, jobId = 1001): Promise<string> {
  const eventId = randomUUID();
  const actorId = 101;
  await owner!.query(`
    WITH inserted_event AS (
      INSERT INTO decision_events (
      event_id,event_sequence,aggregate_sequence,organization_id,aggregate_type,aggregate_id,job_id,
      actor_user_id,action_code,source_surface,event_schema_version,taxonomy_version,before_state,after_state,occurred_at
      ) VALUES ($1,nextval('decision_event_sequence'),1,$2,'application',$3,$4,$5,
        'application_stage_moved','applications.stage_patch',1,1,
        '{"stage_id":1}'::jsonb,'{"stage_id":2}'::jsonb,clock_timestamp())
      RETURNING *
    )
    INSERT INTO decision_projection_outbox (
      event_id,source_event_sequence,organization_id,destination,payload_schema_version,source_system,
      subject_type,subject_id,job_id,action_code,taxonomy_version,before_state,after_state,occurred_at
    ) SELECT event_id,event_sequence,organization_id,'memory.organization_decision_inbox.v1',1,'flow',
      'application',aggregate_id,job_id,action_code,taxonomy_version,before_state,after_state,occurred_at
      FROM inserted_event
  `, [eventId, organizationId, subjectId, jobId, actorId]);
  return eventId;
}

async function rebuildCurrent(): Promise<void> {
  if (owner) await owner.end();
  owner = undefined;
  await resetDatabase();
  const result = await runReleaseMigration({
    migrationsDir,
    creds: { migrateUrl: migrationUrl, expectedTargetId: targetId, environment: "development", allowFreshInitialization: true },
    connect: connectMigration,
  });
  if (result.applied.length !== currentLedger || result.applied.at(-1) !== "0009") {
    throw new Error("Disposable 3C current-ledger rebuild refused.");
  }
  await provision();
  owner = await clientFor(migrationUrl);
  await installActors();
}

describe.skipIf(!enabled)("decision-projection delivery exact-schema PostgreSQL", () => {
  beforeAll(async () => {
    if (process.env.NODE_ENV !== "test") throw new Error("Disposable 3C integration requires NODE_ENV=test.");
    const migration = assertSafeUrl(migrationUrl, "migration");
    const runtime = assertSafeUrl(runtimeUrl, "runtime");
    if (migration.pathname !== runtime.pathname) throw new Error("Disposable 3C database mismatch.");
    const ownerProbe = await clientFor(migrationUrl);
    const runtimeProbe = await clientFor(runtimeUrl);
    try {
      const a = (await ownerProbe.query("SELECT current_database() database,current_user role,host(inet_server_addr()) server_addr")).rows[0];
      const b = (await runtimeProbe.query("SELECT current_database() database,current_user role,host(inet_server_addr()) server_addr")).rows[0];
      const local = (value: unknown) => [null, "127.0.0.1", "::1"].includes(value as never);
      if (!String(a?.database).includes("_test") || !String(a?.role).includes("_test_") || !local(a?.server_addr)
          || b?.database !== a?.database || !String(b?.role).includes("_test_") || !local(b?.server_addr)) {
        throw new Error("Disposable 3C identity proof failed.");
      }
      safeTargetProven = true;
    } finally {
      await ownerProbe.end();
      await runtimeProbe.end();
    }

    await resetDatabase();
    pre0009Dir = pre0009Manifest();
    const pre = await runReleaseMigration({
      migrationsDir: pre0009Dir,
      creds: { migrateUrl: migrationUrl, expectedTargetId: targetId, environment: "development", allowFreshInitialization: true },
      connect: connectMigration,
    });
    if (pre.applied.length !== 9 || pre.applied.at(-1) !== "0008") throw new Error("Disposable 3C pre-0009 ledger refused.");
    await provision();
    owner = await clientFor(migrationUrl);
    await installActors();
    legacyIntentId = await insertIntent(1, 2001);
    const upgrade = await runReleaseMigration({
      migrationsDir,
      creds: { migrateUrl: migrationUrl, expectedTargetId: targetId, environment: "development", allowFreshInitialization: true },
      connect: connectMigration,
    });
    expect(upgrade.applied).toEqual(["0009"]);
    expect((await owner.query("SELECT COUNT(*)::integer n FROM decision_projection_delivery_state")).rows[0]?.n).toBe(0);
    await expect(readinessAsRuntime()).rejects.toThrow();
    await provision();
    await expect(readinessAsRuntime()).resolves.toEqual({ version: "0009", applied: 10 });
  }, 180_000);

  beforeEach(async () => {
    if (!safeTargetProven) throw new Error("Disposable 3C target not proven.");
    await rebuildCurrent();
  });

  afterAll(async () => {
    if (owner) await owner.end();
    if (safeTargetProven) await resetDatabase();
    if (pre0009Dir) rmSync(pre0009Dir, { recursive: true, force: true });
  });

  it("installs ledger 10 without backfilling a pre-0009 intent", async () => {
    expect(legacyIntentId).toMatch(/^[0-9a-f-]{36}$/);
    const facts = (await owner!.query(`SELECT
      (SELECT COUNT(*)::integer FROM schema_control.applied) ledger,
      to_regclass('public.decision_projection_delivery_state')::text relation,
      (SELECT COUNT(*)::integer FROM decision_projection_delivery_state) states,
      (SELECT COUNT(*)::integer FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname LIKE '%decision_projection_delivery') functions`)).rows[0];
    expect(facts).toEqual({ ledger: currentLedger, relation: "decision_projection_delivery_state", states: 0, functions: 3 });
  });

  it("claims through functions without any direct delivery-relation privilege", async () => {
    const id = await insertIntent(1, 2001);
    const runtime = await clientFor(runtimeUrl);
    try {
      await expect(runtime.query("SELECT * FROM decision_projection_delivery_state")).rejects.toThrow(/permission denied/);
      const row = (await runtime.query("SELECT * FROM claim_decision_projection_delivery(30000,5)")).rows[0];
      expect(row).toMatchObject({ event_id: id, organization_id: 1, attempt_count: 1, lease_generation: "1" });
      expect(row.lease_token).toMatch(/^[0-9a-f-]{36}$/);
    } finally {
      await runtime.end();
    }
  });

  it("preserves same-org order while allowing another organization to progress", async () => {
    const firstA = await insertIntent(1, 2001);
    await insertIntent(1, 2002);
    const firstB = await insertIntent(2, 3001, 2001);
    const a = await clientFor(runtimeUrl);
    const b = await clientFor(runtimeUrl);
    try {
      const [left, right] = await Promise.all([
        a.query("SELECT * FROM claim_decision_projection_delivery(30000,5)"),
        b.query("SELECT * FROM claim_decision_projection_delivery(30000,5)"),
      ]);
      expect(new Set([left.rows[0]?.event_id, right.rows[0]?.event_id])).toEqual(new Set([firstA, firstB]));
      expect((await a.query("SELECT * FROM claim_decision_projection_delivery(30000,5)")).rowCount).toBe(0);
    } finally {
      await a.end();
      await b.end();
    }
  });

  it("reclaims an expired lease and fences every stale generation", async () => {
    const id = await insertIntent(1, 2001);
    const runtime = await clientFor(runtimeUrl);
    try {
      const first = (await runtime.query("SELECT * FROM claim_decision_projection_delivery(1000,5)")).rows[0];
      await owner!.query("UPDATE decision_projection_delivery_state SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE event_id=$1", [id]);
      const second = (await runtime.query("SELECT * FROM claim_decision_projection_delivery(1000,5)")).rows[0];
      expect(second.lease_generation).toBe("2");
      expect(second.lease_token).not.toBe(first.lease_token);
      expect((await runtime.query("SELECT * FROM ack_decision_projection_delivery($1,$2,$3,$4,'inserted')",
        [id, first.lease_token, first.lease_generation, first.delivery_sequence])).rowCount).toBe(0);
      expect((await runtime.query("SELECT * FROM fail_decision_projection_delivery($1,$2,$3,'timeout',true,5)",
        [id, first.lease_token, first.lease_generation])).rowCount).toBe(0);
      expect((await runtime.query("SELECT * FROM ack_decision_projection_delivery($1,$2,$3,$4,'replayed')",
        [id, second.lease_token, second.lease_generation, second.delivery_sequence])).rows[0]?.outcome).toBe("acknowledged");
      expect((await runtime.query("SELECT * FROM ack_decision_projection_delivery($1,$2,$3,$4,'replayed')",
        [id, second.lease_token, second.lease_generation, second.delivery_sequence])).rows[0]?.outcome).toBe("acknowledged");
    } finally {
      await runtime.end();
    }
  });

  it("records bounded retry and terminal truth that blocks only its organization", async () => {
    const a1 = await insertIntent(1, 2001);
    await insertIntent(1, 2002);
    const b1 = await insertIntent(2, 3001, 2001);
    const runtime = await clientFor(runtimeUrl);
    try {
      const first = (await runtime.query("SELECT * FROM claim_decision_projection_delivery(30000,2)")).rows[0];
      expect(first.event_id).toBe(a1);
      expect((await runtime.query("SELECT * FROM fail_decision_projection_delivery($1,$2,$3,'remote_429',true,2)",
        [a1, first.lease_token, first.lease_generation])).rows[0]).toMatchObject({ outcome: "recorded", resulting_state: "retry" });
      const crossOrg = (await runtime.query("SELECT * FROM claim_decision_projection_delivery(30000,2)")).rows[0];
      expect(crossOrg.event_id).toBe(b1);
      await owner!.query("UPDATE decision_projection_delivery_state SET available_at=clock_timestamp()-interval '1 second' WHERE event_id=$1", [a1]);
      const second = (await runtime.query("SELECT * FROM claim_decision_projection_delivery(30000,2)")).rows[0];
      expect(second.event_id).toBe(a1);
      expect((await runtime.query("SELECT * FROM fail_decision_projection_delivery($1,$2,$3,'remote_5xx',true,2)",
        [a1, second.lease_token, second.lease_generation])).rows[0]?.resulting_state).toBe("terminal");
      expect((await runtime.query("SELECT * FROM claim_decision_projection_delivery(30000,2)")).rowCount).toBe(0);
      const terminal = (await owner!.query("SELECT state,last_error_code,lease_token,terminal_at IS NOT NULL terminal FROM decision_projection_delivery_state WHERE event_id=$1", [a1])).rows[0];
      expect(terminal).toEqual({ state: "terminal", last_error_code: "remote_5xx", lease_token: null, terminal: true });
      await expect(owner!.query("UPDATE decision_projection_delivery_state SET last_error_code='PRIVATE BODY' WHERE event_id=$1", [a1]))
        .rejects.toThrow(/decision_projection_delivery_state_error_code_check/);
    } finally {
      await runtime.end();
    }
  });

  it("refuses readiness after function ACL drift and recovers by reconciliation", async () => {
    const role = new URL(runtimeUrl).username.replaceAll('"', '""');
    await owner!.query(`REVOKE EXECUTE ON FUNCTION claim_decision_projection_delivery(integer,integer) FROM "${role}"`);
    await expect(readinessAsRuntime()).rejects.toThrow(/Decision-projection delivery/);
    await provision();
    await expect(readinessAsRuntime()).resolves.toEqual({ version: "0009", applied: 10 });
  });
});
