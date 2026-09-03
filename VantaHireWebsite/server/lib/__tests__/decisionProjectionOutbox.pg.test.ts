// Wave 3B — exact-schema PostgreSQL proof for atomic decision-projection intents.
// Opt-in only; every write is fenced to a local disposable *_test database.

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
const targetId = "flow-decision-projection-outbox-test-target";

type WorkflowModule = typeof import("../applicationWorkflowAuthorization");
let workflow: WorkflowModule;
let owner: Client | undefined;
let runtimePool: { end(): Promise<void> } | undefined;
let pre0008Dir: string | undefined;
let safeTargetProven = false;
let pre0008EventStayedUnprojected = false;

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
  if (!local || !parsed.pathname.includes("_test")) throw new Error(`Disposable 3B ${label} target refused.`);
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

function pre0008Manifest(): string {
  const dir = mkdtempSync(join(tmpdir(), "flow-3b-pre-0008-"));
  const manifest = loadManifest(migrationsDir).filter((entry) => Number(entry.version) < 8);
  for (const entry of manifest) copyFileSync(join(migrationsDir, entry.file), join(dir, entry.file));
  copyFileSync(join(migrationsDir, "catalog.lock.json"), join(dir, "catalog.lock.json"));
  const lock = JSON.parse(readFileSync(join(migrationsDir, "checksums.lock"), "utf8")) as {
    format_version: number; catalog_lock_sha256: string; migrations: Record<string, string>;
  };
  writeFileSync(join(dir, "checksums.lock"), `${JSON.stringify({
    format_version: lock.format_version,
    catalog_lock_sha256: lock.catalog_lock_sha256,
    migrations: Object.fromEntries(Object.entries(lock.migrations).filter(([version]) => Number(version) < 8)),
  }, null, 2)}\n`);
  return dir;
}

async function installFixture(): Promise<void> {
  await owner!.query(`
    INSERT INTO organizations (id,name,slug,settings,is_active,signal_tenant_id)
    VALUES (1,'Projection org','projection-org','{}'::jsonb,true,NULL);
    INSERT INTO users (id,username,password,role,email_verified,first_name,last_name) VALUES
      (101,'actor@example.invalid','x','recruiter',true,'Projection','Actor'),
      (301,'candidate@example.invalid','x','candidate',true,'Private','Candidate');
    INSERT INTO organization_members
      (id,organization_id,user_id,role,seat_assigned,credits_allocated,credits_used,credits_rollover,invited_by)
    VALUES (1,1,101,'owner',true,0,0,0,NULL);
    INSERT INTO jobs
      (id,organization_id,title,location,type,description,original_jd,posted_by,is_active,status,slug,
       jd_digest,jd_digest_version)
    VALUES (1001,1,'Projection Role','Remote','full-time','Fixture','Private JD',101,false,'pending',
      'projection-role','{"summary":"not copied"}'::jsonb,3);
    INSERT INTO pipeline_stages (id,organization_id,name,"order",is_default,created_by) VALUES
      (1,1,'Applied',1,false,101),(2,1,'Interview',2,false,101),(3,1,'Final',3,false,101);
    INSERT INTO applications
      (id,organization_id,job_id,user_id,name,email,phone,resume_url,resume_filename,extracted_resume_text,
       status,current_stage,recruiter_notes,rating,submitted_by_recruiter,created_by_user_id,source,
       source_metadata,whatsapp_consent,platform_discovery_consent,ai_suggested_action,
       ai_suggested_action_reason,ai_summary_model_version,ai_digest_version_used)
    VALUES (2001,1,1001,301,'Private Candidate','private@example.invalid','000','https://invalid/private',
      'private.pdf','PRIVATE RESUME','submitted',1,ARRAY['PRIVATE NOTE'],2,true,101,'projection_fixture',
      '{}'::jsonb,false,false,'advance','PRIVATE RECOMMENDATION','model-v1',3);
  `);
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

async function rebuildCurrent(): Promise<void> {
  await resetDatabase();
  const result = await runReleaseMigration({
    migrationsDir,
    creds: { migrateUrl: migrationUrl, expectedTargetId: targetId, environment: "development", allowFreshInitialization: true },
    connect: connectMigration,
  });
  if (result.applied.length !== currentLedger || result.applied.at(-1) !== "0009") {
    throw new Error("Disposable 3B current-ledger rebuild refused.");
  }
  await provision();
  owner = await clientFor(migrationUrl);
  await installFixture();
}

async function readinessAsRuntime(): Promise<{ version: string; applied: number }> {
  const runtime = await clientFor(runtimeUrl);
  try {
    await runtime.query("BEGIN READ ONLY");
    const result = await assertSchemaReady({
      pg: { query: (text, params) => runtime.query(text, params as never) },
      migrationsDir,
      environment: "development",
      expectedTargetId: targetId,
      criticalPostconditions: FLOW_CRITICAL_POSTCONDITIONS,
    });
    await runtime.query("ROLLBACK");
    return result;
  } finally {
    await runtime.end();
  }
}

async function counts(): Promise<Record<string, number>> {
  return (await owner!.query(`SELECT
    (SELECT COUNT(*)::integer FROM application_stage_history) history,
    (SELECT COUNT(*)::integer FROM decision_events) events,
    (SELECT COUNT(*)::integer FROM decision_projection_outbox) intents,
    (SELECT last_value::integer FROM decision_event_sequence) event_sequence,
    (SELECT last_value::integer FROM decision_projection_outbox_sequence) delivery_sequence`)).rows[0];
}

describe.skipIf(!enabled)("decision-projection outbox exact-schema PostgreSQL", () => {
  beforeAll(async () => {
    if (process.env.NODE_ENV !== "test") throw new Error("Disposable 3B integration requires NODE_ENV=test.");
    const migration = assertSafeUrl(migrationUrl, "migration");
    const runtime = assertSafeUrl(runtimeUrl, "runtime");
    if (migration.pathname !== runtime.pathname) throw new Error("Disposable 3B database mismatch.");
    const ownerProbe = await clientFor(migrationUrl);
    const runtimeProbe = await clientFor(runtimeUrl);
    try {
      const a = (await ownerProbe.query("SELECT current_database() database,current_user role,host(inet_server_addr()) server_addr")).rows[0];
      const b = (await runtimeProbe.query("SELECT current_database() database,current_user role,host(inet_server_addr()) server_addr")).rows[0];
      const local = (value: unknown) => [null, "127.0.0.1", "::1"].includes(value as never);
      if (!String(a?.database).includes("_test") || !String(a?.role).includes("_test_") || !local(a?.server_addr)
          || b?.database !== a?.database || !String(b?.role).includes("_test_") || !local(b?.server_addr)) {
        throw new Error("Disposable 3B identity proof failed.");
      }
      safeTargetProven = true;
    } finally {
      await ownerProbe.end();
      await runtimeProbe.end();
    }

    await resetDatabase();
    pre0008Dir = pre0008Manifest();
    const pre = await runReleaseMigration({
      migrationsDir: pre0008Dir,
      creds: { migrateUrl: migrationUrl, expectedTargetId: targetId, environment: "development", allowFreshInitialization: true },
      connect: connectMigration,
    });
    if (pre.applied.length !== 8 || pre.applied.at(-1) !== "0007") throw new Error("Disposable 3B pre-0008 ledger refused.");
    await provision();
    owner = await clientFor(migrationUrl);
    await installFixture();
    const legacyEventId = randomUUID();
    await owner.query(`INSERT INTO decision_events (
      event_id,event_sequence,aggregate_sequence,organization_id,aggregate_type,aggregate_id,job_id,
      actor_user_id,action_code,source_surface,event_schema_version,taxonomy_version,before_state,after_state,occurred_at
    ) VALUES ($1,nextval('decision_event_sequence'),1,1,'application',2001,1001,101,
      'application_stage_moved','applications.stage_patch',1,1,'{"stage_id":1}'::jsonb,'{"stage_id":2}'::jsonb,now())`,
    [legacyEventId]);
    expect((await owner.query("SELECT to_regclass('public.decision_projection_outbox') relation")).rows[0]?.relation).toBeNull();
    const upgraded = await runReleaseMigration({
      migrationsDir,
      creds: { migrateUrl: migrationUrl, expectedTargetId: targetId, environment: "development", allowFreshInitialization: true },
      connect: connectMigration,
    });
    expect(upgraded.applied).toEqual(["0008", "0009"]);
    pre0008EventStayedUnprojected = (await owner.query(
      "SELECT COUNT(*)::integer events,(SELECT COUNT(*)::integer FROM decision_projection_outbox) intents FROM decision_events",
    )).rows[0]?.events === 1 && (await owner.query("SELECT COUNT(*)::integer n FROM decision_projection_outbox")).rows[0]?.n === 0;

    await expect(readinessAsRuntime()).rejects.toThrow(/Decision-projection delivery functions and runtime boundary/);
    await provision();
    await expect(readinessAsRuntime()).resolves.toEqual({ version: "0009", applied: 10 });
    process.env.DATABASE_URL = runtimeUrl;
    process.env.DATABASE_SSL = "false";
    workflow = await import("../applicationWorkflowAuthorization");
    runtimePool = (await import("../../db")).pool;
  }, 180_000);

  beforeEach(async () => {
    if (!safeTargetProven) throw new Error("Disposable 3B target not proven.");
    if (owner) await owner.end();
    owner = undefined;
    await rebuildCurrent();
  });

  afterAll(async () => {
    if (runtimePool) await runtimePool.end();
    if (owner) await owner.end();
    if (safeTargetProven) await resetDatabase();
    if (pre0008Dir) rmSync(pre0008Dir, { recursive: true, force: true });
  });

  it("installs ledger 10 exactly and never backfills pre-0008 events", async () => {
    expect(pre0008EventStayedUnprojected).toBe(true);
    const facts = (await owner!.query(`SELECT
      (SELECT COUNT(*)::integer FROM schema_control.applied) ledger,
      to_regclass('public.decision_projection_outbox')::text relation,
      to_regclass('public.decision_projection_outbox_sequence')::text sequence,
      (SELECT COUNT(*)::integer FROM pg_constraint WHERE conrelid='public.decision_projection_outbox'::regclass) constraints,
      (SELECT COUNT(*)::integer FROM pg_indexes WHERE schemaname='public' AND tablename='decision_projection_outbox') indexes,
      (SELECT COUNT(*)::integer FROM pg_trigger WHERE tgrelid='public.decision_projection_outbox'::regclass
        AND NOT tgisinternal AND tgenabled<>'D') triggers`)).rows[0];
    expect(facts).toEqual({ ledger: currentLedger, relation: "decision_projection_outbox",
      sequence: "decision_projection_outbox_sequence", constraints: 21, indexes: 5, triggers: 2 });
  });

  it("commits one exact minimized intent with its event and shared decision clock", async () => {
    const eventId = randomUUID();
    await expect(workflow.moveAuthorizedApplicationStage(
      101, 2001, 2, "PRIVATE NOTE", eventId, { allowPlatformAdmin: true },
    )).resolves.toMatchObject({ ok: true, value: { changed: true } });
    const row = (await owner!.query(`SELECT
      h.changed_at history_at,e.event_sequence,e.organization_id event_org,e.aggregate_id,e.job_id event_job,
      e.occurred_at event_at,o.*,o::text intent_text
      FROM application_stage_history h
      JOIN decision_events e ON e.aggregate_id=h.application_id
      JOIN decision_projection_outbox o ON o.event_id=e.event_id`)).rows[0];
    expect(row).toMatchObject({
      event_id: eventId,
      source_event_sequence: row.event_sequence,
      organization_id: row.event_org,
      destination: "memory.organization_decision_inbox.v1",
      payload_schema_version: 1,
      source_system: "flow",
      subject_type: "application",
      subject_id: 2001,
      job_id: row.event_job,
      action_code: "application_stage_moved",
      taxonomy_version: 1,
      rubric_id: null,
      rubric_version: null,
      rubric_approval_mode: null,
      jd_digest_version: 3,
      recommendation_action: "advance",
      reason_code: null,
      before_state: { stage_id: 1 },
      after_state: { stage_id: 2 },
    });
    expect(Number(row.delivery_sequence)).toBeGreaterThan(0);
    expect(row.occurred_at).toEqual(row.event_at);
    expect(row.occurred_at).toEqual(row.history_at);
    for (const privateValue of ["Private Candidate", "private@example.invalid", "PRIVATE RESUME", "PRIVATE NOTE",
      "PRIVATE RECOMMENDATION", "Interview", "model-v1"]) expect(row.intent_text).not.toContain(privateValue);
  });

  it("makes same-stage a zero-row and zero-allocation no-op", async () => {
    const before = await counts();
    const application = (await owner!.query(
      "SELECT updated_at,stage_changed_at,stage_changed_by FROM applications WHERE id=2001",
    )).rows[0];
    await expect(workflow.moveAuthorizedApplicationStage(
      101, 2001, 1, "must not persist", randomUUID(), { allowPlatformAdmin: true },
    )).resolves.toMatchObject({ ok: true, value: { changed: false, changedAt: null } });
    expect(await counts()).toEqual(before);
    expect((await owner!.query("SELECT updated_at,stage_changed_at,stage_changed_by FROM applications WHERE id=2001")).rows[0])
      .toEqual(application);
  });

  it("rolls all four writes back when history, event, or intent insertion fails", async () => {
    for (const target of ["application_stage_history", "decision_events", "decision_projection_outbox"] as const) {
      const functionName = `flow_test_reject_${target}`;
      const triggerName = `flow_test_reject_${target}_insert`;
      await owner!.query(`CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='TEST_INSERT_REFUSED'; END $$;
        CREATE TRIGGER ${triggerName} BEFORE INSERT ON ${target}
        FOR EACH ROW EXECUTE FUNCTION ${functionName}()`);
      const before = (await owner!.query(
        "SELECT current_stage,stage_changed_at,stage_changed_by FROM applications WHERE id=2001",
      )).rows[0];
      try {
        await expect(workflow.moveAuthorizedApplicationStage(
          101, 2001, 2, null, randomUUID(), { allowPlatformAdmin: true },
        )).resolves.toEqual({ ok: false, reason: "unavailable" });
        expect((await owner!.query("SELECT current_stage,stage_changed_at,stage_changed_by FROM applications WHERE id=2001")).rows[0])
          .toEqual(before);
        const rows = (await owner!.query(`SELECT
          (SELECT COUNT(*)::integer FROM application_stage_history) history,
          (SELECT COUNT(*)::integer FROM decision_events) events,
          (SELECT COUNT(*)::integer FROM decision_projection_outbox) intents`)).rows[0];
        expect(rows).toEqual({ history: 0, events: 0, intents: 0 });
      } finally {
        await owner!.query(`DROP TRIGGER ${triggerName} ON ${target}; DROP FUNCTION ${functionName}()`);
      }
    }
  });

  it("serializes concurrent moves without a torn or duplicate event-intent pair", async () => {
    const results = await Promise.all([
      workflow.moveAuthorizedApplicationStage(101, 2001, 2, null, randomUUID(), { allowPlatformAdmin: true }),
      workflow.moveAuthorizedApplicationStage(101, 2001, 3, null, randomUUID(), { allowPlatformAdmin: true }),
    ]);
    expect(results.every((result) => result.ok && result.value.changed)).toBe(true);
    const rows = (await owner!.query(`SELECT e.event_id,e.event_sequence,e.before_state,e.after_state,
      o.source_event_sequence,o.delivery_sequence,o.before_state intent_before,o.after_state intent_after
      FROM decision_events e JOIN decision_projection_outbox o USING(event_id)
      ORDER BY e.event_sequence`)).rows;
    expect(rows).toHaveLength(2);
    expect(rows[0].before_state).toEqual({ stage_id: 1 });
    expect(rows[1].before_state).toEqual(rows[0].after_state);
    expect(rows.every((row) => row.event_sequence === row.source_event_sequence
      && JSON.stringify(row.before_state) === JSON.stringify(row.intent_before)
      && JSON.stringify(row.after_state) === JSON.stringify(row.intent_after))).toBe(true);
    expect(new Set(rows.map((row) => row.event_id)).size).toBe(2);
    expect(new Set(rows.map((row) => row.delivery_sequence)).size).toBe(2);
  });

  it("enforces runtime INSERT-only/USAGE-only and owner-level append-only evidence", async () => {
    const role = new URL(runtimeUrl).username;
    const acl = (await owner!.query(`SELECT
      has_table_privilege($1,'decision_projection_outbox','INSERT') can_insert,
      has_table_privilege($1,'decision_projection_outbox','SELECT') can_select,
      has_table_privilege($1,'decision_projection_outbox','UPDATE') can_update,
      has_table_privilege($1,'decision_projection_outbox','DELETE') can_delete,
      has_table_privilege($1,'decision_projection_outbox','TRUNCATE') can_truncate,
      has_table_privilege($1,'decision_projection_outbox','REFERENCES') can_reference,
      has_table_privilege($1,'decision_projection_outbox','TRIGGER') can_trigger,
      has_sequence_privilege($1,'decision_projection_outbox_sequence','USAGE') can_use,
      has_sequence_privilege($1,'decision_projection_outbox_sequence','SELECT') can_read_sequence,
      has_sequence_privilege($1,'decision_projection_outbox_sequence','UPDATE') can_reset_sequence`, [role])).rows[0];
    expect(acl).toEqual({ can_insert: true, can_select: false, can_update: false, can_delete: false,
      can_truncate: false, can_reference: false, can_trigger: false, can_use: true,
      can_read_sequence: false, can_reset_sequence: false });
    const runtime = await clientFor(runtimeUrl);
    try {
      for (const statement of ["SELECT * FROM decision_projection_outbox",
        "UPDATE decision_projection_outbox SET action_code=action_code", "DELETE FROM decision_projection_outbox",
        "TRUNCATE decision_projection_outbox", "SELECT setval('decision_projection_outbox_sequence',1)"]) {
        await expect(runtime.query(statement)).rejects.toMatchObject({ code: "42501" });
      }
    } finally {
      await runtime.end();
    }
    await expect(owner!.query(
      "TRUNCATE decision_projection_delivery_state, decision_projection_outbox",
    )).resolves.toBeDefined();
    await workflow.moveAuthorizedApplicationStage(101, 2001, 2, null, randomUUID(), { allowPlatformAdmin: true });
    for (const statement of ["UPDATE decision_projection_outbox SET action_code=action_code",
      "DELETE FROM decision_projection_outbox",
      "TRUNCATE decision_projection_delivery_state, decision_projection_outbox"]) {
      await owner!.query("BEGIN");
      await expect(owner!.query(statement)).rejects.toMatchObject({ code: "55000", message: "DECISION_OUTBOX_APPEND_ONLY" });
      await owner!.query("ROLLBACK");
    }
  });

  it("lets intent evidence outlive mutable rows and anchors organization deletion", async () => {
    await workflow.moveAuthorizedApplicationStage(101, 2001, 2, null, randomUUID(), { allowPlatformAdmin: true });
    await owner!.query("DELETE FROM applications WHERE id=2001");
    await owner!.query("DELETE FROM pipeline_stages WHERE organization_id=1");
    await owner!.query("DELETE FROM jobs WHERE id=1001");
    await owner!.query("DELETE FROM organization_members WHERE organization_id=1");
    await owner!.query("DELETE FROM users WHERE id IN (101,301)");
    expect((await owner!.query("SELECT COUNT(*)::integer events,(SELECT COUNT(*)::integer FROM decision_projection_outbox) intents FROM decision_events")).rows[0])
      .toEqual({ events: 1, intents: 1 });
    await expect(owner!.query("DELETE FROM organizations WHERE id=1")).rejects.toMatchObject({ code: "23503" });
  });

  it("fails readiness on every outbox drift and converges without duplicates", async () => {
    await expect(readinessAsRuntime()).resolves.toEqual({ version: "0009", applied: 10 });
    const role = new URL(runtimeUrl).username;
    const cases = [
      { breakSql: `GRANT SELECT ON decision_projection_outbox TO ${role}`,
        restoreSql: `REVOKE SELECT ON decision_projection_outbox FROM ${role}` },
      { breakSql: "ALTER TABLE decision_projection_outbox DISABLE TRIGGER decision_projection_outbox_append_only",
        restoreSql: "ALTER TABLE decision_projection_outbox ENABLE TRIGGER decision_projection_outbox_append_only" },
      { breakSql: "ALTER TABLE decision_projection_outbox RENAME TO decision_projection_outbox_missing",
        restoreSql: "ALTER TABLE decision_projection_outbox_missing RENAME TO decision_projection_outbox" },
      { breakSql: "ALTER SEQUENCE decision_projection_outbox_sequence RENAME TO decision_projection_outbox_sequence_missing",
        restoreSql: "ALTER SEQUENCE decision_projection_outbox_sequence_missing RENAME TO decision_projection_outbox_sequence" },
    ];
    for (const item of cases) {
      await owner!.query(item.breakSql);
      await expect(readinessAsRuntime()).rejects.toThrow();
      await owner!.query(item.restoreSql);
      await expect(readinessAsRuntime()).resolves.toEqual({ version: "0009", applied: 10 });
    }
    const migration = await runReleaseMigration({
      migrationsDir,
      creds: { migrateUrl: migrationUrl, expectedTargetId: targetId, environment: "development", allowFreshInitialization: true },
      connect: connectMigration,
    });
    expect(migration.applied).toEqual([]);
    await provision();
    expect((await owner!.query("SELECT COUNT(*)::integer ledger FROM schema_control.applied")).rows[0]?.ledger).toBe(currentLedger);
    expect((await owner!.query("SELECT COUNT(*)::integer n FROM decision_projection_outbox")).rows[0]?.n).toBe(0);
  });
});
