// Wave 3A — exact-schema PostgreSQL proof for the append-only decision-event spine.
// Opt-in only; it refuses any non-local/non-test target before its first write.

import { randomUUID } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";

import { assertSchemaReady, FLOW_CRITICAL_POSTCONDITIONS } from "../../schema-control/readiness";
import { loadManifest } from "../../schema-control/manifest";
import { runReleaseMigration, type MigrationClient } from "../../schema-control/runner";
import { provisionRuntimeRole } from "../../schema-control/runtimeRole";

const migrationUrl = (process.env.FLOW_SCHEMA_TEST_DATABASE_URL ?? "").trim();
const runtimeUrl = (process.env.FLOW_SCHEMA_TEST_RUNTIME_DATABASE_URL ?? "").trim();
const enabled = process.env.FLOW_AUTHZ_TEST_DISPOSABLE === "1" && Boolean(migrationUrl) && Boolean(runtimeUrl);
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "schema-migrations");
const targetId = "flow-decision-event-spine-test-target";

type WorkflowModule = typeof import("../applicationWorkflowAuthorization");
let workflow: WorkflowModule;
let owner: Client | undefined;
let runtimePool: { end(): Promise<void> } | undefined;
let pre0007Dir: string | undefined;
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
  if (!local || !parsed.pathname.includes("_test")) throw new Error(`Disposable 3A ${label} target refused.`);
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

function pre0007Manifest(): string {
  const dir = mkdtempSync(join(tmpdir(), "flow-3a-pre-0007-"));
  const manifest = loadManifest(migrationsDir).filter((entry) => Number(entry.version) < 7);
  for (const entry of manifest) copyFileSync(join(migrationsDir, entry.file), join(dir, entry.file));
  copyFileSync(join(migrationsDir, "catalog.lock.json"), join(dir, "catalog.lock.json"));
  const lock = JSON.parse(readFileSync(join(migrationsDir, "checksums.lock"), "utf8")) as {
    format_version: number; catalog_lock_sha256: string; migrations: Record<string, string>;
  };
  writeFileSync(join(dir, "checksums.lock"), `${JSON.stringify({
    format_version: lock.format_version,
    catalog_lock_sha256: lock.catalog_lock_sha256,
    migrations: Object.fromEntries(Object.entries(lock.migrations).filter(([version]) => Number(version) < 7)),
  }, null, 2)}\n`);
  return dir;
}

async function installFixture(): Promise<void> {
  await owner!.query(`
    INSERT INTO organizations (id,name,slug,settings,is_active,signal_tenant_id)
    VALUES (1,'Decision org','decision-org','{}'::jsonb,true,NULL);
    INSERT INTO users (id,username,password,role,email_verified,first_name,last_name) VALUES
      (101,'actor@example.invalid','x','recruiter',true,'Decision','Actor'),
      (301,'candidate@example.invalid','x','candidate',true,'Fixture','Candidate');
    INSERT INTO organization_members
      (id,organization_id,user_id,role,seat_assigned,credits_allocated,credits_used,credits_rollover,invited_by)
    VALUES (1,1,101,'owner',true,0,0,0,NULL);
    INSERT INTO jobs
      (id,organization_id,title,location,type,description,original_jd,posted_by,is_active,status,slug,
       jd_digest,jd_digest_version)
    VALUES
      (1001,1,'Decision Role','Remote','full-time','Fixture','Fixture',101,false,'pending','decision-role',
       '{"summary":"not copied"}'::jsonb,3);
    INSERT INTO pipeline_stages (id,organization_id,name,"order",is_default,created_by) VALUES
      (1,1,'Applied',1,false,101),
      (2,1,'Interview',2,false,101),
      (3,1,'Final',3,false,101),
      (4,1,'Archive',4,false,101);
    INSERT INTO applications
      (id,organization_id,job_id,user_id,name,email,phone,resume_url,resume_filename,extracted_resume_text,
       status,current_stage,recruiter_notes,rating,submitted_by_recruiter,created_by_user_id,source,
       source_metadata,whatsapp_consent,platform_discovery_consent,ai_suggested_action,
       ai_suggested_action_reason,ai_summary_model_version,ai_digest_version_used)
    VALUES
      (2001,1,1001,301,'Private Candidate','private@example.invalid','000','https://invalid/private','private.pdf',
       'PRIVATE RESUME','submitted',1,ARRAY['PRIVATE NOTE'],2,true,101,'decision_fixture','{}'::jsonb,false,false,
       'advance','PRIVATE RECOMMENDATION','model-v1',3);
  `);
}

async function counts(): Promise<Record<string, number>> {
  return (await owner!.query(`
    SELECT
      (SELECT COUNT(*)::integer FROM application_stage_history) AS history,
      (SELECT COUNT(*)::integer FROM decision_events) AS events,
      (SELECT last_value::integer FROM decision_event_sequence) AS sequence
  `)).rows[0];
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

describe.skipIf(!enabled)("decision-event spine exact-schema PostgreSQL", () => {
  beforeAll(async () => {
    if (process.env.NODE_ENV !== "test") throw new Error("Disposable 3A integration requires NODE_ENV=test.");
    const migration = assertSafeUrl(migrationUrl, "migration");
    const runtime = assertSafeUrl(runtimeUrl, "runtime");
    if (migration.pathname !== runtime.pathname) throw new Error("Disposable 3A database mismatch.");
    const ownerProbe = await clientFor(migrationUrl);
    const runtimeProbe = await clientFor(runtimeUrl);
    try {
      const a = (await ownerProbe.query("SELECT current_database() database,current_user role,host(inet_server_addr()) server_addr")).rows[0];
      const b = (await runtimeProbe.query("SELECT current_database() database,current_user role,host(inet_server_addr()) server_addr")).rows[0];
      const local = (value: unknown) => [null, "127.0.0.1", "::1"].includes(value as never);
      if (!String(a?.database).includes("_test") || !String(a?.role).includes("_test_") || !local(a?.server_addr)
          || b?.database !== a?.database || !String(b?.role).includes("_test_") || !local(b?.server_addr)) {
        throw new Error("Disposable 3A identity proof failed.");
      }
      safeTargetProven = true;
    } finally {
      await ownerProbe.end();
      await runtimeProbe.end();
    }
    await resetDatabase();
    pre0007Dir = pre0007Manifest();
    const pre = await runReleaseMigration({
      migrationsDir: pre0007Dir,
      creds: { migrateUrl: migrationUrl, expectedTargetId: targetId, environment: "development", allowFreshInitialization: true },
      connect: connectMigration,
    });
    if (pre.applied.length !== 7) throw new Error("Disposable 3A pre-0007 ledger refused.");
    owner = await clientFor(migrationUrl);
    const absent = (await owner.query(`SELECT
      (SELECT COUNT(*)::integer FROM schema_control.applied) ledger,
      to_regclass('public.decision_events') event_table,
      to_regclass('public.decision_event_sequence') event_sequence`)).rows[0];
    if (absent.ledger !== 7 || absent.event_table !== null || absent.event_sequence !== null) {
      throw new Error("Disposable 3A pre-0007 absence refused.");
    }
    await provisionRuntimeRole({
      migrateUrl: migrationUrl,
      runtimeUrl,
      runtimeRole: new URL(runtimeUrl).username,
      expectedTargetId: targetId,
      connectMigration,
      connectRuntime,
    });
    const upgrade = await runReleaseMigration({
      migrationsDir,
      creds: { migrateUrl: migrationUrl, expectedTargetId: targetId, environment: "development", allowFreshInitialization: true },
      connect: connectMigration,
    });
    if (upgrade.applied.join(",") !== "0007") throw new Error("Disposable 3A migration isolation refused.");

    // The release-first window is intentionally not runtime-ready until the
    // provisioner removes default table/sequence grants and applies the exact exception.
    await expect(readinessAsRuntime()).rejects.toThrow(/Runtime role has application rights/);
    await provisionRuntimeRole({
      migrateUrl: migrationUrl,
      runtimeUrl,
      runtimeRole: new URL(runtimeUrl).username,
      expectedTargetId: targetId,
      connectMigration,
      connectRuntime,
    });
    await expect(readinessAsRuntime()).resolves.toEqual({ version: "0007", applied: 8 });
    process.env.DATABASE_URL = runtimeUrl;
    process.env.DATABASE_SSL = "false";
    workflow = await import("../applicationWorkflowAuthorization");
    runtimePool = (await import("../../db")).pool;
  }, 180_000);

  beforeEach(async () => {
    if (!owner || !safeTargetProven) throw new Error("Disposable 3A target not proven.");
    await owner.query("ALTER TABLE public.decision_events DISABLE TRIGGER USER");
    await owner.query("TRUNCATE public.users, public.organizations RESTART IDENTITY CASCADE");
    await owner.query("ALTER TABLE public.decision_events ENABLE TRIGGER USER");
    await installFixture();
  });

  afterAll(async () => {
    if (runtimePool) await runtimePool.end();
    if (owner) await owner.end();
    if (safeTargetProven) await resetDatabase();
    if (pre0007Dir) rmSync(pre0007Dir, { recursive: true, force: true });
  });

  it("installs the exact ledger-8 relation, constraints, indexes, and append-only guards", async () => {
    const facts = (await owner!.query(`SELECT
      (SELECT COUNT(*)::integer FROM schema_control.applied) ledger,
      to_regclass('public.decision_events')::text relation,
      to_regclass('public.decision_event_sequence')::text sequence,
      (SELECT COUNT(*)::integer FROM pg_constraint WHERE conrelid='public.decision_events'::regclass) constraints,
      (SELECT COUNT(*)::integer FROM pg_indexes WHERE schemaname='public' AND tablename='decision_events') indexes,
      (SELECT COUNT(*)::integer FROM pg_trigger WHERE tgrelid='public.decision_events'::regclass
        AND NOT tgisinternal AND tgenabled<>'D') triggers,
      (SELECT COUNT(*)::integer FROM decision_events) inferred_rows`)).rows[0];
    expect(facts).toEqual({ ledger: 8, relation: "decision_events", sequence: "decision_event_sequence",
      constraints: 26, indexes: 8, triggers: 2, inferred_rows: 0 });
  });

  it("commits one minimized event, history row, and stage change with one shared clock", async () => {
    const eventId = randomUUID();
    const result = await workflow.moveAuthorizedApplicationStage(
      101, 2001, 2, "PRIVATE NOTE MUST STAY OFF EVENT", eventId, { allowPlatformAdmin: true },
    );
    expect(result).toMatchObject({ ok: true, value: { applicationId: 2001, stageId: 2, changed: true } });
    const row = (await owner!.query(`SELECT
      a.current_stage,a.stage_changed_by,a.stage_changed_at,h.changed_at history_at,
      e.event_id::text,e.organization_id,e.aggregate_type,e.aggregate_id,e.job_id,e.actor_user_id,
      e.requesting_actor_user_id,e.action_code,e.source_surface,e.event_schema_version,e.taxonomy_version,
      e.rubric_id,e.rubric_version,e.rubric_approval_mode,e.jd_digest_version,e.rating_contract_version,
      e.recommendation_action,e.recommendation_model_version,e.recommendation_input_version,e.reason_code,
      e.idempotency_key,e.before_state,e.after_state,e.occurred_at,e.event_sequence,e.aggregate_sequence,
      e::text event_text
      FROM applications a JOIN application_stage_history h ON h.application_id=a.id
      JOIN decision_events e ON e.aggregate_id=a.id WHERE a.id=2001`)).rows[0];
    expect(row).toMatchObject({
      current_stage: 2, stage_changed_by: 101, event_id: eventId, organization_id: 1,
      aggregate_type: "application", aggregate_id: 2001, job_id: 1001, actor_user_id: 101,
      requesting_actor_user_id: null, action_code: "application_stage_moved",
      source_surface: "applications.stage_patch", event_schema_version: 1, taxonomy_version: 1,
      rubric_id: null, rubric_version: null, rubric_approval_mode: null, jd_digest_version: 3,
      rating_contract_version: null, recommendation_action: "advance", recommendation_model_version: "model-v1",
      recommendation_input_version: 3, reason_code: null, idempotency_key: null,
      before_state: { stage_id: 1 }, after_state: { stage_id: 2 },
    });
    expect(row.event_sequence).toBe(row.aggregate_sequence);
    expect(row.stage_changed_at).toEqual(row.history_at);
    expect(row.stage_changed_at).toEqual(row.occurred_at);
    for (const secret of ["Private Candidate", "private@example.invalid", "PRIVATE RESUME", "PRIVATE NOTE", "PRIVATE RECOMMENDATION", "Interview"]) {
      expect(row.event_text).not.toContain(secret);
    }
  });

  it("makes same-stage a zero-write, zero-sequence no-op", async () => {
    const before = await counts();
    const timestamp = (await owner!.query("SELECT updated_at,stage_changed_at,stage_changed_by FROM applications WHERE id=2001")).rows[0];
    await expect(workflow.moveAuthorizedApplicationStage(
      101, 2001, 1, "must not persist", randomUUID(), { allowPlatformAdmin: true },
    )).resolves.toMatchObject({ ok: true, value: { changed: false, changedAt: null } });
    expect(await counts()).toEqual(before);
    expect((await owner!.query("SELECT updated_at,stage_changed_at,stage_changed_by FROM applications WHERE id=2001")).rows[0])
      .toEqual(timestamp);
  });

  it("never promotes an invalid recommendation or a missing JD digest into authority", async () => {
    await owner!.query(`UPDATE jobs SET jd_digest=NULL,jd_digest_version=99 WHERE id=1001;
      UPDATE applications SET ai_suggested_action='invented',ai_summary_model_version='model-private',
        ai_digest_version_used=99 WHERE id=2001`);
    await workflow.moveAuthorizedApplicationStage(101, 2001, 2, null, randomUUID(), { allowPlatformAdmin: true });
    expect((await owner!.query(`SELECT jd_digest_version,rubric_id,rubric_version,rubric_approval_mode,
      rating_contract_version,recommendation_action,recommendation_model_version,
      recommendation_input_version,reason_code FROM decision_events`)).rows[0]).toEqual({
      jd_digest_version: null, rubric_id: null, rubric_version: null, rubric_approval_mode: null,
      rating_contract_version: null, recommendation_action: null, recommendation_model_version: null,
      recommendation_input_version: null, reason_code: null,
    });
  });

  it("rolls application and history back when the event insert fails", async () => {
    const eventId = randomUUID();
    await workflow.moveAuthorizedApplicationStage(101, 2001, 2, null, eventId, { allowPlatformAdmin: true });
    const before = (await owner!.query("SELECT current_stage,stage_changed_at,stage_changed_by FROM applications WHERE id=2001")).rows[0];
    const beforeCounts = await counts();
    await expect(workflow.moveAuthorizedApplicationStage(101, 2001, 3, null, eventId, { allowPlatformAdmin: true }))
      .resolves.toEqual({ ok: false, reason: "unavailable" });
    expect((await owner!.query("SELECT current_stage,stage_changed_at,stage_changed_by FROM applications WHERE id=2001")).rows[0])
      .toEqual(before);
    const afterCounts = await counts();
    expect(afterCounts.history).toBe(beforeCounts.history);
    expect(afterCounts.events).toBe(beforeCounts.events);
    // PostgreSQL sequences are intentionally non-transactional; failed event
    // attempts may leave a harmless global-order gap, which the v1 contract allows.
    expect(afterCounts.sequence).toBe(beforeCounts.sequence + 1);
  });

  it("rolls application and event back when history insertion fails", async () => {
    await owner!.query(`CREATE FUNCTION public.flow_test_reject_history() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='TEST_HISTORY_REFUSED'; END $$;
      CREATE TRIGGER flow_test_reject_history BEFORE INSERT ON application_stage_history
      FOR EACH ROW EXECUTE FUNCTION public.flow_test_reject_history()`);
    const before = (await owner!.query("SELECT current_stage,stage_changed_at,stage_changed_by FROM applications WHERE id=2001")).rows[0];
    try {
      await expect(workflow.moveAuthorizedApplicationStage(101, 2001, 2, null, randomUUID(), { allowPlatformAdmin: true }))
        .resolves.toEqual({ ok: false, reason: "unavailable" });
      expect((await owner!.query("SELECT current_stage,stage_changed_at,stage_changed_by FROM applications WHERE id=2001")).rows[0])
        .toEqual(before);
      expect((await owner!.query("SELECT COUNT(*)::integer history,(SELECT COUNT(*)::integer FROM decision_events) events FROM application_stage_history")).rows[0])
        .toEqual({ history: 0, events: 0 });
    } finally {
      await owner!.query("DROP TRIGGER flow_test_reject_history ON application_stage_history; DROP FUNCTION flow_test_reject_history()");
    }
  });

  it("serializes concurrent moves into a contiguous committed event chain", async () => {
    const [a, b] = await Promise.all([
      workflow.moveAuthorizedApplicationStage(101, 2001, 2, null, randomUUID(), { allowPlatformAdmin: true }),
      workflow.moveAuthorizedApplicationStage(101, 2001, 3, null, randomUUID(), { allowPlatformAdmin: true }),
    ]);
    expect(a).toMatchObject({ ok: true, value: { changed: true } });
    expect(b).toMatchObject({ ok: true, value: { changed: true } });
    const events = (await owner!.query("SELECT before_state,after_state,event_sequence FROM decision_events ORDER BY event_sequence")).rows;
    const history = (await owner!.query("SELECT from_stage,to_stage FROM application_stage_history ORDER BY changed_at,id")).rows;
    expect(events).toHaveLength(2);
    expect(history).toHaveLength(2);
    expect(events[0].before_state).toEqual({ stage_id: 1 });
    expect(events[1].before_state).toEqual(events[0].after_state);
    const eventPairs = events.map((row) => `${row.before_state.stage_id}->${row.after_state.stage_id}`).sort();
    const historyPairs = history.map((row) => `${row.from_stage}->${row.to_stage}`).sort();
    expect(eventPairs).toEqual(historyPairs);
    expect(new Set(events.map((row) => row.event_sequence)).size).toBe(2);
  });

  it("enforces runtime insert-only ACL and owner-level append-only triggers", async () => {
    const runtime = await clientFor(runtimeUrl);
    try {
      const acl = (await owner!.query(`SELECT
        has_table_privilege($1,'public.decision_events','INSERT') can_insert,
        has_table_privilege($1,'public.decision_events','SELECT') can_select,
        has_table_privilege($1,'public.decision_events','UPDATE') can_update,
        has_table_privilege($1,'public.decision_events','DELETE') can_delete,
        has_table_privilege($1,'public.decision_events','TRUNCATE') can_truncate,
        has_sequence_privilege($1,'public.decision_event_sequence','USAGE') can_use,
        has_sequence_privilege($1,'public.decision_event_sequence','SELECT') can_read_sequence,
        has_sequence_privilege($1,'public.decision_event_sequence','UPDATE') can_set_sequence`,
        [new URL(runtimeUrl).username])).rows[0];
      expect(acl).toEqual({ can_insert: true, can_select: false, can_update: false, can_delete: false,
        can_truncate: false, can_use: true, can_read_sequence: false, can_set_sequence: false });
      for (const sql of [
        "SELECT * FROM decision_events", "UPDATE decision_events SET action_code=action_code",
        "DELETE FROM decision_events", "TRUNCATE decision_events", "SELECT setval('decision_event_sequence',1)",
      ]) await expect(runtime.query(sql)).rejects.toMatchObject({ code: "42501" });
    } finally {
      await runtime.end();
    }
    await workflow.moveAuthorizedApplicationStage(101, 2001, 2, null, randomUUID(), { allowPlatformAdmin: true });
    for (const sql of [
      "UPDATE decision_events SET action_code=action_code", "DELETE FROM decision_events", "TRUNCATE decision_events",
    ]) {
      await owner!.query("BEGIN");
      await expect(owner!.query(sql)).rejects.toMatchObject({ code: "55000", message: "DECISION_EVENT_APPEND_ONLY" });
      await owner!.query("ROLLBACK");
    }
  });

  it("lets minimized evidence outlive mutable rows but anchors organization deletion", async () => {
    await workflow.moveAuthorizedApplicationStage(101, 2001, 2, null, randomUUID(), { allowPlatformAdmin: true });
    await owner!.query("DELETE FROM applications WHERE id=2001");
    await owner!.query("DELETE FROM pipeline_stages WHERE organization_id=1");
    await owner!.query("DELETE FROM jobs WHERE id=1001");
    await owner!.query("DELETE FROM organization_members WHERE organization_id=1");
    await owner!.query("DELETE FROM users WHERE id IN (101,301)");
    expect((await owner!.query("SELECT COUNT(*)::integer n FROM decision_events")).rows[0]?.n).toBe(1);
    await expect(owner!.query("DELETE FROM organizations WHERE id=1")).rejects.toMatchObject({ code: "23503" });
  });

  it("fails readiness on drift and converges migrations/provisioning without duplicates", async () => {
    await expect(readinessAsRuntime()).resolves.toEqual({ version: "0007", applied: 8 });
    const cases: Array<{ breakSql: string; restoreSql: string }> = [
      { breakSql: `GRANT SELECT ON decision_events TO ${new URL(runtimeUrl).username}`,
        restoreSql: `REVOKE SELECT ON decision_events FROM ${new URL(runtimeUrl).username}` },
      { breakSql: "ALTER TABLE decision_events DISABLE TRIGGER decision_events_append_only",
        restoreSql: "ALTER TABLE decision_events ENABLE TRIGGER decision_events_append_only" },
      { breakSql: "ALTER TABLE decision_events RENAME TO decision_events_missing",
        restoreSql: "ALTER TABLE decision_events_missing RENAME TO decision_events" },
      { breakSql: "ALTER SEQUENCE decision_event_sequence RENAME TO decision_event_sequence_missing",
        restoreSql: "ALTER SEQUENCE decision_event_sequence_missing RENAME TO decision_event_sequence" },
    ];
    for (const item of cases) {
      await owner!.query(item.breakSql);
      await expect(readinessAsRuntime()).rejects.toThrow();
      await owner!.query(item.restoreSql);
      await expect(readinessAsRuntime()).resolves.toEqual({ version: "0007", applied: 8 });
    }
    const noOp = await runReleaseMigration({
      migrationsDir,
      creds: { migrateUrl: migrationUrl, expectedTargetId: targetId, environment: "development", allowFreshInitialization: true },
      connect: connectMigration,
    });
    expect(noOp.applied).toEqual([]);
    await provisionRuntimeRole({
      migrateUrl: migrationUrl, runtimeUrl, runtimeRole: new URL(runtimeUrl).username,
      expectedTargetId: targetId, connectMigration, connectRuntime,
    });
    expect((await owner!.query("SELECT COUNT(*)::integer ledger FROM schema_control.applied")).rows[0]?.ledger).toBe(8);
    expect((await owner!.query("SELECT COUNT(*)::integer n FROM decision_events")).rows[0]?.n).toBe(0);
  });
});
