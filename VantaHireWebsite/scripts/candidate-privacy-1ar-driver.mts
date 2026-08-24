import { randomUUID } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

import { sha256 } from "../server/schema-control/manifest";
import { runReleaseMigration, type MigrationClient } from "../server/schema-control/runner";
import { provisionRuntimeRole } from "../server/schema-control/runtimeRole";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationsDir = join(root, "server", "schema-migrations");
const migrationUrl = process.env.FLOW_SCHEMA_TEST_DATABASE_URL ?? "";
const runtimeUrl = process.env.FLOW_SCHEMA_TEST_RUNTIME_DATABASE_URL ?? "";
const memoryUrl = process.env.ACTIVEKG_BASE_URL ?? "";
const targetId = "flow-candidate-privacy-1ar-test-target";
const globalSignalId = "candidate-privacy-1ar-global";
const erasureSignalId = "candidate-privacy-1ar-erasure";

function refuse(): never {
  throw new Error("FLOW_1AR_DRIVER_REFUSED");
}

function assertTarget(raw: string, expectedRole: string): void {
  const parsed = new URL(raw);
  if (
    !["127.0.0.1", "::1", "[::1]", "localhost"].includes(parsed.hostname) ||
    !decodeURIComponent(parsed.pathname).includes("test") ||
    decodeURIComponent(parsed.username) !== expectedRole
  ) refuse();
}

assertTarget(migrationUrl, "flow_schema_control_test_runner");
assertTarget(runtimeUrl, "flow_schema_control_test_runtime");
const parsedMemory = new URL(memoryUrl);
if (!["127.0.0.1", "::1", "[::1]", "localhost"].includes(parsedMemory.hostname)) refuse();
if (process.env.NODE_ENV !== "test" || process.env.FLOW_CANDIDATE_PRIVACY_INTAKE_ENABLED !== "true") refuse();

const scenarioPath = process.argv[2];
if (!scenarioPath) refuse();
const scenario = JSON.parse(readFileSync(scenarioPath, "utf8")) as Record<string, unknown>;
if (
  JSON.stringify(Object.keys(scenario).sort()) !== JSON.stringify(["command"]) ||
  !["setup", "transition"].includes(String(scenario.command))
) refuse();

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

function baselineOnlyManifest(): string {
  const directory = mkdtempSync(join("/tmp", "flow-1ar-baseline-"));
  copyFileSync(join(migrationsDir, "0000_baseline.sql"), join(directory, "0000_baseline.sql"));
  copyFileSync(join(migrationsDir, "catalog.lock.json"), join(directory, "catalog.lock.json"));
  const lock = JSON.parse(readFileSync(join(migrationsDir, "checksums.lock"), "utf8"));
  writeFileSync(join(directory, "checksums.lock"), `${JSON.stringify({
    format_version: 1,
    catalog_lock_sha256: lock.catalog_lock_sha256,
    migrations: { "0000": sha256(readFileSync(join(directory, "0000_baseline.sql"))) },
  }, null, 2)}\n`);
  return directory;
}

async function initialize(): Promise<void> {
  const admin = await clientFor(migrationUrl);
  try {
    await admin.query("DROP SCHEMA IF EXISTS schema_control CASCADE");
    await admin.query("DROP SCHEMA IF EXISTS public CASCADE");
    await admin.query("CREATE SCHEMA public AUTHORIZATION CURRENT_USER");
  } finally {
    await admin.end();
  }
  const baseline = baselineOnlyManifest();
  try {
    await runReleaseMigration({
      migrationsDir: baseline,
      creds: { migrateUrl: migrationUrl, expectedTargetId: targetId, environment: "development", allowFreshInitialization: true },
      connect: connectMigration,
    });
    await provisionRuntimeRole({
      migrateUrl: migrationUrl,
      runtimeUrl,
      runtimeRole: "flow_schema_control_test_runtime",
      expectedTargetId: targetId,
      connectMigration,
      connectRuntime,
    });
    await runReleaseMigration({
      migrationsDir,
      creds: { migrateUrl: migrationUrl, expectedTargetId: targetId, environment: "development", allowFreshInitialization: true },
      connect: connectMigration,
    });
  } finally {
    rmSync(baseline, { recursive: true, force: true });
  }
}

async function seedSubjectGraph(): Promise<{ actorId: number; globalId: number; erasureId: number }> {
  const admin = await clientFor(migrationUrl);
  try {
    const actorId = Number((await admin.query(
      `INSERT INTO users (username,password,role,email_verified)
       VALUES ('candidate-privacy-1ar@example.invalid','not-a-real-hash','candidate',true)
       RETURNING id`,
    )).rows[0].id);
    const organizationId = Number((await admin.query(
      "INSERT INTO organizations (name,slug) VALUES ('Synthetic Privacy Org','synthetic-privacy-org') RETURNING id",
    )).rows[0].id);
    const jobId = Number((await admin.query(
      `INSERT INTO jobs (title,location,type,description,posted_by,organization_id)
       VALUES ('Synthetic Role','Remote','full_time','Synthetic only',$1,$2) RETURNING id`,
      [actorId, organizationId],
    )).rows[0].id);
    const sourcingRequest = "candidate-privacy-1ar-run";
    await admin.query(
      `INSERT INTO job_sourcing_runs
         (organization_id,job_id,request_id,external_job_id,context_hash)
       VALUES ($1,$2,$3,'synthetic-job','synthetic-context')`,
      [organizationId, jobId, sourcingRequest],
    );
    const rows = await admin.query(
      `INSERT INTO job_sourced_candidates
         (organization_id,job_id,request_id,signal_candidate_id,source_type)
       VALUES ($1,$2,$3,$4,'synthetic'),($1,$2,$3,$5,'synthetic')
       RETURNING id,signal_candidate_id`,
      [organizationId, jobId, sourcingRequest, globalSignalId, erasureSignalId],
    );
    return {
      actorId,
      globalId: Number(rows.rows.find((row) => row.signal_candidate_id === globalSignalId)?.id),
      erasureId: Number(rows.rows.find((row) => row.signal_candidate_id === erasureSignalId)?.id),
    };
  } finally {
    await admin.end();
  }
}

async function setup() {
  await initialize();
  const subjects = await seedSubjectGraph();
  process.env.DATABASE_URL = runtimeUrl;
  process.env.DATABASE_SSL = "false";
  const repository = await import("../server/candidate-privacy/repository");
  const processor = await import("../server/candidate-privacy/processor");
  const database = await import("../server/db");
  try {
    await repository.createLocalPrivacyRequest({
      requestId: randomUUID(), action: "withdraw_global_matching", authorityType: "verified_candidate",
      actorUserId: subjects.actorId, evidenceRef: randomUUID(), reasonCode: "candidate_global_opt_out",
      anchor: { type: "job_sourced_candidate", id: subjects.globalId },
    });
    await repository.createLocalPrivacyRequest({
      requestId: randomUUID(), action: "request_erasure", authorityType: "verified_candidate",
      actorUserId: subjects.actorId, evidenceRef: randomUUID(), reasonCode: "candidate_erasure_request",
      anchor: { type: "job_sourced_candidate", id: subjects.erasureId },
    });
    const immediateGlobal = await repository.privacyDecisionForAnchor(
      { type: "job_sourced_candidate", id: subjects.globalId }, { globalUse: true },
    );
    const immediateErasure = await repository.privacyDecisionForAnchor(
      { type: "job_sourced_candidate", id: subjects.erasureId }, { globalUse: false },
    );
    const privateException = await repository.privacyDecisionForAnchor(
      { type: "job_sourced_candidate", id: subjects.globalId }, { globalUse: false },
    );
    if (
      immediateGlobal !== "block_global" || immediateErasure !== "block_all" ||
      privateException !== "allow_existing_org_workflow"
    ) refuse();

    const staleClaim = await repository.claimPrivacyOutbox(1_000);
    if (!staleClaim) refuse();
    const admin = await clientFor(migrationUrl);
    try {
      await admin.query(
        "UPDATE candidate_privacy_outbox SET lease_expires_at=now()-interval '1 second' WHERE outbox_id=$1",
        [staleClaim.outboxId],
      );
    } finally {
      await admin.end();
    }
    await processor.runCandidatePrivacyProcessorOnce();
    const staleProjection = await database.pool.query(
      `SELECT r.request_id,p.directive_id,p.action,p.scope,p.state,p.decision,p.version,p.effective_at
         FROM candidate_privacy_requests r JOIN candidate_privacy_remote_projection p USING (request_id)
        WHERE r.request_id=$1`,
      [staleClaim.requestId],
    );
    let staleCompletionRejected = 0;
    try {
      const row = staleProjection.rows[0];
      await repository.markOutboxDelivered(staleClaim, {
        request_id: String(row.request_id), directive_id: String(row.directive_id), action: row.action,
        scope: row.scope, state: row.state, decision: row.decision, version: Number(row.version),
        effective_at: new Date(row.effective_at).toISOString(),
      });
    } catch {
      staleCompletionRejected = 1;
    }
    await processor.runCandidatePrivacyProcessorOnce();
    const result = (await database.pool.query(
      `SELECT
         (SELECT COUNT(*)::integer FROM candidate_privacy_requests) AS requests,
         (SELECT COUNT(*)::integer FROM candidate_privacy_outbox WHERE state='succeeded') AS delivered,
         (SELECT COUNT(*)::integer FROM candidate_privacy_remote_projection) AS projections,
         (SELECT COUNT(*)::integer FROM candidate_privacy_request_events) AS events,
         (SELECT cursor::integer FROM candidate_privacy_sync_state WHERE consumer_name='flow') AS cursor`,
    )).rows[0];
    if (
      Number(result.requests) !== 2 || Number(result.delivered) !== 2 ||
      Number(result.projections) !== 2 || Number(result.events) !== 4 ||
      Number(result.cursor) !== 6 || staleCompletionRejected !== 1
    ) refuse();
    return {
      cursor: Number(result.cursor), delivered: Number(result.delivered), events: Number(result.events),
      immediate_restrictions: 2, projections: Number(result.projections), requests: Number(result.requests),
      private_exception: 1,
      stale_completion_rejected: staleCompletionRejected,
    };
  } finally {
    await database.pool.end();
  }
}

async function transition() {
  process.env.DATABASE_URL = runtimeUrl;
  process.env.DATABASE_SSL = "false";
  const { signServiceJwt } = await import("../server/lib/services/jwt-signer");
  const processor = await import("../server/candidate-privacy/processor");
  const database = await import("../server/db");
  try {
    const rows = (await database.pool.query(
      `SELECT r.request_id,r.action,p.directive_id,p.version
         FROM candidate_privacy_requests r JOIN candidate_privacy_remote_projection p USING (request_id)
        ORDER BY r.action`,
    )).rows;
    if (rows.length !== 2) refuse();
    for (const row of rows) {
      const token = await signServiceJwt("activekg", { tenantId: "platform", scopes: "candidate-privacy:write" });
      const response = await fetch(`${memoryUrl}/candidate-privacy/directives/${row.directive_id}/transitions`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          request_id: randomUUID(),
          expected_version: Number(row.version),
          transition: row.action === "withdraw_global_matching" ? "release" : "mark_needs_review",
          evidence_ref: randomUUID(),
          reason_code: "operator_correction",
        }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) refuse();
      await response.arrayBuffer();
    }
    await database.pool.query(
      `UPDATE candidate_privacy_remote_projection
          SET state='released',decision='allow'
        WHERE action='withdraw_global_matching'`,
    );
    await database.pool.query(
      "UPDATE candidate_privacy_sync_state SET cursor=0,status='healthy',last_success_at=now() WHERE consumer_name='flow'",
    );
    await processor.runCandidatePrivacyProcessorOnce();
    await processor.runCandidatePrivacyProcessorOnce();
    const result = (await database.pool.query(
      `SELECT
         (SELECT COUNT(*)::integer FROM candidate_privacy_requests WHERE state='released') AS released,
         (SELECT COUNT(*)::integer FROM candidate_privacy_requests WHERE state='needs_review') AS review,
         (SELECT COUNT(*)::integer FROM candidate_privacy_request_events WHERE event_type='remote_projection') AS transition_events,
         (SELECT COUNT(*)::integer FROM candidate_privacy_remote_projection) AS projections,
         (SELECT cursor::integer FROM candidate_privacy_sync_state WHERE consumer_name='flow') AS cursor`,
    )).rows[0];
    if (
      Number(result.released) !== 1 || Number(result.review) !== 1 ||
      Number(result.transition_events) !== 2 || Number(result.projections) !== 2 ||
      Number(result.cursor) !== 8
    ) refuse();
    return {
      cursor: Number(result.cursor), projections: Number(result.projections),
      released: Number(result.released), review: Number(result.review),
      transition_events: Number(result.transition_events),
    };
  } finally {
    await database.pool.end();
  }
}

try {
  const result = scenario.command === "setup" ? await setup() : await transition();
  process.stdout.write(JSON.stringify(result));
} catch {
  process.stderr.write("FLOW_1AR_DRIVER_REFUSED\n");
  process.exitCode = 1;
}
