// Local disposable database only. Real PostgreSQL, distinct non-superuser roles;
// no production environment, external service, model, Redis or storage access.
import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Client, Pool } from "pg";
import { candidateIndexCommandKey, CANDIDATE_INDEX_FUNCTIONS } from "../contracts";
import { CANDIDATE_INDEX_CATALOG_SQL, CANDIDATE_INDEX_CATALOG_SHA256,
  candidateIndexPrivilegesReady } from "../../schema-control/readiness";
import { provisionRuntimeRole } from "../../schema-control/runtimeRole";
import { assertSchemaReady, FLOW_CRITICAL_POSTCONDITIONS } from "../../schema-control/readiness";
import { runReleaseMigration } from "../../schema-control/runner";
import { loadManifest } from "../../schema-control/manifest";
import { runCandidateIndexProcessorOnce, shouldEnqueueLegacyApplication } from "../processor";
import { candidateIndexCommandDigest, CandidateIndexMemoryError, type deliverCandidateIndex } from "../memory-client";
import { processJob as processLegacyJob } from "../../lib/applicationGraphSyncProcessor";
import type { ApplicationGraphSyncJob } from "@shared/schema";
import { censusApplicationCatchup, executeApplicationCatchup } from "../catchup";

// This matrix passes a real restricted PG connection explicitly. The app's
// singleton and privacy/provider calls are isolated here; the full two-system
// proof must exercise those unchanged boundaries with the real web process.
const legacy = vi.hoisted(() => ({
  pool: null as Pool | null, application: vi.fn(), admit: vi.fn(),
  read: vi.fn(), create: vi.fn(), edge: vi.fn(), succeeded: vi.fn(),
  dead: vi.fn(), restricted: vi.fn(), download: vi.fn(),
}));
vi.mock("../../db", () => ({ db: {}, pool: { connect: () => legacy.pool!.connect() } }));
vi.mock("../../storage", () => ({ storage: {
  getApplicationForPrivacyWorker: legacy.application,
  markApplicationGraphSyncJobSucceeded: legacy.succeeded,
  markApplicationGraphSyncJobDeadLetter: legacy.dead,
  markApplicationGraphSyncJobPrivacyRestricted: legacy.restricted,
} }));
vi.mock("../../candidate-privacy/decision", async importOriginal => ({
  ...await importOriginal<typeof import("../../candidate-privacy/decision")>(),
  requireCandidatePrivacyAllowed: legacy.admit,
}));
vi.mock("../../lib/services/activekg-client", async importOriginal => ({
  ...await importOriginal<typeof import("../../lib/services/activekg-client")>(),
  getNodeByExternalId: legacy.read, createNode: legacy.create, createEdge: legacy.edge,
}));
vi.mock("../../gcs-storage", () => ({ downloadFromGCS: legacy.download }));

const ownerUrl = process.env.FLOW_INDEX_TEST_OWNER_URL ?? "";
const runtimeUrl = process.env.FLOW_INDEX_TEST_RUNTIME_URL ?? "";
const readonlyUrl = process.env.FLOW_INDEX_TEST_READONLY_URL ?? "";
const enabled = process.env.FLOW_INDEX_TEST_DISPOSABLE === "1" && Boolean(ownerUrl && runtimeUrl);
const migrations = resolve("server/schema-migrations");
let owner: Client;
let runtime: Client;
let runtimeRole: string;
const reference = "11111111-1111-4111-8111-111111111111";
const resume = "22222222-2222-4222-8222-222222222222";
const outbox = "44444444-4444-4444-8444-444444444444";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const pinnedTextSha256 = digest("PINNED TEXT");
const key = candidateIndexCommandKey({ tenant: "org_17", referenceId: reference,
  resumeVersionId: resume, sourceVersion: 1, contentSha256: "a".repeat(64),
  contentKind: "pinned_text", payloadSha256: pinnedTextSha256 });

function safeUrl(value: string): URL {
  const url = new URL(value);
  const socket = url.searchParams.get("host");
  if (process.env.NODE_ENV !== "test" || !/^flow_4d_test(?:_[a-z0-9_]+)?$/.test(url.pathname.slice(1))
      || !/^flow_4d_test_[a-z0-9_]+$/.test(url.username)
      || !(url.hostname === "127.0.0.1" || socket?.startsWith("/tmp/"))) {
    throw new Error("FLOW_INDEX_TEST_TARGET_REFUSED");
  }
  return url;
}

async function connect(url: string): Promise<Client> {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 2000 });
  await client.connect();
  return client;
}

async function seed(): Promise<void> {
  await owner.query(`INSERT INTO organizations(id,name,slug,is_active) VALUES(17,'Synthetic','index-fixture',true);
    INSERT INTO users(id,username,password,role,email_verified) VALUES(101,'index@example.invalid','x','candidate',true);
    INSERT INTO jobs(id,organization_id,title,location,type,description,original_jd,posted_by,is_active,status,slug)
      VALUES(1001,17,'Fixture','Remote','full-time','Fixture','Fixture',101,false,'pending','index-job');
    INSERT INTO applications(id,organization_id,job_id,user_id,name,email,phone,resume_url,resume_filename,status)
      VALUES(2001,17,1001,101,'Fixture','index@example.invalid','000','gs://fixture/resume.pdf','resume.pdf','submitted')`);
  await owner.query(`INSERT INTO organization_candidate_references
    (reference_id,organization_id,application_id,job_id,origin_code,schema_version,created_at)
    VALUES($1,17,2001,1001,'candidate_applied',1,clock_timestamp())`, [reference]);
  await owner.query(`INSERT INTO application_resume_versions
    (resume_version_id,reference_id,organization_id,application_id,job_id,version,source_kind,
     source_observed_at,gcs_locator,content_sha256,byte_count,media_type,extracted_text,extracted_text_sha256,captured_at,created_at)
    VALUES($1,$2,17,2001,1001,1,'direct_upload','2026-09-14T00:00:00Z','gs://fixture/resume.pdf',
      $3,11,'application/pdf','PINNED TEXT',$4,'2026-09-14T00:00:00Z',clock_timestamp())`,
  [resume, reference, "a".repeat(64), pinnedTextSha256]);
  await owner.query(`INSERT INTO organization_candidate_memory_outbox
    (outbox_id,reference_id,resume_version_id,organization_id,application_id,job_id,idempotency_key,
     next_attempt_at,created_at,updated_at)
    VALUES($1,$2,$3,17,2001,1001,$4,clock_timestamp(),clock_timestamp(),clock_timestamp())`,
  [randomUUID(), reference, resume, digest("4B fixture")]);
}

async function insertIntent(patches: { payload?: string; command?: string } = {}, client = runtime) {
  return client.query(`INSERT INTO candidate_index_outbox
    (outbox_id,organization_id,application_id,job_id,reference_id,resume_version_id,source_version,
     content_sha256,content_kind,payload_sha256,idempotency_key,captured_at)
    VALUES($1,17,2001,1001,$2,$3,1,$4,'pinned_text',$5,$6,'2026-09-14T00:00:00Z')`,
  [outbox, reference, resume, "a".repeat(64), patches.payload ?? pinnedTextSha256, patches.command ?? key]);
}
async function acknowledge4B() {
  await owner.query(`UPDATE organization_candidate_memory_outbox SET state='acknowledged',
    memory_candidate_id=$1,acknowledged_at=clock_timestamp() WHERE reference_id=$2`, [randomUUID(), reference]);
}
function barrier() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
async function legacyJob(status = "pending", attempts = 0): Promise<ApplicationGraphSyncJob> {
  const row = (await owner.query(`INSERT INTO application_graph_sync_jobs
    (application_id,organization_id,job_id,effective_recruiter_id,activekg_tenant_id,status,attempts)
    VALUES(2001,17,1001,101,'org_17',$1,$2) RETURNING id`, [status, attempts])).rows[0];
  return { id: row.id, applicationId: 2001, organizationId: 17, jobId: 1001,
    effectiveRecruiterId: 101, activekgTenantId: "org_17", status, attempts } as ApplicationGraphSyncJob;
}
const captureLegacy = () => runtime.query("SELECT flow_capture_candidate_index_catchup(17,$1,$2) id", [reference, resume]);
async function claim(client = runtime) {
  return (await client.query("SELECT * FROM flow_claim_candidate_index_delivery(8,60000)")).rows;
}
async function acknowledge(row: any, override: { key?: string; token?: string; payload?: string } = {}) {
  return (await runtime.query(`SELECT flow_ack_candidate_index_delivery($1,$2,$3,$4,$5,$6,$7,$8,$9) AS ok`,
    [row.outbox_id, override.token ?? row.lease_token, row.generation, override.key ?? key,
      reference, resume, override.payload ?? pinnedTextSha256, randomUUID(), digest("wire command")])).rows[0].ok;
}

describe.skipIf(!enabled)("candidate index delivery PostgreSQL authority", () => {
  beforeAll(async () => {
    const left = safeUrl(ownerUrl); const right = safeUrl(runtimeUrl);
    expect(left.pathname).toBe(right.pathname);
    expect(left.host).toBe(right.host);
    expect(left.searchParams.get("host")).toBe(right.searchParams.get("host"));
    expect(left.username).not.toBe(right.username);
    runtimeRole = right.username;
    owner = await connect(ownerUrl); runtime = await connect(runtimeUrl);
    legacy.pool = new Pool({ connectionString: runtimeUrl, max: 3, connectionTimeoutMillis: 2000 });
    for (const client of [owner, runtime]) {
      const result = await client.query(`SELECT current_database() AS db,current_user AS role,
        rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`);
      expect(result.rows[0].db).toBe(left.pathname.slice(1));
      expect(result.rows[0].rolsuper).toBe(false);
      expect(result.rows[0].rolbypassrls).toBe(false);
    }
    // This CI step starts with a genuinely empty database. Catchup needs the
    // real control identity before its first test, not one left behind by a
    // later release-proof case or a previous local run.
    if (!(await owner.query("SELECT to_regclass('schema_control.identity') AS relation")).rows[0].relation) {
      const released = await runReleaseMigration({ migrationsDir: migrations,
        creds: { migrateUrl: ownerUrl, expectedTargetId: "flow-4d-disposable",
          environment: "development", allowFreshInitialization: true },
        connect: () => connect(ownerUrl) });
      expect(released.applied).toEqual(loadManifest(migrations).map(entry => entry.version));
      await provisionRuntimeRole({ migrateUrl: ownerUrl, runtimeUrl, runtimeRole,
        expectedTargetId: "flow-4d-disposable", connectMigration: () => connect(ownerUrl),
        connectRuntime: () => connect(runtimeUrl) });
    }
  });
  beforeEach(async () => {
    await owner.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public AUTHORIZATION CURRENT_USER");
    for (const file of readdirSync(migrations).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort()) {
      await owner.query("BEGIN");
      try { await owner.query(readFileSync(resolve(migrations, file), "utf8")); await owner.query("COMMIT"); }
      catch (error) { await owner.query("ROLLBACK"); throw error; }
    }
    // Exact 4D permissions. The provisioner/reconciliation matrix separately
    // covers migration from broad application default grants.
    await owner.query(`GRANT USAGE ON SCHEMA public TO "${runtimeRole}";
      GRANT SELECT ON application_resume_versions TO "${runtimeRole}";
      GRANT INSERT ON candidate_index_outbox TO "${runtimeRole}"`);
    for (const signature of CANDIDATE_INDEX_FUNCTIONS) {
      await owner.query(`GRANT EXECUTE ON FUNCTION ${signature} TO "${runtimeRole}"`);
    }
    await seed();
    vi.resetAllMocks();
    vi.stubEnv("ACTIVEKG_TENANT_STRATEGY", "org_scoped");
    vi.stubEnv("ACTIVEKG_TENANT_PREFIX", "org");
    legacy.application.mockResolvedValue({ id: 2001, organizationId: 17, jobId: 1001,
      extractedResumeText: "Synthetic queued resume text used only in the disposable race proof. ".repeat(2),
      resumeUrl: null });
    legacy.admit.mockResolvedValue(undefined);
    legacy.read.mockResolvedValue(null);
    legacy.create.mockImplementation(async () => ({ id: randomUUID() }));
    legacy.edge.mockResolvedValue({});
    legacy.succeeded.mockImplementation(async jobId => {
      await owner.query("UPDATE application_graph_sync_jobs SET status='succeeded' WHERE id=$1", [jobId]);
    });
  });
  afterEach(() => { vi.unstubAllEnvs(); });
  afterAll(async () => { await legacy.pool?.end(); await runtime?.end(); await owner?.end(); });

  async function catchupFixture() {
    const ro = safeUrl(readonlyUrl).username;
    await owner.query(`GRANT USAGE ON SCHEMA public,schema_control TO "${ro}";
      GRANT SELECT ON schema_control.identity,application_resume_versions,applications,jobs,
        organization_candidate_references,organization_candidate_memory_outbox,application_graph_sync_jobs,
        candidate_index_outbox TO "${ro}"`);
    const readPool = new Pool({ connectionString: readonlyUrl, connectionTimeoutMillis: 2000 });
    const referenceId = "55555555-5555-4555-8555-555555555555", sourceId = "66666666-6666-4666-8666-666666666666";
    const bytes = Buffer.from("%PDF-1.4\nSynthetic catchup fixture\n%%EOF");
    await owner.query(`INSERT INTO applications(id,organization_id,job_id,user_id,name,email,phone,resume_url,resume_filename,status)
      VALUES(2002,17,1001,101,'Catchup','catchup@example.invalid','000','gs://fixture/catchup.pdf','catchup.pdf','submitted')`);
    await owner.query(`INSERT INTO organization_candidate_references
      (reference_id,organization_id,application_id,job_id,origin_code,schema_version,created_at)
      VALUES($1,17,2002,1001,'candidate_applied',1,clock_timestamp())`, [referenceId]);
    await owner.query(`INSERT INTO application_resume_versions
      (resume_version_id,reference_id,organization_id,application_id,job_id,version,source_kind,source_observed_at,
        gcs_locator,content_sha256,byte_count,media_type,extracted_text,extracted_text_sha256,captured_at,created_at)
      VALUES($1,$2,17,2002,1001,1,'direct_upload','2026-09-14T00:00:00Z','gs://fixture/catchup.pdf',
        $3,$4,'application/pdf','PINNED TEXT',$5,'2026-09-14T00:00:00Z',clock_timestamp())`,
    [sourceId, referenceId, createHash("sha256").update(bytes).digest("hex"), bytes.length, pinnedTextSha256]);
    await owner.query(`INSERT INTO organization_candidate_memory_outbox
      (outbox_id,reference_id,resume_version_id,organization_id,application_id,job_id,idempotency_key,state,
        memory_candidate_id,acknowledged_at,next_attempt_at,created_at,updated_at)
      VALUES($1,$2,$3,17,2002,1001,$4,'acknowledged',$5,clock_timestamp(),clock_timestamp(),clock_timestamp(),clock_timestamp())`,
    [randomUUID(), referenceId, sourceId, digest("catchup4B"), randomUUID()]);
    const posture = { flowTarget: (await owner.query("SELECT target_id FROM schema_control.identity WHERE singleton=true")).rows[0].target_id,
      memoryTarget: "memory-synthetic", flowTree: "a".repeat(40), memoryTree: "b".repeat(40), legacyWorkerTree: "a".repeat(40),
      policySha256: "c".repeat(64), mode: "private_primary" as const, running: true as const };
    const deps = { readPool, readRunningPosture: async () => posture, admit: vi.fn(async () => undefined),
      download: vi.fn(async () => bytes) };
    const directory = mkdtempSync(join(tmpdir(), "flow-catchup-pg-")), secret = Buffer.alloc(32, 11);
    vi.stubEnv("FLOW_CANDIDATE_INDEX_MODE", "private_primary");
    const census = () => censusApplicationCatchup({ cursor: resume, maxRows: 10, maxProviderAttempts: 50,
      lifetimeMs: 60_000, key: secret }, deps);
    const execute = (plan: unknown, writePool = legacy.pool!) => executeApplicationCatchup({ plan, key: secret,
      journalPath: join(directory, "journal"), operatorApproved: true, writePool }, deps);
    const close = async () => { await readPool.end(); rmSync(directory, { recursive: true, force: true }); };
    return { sourceId, referenceId, deps, census, execute, close, journalPath: join(directory, "journal") };
  }
  it("catchup uses a read-only census and the real definer once; retained evidence is unchanged on resume", async () => {
    const f = await catchupFixture();
    try {
      const before = (await owner.query("SELECT to_jsonb(r) evidence FROM application_resume_versions r WHERE resume_version_id=$1", [f.sourceId])).rows;
      const plan = await f.census(); expect(plan.entries).toHaveLength(1);
      expect((await owner.query("SELECT count(*)::int n FROM candidate_index_outbox")).rows[0].n).toBe(0);
      expect(await f.execute(plan)).toEqual({ captured: 1 });
      expect(await f.execute(plan)).toEqual({ captured: 1 });
      expect((await owner.query("SELECT resume_version_id,reference_id,application_id FROM candidate_index_outbox")).rows)
        .toEqual([{ resume_version_id: f.sourceId, reference_id: f.referenceId, application_id: 2002 }]);
      expect((await owner.query("SELECT to_jsonb(r) evidence FROM application_resume_versions r WHERE resume_version_id=$1", [f.sourceId])).rows).toEqual(before);
      expect((await f.census()).skipped).toEqual({ already_managed: 1 });
      await expect(runtime.query("SELECT * FROM candidate_index_outbox")).rejects.toMatchObject({ code: "42501" });
    } finally { await f.close(); }
  });
  it.each(["orphan", "unacknowledged", "missing_object", "uncertain", "changed_authority"])(
    "catchup explicitly skips %s live-substrate failure without adoption", async kind => {
      const f = await catchupFixture();
      try {
        const plan = await f.census();
        if (kind === "orphan") await owner.query("DELETE FROM applications WHERE id=2002");
        if (kind === "unacknowledged") await owner.query(`UPDATE organization_candidate_memory_outbox
          SET state='pending',acknowledged_at=NULL,memory_candidate_id=NULL WHERE application_id=2002`);
        if (kind === "missing_object") f.deps.download.mockRejectedValue(Error("object fixture missing"));
        if (kind === "uncertain") await owner.query(`INSERT INTO application_graph_sync_jobs
          (application_id,organization_id,job_id,effective_recruiter_id,activekg_tenant_id,status,attempts)
          VALUES(2002,17,1001,101,'org_17','succeeded',2)`);
        if (kind === "changed_authority") await owner.query("UPDATE applications SET email='changed@example.invalid' WHERE id=2002");
        const expected = { orphan: "source_orphaned", unacknowledged: "intake_unacknowledged", missing_object: "object_unavailable",
          uncertain: "legacy_uncertain", changed_authority: "source_mismatch" }[kind]!;
        expect(await f.execute(plan)).toEqual({ [expected]: 1 });
        expect((await owner.query("SELECT count(*)::int n FROM candidate_index_outbox")).rows[0].n).toBe(0);
      } finally { await f.close(); }
    });
  it("catchup rechecks the database fence after the census; a processing claimant is skipped", async () => {
    const f = await catchupFixture();
    try {
      const plan = await f.census();
      // Claim wins after the executor's final read, at its final privacy gate.
      let admits = 0;
      f.deps.admit.mockImplementation(async () => {
        if (++admits === 2) await owner.query(`INSERT INTO application_graph_sync_jobs
          (application_id,organization_id,job_id,effective_recruiter_id,activekg_tenant_id,status,attempts)
          VALUES(2002,17,1001,101,'org_17','processing',1)`);
      });
      expect(await f.execute(plan)).toEqual({ legacy_uncertain: 1 });
      expect((await owner.query("SELECT count(*)::int n FROM candidate_index_outbox")).rows[0].n).toBe(0);
    } finally { await f.close(); }
  });
  it("a real catchup commit followed by lost acknowledgement resumes without duplicate capture", async () => {
    const f = await catchupFixture();
    try {
      const plan = await f.census();
      const crashingPool = { connect: async () => {
        const c = await legacy.pool!.connect(), query = c.query.bind(c);
        return { on: c.on.bind(c), removeListener: c.removeListener.bind(c), release: c.release.bind(c),
          query: async (sql: string, values?: unknown[]) => {
            const result = await query(sql, values);
            if (sql === "COMMIT") throw Error("synthetic crash after actual commit");
            return result;
          } };
      } };
      await expect(executeApplicationCatchup({ plan, key: Buffer.alloc(32, 11), journalPath: f.journalPath,
        writePool: crashingPool, operatorApproved: true }, f.deps)).rejects.toThrow("candidate_index_catchup_refused");
      expect((await owner.query("SELECT count(*)::int n FROM candidate_index_outbox")).rows[0].n).toBe(1);
      expect(await f.execute(plan)).toEqual({ already_managed: 1 });
      expect((await owner.query("SELECT count(*)::int n FROM candidate_index_outbox")).rows[0].n).toBe(1);
    } finally { await f.close(); }
  });

  it("queued legacy write wins the race: catchup refuses while it is in flight, then adoption fences replay", async () => {
    vi.stubEnv("FLOW_CANDIDATE_INDEX_MODE", "private_primary");
    const job = await legacyJob("processing", 1);
    const inFlight = barrier(), complete = barrier();
    legacy.create.mockImplementationOnce(async () => {
      inFlight.release(); await complete.promise; return { id: randomUUID() };
    });
    const running = processLegacyJob(job);
    try {
      await Promise.race([inFlight.promise, running.then(() => { throw Error("legacy write never started"); })]);
      await expect(captureLegacy()).rejects.toMatchObject({ code: "55P03", message: "candidate_index_catchup_legacy_busy" });
      expect((await owner.query("SELECT count(*)::int n FROM candidate_index_outbox")).rows[0].n).toBe(0);
      expect(legacy.create).toHaveBeenCalledTimes(1);
    } finally { complete.release(); await running; }
    expect(legacy.succeeded).toHaveBeenCalledExactlyOnceWith(job.id, expect.any(String), 1);
    expect((await captureLegacy()).rows[0].id).toBeTruthy();
    const calls = legacy.create.mock.calls.length + legacy.read.mock.calls.length + legacy.edge.mock.calls.length;
    await expect(processLegacyJob(job)).rejects.toMatchObject({ code: "managed" });
    expect(legacy.create.mock.calls.length + legacy.read.mock.calls.length + legacy.edge.mock.calls.length).toBe(calls);
    expect(legacy.download).not.toHaveBeenCalled();
  });

  it("catchup wins against an already queued callback: uncommitted adoption is busy, committed adoption is managed", async () => {
    vi.stubEnv("FLOW_CANDIDATE_INDEX_MODE", "private_primary");
    const job = await legacyJob();
    const loaded = barrier(), proceed = barrier();
    const application = await legacy.application();
    legacy.application.mockImplementationOnce(async () => { loaded.release(); await proceed.promise; return application; });
    // This is the real queued worker entrypoint, paused after reading the source
    // but BEFORE its fence, not a synthetic predicate or timing-based sleep.
    const running = processLegacyJob(job).then(() => "unexpected", error => error.code);
    await loaded.promise;
    await runtime.query("BEGIN");
    try {
      expect((await captureLegacy()).rows[0].id).toBeTruthy();
      expect((await owner.query("SELECT count(*)::int n FROM candidate_index_outbox")).rows[0].n).toBe(0);
      proceed.release();
      expect(await running).toBe("busy");
      for (const call of [legacy.read, legacy.create, legacy.edge, legacy.download, legacy.succeeded, legacy.dead]) {
        expect(call).not.toHaveBeenCalled();
      }
      await runtime.query("COMMIT");
    } finally { proceed.release(); await running; await runtime.query("ROLLBACK"); }
    await expect(processLegacyJob(job)).rejects.toMatchObject({ code: "managed" });
    for (const call of [legacy.read, legacy.create, legacy.edge, legacy.download]) expect(call).not.toHaveBeenCalled();
    expect((await owner.query("SELECT status,attempts FROM application_graph_sync_jobs")).rows[0])
      .toEqual({ status: "pending", attempts: 0 });
  });

  it("a second queued claimant cannot write while a peer owns the legacy session", async () => {
    vi.stubEnv("FLOW_CANDIDATE_INDEX_MODE", "private_primary");
    const job = await legacyJob("processing", 1);
    const admitted = barrier(), proceed = barrier();
    legacy.admit.mockImplementationOnce(async () => { admitted.release(); await proceed.promise; });
    const running = processLegacyJob(job);
    try {
      await Promise.race([admitted.promise, running.then(() => { throw Error("legacy admission never started"); })]);
      await expect(processLegacyJob(job)).rejects.toMatchObject({ code: "busy" });
      expect(legacy.create).not.toHaveBeenCalled();
      expect(legacy.dead).not.toHaveBeenCalled();
      expect(legacy.succeeded).not.toHaveBeenCalled();
      expect((await owner.query("SELECT status,attempts FROM application_graph_sync_jobs")).rows[0])
        .toEqual({ status: "processing", attempts: 1 });
    } finally { proceed.release(); await running; }
  });

  it.each(["dual", "private_primary"])("retains eligible non-adopter legacy work in %s", async mode => {
    vi.stubEnv("FLOW_CANDIDATE_INDEX_MODE", mode);
    const job = await legacyJob("processing", 1);
    await processLegacyJob(job);
    expect(legacy.create).toHaveBeenCalledTimes(2);
    expect(legacy.edge).toHaveBeenCalledTimes(1);
    expect(legacy.admit).toHaveBeenCalledWith({ type: "application", id: 2001 }, { globalUse: true, newGlobalOperation: true });
    expect((await owner.query("SELECT count(*)::int n FROM candidate_index_outbox")).rows[0].n).toBe(0);
  });

  it("dual keeps the globally admitted bridge even for an adopted application", async () => {
    vi.stubEnv("FLOW_CANDIDATE_INDEX_MODE", "dual");
    const job = await legacyJob("processing", 1);
    await insertIntent();
    await processLegacyJob(job);
    expect(legacy.create).toHaveBeenCalledTimes(2);
    expect(legacy.edge).toHaveBeenCalledTimes(1);
    expect(legacy.succeeded).toHaveBeenCalledOnce();
  });

  it.each([
    ["pending", 0, true], ["succeeded", 1, true], ["privacy_restricted", 1, true],
    ["processing", 1, false], ["processing", 2, false], ["succeeded", 2, false],
    ["failed", 1, false], ["dead_letter", 1, false], ["pending", 1, false],
    ["succeeded", 0, false], ["pending", -1, false], ["unknown", 0, false],
  ])("catchup never infers quiescence from lease expiry: %s attempt %s", async (status, attempts, allowed) => {
    await legacyJob(status as string, attempts as number);
    await owner.query("UPDATE application_graph_sync_jobs SET updated_at=NOW()-interval '1 day'");
    if (allowed) expect((await captureLegacy()).rows[0].id).toBeTruthy();
    else await expect(captureLegacy()).rejects.toMatchObject({ code: "22023", message: "candidate_index_catchup_legacy_uncertain" });
    expect((await owner.query("SELECT count(*)::int n FROM candidate_index_outbox")).rows[0].n).toBe(allowed ? 1 : 0);
  });

  it("proves fresh and 4C-to-4D release, pre-reconciliation refusal, real provisioning and idempotency", async () => {
    const base = mkdtempSync(join(tmpdir(), "flow-index-base-"));
    const connector = async (url: string) => {
      const c = await connect(url);
      return { query: (sql: string, params?: readonly unknown[]) => c.query(sql, params as never), end: () => c.end() };
    };
    const target = "flow-4d-release-proof";
    const creds = { migrateUrl: ownerUrl, expectedTargetId: target,
      environment: "development" as const, allowFreshInitialization: true };
    const release = (dir = migrations) => runReleaseMigration({ migrationsDir: dir, creds, connect: () => connector(ownerUrl) });
    const reconcile = () => provisionRuntimeRole({ migrateUrl: ownerUrl, runtimeUrl, runtimeRole,
      expectedTargetId: target, connectMigration: connector, connectRuntime: connector });
    const ready = () => assertSchemaReady({ pg: runtime, migrationsDir: migrations,
      environment: "development", expectedTargetId: target, criticalPostconditions: FLOW_CRITICAL_POSTCONDITIONS });
    try {
      const lock = JSON.parse(readFileSync(resolve(migrations, "checksums.lock"), "utf8"));
      lock.migrations = Object.fromEntries(Object.entries(lock.migrations).filter(([version]) => Number(version) < 12));
      for (const entry of loadManifest(migrations).filter(entry => Number(entry.version) < 12)) {
        copyFileSync(resolve(migrations, entry.file), join(base, entry.file));
      }
      copyFileSync(resolve(migrations, "catalog.lock.json"), join(base, "catalog.lock.json"));
      writeFileSync(join(base, "checksums.lock"), JSON.stringify(lock));
      for (const upgrade of [false, true]) {
        await owner.query("DROP SCHEMA IF EXISTS schema_control CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public AUTHORIZATION CURRENT_USER");
        if (upgrade) {
          expect((await release(base)).applied).toHaveLength(12);
          await reconcile();
        }
        expect((await release()).applied).toEqual(upgrade ? ["0012", "0013"] : loadManifest(migrations).map(entry => entry.version));
        await expect(ready()).rejects.toThrow();
        await expect(reconcile()).resolves.toEqual({ controlPlaneReady: true });
        await expect(ready()).resolves.toEqual({ version: "0013", applied: 14 });
        expect((await release()).applied).toEqual([]);
        await expect(ready()).resolves.toEqual({ version: "0013", applied: 14 });
        expect((await owner.query("SELECT count(*)::int n FROM candidate_index_outbox")).rows[0].n).toBe(0);
        expect((await owner.query("SELECT count(*)::int n FROM users")).rows[0].n).toBe(0);
      }
    } finally { rmSync(base, { recursive: true, force: true }); }
  }, 120_000);

  it.skipIf(!readonlyUrl)("proves a distinct read-only verifier has no writes, TEMP or routine execution", async () => {
    const url = safeUrl(readonlyUrl);
    expect(url.pathname).toBe(safeUrl(ownerUrl).pathname);
    expect(url.host).toBe(safeUrl(ownerUrl).host);
    expect(url.username).not.toBe(runtimeRole);
    expect(url.username).not.toBe(safeUrl(ownerUrl).username);
    await owner.query(`GRANT USAGE ON SCHEMA public TO "${url.username}";
      GRANT SELECT ON candidate_index_outbox,candidate_index_delivery_state TO "${url.username}"`);
    const ro = await connect(readonlyUrl);
    try {
      expect((await ro.query("SHOW transaction_read_only")).rows[0].transaction_read_only).toBe("on");
      const posture = (await ro.query(`SELECT rolsuper,rolbypassrls,rolcreaterole,rolcreatedb,rolinherit,
        has_database_privilege(current_user,current_database(),'TEMP') AS temp,
        (SELECT count(*)::int FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=current_user)) AS memberships
        FROM pg_roles WHERE rolname=current_user`)).rows[0];
      expect(posture).toEqual({ rolsuper:false,rolbypassrls:false,rolcreaterole:false,rolcreatedb:false,rolinherit:false,temp:false,memberships:0 });
      expect((await ro.query("SELECT count(*)::int n FROM candidate_index_outbox")).rows[0].n).toBe(0);
      await ro.query("SET default_transaction_read_only=off");
      await expect(ro.query("UPDATE candidate_index_delivery_state SET state='terminal'")).rejects.toMatchObject({ code: "42501" });
      await expect(ro.query("CREATE TEMP TABLE forbidden(id integer)")).rejects.toMatchObject({ code: "42501" });
      for (const signature of CANDIDATE_INDEX_FUNCTIONS) {
        expect((await ro.query("SELECT has_function_privilege(current_user,$1,'EXECUTE') ok", [signature])).rows[0].ok).toBe(false);
      }
      await expect(ro.query("SELECT * FROM flow_claim_candidate_index_delivery(1,60000)")).rejects.toMatchObject({ code: "42501" });
    } finally { await ro.end(); }
  });

  it("keeps sparse pending state, no SELECT grant, and waits for the exact 4B acknowledgement", async () => {
    await insertIntent();
    expect((await owner.query("SELECT count(*)::int n FROM candidate_index_delivery_state")).rows[0].n).toBe(0);
    await expect(runtime.query("SELECT * FROM candidate_index_outbox")).rejects.toMatchObject({ code: "42501" });
    await expect(runtime.query("SELECT 1 FROM organization_candidate_memory_outbox LIMIT 0")).rejects.toMatchObject({ code: "42501" });
    expect(await claim()).toHaveLength(0);
    await acknowledge4B();
    const rows = await claim(); expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outbox_id: outbox, attempt: 1, generation: "1", idempotency_key: key });
    expect(await claim()).toHaveLength(0);
    expect(await acknowledge(rows[0])).toBe(true);
    expect(await acknowledge(rows[0])).toBe(false);
    expect((await owner.query("SELECT state FROM candidate_index_delivery_state")).rows[0].state).toBe("accepted");
  });
  it("pins the exact columns, constraints, indexes, triggers and routine bodies", async () => {
    expect((await owner.query(CANDIDATE_INDEX_CATALOG_SQL)).rows[0].digest).toBe(CANDIDATE_INDEX_CATALOG_SHA256);
    expect(await candidateIndexPrivilegesReady(runtime, runtimeRole, true)).toBe(true);
  });
  it.each([false, true])("runs processor claim/source/settlement under the real restricted role (unreachable=%s)", async unreachable => {
    await owner.query(`GRANT SELECT ON applications,jobs TO "${runtimeRole}"`);
    await expect(runtime.query("SELECT 1 FROM organization_candidate_memory_outbox LIMIT 0")).rejects.toMatchObject({ code: "42501" });
    await insertIntent();
    let calls = 0; let admissions = 0;
    const options = { db: runtime, admit: async () => { admissions += 1; },
      deliver: async (input: Parameters<typeof deliverCandidateIndex>[0]) => {
        await input.beforeAttempt(); calls += 1;
        if (unreachable) throw new CandidateIndexMemoryError("network");
        return { outcome: "accepted" as const, idempotency_key: input.envelope.idempotency_key,
          reference_id: reference, resume_version_id: resume, source_id: randomUUID(),
          command_digest: candidateIndexCommandDigest(input.envelope, "org_17") };
      } };
    const config = { mode: "dual" as const, timeoutMs: 10000, leaseMs: 60000, pollMs: 1000, claimLimit: 8 };
    expect(await runCandidateIndexProcessorOnce(config, options)).toBe(0);
    expect(calls).toBe(0); expect(admissions).toBe(0);
    await acknowledge4B();
    expect(await runCandidateIndexProcessorOnce(config, options)).toBe(1);
    expect(calls).toBe(1); expect(admissions).toBe(2);
    const state = (await owner.query("SELECT state,attempts,generation,lease_token,accepted_source_id FROM candidate_index_delivery_state")).rows[0];
    expect(state).toMatchObject({ state: unreachable ? "retry_wait" : "accepted", attempts: 1,
      generation: "1", lease_token: null });
    if (unreachable) expect(state.accepted_source_id).toBeNull();
    else expect(state.accepted_source_id).toMatch(/^[0-9a-f-]{36}$/);
    await expect(runtime.query("SELECT * FROM candidate_index_outbox")).rejects.toMatchObject({ code: "42501" });
  });
  it("reconciles broad migration defaults and accidental column grants through the real provisioner", async () => {
    await owner.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON candidate_index_outbox,candidate_index_delivery_state TO "${runtimeRole}";
      GRANT UPDATE(state) ON candidate_index_delivery_state TO "${runtimeRole}";
      GRANT EXECUTE ON FUNCTION flow_candidate_index_evidence_guard() TO "${runtimeRole}"`);
    expect(await candidateIndexPrivilegesReady(runtime, runtimeRole, true)).toBe(false);
    const connector = async (url: string) => {
      const client = await connect(url);
      return { query: (sql: string, params?: readonly unknown[]) => client.query(sql, params as never), end: () => client.end() };
    };
    await provisionRuntimeRole({ migrateUrl: ownerUrl, runtimeUrl, runtimeRole,
      expectedTargetId: "flow-4d-disposable", connectMigration: connector, connectRuntime: connector });
    expect(await candidateIndexPrivilegesReady(runtime, runtimeRole, true)).toBe(true);
  });
  it("refuses effective column grants, PUBLIC execute, changed definitions and missing constraints", async () => {
    expect(await candidateIndexPrivilegesReady(runtime, runtimeRole, true)).toBe(true);
    const changes = [
      `GRANT SELECT(outbox_id) ON candidate_index_outbox TO "${runtimeRole}"`,
      "GRANT EXECUTE ON FUNCTION flow_claim_candidate_index_delivery(integer,integer) TO PUBLIC",
      "ALTER TABLE candidate_index_outbox DROP CONSTRAINT candidate_index_outbox_content_kind",
      "ALTER TABLE candidate_index_outbox ADD COLUMN unexpected text",
      "ALTER TABLE candidate_index_outbox ALTER COLUMN captured_at DROP NOT NULL",
      "ALTER FUNCTION flow_claim_candidate_index_delivery(integer,integer) SET search_path=public,pg_catalog",
      "DROP INDEX candidate_index_outbox_due_idx",
      "DROP TRIGGER candidate_index_outbox_no_mutation ON candidate_index_outbox",
    ];
    for (const change of changes) {
      await owner.query("BEGIN");
      try {
        await owner.query(change);
        expect(await candidateIndexPrivilegesReady(owner, runtimeRole, true)).toBe(false);
      } finally { await owner.query("ROLLBACK"); }
      expect(await candidateIndexPrivilegesReady(runtime, runtimeRole, true)).toBe(true);
    }
  });
  it("pins the PostgreSQL key with a real text digest, not spaced JSON text", async () => {
    const row = (await runtime.query("SELECT flow_capture_candidate_index_catchup(17,$1,$2) id", [reference, resume])).rows[0];
    expect(row.id).toBeTruthy();
    expect((await owner.query("SELECT idempotency_key FROM candidate_index_outbox")).rows[0].idempotency_key)
      .toBe("c2c48bef26a8962af24597e6c50500627a931e9bc113f23cae728f3f26685a2a");
    expect(key).toBe("c2c48bef26a8962af24597e6c50500627a931e9bc113f23cae728f3f26685a2a");
    expect((await runtime.query("SELECT flow_capture_candidate_index_catchup(17,$1,$2) id", [reference, resume])).rows[0].id)
      .toBe(row.id);
    await expect(runtime.query("SELECT flow_capture_candidate_index_catchup(18,$1,$2)", [reference, resume]))
      .rejects.toMatchObject({ code: "22023" });
  });
  it("refuses source/key substitution at insertion, including the owner", async () => {
    await expect(insertIntent({ payload: "c".repeat(64) })).rejects.toMatchObject({ code: "23514" });
    await expect(insertIntent({ command: "c".repeat(64) }, owner)).rejects.toMatchObject({ code: "23514" });
    expect((await owner.query("SELECT count(*)::int n FROM candidate_index_outbox")).rows[0].n).toBe(0);
  });
  it("validates same-statement source visibility and rolls all five writes back on a bad intent", async () => {
    const newReference = randomUUID(); const newResume = randomUUID();
    const newKey = candidateIndexCommandKey({ tenant: "org_17", referenceId: newReference,
      resumeVersionId: newResume, sourceVersion: 1, contentSha256: "a".repeat(64),
      contentKind: "pinned_text", payloadSha256: pinnedTextSha256 });
    const statement = `WITH a AS (
      INSERT INTO applications(id,organization_id,job_id,user_id,name,email,phone,resume_url,resume_filename,status)
      VALUES(2002,17,1001,101,'Fixture','cte@example.invalid','000','gs://fixture/cte.pdf','cte.pdf','submitted') RETURNING id
    ), r AS (
      INSERT INTO organization_candidate_references(reference_id,organization_id,application_id,job_id,origin_code,schema_version,created_at)
      SELECT $1,17,a.id,1001,'candidate_applied',1,clock_timestamp() FROM a RETURNING reference_id,application_id
    ), v AS (
      INSERT INTO application_resume_versions(resume_version_id,reference_id,organization_id,application_id,job_id,
        version,source_kind,source_observed_at,gcs_locator,content_sha256,byte_count,media_type,
        extracted_text,extracted_text_sha256,captured_at,created_at)
      SELECT $2,r.reference_id,17,r.application_id,1001,1,'direct_upload','2026-09-14T00:00:00Z',
        'gs://fixture/cte.pdf',$3,11,'application/pdf','PINNED TEXT',$4,'2026-09-14T00:00:00Z',clock_timestamp()
      FROM r RETURNING resume_version_id,reference_id,application_id
    ), b AS (
      INSERT INTO organization_candidate_memory_outbox(outbox_id,reference_id,resume_version_id,organization_id,
        application_id,job_id,idempotency_key,next_attempt_at,created_at,updated_at)
      SELECT $5,v.reference_id,v.resume_version_id,17,v.application_id,1001,$6,
        clock_timestamp(),clock_timestamp(),clock_timestamp() FROM v RETURNING 1
    ), i AS (
      INSERT INTO candidate_index_outbox(outbox_id,organization_id,application_id,job_id,reference_id,resume_version_id,
        source_version,content_sha256,content_kind,payload_sha256,idempotency_key,captured_at)
      SELECT $7,17,v.application_id,1001,v.reference_id,v.resume_version_id,1,$3,'pinned_text',$4,$8,
        '2026-09-14T00:00:00Z' FROM v CROSS JOIN b RETURNING 1
    ) SELECT count(*)::int n FROM i`;
    for (const invalid of [true, false]) {
      await owner.query("BEGIN");
      try {
        const result = owner.query(statement, [newReference, newResume, "a".repeat(64), pinnedTextSha256,
          randomUUID(), digest("cte 4B"), randomUUID(), invalid ? "c".repeat(64) : newKey]);
        if (invalid) await expect(result).rejects.toMatchObject({ code: "23514" });
        else expect((await result).rows[0].n).toBe(1);
      } finally { await owner.query("ROLLBACK"); }
      expect((await owner.query("SELECT count(*)::int n FROM applications WHERE id=2002")).rows[0].n).toBe(0);
      expect((await owner.query("SELECT count(*)::int n FROM candidate_index_outbox")).rows[0].n).toBe(0);
      expect((await owner.query("SELECT count(*)::int n FROM organization_candidate_references")).rows[0].n).toBe(1);
      expect((await owner.query("SELECT count(*)::int n FROM application_resume_versions")).rows[0].n).toBe(1);
      expect((await owner.query("SELECT count(*)::int n FROM organization_candidate_memory_outbox")).rows[0].n).toBe(1);
    }
  });
  it("makes expired, wrong-token and identity-mismatched ack/fail allocation-free", async () => {
    await insertIntent(); await acknowledge4B(); const [first] = await claim();
    expect(await acknowledge(first, { token: randomUUID() })).toBe(false);
    expect(await acknowledge(first, { key: "c".repeat(64) })).toBe(false);
    expect(await acknowledge(first, { payload: "c".repeat(64) })).toBe(false);
    await owner.query("UPDATE candidate_index_delivery_state SET lease_expires_at=clock_timestamp()-interval '1 second'");
    expect(await acknowledge(first)).toBe(false);
    expect((await runtime.query("SELECT flow_fail_candidate_index_delivery($1,$2,$3,'timeout',0) ok",
      [first.outbox_id, first.lease_token, first.generation])).rows[0].ok).toBe(false);
    const [second] = await claim(); expect(second.generation).toBe("2"); expect(second.attempt).toBe(2);
    expect(second.lease_token).not.toBe(first.lease_token); expect(await acknowledge(first)).toBe(false);
    expect(await acknowledge(second)).toBe(true);
  });
  it("serializes simultaneous sparse-state claims across independent connections", async () => {
    await insertIntent(); await acknowledge4B(); const other = await connect(runtimeUrl);
    await runtime.query("BEGIN");
    try {
      expect(await claim()).toHaveLength(1);
      expect(await claim(other)).toHaveLength(0);
      await runtime.query("COMMIT");
      expect(await claim(other)).toHaveLength(0);
    } finally { await runtime.query("ROLLBACK"); await other.end(); }
  });
  it("persists exhaustion on the claim sweep after eight crash-after-claim attempts", async () => {
    await insertIntent(); await acknowledge4B();
    for (let attempt = 1; attempt <= 8; attempt++) {
      expect((await claim())[0].attempt).toBe(attempt);
      await owner.query("UPDATE candidate_index_delivery_state SET lease_expires_at=clock_timestamp()-interval '1 second'");
    }
    expect(await claim()).toHaveLength(0);
    expect((await owner.query("SELECT state,attempts,error_code FROM candidate_index_delivery_state")).rows[0])
      .toEqual({ state: "terminal", attempts: 8, error_code: "attempts_exhausted" });
  });
  it("retries transient delivery errors and keeps erasure-class refusals terminal", async () => {
    await insertIntent(); await acknowledge4B(); const [first] = await claim();
    expect((await runtime.query("SELECT flow_fail_candidate_index_delivery($1,$2,$3,'privacy_unavailable',0) ok",
      [first.outbox_id, first.lease_token, first.generation])).rows[0].ok).toBe(true);
    const [second] = await claim(); expect(second.attempt).toBe(2);
    await runtime.query("SELECT flow_fail_candidate_index_delivery($1,$2,$3,'privacy_restricted',0)",
      [second.outbox_id, second.lease_token, second.generation]);
    expect(await claim()).toHaveLength(0);
    expect((await owner.query("SELECT state FROM candidate_index_delivery_state")).rows[0].state).toBe("privacy_restricted");
  });
  it("does not dispatch removed or moved applications", async () => {
    await insertIntent(); await acknowledge4B(); await owner.query("DELETE FROM applications WHERE id=2001");
    expect(await claim()).toHaveLength(0);
    expect((await owner.query("SELECT error_code FROM candidate_index_delivery_state")).rows[0].error_code).toBe("source_missing");
    await expect(runtime.query("SELECT flow_capture_candidate_index_catchup(17,$1,$2)", [reference, resume]))
      .rejects.toMatchObject({ code: "22023" });
  });
  it("preserves append-only evidence and gives the runtime no direct mutable-state authority", async () => {
    await insertIntent();
    for (const statement of ["UPDATE candidate_index_outbox SET created_at=clock_timestamp()",
      "DELETE FROM candidate_index_outbox", "TRUNCATE candidate_index_delivery_state,candidate_index_outbox"]) {
      await expect(owner.query(statement)).rejects.toMatchObject({ code: "55000" });
      await expect(runtime.query(statement)).rejects.toMatchObject({ code: "42501" });
    }
    for (const statement of ["SELECT * FROM candidate_index_delivery_state",
      "INSERT INTO candidate_index_delivery_state(outbox_id,state) VALUES($1,'retry_wait')",
      "UPDATE candidate_index_delivery_state SET state='terminal'", "DELETE FROM candidate_index_delivery_state"]) {
      await expect(runtime.query(statement, statement.includes("$1") ? [outbox] : []))
        .rejects.toMatchObject({ code: "42501" });
    }
    expect((await runtime.query("SELECT flow_candidate_index_managed_application(17,2001) ok")).rows[0].ok).toBe(true);
    expect((await runtime.query("SELECT flow_candidate_index_managed_application(18,2001) ok")).rows[0].ok).toBe(false);
    const options = { db: runtime, env: { FLOW_CANDIDATE_INDEX_MODE: "private_primary" } };
    expect(await shouldEnqueueLegacyApplication(17, 2001, options)).toBe(false);
    expect(await shouldEnqueueLegacyApplication(18, 2001, options)).toBe(true);
    expect(await shouldEnqueueLegacyApplication(17, 2002, options)).toBe(true);
    expect(await shouldEnqueueLegacyApplication(17, 2001, { db: runtime, env: { FLOW_CANDIDATE_INDEX_MODE: "dual" } })).toBe(true);
  });
  it.each([[0, 60000], [9, 60000], [1, 10000], [1, 300001], [null, 60000]])(
    "refuses unbounded/null claims (%s,%s)", async (limit, lease) => {
      await expect(runtime.query("SELECT * FROM flow_claim_candidate_index_delivery($1,$2)", [limit, lease]))
        .rejects.toMatchObject({ code: "22023" });
    },
  );
});
