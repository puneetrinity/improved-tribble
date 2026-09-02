import { createHash } from "node:crypto";
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
const targetId = "flow-versioned-invitation-grant-test-target";

type AuthorizationModule = typeof import("../versionedInvitationGrantAuthorization");
type DirectoryModule = typeof import("../membershipScopedReadAuthorization");
let authorization: AuthorizationModule;
let directory: DirectoryModule;
let owner: Client | undefined;
let runtimePool: { end(): Promise<void> } | undefined;
let safeTargetProven = false;
let preMigrationDir: string | undefined;
let migrationEvidence: Record<string, unknown> | undefined;

const tokenA = "a".repeat(64);
const tokenB = "b".repeat(64);
const tokenC = "c".repeat(64);
const tokenD = "d".repeat(64);
const tokenE = "e".repeat(64);
const tokenF = "f".repeat(64);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

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
  if (!local || !parsed.pathname.includes("_test")) throw new Error(`Disposable 2L-B ${label} target refused.`);
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

function pre0006Manifest(): string {
  const dir = mkdtempSync(join(tmpdir(), "flow-2lb-pre-0006-"));
  const files = [
    "0000_baseline.sql", "0001_candidate_privacy_flow.sql", "0002_resume_access_attempts.sql",
    "0003_application_workflow_assessments.sql", "0004_reviewer_share_authority.sql",
    "0005_privilege_authorization_version.sql", "catalog.lock.json",
  ];
  for (const file of files) copyFileSync(join(migrationsDir, file), join(dir, file));
  const lock = JSON.parse(readFileSync(join(migrationsDir, "checksums.lock"), "utf8")) as {
    format_version: number; catalog_lock_sha256: string; migrations: Record<string, string>;
  };
  writeFileSync(join(dir, "checksums.lock"), `${JSON.stringify({
    format_version: lock.format_version,
    catalog_lock_sha256: lock.catalog_lock_sha256,
    migrations: Object.fromEntries(Object.entries(lock.migrations).filter(([version]) => Number(version) < 6)),
  }, null, 2)}\n`);
  return dir;
}

async function installFixture(): Promise<void> {
  if (!owner) throw new Error("Disposable 2L-B owner unavailable.");
  await owner.query(`
    INSERT INTO organizations
      (id,name,slug,settings,is_active,signal_tenant_id,authority_origin,self_created_by_user_id)
    VALUES
      (10,'Invitation org A','invitation-org-a','{}'::jsonb,true,NULL,'legacy_unknown',NULL),
      (20,'Invitation org B','invitation-org-b','{}'::jsonb,true,NULL,'legacy_unknown',NULL);
    INSERT INTO users
      (id,username,password,role,email_verified,first_name,last_name,auth_version)
    VALUES
      (1,'owner-a@example.invalid','owner.old','recruiter',true,'Owner','A',1),
      (2,'admin-a@example.invalid','admin.old','recruiter',true,'Admin','A',1),
      (3,'owner-b@example.invalid','owner-b.old','recruiter',true,'Owner','B',1),
      (4,'member-a@example.invalid','member.old','recruiter',true,'Member','A',1),
      (5,'unseated-a@example.invalid','unseated.old','recruiter',true,'Unseated','A',1),
      (6,'target@example.invalid','target.old','recruiter',true,'Target','One',1),
      (7,'unverified@example.invalid','unverified.old','recruiter',false,'Target','Two',1),
      (8,'hm@example.invalid','hm.old','hiring_manager',true,'Hiring','Manager',1),
      (9,'no-org@example.invalid','no-org.old','recruiter',true,'No','Org',1);
    INSERT INTO organization_members
      (id,organization_id,user_id,role,seat_assigned,credits_allocated,credits_used,credits_rollover,invited_by)
    VALUES
      (1,10,1,'owner',true,0,0,0,NULL),
      (2,10,2,'admin',true,0,0,0,1),
      (3,20,3,'owner',true,0,0,0,NULL),
      (4,10,4,'member',true,0,0,0,1),
      (5,10,5,'member',false,0,0,0,1);
    INSERT INTO subscription_plans
      (id,name,display_name,description,price_per_seat_monthly,price_per_seat_annual,
       ai_credits_per_seat_monthly,max_credit_rollover_months,features,is_active,sort_order)
    VALUES (1,'synthetic','Synthetic','Synthetic',0,0,0,0,'{}'::jsonb,true,1);
    INSERT INTO organization_subscriptions
      (id,organization_id,plan_id,seats,paid_seats,billing_cycle,status,start_date,current_period_start,current_period_end)
    VALUES
      (1,10,1,6,0,'monthly','active',now(),now(),now()+interval '30 days'),
      (2,20,1,2,0,'monthly','active',now(),now(),now()+interval '30 days');
    INSERT INTO organization_invites
      (id,organization_id,email,role,token,expires_at,invited_by,state,version,accepted_at,accepted_by,created_at)
    VALUES
      (101,10,'target@example.invalid','member','${hash(tokenA)}',now()+interval '1 hour',1,'pending',1,NULL,NULL,now()),
      (102,10,'accepted-history@example.invalid','member','${hash(tokenD)}',now()-interval '1 day',1,'accepted',1,now()-interval '1 day',4,now()-interval '2 days');
    INSERT INTO hiring_manager_invitations
      (id,email,name,token,invited_by,organization_id,authority_scope,inviter_name,expires_at,status,
       accepted_at,accepted_by_user_id,grant_version,created_at)
    VALUES
      (201,'hm-pending@example.invalid','Pending HM','${hash(tokenC)}',1,10,'organization','Owner A',now()+interval '1 hour','pending',NULL,NULL,2,now()),
      (202,'hm@example.invalid','Accepted HM','${hash(tokenB)}',1,10,'organization','Owner A',now()+interval '1 hour','accepted',now(),8,1,now());
    SELECT setval(pg_get_serial_sequence('public.organization_invites','id'), 102, true);
    SELECT setval(pg_get_serial_sequence('public.organization_members','id'), 5, true);
  `);
}

describe.skipIf(!enabled)("versioned invitation grants exact-schema PostgreSQL", () => {
  beforeAll(async () => {
    if (process.env.NODE_ENV !== "test") throw new Error("Disposable 2L-B integration requires NODE_ENV=test.");
    const migration = assertSafeUrl(migrationUrl, "migration");
    const runtime = assertSafeUrl(runtimeUrl, "runtime");
    if (migration.pathname !== runtime.pathname) throw new Error("Disposable 2L-B database mismatch.");
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
        throw new Error("Disposable 2L-B identity proof failed.");
      }
      safeTargetProven = true;
    } finally {
      await ownerProbe.end();
      await runtimeProbe.end();
    }

    await resetDatabase();
    preMigrationDir = pre0006Manifest();
    await runReleaseMigration({
      migrationsDir: preMigrationDir,
      creds: { migrateUrl: migrationUrl, expectedTargetId: targetId, environment: "development", allowFreshInitialization: true },
      connect: connectMigration,
    });
    const pre = await clientFor(migrationUrl);
    try {
      await pre.query(`
        INSERT INTO organizations (id,name,slug,settings,is_active,signal_tenant_id,authority_origin)
        VALUES (901,'Legacy invitation org','legacy-invitation-org','{}'::jsonb,true,NULL,'legacy_unknown');
        INSERT INTO users (id,username,password,role,email_verified,auth_version)
        VALUES
          (901,'legacy-owner@example.invalid','owner.old','recruiter',true,1),
          (902,'legacy-member@example.invalid','member.old','recruiter',true,1),
          (903,'legacy-hm@example.invalid','hm.old','hiring_manager',true,1),
          (904,'ambiguous-hm@example.invalid','hm.old','hiring_manager',true,1),
          (905,'AMBIGUOUS-HM@example.invalid','hm.old','hiring_manager',true,1);
        INSERT INTO organization_invites
          (id,organization_id,email,role,token,expires_at,invited_by,accepted_at,accepted_by)
        VALUES
          (901,901,'legacy-member@example.invalid','member','legacy-accepted-token',now()+interval '1 day',901,now(),902),
          (902,901,'legacy-pending@example.invalid','member','legacy-pending-token',now()+interval '1 day',901,NULL,NULL);
        INSERT INTO hiring_manager_invitations
          (id,email,token,invited_by,organization_id,authority_scope,expires_at,status,accepted_at)
        VALUES
          (901,'legacy-hm@example.invalid','legacy-hm-one',901,901,'organization',now()+interval '1 day','accepted',now()),
          (902,'ambiguous-hm@example.invalid','legacy-hm-two',901,901,'organization',now()+interval '1 day','accepted',now()),
          (903,'legacy-hm@example.invalid','legacy-hm-three',901,NULL,'platform',now()+interval '1 day','accepted',now());
      `);
    } finally {
      await pre.end();
    }
    await runReleaseMigration({
      migrationsDir,
      creds: { migrateUrl: migrationUrl, expectedTargetId: targetId, environment: "development", allowFreshInitialization: false },
      connect: connectMigration,
    });
    const evidence = await clientFor(migrationUrl);
    try {
      migrationEvidence = (await evidence.query(`
        SELECT (SELECT COUNT(*)::integer FROM schema_control.applied) ledger,
               (SELECT state FROM organization_invites WHERE id=901) accepted_state,
               (SELECT state FROM organization_invites WHERE id=902) pending_state,
               (SELECT token <> 'legacy-accepted-token' AND token ~ '^[0-9a-f]{64}$'
                  FROM organization_invites WHERE id=901) token_hashed,
               (SELECT accepted_by_user_id FROM hiring_manager_invitations WHERE id=901) unique_hm_user,
               (SELECT accepted_by_user_id FROM hiring_manager_invitations WHERE id=902) ambiguous_hm_user,
               (SELECT accepted_by_user_id FROM hiring_manager_invitations WHERE id=903) platform_hm_user,
               (SELECT COUNT(*)::integer FROM pg_constraint WHERE conname IN
                 ('organization_invites_state_check','organization_invites_version_positive_check',
                  'organization_invites_state_shape_check','hiring_manager_invitations_grant_version_positive_check',
                  'hiring_manager_invitations_revocation_shape_check','hiring_manager_invitations_accepted_user_shape_check')) checks,
               (SELECT COUNT(*)::integer FROM pg_indexes WHERE indexname IN
                 ('org_invites_pending_email_idx','org_invites_org_state_created_idx','org_invites_token_state_idx',
                  'hm_invitations_eligibility_idx')) indexes
      `)).rows[0];
    } finally {
      await evidence.end();
    }

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
    authorization = await import("../versionedInvitationGrantAuthorization");
    directory = await import("../membershipScopedReadAuthorization");
    runtimePool = (await import("../../db")).pool;
  }, 180_000);

  beforeEach(async () => {
    if (!owner || !safeTargetProven) throw new Error("Disposable 2L-B target not proven.");
    await owner.query("TRUNCATE public.users, public.organizations, public.subscription_plans RESTART IDENTITY CASCADE");
    await installFixture();
  });

  afterAll(async () => {
    if (runtimePool) await runtimePool.end();
    if (owner) await owner.end();
    if (safeTargetProven) await resetDatabase();
    if (preMigrationDir) rmSync(preMigrationDir, { recursive: true, force: true });
  });

  it("applies ledger 7 and classifies legacy grants without inferred authority", () => {
    expect(migrationEvidence).toEqual({
      ledger: 7,
      accepted_state: "accepted",
      pending_state: "legacy_revoked",
      token_hashed: true,
      unique_hm_user: 903,
      ambiguous_hm_user: null,
      platform_hm_user: null,
      checks: 6,
      indexes: 4,
    });
  });

  it("creates and resends only for an exactly-one seated owner/admin grant", async () => {
    const first = await authorization.createOrResendOrganizationInvite(1, "fresh@example.invalid", hash(tokenB), new Date(Date.now() + 60_000));
    expect(first).toMatchObject({ ok: true, value: { email: "fresh@example.invalid", role: "member" } });
    const second = await authorization.createOrResendOrganizationInvite(2, "fresh@example.invalid", hash(tokenC), new Date(Date.now() + 120_000));
    expect(second).toMatchObject({ ok: true, value: { email: "fresh@example.invalid" } });
    const rows = (await owner!.query("SELECT state,version,token FROM organization_invites WHERE email='fresh@example.invalid' ORDER BY version")).rows;
    expect(rows).toEqual([
      { state: "superseded", version: 1, token: hash(tokenB) },
      { state: "pending", version: 2, token: hash(tokenC) },
    ]);
    await expect(authorization.createOrResendOrganizationInvite(4, "denied@example.invalid", hash(tokenB), new Date(Date.now() + 60_000)))
      .resolves.toEqual({ ok: false, reason: "forbidden" });
  });

  it("keeps accepted history as the explicit F152 conflict", async () => {
    await expect(authorization.createOrResendOrganizationInvite(1, "accepted-history@example.invalid", hash(tokenC), new Date(Date.now() + 60_000)))
      .resolves.toEqual({ ok: false, reason: "conflict", code: "accepted_history" });
  });

  it("lists and previews minimum projections without token or internal authority", async () => {
    const list = await authorization.listOrganizationInvites(1);
    expect(list).toMatchObject({ ok: true, rows: [{ id: 101, email: "target@example.invalid", role: "member" }] });
    expect(Object.keys((list as any).rows[0]).sort()).toEqual(["createdAt", "email", "expiresAt", "id", "role"]);
    const preview = await authorization.readOrganizationInvitePreview(tokenA);
    expect(preview).toMatchObject({ ok: true, value: { organizationName: "Invitation org A", email: "target@example.invalid" } });
    expect(Object.keys((preview as any).value).sort())
      .toEqual(["email", "expiresAt", "inviterName", "organizationName", "role"]);
  });

  it("collapses foreign, absent, terminal and expired cancellation targets", async () => {
    const foreign = await authorization.cancelOrganizationInvite(3, 101);
    const absent = await authorization.cancelOrganizationInvite(1, 999999);
    const terminal = await authorization.cancelOrganizationInvite(1, 102);
    expect(foreign).toEqual({ ok: false, reason: "not_found" });
    expect(absent).toEqual(foreign);
    expect(terminal).toEqual(foreign);
  });

  it("accepts a verified exact-email account atomically and rejects unverified or existing members", async () => {
    await owner!.query(`
      INSERT INTO jobs
        (id,organization_id,title,location,type,description,posted_by,is_active,status,slug)
      VALUES
        (901,NULL,'Unknown-ownership role','Remote','full-time','Must remain unattributed',6,false,'pending','unknown-ownership-role')
    `);
    const unattributedBefore = (await owner!.query(
      "SELECT to_jsonb(j) AS row FROM jobs j WHERE id=901",
    )).rows[0]?.row;

    const accepted = await authorization.acceptOrganizationInvite(tokenA, 6);
    expect(accepted).toMatchObject({ ok: true, value: { organizationId: 10, userId: 6, role: "member", seatAssigned: true } });
    expect((await owner!.query("SELECT state,accepted_by FROM organization_invites WHERE id=101")).rows[0])
      .toEqual({ state: "accepted", accepted_by: 6 });
    expect((await owner!.query(
      "SELECT to_jsonb(j) AS row FROM jobs j WHERE id=901",
    )).rows[0]?.row).toEqual(unattributedBefore);

    await owner!.query(`
      INSERT INTO organization_invites
        (id,organization_id,email,role,token,expires_at,invited_by,state,version,created_at)
      VALUES
        (103,10,'unverified@example.invalid','member','${hash(tokenE)}',now()+interval '1 hour',1,'pending',1,now()),
        (104,10,'member-a@example.invalid','member','${hash(tokenF)}',now()+interval '1 hour',1,'pending',1,now())
    `);
    await expect(authorization.acceptOrganizationInvite(tokenE, 7)).resolves.toEqual({ ok: false, reason: "forbidden" });
    await expect(authorization.acceptOrganizationInvite(tokenF, 4)).resolves.toEqual({ ok: false, reason: "conflict", code: "already_member" });
  });

  it("serializes accept versus cancel with exactly one winner", async () => {
    const [accept, cancel] = await Promise.all([
      authorization.acceptOrganizationInvite(tokenA, 6),
      authorization.cancelOrganizationInvite(1, 101),
    ]);
    expect([accept.ok, cancel.ok].filter(Boolean)).toHaveLength(1);
    expect((await owner!.query("SELECT state FROM organization_invites WHERE id=101")).rows[0]?.state)
      .toMatch(/^(accepted|cancelled)$/);
  });

  it("serializes accept versus resend and makes the losing token unusable", async () => {
    const [accept, resend] = await Promise.all([
      authorization.acceptOrganizationInvite(tokenA, 6),
      authorization.createOrResendOrganizationInvite(1, "target@example.invalid", hash(tokenB), new Date(Date.now() + 60_000)),
    ]);
    expect([accept.ok, resend.ok].filter(Boolean)).toHaveLength(1);
    if (resend.ok) {
      await expect(authorization.acceptOrganizationInvite(tokenA, 6)).resolves.toEqual({ ok: false, reason: "not_found" });
    } else {
      expect(resend).toEqual({ ok: false, reason: "conflict", code: "accepted_history" });
    }
  });

  it("binds HM acceptance and directory eligibility to the exact accepted user and stored organization", async () => {
    await owner!.query("UPDATE users SET username='hm-pending@example.invalid' WHERE id=8");
    const grant = await authorization.readHiringManagerRegistrationGrant(tokenC);
    expect(grant).toEqual({ ok: true, value: { id: 201, email: "hm-pending@example.invalid", grantVersion: 2 } });
    await expect(authorization.acceptHiringManagerRegistrationGrant(8, 201, 2, tokenC)).resolves.toEqual({ ok: true });
    await expect(directory.readAuthorizedHiringManagerDirectory(1, { allowPlatformAdmin: false }))
      .resolves.toMatchObject({ ok: true, rows: [{ id: 8, username: "hm-pending@example.invalid" }] });
    await owner!.query("UPDATE organization_members SET organization_id=20 WHERE user_id=1");
    await expect(directory.readAuthorizedHiringManagerDirectory(2, { allowPlatformAdmin: false }))
      .resolves.toMatchObject({ ok: true, rows: [{ id: 8 }] });
  });

  it("keeps the runtime role DML-only", async () => {
    const runtime = await clientFor(runtimeUrl);
    try {
      await expect(runtime.query("ALTER TABLE organization_invites ADD COLUMN forbidden integer")).rejects.toThrow();
      expect((await runtime.query(
        "SELECT has_table_privilege(current_user,'organization_invites','SELECT,INSERT,UPDATE,DELETE') AS dml",
      )).rows[0]?.dml).toBe(true);
    } finally {
      await runtime.end();
    }
  });
});
