// Default résumé on real PostgreSQL: one default per candidate under concurrent uploads and
// make-default calls, and an insert failure never removes the existing default.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../../../shared/schema";
import { runReleaseMigration, type MigrationClient } from "../../schema-control/runner";
import { insertLibraryResume, makeLibraryResumeDefault, removeLibraryResume } from "../candidateResumeDefault";
import { SOURCE_CATALOG_SQL, sourcePrivilegesReady } from "../../schema-control/readiness";
import { provisionRuntimeRole } from "../../schema-control/runtimeRole";
import { SOURCE_RUNTIME_FUNCTIONS } from "../../candidate-product/source-repository";
import { canonicalProfileJson } from "../../candidate-product/profile-contracts";
import { RESUME_UNMATCHED_NOTE, RESUME_UNREADABLE_NOTE } from "../../../shared/resume-review-notes";
import { createHash, randomUUID } from "node:crypto";

const url = (process.env.FLOW_SCHEMA_TEST_DATABASE_URL ?? "").trim();
const enabled = process.env.FLOW_RESUME_DEFAULT_TEST_DISPOSABLE === "1" && Boolean(url);
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "schema-migrations");
let pool: Pool | undefined; let db: any; let owner: Client | undefined;

async function client(): Promise<Client> { const c = new Client({ connectionString: url, connectionTimeoutMillis: 2_000 }); await c.connect(); return c; }
async function connect(): Promise<MigrationClient> { const c = await client(); return { query: (t, p) => c.query(t, p as any), end: () => c.end() }; }
const defaults = async (userId: number) => (await owner!.query("SELECT id FROM candidate_resumes WHERE user_id=$1 AND is_default ORDER BY id", [userId])).rows.map(r => r.id);
const count = async (userId: number) => Number((await owner!.query("SELECT count(*) n FROM candidate_resumes WHERE user_id=$1", [userId])).rows[0].n);
const resume = (userId: number, n: number, requestDefault = false) => ({ userId, label: `cv${n}`, gcsPath: `gs://synthetic/${userId}/${n}`, extractedText: "", requestDefault });

describe.skipIf(!enabled)("default résumé on PostgreSQL", () => {
  beforeAll(async () => {
    if (process.env.NODE_ENV !== "test") throw new Error("requires NODE_ENV=test");
    const parsed = new URL(url);
    const local = parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]" || Boolean(parsed.searchParams.get("host")?.startsWith("/"));
    if (!local || !parsed.pathname.includes("_test")) throw new Error("Refusing: not a local disposable *_test database.");
    const c = await client();
    try {
      await c.query("DROP SCHEMA IF EXISTS schema_control CASCADE"); await c.query("DROP SCHEMA IF EXISTS public CASCADE");
      await c.query("CREATE SCHEMA public AUTHORIZATION CURRENT_USER");
    } finally { await c.end(); }
    await runReleaseMigration({ migrationsDir, connect,
      creds: { migrateUrl: url, expectedTargetId: "flow-resume-default-test-target", environment: "development", allowFreshInitialization: true } });
    owner = await client();
    await owner.query(`INSERT INTO users (id,username,password,role,email_verified) VALUES
      (901,'a@example.invalid','x','candidate',true),(902,'b@example.invalid','x','candidate',true),(903,'c@example.invalid','x','candidate',true),(904,'d@example.invalid','x','candidate',true),
      (905,'e@example.invalid','x','candidate',true),(906,'f@example.invalid','x','candidate',true)`);
    pool = new Pool({ connectionString: url, max: 8 }); db = drizzle(pool, { schema });
  }, 120_000);
  afterAll(async () => { await owner?.end(); await pool?.end(); });

  it("concurrent first uploads leave exactly one default", async () => {
    await Promise.all([1, 2, 3].map(n => insertLibraryResume(db, resume(901, n))));
    expect(await count(901)).toBe(3);
    expect(await defaults(901)).toHaveLength(1);
  });

  it("removal detaches source history, preserves application snapshots, frees a slot and keeps a default", async () => {
    const first = await insertLibraryResume(db, resume(905, 10));
    await insertLibraryResume(db, resume(905, 12));
    await insertLibraryResume(db, resume(905, 13));
    const source = (await owner!.query(`INSERT INTO candidate_source_objects
      (user_id,resume_id,source_version,content_hash,byte_length,media_type,policy_version,gcs_path,gcs_generation,original_versions)
      VALUES(905,$1,1,repeat('a',64),100,'application/pdf','test',$2,'1','{}') RETURNING source_id`, [first.id, first.gcsPath])).rows[0].source_id;
    const job = (await owner!.query("INSERT INTO jobs(title,location,type,description,posted_by,status) VALUES('Synthetic','Remote','full-time','Test',901,'pending') RETURNING id")).rows[0].id;
    const app = (await owner!.query(`INSERT INTO applications(job_id,user_id,name,email,phone,resume_url,extracted_resume_text,resume_id)
      VALUES($1,905,'Synthetic','test@example.invalid','0',$2,'unchanged application text',$3) RETURNING id`, [job, first.gcsPath, first.id])).rows[0].id;
    const before = await count(905);
    expect(await removeLibraryResume(db, 902, first.id)).toBe(false);
    expect(await removeLibraryResume(db, 905, first.id)).toBe(true);
    expect(await count(905)).toBe(before - 1);
    expect((await owner!.query('SELECT resume_id,restricted,gcs_path FROM candidate_source_objects WHERE source_id=$1',[source])).rows[0])
      .toEqual({ resume_id: null, restricted: true, gcs_path: first.gcsPath });
    expect((await owner!.query('SELECT resume_id,resume_url,extracted_resume_text FROM applications WHERE id=$1',[app])).rows[0])
      .toEqual({ resume_id: null, resume_url: first.gcsPath, extracted_resume_text: 'unchanged application text' });
    expect(await defaults(905)).toHaveLength(1);
    await insertLibraryResume(db, resume(905, 11));
    expect(await count(905)).toBe(before);
    expect(await removeLibraryResume(db, 905, first.id)).toBe(false);
  });

  it("library read results are owner scoped, exclude uncertain budget outcomes and reflect the latest attempt", async () => {
    const r = await insertLibraryResume(db, resume(906, 15));
    await owner!.query("SELECT flow_candidate_foundation_ensure(id,auth_version,encode(sha256(convert_to(password,'UTF8')),'hex'),clock_timestamp(),gen_random_uuid()) FROM users WHERE id=906");
    const source = (await owner!.query(`INSERT INTO candidate_source_objects
      (user_id,resume_id,source_version,content_hash,byte_length,media_type,policy_version,gcs_path,gcs_generation,original_versions)
      VALUES(906,$1,1,repeat('a',64),100,'application/pdf','test',$2,'1','{}') RETURNING source_id`, [r.id,r.gcsPath])).rows[0].source_id;
    const command = (await owner!.query(`INSERT INTO candidate_source_jobs(user_id,source_id,subject_id,binding_id,consent_revision,admitted_auth_version,state,reason)
      SELECT user_id,$1,subject_id,binding_id,1,0,'unavailable','empty' FROM candidate_product_accounts WHERE user_id=906 RETURNING command_id`,[source])).rows[0].command_id;
    const status = async (id: number) => (await owner!.query('SELECT flow_candidate_source_library_status($1) result',[id])).rows[0].result;
    expect(await status(906)).toContainEqual({resumeId:r.id,readFailed:true});
    expect(await status(901)).not.toContainEqual({resumeId:r.id,readFailed:true});
    await owner!.query("UPDATE candidate_source_jobs SET reason='budget_unavailable' WHERE command_id=$1",[command]);
    expect(await status(906)).toContainEqual({resumeId:r.id,readFailed:false});
    await owner!.query(`INSERT INTO candidate_source_jobs(user_id,source_id,subject_id,binding_id,consent_revision,admitted_auth_version,state,created_at)
      SELECT user_id,source_id,subject_id,binding_id,1,0,'queued',created_at+interval '1 second' FROM candidate_source_jobs WHERE command_id=$1`,[command]);
    expect(await status(906)).toContainEqual({resumeId:r.id,readFailed:false});
    console.log('CA10 source catalogue digest', (await owner!.query(SOURCE_CATALOG_SQL,['postgres',[...SOURCE_RUNTIME_FUNCTIONS]])).rows[0].digest);
  });

  it("ONB-2: unreadable or unmatched reads stay labelled after cleanup; genuine empty does not; a later good read clears it", async () => {
    const sha = (v: string) => createHash("sha256").update(v, "utf8").digest("hex");
    await owner!.query("INSERT INTO users (id,username,password,role,email_verified) VALUES (907,'g@example.invalid','x','candidate',true)");
    await owner!.query("SELECT flow_candidate_foundation_ensure(id,auth_version,encode(sha256(convert_to(password,'UTF8')),'hex'),clock_timestamp(),gen_random_uuid()) FROM users WHERE id=907");
    const acct = (await owner!.query("SELECT subject_id,binding_id FROM candidate_product_accounts WHERE user_id=907")).rows[0];
    const library = async (n: number) => {
      const r = await insertLibraryResume(db, resume(907, n));
      const sourceId = (await owner!.query(`INSERT INTO candidate_source_objects
        (user_id,resume_id,source_version,content_hash,byte_length,media_type,policy_version,gcs_path,gcs_generation,original_versions)
        VALUES(907,$1,1,repeat('a',64),100,'application/pdf','test',$2,'1','{}') RETURNING source_id`, [r.id, r.gcsPath])).rows[0].source_id;
      return { resumeId: r.id as number, sourceId: sourceId as string };
    };
    // Drives the real finish routine: a leased job holding a stored transfer, then the receiver's "stored" receipt.
    const read = async (sourceId: string, facts: unknown[], reviewNotes: string[]) => {
      const commandId = randomUUID(), claimToken = randomUUID(), proposalId = randomUUID(), proposalHash = sha(proposalId);
      const transfer = JSON.stringify({ commandId, subjectId: acct.subject_id, bindingId: acct.binding_id, sourceId, sourceVersion: 1,
        proposal: { proposalId, proposalHash, facts, reviewNotes } });
      await owner!.query(`INSERT INTO candidate_source_jobs(command_id,user_id,source_id,subject_id,binding_id,consent_revision,admitted_auth_version,
        state,lease_token,lease_until,generation,transfer_document) VALUES($1,907,$2,$3,$4,1,0,'transferring',$5,clock_timestamp()+interval '1 minute',1,$6)`,
        [commandId, sourceId, acct.subject_id, acct.binding_id, claimToken, JSON.stringify({ canonical: transfer, sha256: sha(transfer) })]);
      const receipt = canonicalProfileJson({ schemaVersion: 1, commandId, subjectId: acct.subject_id, bindingId: acct.binding_id, commandHash: sha(transfer),
        sourceId, sourceVersion: 1, proposalId, proposalHash, outcome: "stored", reason: null, canonicalProfileChanged: false, publicationActive: false });
      const status = (await owner!.query("SELECT flow_candidate_source_transfer_finish($1,$2) result",
        [JSON.stringify({ commandId, claimToken, generation: 1 }), JSON.stringify({ canonical: receipt, sha256: sha(receipt) })])).rows[0].result;
      expect(status.state).toBe("review_ready");
      return commandId;
    };
    const failed = async (resumeId: number) =>
      ((await owner!.query("SELECT flow_candidate_source_library_status(907) result")).rows[0].result as { resumeId: number; readFailed: boolean }[])
        .find(x => x.resumeId === resumeId)!.readFailed;
    const fact = { factId: randomUUID(), kind: "skill", targetRowId: null, value: "Kafka", evidence: [] };
    const unreadable = await library(20), unmatched = await library(21), nothingNew = await library(22);
    const unreadableJob = await read(unreadable.sourceId, [], [RESUME_UNREADABLE_NOTE]);
    await read(unmatched.sourceId, [], [RESUME_UNMATCHED_NOTE, "A note from the résumé reader."]);
    await read(nothingNew.sourceId, [], []);
    expect([await failed(unreadable.resumeId), await failed(unmatched.resumeId), await failed(nothingNew.resumeId)]).toEqual([true, true, false]);
    // Only a coarse value is stored for the read, never the notes or proposal.
    expect((await owner!.query("SELECT read_outcome FROM candidate_source_jobs WHERE command_id=$1", [unreadableJob])).rows[0].read_outcome).toBe("unreadable");
    // The real cleanup removes the proposal and receipt; the label stays.
    await owner!.query("UPDATE candidate_source_jobs SET acknowledged_at=clock_timestamp()-interval '8 days' WHERE user_id=907");
    await owner!.query("SELECT flow_candidate_source_redact_due()");
    expect(Number((await owner!.query("SELECT count(*) n FROM candidate_source_jobs WHERE user_id=907 AND (transfer_document IS NOT NULL OR payload_redacted_at IS NULL)")).rows[0].n)).toBe(0);
    expect([await failed(unreadable.resumeId), await failed(unmatched.resumeId), await failed(nothingNew.resumeId)]).toEqual([true, true, false]);
    // A later read that kept a fact clears it (a normal read is never labelled).
    await read(unreadable.sourceId, [fact], []);
    expect(await failed(unreadable.resumeId)).toBe(false);
    // An older read with no recorded outcome stays unknown: not labelled.
    await owner!.query("UPDATE candidate_source_jobs SET read_outcome=NULL WHERE source_id=$1", [unmatched.sourceId]);
    expect(await failed(unmatched.resumeId)).toBe(false);
    // Removing a library file hides its status; nothing else is touched.
    await owner!.query("UPDATE candidate_source_jobs SET read_outcome='unmatched' WHERE source_id=$1", [unmatched.sourceId]);
    await removeLibraryResume(db, 907, unmatched.resumeId);
    expect(((await owner!.query("SELECT flow_candidate_source_library_status(907) result")).rows[0].result as { resumeId: number }[])
      .some(x => x.resumeId === unmatched.resumeId)).toBe(false);
    console.log('ONB-2 source catalogue digest', (await owner!.query(SOURCE_CATALOG_SQL,['postgres',[...SOURCE_RUNTIME_FUNCTIONS]])).rows[0].digest);
  });

  it("make-default racing an upload leaves exactly one default, owned by the candidate", async () => {
    const first = await insertLibraryResume(db, resume(902, 1));
    const second = await insertLibraryResume(db, resume(902, 2));
    expect(await defaults(902)).toEqual([first.id]);
    await Promise.all([makeLibraryResumeDefault(db, 902, second.id), insertLibraryResume(db, resume(902, 3))]);
    expect(await defaults(902)).toEqual([second.id]);
    // Someone else's résumé is never made default.
    expect(await makeLibraryResumeDefault(db, 901, second.id)).toBe(false);
    expect(await defaults(902)).toEqual([second.id]);
  });

  it("an insert that fails keeps the candidate's existing default", async () => {
    const first = await insertLibraryResume(db, resume(903, 1));
    // gcs_path is NOT NULL: the insert fails inside the same transaction, after defaults were cleared.
    await expect(insertLibraryResume(db, { ...resume(903, 2, true), userId: 903, gcsPath: null as never })).rejects.toThrow();
    expect(await defaults(903)).toEqual([first.id]);
  });

  it("a later upload stays non-default unless asked; asking moves the default", async () => {
    const first = await insertLibraryResume(db, resume(904, 1));
    const later = await insertLibraryResume(db, resume(904, 2));
    expect(later.isDefault).toBe(false);
    const asked = await insertLibraryResume(db, resume(904, 3, true));
    expect(await defaults(904)).toEqual([asked.id]);
    expect(first.isDefault).toBe(true);
  });

  it("the real provisioner grants only the status routine; restricted removal still fences private history", async () => {
    const runtimeRole = 'flow_schema_control_test_ca10_runtime';
    const runtimeUrl = new URL(url); runtimeUrl.username = runtimeRole; runtimeUrl.password = 'synthetic-local-only';
    const open = async (u: string) => { const c = new Client({connectionString:u}); await c.connect(); return {query:(q:string,p?:any[])=>c.query(q,p),end:()=>c.end()}; };
    await provisionRuntimeRole({ migrateUrl:url, runtimeUrl:runtimeUrl.toString(), runtimeRole,
      expectedTargetId:'flow-resume-default-test-target', connectMigration:open, connectRuntime:open });
    const app = new Client({connectionString:runtimeUrl.toString()}); await app.connect();
    try {
      expect(await sourcePrivilegesReady(app,runtimeRole,true)).toBe(true);
      await expect(app.query('SELECT * FROM candidate_source_objects')).rejects.toMatchObject({code:'42501'});
      expect((await app.query("SELECT has_function_privilege(current_user,'flow_candidate_source_library_remove()','EXECUTE') allowed")).rows[0].allowed).toBe(false);
      expect((await app.query('SELECT flow_candidate_source_library_status(906) result')).rows[0].result).toHaveLength(1);
      const r = (await owner!.query('SELECT id FROM candidate_resumes WHERE user_id=906')).rows[0].id;
      expect(await removeLibraryResume(drizzle(app,{schema}),906,r)).toBe(true);
      expect((await owner!.query('SELECT resume_id,restricted FROM candidate_source_objects WHERE user_id=906')).rows[0]).toEqual({resume_id:null,restricted:true});
    } finally {await app.end();}
  });
});
