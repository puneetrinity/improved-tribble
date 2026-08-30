import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";

import { runReleaseMigration, type MigrationClient } from "../../schema-control/runner";
import { provisionRuntimeRole } from "../../schema-control/runtimeRole";

const migrationUrl = (process.env.FLOW_SCHEMA_TEST_DATABASE_URL ?? "").trim();
const runtimeUrl = (process.env.FLOW_SCHEMA_TEST_RUNTIME_DATABASE_URL ?? "").trim();
const enabled = process.env.FLOW_AUTHZ_TEST_DISPOSABLE === "1" && Boolean(migrationUrl) && Boolean(runtimeUrl);
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "schema-migrations");
const targetId = "flow-object-authorization-test-target";

type Module = typeof import("../applicationAiOutboundAuthorization");
let authorization: Module;
let owner: Client | undefined;
let runtimePool: { end(): Promise<void> } | undefined;
let safeTargetProven = false;

async function clientFor(connectionString: string): Promise<Client> {
  const client = new Client({ connectionString, connectionTimeoutMillis: 2_000 });
  await client.connect();
  return client;
}

async function connectMigration(): Promise<MigrationClient> {
  const client = await clientFor(migrationUrl);
  return { query: (text, params) => client.query(text, params as any), end: () => client.end() };
}

async function connectRuntime(): Promise<MigrationClient> {
  const client = await clientFor(runtimeUrl);
  return { query: (text, params) => client.query(text, params as any), end: () => client.end() };
}

function assertSafeUrl(value: string, label: string): URL {
  const parsed = new URL(value);
  const socket = parsed.searchParams.get("host");
  const local = parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]" || Boolean(socket?.startsWith("/"));
  if (!local || !parsed.pathname.includes("_test")) throw new Error(`Disposable 2H ${label} target refused.`);
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

async function installFixture(): Promise<void> {
  if (!owner) throw new Error("Disposable 2H owner unavailable.");
  await owner.query(`
    INSERT INTO organizations (id,name,slug,settings,is_active,signal_tenant_id) VALUES
      (1,'AI outbound org one','ai-outbound-org-one','{}'::jsonb,true,NULL),
      (2,'AI outbound org two','ai-outbound-org-two','{}'::jsonb,true,NULL);
    INSERT INTO users (id,username,password,role,email_verified,first_name,last_name) VALUES
      (101,'primary@example.invalid','x','recruiter',true,'Primary','Recruiter'),
      (102,'co@example.invalid','x','recruiter',true,'Co','Recruiter'),
      (103,'unassigned@example.invalid','x','recruiter',true,'Unassigned','Recruiter'),
      (104,'unseated@example.invalid','x','recruiter',true,'Unseated','Recruiter'),
      (105,'no-org@example.invalid','x','recruiter',true,'NoOrg','Recruiter'),
      (201,'foreign@example.invalid','x','recruiter',true,'Foreign','Recruiter'),
      (301,'candidate@example.invalid','x','candidate',true,'Fixture','Candidate'),
      (401,'admin@example.invalid','x','super_admin',true,'Platform','Admin');
    INSERT INTO organization_members
      (id,organization_id,user_id,role,seat_assigned,credits_allocated,credits_used,credits_rollover,invited_by)
    VALUES
      (1,1,101,'owner',true,0,0,0,NULL),
      (2,1,102,'member',true,0,0,0,101),
      (3,1,103,'member',true,0,0,0,101),
      (4,1,104,'member',false,0,0,0,101),
      (5,2,201,'owner',true,0,0,0,NULL);
    INSERT INTO jobs
      (id,organization_id,title,location,type,description,original_jd,skills,good_to_have_skills,posted_by,is_active,status,slug)
    VALUES
      (1001,1,'Target Role','Remote','full-time','Target description','Fixture',ARRAY['TypeScript'],ARRAY['SQL'],101,false,'pending','ai-target'),
      (1002,1,'Source Role','Remote','full-time','Source description','Fixture',ARRAY['TypeScript'],ARRAY['SQL'],101,false,'pending','ai-source'),
      (1003,1,'Unmatched Role','Remote','full-time','Unmatched description','Fixture',ARRAY['Rust'],NULL,101,false,'pending','ai-unmatched'),
      (2001,2,'Foreign Role','Remote','full-time','Foreign description','Fixture',ARRAY['TypeScript'],NULL,201,false,'pending','ai-foreign'),
      (3001,NULL,'Null Org Role','Remote','full-time','Null','Fixture',NULL,NULL,101,false,'pending','ai-null'),
      (3002,2,'Mismatch Role','Remote','full-time','Mismatch','Fixture',NULL,NULL,101,false,'pending','ai-mismatch');
    INSERT INTO job_recruiters (id,organization_id,job_id,recruiter_id,added_by) VALUES
      (1,1,1001,102,101), (2,1,1002,102,101);
    INSERT INTO candidate_resumes (id,user_id,label,gcs_path,extracted_text,is_default) VALUES
      (5001,301,'Fixture resume','gs://fixture/resume.pdf','Candidate resume fallback',true);
    INSERT INTO applications
      (id,organization_id,job_id,user_id,name,email,phone,resume_url,resume_filename,extracted_resume_text,
       cover_letter,resume_id,status,current_stage,submitted_by_recruiter,created_by_user_id,source,
       source_metadata,whatsapp_consent,platform_discovery_consent,ai_fit_score,ai_fit_label)
    VALUES
      (2001,1,1001,301,'Stored Candidate','stored@example.invalid','000','https://invalid/stored','stored.pdf','Stored application text',
       'Stored cover',5001,'submitted',NULL,true,101,'authorization_fixture','{}'::jsonb,false,false,75,'Good'),
      (2002,1,1002,301,'Resume Candidate','resume@example.invalid','000','https://invalid/resume','resume.pdf',NULL,
       'Resume cover',5001,'submitted',NULL,true,101,'authorization_fixture','{}'::jsonb,false,false,90,'Strong'),
      (2003,1,1002,NULL,'Cover Candidate','cover@example.invalid','000','https://invalid/cover','cover.pdf',NULL,
       'Cover letter fallback',NULL,'submitted',NULL,true,101,'authorization_fixture','{}'::jsonb,false,false,80,'Good'),
      (2004,1,1002,NULL,'Empty Candidate','empty@example.invalid','000','https://invalid/empty','empty.pdf',NULL,
       NULL,NULL,'submitted',NULL,true,101,'authorization_fixture','{}'::jsonb,false,false,70,NULL),
      (2005,1,1003,NULL,'Unmatched Candidate','unmatched@example.invalid','000','https://invalid/unmatched','unmatched.pdf','Text',
       NULL,NULL,'submitted',NULL,true,101,'authorization_fixture','{}'::jsonb,false,false,99,'Exceptional'),
      (2101,2,2001,NULL,'Foreign Candidate','foreign-candidate@example.invalid','000','https://invalid/foreign','foreign.pdf','Foreign text',
       NULL,NULL,'submitted',NULL,true,201,'authorization_fixture','{}'::jsonb,false,false,99,'Exceptional'),
      (2201,NULL,3001,NULL,'Null Candidate','null@example.invalid','000','https://invalid/null','null.pdf','Null text',
       NULL,NULL,'submitted',NULL,true,101,'authorization_fixture','{}'::jsonb,false,false,99,'Exceptional'),
      (2202,1,3002,NULL,'Mismatch Candidate','mismatch@example.invalid','000','https://invalid/mismatch','mismatch.pdf','Mismatch text',
       NULL,NULL,'submitted',NULL,true,101,'authorization_fixture','{}'::jsonb,false,false,99,'Exceptional'),
      (2301,1,1002,NULL,'Blocked Candidate','blocked@example.invalid','000','https://invalid/blocked','blocked.pdf','Blocked text',
       NULL,NULL,'submitted',NULL,true,101,'authorization_fixture','{}'::jsonb,false,false,98,'Exceptional'),
      (2302,1,1002,NULL,'Review Candidate','review@example.invalid','000','https://invalid/review','review.pdf','Review text',
       NULL,NULL,'submitted',NULL,true,101,'authorization_fixture','{}'::jsonb,false,false,97,'Exceptional');
    INSERT INTO email_templates (id,organization_id,name,subject,body,template_type,created_by,is_default) VALUES
      (3001,1,'Org template','Org subject','Org body','status_update',101,false),
      (3002,2,'Foreign template','Foreign subject','Foreign body','status_update',201,false),
      (3003,NULL,'Default template','Default subject','Default body','status_update',401,true),
      (3004,NULL,'Caller template','Caller subject','Caller body','status_update',101,false),
      (3005,NULL,'Other global','Other subject','Other body','status_update',201,false);
    INSERT INTO candidate_privacy_requests
      (request_id,directive_id,action,authority_type,actor_user_id,reason_code,state,version,last_delivery_status)
    VALUES
      ('00000000-0000-0000-0000-000000002301','10000000-0000-0000-0000-000000002301','request_erasure','verified_candidate',301,'candidate_erasure_request','memory_active',1,'delivered'),
      ('00000000-0000-0000-0000-000000002302','10000000-0000-0000-0000-000000002302','request_erasure','verified_candidate',301,'candidate_erasure_request','needs_review',1,'delivered');
    INSERT INTO candidate_privacy_subject_links (link_id,request_id,subject_type,application_id,organization_id) VALUES
      ('20000000-0000-0000-0000-000000002301','00000000-0000-0000-0000-000000002301','application',2301,1),
      ('20000000-0000-0000-0000-000000002302','00000000-0000-0000-0000-000000002302','application',2302,1);
    INSERT INTO candidate_privacy_remote_projection
      (directive_id,request_id,action,scope,state,decision,version,effective_at,generation)
    VALUES
      ('10000000-0000-0000-0000-000000002301','00000000-0000-0000-0000-000000002301','request_erasure','active_profile','active_quarantine','block_all',1,now(),1),
      ('10000000-0000-0000-0000-000000002302','00000000-0000-0000-0000-000000002302','request_erasure','active_profile','needs_review','review',1,now(),1);
  `);
}

const policy = { allowPlatformAdmin: true } as const;
const publication = {
  summary: "Bounded summary", suggestedAction: "hold" as const, suggestedActionReason: "Review",
  strengths: ["Evidence"], concerns: [], keyHighlights: ["Highlight"],
  requiredSkillsMatched: ["TypeScript"], requiredSkillsMissing: [], requiredSkillsMatchPercentage: 100,
  requiredSkillsDepthNotes: "Strong", goodToHaveSkillsMatched: ["SQL"], goodToHaveSkillsMissing: [],
  modelVersion: "fixture-model", tokensIn: 10, tokensOut: 20, costUsd: "0.00010000", durationMs: 25,
};

describe.skipIf(!enabled)("application AI/outbound exact-schema PostgreSQL", () => {
  beforeAll(async () => {
    if (process.env.NODE_ENV !== "test") throw new Error("Disposable 2H integration requires NODE_ENV=test.");
    const migration = assertSafeUrl(migrationUrl, "migration");
    const runtime = assertSafeUrl(runtimeUrl, "runtime");
    if (migration.pathname !== runtime.pathname) throw new Error("Disposable 2H database mismatch.");
    const ownerProbe = await clientFor(migrationUrl);
    const runtimeProbe = await clientFor(runtimeUrl);
    try {
      const ownerIdentity = (await ownerProbe.query("SELECT current_database() database,current_user role,host(inet_server_addr()) server_addr")).rows[0];
      const runtimeIdentity = (await runtimeProbe.query("SELECT current_database() database,current_user role,host(inet_server_addr()) server_addr")).rows[0];
      const local = (value: unknown) => [null, "127.0.0.1", "::1"].includes(value as never);
      if (!String(ownerIdentity?.database).includes("_test") || !String(ownerIdentity?.role).includes("_test_")
          || !local(ownerIdentity?.server_addr) || runtimeIdentity?.database !== ownerIdentity?.database
          || !String(runtimeIdentity?.role).includes("_test_") || !local(runtimeIdentity?.server_addr)) {
        throw new Error("Disposable 2H identity proof failed.");
      }
      safeTargetProven = true;
    } finally {
      await ownerProbe.end();
      await runtimeProbe.end();
    }
    await resetDatabase();
    await runReleaseMigration({
      migrationsDir,
      creds: { migrateUrl: migrationUrl, expectedTargetId: targetId, environment: "development", allowFreshInitialization: true },
      connect: connectMigration,
    });
    await provisionRuntimeRole({
      migrateUrl: migrationUrl, runtimeUrl, runtimeRole: new URL(runtimeUrl).username,
      expectedTargetId: targetId, connectMigration, connectRuntime,
    });
    owner = await clientFor(migrationUrl);
    process.env.DATABASE_URL = runtimeUrl;
    process.env.DATABASE_SSL = "false";
    authorization = await import("../applicationAiOutboundAuthorization");
    runtimePool = (await import("../../db")).pool;
  }, 180_000);

  beforeEach(async () => {
    if (!owner || !safeTargetProven) throw new Error("Disposable 2H target not proven.");
    await owner.query("TRUNCATE public.users, public.organizations RESTART IDENTITY CASCADE");
    await installFixture();
  });

  afterAll(async () => {
    if (runtimePool) await runtimePool.end();
    if (owner) await owner.end();
    if (safeTargetProven) await resetDatabase();
  });

  it("keeps the shipped four-migration schema unchanged", async () => {
    const row = (await owner!.query(`
      SELECT (SELECT COUNT(*)::integer FROM schema_control.applied) ledger,
             to_regclass('public.application_reviewer_notes')::text notes_relation,
             to_regclass('public.resume_access_attempts')::text resume_relation
    `)).rows[0];
    expect(row).toEqual({ ledger: 4, notes_relation: "application_reviewer_notes", resume_relation: "resume_access_attempts" });
  });

  it("allows primary/co/admin summary context and collapses every unsafe boundary", async () => {
    for (const actorId of [101, 102, 401]) {
      await expect(authorization.readAuthorizedApplicationAiSummaryContext(actorId, 2001, policy))
        .resolves.toMatchObject({ ok: true, value: { organizationId: 1 } });
    }
    for (const [actorId, applicationId] of [[103, 2001], [104, 2001], [105, 2001], [201, 2001],
      [101, 999999], [101, 2101], [101, 2201], [101, 2202], [101, 2301], [101, 2302]]) {
      await expect(authorization.readAuthorizedApplicationAiSummaryContext(actorId!, applicationId!, policy))
        .resolves.toEqual({ ok: false, reason: "not_found" });
    }
  });

  it("uses stored application, candidate-resume, then cover-letter text without GCS", async () => {
    const expected = [[2001, "Stored application text"], [2002, "Candidate resume fallback"],
      [2003, "Cover letter fallback"], [2004, null]] as const;
    for (const [applicationId, candidateText] of expected) {
      await expect(authorization.readAuthorizedApplicationAiSummaryContext(101, applicationId, policy))
        .resolves.toMatchObject({ ok: true, value: { applicationId, candidateText } });
    }
  });

  it("atomically publishes only summary fields and one same-org usage row", async () => {
    const before = (await owner!.query("SELECT name,email,phone,resume_url,updated_at FROM applications WHERE id=2001")).rows[0];
    await expect(authorization.publishAuthorizedApplicationAiSummary(101, 2001, publication, policy))
      .resolves.toMatchObject({ ok: true, value: { applicationId: 2001 } });
    const after = (await owner!.query("SELECT name,email,phone,resume_url,updated_at,ai_summary,ai_summary_model_version FROM applications WHERE id=2001")).rows[0];
    expect({ name: after.name, email: after.email, phone: after.phone, resume_url: after.resume_url, updated_at: after.updated_at })
      .toEqual(before);
    expect(after).toMatchObject({ ai_summary: "Bounded summary", ai_summary_model_version: "fixture-model" });
    const usage = (await owner!.query("SELECT organization_id,user_id,kind,metadata FROM user_ai_usage")).rows;
    expect(usage).toEqual([{ organization_id: 1, user_id: 101, kind: "summary", metadata: { applicationId: 2001, durationMs: 25 } }]);
  });

  it("publishes for co-recruiter/admin but not after privacy or tenant authority is lost", async () => {
    for (const actorId of [102, 401]) {
      await expect(authorization.publishAuthorizedApplicationAiSummary(actorId, 2001, publication, policy))
        .resolves.toMatchObject({ ok: true, value: { applicationId: 2001 } });
    }
    for (const [actorId, applicationId] of [[103, 2001], [104, 2001], [105, 2001], [201, 2001],
      [101, 2101], [101, 2201], [101, 2202], [101, 2301], [101, 2302]]) {
      await expect(authorization.publishAuthorizedApplicationAiSummary(actorId!, applicationId!, publication, policy))
        .resolves.toEqual({ ok: false, reason: "not_found" });
    }
    expect((await owner!.query("SELECT COUNT(*)::integer count FROM user_ai_usage")).rows[0].count).toBe(2);
    expect((await owner!.query("SELECT ai_summary FROM applications WHERE id IN (2101,2201,2202,2301,2302) AND ai_summary IS NOT NULL")).rowCount).toBe(0);
  });

  it("writes neither summary nor usage when authorization is absent", async () => {
    await expect(authorization.publishAuthorizedApplicationAiSummary(101, 2101, publication, policy))
      .resolves.toEqual({ ok: false, reason: "not_found" });
    expect((await owner!.query("SELECT COUNT(*)::integer count FROM user_ai_usage")).rows[0].count).toBe(0);
    expect((await owner!.query("SELECT ai_summary FROM applications WHERE id=2101")).rows[0].ai_summary).toBeNull();
  });

  it("returns only current-controlled same-org private similarity in deterministic order", async () => {
    const result = await authorization.readAuthorizedSimilarCandidates(101, 1001, 70, 20, policy);
    expect(result).toEqual({ ok: true, rows: [
      { applicationId: 2002, candidateName: "Resume Candidate", candidateEmail: "resume@example.invalid",
        sourceJobId: 1002, sourceJobTitle: "Source Role", aiFitScore: 90, aiFitLabel: "Strong", currentStage: null },
      { applicationId: 2003, candidateName: "Cover Candidate", candidateEmail: "cover@example.invalid",
        sourceJobId: 1002, sourceJobTitle: "Source Role", aiFitScore: 80, aiFitLabel: "Good", currentStage: null },
      { applicationId: 2004, candidateName: "Empty Candidate", candidateEmail: "empty@example.invalid",
        sourceJobId: 1002, sourceJobTitle: "Source Role", aiFitScore: 70, aiFitLabel: null, currentStage: null },
    ] });
  });

  it("distinguishes unauthorized target from authorized-empty in the same command", async () => {
    await expect(authorization.readAuthorizedSimilarCandidates(101, 2001, 70, 20, policy))
      .resolves.toEqual({ ok: false, reason: "not_found" });
    await expect(authorization.readAuthorizedSimilarCandidates(101, 1003, 70, 20, policy))
      .resolves.toEqual({ ok: true, rows: [] });
    await expect(authorization.readAuthorizedSimilarCandidates(104, 1001, 70, 20, policy))
      .resolves.toEqual({ ok: false, reason: "not_found" });
  });

  it("preserves current target/source control for co-recruiter and platform admin", async () => {
    for (const actorId of [102, 401]) {
      const result = await authorization.readAuthorizedSimilarCandidates(actorId, 1001, 70, 2, policy);
      expect(result).toMatchObject({ ok: true });
      if (!result.ok) throw new Error("expected authorized similarity");
      expect(result.rows.map((row) => row.applicationId)).toEqual([2002, 2003]);
    }
    for (const actorId of [103, 104, 105, 201]) {
      await expect(authorization.readAuthorizedSimilarCandidates(actorId, 1001, 70, 20, policy))
        .resolves.toEqual({ ok: false, reason: "not_found" });
    }
  });

  it("enforces exact template visibility for manual and draft context", async () => {
    for (const templateId of [3001, 3003, 3004]) {
      await expect(authorization.readAuthorizedManualEmailContext(101, 2001, templateId, policy))
        .resolves.toMatchObject({ ok: true, value: { applicationId: 2001, templateId, organizationId: 1 } });
      await expect(authorization.readAuthorizedEmailDraftContext(101, 2001, templateId, policy))
        .resolves.toMatchObject({ ok: true, value: { applicationId: 2001, templateId, organizationId: 1 } });
    }
    for (const templateId of [3002, 3005]) {
      await expect(authorization.readAuthorizedManualEmailContext(101, 2001, templateId, policy))
        .resolves.toEqual({ ok: false, reason: "not_found" });
    }
  });

  it("applies the same actor/object/privacy grant to both email contexts", async () => {
    for (const actorId of [101, 102, 401]) {
      await expect(authorization.readAuthorizedManualEmailContext(actorId, 2001, 3001, policy))
        .resolves.toMatchObject({ ok: true, value: { applicationId: 2001, organizationId: 1 } });
      await expect(authorization.readAuthorizedEmailDraftContext(actorId, 2001, 3001, policy))
        .resolves.toMatchObject({ ok: true, value: { applicationId: 2001, organizationId: 1 } });
    }
    for (const [actorId, applicationId] of [[103, 2001], [104, 2001], [105, 2001], [201, 2001],
      [101, 2101], [101, 2201], [101, 2202], [101, 2301], [101, 2302]]) {
      await expect(authorization.readAuthorizedManualEmailContext(actorId!, applicationId!, 3001, policy))
        .resolves.toEqual({ ok: false, reason: "not_found" });
      await expect(authorization.readAuthorizedEmailDraftContext(actorId!, applicationId!, 3001, policy))
        .resolves.toEqual({ ok: false, reason: "not_found" });
    }
  });

  it("records draft usage only under the authorized organization and actor", async () => {
    await expect(authorization.recordAuthorizedEmailDraftUsage(101, 2001, {
      templateId: 3001, tone: "formal", tokensIn: 4, tokensOut: 5,
      costUsd: "0.00001000", durationMs: 10,
    }, policy)).resolves.toMatchObject({ ok: true, value: { applicationId: 2001 } });
    const usage = (await owner!.query("SELECT organization_id,user_id,kind,metadata FROM user_ai_usage")).rows[0];
    expect(usage).toEqual({
      organization_id: 1, user_id: 101, kind: "email_draft",
      metadata: { applicationId: 2001, templateId: 3001, tone: "formal", durationMs: 10 },
    });
  });

  it("writes no draft usage for a foreign template, foreign tenant, or privacy-restricted application", async () => {
    const usage = {
      templateId: 3001, tone: "friendly" as const, tokensIn: 1, tokensOut: 2,
      costUsd: "0.00000100", durationMs: 3,
    };
    for (const [actorId, applicationId, templateId] of [
      [101, 2001, 3002], [201, 2001, 3001], [101, 2101, 3001], [101, 2301, 3001], [101, 2302, 3001],
    ]) {
      await expect(authorization.recordAuthorizedEmailDraftUsage(actorId!, applicationId!, { ...usage, templateId: templateId! }, policy))
        .resolves.toEqual({ ok: false, reason: "not_found" });
    }
    expect((await owner!.query("SELECT COUNT(*)::integer count FROM user_ai_usage")).rows[0].count).toBe(0);
  });

  it("keeps the runtime role DML-only", async () => {
    const runtime = await clientFor(runtimeUrl);
    try {
      const row = (await runtime.query(`
        SELECT current_user role,
               has_schema_privilege(current_user,'public','CREATE') can_create,
               has_table_privilege(current_user,'applications','UPDATE') can_update,
               has_table_privilege(current_user,'user_ai_usage','INSERT') can_insert_usage
      `)).rows[0];
      expect(row).toMatchObject({ can_create: false, can_update: true, can_insert_usage: true });
    } finally {
      await runtime.end();
    }
  });
});
