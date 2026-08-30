import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

import { runReleaseMigration, type MigrationClient } from "../schema-control/runner";
import { provisionRuntimeRole } from "../schema-control/runtimeRole";

const migrationUrl = (process.env.FLOW_SCHEMA_TEST_DATABASE_URL ?? "").trim();
const runtimeUrl = (process.env.FLOW_SCHEMA_TEST_RUNTIME_DATABASE_URL ?? "").trim();
const enabled = process.env.FLOW_AUTHZ_TEST_DISPOSABLE === "1"
  && Boolean(migrationUrl)
  && Boolean(runtimeUrl);
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "schema-migrations");
const targetId = "flow-object-authorization-test-target";

type AuthorizationModule = typeof import("../lib/applicationReadAuthorization");
type MembershipAuthorizationModule = typeof import("../lib/membershipScopedReadAuthorization");
type AuthModule = typeof import("../auth");
type StorageModule = typeof import("../storage");

let authorization: AuthorizationModule;
let membershipAuthorization: MembershipAuthorizationModule;
let authModule: AuthModule;
let storageModule: StorageModule;
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
  return {
    query: (text, params) => client.query(text, params as any),
    end: () => client.end(),
  };
}

async function connectRuntime(): Promise<MigrationClient> {
  const client = await clientFor(runtimeUrl);
  return {
    query: (text, params) => client.query(text, params as any),
    end: () => client.end(),
  };
}

function assertSafeUrl(value: string, label: string): URL {
  const parsed = new URL(value);
  const socket = parsed.searchParams.get("host");
  const numericLoopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]";
  const localSocket = Boolean(socket?.startsWith("/"));
  const database = parsed.pathname.replace(/^\//, "");
  if ((!numericLoopback && !localSocket) || !database.includes("_test")) {
    throw new Error(`Disposable authorization ${label} target refused.`);
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

async function databaseState(): Promise<string> {
  if (!owner) throw new Error("Disposable authorization owner is unavailable.");
  const result = await owner.query(`
    SELECT jsonb_build_object(
      'users', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id), '[]'::jsonb) FROM users t),
      'memberships', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id), '[]'::jsonb) FROM organization_members t),
      'jobs', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id), '[]'::jsonb) FROM jobs t),
      'job_recruiters', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id), '[]'::jsonb) FROM job_recruiters t),
      'hiring_manager_invitations', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id), '[]'::jsonb) FROM hiring_manager_invitations t),
      'applications', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id), '[]'::jsonb) FROM applications t),
      'candidate_resumes', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id), '[]'::jsonb) FROM candidate_resumes t),
      'stage_history', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id), '[]'::jsonb) FROM application_stage_history t),
      'email_history', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id), '[]'::jsonb) FROM email_audit_log t),
      'whatsapp_templates', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id), '[]'::jsonb) FROM whatsapp_templates t),
      'whatsapp_history', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id), '[]'::jsonb) FROM whatsapp_audit_log t),
      'resume_access_attempts', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id), '[]'::jsonb) FROM resume_access_attempts t),
      'privacy_requests', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY request_id), '[]'::jsonb) FROM candidate_privacy_requests t),
      'privacy_links', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY request_id), '[]'::jsonb) FROM candidate_privacy_subject_links t),
      'privacy_projection', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY request_id), '[]'::jsonb) FROM candidate_privacy_remote_projection t)
    ) AS state
  `);
  return JSON.stringify(result.rows[0]?.state);
}

async function readWithoutMutation<T>(read: () => Promise<T>): Promise<T> {
  const before = await databaseState();
  const result = await read();
  const after = await databaseState();
  expect(after).toBe(before);
  return result;
}

async function installFixture(): Promise<void> {
  if (!owner) throw new Error("Disposable authorization owner is unavailable.");
  await owner.query(`
    INSERT INTO organizations (id,name,slug,settings,is_active,signal_tenant_id) VALUES
      (1,'Fixture org one','fixture-org-one','{}'::jsonb,true,NULL),
      (2,'Fixture org two','fixture-org-two','{}'::jsonb,true,NULL);
    INSERT INTO users (id,username,password,role,email_verified,first_name,last_name) VALUES
      (101,'primary@example.invalid','x','recruiter',true,'Primary','Recruiter'),
      (102,'co@example.invalid','x','recruiter',true,'Co','Recruiter'),
      (103,'unassigned@example.invalid','x','recruiter',true,'Unassigned','Recruiter'),
      (104,'unseated@example.invalid','x','recruiter',true,'Unseated','Recruiter'),
      (105,'removed@example.invalid','x','recruiter',true,'Removed','Recruiter'),
      (201,'foreign@example.invalid','x','recruiter',true,'Foreign','Recruiter'),
      (301,'candidate@example.invalid','x','candidate',true,'Test','Candidate'),
      (302,'hm@example.invalid','x','hiring_manager',true,'Test','Manager'),
      (303,'zeta-foreign-hm@example.invalid','x','hiring_manager',true,'Foreign','Manager'),
      (304,'alpha-invited-hm@example.invalid','x','hiring_manager',true,'Invited','Manager'),
      (305,'beta-foreign-invite@example.invalid','x','hiring_manager',true,'Other','Manager'),
      (306,'invited-recruiter@example.invalid','x','recruiter',true,'Wrong','Role'),
      (307,'pending-hm@example.invalid','x','hiring_manager',true,'Pending','Manager'),
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
      (1001,1,'Fixture Role One','Remote','full-time','Fixture description','Fixture description',101,302,false,'pending','fixture-role-one'),
      (1002,2,'Fixture Role Two','Remote','full-time','Fixture description','Fixture description',201,303,false,'pending','fixture-role-two'),
      (1003,NULL,'Null-org Role','Remote','full-time','Fixture description','Fixture description',101,NULL,false,'pending','null-org-role'),
      (1004,2,'Mismatched Role','Remote','full-time','Fixture description','Fixture description',101,NULL,false,'pending','mismatched-role');
    INSERT INTO job_recruiters (id,organization_id,job_id,recruiter_id,added_by) VALUES
      (1,1,1001,102,101),
      (2,1,1001,105,101);
    INSERT INTO hiring_manager_invitations
      (id,email,name,token,invited_by,inviter_name,expires_at,status,accepted_at)
    VALUES
      (1,'hm@example.invalid','Duplicate manager','fixture-hm-token-1',101,'Primary','2099-01-01','accepted','2026-08-26'),
      (2,'alpha-invited-hm@example.invalid','Invited manager','fixture-hm-token-2',101,'Primary','2099-01-01','accepted','2026-08-26'),
      (3,'beta-foreign-invite@example.invalid','Foreign invited manager','fixture-hm-token-3',201,'Foreign','2099-01-01','accepted','2026-08-26'),
      (4,'invited-recruiter@example.invalid','Wrong role','fixture-hm-token-4',101,'Primary','2099-01-01','accepted','2026-08-26'),
      (5,'pending-hm@example.invalid','Pending manager','fixture-hm-token-5',101,'Primary','2099-01-01','pending',NULL);
    INSERT INTO candidate_resumes (id,user_id,label,gcs_path,extracted_text,is_default)
    VALUES (9001,301,'Fallback resume','gs://configured/resumes/fallback.pdf','candidate-resume fallback',true);
    INSERT INTO applications
      (id,organization_id,job_id,user_id,resume_id,name,email,phone,resume_url,resume_filename,
       extracted_resume_text,cover_letter,status,current_stage,submitted_by_recruiter,
       created_by_user_id,source,source_metadata,whatsapp_consent,
       platform_discovery_consent,consent_captured_at,
       interview_date,interview_time,interview_location,interview_notes)
    VALUES
      (2001,1,1001,301,NULL,'Fixture Candidate','fixture@example.invalid','0000000000','https://invalid/resume','fixture.pdf',
       'fixture resume',NULL,'submitted',NULL,true,101,'authorization_fixture','{}'::jsonb,false,false,NULL,
       '2099-01-15T00:00:00Z','10:30','Synthetic room','Synthetic authorization proof'),
      (2002,2,1002,NULL,NULL,'Foreign Candidate','foreign-candidate@example.invalid','0000000000','https://invalid/resume','fixture.pdf',
       NULL,NULL,'submitted',NULL,true,201,'authorization_fixture','{}'::jsonb,false,false,NULL,
       '2099-01-16T00:00:00Z','11:00',NULL,NULL),
      (2003,NULL,1003,NULL,NULL,'Null Candidate','null@example.invalid','0000000000','https://invalid/resume','fixture.pdf',
       'fixture resume',NULL,'submitted',NULL,true,101,'authorization_fixture','{}'::jsonb,false,false,NULL,
       NULL,NULL,NULL,NULL),
      (2004,1,1004,NULL,NULL,'Mismatch Candidate','mismatch@example.invalid','0000000000','https://invalid/resume','fixture.pdf',
       'fixture resume',NULL,'submitted',NULL,true,101,'authorization_fixture','{}'::jsonb,false,false,NULL,
       NULL,NULL,NULL,NULL),
      (2005,1,1001,301,NULL,'Blocked Candidate','blocked@example.invalid','0000000000','https://invalid/resume','fixture.pdf',
       'fixture resume',NULL,'submitted',NULL,true,101,'authorization_fixture','{}'::jsonb,false,false,NULL,
       '2099-01-15T00:00:00Z','10:30',NULL,NULL),
      (2006,1,1001,NULL,NULL,'Review Candidate','review@example.invalid','0000000000','https://invalid/resume','fixture.pdf',
       'fixture resume',NULL,'submitted',NULL,true,101,'authorization_fixture','{}'::jsonb,false,false,NULL,
       '2099-01-15T00:00:00Z','10:30',NULL,NULL),
      (2007,1,1001,NULL,NULL,'Global Optout Candidate','global@example.invalid','0000000000','https://invalid/resume','fixture.pdf',
       'fixture resume',NULL,'submitted',NULL,true,101,'authorization_fixture','{}'::jsonb,false,false,NULL,
       '2099-01-15T00:00:00Z','10:30',NULL,NULL),
      (2008,1,1001,NULL,9001,'Empty Candidate','empty@example.invalid','0000000000','https://invalid/resume','fixture.pdf',
       NULL,NULL,'submitted',NULL,true,101,'authorization_fixture','{}'::jsonb,false,false,NULL,
       NULL,NULL,NULL,NULL);
    INSERT INTO application_stage_history (id,application_id,from_stage,to_stage,changed_by,notes,changed_at) VALUES
      (3001,2001,NULL,1,101,'Created','2026-08-26T09:00:00Z'),
      (3002,2001,1,2,101,'Reviewed','2026-08-26T10:00:00Z');
    INSERT INTO email_templates (id,name,subject,body,template_type,created_by,is_default,organization_id) VALUES
      (6001,'Status update','Fixture subject','Fixture body','status_update',101,false,1);
    INSERT INTO email_audit_log
      (id,application_id,template_id,template_type,recipient_email,subject,sent_at,sent_by,status,error_message,preview_url)
    VALUES
      (5001,2001,6001,'status_update','fixture@example.invalid','private subject','2026-08-26T11:00:00Z',101,'success',NULL,'https://invalid/private'),
      (5002,2001,NULL,NULL,'fixture@example.invalid','private subject','2026-08-26T10:30:00Z',NULL,'success',NULL,NULL);
    INSERT INTO whatsapp_templates
      (id,name,meta_template_name,meta_template_id,language,template_type,category,body_template,status,rejection_reason,created_at)
    VALUES
      (7001,'Interview update','fixture_interview_update','meta-private','en','interview_invite','UTILITY','Private body {{1}}','approved',NULL,'2026-08-26T08:00:00Z');
    INSERT INTO whatsapp_audit_log
      (id,application_id,template_id,template_type,recipient_phone,message_id,status,error_code,error_message,
       template_variables,sent_at,delivered_at,read_at,sent_by)
    VALUES
      (8001,2001,7001,'interview_invite','+15550000001','provider-private-1','read','private-code','private error',
       '{"candidate":"private variable"}'::jsonb,'2026-08-26T12:00:00Z','2026-08-26T12:01:00Z','2026-08-26T12:02:00Z',101),
      (8002,2001,NULL,NULL,'+15550000002','provider-private-2','failed','private-code','private error',
       '{"candidate":"private variable"}'::jsonb,'2026-08-26T11:30:00Z',NULL,NULL,NULL),
      (8003,2002,NULL,'authorization_fixture_2d','+15550000003',NULL,'authorization_fixture',NULL,NULL,
       NULL,'2026-08-26T11:00:00Z',NULL,NULL,201);
    INSERT INTO candidate_privacy_requests
      (request_id,directive_id,action,authority_type,actor_user_id,reason_code,state,version,last_delivery_status)
    VALUES
      ('00000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000005','request_erasure','verified_candidate',301,'candidate_erasure_request','memory_active',1,'delivered'),
      ('00000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000006','request_erasure','verified_candidate',301,'candidate_erasure_request','needs_review',1,'delivered'),
      ('00000000-0000-0000-0000-000000000007','10000000-0000-0000-0000-000000000007','withdraw_global_matching','verified_candidate',301,'candidate_global_opt_out','memory_active',1,'delivered');
    INSERT INTO candidate_privacy_subject_links
      (link_id,request_id,subject_type,application_id,organization_id)
    VALUES
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

describe.skipIf(!enabled)("application read authorization exact-schema PostgreSQL", () => {
  beforeAll(async () => {
    if (process.env.NODE_ENV !== "test") {
      throw new Error("Disposable authorization integration requires NODE_ENV=test.");
    }
    const migrationTarget = assertSafeUrl(migrationUrl, "migration");
    const runtimeTarget = assertSafeUrl(runtimeUrl, "runtime");
    if (migrationTarget.pathname !== runtimeTarget.pathname) {
      throw new Error("Disposable authorization database identity mismatch.");
    }

    const migration = await clientFor(migrationUrl);
    const runtime = await clientFor(runtimeUrl);
    try {
      const ownerIdentity = (await migration.query(
        "SELECT current_database() AS database,current_user AS role,host(inet_server_addr()) AS server_addr",
      )).rows[0] ?? {};
      const runtimeIdentity = (await runtime.query(
        "SELECT current_database() AS database,current_user AS role,host(inet_server_addr()) AS server_addr",
      )).rows[0] ?? {};
      const local = (value: unknown) => [null, "127.0.0.1", "::1"].includes(value as never);
      if (
        !String(ownerIdentity.database ?? "").includes("_test")
        || !String(ownerIdentity.role ?? "").includes("_test_")
        || !local(ownerIdentity.server_addr)
        || runtimeIdentity.database !== ownerIdentity.database
        || !String(runtimeIdentity.role ?? "").includes("_test_")
        || runtimeIdentity.role === "flow_runtime"
        || !local(runtimeIdentity.server_addr)
      ) {
        throw new Error("Refusing authorization integration: disposable target proof failed.");
      }
      safeTargetProven = true;
    } finally {
      await runtime.end();
      await migration.end();
    }

    await resetDatabase();
    await runReleaseMigration({
      migrationsDir,
      creds: {
        migrateUrl: migrationUrl,
        expectedTargetId: targetId,
        environment: "development",
        allowFreshInitialization: true,
      },
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
    await installFixture();
    process.env.DATABASE_URL = runtimeUrl;
    process.env.DATABASE_SSL = "false";
    authorization = await import("../lib/applicationReadAuthorization");
    membershipAuthorization = await import("../lib/membershipScopedReadAuthorization");
    authModule = await import("../auth");
    storageModule = await import("../storage");
    runtimePool = (await import("../db")).pool;
  }, 180_000);

  afterAll(async () => {
    await runtimePool?.end();
    await owner?.end();
    if (safeTargetProven) await resetDatabase();
  });

  const stage = (actorId: number, applicationId: number, allowPlatformAdmin = true) =>
    readWithoutMutation(() => authorization.readAuthorizedApplicationStageHistory(
      actorId,
      applicationId,
      { allowPlatformAdmin },
    ));

  const email = (actorId: number, applicationId: number, allowPlatformAdmin = true) =>
    readWithoutMutation(() => authorization.readAuthorizedApplicationEmailHistory(
      actorId,
      applicationId,
      { allowPlatformAdmin },
    ));

  const interview = (actorId: number, applicationId: number, allowPlatformAdmin = true) =>
    readWithoutMutation(() => authorization.readAuthorizedApplicationInterviewInvite(
      actorId,
      applicationId,
      { allowPlatformAdmin },
    ));

  const whatsapp = (actorId: number, applicationId: number, allowPlatformAdmin = true) =>
    readWithoutMutation(() => authorization.readAuthorizedApplicationWhatsAppHistory(
      actorId,
      applicationId,
      { allowPlatformAdmin },
    ));

  const resumeFile = (actorId: number, applicationId: number, allowPlatformAdmin = true) =>
    readWithoutMutation(() => authorization.readAuthorizedApplicationResumeFile(
      actorId,
      applicationId,
      { allowPlatformAdmin },
    ));

  const resumeText = (actorId: number, applicationId: number, allowPlatformAdmin = true) =>
    readWithoutMutation(() => authorization.readAuthorizedApplicationResumeText(
      actorId,
      applicationId,
      { allowPlatformAdmin },
    ));

  const directory = (actorId: number, allowPlatformAdmin = true) =>
    readWithoutMutation(() => membershipAuthorization.readAuthorizedHiringManagerDirectory(
      actorId,
      { allowPlatformAdmin },
    ));

  async function seatAdmission(actorId: number, role = "recruiter") {
    const middleware = authModule.requireSeat();
    const result: { status?: number; body?: unknown; next: boolean } = { next: false };
    const req = { user: { id: actorId, role } } as any;
    const res = {
      status(code: number) { result.status = code; return this; },
      json(body: unknown) { result.body = body; return this; },
    } as any;
    await middleware(req, res, () => { result.next = true; });
    return result;
  }

  it("installs the exact pinned four-migration schema before testing", async () => {
    if (!owner) throw new Error("Disposable authorization owner is unavailable.");
    const state = (await owner.query(`
      SELECT (SELECT count(*)::int FROM schema_control.applied) AS applied,
             (SELECT data_type FROM information_schema.columns
               WHERE table_schema='public' AND table_name='applications' AND column_name='interview_date') AS interview_type,
             (SELECT count(*)::int FROM information_schema.columns
               WHERE table_schema='public' AND table_name='candidate_privacy_remote_projection') AS privacy_columns,
             to_regclass('public.resume_access_attempts')::text AS resume_audit
    `)).rows[0];
    expect(state).toEqual({
      applied: 4,
      interview_type: "timestamp without time zone",
      privacy_columns: 10,
      resume_audit: "resume_access_attempts",
    });
  });

  it("returns the deduplicated current-org hiring-manager directory in deterministic order", async () => {
    const primary = await directory(101);
    const co = await directory(102);
    expect(primary).toEqual(co);
    expect(primary).toEqual({ ok: true, rows: [
      {
        id: 304,
        username: "alpha-invited-hm@example.invalid",
        firstName: "Invited",
        lastName: "Manager",
        role: "hiring_manager",
      },
      {
        id: 302,
        username: "hm@example.invalid",
        firstName: "Test",
        lastName: "Manager",
        role: "hiring_manager",
      },
    ] });
    expect(Object.keys(primary.ok ? primary.rows[0]! : {})).toEqual([
      "id", "username", "firstName", "lastName", "role",
    ]);
  });

  it("keeps foreign, non-hiring-manager and pending invitation rows out of recruiter results", async () => {
    const encoded = JSON.stringify(await directory(101));
    for (const forbidden of [
      "zeta-foreign-hm", "beta-foreign-invite", "invited-recruiter", "pending-hm",
      "password", "emailVerificationToken", "aiContentFreeUsed",
    ]) expect(encoded).not.toContain(forbidden);
    await expect(directory(201)).resolves.toEqual({ ok: true, rows: [
      {
        id: 305,
        username: "beta-foreign-invite@example.invalid",
        firstName: "Other",
        lastName: "Manager",
        role: "hiring_manager",
      },
      {
        id: 303,
        username: "zeta-foreign-hm@example.invalid",
        firstName: "Foreign",
        lastName: "Manager",
        role: "hiring_manager",
      },
    ] });
  });

  it("returns authorized empty for unseated, removed-membership and unsupported actors", async () => {
    for (const actorId of [104, 105, 301, 302]) {
      await expect(directory(actorId)).resolves.toEqual({ ok: true, rows: [] });
    }
  });

  it("real current-seat admission denies unseated and no-org retained-assignment recruiters", async () => {
    await expect(readWithoutMutation(() => seatAdmission(104))).resolves.toEqual({
      status: 403,
      body: {
        error: "Seat required",
        code: "NO_SEAT",
        message: "Your seat has been removed. Contact your organization owner.",
      },
      next: false,
    });
    await expect(readWithoutMutation(() => seatAdmission(105))).resolves.toEqual({
      status: 403,
      body: {
        error: "Organization required",
        code: "NO_ORGANIZATION",
        message: "You must create or join an organization to continue.",
      },
      next: false,
    });
    await expect(readWithoutMutation(() => seatAdmission(101))).resolves.toMatchObject({ next: true });
  });

  it("keeps platform administration explicit and minimum-projection-only", async () => {
    const allowed = await directory(401, true);
    expect(allowed.ok && allowed.rows.map((row) => row.id)).toEqual([304, 305, 302, 307, 303]);
    expect(allowed.ok && allowed.rows.every((row) => Object.keys(row).length === 5)).toBe(true);
    await expect(directory(401, false)).resolves.toEqual({ ok: true, rows: [] });
  });

  it("allows primary and exact co-recruiters with deterministic minimum stage rows", async () => {
    const primary = await stage(101, 2001);
    const co = await stage(102, 2001);
    expect(primary).toEqual(co);
    expect(primary).toEqual({ ok: true, rows: [
      { fromStage: 1, toStage: 2, changedAt: "2026-08-26T10:00:00.000Z", notes: "Reviewed" },
      { fromStage: null, toStage: 1, changedAt: "2026-08-26T09:00:00.000Z", notes: "Created" },
    ] });
    expect(Object.keys(primary.ok ? primary.rows[0]! : {})).toEqual([
      "fromStage", "toStage", "changedAt", "notes",
    ]);
  });

  it("allows the other organization recruiter only for its own exact job", async () => {
    await expect(stage(201, 2002)).resolves.toEqual({ ok: true, rows: [] });
    await expect(stage(201, 2001)).resolves.toEqual({ ok: false, reason: "not_found" });
  });

  it.each([
    [103, "same-org unassigned"],
    [104, "unseated"],
    [105, "removed membership"],
    [301, "candidate"],
    [302, "hiring manager"],
  ])("denies %s (%s) without distinguishing absence", async (actorId) => {
    await expect(stage(Number(actorId), 2001)).resolves.toEqual({ ok: false, reason: "not_found" });
  });

  it("makes platform administration explicit and preserves structural object denial", async () => {
    await expect(stage(401, 2001, true)).resolves.toMatchObject({ ok: true });
    await expect(stage(401, 2001, false)).resolves.toEqual({ ok: false, reason: "not_found" });
    await expect(stage(401, 2003, true)).resolves.toEqual({ ok: false, reason: "not_found" });
    await expect(stage(401, 2004, true)).resolves.toEqual({ ok: false, reason: "not_found" });
  });

  it("denies block_all and review while preserving own-org block_global history", async () => {
    await expect(stage(101, 2005)).resolves.toEqual({ ok: false, reason: "not_found" });
    await expect(stage(101, 2006)).resolves.toEqual({ ok: false, reason: "not_found" });
    await expect(stage(101, 2007)).resolves.toEqual({ ok: true, rows: [] });
  });

  it("returns authorized empty history and identical missing denial", async () => {
    await expect(stage(101, 2008)).resolves.toEqual({ ok: true, rows: [] });
    await expect(stage(101, 999999)).resolves.toEqual({ ok: false, reason: "not_found" });
  });

  it("returns the exact email projection, deterministic order and legacy coalesces", async () => {
    const result = await email(101, 2001);
    expect(result).toEqual({ ok: true, rows: [
      {
        id: 5001,
        templateName: "Status update",
        templateType: "status_update",
        recipientEmail: "fixture@example.invalid",
        sentAt: "2026-08-26T11:00:00.000Z",
        status: "success",
        sentBy: { firstName: "Primary", lastName: "Recruiter" },
      },
      {
        id: 5002,
        templateName: "Manual email",
        templateType: "manual",
        recipientEmail: "fixture@example.invalid",
        sentAt: "2026-08-26T10:30:00.000Z",
        status: "success",
        sentBy: null,
      },
    ] });
    expect(Object.keys(result.ok ? result.rows[0]! : {})).toEqual([
      "id", "templateName", "templateType", "recipientEmail", "sentAt", "status", "sentBy",
    ]);
    expect(JSON.stringify(result)).not.toContain("private subject");
    expect(JSON.stringify(result)).not.toContain("previewUrl");
  });

  it("applies the same object and privacy boundary to email history", async () => {
    await expect(email(201, 2001)).resolves.toEqual({ ok: false, reason: "not_found" });
    await expect(email(103, 2001)).resolves.toEqual({ ok: false, reason: "not_found" });
    await expect(email(101, 2005)).resolves.toEqual({ ok: false, reason: "not_found" });
    await expect(email(101, 2006)).resolves.toEqual({ ok: false, reason: "not_found" });
    await expect(email(101, 2007)).resolves.toEqual({ ok: true, rows: [] });
    await expect(email(401, 2001, true)).resolves.toMatchObject({ ok: true });
    await expect(email(401, 2001, false)).resolves.toEqual({ ok: false, reason: "not_found" });
  });

  it("returns the exact seven-field interview projection for primary and co-recruiters", async () => {
    const expected = {
      ok: true,
      interview: {
        candidateName: "Fixture Candidate",
        candidateEmail: "fixture@example.invalid",
        jobTitle: "Fixture Role One",
        interviewDate: "2099-01-15T00:00:00.000Z",
        interviewTime: "10:30",
        interviewLocation: "Synthetic room",
        interviewNotes: "Synthetic authorization proof",
      },
    };
    const primary = await interview(101, 2001);
    const co = await interview(102, 2001);
    expect(primary).toEqual(expected);
    expect(co).toEqual(expected);
    expect(Object.keys(primary.ok ? primary.interview : {})).toEqual([
      "candidateName",
      "candidateEmail",
      "jobTitle",
      "interviewDate",
      "interviewTime",
      "interviewLocation",
      "interviewNotes",
    ]);
  });

  it("applies the complete object boundary to the interview projection", async () => {
    await expect(interview(201, 2002)).resolves.toMatchObject({ ok: true });
    await expect(interview(201, 2001)).resolves.toEqual({ ok: false, reason: "not_found" });
    await expect(interview(103, 2001)).resolves.toEqual({ ok: false, reason: "not_found" });
    await expect(interview(104, 2001)).resolves.toEqual({ ok: false, reason: "not_found" });
    await expect(interview(105, 2001)).resolves.toEqual({ ok: false, reason: "not_found" });
    await expect(interview(301, 2001)).resolves.toEqual({ ok: false, reason: "not_found" });
    await expect(interview(302, 2001)).resolves.toEqual({ ok: false, reason: "not_found" });
    await expect(interview(101, 999999)).resolves.toEqual({ ok: false, reason: "not_found" });
  });

  it("keeps platform administration explicit and structural for interview reads", async () => {
    await expect(interview(401, 2001, true)).resolves.toMatchObject({ ok: true });
    await expect(interview(401, 2001, false)).resolves.toEqual({ ok: false, reason: "not_found" });
    await expect(interview(401, 2003, true)).resolves.toEqual({ ok: false, reason: "not_found" });
    await expect(interview(401, 2004, true)).resolves.toEqual({ ok: false, reason: "not_found" });
  });

  it("denies block_all and review while preserving own-org block_global interview reads", async () => {
    await expect(interview(101, 2005)).resolves.toEqual({ ok: false, reason: "not_found" });
    await expect(interview(101, 2006)).resolves.toEqual({ ok: false, reason: "not_found" });
    await expect(interview(101, 2007)).resolves.toMatchObject({ ok: true });
  });

  it("returns the exact ordered WhatsApp status projection without raw audit or template fields", async () => {
    const result = await whatsapp(101, 2001);
    expect(result).toEqual({ ok: true, rows: [
      {
        templateName: "Interview update",
        templateType: "interview_invite",
        status: "read",
        sentAt: "2026-08-26T12:00:00.000Z",
        deliveredAt: "2026-08-26T12:01:00.000Z",
        readAt: "2026-08-26T12:02:00.000Z",
        sentBy: { firstName: "Primary", lastName: "Recruiter" },
      },
      {
        templateName: "WhatsApp update",
        templateType: "unknown",
        status: "failed",
        sentAt: "2026-08-26T11:30:00.000Z",
        deliveredAt: null,
        readAt: null,
        sentBy: null,
      },
    ] });
    expect(Object.keys(result.ok ? result.rows[0]! : {})).toEqual([
      "templateName",
      "templateType",
      "status",
      "sentAt",
      "deliveredAt",
      "readAt",
      "sentBy",
    ]);
    const encoded = JSON.stringify(result);
    for (const forbidden of [
      "+15550000001",
      "provider-private",
      "private-code",
      "private error",
      "private variable",
      "Private body",
      "meta-private",
      "applicationId",
      "templateId",
      "messageId",
    ]) expect(encoded).not.toContain(forbidden);
  });

  it("applies the complete actor and object boundary to WhatsApp history", async () => {
    await expect(whatsapp(201, 2002)).resolves.toMatchObject({ ok: true });
    await expect(whatsapp(201, 2001)).resolves.toEqual({ ok: false, reason: "not_found" });
    for (const actorId of [103, 104, 105, 301, 302]) {
      await expect(whatsapp(actorId, 2001)).resolves.toEqual({ ok: false, reason: "not_found" });
    }
    await expect(whatsapp(101, 999999)).resolves.toEqual({ ok: false, reason: "not_found" });
    await expect(whatsapp(101, 2003)).resolves.toEqual({ ok: false, reason: "not_found" });
    await expect(whatsapp(101, 2004)).resolves.toEqual({ ok: false, reason: "not_found" });
  });

  it("keeps platform administration explicit for WhatsApp history", async () => {
    await expect(whatsapp(401, 2001, true)).resolves.toMatchObject({ ok: true });
    await expect(whatsapp(401, 2001, false)).resolves.toEqual({ ok: false, reason: "not_found" });
    await expect(whatsapp(401, 2003, true)).resolves.toEqual({ ok: false, reason: "not_found" });
    await expect(whatsapp(401, 2004, true)).resolves.toEqual({ ok: false, reason: "not_found" });
  });

  it("preserves privacy semantics and the authorized-empty WhatsApp sentinel", async () => {
    await expect(whatsapp(101, 2005)).resolves.toEqual({ ok: false, reason: "not_found" });
    await expect(whatsapp(101, 2006)).resolves.toEqual({ ok: false, reason: "not_found" });
    await expect(whatsapp(101, 2007)).resolves.toEqual({ ok: true, rows: [] });
    await expect(whatsapp(101, 2008)).resolves.toEqual({ ok: true, rows: [] });
  });

  it("applies the full recruiter, hiring-manager, candidate-self, and admin resume-file matrix", async () => {
    const own = await resumeFile(101, 2001);
    const co = await resumeFile(102, 2001);
    const manager = await resumeFile(302, 2001);
    expect(own).toEqual(co);
    expect(own).toEqual(manager);
    expect(own).toEqual({
      ok: true,
      resume: {
        applicationId: 2001,
        organizationId: 1,
        resumeUrl: "https://invalid/resume",
        resumeFilename: "fixture.pdf",
      },
    });
    expect(Object.keys(own.ok ? own.resume : {})).toEqual([
      "applicationId", "organizationId", "resumeUrl", "resumeFilename",
    ]);

    for (const actorId of [103, 104, 105, 201]) {
      await expect(resumeFile(actorId, 2001)).resolves.toEqual({ ok: false, reason: "not_found" });
    }
    await expect(resumeFile(302, 2002)).resolves.toEqual({ ok: false, reason: "not_found" });
    await expect(resumeFile(301, 2001)).resolves.toMatchObject({ ok: true });
    await expect(resumeFile(301, 2002)).resolves.toEqual({ ok: false, reason: "not_found" });
    await expect(resumeFile(401, 2001, true)).resolves.toMatchObject({ ok: true });
    await expect(resumeFile(401, 2001, false)).resolves.toEqual({ ok: false, reason: "not_found" });
    await expect(resumeFile(101, 999999)).resolves.toEqual({ ok: false, reason: "not_found" });
  });

  it("makes candidate-self independent of privacy while preserving non-candidate structural/privacy denial", async () => {
    await expect(resumeFile(301, 2005)).resolves.toMatchObject({ ok: true });
    await expect(resumeFile(101, 2005)).resolves.toEqual({ ok: false, reason: "not_found" });
    await expect(resumeFile(101, 2006)).resolves.toEqual({ ok: false, reason: "not_found" });
    await expect(resumeFile(101, 2007)).resolves.toMatchObject({ ok: true });
    await expect(resumeFile(101, 2003)).resolves.toEqual({ ok: false, reason: "not_found" });
    await expect(resumeFile(101, 2004)).resolves.toEqual({ ok: false, reason: "not_found" });
  });

  it("returns only stored application text or same-statement candidate-resume fallback", async () => {
    await expect(resumeText(101, 2001)).resolves.toEqual({
      ok: true,
      resume: { applicationId: 2001, organizationId: 1, text: "fixture resume" },
    });
    const fallback = await resumeText(101, 2008);
    expect(fallback).toEqual({
      ok: true,
      resume: { applicationId: 2008, organizationId: 1, text: "candidate-resume fallback" },
    });
    expect(Object.keys(fallback.ok ? fallback.resume : {})).toEqual([
      "applicationId", "organizationId", "text",
    ]);
    await expect(resumeText(201, 2002)).resolves.toEqual({
      ok: true,
      resume: { applicationId: 2002, organizationId: 2, text: null },
    });
  });

  it("keeps resume-text on the recruiter/admin matrix and existing privacy fence", async () => {
    await expect(resumeText(102, 2001)).resolves.toMatchObject({ ok: true });
    for (const actorId of [103, 104, 105, 201, 301, 302]) {
      await expect(resumeText(actorId, 2001)).resolves.toEqual({ ok: false, reason: "not_found" });
    }
    await expect(resumeText(401, 2001, true)).resolves.toMatchObject({ ok: true });
    await expect(resumeText(401, 2001, false)).resolves.toEqual({ ok: false, reason: "not_found" });
    await expect(resumeText(101, 2005)).resolves.toEqual({ ok: false, reason: "not_found" });
    await expect(resumeText(101, 2006)).resolves.toEqual({ ok: false, reason: "not_found" });
    await expect(resumeText(101, 2007)).resolves.toMatchObject({ ok: true });
    await expect(resumeText(101, 2003)).resolves.toEqual({ ok: false, reason: "not_found" });
    await expect(resumeText(101, 2004)).resolves.toEqual({ ok: false, reason: "not_found" });
  });

  it("persists one attributable attempt and terminalizes it once with legacy timestamp only on completed stream", async () => {
    if (!owner) throw new Error("Disposable authorization owner is unavailable.");
    const attemptId = "30000000-0000-0000-0000-000000000001";
    await expect(storageModule.storage.createResumeAccessAttempt({
      attemptId,
      applicationId: 2001,
      organizationId: 1,
      actorUserId: 101,
      actorRole: "recruiter",
      deliveryMode: "gcs_stream",
    })).resolves.toBe(true);
    await expect(storageModule.storage.terminalizeResumeAccessAttempt({
      attemptId,
      status: "completed",
      responseStatus: 200,
      failureCode: null,
      updateLegacyDownloadedAt: true,
    })).resolves.toBe(true);
    await expect(storageModule.storage.terminalizeResumeAccessAttempt({
      attemptId,
      status: "failed",
      responseStatus: 500,
      failureCode: "SECOND_TERMINAL",
      updateLegacyDownloadedAt: false,
    })).resolves.toBe(false);

    const state = (await owner.query(`
      SELECT a.status,a.failure_code,a.response_status,(a.terminal_at IS NOT NULL) AS terminal,
             (app.downloaded_at IS NOT NULL) AS downloaded,
             (app.updated_at=app.downloaded_at) AS legacy_atomic
        FROM resume_access_attempts a
        JOIN applications app ON app.id=a.application_id
       WHERE a.attempt_id=$1
    `, [attemptId])).rows[0];
    expect(state).toEqual({
      status: "completed",
      failure_code: null,
      response_status: 200,
      terminal: true,
      downloaded: true,
      legacy_atomic: true,
    });
  });

  it("does not update legacy timestamps for redirects, failures, candidate, or platform-admin access", async () => {
    if (!owner) throw new Error("Disposable authorization owner is unavailable.");
    const cases = [
      ["30000000-0000-0000-0000-000000000002", 2002, 201, "recruiter", "http_redirect", "redirected", 302, null],
      ["30000000-0000-0000-0000-000000000003", 2003, 101, "recruiter", "missing", "failed", 404, "RESUME_MISSING"],
      ["30000000-0000-0000-0000-000000000004", 2005, 301, "candidate", "gcs_stream", "completed", 200, null],
      ["30000000-0000-0000-0000-000000000005", 2006, 401, "super_admin", "gcs_stream", "completed", 200, null],
    ] as const;
    for (const [attemptId, applicationId, actorUserId, actorRole, deliveryMode, status, responseStatus, failureCode] of cases) {
      await expect(storageModule.storage.createResumeAccessAttempt({
        attemptId,
        applicationId,
        organizationId: applicationId === 2003 ? null : applicationId === 2002 ? 2 : 1,
        actorUserId,
        actorRole,
        deliveryMode,
      })).resolves.toBe(true);
      await expect(storageModule.storage.terminalizeResumeAccessAttempt({
        attemptId,
        status,
        responseStatus,
        failureCode,
        updateLegacyDownloadedAt: false,
      })).resolves.toBe(true);
    }
    const unchanged = await owner.query(
      "SELECT count(*)::int AS n FROM applications WHERE id IN (2002,2003,2005,2006) AND downloaded_at IS NULL",
    );
    expect(unchanged.rows[0]?.n).toBe(4);
  });

  it("enforces audit constraints and nulls the application reference on deletion", async () => {
    if (!owner) throw new Error("Disposable authorization owner is unavailable.");
    await expect(owner.query(`
      INSERT INTO resume_access_attempts(attempt_id,actor_role,delivery_mode,status)
      VALUES ('30000000-0000-0000-0000-000000000006','candidate','raw_object','attempted')
    `)).rejects.toMatchObject({ code: "23514" });

    await owner.query(`
      INSERT INTO applications
        (id,organization_id,job_id,name,email,phone,resume_url,status,source,source_metadata,
         whatsapp_consent,platform_discovery_consent)
      VALUES (2099,1,1001,'Delete fixture','delete@example.invalid','0000000000','fixture://delete','submitted',
              'authorization_fixture','{}'::jsonb,false,false)
    `);
    const attemptId = "30000000-0000-0000-0000-000000000007";
    await expect(storageModule.storage.createResumeAccessAttempt({
      attemptId,
      applicationId: 2099,
      organizationId: 1,
      actorUserId: 101,
      actorRole: "recruiter",
      deliveryMode: "missing",
    })).resolves.toBe(true);
    await owner.query("DELETE FROM applications WHERE id=2099");
    const row = (await owner.query(
      "SELECT application_id,organization_id,actor_user_id,status FROM resume_access_attempts WHERE attempt_id=$1",
      [attemptId],
    )).rows[0];
    expect(row).toEqual({ application_id: null, organization_id: 1, actor_user_id: 101, status: "attempted" });
  });
});
