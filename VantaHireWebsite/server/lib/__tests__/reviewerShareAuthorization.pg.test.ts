import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
const token = "a".repeat(64);
const candidateRef = "123e4567-e89b-42d3-a456-426614174000";

type Module = typeof import("../reviewerShareAuthorization");
let authorization: Module;
let owner: Client | undefined;
let runtimePool: { end(): Promise<void> } | undefined;
let safeTargetProven = false;
let priorDir: string | undefined;

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
  if (!local || !parsed.pathname.includes("_test")) throw new Error(`Disposable 2I ${label} target refused.`);
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

function buildPriorManifest(): string {
  const dir = mkdtempSync(join(tmpdir(), "flow-2i-prior-manifest-"));
  for (const file of [
    "0000_baseline.sql", "0001_candidate_privacy_flow.sql", "0002_resume_access_attempts.sql",
    "0003_application_workflow_assessments.sql", "catalog.lock.json",
  ]) copyFileSync(join(migrationsDir, file), join(dir, file));
  const lock = JSON.parse(readFileSync(join(migrationsDir, "checksums.lock"), "utf8")) as {
    format_version: number; catalog_lock_sha256: string; migrations: Record<string, string>;
  };
  writeFileSync(join(dir, "checksums.lock"), `${JSON.stringify({
    format_version: lock.format_version,
    catalog_lock_sha256: lock.catalog_lock_sha256,
    migrations: Object.fromEntries(Object.entries(lock.migrations).filter(([id]) => id <= "0003")),
  }, null, 2)}\n`);
  return dir;
}

async function installFixture(): Promise<void> {
  if (!owner) throw new Error("Disposable 2I owner unavailable.");
  await owner.query(`
    INSERT INTO organizations (id,name,slug,settings,is_active,signal_tenant_id) VALUES
      (1,'Reviewer share org one','reviewer-share-org-one','{}'::jsonb,true,NULL),
      (2,'Reviewer share org two','reviewer-share-org-two','{}'::jsonb,true,NULL);
    INSERT INTO users (id,username,password,role,email_verified,first_name,last_name) VALUES
      (101,'primary@example.invalid','x','recruiter',true,'Primary','Recruiter'),
      (102,'co@example.invalid','x','recruiter',true,'Co','Recruiter'),
      (103,'unseated@example.invalid','x','recruiter',true,'Unseated','Recruiter'),
      (104,'no-org@example.invalid','x','recruiter',true,'NoOrg','Recruiter'),
      (106,'moved@example.invalid','x','recruiter',true,'Moved','Recruiter'),
      (201,'foreign@example.invalid','x','recruiter',true,'Foreign','Recruiter'),
      (301,'candidate@example.invalid','x','candidate',true,'Fixture','Candidate'),
      (401,'admin@example.invalid','x','super_admin',true,'Platform','Admin');
    INSERT INTO organization_members
      (id,organization_id,user_id,role,seat_assigned,credits_allocated,credits_used,credits_rollover,invited_by)
    VALUES
      (1,1,101,'owner',true,0,0,0,NULL),
      (2,1,102,'member',true,0,0,0,101),
      (3,1,103,'member',false,0,0,0,101),
      (4,2,106,'member',true,0,0,0,201),
      (5,2,201,'owner',true,0,0,0,NULL);
    INSERT INTO clients (id,organization_id,name,created_by) VALUES
      (501,1,'Client One',101),(502,2,'Client Two',201);
    INSERT INTO jobs
      (id,organization_id,title,location,type,description,original_jd,posted_by,client_id,is_active,status,slug)
    VALUES
      (1001,1,'Role One','Remote','full-time','Description','Fixture',101,501,false,'pending','reviewer-role-one'),
      (1002,1,'Role Co','Remote','full-time','Description','Fixture',101,501,false,'pending','reviewer-role-co'),
      (2001,2,'Foreign Role','Remote','full-time','Description','Fixture',201,502,false,'pending','reviewer-role-foreign'),
      (3001,NULL,'Null Role','Remote','full-time','Description','Fixture',101,NULL,false,'pending','reviewer-role-null'),
      (3002,2,'Mismatch Role','Remote','full-time','Description','Fixture',201,502,false,'pending','reviewer-role-mismatch');
    INSERT INTO job_recruiters (id,organization_id,job_id,recruiter_id,added_by) VALUES (1,1,1001,102,101);
    INSERT INTO applications
      (id,organization_id,job_id,user_id,name,email,phone,resume_url,resume_filename,extracted_resume_text,
       cover_letter,status,submitted_by_recruiter,created_by_user_id,source,source_metadata,
       whatsapp_consent,platform_discovery_consent,ai_summary,ai_fit_label)
    VALUES
      (2001,1,1001,301,'Own Candidate','own@example.invalid','000','gs://fixture/own.pdf','own.pdf','Own text',
       'Own cover','submitted',true,101,'authorization_fixture','{}'::jsonb,false,false,'Own summary','Good'),
      (2002,1,1002,NULL,'Co Candidate','co-candidate@example.invalid','000','https://invalid/co.pdf','co.pdf','Co text',
       NULL,'submitted',true,101,'authorization_fixture','{}'::jsonb,false,false,'Co summary','Strong'),
      (2101,2,2001,NULL,'Foreign Candidate','foreign-candidate@example.invalid','000','gs://fixture/foreign.pdf','foreign.pdf','Foreign text',
       NULL,'submitted',true,201,'authorization_fixture','{}'::jsonb,false,false,'Foreign summary','Strong'),
      (2201,NULL,3001,NULL,'Null Candidate','null@example.invalid','000','gs://fixture/null.pdf','null.pdf','Null text',
       NULL,'submitted',true,101,'authorization_fixture','{}'::jsonb,false,false,NULL,NULL),
      (2202,1,3002,NULL,'Mismatch Candidate','mismatch@example.invalid','000','gs://fixture/mismatch.pdf','mismatch.pdf','Mismatch text',
       NULL,'submitted',true,101,'authorization_fixture','{}'::jsonb,false,false,NULL,NULL),
      (2301,1,1001,NULL,'Blocked Candidate','blocked@example.invalid','000','gs://fixture/blocked.pdf','blocked.pdf','Blocked text',
       NULL,'submitted',true,101,'authorization_fixture','{}'::jsonb,false,false,'Blocked summary','Strong');
    INSERT INTO forms (id,organization_id,name,description,is_published,created_by,ownership_scope) VALUES
      (10,1,'Organization Form',NULL,true,101,'organization'),
      (11,NULL,'Personal Form',NULL,true,401,'personal'),
      (12,NULL,'Legacy Form',NULL,true,101,'legacy_private'),
      (13,1,'Moved Creator Form',NULL,true,106,'organization');
    INSERT INTO form_fields (id,form_id,type,label,required,options,"order") VALUES
      (20,10,'short_text','Evidence',true,NULL,0),(21,11,'short_text','Personal',false,NULL,0),
      (22,12,'short_text','Legacy',false,NULL,0),(23,13,'short_text','Moved',false,NULL,0);
    INSERT INTO form_invitations
      (id,organization_id,application_id,form_id,token,expires_at,status,sent_by,answered_at,field_snapshot)
    VALUES
      (30,1,2001,10,'form-own',now()+interval '1 day','answered',101,now(),'[]'),
      (31,1,2101,10,'form-foreign',now()+interval '1 day','answered',101,now(),'[]'),
      (32,1,2301,10,'form-blocked',now()+interval '1 day','answered',101,now(),'[]');
    INSERT INTO form_responses (id,organization_id,invitation_id,application_id) VALUES
      (40,1,30,2001),(41,1,31,2101),(42,1,32,2301);
    INSERT INTO client_shortlists
      (id,organization_id,client_id,job_id,token,title,message,created_by,share_resume,share_ai_summary)
    VALUES (60,1,501,1001,'${token}','Client Review','Review safely',101,true,true);
    INSERT INTO client_shortlist_items (id,organization_id,shortlist_id,application_id,position,notes,public_ref) VALUES
      (70,1,60,2001,1,'forbidden internal note','${candidateRef}'),
      (71,1,60,2301,2,'blocked internal note','223e4567-e89b-42d3-a456-426614174000');
    INSERT INTO client_feedback
      (id,organization_id,application_id,client_id,shortlist_id,recommendation,notes,rating)
    VALUES (80,1,2001,501,60,'advance','Evidence',5),
           (81,2,2101,502,NULL,'hold','Foreign',3);
    INSERT INTO hiring_manager_invitations
      (id,email,name,token,invited_by,organization_id,authority_scope,inviter_name,expires_at,status)
    VALUES
      (90,'same@example.invalid','Same','${"b".repeat(64)}',101,1,'organization','Primary Recruiter',now()+interval '7 days','pending'),
      (91,'foreign@example.invalid','Foreign','${"c".repeat(64)}',201,2,'organization','Foreign Recruiter',now()+interval '7 days','pending'),
      (92,'legacy@example.invalid','Legacy','${"d".repeat(64)}',101,NULL,'legacy_private','Primary Recruiter',now()+interval '7 days','pending'),
      (93,'platform@example.invalid','Platform','${"e".repeat(64)}',401,NULL,'platform','Platform Admin',now()+interval '7 days','pending');
    INSERT INTO candidate_privacy_requests
      (request_id,directive_id,action,authority_type,actor_user_id,reason_code,state,version,last_delivery_status)
    VALUES ('00000000-0000-0000-0000-000000002301','10000000-0000-0000-0000-000000002301',
      'request_erasure','verified_candidate',301,'candidate_erasure_request','memory_active',1,'delivered');
    INSERT INTO candidate_privacy_subject_links (link_id,request_id,subject_type,application_id,organization_id)
    VALUES ('20000000-0000-0000-0000-000000002301','00000000-0000-0000-0000-000000002301','application',2301,1);
    INSERT INTO candidate_privacy_remote_projection
      (directive_id,request_id,action,scope,state,decision,version,effective_at,generation)
    VALUES ('10000000-0000-0000-0000-000000002301','00000000-0000-0000-0000-000000002301',
      'request_erasure','active_profile','active_quarantine','block_all',1,now(),1);
  `);
}

const policy = { allowPlatformAdmin: true } as const;
const recruiterIssuer = {
  actorId: 101, actorRole: "recruiter", organizationId: 1,
  authorityScope: "organization", inviterName: "Primary Recruiter",
} as const;

describe.skipIf(!enabled)("reviewer/share exact-schema PostgreSQL", () => {
  beforeAll(async () => {
    if (process.env.NODE_ENV !== "test") throw new Error("Disposable 2I integration requires NODE_ENV=test.");
    const migration = assertSafeUrl(migrationUrl, "migration");
    const runtime = assertSafeUrl(runtimeUrl, "runtime");
    if (migration.pathname !== runtime.pathname) throw new Error("Disposable 2I database mismatch.");
    const ownerProbe = await clientFor(migrationUrl);
    const runtimeProbe = await clientFor(runtimeUrl);
    try {
      const ownerIdentity = (await ownerProbe.query("SELECT current_database() database,current_user role,host(inet_server_addr()) server_addr")).rows[0];
      const runtimeIdentity = (await runtimeProbe.query("SELECT current_database() database,current_user role,host(inet_server_addr()) server_addr")).rows[0];
      const local = (value: unknown) => [null, "127.0.0.1", "::1"].includes(value as never);
      if (!String(ownerIdentity?.database).includes("_test") || !String(ownerIdentity?.role).includes("_test_")
          || !local(ownerIdentity?.server_addr) || runtimeIdentity?.database !== ownerIdentity?.database
          || !String(runtimeIdentity?.role).includes("_test_") || !local(runtimeIdentity?.server_addr)) {
        throw new Error("Disposable 2I identity proof failed.");
      }
      safeTargetProven = true;
    } finally {
      await ownerProbe.end();
      await runtimeProbe.end();
    }
    await resetDatabase();
    priorDir = buildPriorManifest();
    await runReleaseMigration({
      migrationsDir: priorDir,
      creds: { migrateUrl: migrationUrl, expectedTargetId: targetId, environment: "development", allowFreshInitialization: true },
      connect: connectMigration,
    });
    owner = await clientFor(migrationUrl);
    await owner.query(`
      INSERT INTO organizations (id,name,slug,settings,is_active,signal_tenant_id)
      VALUES (1,'Legacy org','legacy-org','{}'::jsonb,true,NULL);
      INSERT INTO users (id,username,password,role,email_verified)
      VALUES (101,'legacy@example.invalid','x','recruiter',true);
      INSERT INTO clients (id,organization_id,name,created_by) VALUES (501,1,'Legacy Client',101);
      INSERT INTO jobs (id,organization_id,title,location,type,description,posted_by,client_id,is_active,status,slug)
      VALUES (1001,1,'Legacy Job','Remote','full-time','Legacy',101,501,false,'pending','legacy-job');
      INSERT INTO applications
        (id,organization_id,job_id,name,email,phone,resume_url,status,submitted_by_recruiter,created_by_user_id,source,source_metadata,whatsapp_consent,platform_discovery_consent)
      VALUES (2001,1,1001,'Legacy Candidate','legacy-candidate@example.invalid','000','fixture://legacy','submitted',true,101,'fixture','{}'::jsonb,false,false);
      INSERT INTO forms (id,organization_id,name,is_published,created_by) VALUES
        (10,1,'Legacy Org Form',true,101),(11,NULL,'Legacy Null Form',true,101);
      INSERT INTO client_shortlists (id,organization_id,client_id,job_id,token,created_by)
      VALUES (60,1,501,1001,'${token}',101);
      INSERT INTO client_shortlist_items (id,organization_id,shortlist_id,application_id,position)
      VALUES (70,1,60,2001,1),(71,1,60,2001,2);
      INSERT INTO hiring_manager_invitations
        (id,email,token,invited_by,inviter_name,expires_at,status)
      VALUES (90,'legacy-hm@example.invalid','${"f".repeat(64)}',101,'Legacy',now()+interval '1 day','pending');
    `);
    const before = (await owner.query(`
      SELECT (SELECT count(*)::integer FROM forms) forms,
             (SELECT count(*)::integer FROM client_shortlists) shortlists,
             (SELECT count(*)::integer FROM client_shortlist_items) items,
             (SELECT count(*)::integer FROM hiring_manager_invitations) invitations
    `)).rows[0];
    await runReleaseMigration({
      migrationsDir,
      creds: { migrateUrl: migrationUrl, expectedTargetId: targetId, environment: "development", allowFreshInitialization: true },
      connect: connectMigration,
    });
    const classified = (await owner.query(`
      SELECT (SELECT jsonb_agg(jsonb_build_array(id,ownership_scope) ORDER BY id) FROM forms) forms,
             (SELECT bool_and(NOT share_resume AND NOT share_ai_summary) FROM client_shortlists) flags_false,
             (SELECT count(DISTINCT public_ref)::integer FROM client_shortlist_items) distinct_refs,
             (SELECT jsonb_agg(jsonb_build_array(id,authority_scope,organization_id) ORDER BY id) FROM hiring_manager_invitations) invitations,
             (SELECT count(*)::integer FROM hiring_manager_invitations
               WHERE accepted_by_user_id IS NULL AND grant_version=1
                 AND revoked_at IS NULL AND revoked_by IS NULL) grant_safe,
             (SELECT count(*)::integer FROM schema_control.applied) ledger
    `)).rows[0];
    expect(before).toEqual({ forms: 2, shortlists: 1, items: 2, invitations: 1 });
    expect(classified).toEqual({
      forms: [[10, "organization"], [11, "legacy_private"]],
      flags_false: true,
      distinct_refs: 2,
      invitations: [[90, "legacy_private", null]],
      grant_safe: 1,
      ledger: 7,
    });
    await provisionRuntimeRole({
      migrateUrl: migrationUrl, runtimeUrl, runtimeRole: new URL(runtimeUrl).username,
      expectedTargetId: targetId, connectMigration, connectRuntime,
    });
    process.env.DATABASE_URL = runtimeUrl;
    process.env.DATABASE_SSL = "false";
    authorization = await import("../reviewerShareAuthorization");
    runtimePool = (await import("../../db")).pool;
  }, 180_000);

  beforeEach(async () => {
    if (!owner || !safeTargetProven) throw new Error("Disposable 2I target not proven.");
    await owner.query("TRUNCATE public.users, public.organizations RESTART IDENTITY CASCADE");
    await installFixture();
  });

  afterAll(async () => {
    if (runtimePool) await runtimePool.end();
    if (owner) await owner.end();
    if (safeTargetProven) await resetDatabase();
    if (priorDir) rmSync(priorDir, { recursive: true, force: true });
  });

  it("installs ledger 7 with exact defaults, checks, FK and indexes", async () => {
    const row = (await owner!.query(`
      SELECT (SELECT count(*)::integer FROM schema_control.applied) ledger,
             (SELECT count(*)::integer FROM information_schema.columns WHERE table_name='client_shortlists'
               AND column_name IN ('share_resume','share_ai_summary') AND is_nullable='NO' AND column_default='false') flags,
             (SELECT count(*)::integer FROM information_schema.columns
               WHERE ((table_name='forms' AND column_name='ownership_scope')
                 OR (table_name='hiring_manager_invitations' AND column_name='authority_scope'))
                 AND column_default LIKE '%legacy_private%') fail_closed_defaults,
             (SELECT count(*)::integer FROM pg_constraint WHERE conname IN
               ('forms_ownership_scope_check','forms_ownership_scope_shape_check',
                'hiring_manager_invitations_authority_scope_check','hiring_manager_invitations_authority_scope_shape_check')) checks,
             (SELECT count(*)::integer FROM pg_indexes WHERE indexname IN
               ('forms_authority_scope_idx','client_shortlist_items_public_ref_idx',
                'hm_invitations_authority_issuer_idx','hm_invitations_authority_email_idx')) indexes
    `)).rows[0];
    expect(row).toEqual({ ledger: 7, flags: 2, fail_closed_defaults: 2, checks: 4, indexes: 4 });
    const grant = (await owner!.query(`
      SELECT (SELECT count(*)::integer FROM information_schema.columns
                WHERE table_name='hiring_manager_invitations'
                  AND column_name IN ('accepted_by_user_id','grant_version','revoked_at','revoked_by')) columns,
             (SELECT count(*)::integer FROM pg_constraint WHERE conname IN
                ('hiring_manager_invitations_grant_version_positive_check',
                 'hiring_manager_invitations_revocation_shape_check',
                 'hiring_manager_invitations_accepted_user_shape_check')) checks,
             (SELECT count(*)::integer FROM pg_indexes WHERE indexname='hm_invitations_eligibility_idx') indexes
    `)).rows[0];
    expect(grant).toEqual({ columns: 4, checks: 3, indexes: 1 });
  });

  it("enforces organization form read/manage, membership loss and legacy isolation", async () => {
    await expect(authorization.readAuthorizedFormTemplate(101, 10, policy)).resolves.toMatchObject({ ok: true, value: { canManage: true } });
    await expect(authorization.readAuthorizedFormTemplate(102, 10, policy)).resolves.toMatchObject({ ok: true, value: { canManage: false } });
    for (const actor of [103, 104, 106, 201]) {
      await expect(authorization.readAuthorizedFormTemplate(actor, actor === 106 ? 13 : 10, policy))
        .resolves.toEqual({ ok: false, reason: "not_found" });
    }
    await expect(authorization.readAuthorizedFormTemplate(101, 12, policy)).resolves.toMatchObject({ ok: true });
    await expect(authorization.readAuthorizedFormTemplate(102, 12, policy)).resolves.toEqual({ ok: false, reason: "not_found" });
    await expect(authorization.readAuthorizedFormTemplate(401, 11, policy)).resolves.toMatchObject({ ok: true });
  });

  it("creates and replaces form fields atomically and denies non-managers without mutation", async () => {
    const created = await authorization.createScopedFormTemplate(101, {
      name: "Created", description: null, isPublished: true,
      fields: [{ type: "short_text", label: "One", required: true, order: 0 }],
    }, policy);
    expect(created).toMatchObject({ ok: true, value: { ownershipScope: "organization", fields: [{ label: "One" }] } });
    const updated = await authorization.updateAuthorizedFormTemplate(101, 10, {
      name: "Updated", fields: [{ type: "long_text", label: "Replacement", required: false, order: 0 }],
    }, policy);
    expect(updated).toMatchObject({ ok: true, value: { name: "Updated", fields: [{ label: "Replacement" }] } });
    const before = (await owner!.query("SELECT name,(SELECT count(*)::integer FROM form_fields WHERE form_id=10) fields FROM forms WHERE id=10")).rows[0];
    await expect(authorization.updateAuthorizedFormTemplate(102, 10, { name: "Forbidden" }, policy))
      .resolves.toEqual({ ok: false, reason: "not_found" });
    expect((await owner!.query("SELECT name,(SELECT count(*)::integer FROM form_fields WHERE form_id=10) fields FROM forms WHERE id=10")).rows[0]).toEqual(before);
  });

  it("filters each response by current application authority and privacy", async () => {
    const result = await authorization.readAuthorizedResponsesForForm(101, 10, policy);
    expect(result).toEqual({ ok: true, value: {
      form: { id: 10, name: "Organization Form" },
      responses: [expect.objectContaining({ id: 40, candidateName: "Own Candidate" })], total: 1,
    } });
    await owner!.query("DELETE FROM form_responses WHERE id=40");
    await expect(authorization.readAuthorizedResponsesForForm(101, 10, policy))
      .resolves.toEqual({ ok: true, value: { form: { id: 10, name: "Organization Form" }, responses: [], total: 0 } });
  });

  it("returns only opaque, ordered, explicitly shared public shortlist fields", async () => {
    const result = await authorization.readPublicClientShortlist(token, true, true);
    expect(result).toEqual({ ok: true, value: {
      title: "Client Review", message: "Review safely", client: { name: "Client One" },
      job: { title: "Role One", location: "Remote", type: "full-time" },
      candidates: [{ candidateRef, name: "Own Candidate", position: 1, resumeAvailable: true, aiSummary: "Own summary", aiFitLabel: "Good" }],
      createdAt: expect.any(String), expiresAt: null,
    } });
    expect(JSON.stringify(result)).not.toMatch(/own@example|forbidden internal|gs:\/\//);
    await owner!.query("UPDATE client_shortlists SET share_resume=false,share_ai_summary=false WHERE id=60");
    await expect(authorization.readPublicClientShortlist(token, true, true)).resolves.toMatchObject({ ok: true, value: {
      candidates: [{ candidateRef, resumeAvailable: false, aiSummary: null, aiFitLabel: null }],
    } });
  });

  it("authorizes resume and feedback only through exact token plus UUID linkage", async () => {
    await expect(authorization.readPublicResumeLocator(token, candidateRef, true))
      .resolves.toMatchObject({ ok: true, value: { locator: "gs://fixture/own.pdf" } });
    for (const ref of ["323e4567-e89b-42d3-a456-426614174000", "223e4567-e89b-42d3-a456-426614174000"]) {
      await expect(authorization.readPublicResumeLocator(token, ref, true)).resolves.toEqual({ ok: false, reason: "not_found" });
    }
    await expect(authorization.resolvePublicFeedbackTarget(token, candidateRef)).resolves.toEqual({ ok: true, value: {
      applicationId: 2001, clientId: 501, shortlistId: 60, organizationId: 1,
    } });
  });

  it("returns linked client feedback for primary/co/admin and authorized-empty distinctly", async () => {
    for (const actor of [101, 102, 401]) {
      await expect(authorization.readAuthorizedClientFeedback(actor, 2001, policy))
        .resolves.toMatchObject({ ok: true, rows: [{ id: 80, clientName: "Client One" }] });
    }
    await expect(authorization.readAuthorizedClientFeedback(101, 2002, policy)).resolves.toEqual({ ok: true, rows: [] });
    for (const [actor, app] of [[103, 2001], [104, 2001], [106, 2001], [201, 2001], [101, 2101], [101, 2201], [101, 2202], [101, 2301]]) {
      await expect(authorization.readAuthorizedClientFeedback(actor!, app!, policy)).resolves.toEqual({ ok: false, reason: "not_found" });
    }
  });

  it("scopes HM replace/list/cancel to exact issuer organization and supports explicit platform admin", async () => {
    await expect(authorization.resolveInvitationIssuerScope(101, policy)).resolves.toEqual({ ok: true, value: recruiterIssuer });
    const replacement = await authorization.replaceAuthorizedHiringManagerInvitation(
      recruiterIssuer, "same@example.invalid", "Replacement", "9".repeat(64), new Date(Date.now() + 86_400_000),
    );
    expect(replacement).toMatchObject({ ok: true, value: { email: "same@example.invalid", status: "pending" } });
    const recruiterRows = await authorization.listAuthorizedHiringManagerInvitations(recruiterIssuer);
    expect(recruiterRows.ok && recruiterRows.rows.map((row) => row.email)).toEqual(["same@example.invalid"]);
    await expect(authorization.cancelAuthorizedHiringManagerInvitation(recruiterIssuer, 91))
      .resolves.toEqual({ ok: false, reason: "not_found" });
    await expect(authorization.cancelAuthorizedHiringManagerInvitation(recruiterIssuer, replacement.ok ? replacement.value.id : 0))
      .resolves.toMatchObject({ ok: true });
    const admin = await authorization.resolveInvitationIssuerScope(401, policy);
    expect(admin).toMatchObject({ ok: true, value: { authorityScope: "platform", organizationId: null } });
    if (!admin.ok) throw new Error("admin fixture refused");
    await expect(authorization.cancelAuthorizedHiringManagerInvitation(admin.value, 93)).resolves.toMatchObject({ ok: true });
  });

  it("keeps the runtime role DML-only", async () => {
    const runtime = await clientFor(runtimeUrl);
    try {
      await runtime.query("BEGIN");
      await runtime.query("SAVEPOINT no_ddl");
      await expect(runtime.query("ALTER TABLE forms ADD COLUMN forbidden integer")).rejects.toMatchObject({ code: "42501" });
      await runtime.query("ROLLBACK TO SAVEPOINT no_ddl");
      await runtime.query("ROLLBACK");
    } finally {
      await runtime.end();
    }
  });
});
