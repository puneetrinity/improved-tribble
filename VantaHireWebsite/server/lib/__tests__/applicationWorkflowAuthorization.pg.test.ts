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

type WorkflowModule = typeof import("../applicationWorkflowAuthorization");
let workflow: WorkflowModule;
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
  if (!local || !parsed.pathname.includes("_test")) throw new Error(`Disposable workflow ${label} target refused.`);
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
  if (!owner) throw new Error("Disposable workflow owner unavailable.");
  await owner.query(`
    INSERT INTO organizations (id,name,slug,settings,is_active,signal_tenant_id) VALUES
      (1,'Workflow org one','workflow-org-one','{}'::jsonb,true,NULL),
      (2,'Workflow org two','workflow-org-two','{}'::jsonb,true,NULL);
    INSERT INTO users (id,username,password,role,email_verified,first_name,last_name) VALUES
      (101,'primary@example.invalid','x','recruiter',true,'Primary','Recruiter'),
      (102,'co@example.invalid','x','recruiter',true,'Co','Recruiter'),
      (103,'unassigned@example.invalid','x','recruiter',true,'Unassigned','Recruiter'),
      (104,'unseated@example.invalid','x','recruiter',true,'Unseated','Recruiter'),
      (105,'no-org@example.invalid','x','recruiter',true,'NoOrg','Recruiter'),
      (201,'foreign@example.invalid','x','recruiter',true,'Foreign','Recruiter'),
      (301,'candidate@example.invalid','x','candidate',true,'Fixture','Candidate'),
      (302,'hm@example.invalid','x','hiring_manager',true,'Fixture','Manager'),
      (303,'foreign-hm@example.invalid','x','hiring_manager',true,'Foreign','Manager'),
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
      (id,organization_id,title,location,type,description,original_jd,posted_by,hiring_manager_id,is_active,status,slug)
    VALUES
      (1001,1,'Workflow Role One','Remote','full-time','Fixture','Fixture',101,302,false,'pending','workflow-role-one'),
      (1002,2,'Workflow Role Two','Remote','full-time','Fixture','Fixture',201,303,false,'pending','workflow-role-two'),
      (1003,NULL,'Null Org Role','Remote','full-time','Fixture','Fixture',101,NULL,false,'pending','workflow-null-org'),
      (1004,2,'Mismatch Role','Remote','full-time','Fixture','Fixture',101,NULL,false,'pending','workflow-mismatch');
    INSERT INTO job_recruiters (id,organization_id,job_id,recruiter_id,added_by)
    VALUES (1,1,1001,102,101);
    INSERT INTO pipeline_stages (id,organization_id,name,"order",is_default,created_by) VALUES
      (1,1,'Applied',1,false,101),
      (2,1,'Interview',2,false,101),
      (3,2,'Foreign',2,false,201),
      (4,NULL,'Global Default',3,true,401),
      (5,NULL,'Global Nondefault',4,false,401);
    INSERT INTO applications
      (id,organization_id,job_id,user_id,name,email,phone,resume_url,resume_filename,extracted_resume_text,
       status,current_stage,recruiter_notes,rating,submitted_by_recruiter,created_by_user_id,source,
       source_metadata,whatsapp_consent,platform_discovery_consent)
    VALUES
      (2001,1,1001,301,'Own Candidate','own@example.invalid','000','https://invalid/own','own.pdf','fixture',
       'submitted',1,ARRAY['legacy note'],2,true,101,'authorization_fixture','{}'::jsonb,false,false),
      (2002,2,1002,NULL,'Foreign Candidate','foreign@example.invalid','000','https://invalid/foreign','foreign.pdf','fixture',
       'submitted',3,NULL,NULL,true,201,'authorization_fixture','{}'::jsonb,false,false),
      (2003,NULL,1003,NULL,'Null Candidate','null@example.invalid','000','https://invalid/null','null.pdf','fixture',
       'submitted',NULL,NULL,NULL,true,101,'authorization_fixture','{}'::jsonb,false,false),
      (2004,1,1004,NULL,'Mismatch Candidate','mismatch@example.invalid','000','https://invalid/mismatch','mismatch.pdf','fixture',
       'submitted',1,NULL,NULL,true,101,'authorization_fixture','{}'::jsonb,false,false),
      (2005,1,1001,301,'Blocked Candidate','blocked@example.invalid','000','https://invalid/blocked','blocked.pdf','fixture',
       'submitted',1,NULL,NULL,true,101,'authorization_fixture','{}'::jsonb,false,false),
      (2006,1,1001,NULL,'Review Candidate','review@example.invalid','000','https://invalid/review','review.pdf','fixture',
       'submitted',1,NULL,NULL,true,101,'authorization_fixture','{}'::jsonb,false,false),
      (2007,1,1001,NULL,'Global Candidate','global@example.invalid','000','https://invalid/global','global.pdf','fixture',
       'submitted',1,NULL,NULL,true,101,'authorization_fixture','{}'::jsonb,false,false),
      (2008,1,1001,NULL,'Empty Candidate','empty@example.invalid','000','https://invalid/empty','empty.pdf','fixture',
       'submitted',1,NULL,NULL,true,101,'authorization_fixture','{}'::jsonb,false,false);
    INSERT INTO application_feedback
      (id,application_id,author_id,overall_score,recommendation,notes,created_at,updated_at)
    VALUES (7001,2001,302,4,'advance','Legacy feedback','2026-08-30T09:00:00Z','2026-08-30T09:00:00Z');
    INSERT INTO candidate_privacy_requests
      (request_id,directive_id,action,authority_type,actor_user_id,reason_code,state,version,last_delivery_status)
    VALUES
      ('00000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000005','request_erasure','verified_candidate',301,'candidate_erasure_request','memory_active',1,'delivered'),
      ('00000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000006','request_erasure','verified_candidate',301,'candidate_erasure_request','needs_review',1,'delivered'),
      ('00000000-0000-0000-0000-000000000007','10000000-0000-0000-0000-000000000007','withdraw_global_matching','verified_candidate',301,'candidate_global_opt_out','memory_active',1,'delivered');
    INSERT INTO candidate_privacy_subject_links (link_id,request_id,subject_type,application_id,organization_id) VALUES
      ('20000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000005','application',2005,1),
      ('20000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000006','application',2006,1),
      ('20000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000007','application',2007,1);
    INSERT INTO candidate_privacy_remote_projection
      (directive_id,request_id,action,scope,state,decision,version,effective_at,generation)
    VALUES
      ('10000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000005','request_erasure','active_profile','active_quarantine','block_all',1,now(),1),
      ('10000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000006','request_erasure','active_profile','needs_review','review',1,now(),1),
      ('10000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000007','withdraw_global_matching','global_matching','active_quarantine','block_global',1,now(),1);
  `);
}

async function applicationState(ids: number[]): Promise<unknown[]> {
  if (!owner) throw new Error("Disposable workflow owner unavailable.");
  return (await owner.query(
    `SELECT id,current_stage,interview_date,interview_time,interview_location,interview_notes,
            recruiter_notes,rating,updated_at,stage_changed_at,stage_changed_by
       FROM applications WHERE id=ANY($1::integer[]) ORDER BY id`,
    [ids],
  )).rows;
}

describe.skipIf(!enabled)("application workflow authorization exact-schema PostgreSQL", () => {
  beforeAll(async () => {
    if (process.env.NODE_ENV !== "test") throw new Error("Disposable workflow integration requires NODE_ENV=test.");
    const migration = assertSafeUrl(migrationUrl, "migration");
    const runtime = assertSafeUrl(runtimeUrl, "runtime");
    if (migration.pathname !== runtime.pathname) throw new Error("Disposable workflow database mismatch.");
    const ownerProbe = await clientFor(migrationUrl);
    const runtimeProbe = await clientFor(runtimeUrl);
    try {
      const ownerIdentity = (await ownerProbe.query("SELECT current_database() database,current_user role,host(inet_server_addr()) server_addr")).rows[0];
      const runtimeIdentity = (await runtimeProbe.query("SELECT current_database() database,current_user role,host(inet_server_addr()) server_addr")).rows[0];
      const local = (value: unknown) => [null, "127.0.0.1", "::1"].includes(value as never);
      if (!String(ownerIdentity?.database).includes("_test") || !String(ownerIdentity?.role).includes("_test_")
          || !local(ownerIdentity?.server_addr) || runtimeIdentity?.database !== ownerIdentity?.database
          || !String(runtimeIdentity?.role).includes("_test_") || !local(runtimeIdentity?.server_addr)) {
        throw new Error("Disposable workflow identity proof failed.");
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
      migrateUrl: migrationUrl,
      runtimeUrl,
      runtimeRole: new URL(runtimeUrl).username,
      expectedTargetId: targetId,
      connectMigration,
      connectRuntime,
    });
    owner = await clientFor(migrationUrl);
    process.env.DATABASE_URL = runtimeUrl;
    process.env.DATABASE_SSL = "false";
    workflow = await import("../applicationWorkflowAuthorization");
    runtimePool = (await import("../../db")).pool;
  }, 180_000);

  beforeEach(async () => {
    if (!owner || !safeTargetProven) throw new Error("Disposable workflow target not proven.");
    await owner.query("TRUNCATE public.users, public.organizations RESTART IDENTITY CASCADE");
    await installFixture();
  });

  afterAll(async () => {
    if (runtimePool) await runtimePool.end();
    if (owner) await owner.end();
    if (safeTargetProven) await resetDatabase();
  });

  it("installs ledger 5 and the exact additive assessment schema", async () => {
    const result = await owner!.query(`
      SELECT
        (SELECT COUNT(*)::integer FROM schema_control.applied) AS ledger,
        to_regclass('public.application_reviewer_notes')::text AS notes_relation,
        to_regclass('public.application_reviewer_ratings')::text AS ratings_relation,
        (SELECT column_default FROM information_schema.columns
          WHERE table_schema='public' AND table_name='application_feedback' AND column_name='rubric_version') AS feedback_default,
        (SELECT COUNT(*)::integer FROM pg_indexes
          WHERE schemaname='public' AND tablename IN ('application_reviewer_notes','application_reviewer_ratings')) AS indexes
    `);
    expect(result.rows[0]).toMatchObject({
      ledger: 5,
      notes_relation: "application_reviewer_notes",
      ratings_relation: "application_reviewer_ratings",
      indexes: 7,
    });
    expect(String(result.rows[0]?.feedback_default)).toContain("legacy-unversioned-v1");
  });

  it("allows primary/co recruiter and explicit admin but denies every collapsed recruiter boundary", async () => {
    await expect(workflow.setAuthorizedApplicationReviewerRating(101, 2001, 4, { allowPlatformAdmin: true }))
      .resolves.toMatchObject({ ok: true });
    await expect(workflow.setAuthorizedApplicationReviewerRating(102, 2001, 3, { allowPlatformAdmin: true }))
      .resolves.toMatchObject({ ok: true });
    await expect(workflow.setAuthorizedApplicationReviewerRating(401, 2001, 5, { allowPlatformAdmin: true }))
      .resolves.toMatchObject({ ok: true });
    for (const [actorId, applicationId] of [[103, 2001], [104, 2001], [105, 2001], [201, 2001],
      [101, 999999], [101, 2003], [101, 2004], [101, 2005], [101, 2006]]) {
      await expect(workflow.setAuthorizedApplicationReviewerRating(actorId!, applicationId!, 4, { allowPlatformAdmin: true }))
        .resolves.toEqual({ ok: false, reason: "not_found" });
    }
    await expect(workflow.setAuthorizedApplicationReviewerRating(101, 2007, 4, { allowPlatformAdmin: true }))
      .resolves.toMatchObject({ ok: true });
  });

  it("binds stage authorization, mutation and history in one command", async () => {
    const result = await workflow.moveAuthorizedApplicationStage(101, 2001, 2, "Advance", { allowPlatformAdmin: true });
    expect(result).toMatchObject({ ok: true, value: { applicationId: 2001, stageId: 2, stageName: "Interview" } });
    const state = await owner!.query("SELECT current_stage,stage_changed_by FROM applications WHERE id=2001");
    expect(state.rows[0]).toEqual({ current_stage: 2, stage_changed_by: 101 });
    const history = await owner!.query("SELECT from_stage,to_stage,changed_by,notes FROM application_stage_history WHERE application_id=2001");
    expect(history.rows).toEqual([{ from_stage: 1, to_stage: 2, changed_by: 101, notes: "Advance" }]);
  });

  it("allows the global default stage and refuses foreign/nondefault stages with zero writes", async () => {
    await expect(workflow.moveAuthorizedApplicationStage(101, 2001, 4, null, { allowPlatformAdmin: true }))
      .resolves.toMatchObject({ ok: true, value: { stageId: 4 } });
    for (const stageId of [3, 5]) {
      const before = await applicationState([2008]);
      await expect(workflow.moveAuthorizedApplicationStage(101, 2008, stageId, null, { allowPlatformAdmin: true }))
        .resolves.toEqual({ ok: false, reason: "not_found" });
      expect(await applicationState([2008])).toEqual(before);
    }
  });

  it("updates a single interview only after the bound grant", async () => {
    const date = new Date("2099-01-01T10:00:00.000Z");
    await expect(workflow.scheduleAuthorizedApplicationInterview(102, 2001, {
      date, time: "10:00", location: "Synthetic room", notes: "Bound",
    }, { allowPlatformAdmin: true })).resolves.toMatchObject({
      ok: true,
      value: { applicationId: 2001, interviewTime: "10:00", interviewLocation: "Synthetic room" },
    });
    const before = await applicationState([2002]);
    await expect(workflow.scheduleAuthorizedApplicationInterview(101, 2002, {
      date, time: null, location: null, notes: null,
    }, { allowPlatformAdmin: true })).resolves.toEqual({ ok: false, reason: "not_found" });
    expect(await applicationState([2002])).toEqual(before);
  });

  it("commits an all-authorized bulk set and rolls back a mixed set before any write/history", async () => {
    const date = new Date("2099-01-01T10:00:00.000Z");
    const items = [2001, 2007].map((applicationId, index) => ({
      applicationId,
      interviewDate: new Date(date.getTime() + index * 3_600_000),
      interviewTime: null,
      interviewLocation: "Synthetic room",
      interviewNotes: null,
    }));
    const success = await workflow.scheduleAuthorizedBulkApplicationInterviews(101, items, 2, "Bulk", { allowPlatformAdmin: true });
    expect(success.ok && success.value.map((row) => row.applicationId)).toEqual([2001, 2007]);
    expect((await owner!.query("SELECT COUNT(*)::integer n FROM application_stage_history")).rows[0]?.n).toBe(2);

    await owner!.query("TRUNCATE public.application_stage_history; UPDATE applications SET interview_date=NULL,interview_time=NULL,interview_location=NULL,interview_notes=NULL,current_stage=1 WHERE id IN (2001,2002)");
    const before = await applicationState([2001, 2002]);
    const mixed = [2001, 2002].map((applicationId) => ({ ...items[0]!, applicationId }));
    await expect(workflow.scheduleAuthorizedBulkApplicationInterviews(101, mixed, 2, "Mixed", { allowPlatformAdmin: true }))
      .resolves.toEqual({ ok: false, reason: "not_found" });
    expect(await applicationState([2001, 2002])).toEqual(before);
    expect((await owner!.query("SELECT COUNT(*)::integer n FROM application_stage_history")).rows[0]?.n).toBe(0);
  });

  it("atomically appends the compatibility note and records exact attribution", async () => {
    const result = await workflow.addAuthorizedApplicationReviewerNote(102, 2001, "  Bounded note  ", { allowPlatformAdmin: true });
    expect(result).toMatchObject({ ok: true, value: { applicationId: 2001, note: { authorId: 102 } } });
    expect(JSON.stringify(result)).not.toContain("Bounded note");
    const row = (await owner!.query("SELECT recruiter_notes FROM applications WHERE id=2001")).rows[0];
    expect(row.recruiter_notes).toEqual(["legacy note", "Bounded note"]);
    const notes = await owner!.query("SELECT application_id,organization_id,author_id,note,visibility FROM application_reviewer_notes");
    expect(notes.rows).toEqual([{ application_id: 2001, organization_id: 1, author_id: 102, note: "Bounded note", visibility: "organization_private" }]);
  });

  it("keeps ratings per reviewer and never writes legacy applications.rating", async () => {
    await workflow.setAuthorizedApplicationReviewerRating(101, 2001, 4, { allowPlatformAdmin: true });
    await workflow.setAuthorizedApplicationReviewerRating(102, 2001, 3, { allowPlatformAdmin: true });
    await workflow.setAuthorizedApplicationReviewerRating(101, 2001, 5, { allowPlatformAdmin: true });
    const rows = await owner!.query("SELECT reviewer_id,rating,rubric_version FROM application_reviewer_ratings ORDER BY reviewer_id");
    expect(rows.rows).toEqual([
      { reviewer_id: 101, rating: 5, rubric_version: "application-rating-v1" },
      { reviewer_id: 102, rating: 3, rubric_version: "application-rating-v1" },
    ]);
    expect((await owner!.query("SELECT rating FROM applications WHERE id=2001")).rows[0]?.rating).toBe(2);
  });

  it("enforces HM feedback-only authority and returns the minimum ordered projection", async () => {
    const own = await workflow.readAuthorizedApplicationFeedback(302, 2001, { allowPlatformAdmin: true });
    expect(own).toMatchObject({ ok: true, rows: [{
      id: 7001, applicationId: 2001, authorId: 302, rubricVersion: "legacy-unversioned-v1",
      author: { id: 302, role: "hiring_manager" },
    }] });
    await expect(workflow.readAuthorizedApplicationFeedback(303, 2001, { allowPlatformAdmin: true }))
      .resolves.toEqual({ ok: false, reason: "not_found" });
    await expect(workflow.readAuthorizedApplicationFeedback(401, 2001, { allowPlatformAdmin: true }))
      .resolves.toMatchObject({ ok: true });
    await expect(workflow.moveAuthorizedApplicationStage(302, 2001, 2, null, { allowPlatformAdmin: true }))
      .resolves.toEqual({ ok: false, reason: "not_found" });
  });

  it("preserves authorized-empty feedback and writes server-derived author/rubric", async () => {
    await expect(workflow.readAuthorizedApplicationFeedback(302, 2008, { allowPlatformAdmin: true }))
      .resolves.toEqual({ ok: true, rows: [] });
    const created = await workflow.addAuthorizedApplicationFeedback(302, 2008, {
      overallScore: 5, recommendation: "advance", notes: "Evidence",
    }, { allowPlatformAdmin: true });
    expect(created).toMatchObject({ ok: true, value: {
      applicationId: 2008, authorId: 302, rubricVersion: "team-feedback-v1",
    } });
    const stored = await owner!.query("SELECT application_id,author_id,rubric_version FROM application_feedback WHERE application_id=2008");
    expect(stored.rows).toEqual([{ application_id: 2008, author_id: 302, rubric_version: "team-feedback-v1" }]);
  });

  it("enforces the new checks and runtime remains DML-only", async () => {
    const runtime = await clientFor(runtimeUrl);
    try {
      await runtime.query("BEGIN");
      await runtime.query("SAVEPOINT invalid_rating");
      await expect(runtime.query(`INSERT INTO application_reviewer_ratings
        (application_id,organization_id,reviewer_id,rating,rubric_version) VALUES (2001,1,101,6,'application-rating-v1')`))
        .rejects.toMatchObject({ code: "23514" });
      await runtime.query("ROLLBACK TO SAVEPOINT invalid_rating");
      await runtime.query("SAVEPOINT no_ddl");
      await expect(runtime.query("CREATE TABLE workflow_runtime_forbidden(id integer)"))
        .rejects.toMatchObject({ code: "42501" });
      await runtime.query("ROLLBACK TO SAVEPOINT no_ddl");
      await runtime.query("ROLLBACK");
    } finally {
      await runtime.end();
    }
  });
});
