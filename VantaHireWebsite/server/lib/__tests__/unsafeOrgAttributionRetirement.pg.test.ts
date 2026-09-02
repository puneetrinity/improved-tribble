import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

import { runReleaseMigration, type MigrationClient } from "../../schema-control/runner";
import { provisionRuntimeRole } from "../../schema-control/runtimeRole";

const migrationUrl = (process.env.FLOW_SCHEMA_TEST_DATABASE_URL ?? "").trim();
const runtimeUrl = (process.env.FLOW_SCHEMA_TEST_RUNTIME_DATABASE_URL ?? "").trim();
const enabled = process.env.FLOW_AUTHZ_TEST_DISPOSABLE === "1" && Boolean(migrationUrl) && Boolean(runtimeUrl);
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "schema-migrations");
const targetId = "flow-unsafe-org-attribution-retirement-test";
const token = "a".repeat(64);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

let owner: Client | undefined;
let runtimePool: { end(): Promise<void> } | undefined;
let safeTargetProven = false;
let legacyBefore: unknown;
let legacyAfter: unknown;
let lifecycle: Record<string, unknown> | undefined;

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
  const local = parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]" || Boolean(socket?.startsWith("/"));
  if (!local || !parsed.pathname.includes("_test")) throw new Error(`Disposable 2M ${label} target refused.`);
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

async function legacySnapshot(client: Client): Promise<unknown> {
  return (await client.query(`
    SELECT jsonb_build_object(
      'jobs', (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM jobs t WHERE id BETWEEN 101 AND 103),
      'clients', (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM clients t WHERE id=201),
      'applications', (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM applications t WHERE id=301),
      'job_analytics', (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM job_analytics t WHERE id=401),
      'job_audit_log', (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM job_audit_log t WHERE id=501),
      'pipeline_stages', (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM pipeline_stages t WHERE id IN (601,602)),
      'email_templates', (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM email_templates t WHERE id=701),
      'forms', (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM forms t WHERE id=801),
      'form_invitations', (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM form_invitations t WHERE id=901),
      'form_responses', (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM form_responses t WHERE id=1001)
    ) AS snapshot
  `)).rows[0]?.snapshot;
}

async function installFixture(client: Client): Promise<void> {
  await client.query(`
    INSERT INTO organizations
      (id,name,slug,settings,is_active,signal_tenant_id,authority_origin,self_created_by_user_id)
    VALUES
      (10,'Retirement target org','retirement-target-org','{}'::jsonb,true,NULL,'legacy_unknown',NULL);
    INSERT INTO users
      (id,username,password,role,email_verified,first_name,last_name,auth_version)
    VALUES
      (1,'create-actor@example.invalid','x','recruiter',true,'Create','Actor',1),
      (2,'invite-actor@example.invalid','x','recruiter',true,'Invite','Actor',1),
      (3,'join-actor@example.invalid','x','recruiter',true,'Join','Actor',1),
      (4,'owner@example.invalid','x','recruiter',true,'Owner','Actor',1),
      (5,'candidate@example.invalid','x','candidate',true,'Candidate','Actor',1);
    INSERT INTO organization_members
      (id,organization_id,user_id,role,seat_assigned,credits_allocated,credits_used,credits_rollover,invited_by)
    VALUES (1,10,4,'owner',true,0,0,0,NULL);
    INSERT INTO subscription_plans
      (id,name,display_name,description,price_per_seat_monthly,price_per_seat_annual,
       ai_credits_per_seat_monthly,max_credit_rollover_months,features,is_active,sort_order)
    VALUES (1,'retirement-fixture','Retirement fixture','Synthetic',0,0,0,0,'{}'::jsonb,true,1);
    INSERT INTO organization_subscriptions
      (id,organization_id,plan_id,seats,paid_seats,billing_cycle,status,start_date,current_period_start,current_period_end)
    VALUES (1,10,1,5,0,'monthly','active',now(),now(),now()+interval '30 days');
    INSERT INTO organization_invites
      (id,organization_id,email,role,token,expires_at,invited_by,state,version,created_at)
    VALUES
      (101,10,'invite-actor@example.invalid','member','${hash(token)}',now()+interval '1 hour',4,'pending',1,now());
    INSERT INTO organization_join_requests
      (id,organization_id,user_id,status,requested_at)
    VALUES (201,10,3,'pending',now());

    INSERT INTO jobs
      (id,organization_id,title,location,type,description,posted_by,is_active,status,slug)
    VALUES
      (101,NULL,'Create legacy role','Remote','full-time','Unknown ownership create',1,false,'pending','create-legacy-role'),
      (102,NULL,'Invite legacy role','Remote','full-time','Unknown ownership invite',2,false,'pending','invite-legacy-role'),
      (103,NULL,'Join legacy role','Remote','full-time','Unknown ownership join',3,false,'pending','join-legacy-role');
    INSERT INTO clients (id,organization_id,name,notes,created_by)
    VALUES (201,NULL,'Legacy client','byte-distinct-client',1);
    INSERT INTO applications
      (id,organization_id,job_id,user_id,name,email,phone,resume_url,status,source_metadata)
    VALUES
      (301,NULL,101,5,'Legacy candidate','legacy-candidate@example.invalid','0000000000',
       'https://resume.fixture.invalid/legacy.pdf','submitted','{"marker":"byte-distinct-application"}'::jsonb);
    INSERT INTO job_analytics
      (id,organization_id,job_id,views,apply_clicks,conversion_rate,ai_score_cache,ai_model_version)
    VALUES (401,NULL,101,17,3,'17.65',41,'byte-distinct-analytics');
    INSERT INTO job_audit_log
      (id,organization_id,job_id,action,performed_by,reason,metadata)
    VALUES (501,NULL,101,'created',1,'byte-distinct-audit','{"marker":501}'::jsonb);
    INSERT INTO pipeline_stages
      (id,organization_id,name,"order",color,is_default,created_by)
    VALUES
      (601,NULL,'Duplicate legacy stage',7,'#010101',false,1),
      (602,NULL,'Duplicate legacy stage',7,'#020202',false,1);
    INSERT INTO email_templates
      (id,organization_id,name,subject,body,template_type,created_by,is_default)
    VALUES (701,NULL,'Legacy template','Distinct subject','Distinct body','custom',1,false);
    INSERT INTO forms
      (id,organization_id,name,description,is_published,created_by,ownership_scope)
    VALUES (801,NULL,'Legacy form','byte-distinct-form',true,1,'legacy_private');
    INSERT INTO form_invitations
      (id,organization_id,application_id,form_id,token,expires_at,status,sent_by,field_snapshot,custom_message)
    VALUES
      (901,NULL,301,801,'legacy-form-token',now()+interval '1 hour','pending',1,'[]','byte-distinct-invitation');
    INSERT INTO form_responses
      (id,organization_id,invitation_id,application_id)
    VALUES (1001,NULL,901,301);

    SELECT setval(pg_get_serial_sequence('public.organizations','id'),10,true);
    SELECT setval(pg_get_serial_sequence('public.users','id'),5,true);
    SELECT setval(pg_get_serial_sequence('public.organization_members','id'),1,true);
  `);
}

describe.skipIf(!enabled)("unsafe organization-attribution retirement exact-schema PostgreSQL", () => {
  beforeAll(async () => {
    if (process.env.NODE_ENV !== "test") throw new Error("Disposable 2M integration requires NODE_ENV=test.");
    const migration = assertSafeUrl(migrationUrl, "migration");
    const runtime = assertSafeUrl(runtimeUrl, "runtime");
    if (migration.pathname !== runtime.pathname) throw new Error("Disposable 2M database mismatch.");
    const ownerProbe = await clientFor(migrationUrl);
    const runtimeProbe = await clientFor(runtimeUrl);
    try {
      const ownerIdentity = (await ownerProbe.query(
        "SELECT current_database() database,current_user role,host(inet_server_addr()) server_addr",
      )).rows[0];
      const runtimeIdentity = (await runtimeProbe.query(
        "SELECT current_database() database,current_user role,host(inet_server_addr()) server_addr",
      )).rows[0];
      const local = (value: unknown) => [null, "127.0.0.1", "::1"].includes(value as never);
      if (!String(ownerIdentity?.database).includes("_test") || !String(ownerIdentity?.role).includes("_test_")
          || !local(ownerIdentity?.server_addr) || runtimeIdentity?.database !== ownerIdentity?.database
          || !String(runtimeIdentity?.role).includes("_test_") || !local(runtimeIdentity?.server_addr)) {
        throw new Error("Disposable 2M identity proof failed.");
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
    await installFixture(owner);
    legacyBefore = await legacySnapshot(owner);

    process.env.DATABASE_URL = runtimeUrl;
    process.env.DATABASE_SSL = "false";
    const organization = await import("../organizationService");
    const invitation = await import("../versionedInvitationGrantAuthorization");
    runtimePool = (await import("../../db")).pool;

    const created = await organization.createOrganization({
      name: "Created without inference",
      slug: "created-without-inference",
    }, 1);
    const accepted = await invitation.acceptOrganizationInvite(token, 2);
    const joined = await organization.respondToJoinRequest(201, "approved", 4);
    legacyAfter = await legacySnapshot(owner);
    lifecycle = (await owner.query(`
      SELECT
        (SELECT COUNT(*)::integer FROM schema_control.applied) ledger,
        (SELECT COUNT(*)::integer FROM organizations WHERE id=$1 AND authority_origin='self_service_recruiter'
          AND self_created_by_user_id=1) created_org,
        (SELECT COUNT(*)::integer FROM organization_members WHERE organization_id=$1 AND user_id=1
          AND role='owner' AND seat_assigned=true) created_owner,
        (SELECT state='accepted' AND accepted_by=2 FROM organization_invites WHERE id=101) invite_accepted,
        (SELECT COUNT(*)::integer FROM organization_members WHERE organization_id=10 AND user_id=2
          AND role='member' AND seat_assigned=true) invite_member,
        (SELECT status='approved' AND responded_by=4 FROM organization_join_requests WHERE id=201) join_approved,
        (SELECT COUNT(*)::integer FROM organization_members WHERE organization_id=10 AND user_id=3
          AND role='member' AND seat_assigned=true) join_member,
        (SELECT COUNT(*)::integer FROM pipeline_stages WHERE id IN (601,602)) duplicate_stages,
        (SELECT COUNT(*)::integer FROM jobs WHERE id BETWEEN 101 AND 103 AND organization_id IS NULL) null_jobs,
        (SELECT COUNT(*)::integer FROM clients WHERE id=201 AND organization_id IS NULL) null_clients,
        (SELECT COUNT(*)::integer FROM applications WHERE id=301 AND organization_id IS NULL) null_applications,
        (SELECT COUNT(*)::integer FROM forms WHERE id=801 AND organization_id IS NULL) null_forms
    `, [created.id])).rows[0];
    if (!accepted.ok || !joined) throw new Error("Disposable 2M lifecycle did not complete.");
  }, 180_000);

  afterAll(async () => {
    if (runtimePool) await runtimePool.end();
    if (owner) await owner.end();
    if (safeTargetProven) await resetDatabase();
  });

  it("keeps all ten former backfill table families byte-identical", () => {
    expect(legacyAfter).toEqual(legacyBefore);
  });

  it("creates only the explicit organization, membership, invitation and join-request transitions", () => {
    expect(lifecycle).toEqual({
      ledger: 8,
      created_org: 1,
      created_owner: 1,
      invite_accepted: true,
      invite_member: 1,
      join_approved: true,
      join_member: 1,
      duplicate_stages: 2,
      null_jobs: 3,
      null_clients: 1,
      null_applications: 1,
      null_forms: 1,
    });
  });

  it("keeps the runtime role DML-only with ledger 8 unchanged", async () => {
    const runtime = await clientFor(runtimeUrl);
    try {
      await expect(runtime.query("ALTER TABLE jobs ADD COLUMN forbidden integer")).rejects.toThrow();
      expect((await runtime.query(
        "SELECT has_table_privilege(current_user,'jobs','SELECT,INSERT,UPDATE,DELETE') AS dml",
      )).rows[0]?.dml).toBe(true);
      expect((await owner!.query("SELECT COUNT(*)::integer AS ledger FROM schema_control.applied")).rows[0]?.ledger).toBe(8);
    } finally {
      await runtime.end();
    }
  });
});
