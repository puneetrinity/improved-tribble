// Wave 4B — exact PostgreSQL lifecycle for immutable private application evidence
// and body-free, generation-fenced Memory delivery. Disposable local DB only.

import { randomUUID } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

import { loadManifest } from "../../schema-control/manifest";
import { assertSchemaReady, FLOW_CRITICAL_POSTCONDITIONS } from "../../schema-control/readiness";
import { provisionRuntimeRole } from "../../schema-control/runtimeRole";
import { runReleaseMigration, type MigrationClient } from "../../schema-control/runner";

const migrationUrl = (process.env.FLOW_SCHEMA_TEST_DATABASE_URL ?? "").trim();
const runtimeUrl = (process.env.FLOW_SCHEMA_TEST_RUNTIME_DATABASE_URL ?? "").trim();
const enabled = process.env.FLOW_AUTHZ_TEST_DISPOSABLE === "1"
  && Boolean(migrationUrl) && Boolean(runtimeUrl);
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "schema-migrations");
const currentLedger = loadManifest(migrationsDir).length;
const targetId = "flow-organization-candidate-intake-test-target";

let owner: Client | undefined;
let pre0010Dir: string | undefined;
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
  const local = parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]"
    || Boolean(socket?.startsWith("/"));
  if (!local || !parsed.pathname.includes("_test")) {
    throw new Error(`Disposable 4B ${label} target refused.`);
  }
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

function pre0010Manifest(): string {
  const dir = mkdtempSync(join(tmpdir(), "flow-4b-pre-0010-"));
  const manifest = loadManifest(migrationsDir).filter((entry) => Number(entry.version) < 10);
  for (const entry of manifest) copyFileSync(join(migrationsDir, entry.file), join(dir, entry.file));
  copyFileSync(join(migrationsDir, "catalog.lock.json"), join(dir, "catalog.lock.json"));
  const lock = JSON.parse(readFileSync(join(migrationsDir, "checksums.lock"), "utf8")) as {
    format_version: number; catalog_lock_sha256: string; migrations: Record<string, string>;
  };
  writeFileSync(join(dir, "checksums.lock"), `${JSON.stringify({
    format_version: lock.format_version,
    catalog_lock_sha256: lock.catalog_lock_sha256,
    migrations: Object.fromEntries(Object.entries(lock.migrations)
      .filter(([version]) => Number(version) < 10)),
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
      (1,'Private A','private-a','{}'::jsonb,true,NULL),
      (2,'Private B','private-b','{}'::jsonb,true,NULL);
    INSERT INTO users (id,username,password,role,email_verified,first_name,last_name) VALUES
      (101,'owner@example.invalid','x','recruiter',true,'Private','Owner'),
      (301,'candidate@example.invalid','x','candidate',true,'Private','Candidate');
    INSERT INTO organization_members
      (id,organization_id,user_id,role,seat_assigned,credits_allocated,credits_used,credits_rollover,invited_by)
    VALUES (1,1,101,'owner',true,0,0,0,NULL);
    INSERT INTO jobs
      (id,organization_id,title,location,type,description,original_jd,posted_by,is_active,status,slug)
    VALUES
      (1001,1,'Private Role A','Remote','full-time','Fixture','Fixture',101,false,'pending','private-a-role'),
      (1002,2,'Private Role B','Remote','full-time','Fixture','Fixture',101,false,'pending','private-b-role');
    INSERT INTO candidate_resumes
      (id,user_id,label,gcs_path,extracted_text,is_default,created_at,updated_at)
    VALUES (9001,301,'Pinned Resume','gs://fixture/saved.pdf','PINNED TEXT',true,
      '2026-09-09T00:00:00Z','2026-09-09T00:00:00Z');
  `);
}

async function rebuildCurrent(): Promise<void> {
  if (owner) await owner.end();
  owner = undefined;
  await resetDatabase();
  const result = await runReleaseMigration({
    migrationsDir,
    creds: { migrateUrl: migrationUrl, expectedTargetId: targetId,
      environment: "development", allowFreshInitialization: true },
    connect: connectMigration,
  });
  expect(result.applied).toHaveLength(currentLedger);
  expect(result.applied.at(-1)).toBe("0011");
  await provision();
  owner = await clientFor(migrationUrl);
  await installActors();
}

async function insertApplication(client: Client, id: number, organizationId = 1): Promise<void> {
  await client.query(`INSERT INTO applications (
      id,organization_id,job_id,user_id,name,email,phone,resume_url,resume_filename,
      extracted_resume_text,status,submitted_by_recruiter,whatsapp_consent,platform_discovery_consent
    ) VALUES ($1,$2,$3,301,'Private Candidate',$4,'000',
      'gs://fixture/resume.pdf','resume.pdf','PINNED TEXT','submitted',false,false,false)`,
  [id, organizationId, organizationId === 1 ? 1001 : 1002, `candidate-${id}@example.invalid`]);
}

async function insertEvidence(client: Client, applicationId: number, organizationId = 1,
  source: "direct_upload" | "saved_resume" = "direct_upload") {
  const referenceId = randomUUID();
  const resumeVersionId = randomUUID();
  const outboxId = randomUUID();
  const sourceResumeId = source === "saved_resume" ? 9001 : null;
  await client.query(`WITH inserted_reference AS (
    INSERT INTO organization_candidate_references
      (reference_id,organization_id,application_id,job_id,origin_code,schema_version,created_at)
    VALUES ($1,$2,$3,$4,'candidate_applied',1,'2026-09-09T00:00:00Z')
    RETURNING reference_id
  ), inserted_version AS (
    INSERT INTO application_resume_versions
      (resume_version_id,reference_id,organization_id,application_id,job_id,version,source_kind,
       source_resume_id,source_observed_at,gcs_locator,content_sha256,byte_count,media_type,
       extracted_text,extracted_text_sha256,captured_at,created_at)
    SELECT $5,reference_id,$2,$3,$4,1,$6,$7,'2026-09-09T00:00:00Z','gs://fixture/resume.pdf',
      $8,11,'application/pdf','PINNED TEXT',$9,'2026-09-09T00:00:00Z','2026-09-09T00:00:00Z'
    FROM inserted_reference RETURNING resume_version_id,reference_id
  ), inserted_outbox AS (
    INSERT INTO organization_candidate_memory_outbox
      (outbox_id,reference_id,resume_version_id,organization_id,application_id,job_id,
       idempotency_key,state,attempts,generation,next_attempt_at,created_at,updated_at)
    SELECT $10,reference_id,resume_version_id,$2,$3,$4,$11,'pending',0,0,clock_timestamp(),
      clock_timestamp(),clock_timestamp()
    FROM inserted_version RETURNING 1 AS inserted
  ) SELECT count(*) FROM inserted_outbox`, [
    referenceId, organizationId, applicationId, organizationId === 1 ? 1001 : 1002,
    resumeVersionId, source, sourceResumeId, "a".repeat(64), "b".repeat(64), outboxId,
    Buffer.from(outboxId).toString("hex").slice(0, 64).padEnd(64, "0"),
  ]);
  return { referenceId, resumeVersionId, outboxId };
}

describe.skipIf(!enabled)("organization-private application evidence PostgreSQL lifecycle", () => {
  beforeAll(async () => {
    if (process.env.NODE_ENV !== "test") throw new Error("Disposable 4B integration requires NODE_ENV=test.");
    const migration = assertSafeUrl(migrationUrl, "migration");
    const runtime = assertSafeUrl(runtimeUrl, "runtime");
    if (migration.pathname !== runtime.pathname) throw new Error("Disposable 4B database mismatch.");
    const ownerProbe = await clientFor(migrationUrl);
    const runtimeProbe = await clientFor(runtimeUrl);
    try {
      const a = (await ownerProbe.query("SELECT current_database() database,current_user role,host(inet_server_addr()) server_addr")).rows[0];
      const b = (await runtimeProbe.query("SELECT current_database() database,current_user role,host(inet_server_addr()) server_addr")).rows[0];
      const local = (value: unknown) => [null, "127.0.0.1", "::1"].includes(value as never);
      if (!String(a?.database).includes("_test") || !String(a?.role).includes("_test_")
          || !local(a?.server_addr) || b?.database !== a?.database
          || !String(b?.role).includes("_test_") || !local(b?.server_addr)) {
        throw new Error("Disposable 4B identity proof failed.");
      }
      safeTargetProven = true;
    } finally {
      await ownerProbe.end();
      await runtimeProbe.end();
    }
  }, 30_000);

  afterAll(async () => {
    if (owner) await owner.end();
    if (safeTargetProven) await resetDatabase();
    if (pre0010Dir) rmSync(pre0010Dir, { recursive: true, force: true });
  });

  it("upgrades 10 to 11 with no backfill and refuses readiness before role reconciliation", async () => {
    await resetDatabase();
    pre0010Dir = pre0010Manifest();
    const pre = await runReleaseMigration({
      migrationsDir: pre0010Dir,
      creds: { migrateUrl: migrationUrl, expectedTargetId: targetId,
        environment: "development", allowFreshInitialization: true },
      connect: connectMigration,
    });
    expect(pre.applied).toHaveLength(10);
    await provision();
    owner = await clientFor(migrationUrl);
    await installActors();
    await insertApplication(owner, 2000);
    const upgraded = await runReleaseMigration({
      migrationsDir,
      creds: { migrateUrl: migrationUrl, expectedTargetId: targetId,
        environment: "development", allowFreshInitialization: true },
      connect: connectMigration,
    });
    expect(upgraded.applied).toEqual(["0010", "0011"]);
    const counts = (await owner.query(`SELECT
      (SELECT count(*)::integer FROM organization_candidate_references) references,
      (SELECT count(*)::integer FROM application_resume_versions) versions,
      (SELECT count(*)::integer FROM organization_candidate_memory_outbox) outbox`)).rows[0];
    expect(counts).toEqual({ references: 0, versions: 0, outbox: 0 });
    await expect(readinessAsRuntime()).rejects.toThrow();
    await provision();
    await expect(readinessAsRuntime()).resolves.toEqual({ version: "0011", applied: 12 });
  }, 180_000);

  it("commits all four writes together and rolls every write back on either failure direction", async () => {
    await rebuildCurrent();
    const runtime = await clientFor(runtimeUrl);
    try {
      await runtime.query("BEGIN");
      await insertApplication(runtime, 2001);
      const ids = await insertEvidence(runtime, 2001);
      await runtime.query("COMMIT");
      expect((await owner!.query(`SELECT
        (SELECT count(*)::integer FROM applications WHERE id=2001) applications,
        (SELECT count(*)::integer FROM organization_candidate_references WHERE application_id=2001) references,
        (SELECT count(*)::integer FROM application_resume_versions WHERE application_id=2001) versions,
        (SELECT count(*)::integer FROM organization_candidate_memory_outbox WHERE application_id=2001) outbox`)).rows[0])
        .toEqual({ applications: 1, references: 1, versions: 1, outbox: 1 });
      expect(ids.referenceId).toMatch(/^[0-9a-f-]{36}$/);

      await runtime.query("BEGIN");
      await insertApplication(runtime, 2002);
      await insertEvidence(runtime, 2002);
      await expect(insertEvidence(runtime, 2002)).rejects.toThrow();
      await runtime.query("ROLLBACK");
      expect((await owner!.query("SELECT count(*)::integer n FROM applications WHERE id=2002")).rows[0]?.n)
        .toBe(0);

      await runtime.query("BEGIN");
      await insertApplication(runtime, 2003);
      await insertEvidence(runtime, 2003);
      await runtime.query("ROLLBACK");
      expect((await owner!.query(`SELECT
        (SELECT count(*)::integer FROM applications WHERE id=2003) applications,
        (SELECT count(*)::integer FROM organization_candidate_references WHERE application_id=2003) references`)).rows[0])
        .toEqual({ applications: 0, references: 0 });
    } finally {
      await runtime.end();
    }
  }, 180_000);

  it("keeps immutable saved-resume evidence after the mutable library row is deleted", async () => {
    await rebuildCurrent();
    await insertApplication(owner!, 2101);
    const ids = await insertEvidence(owner!, 2101, 1, "saved_resume");
    const before = (await owner!.query(
      "SELECT row_to_json(v)::text value FROM application_resume_versions v WHERE resume_version_id=$1",
      [ids.resumeVersionId],
    )).rows[0]?.value;
    await owner!.query("UPDATE applications SET resume_id=NULL WHERE id=2101");
    await owner!.query("DELETE FROM candidate_resumes WHERE id=9001");
    const after = (await owner!.query(
      "SELECT row_to_json(v)::text value FROM application_resume_versions v WHERE resume_version_id=$1",
      [ids.resumeVersionId],
    )).rows[0]?.value;
    expect(after).toBe(before);
  }, 180_000);

  it("enforces least privilege, append-only evidence, organization order and generation fences", async () => {
    await rebuildCurrent();
    await insertApplication(owner!, 2201);
    await insertApplication(owner!, 2202);
    await insertApplication(owner!, 2203, 2);
    const firstA = await insertEvidence(owner!, 2201);
    await insertEvidence(owner!, 2202);
    const firstB = await insertEvidence(owner!, 2203, 2);
    const runtime = await clientFor(runtimeUrl);
    try {
      await expect(runtime.query("SELECT * FROM organization_candidate_memory_outbox"))
        .rejects.toThrow(/permission denied/);
      const concurrent = await clientFor(runtimeUrl);
      const [a, b] = await Promise.all([
        runtime.query("SELECT * FROM claim_organization_candidate_memory_intents('worker-a',1,8000)"),
        concurrent.query("SELECT * FROM claim_organization_candidate_memory_intents('worker-b',1,8000)"),
      ]);
      await concurrent.end();
      const claimed = new Set([a.rows[0]?.outbox_id, b.rows[0]?.outbox_id]);
      expect(claimed).toEqual(new Set([firstA.outboxId, firstB.outboxId]));
      const first = a.rows[0]?.outbox_id === firstA.outboxId ? a.rows[0] : b.rows[0];
      await owner!.query(
        "UPDATE organization_candidate_memory_outbox SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE outbox_id=$1",
        [firstA.outboxId],
      );
      const reclaimed = (await runtime.query(
        "SELECT * FROM claim_organization_candidate_memory_intents('worker-c',1,8000)",
      )).rows[0];
      expect(reclaimed.outbox_id).toBe(firstA.outboxId);
      expect(reclaimed.generation).toBe(first.generation + 1);
      expect((await runtime.query(
        "SELECT ack_organization_candidate_memory_intent($1,$2,$3) acknowledged",
        [firstA.outboxId, first.generation, randomUUID()],
      )).rows[0]?.acknowledged).toBe(false);
      expect((await runtime.query(
        "SELECT ack_organization_candidate_memory_intent($1,$2,$3) acknowledged",
        [firstA.outboxId, reclaimed.generation, randomUUID()],
      )).rows[0]?.acknowledged).toBe(true);

      const secondA = (await runtime.query(
        "SELECT * FROM claim_organization_candidate_memory_intents('worker-d',1,8000)",
      )).rows[0];
      expect(secondA.organization_id).toBe(1);
      expect((await runtime.query(
        "SELECT fail_organization_candidate_memory_intent($1,$2,'source_missing',clock_timestamp()+interval '5 seconds') state",
        [secondA.outbox_id, secondA.generation],
      )).rows[0]?.state).toBe("terminal");
    } finally {
      await runtime.end();
    }

    for (const table of ["organization_candidate_references", "application_resume_versions"]) {
      await expect(owner!.query(`UPDATE ${table} SET created_at=created_at`))
        .rejects.toMatchObject({ code: "55000" });
    }
    await expect(owner!.query(
      "TRUNCATE organization_candidate_memory_outbox,application_resume_versions,organization_candidate_references,candidate_consent_subjects,candidate_consent_sources,candidate_consent_events,candidate_consent_outbox",
    )).rejects.toMatchObject({ code: "55000" });
  }, 180_000);
});
