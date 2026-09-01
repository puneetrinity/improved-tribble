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
const targetId = "flow-talent-pool-authorization-test-target";
const policy = { allowPlatformAdmin: true } as const;

type Module = typeof import("../talentPoolAuthorization");
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
  if (!local || !parsed.pathname.includes("_test")) throw new Error(`Disposable 2K ${label} target refused.`);
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
  if (!owner) throw new Error("Disposable 2K owner unavailable.");
  await owner.query(`
    INSERT INTO organizations (id,name,slug,settings,is_active,signal_tenant_id) VALUES
      (1,'Talent org one','talent-org-one','{}'::jsonb,true,NULL),
      (2,'Talent org two','talent-org-two','{}'::jsonb,true,NULL);
    INSERT INTO users (id,username,password,role,email_verified,first_name,last_name) VALUES
      (101,'owner-a@example.invalid','x','recruiter',true,'Owner','A'),
      (102,'co-a@example.invalid','x','recruiter',true,'Co','A'),
      (103,'unseated@example.invalid','x','recruiter',true,'Unseated','A'),
      (104,'ambiguous@example.invalid','x','recruiter',true,'Ambiguous','Actor'),
      (105,'no-org@example.invalid','x','recruiter',true,'No','Org'),
      (201,'owner-b@example.invalid','x','recruiter',true,'Owner','B'),
      (301,'candidate@example.invalid','x','candidate',true,'Candidate','Actor'),
      (401,'platform@example.invalid','x','super_admin',true,'Platform','Admin');
    INSERT INTO organization_members
      (id,organization_id,user_id,role,seat_assigned,credits_allocated,credits_used,credits_rollover,invited_by)
    VALUES
      (1,1,101,'owner',true,0,0,0,NULL),
      (2,1,102,'member',true,0,0,0,101),
      (3,1,103,'member',false,0,0,0,101),
      (4,1,104,'member',true,0,0,0,101),
      (5,2,104,'member',true,0,0,0,201),
      (6,2,201,'owner',true,0,0,0,NULL);
    INSERT INTO talent_pool
      (id,organization_id,email,name,phone,recruiter_id,source,form_response_id,notes,resume_url,
       removed_at,removed_by_user_id,removal_reason,created_at,updated_at)
    VALUES
      (11,1,'owner-a-candidate@example.invalid','Owner A candidate','100',101,'manual',NULL,'Owner note','https://resume.example.invalid/11',NULL,NULL,NULL,now()-interval '2 hours',now()-interval '2 hours'),
      (12,1,'co-a-candidate@example.invalid','Co A candidate',NULL,102,'import',NULL,NULL,NULL,NULL,NULL,NULL,now()-interval '1 hour',now()-interval '1 hour'),
      (21,2,'foreign-candidate@example.invalid','Foreign candidate',NULL,201,'manual',NULL,NULL,NULL,NULL,NULL,NULL,now(),now()),
      (31,NULL,'null-org@example.invalid','Null org candidate',NULL,101,'manual',NULL,NULL,NULL,NULL,NULL,NULL,now(),now()),
      (41,1,'removed@example.invalid','Removed candidate',NULL,101,'manual',NULL,NULL,NULL,now()-interval '1 day',101,'organization_pool_removal',now(),now()),
      (51,1,'blocked@example.invalid','Blocked candidate',NULL,101,'manual',NULL,NULL,NULL,NULL,NULL,NULL,now(),now());
    INSERT INTO candidate_privacy_requests
      (request_id,directive_id,action,authority_type,actor_user_id,reason_code,state,version,last_delivery_status)
    VALUES
      ('00000000-0000-0000-0000-000000000051','10000000-0000-0000-0000-000000000051','request_erasure','verified_candidate',301,'candidate_erasure_request','memory_active',1,'delivered');
    INSERT INTO candidate_privacy_subject_links
      (link_id,request_id,subject_type,talent_pool_id,organization_id)
    VALUES
      ('20000000-0000-0000-0000-000000000051','00000000-0000-0000-0000-000000000051','talent_pool',51,1);
    INSERT INTO candidate_privacy_remote_projection
      (directive_id,request_id,action,scope,state,decision,version,effective_at,generation)
    VALUES
      ('10000000-0000-0000-0000-000000000051','00000000-0000-0000-0000-000000000051','request_erasure','active_profile','active_quarantine','block_all',1,now(),1);
  `);
}

async function poolShape(id: number): Promise<Record<string, unknown>> {
  return (await owner!.query(`
    SELECT organization_id,email,name,phone,recruiter_id,source,form_response_id,notes,resume_url,
           removed_at,removed_by_user_id,removal_reason,created_at,updated_at
      FROM talent_pool WHERE id=$1
  `, [id])).rows[0];
}

describe.skipIf(!enabled)("talent-pool exact-schema PostgreSQL", () => {
  beforeAll(async () => {
    if (process.env.NODE_ENV !== "test") throw new Error("Disposable 2K integration requires NODE_ENV=test.");
    const migration = assertSafeUrl(migrationUrl, "migration");
    const runtime = assertSafeUrl(runtimeUrl, "runtime");
    if (migration.pathname !== runtime.pathname) throw new Error("Disposable 2K database mismatch.");
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
        throw new Error("Disposable 2K identity proof failed.");
      }
      safeTargetProven = true;
    } finally {
      await ownerProbe.end();
      await runtimeProbe.end();
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
    process.env.DATABASE_URL = runtimeUrl;
    process.env.DATABASE_SSL = "false";
    authorization = await import("../talentPoolAuthorization");
    runtimePool = (await import("../../db")).pool;
  }, 180_000);

  beforeEach(async () => {
    if (!owner || !safeTargetProven) throw new Error("Disposable 2K target not proven.");
    await owner.query("TRUNCATE public.users, public.organizations RESTART IDENTITY CASCADE");
    await installFixture();
  });

  afterAll(async () => {
    if (runtimePool) await runtimePool.end();
    if (owner) await owner.end();
    if (safeTargetProven) await resetDatabase();
  });

  it("keeps the shipped seven-migration schema and append-only event relation", async () => {
    const row = (await owner!.query(`
      SELECT (SELECT COUNT(*)::integer FROM schema_control.applied) ledger,
             to_regclass('public.talent_pool_membership_events')::text event_relation,
             EXISTS (
               SELECT 1 FROM pg_trigger
                WHERE tgrelid='public.talent_pool_membership_events'::regclass
                  AND NOT tgisinternal
             ) append_only_trigger
    `)).rows[0];
    expect(row).toEqual({
      ledger: 7,
      event_relation: "talent_pool_membership_events",
      append_only_trigger: true,
    });
  });

  it("lists all active privacy-allowed organization rows regardless of creator", async () => {
    const result = await authorization.listAuthorizedTalentPoolCandidates(101);
    expect(result).toMatchObject({ ok: true, rows: [{ id: 12 }, { id: 11 }] });
    if (!result.ok) throw new Error("expected list authorization");
    expect(result.rows.map((row) => row.id)).toEqual([12, 11]);
    expect(Object.keys(result.rows[0]!)).toEqual([
      "id", "name", "email", "phone", "source", "notes", "resumeUrl", "createdAt", "updatedAt",
    ]);
  });

  it("denies collection/create to platform and malformed recruiter contexts", async () => {
    for (const actorId of [103, 104, 105, 301, 401]) {
      await expect(authorization.listAuthorizedTalentPoolCandidates(actorId))
        .resolves.toEqual({ ok: false, reason: "forbidden" });
      await expect(authorization.readAuthorizedTalentPoolCreateContext(actorId))
        .resolves.toEqual({ ok: false, reason: "forbidden" });
    }
  });

  it("authorizes same-org and explicit platform exact-object reads only", async () => {
    for (const actorId of [101, 102, 401]) {
      await expect(authorization.readAuthorizedTalentPoolCandidate(actorId, 11, policy))
        .resolves.toMatchObject({ ok: true, value: { id: 11 } });
    }
    for (const id of [21, 31, 41, 51, 999999]) {
      await expect(authorization.readAuthorizedTalentPoolCandidate(101, id, policy))
        .resolves.toEqual({ ok: false, reason: "not_found" });
    }
    await expect(authorization.readAuthorizedTalentPoolCandidate(401, 31, policy))
      .resolves.toEqual({ ok: false, reason: "not_found" });
  });

  it("derives organization and recruiter on create and preserves normalized-email conflict", async () => {
    const created = await authorization.createAuthorizedTalentPoolCandidate(102, {
      name: "Created candidate",
      email: "CREATED@example.invalid",
      phone: null,
      source: "manual",
      notes: "Created",
      resumeUrl: null,
    });
    expect(created).toMatchObject({ ok: true, value: { email: "created@example.invalid" } });
    const inserted = (await owner!.query(`
      SELECT organization_id,recruiter_id,email,form_response_id,removed_at
        FROM talent_pool WHERE email='created@example.invalid'
    `)).rows[0];
    expect(inserted).toEqual({
      organization_id: 1,
      recruiter_id: 102,
      email: "created@example.invalid",
      form_response_id: null,
      removed_at: null,
    });
    await expect(authorization.createAuthorizedTalentPoolCandidate(102, {
      name: "Duplicate", email: "Created@Example.Invalid", source: "manual",
    })).resolves.toEqual({ ok: false, reason: "conflict", code: "candidate_exists" });
    const before = Number((await owner!.query("SELECT COUNT(*) count FROM talent_pool")).rows[0].count);
    await expect(authorization.createAuthorizedTalentPoolCandidate(103, {
      name: "Denied", email: "denied@example.invalid", source: "manual",
    })).resolves.toEqual({ ok: false, reason: "forbidden" });
    expect(Number((await owner!.query("SELECT COUNT(*) count FROM talent_pool")).rows[0].count)).toBe(before);
  });

  it("allows a different seated same-org recruiter to update only allowed fields", async () => {
    const before = await poolShape(11);
    await expect(authorization.updateAuthorizedTalentPoolCandidate(
      102, 11, { name: "Updated name", notes: "Updated note" }, policy,
    )).resolves.toMatchObject({ ok: true, value: { id: 11, name: "Updated name", notes: "Updated note" } });
    const after = await poolShape(11);
    expect({ ...after, name: before.name, notes: before.notes, updated_at: before.updated_at }).toEqual(before);
    expect(after.name).toBe("Updated name");
    expect(after.notes).toBe("Updated note");
    expect(new Date(after.updated_at as string).getTime()).toBeGreaterThanOrEqual(new Date(before.updated_at as string).getTime());
  });

  it("makes denial and privacy loss mutation-free", async () => {
    const foreignBefore = await poolShape(21);
    await expect(authorization.updateAuthorizedTalentPoolCandidate(101, 21, { notes: "Denied" }, policy))
      .resolves.toEqual({ ok: false, reason: "not_found" });
    expect(await poolShape(21)).toEqual(foreignBefore);

    const sameOrgBefore = await poolShape(11);
    await owner!.query(`
      INSERT INTO candidate_privacy_requests
        (request_id,directive_id,action,authority_type,actor_user_id,reason_code,state,version,last_delivery_status)
      VALUES
        ('00000000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000011','request_erasure','verified_candidate',301,'candidate_erasure_request','memory_active',1,'delivered');
      INSERT INTO candidate_privacy_subject_links
        (link_id,request_id,subject_type,talent_pool_id,organization_id)
      VALUES
        ('20000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000011','talent_pool',11,1);
      INSERT INTO candidate_privacy_remote_projection
        (directive_id,request_id,action,scope,state,decision,version,effective_at,generation)
      VALUES
        ('10000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000011','request_erasure','active_profile','active_quarantine','block_all',1,now(),1)
    `);
    await expect(authorization.updateAuthorizedTalentPoolCandidate(101, 11, { notes: "Blocked" }, policy))
      .resolves.toEqual({ ok: false, reason: "not_found" });
    expect(await poolShape(11)).toEqual(sameOrgBefore);
  });

  it("soft-removes and restores with one matching append-only event each", async () => {
    const removeEvent = "123e4567-e89b-42d3-a456-426614174011";
    const restoreEvent = "123e4567-e89b-42d3-a456-426614174012";
    await expect(authorization.removeAuthorizedTalentPoolCandidate(102, 11, removeEvent, policy))
      .resolves.toEqual({ ok: true });
    expect((await owner!.query(`
      SELECT removed_at IS NOT NULL removed,removed_by_user_id,removal_reason FROM talent_pool WHERE id=11
    `)).rows[0]).toEqual({ removed: true, removed_by_user_id: 102, removal_reason: "organization_pool_removal" });
    expect((await owner!.query(`
      SELECT event_id::text,talent_pool_id,organization_id,actor_user_id,event_type,reason_code
        FROM talent_pool_membership_events ORDER BY occurred_at,event_id
    `)).rows).toEqual([{
      event_id: removeEvent,
      talent_pool_id: 11,
      organization_id: 1,
      actor_user_id: 102,
      event_type: "removed",
      reason_code: "organization_pool_removal",
    }]);
    await expect(authorization.removeAuthorizedTalentPoolCandidate(102, 11, "123e4567-e89b-42d3-a456-426614174013", policy))
      .resolves.toEqual({ ok: false, reason: "not_found" });
    expect(Number((await owner!.query("SELECT COUNT(*) count FROM talent_pool_membership_events")).rows[0].count)).toBe(1);

    await expect(authorization.restoreAuthorizedTalentPoolCandidate(401, 11, restoreEvent, policy))
      .resolves.toMatchObject({ ok: true, value: { id: 11 } });
    expect((await owner!.query(`
      SELECT removed_at,removed_by_user_id,removal_reason FROM talent_pool WHERE id=11
    `)).rows[0]).toEqual({ removed_at: null, removed_by_user_id: null, removal_reason: null });
    expect((await owner!.query(`
      SELECT event_type,reason_code,actor_user_id FROM talent_pool_membership_events ORDER BY occurred_at,event_id
    `)).rows).toEqual([
      { event_type: "removed", reason_code: "organization_pool_removal", actor_user_id: 102 },
      { event_type: "restored", reason_code: "operator_restore", actor_user_id: 401 },
    ]);
  });

  it("gives the runtime role required DML but no DDL or role bypass", async () => {
    const runtime = await clientFor(runtimeUrl);
    try {
      const row = (await runtime.query(`
        SELECT has_table_privilege(current_user,'public.talent_pool','SELECT,INSERT,UPDATE') talent_dml,
               has_table_privilege(current_user,'public.talent_pool_membership_events','SELECT,INSERT') event_dml,
               has_schema_privilege(current_user,'public','CREATE') can_create,
               rolsuper,rolcreaterole
          FROM pg_roles WHERE rolname=current_user
      `)).rows[0];
      expect(row).toEqual({
        talent_dml: true,
        event_dml: true,
        can_create: false,
        rolsuper: false,
        rolcreaterole: false,
      });
    } finally {
      await runtime.end();
    }
  });
});
