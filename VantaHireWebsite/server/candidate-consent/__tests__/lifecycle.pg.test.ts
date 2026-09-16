// Real 0011 release, restricted runtime and capture/delivery functions. Local disposable targets only.
import { randomUUID, generateKeyPairSync } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, Pool } from "pg";
import { runReleaseMigration } from "../../schema-control/runner";
import { provisionRuntimeRole } from "../../schema-control/runtimeRole";
import { candidateConsentPrivilegesReady, CANDIDATE_CONSENT_CONSTRAINTS } from "../../schema-control/readiness";
import { loadManifest } from "../../schema-control/manifest";
import { grantRequestSchema, sha256, CONSENT_COPY_SHA256 } from "../contracts";

const ownerUrl = process.env.FLOW_SCHEMA_TEST_DATABASE_URL ?? "";
const runtimeUrl = process.env.FLOW_SCHEMA_TEST_RUNTIME_DATABASE_URL ?? "";
const enabled = process.env.FLOW_AUTHZ_TEST_DISPOSABLE === "1" && !!ownerUrl && !!runtimeUrl;
const directory = fileURLToPath(new URL("../../schema-migrations/", import.meta.url));
const targetId = "flow-candidate-consent-test-target";
let owner: Client;
let runtime: Pool;
let repository: typeof import("../repository");
let database: typeof import("../../db");
const connect = async (url: string) => { const c = new Client({ connectionString: url }); await c.connect();
  return { query: (sql: string, params?: unknown[]) => c.query(sql, params), end: () => c.end() }; };
const provision = () => provisionRuntimeRole({ migrateUrl: ownerUrl, runtimeUrl, runtimeRole: new URL(runtimeUrl).username,
  expectedTargetId: targetId, connectMigration: () => connect(ownerUrl), connectRuntime: () => connect(runtimeUrl) });
const authority = (userId: number) => ({ userId, authVersion: 1, passwordVersion: sha256("local-only-password"),
  reauthenticatedAt: Date.now() });
const grant = (expected_version = 0) => grantRequestSchema.parse({ expected_version, request_id: randomUUID(),
  purpose: "platform_professional_matching", copy_version: 1, copy_sha256: CONSENT_COPY_SHA256,
  profile: { display_name: "Approved fixture", headline: "Approved headline", location: "", skills: [], linkedin: null },
  resume_version_id: null });
async function candidate(): Promise<number> {
  return (await owner.query(`INSERT INTO users(username,password,role,email_verified,first_name,last_name)
    VALUES($1,'local-only-password','candidate',true,'Consent','Fixture') RETURNING id`,
  [`${randomUUID()}@fixture.invalid`])).rows[0].id;
}
async function counts() {
  return (await owner.query(`SELECT (SELECT count(*)::int FROM candidate_consent_subjects) subjects,
    (SELECT count(*)::int FROM candidate_consent_sources) sources,
    (SELECT count(*)::int FROM candidate_consent_events) events,
    (SELECT count(*)::int FROM candidate_consent_outbox) intents`)).rows[0];
}
async function claim(eventId: string, lease = 1000) {
  return (await runtime.query("SELECT * FROM flow_claim_candidate_consent_outbox('test',1,$1,$2)",
    [lease, eventId])).rows[0];
}
function receipt(row: any, action: "grant" | "withdraw") {
  return { subject_id: row.subject_id, event_id: row.event_id, version: Number(row.version),
    idempotency_key: row.idempotency_key, command_digest: row.command_sha256,
    outcome: action === "grant" ? "granted" : "withdrawn", effective_version: Number(row.version), effective_action: action };
}

async function privateApplication(userId: number, saved = false) {
  const { storage } = await import("../../storage");
  const { pinPrivateResumeEvidence, appendOrganizationCandidateApplicationEvidence } = await import("../../organization-candidates/application-intake");
  const organizationId = (await owner.query(`INSERT INTO organizations(name,slug) VALUES('Fixture',$1) RETURNING id`,
    [randomUUID()])).rows[0].id;
  const jobId = (await owner.query(`INSERT INTO jobs(organization_id,title,location,type,description,posted_by,status)
    VALUES($1,'Fixture','Remote','full-time','Fixture',$2,'pending') RETURNING id`, [organizationId,userId])).rows[0].id;
  const email = (await owner.query("SELECT username FROM users WHERE id=$1", [userId])).rows[0].username;
  const library = saved ? (await owner.query(`INSERT INTO candidate_resumes(user_id,label,gcs_path,updated_at)
    VALUES($1,'Fixture','gs://fixture/consent.pdf',$2) RETURNING id,updated_at`,[userId,new Date()])).rows[0] : null;
  const evidence = pinPrivateResumeEvidence({ bytes: Buffer.from("fixture-only-resume"), filename: "fixture.pdf",
    gcsLocator: "gs://fixture/consent.pdf", sourceKind: saved ? "saved_resume" : "direct_upload", sourceResumeId: library?.id ?? null,
    sourceObservedAt: new Date(), extractedText: null, capturedAt: new Date() });
  return database.db.transaction(async tx => {
    const application = await storage.createApplication({ jobId, organizationId, userId, email,
      name: "Fixture", phone: "", resumeUrl: evidence.gcsLocator, status: "submitted" }, tx,
    { admission: "organization_private" });
    const ids = await appendOrganizationCandidateApplicationEvidence({ executor: tx as any, organizationId,
      jobId, applicationId: application.id, evidence, expectedSavedResumeUpdatedAt: library?.updated_at ?? null });
    return { ...ids, applicationId: application.id, organizationId, jobId, libraryId: library?.id ?? null };
  });
}

async function acknowledgePrivate(ids: Awaited<ReturnType<typeof privateApplication>>) {
  const row = (await runtime.query("SELECT * FROM claim_organization_candidate_memory_intents('consent-test',10,30000)"))
    .rows.find(r => r.outbox_id === ids.outboxId);
  expect(row).toBeTruthy();
  expect((await runtime.query("SELECT ack_organization_candidate_memory_intent($1,$2,$3) ok",
    [ids.outboxId, row.generation, randomUUID()])).rows[0].ok).toBe(true);
}

describe.skipIf(!enabled)("candidate consent restricted PostgreSQL lifecycle", () => {
  beforeAll(async () => {
    for (const value of [ownerUrl, runtimeUrl]) {
      const u = new URL(value);
      if (process.env.NODE_ENV !== "test" || !["127.0.0.1", "[::1]"].includes(u.hostname)
        || !u.pathname.includes("_test")) throw new Error("candidate_consent_disposable_refused");
    }
    if (new URL(ownerUrl).username === new URL(runtimeUrl).username) throw new Error("distinct_roles_required");
    owner = new Client({ connectionString: ownerUrl }); await owner.connect();
    await owner.query("DROP SCHEMA IF EXISTS schema_control CASCADE");
    await owner.query("DROP SCHEMA public CASCADE");
    await owner.query("CREATE SCHEMA public AUTHORIZATION CURRENT_USER");
    const result = await runReleaseMigration({ migrationsDir: directory,
      creds: { migrateUrl: ownerUrl, expectedTargetId: targetId, environment: "development", allowFreshInitialization: true },
      connect: () => connect(ownerUrl) });
    expect(result.applied).toHaveLength(loadManifest(directory).length);
    expect(result.applied.at(-1)).toBe(loadManifest(directory).at(-1)!.version);
    if(process.env.FLOW_CONSENT_REQUIRE_FRESH_RUNTIME==="1") {
      expect((await owner.query("SELECT 1 FROM pg_roles WHERE rolname=$1",[new URL(runtimeUrl).username])).rows).toHaveLength(0);
      await expect(candidateConsentPrivilegesReady(owner,new URL(runtimeUrl).username,true)).rejects.toMatchObject({code:"42704"});
    }else expect(await candidateConsentPrivilegesReady(owner, new URL(runtimeUrl).username, true)).toBe(false);
    await provision();
    runtime = new Pool({ connectionString: runtimeUrl, max: 10 });
    process.env.DATABASE_URL = runtimeUrl;
    process.env.DATABASE_SSL = "false";
    process.env.EMAIL_AUTOMATION_ENABLED = "false";
    process.env.PGPOOL_MAX = "10";
    database = await import("../../db");
    repository = await import("../repository");
    await owner.query(`INSERT INTO candidate_privacy_sync_state(consumer_name,status,last_success_at)
      VALUES('flow','healthy',clock_timestamp()) ON CONFLICT(consumer_name) DO UPDATE
      SET status='healthy',last_success_at=clock_timestamp()`);
  }, 60000);
  afterAll(async () => { await database?.pool.end(); await runtime?.end(); await owner?.end(); });

  it("reconciles exact effective privileges without exposing the 4B/outbox tables", async () => {
    expect(await candidateConsentPrivilegesReady(runtime, new URL(runtimeUrl).username, true)).toBe(true);
    for (const table of ["candidate_consent_outbox", "organization_candidate_memory_outbox"]) {
      await expect(runtime.query(`SELECT * FROM ${table}`)).rejects.toMatchObject({ code: "42501" });
    }
    expect((await runtime.query(`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`)).rows[0])
      .toEqual({ rolsuper: false, rolbypassrls: false });
    await expect(runtime.query("UPDATE candidate_consent_subjects SET user_id=1")).rejects.toMatchObject({ code: "42501" });
    await expect(runtime.query("DELETE FROM candidate_consent_sources")).rejects.toMatchObject({ code: "42501" });
    await expect(runtime.query("TRUNCATE candidate_consent_events")).rejects.toMatchObject({ code: "42501" });
    const before = await counts();
    expect((await runtime.query("SELECT flow_candidate_consent_resume_ready($1,$2) ready", [1, randomUUID()])).rows[0].ready).toBe(false);
    expect((await runtime.query("SELECT flow_candidate_consent_resume_ready(NULL,NULL) ready")).rows[0].ready).toBe(false);
    expect(await counts()).toEqual(before);
  });
  it("A2 repeats actual reconciliation without changing restricted role attributes", async () => {
    // The local locked rehearsal sets this; the retained CI owner is separately privileged.
    if (process.env.FLOW_CONSENT_REQUIRE_NON_SUPER_OWNER === "1") {
      expect((await owner.query("SELECT rolsuper,rolcreaterole FROM pg_roles WHERE rolname=current_user")).rows[0])
        .toEqual({ rolsuper: false, rolcreaterole: true });
    }
    for (let n = 0; n < 2; n++) {
      await provision();
      const client = new Client({ connectionString: runtimeUrl }); await client.connect();
      try {
        expect((await client.query(`SELECT rolcanlogin,rolinherit,rolsuper,rolcreatedb,rolcreaterole,
          rolreplication,rolbypassrls FROM pg_roles WHERE rolname=current_user`)).rows[0]).toEqual({
          rolcanlogin: true, rolinherit: false, rolsuper: false, rolcreatedb: false,
          rolcreaterole: false, rolreplication: false, rolbypassrls: false,
        });
        expect(await candidateConsentPrivilegesReady(client, new URL(runtimeUrl).username, true)).toBe(true);
      } finally { await client.end(); }
    }
  });
  it("A2 rejects a CREATEROLE caller lacking ADMIN OPTION and rolls back before grants", async () => {
    const role = `consent_noadmin_${randomUUID().replaceAll("-", "")}`;
    const statements: string[] = [];
    const before = await counts();
    await owner.query(`CREATE ROLE "${role}" CREATEROLE`);
    try {
      await owner.query(`GRANT "${role}" TO CURRENT_USER WITH SET TRUE`);
      await expect(provisionRuntimeRole({ migrateUrl: ownerUrl, runtimeUrl, runtimeRole: new URL(runtimeUrl).username,
        expectedTargetId: targetId, connectRuntime: () => connect(runtimeUrl), connectMigration: async () => {
          const c = new Client({ connectionString: ownerUrl }); await c.connect();
          await c.query(`SET ROLE "${role}"`);
          return { end: () => c.end(), query: async (query: string, params?: unknown[]) => {
            statements.push(query); return c.query(query, params);
          } };
        } })).rejects.toMatchObject({ code: "42501" });
      expect(statements).toContain("ROLLBACK");
      expect(statements).not.toContain("COMMIT");
      expect(statements.some(statement => statement.startsWith("GRANT "))).toBe(false);
      expect(await counts()).toEqual(before);
      expect(await candidateConsentPrivilegesReady(runtime, new URL(runtimeUrl).username, true)).toBe(true);
    } finally { await owner.query(`DROP ROLE "${role}"`); }
  });
  it("serializes concurrent first grants and replays before expected-version conflict", async () => {
    const id = await candidate(); const request = grant(); const auth = authority(id);
    const results = await Promise.all([repository.captureConsent("grant", request, auth), repository.captureConsent("grant", request, auth)]);
    expect(new Set(results.map(r => r.eventId)).size).toBe(1);
    expect(results.filter(r => r.replayed)).toHaveLength(1);
    const before = await counts();
    await expect(repository.captureConsent("grant", { ...request, profile: { ...request.profile, headline: "Changed" } }, auth))
      .rejects.toMatchObject({ code: "candidate_consent_request_conflict" });
    await expect(repository.captureConsent("grant", grant(), auth)).rejects.toMatchObject({ code: "candidate_consent_version_conflict" });
    expect(await counts()).toEqual(before);
    const state = await repository.getConsentStatus(id);
    expect(state).toMatchObject({ version: 1, delivery_status: "pending", effective: null, publication_active: false });
  });
  it.each(["missing", "stale", "unhealthy"])("refuses %s privacy sync before any consent insert", async kind => {
    const id = await candidate(); const before = await counts();
    // The shipped helper reads a separate connection. Use committed, valid sync states;
    // restoration also runs if arranging the fixture fails (no poisoned transaction).
    try {
      await owner.query(kind === "missing" ? "UPDATE candidate_privacy_sync_state SET last_success_at=NULL" : kind === "stale"
        ? "UPDATE candidate_privacy_sync_state SET last_success_at=clock_timestamp()-interval '121 seconds'"
        : "UPDATE candidate_privacy_sync_state SET status='needs_reconciliation'");
      await expect(repository.captureConsent("grant", grant(), authority(id)))
      .rejects.toMatchObject({ code: "candidate_privacy_review_required" }); expect(await counts()).toEqual(before); }
    finally { await owner.query("UPDATE candidate_privacy_sync_state SET status='healthy',last_success_at=clock_timestamp()"); }
  });
  it("rolls subject/source/event back when the intent insert fails", async () => {
    const id = await candidate(); const before = await counts();
    const injected = { query: runtime.query.bind(runtime), connect: async () => {
      const c = await runtime.connect(); return { release: () => c.release(), query: async (sql: string, values?: unknown[]) => {
        if (sql.startsWith("INSERT INTO public.candidate_consent_outbox")) throw new Error("injected_intent_failure");
        return c.query(sql, values);
      } }; } };
    await expect(repository.captureConsent("grant", grant(), authority(id), injected)).rejects.toThrow("injected_intent_failure");
    expect(await counts()).toEqual(before);
  });
  it("protects append-only source/event and immutable subject binding as owner too", async () => {
    const id = await candidate(); await repository.captureConsent("grant", grant(), authority(id));
    await expect(owner.query("UPDATE candidate_consent_subjects SET user_id=user_id+10000 WHERE user_id=$1", [id]))
      .rejects.toMatchObject({ code: "55000" });
    for (const table of ["candidate_consent_sources", "candidate_consent_events"]) {
      await expect(owner.query(`UPDATE ${table} SET subject_id=subject_id`)).rejects.toMatchObject({ code: "55000" });
      await expect(owner.query(`DELETE FROM ${table}`)).rejects.toMatchObject({ code: "55000" });
      await expect(owner.query(`TRUNCATE ${table} CASCADE`)).rejects.toMatchObject({ code: "55000" });
    }
  });
  it("fences wrong/null generation and malformed/null acknowledgements", async () => {
    const id = await candidate(); const event = await repository.captureConsent("grant", grant(), authority(id));
    const row = await claim(event.eventId, 30000); const good = receipt(row, "grant");
    for (const generation of [null, row.generation + 1]) expect((await runtime.query(
      "SELECT flow_ack_candidate_consent_outbox($1,$2,$3) ok", [row.outbox_id, generation, good])).rows[0].ok).toBe(false);
    for (const key of ["subject_id", "event_id", "version", "idempotency_key", "command_digest", "outcome", "effective_version", "effective_action"]) {
      await expect(runtime.query("SELECT flow_ack_candidate_consent_outbox($1,$2,$3)",
        [row.outbox_id, row.generation, { ...good, [key]: null }])).rejects.toThrow();
    }
    expect((await runtime.query("SELECT flow_ack_candidate_consent_outbox($1,$2,$3) ok", [row.outbox_id, row.generation, good])).rows[0].ok).toBe(true);
    expect(await repository.getConsentStatus(id)).toMatchObject({ effective: { action: "grant", version: 1 }, delivery_status: "delivered" });
  });
  it("withdrawal overtakes a leased grant and an old ack never reactivates it", async () => {
    const id = await candidate(); const event = await repository.captureConsent("grant", grant(), authority(id));
    const old = await claim(event.eventId, 30000);
    const withdrawn = await repository.captureConsent("withdraw", { request_id: randomUUID(), expected_version: 1 }, authority(id));
    const current = await claim(withdrawn.eventId, 30000);
    expect(current.version).toBe("2");
    expect((await runtime.query("SELECT flow_ack_candidate_consent_outbox($1,$2,$3) ok", [old.outbox_id, old.generation, receipt(old, "grant")])).rows[0].ok).toBe(false);
    expect((await runtime.query("SELECT flow_fail_candidate_consent_outbox($1,$2,'network',true,clock_timestamp()) ok", [old.outbox_id, old.generation])).rows[0].ok).toBe(false);
    expect((await runtime.query("SELECT flow_ack_candidate_consent_outbox($1,$2,$3) ok", [current.outbox_id, current.generation, receipt(current, "withdraw")])).rows[0].ok).toBe(true);
    expect(await repository.getConsentStatus(id)).toMatchObject({ version: 2, effective: { action: "withdraw", version: 2 }, delivery_status: "delivered" });
  });
  it("readiness rejects widened column grants and missing helper EXECUTE, reconciliation restores", async () => {
    const role = new URL(runtimeUrl).username;
    for (const statement of [`GRANT SELECT(event_id) ON candidate_consent_outbox TO ${role}`,
      `GRANT UPDATE(user_id) ON candidate_consent_subjects TO ${role}`,
      `REVOKE EXECUTE ON FUNCTION flow_candidate_consent_resume_ready(integer,uuid) FROM ${role}`]) {
      await owner.query(statement);
      expect(await candidateConsentPrivilegesReady(runtime, role, true)).toBe(false);
      await provision();
      expect(await candidateConsentPrivilegesReady(runtime, role, true)).toBe(true);
    }
  });
  it("pins every named constraint and rejects missing, renamed or widened source checks", async () => {
    expect(CANDIDATE_CONSENT_CONSTRAINTS).toHaveLength(58);
    expect(CANDIDATE_CONSENT_CONSTRAINTS.every(c => Buffer.byteLength(c[1]) <= 63)).toBe(true);
    const definition = (await owner.query(`SELECT pg_get_constraintdef(oid) definition FROM pg_constraint
      WHERE conrelid='candidate_consent_sources'::regclass AND conname='consent_source_profile_shape'`)).rows[0].definition;
    for (const variant of ["missing", "renamed", "widened"]) {
      await owner.query("BEGIN");
      try {
        await owner.query("ALTER TABLE candidate_consent_sources DROP CONSTRAINT consent_source_profile_shape");
        if (variant !== "missing") await owner.query(`ALTER TABLE candidate_consent_sources ADD CONSTRAINT
          ${variant === "renamed" ? "renamed_consent_shape" : "consent_source_profile_shape"}
          ${variant === "widened" ? "CHECK (true)" : definition}`);
        expect(await candidateConsentPrivilegesReady(owner, new URL(runtimeUrl).username, true)).toBe(false);
      } finally { await owner.query("ROLLBACK"); }
    }
    expect(await candidateConsentPrivilegesReady(runtime, new URL(runtimeUrl).username, true)).toBe(true);
  });
  it("A1 grants only acknowledged, owned immutable private versions without reading the 4B outbox", async () => {
    const id = await candidate(), stranger = await candidate(); const ids = await privateApplication(id);
    const request = { ...grant(), resume_version_id: ids.resumeVersionId };
    const before = await counts();
    await expect(repository.captureConsent("grant", request, authority(id)))
      .rejects.toMatchObject({ code: "candidate_consent_source_pending" });
    expect(await counts()).toEqual(before);
    expect((await repository.listConsentSources(id,25,null)).sources).toEqual([]);
    await acknowledgePrivate(ids);
    const resume = await repository.ownedResume(runtime,id,ids.resumeVersionId,false);
    expect(resume).toMatchObject({ resume_version_id: ids.resumeVersionId, reference_id: ids.referenceId,
      organization_id: ids.organizationId, application_id: ids.applicationId });
    await expect(repository.captureConsent("grant", request, authority(stranger)))
      .rejects.toMatchObject({ code: "candidate_consent_source_not_found" });
    await owner.query("UPDATE applications SET user_id=NULL WHERE id=$1",[ids.applicationId]);
    expect((await runtime.query("SELECT flow_candidate_consent_resume_ready($1,$2) ready",[id,ids.resumeVersionId])).rows[0].ready).toBe(false);
    await owner.query("UPDATE applications SET user_id=$1 WHERE id=$2",[id,ids.applicationId]);
    await repository.captureConsent("grant", request, authority(id));
    expect((await repository.loadConsentCommand((await owner.query(
      "SELECT event_id FROM candidate_consent_events WHERE user_id=$1",[id])).rows[0].event_id)).command.source?.resume).toEqual(resume);
    await expect(runtime.query("SELECT * FROM organization_candidate_memory_outbox")).rejects.toMatchObject({code:"42501"});
  });
  it("A1 serializes an ownership change ahead of capture and refuses with no consent writes", async () => {
    const id = await candidate(), stranger = await candidate(); const ids = await privateApplication(id);
    await acknowledgePrivate(ids); const before = await counts();
    const blocker = await runtime.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query("UPDATE applications SET user_id=$1 WHERE id=$2",[stranger,ids.applicationId]);
      let reachedLock!: () => void; const atLock = new Promise<void>(resolve => { reachedLock=resolve; });
      const instrumented = { query: runtime.query.bind(runtime), connect: async () => {
        const c = await runtime.connect(); return { release:()=>c.release(), query:(sql:string,params?:unknown[])=>{
          if(sql.includes("FOR UPDATE OF a")) reachedLock(); return c.query(sql,params);
        } };
      } };
      const pending = repository.captureConsent("grant",{...grant(),resume_version_id:ids.resumeVersionId},authority(id),instrumented);
      const refused = expect(pending).rejects.toMatchObject({code:"candidate_consent_source_not_found"});
      await atLock; await blocker.query("COMMIT"); await refused;
      expect(await counts()).toEqual(before);
    } finally { await blocker.query("ROLLBACK"); blocker.release(); }
  });
  it("rejects malformed scalar profiles and resume tuples at the actual INSERT boundary", async () => {
    const id=await candidate(), ids=await privateApplication(id); await acknowledgePrivate(ids);
    await repository.captureConsent("grant",{...grant(),resume_version_id:ids.resumeVersionId},authority(id));
    const source=(await owner.query("SELECT * FROM candidate_consent_sources WHERE subject_id=(SELECT subject_id FROM candidate_consent_subjects WHERE user_id=$1)",[id])).rows[0];
    const badProfiles=[null,{}, {...source.profile,display_name:null}, {...source.profile,headline:[]},
      {...source.profile,skills:[null]}, {...source.profile,skills:["x".repeat(101)]},
      {...source.profile,skills:[" leading"]}, {...source.profile,skills:["line\nbreak"]},
      {...source.profile,linkedin:"https://untrusted.invalid/in/fixture"}];
    const badResumes=[null,{}, ...Object.keys(source.resume).map(key=>({...source.resume,[key]:null})),
      {...source.resume,organization_id:"1"}, {...source.resume,organization_id:1.5},
      {...source.resume,byte_count:5242881}, {...source.resume,content_sha256:"x".repeat(64)},
      {...source.resume,media_type:"text/plain"}, {...source.resume,source_observed_at:"yesterday"}];
    const insert = (profile:any,resume:any) => runtime.query(`INSERT INTO candidate_consent_sources
      (source_id,subject_id,source_version,profile,profile_sha256,resume,resume_sha256,resume_version_id,approved_at)
      VALUES($1,$2,2,$3,$4,$5,$6,$7,clock_timestamp())`,[randomUUID(),source.subject_id,
      JSON.stringify(profile),source.profile_sha256,JSON.stringify(resume),source.resume_sha256,ids.resumeVersionId]);
    const before=await counts();
    for(const profile of badProfiles) await expect(insert(profile,source.resume)).rejects.toThrow();
    for(const resume of badResumes) await expect(insert(source.profile,resume)).rejects.toThrow();
    expect(await counts()).toEqual(before);
    await expect(runtime.query("UPDATE candidate_consent_subjects SET desired_action=NULL WHERE user_id=$1",[id]))
      .rejects.toMatchObject({code:"23514"});
  });
  it("one subject cannot receive concurrent leases and exhaustion does not block another subject", async () => {
    const id=await candidate(), other=await candidate();
    const a=await repository.captureConsent("grant",grant(),authority(id));
    const results=await Promise.all([claim(a.eventId,30000),claim(a.eventId,30000)]);
    expect(results.filter(Boolean)).toHaveLength(1); let row=results.find(Boolean);
    for(let attempt=1;attempt<=8;attempt++){
      expect(row.attempts).toBe(attempt);
      await owner.query("UPDATE candidate_consent_outbox SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE outbox_id=$1",[row.outbox_id]);
      row=await claim(a.eventId,30000);
    }
    expect(row).toBeUndefined();
    expect(await repository.getConsentStatus(id)).toMatchObject({delivery_status:"failed",error_code:"retry_exhausted",effective:null});
    const b=await repository.captureConsent("grant",grant(),authority(other)); expect(await claim(b.eventId,30000)).toBeTruthy();
    const withdraw=await repository.captureConsent("withdraw",{request_id:randomUUID(),expected_version:1},authority(id));
    expect((await claim(withdraw.eventId,30000)).version).toBe("2");
  });
  it("a failed replacement preserves the preceding effective approved source", async () => {
    const id=await candidate(), first=await repository.captureConsent("grant",grant(),authority(id));
    const row=await claim(first.eventId,30000);
    await runtime.query("SELECT flow_ack_candidate_consent_outbox($1,$2,$3)",[row.outbox_id,row.generation,receipt(row,"grant")]);
    const second=await repository.captureConsent("grant",{...grant(1),profile:{...grant().profile,headline:"Replacement"}},authority(id));
    const next=await claim(second.eventId,30000);
    await runtime.query("SELECT flow_fail_candidate_consent_outbox($1,$2,'account_changed',false,clock_timestamp())",[next.outbox_id,next.generation]);
    expect(await repository.getConsentStatus(id)).toMatchObject({version:2,delivery_status:"failed",
      desired:{profile:{headline:"Replacement"}},effective:{version:1,action:"grant",profile:{headline:"Approved headline"}}});
  });
  it.runIf(process.env.FLOW_CONSENT_XS === "1")("uses real registered Flow routes and signed delivery against the full Memory app", async () => {
    const memoryOwnerUrl=process.env.FLOW_CONSENT_XS_MEMORY_OWNER_URL!;
    const memoryRuntimeUrl=process.env.FLOW_CONSENT_XS_MEMORY_RUNTIME_URL!;
    for(const url of [memoryOwnerUrl,memoryRuntimeUrl]){
      const parsed=new URL(url);
      expect(parsed.hostname).toBe("127.0.0.1"); expect(parsed.pathname).toContain("_test");
    }
    const memoryOwner=new Client({connectionString:memoryRuntimeUrl});await memoryOwner.connect();
    const memorySubjectQuery=async(subject:string,sql:string,values:unknown[])=>{
      await memoryOwner.query("BEGIN READ ONLY");
      try {
        await memoryOwner.query("SELECT set_config('app.current_tenant_id',$1,true)",[`candidate_${subject}`]);
        return await memoryOwner.query(sql,values);
      }finally{await memoryOwner.query("ROLLBACK");}
    };
    const keys=generateKeyPairSync("rsa",{modulusLength:2048});
    const privateKey=keys.privateKey.export({type:"pkcs8",format:"pem"}).toString();
    const publicKey=keys.publicKey.export({type:"spki",format:"pem"}).toString();
    const memoryOrigin="http://127.0.0.1:58645";
    const controlPlaneToken=randomUUID();
    const previous={...process.env};
    Object.assign(process.env,{ACTIVEKG_BASE_URL:memoryOrigin,VANTAHIRE_JWT_PRIVATE_KEY:privateKey,
      VANTAHIRE_JWT_ACTIVE_KID:"disposable-consent", CANDIDATE_CONSENT_DELIVERY_ENABLED:"true",
      FLOW_CANDIDATE_PRIVACY_INTAKE_ENABLED:"true",ORGANIZATION_CANDIDATE_SYNC_ENABLED:"true"});
    if(!process.env.FLOW_CONSENT_XS_MEMORY_ROOT || !process.env.FLOW_CONSENT_XS_PYTHON) throw new Error("cross_system_harness_required");
    const memory=spawn(process.env.FLOW_CONSENT_XS_PYTHON,["-m","uvicorn","activekg.api.main:app",
      "--host","127.0.0.1","--port","58645"],{cwd:process.env.FLOW_CONSENT_XS_MEMORY_ROOT,stdio:"ignore",env:{
        PATH:process.env.PATH!,HOME:process.env.HOME!,PYTHONDONTWRITEBYTECODE:"1",
        ACTIVEKG_DSN:memoryRuntimeUrl,ACTIVEKG_SCHEMA_ENVIRONMENT:"development",
        ACTIVEKG_SCHEMA_TARGET_ID:"11111111-1111-4111-8111-111111111111",
        ACTIVEKG_CONTROL_PLANE_TOKEN:controlPlaneToken,JWT_ENABLED:"true",JWT_ALGORITHM:"RS256",
        JWT_PUBLIC_KEY:publicKey,JWT_ISSUER:"vantahire",JWT_AUDIENCE:"activekg",LLM_ENABLED:"false",
        RUN_SCHEDULER:"false",RATE_LIMIT_ENABLED:"false",ORG_DECISION_INBOX_ENABLED:"true",
        ORG_DECISION_INBOX_FLOW_ACTOR_ID:"vantahire-backend",SOURCED_CANDIDATE_INGEST_MODE:"canonical_only",
        ORGANIZATION_CANDIDATE_INTAKE_ENABLED:"true",CANDIDATE_CONSENT_INTAKE_ENABLED:"true",
        CANDIDATE_PRIVACY_INTAKE_ENABLED:"true",CANDIDATE_PRIVACY_HMAC_ACTIVE_VERSION:"1",
        CANDIDATE_PRIVACY_HMAC_KEY_V1:"Y2ktb25seS1jYW5kaWRhdGUtcHJpdmFjeS1rZXktMzItYnl0ZXMtbWluaW11bQ==",
        CANDIDATE_PRIVACY_FLOW_ISSUER:"vantahire",CANDIDATE_PRIVACY_FLOW_ACTOR_ID:"vantahire-backend",
        CANDIDATE_PRIVACY_SIGNAL_ISSUER:"signal",CANDIDATE_PRIVACY_SIGNAL_ACTOR_ID:"signal-service",
        HF_HUB_OFFLINE:"1",TRANSFORMERS_OFFLINE:"1",REDIS_URL:"redis://127.0.0.1:56479/0",
      }});
    const realFetch=globalThis.fetch;let networkCalls=0;let listener:any;
    globalThis.fetch=async(input,init)=>{
      const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
      if(url.hostname!=="127.0.0.1")throw new Error("cross_system_network_fence");
      networkCalls++;return realFetch(input,init);
    };
    try {
      let ready=false;let readinessReasons:string[]=[];
      const readinessDeadline=Date.now()+30000;
      for(let i=0;i<120&&Date.now()<readinessDeadline;i++){
        if(memory.exitCode!==null)throw new Error("cross_system_memory_start_failed");
        try {
          const r=await fetch(memoryOrigin+"/readyz",{headers:{authorization:`Bearer ${controlPlaneToken}`,"cache-control":"no-cache"},signal:AbortSignal.timeout(1500)});
          if(r.status===200){ready=true;break;}
          const body=await r.json();
          readinessReasons=Array.isArray(body.reasons)?body.reasons.filter((v:unknown)=>typeof v==="string"&&/^[a-z_]{1,90}$/.test(v)):[];
          if(typeof body.detail?.code==="string"&&/^[A-Z_]{1,90}$/.test(body.detail.code))readinessReasons.push(body.detail.code);
        }catch{}
        await new Promise(resolve=>setTimeout(resolve,250));
      }
      expect(ready,`full Memory app readiness: ${readinessReasons.join(",")}`).toBe(true);
      const {default:express}=await import("express");
      const {doubleCsrfProtection}=await import("../../csrf");
      const {registerCandidateConsentRoutes}=await import("../routes");
      const {registerCandidatePrivacyRoutes}=await import("../../candidate-privacy/routes");
      const {runCandidatePrivacyProcessorOnce}=await import("../../candidate-privacy/processor");
      const {runOrganizationCandidateProcessorOnce}=await import("../../organization-candidates/processor");
      const {runConsentProcessorOnce,startConsentProcessor,consentDeliveryConfig}=await import("../processor");
      const {deliverConsent}=await import("../memory-client");
      const {signServiceJwt}=await import("../../lib/services/jwt-signer");
      const id=await candidate(), other=await candidate(); const allowed=new Set([id,other]);
      const app=express(); app.use(express.json());
      // Disposable authenticated-session adapter only. Registered auth, CSRF, reauth and database gates are real.
      app.use(async(req:any,_res,next)=>{
        const actor=Number(req.headers["x-fixture-user"]);
        if(allowed.has(actor)){
          const r=(await owner.query("SELECT * FROM users WHERE id=$1",[actor])).rows[0];
          req.user={...r,emailVerified:r.email_verified,authVersion:r.auth_version};
          req.session={privacyReauthenticatedAt:Date.now(),privacyPasswordVersion:sha256(r.password)};
        }
        next();
      });
      registerCandidateConsentRoutes(app,doubleCsrfProtection);registerCandidatePrivacyRoutes(app,doubleCsrfProtection);
      listener=await new Promise<any>(resolve=>{const s=app.listen(0,"127.0.0.1",()=>resolve(s));});
      const origin=`http://127.0.0.1:${listener.address().port}`;
      const post=async(path:string,body:any,actor=id,csrf=true)=>{
        const r=await fetch(origin+path,{method:"POST",headers:{"content-type":"application/json",
          "x-fixture-user":String(actor),...(csrf?{"x-csrf-token":"fixture-csrf",cookie:"__Host-psifi.x-csrf-token=fixture-csrf"}:{})},body:JSON.stringify(body)});
        return {status:r.status,body:await r.json()};
      };
      await runCandidatePrivacyProcessorOnce();
      const initial=grant();
      const approvedSkill="approved-only-"+randomUUID(),independentSkill="independent-only-"+randomUUID();
      initial.profile.skills=[approvedSkill];
      initial.profile.linkedin="https://www.linkedin.com/in/consent-"+randomUUID();
      expect((await post("/api/candidate/consent/grant",initial,id,false)).status).toBe(403);
      const granted=await post("/api/candidate/consent/grant",initial);
      expect(granted).toMatchObject({status:200,body:{code:"granted",version:1,publication_active:false}});
      const subject=(await owner.query("SELECT subject_id FROM candidate_consent_subjects WHERE user_id=$1",[id])).rows[0].subject_id;
      const memoryState=(await memorySubjectQuery(subject,"SELECT * FROM candidate_consent_state WHERE subject_id=$1",[subject])).rows[0];
      const global=(await memoryOwner.query("SELECT public_profile,embedding,embedding_status FROM global_candidates WHERE id=$1",[memoryState.global_candidate_id])).rows[0];
      expect(global).toMatchObject({public_profile:{},embedding:null,embedding_status:"consent_pending"});
      const before=await counts();expect((await post("/api/candidate/consent/grant",initial)).status).toBe(200);expect(await counts()).toEqual(before);
      const event=(await owner.query("SELECT event_id FROM candidate_consent_events WHERE subject_id=$1 AND version=1",[subject])).rows[0].event_id;
      const loaded=await repository.loadConsentCommand(event);
      const email=(await owner.query("SELECT username FROM users WHERE id=$1",[id])).rows[0].username;
      const ids=await privateApplication(id);
      const legacyProbe=async(phase:string)=>{
        const code="import json,sys,logging,traceback\nlogging.disable(logging.CRITICAL)\ntry:\n from tests.test_candidate_consent_postgres import cross_system_legacy_probe\n cross_system_legacy_probe(json.load(sys.stdin))\n print(json.dumps({'ok':True}))\nexcept BaseException as exc:\n print(json.dumps({'ok':False,'kind':type(exc).__name__,'line':traceback.extract_tb(exc.__traceback__)[-1].lineno}))\n sys.exit(1)";
        const child=spawn(process.env.FLOW_CONSENT_XS_PYTHON!,["-c",code],{cwd:process.env.FLOW_CONSENT_XS_MEMORY_ROOT,stdio:["pipe","pipe","ignore"],timeout:30000,killSignal:"SIGKILL",env:{
          PATH:process.env.PATH!,HOME:process.env.HOME!,PYTHONDONTWRITEBYTECODE:"1",ACTIVEKG_DSN:memoryRuntimeUrl,
          CANDIDATE_PRIVACY_HMAC_ACTIVE_VERSION:"1",CANDIDATE_PRIVACY_HMAC_KEY_V1:"Y2ktb25seS1jYW5kaWRhdGUtcHJpdmFjeS1rZXktMzItYnl0ZXMtbWluaW11bQ==",
          HF_HUB_OFFLINE:"1",TRANSFORMERS_OFFLINE:"1"}});
        let output="";child.stdout.on("data",chunk=>{output+=chunk.toString();});
        child.stdin.end(JSON.stringify({phase,subject_id:subject,email,tenant_id:`org_${ids.organizationId}`,approved_skill:approvedSkill,independent_skill:independentSkill,approved_linkedin:initial.profile.linkedin}));
        const result=await new Promise<number|null>(resolve=>child.once("exit",resolve));
        const summary=JSON.parse(output.trim().split("\n").at(-1)!);
        expect(result,`legacy probe ${phase}: ${summary.kind??""} at ${summary.line??0}`).toBe(0);
        expect(summary).toEqual({ok:true});
      };
      await legacyProbe("consent_only");
      const proof={verified_email:email,privacy_subject:[{identifier_type:"email" as const,value:email}]};
      expect((await deliverConsent(loaded.command,proof,5000)).outcome).toBe("replayed");
      const identity=(await import("../contracts")).consentIdentity(loaded.command);
      const token=await signServiceJwt("activekg",{tenantId:`candidate_${subject}`,scopes:"candidate-consent:write"});
      const beforeDenials=await counts();
      for (const badOptions of [
        {tenantId:`candidate_${randomUUID()}`,scopes:"candidate-consent:write"},
        {tenantId:`candidate_${subject}`,scopes:"kg:read"},
        {tenantId:`candidate_${subject}`,scopes:"candidate-consent:write",actorType:"user" as const},
      ]) {
        const badToken=await signServiceJwt("activekg",badOptions);
        const denied=await fetch(memoryOrigin+"/candidate-consent/events",{method:"POST",
          headers:{authorization:`Bearer ${badToken}`,"content-type":"application/json"},
          body:JSON.stringify({...loaded.command,idempotency_key:identity.idempotencyKey,proof})});
        expect([401,403]).toContain(denied.status);
      }
      expect(await counts()).toEqual(beforeDenials);
      const altered=structuredClone(loaded.command);altered.source!.profile.headline="Altered replay";
      const conflict=await fetch(memoryOrigin+"/candidate-consent/events",{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},
        body:JSON.stringify({...altered,idempotency_key:identity.idempotencyKey,proof})});expect(conflict.status).toBe(409);
      await runOrganizationCandidateProcessorOnce();
      expect((await runtime.query("SELECT flow_candidate_consent_resume_ready($1,$2) ready",[id,ids.resumeVersionId])).rows[0].ready).toBe(true);
      const replacement={...grant(1),profile:initial.profile,resume_version_id:ids.resumeVersionId};
      expect((await post("/api/candidate/consent/grant",{...replacement,expected_version:0},other)).status).toBe(404);
      expect(await post("/api/candidate/consent/grant",replacement)).toMatchObject({status:200,body:{version:2,code:"granted"}});
      const pinned=(await repository.loadConsentCommand((await owner.query("SELECT event_id FROM candidate_consent_events WHERE subject_id=$1 AND version=2",[subject])).rows[0].event_id)).command;
      for(const variant of ["organization_id","content_sha256","reference_id"] as const){
        const forged=structuredClone(pinned);
        if(variant==="organization_id")forged.source!.resume!.organization_id++;
        else if(variant==="content_sha256")forged.source!.resume!.content_sha256="f".repeat(64);
        else forged.source!.resume!.reference_id=randomUUID();
        forged.event_id=randomUUID();forged.version=3;forged.source!.source_id=randomUUID();forged.source!.source_version=3;
        await expect(deliverConsent(forged,{...proof,privacy_subject:[...proof.privacy_subject,
          {identifier_type:"vantahire_application_id",value:String(ids.applicationId)}]},5000)).rejects.toMatchObject({code:"remote_conflict"});
      }
      expect((await memorySubjectQuery(subject,"SELECT highest_version FROM candidate_consent_state WHERE subject_id=$1",[subject])).rows[0].highest_version).toBe("2");
      await legacyProbe("bind");
      expect(await post("/api/candidate/consent/withdraw",{request_id:randomUUID(),expected_version:2}))
        .toMatchObject({status:200,body:{code:"withdrawn",effective:{version:3,action:"withdraw"}}});
      await legacyProbe("withdrawn");
      expect(await post("/api/candidate/consent/grant",{...replacement,request_id:randomUUID(),expected_version:3}))
        .toMatchObject({status:200,body:{code:"granted",effective:{version:4,action:"grant"}}});
      const privacy=await post("/api/candidate/privacy/requests",{requestId:randomUUID(),action:"withdraw_global_matching"});
      expect(privacy.status).toBe(202);await runCandidatePrivacyProcessorOnce();
      expect((await post("/api/candidate/consent/grant",grant(4))).status).toBe(451);
      expect((await owner.query("SELECT count(*)::int n FROM applications WHERE id=$1",[ids.applicationId])).rows[0].n).toBe(1);
      expect(await post("/api/candidate/consent/withdraw",{request_id:randomUUID(),expected_version:4}))
        .toMatchObject({status:200,body:{code:"withdrawn",effective:{version:5,action:"withdraw"}}});
      expect((await memorySubjectQuery(subject,"SELECT active_source_id FROM candidate_consent_state WHERE subject_id=$1",[subject])).rows[0].active_source_id).toBeNull();
      await legacyProbe("restricted");
      const later=await repository.captureConsent("grant",grant(),authority(other));
      process.env.ACTIVEKG_BASE_URL="http://127.0.0.1:58646";
      await runConsentProcessorOnce({...consentDeliveryConfig(),timeoutMs:100},later.eventId);
      expect(await repository.getConsentStatus(other)).toMatchObject({effective:null,delivery_status:"pending"});
      process.env.ACTIVEKG_BASE_URL=memoryOrigin;
      await owner.query("UPDATE candidate_consent_outbox SET next_attempt_at=clock_timestamp()+interval '1200 milliseconds' WHERE event_id=$1",[later.eventId]);
      const timerStartedAt=Date.now();
      const stopTimer=startConsentProcessor({...consentDeliveryConfig(),tickMs:1000});
      try {
        const deadline=Date.now()+10000;
        while(Date.now()<deadline && !(await repository.getConsentStatus(other)).effective){
          await new Promise(resolve=>setTimeout(resolve,100));
        }
      } finally {stopTimer();}
      expect(Date.now()-timerStartedAt).toBeGreaterThanOrEqual(1000);
      expect(await repository.getConsentStatus(other)).toMatchObject({effective:{action:"grant",version:1}});

      // Library deletion cannot change the immutable pin. Later application deletion blocks grants, not withdrawal.
      const deletedActor=await candidate();allowed.add(deletedActor);
      const saved=await privateApplication(deletedActor,true);
      await runOrganizationCandidateProcessorOnce();
      const savedRequest={...grant(),resume_version_id:saved.resumeVersionId};
      expect(await post("/api/candidate/consent/grant",savedRequest,deletedActor))
        .toMatchObject({status:200,body:{code:"granted",version:1}});
      const savedEvent=(await owner.query("SELECT event_id FROM candidate_consent_events WHERE user_id=$1",[deletedActor])).rows[0].event_id;
      const savedCommand=(await repository.loadConsentCommand(savedEvent)).command;
      await owner.query("DELETE FROM candidate_resumes WHERE id=$1",[saved.libraryId]);
      expect((await repository.loadConsentCommand(savedEvent)).command).toEqual(savedCommand);
      expect(await repository.ownedResume(runtime,deletedActor,saved.resumeVersionId,false)).toEqual(savedCommand.source!.resume);
      const pendingSaved=await repository.captureConsent("grant",{...savedRequest,request_id:randomUUID(),expected_version:1},authority(deletedActor));
      await owner.query("DELETE FROM applications WHERE id=$1",[saved.applicationId]);
      const beforeSourceFailure=networkCalls;
      await runConsentProcessorOnce(consentDeliveryConfig(),pendingSaved.eventId);
      expect(networkCalls).toBe(beforeSourceFailure);
      expect(await repository.getConsentStatus(deletedActor)).toMatchObject({error_code:"source_missing",effective:{version:1}});
      expect(await post("/api/candidate/consent/withdraw",{request_id:randomUUID(),expected_version:2},deletedActor))
        .toMatchObject({status:200,body:{code:"withdrawn",effective:{version:3,action:"withdraw"}}});

      // Real remote commit, lost acknowledgement, then expiry/reclaim/replay. No second receipt.
      const crashActor=await candidate();allowed.add(crashActor);
      const crash=await repository.captureConsent("grant",grant(),authority(crashActor));
      const crashedLease=await claim(crash.eventId,30000);
      const crashCommand=(await repository.loadConsentCommand(crash.eventId)).command;
      const crashEmail=(await owner.query("SELECT username FROM users WHERE id=$1",[crashActor])).rows[0].username;
      const crashProof={verified_email:crashEmail,privacy_subject:[{identifier_type:"email" as const,value:crashEmail}]};
      expect((await deliverConsent(crashCommand,crashProof,5000)).outcome).toBe("granted");
      expect(await repository.getConsentStatus(crashActor)).toMatchObject({effective:null,delivery_status:"pending"});
      await owner.query("UPDATE candidate_consent_outbox SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE event_id=$1",[crash.eventId]);
      await runConsentProcessorOnce(consentDeliveryConfig(),crash.eventId);
      expect(await repository.getConsentStatus(crashActor)).toMatchObject({effective:{version:1,action:"grant"}});
      expect((await memorySubjectQuery(crashCommand.subject_id,"SELECT count(*)::int n FROM candidate_consent_receipts WHERE subject_id=$1",[crashCommand.subject_id])).rows[0].n).toBe(1);
      expect((await runtime.query("SELECT flow_ack_candidate_consent_outbox($1,$2,$3) ok",[crashedLease.outbox_id,crashedLease.generation,
        JSON.stringify(receipt(crashedLease,"grant"))])).rows[0].ok).toBe(false);

      // A withdrawal can pass a leased, delayed grant; delivering that grant later never activates it.
      const overtakenActor=await candidate();allowed.add(overtakenActor);
      const delayed=await repository.captureConsent("grant",grant(),authority(overtakenActor));
      const delayedLease=await claim(delayed.eventId,30000);
      const delayedCommand=(await repository.loadConsentCommand(delayed.eventId)).command;
      expect(await post("/api/candidate/consent/withdraw",{request_id:randomUUID(),expected_version:1},overtakenActor))
        .toMatchObject({status:200,body:{code:"withdrawn",effective:{version:2,action:"withdraw"}}});
      const delayedEmail=(await owner.query("SELECT username FROM users WHERE id=$1",[overtakenActor])).rows[0].username;
      const superseded=await deliverConsent(delayedCommand,{verified_email:delayedEmail,
        privacy_subject:[{identifier_type:"email",value:delayedEmail}]},5000);
      expect(superseded.outcome).toBe("superseded");
      expect((await runtime.query("SELECT flow_ack_candidate_consent_outbox($1,$2,$3) ok",
        [delayedLease.outbox_id,delayedLease.generation,JSON.stringify(superseded)])).rows[0].ok).toBe(false);
      expect((await memorySubjectQuery(delayedCommand.subject_id,"SELECT highest_version,active_source_id FROM candidate_consent_state WHERE subject_id=$1",
        [delayedCommand.subject_id])).rows[0]).toMatchObject({highest_version:"2",active_source_id:null});

      // Current account authority is re-read after capture, before network transmission.
      for(const mutation of ["email_verified=false","username='changed-"+randomUUID()+"@fixture.invalid'","auth_version=auth_version+1"]){
        const actor=await candidate();const pending=await repository.captureConsent("grant",grant(),authority(actor));
        await owner.query(`UPDATE users SET ${mutation} WHERE id=$1`,[actor]);
        const sent=networkCalls;
        await runConsentProcessorOnce(consentDeliveryConfig(),pending.eventId);
        expect(networkCalls).toBe(sent);
        expect(await repository.getConsentStatus(actor)).toMatchObject({effective:null,delivery_status:"failed",error_code:"account_changed"});
      }

      // Corrupt only the returned identity after a real remote commit. The real client rejects it.
      const mismatchActor=await candidate();
      const mismatch=await repository.captureConsent("grant",grant(),authority(mismatchActor));
      await runConsentProcessorOnce(consentDeliveryConfig(),mismatch.eventId,database.pool,
        (command,proof,timeout)=>deliverConsent(command,proof,timeout,async(input,init)=>{
          const response=await globalThis.fetch(input,init);expect(response.status).toBe(200);
          const body=await response.json();body.event_id=randomUUID();
          return new Response(JSON.stringify(body),{status:200,headers:{"content-type":"application/json"}});
        }));
      expect(await repository.getConsentStatus(mismatchActor)).toMatchObject({effective:null,delivery_status:"failed",error_code:"identity_mismatch"});
      const unaffectedActor=await candidate();allowed.add(unaffectedActor);
      expect(await post("/api/candidate/consent/grant",grant(),unaffectedActor)).toMatchObject({status:200,body:{code:"granted"}});

      // Social-only evidence never claims a person. A later contradictory anchor preserves the effective source.
      const slug="independent-"+randomUUID();
      const seed=(await memoryOwner.query("INSERT INTO global_candidates(linkedin_id,linkedin_url,embedding_status,public_profile) VALUES($1,$2,'consent_pending','{}') RETURNING id",
        [slug,`https://www.linkedin.com/in/${slug}`])).rows[0].id;
      const legacyBefore=(await memoryOwner.query("SELECT to_jsonb(g) row FROM global_candidates g WHERE id=$1",[seed])).rows[0].row;
      const socialActor=await candidate();allowed.add(socialActor);
      const social=grant();social.profile.linkedin=`https://www.linkedin.com/in/${slug}`;
      expect(await post("/api/candidate/consent/grant",social,socialActor))
        .toMatchObject({status:202,body:{effective:null,delivery_status:"identity_review_required"}});
      expect(await post("/api/candidate/consent/grant",grant(1),socialActor)).toMatchObject({status:200,body:{effective:{version:2,action:"grant"}}});
      expect(await post("/api/candidate/consent/grant",{...social,request_id:randomUUID(),expected_version:2},socialActor))
        .toMatchObject({status:202,body:{version:3,effective:{version:2,action:"grant"},delivery_status:"identity_review_required"}});
      expect((await memoryOwner.query("SELECT to_jsonb(g) row FROM global_candidates g WHERE id=$1",[seed])).rows[0].row).toEqual(legacyBefore);

      const concurrentActor=await candidate();allowed.add(concurrentActor);
      const concurrentRequest=grant();const beforeConcurrent=await counts();
      const concurrent=await Promise.all([post("/api/candidate/consent/grant",concurrentRequest,concurrentActor),post("/api/candidate/consent/grant",concurrentRequest,concurrentActor)]);
      expect(concurrent.every(r=>[200,202].includes(r.status))).toBe(true);
      expect(await counts()).toEqual(Object.fromEntries(Object.entries(beforeConcurrent).map(([key,value])=>[key,Number(value)+1])));
      expect(await repository.getConsentStatus(concurrentActor)).toMatchObject({effective:{version:1,action:"grant"}});
      const collisionActor=await candidate();allowed.add(collisionActor);
      const collision=await Promise.all([post("/api/candidate/consent/grant",grant(),collisionActor),post("/api/candidate/consent/grant",grant(),collisionActor)]);
      expect(collision.map(r=>r.status).sort()).toEqual([200,409]);

      // Admission freshness failures are temporary unavailability, with zero consent writes.
      for(const update of ["last_success_at=clock_timestamp()-interval '5 minutes'","status='needs_reconciliation'"]){
        const reviewActor=await candidate();allowed.add(reviewActor);const beforeReview=await counts();
        await owner.query(`UPDATE candidate_privacy_sync_state SET ${update} WHERE consumer_name='flow'`);
        expect(await post("/api/candidate/consent/grant",grant(),reviewActor))
          .toMatchObject({status:503,body:{code:"candidate_consent_temporarily_unavailable"}});
        expect(await counts()).toEqual(beforeReview);
        await runCandidatePrivacyProcessorOnce();
      }

      // Erasure is raised through the actual Flow request and delivered to Memory, never planted there.
      const eraseActor=await candidate();allowed.add(eraseActor);
      expect((await post("/api/candidate/privacy/requests",{requestId:randomUUID(),action:"request_erasure"},eraseActor)).status).toBe(202);
      await runCandidatePrivacyProcessorOnce();
      const beforeErased=await counts();
      expect((await post("/api/candidate/consent/grant",grant(),eraseActor)).status).toBe(451);
      expect(await counts()).toEqual(beforeErased);
      expect(networkCalls).toBeGreaterThan(10);
      console.log("FLOW_4C_CROSS_SYSTEM_CORE_OK");
    } finally {
      globalThis.fetch=realFetch;
      if(listener)await new Promise<void>(resolve=>listener.close(()=>resolve()));
      memory.kill("SIGTERM");await new Promise<void>(resolve=>{
        if(memory.exitCode!==null){resolve();return;}
        const deadline=setTimeout(()=>memory.kill("SIGKILL"),5000);
        memory.once("exit",()=>{clearTimeout(deadline);resolve();});
      });
      await memoryOwner.end();
      for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);
    }
  },120000);
});
