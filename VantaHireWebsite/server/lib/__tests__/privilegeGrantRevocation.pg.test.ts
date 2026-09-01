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
const targetId = "flow-privilege-grant-revocation-test-target";

type AuthorizationModule = typeof import("../privilegeGrantRevocation");
type OrganizationModule = typeof import("../organizationService");
let authorization: AuthorizationModule;
let organizationService: OrganizationModule;
let owner: Client | undefined;
let runtimePool: { end(): Promise<void> } | undefined;
let safeTargetProven = false;
let preMigrationDir: string | undefined;
let migrationEvidence: Record<string, unknown> | undefined;

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
  if (!local || !parsed.pathname.includes("_test")) throw new Error(`Disposable 2L-A ${label} target refused.`);
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

function pre0005Manifest(): string {
  const dir = mkdtempSync(join(tmpdir(), "flow-2la-pre-0005-"));
  const files = [
    "0000_baseline.sql",
    "0001_candidate_privacy_flow.sql",
    "0002_resume_access_attempts.sql",
    "0003_application_workflow_assessments.sql",
    "0004_reviewer_share_authority.sql",
    "catalog.lock.json",
  ];
  for (const file of files) copyFileSync(join(migrationsDir, file), join(dir, file));
  const lock = JSON.parse(readFileSync(join(migrationsDir, "checksums.lock"), "utf8")) as {
    format_version: number;
    catalog_lock_sha256: string;
    migrations: Record<string, string>;
  };
  writeFileSync(join(dir, "checksums.lock"), `${JSON.stringify({
    format_version: lock.format_version,
    catalog_lock_sha256: lock.catalog_lock_sha256,
    migrations: Object.fromEntries(Object.entries(lock.migrations).filter(([version]) => Number(version) < 5)),
  }, null, 2)}\n`);
  return dir;
}

async function installFixture(): Promise<void> {
  if (!owner) throw new Error("Disposable 2L-A owner unavailable.");
  await owner.query(`
    INSERT INTO organizations
      (id,name,slug,settings,is_active,signal_tenant_id,authority_origin,self_created_by_user_id)
    VALUES
      (10,'Privilege org A','privilege-org-a','{}'::jsonb,true,NULL,'legacy_unknown',NULL),
      (20,'Privilege org B','privilege-org-b','{}'::jsonb,true,NULL,'legacy_unknown',NULL);
    INSERT INTO users
      (id,username,password,role,email_verified,first_name,last_name,auth_version)
    VALUES
      (1,'owner-a@example.invalid','owner.old','recruiter',true,'Owner','A',1),
      (2,'admin-a@example.invalid','admin.old','recruiter',true,'Admin','A',1),
      (3,'member-a@example.invalid','member.old','recruiter',true,'Member','A',1),
      (4,'unseated-a@example.invalid','unseated.old','recruiter',true,'Unseated','A',1),
      (5,'owner-b@example.invalid','owner-b.old','recruiter',true,'Owner','B',1),
      (6,'candidate@example.invalid','candidate.old','candidate',true,'Candidate','Actor',1),
      (7,'unverified@example.invalid','unverified.old','recruiter',false,'Unverified','Actor',1),
      (8,'no-org@example.invalid','no-org.old','recruiter',true,'No','Org',1),
      (9,'target-a@example.invalid','target.old','recruiter',true,'Target','A',1),
      (30,'creator@example.invalid','creator.old','recruiter',true,'Creator','One',1),
      (31,'candidate-creator@example.invalid','candidate.old','candidate',true,'Candidate','Creator',1),
      (32,'unverified-creator@example.invalid','unverified.old','recruiter',false,'Unverified','Creator',1),
      (33,'member-creator@example.invalid','member-creator.old','recruiter',true,'Member','Creator',1),
      (34,'race-creator@example.invalid','race.old','recruiter',true,'Race','Creator',1);
    INSERT INTO organization_members
      (id,organization_id,user_id,role,seat_assigned,credits_allocated,credits_used,credits_rollover,invited_by)
    VALUES
      (1,10,1,'owner',true,0,0,0,NULL),
      (2,10,2,'admin',true,0,0,0,1),
      (3,10,3,'member',true,0,0,0,1),
      (4,10,4,'member',false,0,0,0,1),
      (5,20,5,'owner',true,0,0,0,NULL),
      (6,10,9,'member',true,0,0,0,1),
      (7,10,33,'member',true,0,0,0,1);
    INSERT INTO jobs
      (id,organization_id,title,location,type,description,posted_by,is_active,status,created_at,updated_at)
    VALUES
      (101,10,'Synthetic one','Remote','full-time','Synthetic role one',3,false,'pending',now(),now()),
      (102,10,'Synthetic two','Remote','full-time','Synthetic role two',3,false,'pending',now(),now()),
      (201,20,'Foreign role','Remote','full-time','Foreign synthetic role',5,false,'pending',now(),now());
    UPDATE users
       SET password_reset_token='synthetic-reset-hash',
           password_reset_expires=now()+interval '1 hour'
     WHERE id=3;
    SELECT setval(
      pg_get_serial_sequence('public.organization_members', 'id'),
      (SELECT MAX(id) FROM organization_members),
      true
    );
  `);
}

describe.skipIf(!enabled)("privilege grant/revocation exact-schema PostgreSQL", () => {
  beforeAll(async () => {
    if (process.env.NODE_ENV !== "test") throw new Error("Disposable 2L-A integration requires NODE_ENV=test.");
    const migration = assertSafeUrl(migrationUrl, "migration");
    const runtime = assertSafeUrl(runtimeUrl, "runtime");
    if (migration.pathname !== runtime.pathname) throw new Error("Disposable 2L-A database mismatch.");
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
        throw new Error("Disposable 2L-A identity proof failed.");
      }
      safeTargetProven = true;
    } finally {
      await ownerProbe.end();
      await runtimeProbe.end();
    }

    await resetDatabase();
    preMigrationDir = pre0005Manifest();
    await runReleaseMigration({
      migrationsDir: preMigrationDir,
      creds: { migrateUrl: migrationUrl, expectedTargetId: targetId, environment: "development", allowFreshInitialization: true },
      connect: connectMigration,
    });
    const pre = await clientFor(migrationUrl);
    try {
      await pre.query(`
        INSERT INTO users (id,username,password,role,email_verified)
        VALUES (901,'legacy-user@example.invalid','legacy.old','recruiter',true);
        INSERT INTO organizations (id,name,slug,settings,is_active,signal_tenant_id)
        VALUES (901,'Legacy organization','legacy-organization','{}'::jsonb,true,NULL)
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
               (SELECT auth_version FROM users WHERE id=901) auth_version,
               (SELECT authority_origin FROM organizations WHERE id=901) authority_origin,
               (SELECT self_created_by_user_id FROM organizations WHERE id=901) self_created_by_user_id,
               (SELECT COUNT(*)::integer FROM pg_constraint
                 WHERE conname IN ('users_auth_version_positive_check','organizations_authority_origin_shape_check')) checks,
               (SELECT COUNT(*)::integer FROM pg_indexes
                 WHERE schemaname='public' AND indexname='organizations_self_service_creator_idx') indexes
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
    authorization = await import("../privilegeGrantRevocation");
    organizationService = await import("../organizationService");
    runtimePool = (await import("../../db")).pool;
  }, 180_000);

  beforeEach(async () => {
    if (!owner || !safeTargetProven) throw new Error("Disposable 2L-A target not proven.");
    await owner.query("TRUNCATE public.users, public.organizations RESTART IDENTITY CASCADE");
    await installFixture();
  });

  afterAll(async () => {
    if (runtimePool) await runtimePool.end();
    if (owner) await owner.end();
    if (safeTargetProven) await resetDatabase();
    if (preMigrationDir) rmSync(preMigrationDir, { recursive: true, force: true });
  });

  it("applies ledger 6 and classifies legacy rows without invented provenance", () => {
    expect(migrationEvidence).toEqual({
      ledger: 6,
      auth_version: 1,
      authority_origin: "legacy_unknown",
      self_created_by_user_id: null,
      checks: 2,
      indexes: 1,
    });
  });

  it("allows exactly one verified recruiter self-service grant with truthful origin", async () => {
    const created = await organizationService.createOrganization({ name: "Created organization" }, 30);
    expect(created).toMatchObject({
      name: "Created organization",
      authorityOrigin: "self_service_recruiter",
      selfCreatedByUserId: 30,
    });
    const rows = (await owner!.query(`
      SELECT o.authority_origin,o.self_created_by_user_id,m.role,m.seat_assigned
        FROM organizations o JOIN organization_members m ON m.organization_id=o.id
       WHERE o.self_created_by_user_id=30
    `)).rows;
    expect(rows).toEqual([{
      authority_origin: "self_service_recruiter",
      self_created_by_user_id: 30,
      role: "owner",
      seat_assigned: true,
    }]);
    await expect(organizationService.createOrganization({ name: "Second organization" }, 30))
      .rejects.toBeInstanceOf(organizationService.OrganizationSelfServiceGrantDeniedError);
  });

  it("denies candidate, unverified and already-member organization creation with zero inserts", async () => {
    for (const id of [31, 32, 33]) {
      await expect(organizationService.createOrganization({ name: `Denied ${id}` }, id))
        .rejects.toBeInstanceOf(organizationService.OrganizationSelfServiceGrantDeniedError);
    }
    expect(Number((await owner!.query(
      "SELECT COUNT(*) count FROM organizations WHERE authority_origin='self_service_recruiter'",
    )).rows[0].count)).toBe(0);
  });

  it("serializes concurrent self-service attempts to at most one owner grant", async () => {
    const results = await Promise.allSettled([
      organizationService.createOrganization({ name: "Race organization" }, 34),
      organizationService.createOrganization({ name: "Race organization" }, 34),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const row = (await owner!.query(`
      SELECT COUNT(*)::integer organizations,
             (SELECT COUNT(*)::integer FROM organization_members WHERE user_id=34 AND role='owner') memberships
        FROM organizations WHERE self_created_by_user_id=34
    `)).rows[0];
    expect(row).toEqual({ organizations: 1, memberships: 1 });
  });

  it("removes only a non-owner with no jobs and advances that user's version atomically", async () => {
    await expect(authorization.removeOrganizationMemberAndRevoke(2, 3))
      .resolves.toEqual({ ok: false, reason: "conflict", code: "jobs_owned" });
    await owner!.query("DELETE FROM jobs WHERE organization_id=10 AND posted_by=3");
    await expect(authorization.removeOrganizationMemberAndRevoke(2, 3)).resolves.toEqual({ ok: true });
    const row = (await owner!.query(`
      SELECT (SELECT COUNT(*)::integer FROM organization_members WHERE id=3) memberships,
             (SELECT auth_version FROM users WHERE id=3) auth_version
    `)).rows[0];
    expect(row).toEqual({ memberships: 0, auth_version: 2 });
    await expect(authorization.removeOrganizationMemberAndRevoke(2, 1))
      .resolves.toEqual({ ok: false, reason: "conflict", code: "owner_protected" });
  });

  it("changes role only through a seated owner and advances the target version", async () => {
    await expect(authorization.changeOrganizationMemberRoleAndRevoke(2, 3, "admin"))
      .resolves.toEqual({ ok: false, reason: "forbidden" });
    await expect(authorization.changeOrganizationMemberRoleAndRevoke(1, 3, "admin"))
      .resolves.toEqual({ ok: true, value: { id: 3, userId: 3, role: "admin", seatAssigned: true } });
    expect((await owner!.query("SELECT auth_version FROM users WHERE id=3")).rows[0])
      .toEqual({ auth_version: 2 });
    await expect(authorization.changeOrganizationMemberRoleAndRevoke(1, 1, "admin"))
      .resolves.toEqual({ ok: false, reason: "conflict", code: "owner_protected" });
  });

  it("reassigns only same-org source jobs to a distinct seated target", async () => {
    await expect(authorization.reassignOrganizationJobs(2, 3, 4))
      .resolves.toEqual({ ok: false, reason: "conflict", code: "invalid_target" });
    await expect(authorization.reassignOrganizationJobs(2, 1, 9))
      .resolves.toEqual({ ok: false, reason: "conflict", code: "owner_source" });
    await expect(authorization.reassignOrganizationJobs(2, 3, 5))
      .resolves.toEqual({ ok: false, reason: "not_found" });
    await expect(authorization.reassignOrganizationJobs(2, 3, 9))
      .resolves.toEqual({ ok: true, reassignedCount: 2 });
    expect((await owner!.query("SELECT array_agg(posted_by ORDER BY id) posters FROM jobs WHERE organization_id=10")).rows[0])
      .toEqual({ posters: [9, 9] });
  });

  it("advances password authorization without clearing the separately tracked reset token", async () => {
    await expect(authorization.resetPasswordAndAdvanceAuthorization(3, "new.synthetic.hash"))
      .resolves.toEqual({ ok: true });
    const row = (await owner!.query(`
      SELECT password,auth_version,password_reset_token,password_reset_expires IS NOT NULL reset_live
        FROM users WHERE id=3
    `)).rows[0];
    expect(row).toEqual({
      password: "new.synthetic.hash",
      auth_version: 2,
      password_reset_token: "synthetic-reset-hash",
      reset_live: true,
    });
  });

  it("invalidates legacy and versioned session payloads immediately after a version bump", async () => {
    const legacy = authorization.parseAuthorizationSessionPayload(3);
    const current = authorization.createAuthorizationSessionPayload({ id: 3, authVersion: 1 });
    expect(legacy).toEqual({ id: 3, authVersion: 1 });
    expect(current).toEqual({ id: 3, authVersion: 1 });
    await expect(authorization.resetPasswordAndAdvanceAuthorization(3, "new.synthetic.hash"))
      .resolves.toEqual({ ok: true });
    const stored = Number((await owner!.query("SELECT auth_version FROM users WHERE id=3")).rows[0].auth_version);
    expect(stored).toBe(2);
    expect(legacy?.authVersion).not.toBe(stored);
    expect(current?.authVersion).not.toBe(stored);
    expect(authorization.createAuthorizationSessionPayload({ id: 3, authVersion: stored }))
      .toEqual({ id: 3, authVersion: 2 });
  });

  it("grants runtime DML on new fields without DDL or role authority", async () => {
    const runtime = await clientFor(runtimeUrl);
    try {
      const row = (await runtime.query(`
        SELECT has_table_privilege(current_user,'public.users','SELECT,UPDATE') user_dml,
               has_table_privilege(current_user,'public.organizations','SELECT,INSERT,UPDATE') org_dml,
               has_table_privilege(current_user,'public.organization_members','SELECT,INSERT,UPDATE,DELETE') member_dml,
               has_schema_privilege(current_user,'public','CREATE') can_create,
               rolsuper,rolcreaterole
          FROM pg_roles WHERE rolname=current_user
      `)).rows[0];
      expect(row).toEqual({
        user_dml: true,
        org_dml: true,
        member_dml: true,
        can_create: false,
        rolsuper: false,
        rolcreaterole: false,
      });
    } finally {
      await runtime.end();
    }
  });
});
