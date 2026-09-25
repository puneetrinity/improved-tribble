// SQL boundary proof only; the real Flow route/Memory process proof is separate.
import { randomInt, randomUUID } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { historyContext } from "../contracts";
import { runReleaseMigration } from "../../schema-control/runner";
import { loadManifest } from "../../schema-control/manifest";
import { provisionRuntimeRole } from "../../schema-control/runtimeRole";

const dsn = process.env.FLOW_HISTORY_TEST_OWNER_URL ?? "";
const enabled = process.env.FLOW_HISTORY_TEST_DISPOSABLE === "1" && Boolean(dsn);

describe.skipIf(!enabled)("history exact 4D-to-4E release", () => {
  it("preserves thirteen ledger rows, reconciles, and repeats without writes", async () => {
    const runtimeUrl = process.env.FLOW_HISTORY_TEST_RUNTIME_URL!;
    const ownerTarget = new URL(dsn), runtimeTarget = new URL(runtimeUrl);
    expect(ownerTarget.hostname).toBe("127.0.0.1");
    expect(ownerTarget.pathname).toBe("/flow_4d_test_fresh");
    expect(ownerTarget.username).toBe("flow_4d_test_owner");
    expect(runtimeTarget.host + runtimeTarget.pathname).toBe(ownerTarget.host + ownerTarget.pathname);
    expect(runtimeTarget.username).toBe("flow_4d_test_runtime");
    const migrations = resolve("server/schema-migrations");
    const base = mkdtempSync(join(tmpdir(), "flow-history-base-"));
    const owner = new Client({ connectionString: dsn });
    const runtime = new Client({ connectionString: runtimeUrl });
    await owner.connect(); await runtime.connect();
    const connector = async (url: string) => {
      const c = new Client({ connectionString: url }); await c.connect();
      return { query: (sql: string, params?: readonly unknown[]) => c.query(sql, params as never), end: () => c.end() };
    };
    const target = "flow-4e-release-proof";
    const release = (dir: string) => runReleaseMigration({ migrationsDir: dir,
      creds: { migrateUrl: dsn, expectedTargetId: target, environment: "development", allowFreshInitialization: true },
      connect: () => connector(dsn) });
    try {
      const lock = JSON.parse(readFileSync(join(migrations, "checksums.lock"), "utf8"));
      lock.migrations = Object.fromEntries(Object.entries(lock.migrations).filter(([v]) => Number(v) < 13));
      for (const entry of loadManifest(migrations).filter(e => Number(e.version) < 13)) {
        copyFileSync(join(migrations, entry.file), join(base, entry.file));
      }
      copyFileSync(join(migrations, "catalog.lock.json"), join(base, "catalog.lock.json"));
      writeFileSync(join(base, "checksums.lock"), JSON.stringify(lock));
      await owner.query("DROP SCHEMA IF EXISTS schema_control CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public AUTHORIZATION CURRENT_USER");
      expect((await release(base)).applied).toHaveLength(13);
      const before = (await owner.query("SELECT row_to_json(m) AS value FROM schema_control.applied m ORDER BY version")).rows;
      expect((await release(migrations)).applied).toEqual(["0013"]);
      expect((await owner.query("SELECT row_to_json(m) AS value FROM schema_control.applied m WHERE version<'0013' ORDER BY version")).rows).toEqual(before);
      expect((await owner.query("SELECT count(*)::int AS n FROM decision_events")).rows[0].n).toBe(0);
      await provisionRuntimeRole({ migrateUrl: dsn, runtimeUrl, runtimeRole: runtimeTarget.username,
        expectedTargetId: target, connectMigration: connector, connectRuntime: connector });
      await runtime.query("BEGIN READ ONLY");
      expect((await runtime.query("SELECT flow_read_candidate_history_context(1,1,1) AS value")).rows[0].value).toBeNull();
      await runtime.query("ROLLBACK");
      await expect(runtime.query("SELECT * FROM decision_projection_outbox")).rejects.toMatchObject({ code: "42501" });
      expect((await release(migrations)).applied).toEqual([]);
    } finally {
      await owner.end(); await runtime.end(); rmSync(base, { recursive: true, force: true });
    }
  }, 120_000);
});
describe.skipIf(!enabled)("keyed history SQL reader", () => {
  let db: Client;
  let id: number;
  let reference: string;
  beforeAll(async () => {
    const url = new URL(dsn);
    const database = url.pathname.endsWith("_test") || url.pathname === "/flow_4d_test_fresh";
    const role = url.username.endsWith("_test") || url.username === "flow_4d_test_owner";
    if (url.hostname !== "127.0.0.1" || !database || !role) {
      throw Error("HISTORY_DISPOSABLE_TARGET_REQUIRED");
    }
    db = new Client({ connectionString: dsn, connectionTimeoutMillis: 2000 });
    await db.connect();
    const attributes = await db.query("SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user");
    expect(attributes.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });
  afterAll(async () => { await db?.end(); });
  beforeEach(async () => {
    id = randomInt(100000, 1000000000); reference = randomUUID();
    await db.query("BEGIN");
    await db.query("SET LOCAL statement_timeout='3s'");
    await db.query("INSERT INTO organizations(id,name,slug,is_active) VALUES($1,'Synthetic',$2,true)", [id, `history-${id}`]);
    await db.query("INSERT INTO users(id,username,password,role,email_verified) VALUES($1,$2,'unusable','candidate',true)", [id, `history-${id}@example.invalid`]);
    await db.query(`INSERT INTO jobs(id,organization_id,title,location,type,description,original_jd,posted_by,is_active,status,slug)
      VALUES($1,$1,'Fixture','Remote','full-time','Fixture','Fixture',$1,false,'pending',$2)`, [id, `history-job-${id}`]);
    await db.query(`INSERT INTO applications(id,organization_id,job_id,user_id,name,email,phone,resume_url,resume_filename,status)
      VALUES($1,$1,$1,$1,'Fixture',$2,'000','gs://fixture/resume.pdf','resume.pdf','submitted')`, [id, `history-${id}@example.invalid`]);
  });
  afterEach(async () => { await db.query("ROLLBACK"); });
  async function read(org = id, app = id, job = id) {
    const result = await db.query("SELECT flow_read_candidate_history_context($1,$2,$3) AS context", [org, app, job]);
    return result.rows[0].context;
  }
  async function bind(ack = false) {
    const resume = randomUUID();
    await db.query(`INSERT INTO organization_candidate_references
      (reference_id,organization_id,application_id,job_id,origin_code,schema_version,created_at)
      VALUES($1,$2,$2,$2,'candidate_applied',1,clock_timestamp())`, [reference, id]);
    await db.query(`INSERT INTO application_resume_versions
      (resume_version_id,reference_id,organization_id,application_id,job_id,version,source_kind,
       source_observed_at,gcs_locator,content_sha256,byte_count,media_type,captured_at,created_at)
      VALUES($1,$2,$3,$3,$3,1,'direct_upload',clock_timestamp(),'gs://fixture/resume.pdf',$4,11,
        'application/pdf',clock_timestamp(),clock_timestamp())`, [resume, reference, id, "a".repeat(64)]);
    await db.query(`INSERT INTO organization_candidate_memory_outbox
      (outbox_id,reference_id,resume_version_id,organization_id,application_id,job_id,idempotency_key,next_attempt_at,created_at,updated_at)
      VALUES($1,$2,$3,$4,$4,$4,$5,clock_timestamp(),clock_timestamp(),clock_timestamp())`,
      [randomUUID(), reference, resume, id, "b".repeat(64)]);
    if (ack) await db.query(`UPDATE organization_candidate_memory_outbox SET state='acknowledged',
      memory_candidate_id=$1,acknowledged_at=clock_timestamp() WHERE reference_id=$2`, [randomUUID(), reference]);
  }
  it("does not invent private lineage for a legacy application", async () => {
    expect(await read()).toEqual({ status: "outside_private_history_scope" });
  });
  it("requires acknowledged private intake", async () => {
    await bind(); expect(await read()).toEqual({ status: "awaiting_binding" });
  });
  it("represents no captured events without claiming complete history", async () => {
    await bind(true);
    const result = historyContext.parse(await read());
    expect(result.status).toBe("bound");
    if (result.status !== "bound") throw Error("expected bound");
    expect(result.captured).toEqual({ count: "0", event_id: null, sequence: null });
    expect(result.capture_gap).toBe(false); expect(result.delivery_status).toBe("no_capture");
  });
  it("refuses a forged organization, application or job tuple", async () => {
    await bind(true);
    expect(await read(id + 1)).toBeNull();
    expect(await read(id, id + 1)).toBeNull();
    expect(await read(id, id, id + 1)).toBeNull();
  });
  it("has no public execute authority", async () => {
    const result = await db.query(`SELECT count(*)::integer AS grants FROM pg_proc p,
      LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      WHERE p.oid='flow_read_candidate_history_context(integer,integer,integer)'::regprocedure
        AND a.grantee=0 AND a.privilege_type='EXECUTE'`);
    expect(result.rows[0].grants).toBe(0);
  });
});
