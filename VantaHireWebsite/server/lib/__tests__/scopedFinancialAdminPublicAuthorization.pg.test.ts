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
const targetId = "flow-scoped-financial-admin-public-test-target";

type Module = typeof import("../scopedFinancialAdminPublicAuthorization");
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
  if (!local || !parsed.pathname.includes("_test")) throw new Error(`Disposable 2J ${label} target refused.`);
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
  if (!owner) throw new Error("Disposable 2J owner unavailable.");
  await owner.query(`
    INSERT INTO organizations (id,name,slug,settings,is_active,signal_tenant_id) VALUES
      (1,'Financial org one','financial-org-one','{}'::jsonb,true,NULL),
      (2,'Financial org two','financial-org-two','{}'::jsonb,true,NULL);
    INSERT INTO users
      (id,username,password,role,email_verified,first_name,last_name,email_verification_token,
       password_reset_token,ai_content_free_used,onboarding_completed_at)
    VALUES
      (101,'owner-one@example.invalid','owner-secret','recruiter',true,'Owner','One','verify-owner','reset-owner',true,now()),
      (102,'org-admin@example.invalid','admin-secret','recruiter',true,'Org','Admin','verify-admin','reset-admin',false,NULL),
      (103,'member@example.invalid','member-secret','recruiter',true,'Org','Member',NULL,NULL,false,NULL),
      (104,'unseated@example.invalid','unseated-secret','recruiter',true,'Unseated','Owner',NULL,NULL,false,NULL),
      (105,'no-org@example.invalid','no-org-secret','recruiter',true,'No','Org',NULL,NULL,false,NULL),
      (106,'candidate-owner@example.invalid','candidate-secret','candidate',true,'Candidate','Owner',NULL,NULL,false,NULL),
      (201,'owner-two@example.invalid','foreign-secret','recruiter',true,'Owner','Two',NULL,NULL,false,NULL),
      (301,'seat-target@example.invalid','seat-secret','recruiter',true,'Seat','Target','verify-seat','reset-seat',false,NULL),
      (302,'owner-target@example.invalid','owner-target-secret','recruiter',true,'Owner','Target',NULL,NULL,false,NULL),
      (303,'foreign-target@example.invalid','foreign-target-secret','recruiter',true,'Foreign','Target',NULL,NULL,false,NULL),
      (304,'unseat-target@example.invalid','unseat-secret','recruiter',true,'Unseat','Target',NULL,NULL,false,NULL),
      (401,'platform-admin@example.invalid','platform-secret','super_admin',true,'Platform','Admin','verify-platform','reset-platform',true,now()),
      (402,'role-target@example.invalid','credential-secret','candidate',false,'Role','Target','verify-target','reset-target',true,now());
    INSERT INTO organization_members
      (id,organization_id,user_id,role,seat_assigned,credits_allocated,credits_used,credits_rollover,invited_by)
    VALUES
      (1,1,101,'owner',true,0,0,0,NULL),
      (2,1,102,'admin',true,0,0,0,101),
      (3,1,103,'member',true,0,0,0,101),
      (4,1,104,'owner',false,0,0,0,101),
      (5,1,106,'owner',true,0,0,0,101),
      (6,2,201,'owner',true,0,0,0,NULL),
      (7,1,301,'member',false,9,3,1,101),
      (8,1,302,'owner',true,7,2,1,101),
      (9,2,303,'member',false,5,1,0,201),
      (10,1,304,'member',true,4,1,0,101);
    INSERT INTO subscription_plans
      (id,name,display_name,price_per_seat_monthly,price_per_seat_annual,ai_credits_per_seat_monthly,features,is_active)
    VALUES (1,'fixture','Fixture',100,1000,10,'{}'::jsonb,true);
    INSERT INTO organization_subscriptions
      (id,organization_id,plan_id,seats,paid_seats,billing_cycle,status,start_date,current_period_start,current_period_end)
    VALUES
      (1,1,1,8,8,'monthly','active',now(),now(),now()+interval '30 days'),
      (2,2,1,2,2,'monthly','active',now(),now(),now()+interval '30 days');
    INSERT INTO payment_transactions
      (id,organization_id,subscription_id,type,amount,tax_amount,total_amount,currency,status,
       cashfree_order_id,cashfree_payment_id,metadata,failure_reason,invoice_number,invoice_url,completed_at)
    VALUES
      (501,1,1,'subscription',10000,1800,11800,'INR','completed','order-501','payment-secret-501','{"private":"one"}',NULL,'INV-202608-1-501','/api/invoices/INV-202608-1-501.pdf',now()-interval '1 day'),
      (502,1,1,'seat_addition',2000,360,2360,'INR','completed','order-502','payment-secret-502','{"private":"two"}',NULL,'INV-202608-1-502','https://provider.example.invalid/invoice-502',now()),
      (503,1,1,'subscription',9000,1620,10620,'INR','pending','order-503',NULL,'{"private":"pending"}',NULL,NULL,NULL,NULL),
      (601,2,2,'subscription',7000,1260,8260,'INR','completed','order-601','payment-secret-601','{"private":"foreign"}',NULL,'INV-202608-2-601','https://provider.example.invalid/invoice-601',now());
    INSERT INTO user_ai_usage
      (id,organization_id,user_id,kind,tokens_in,tokens_out,cost_usd,computed_at,metadata)
    VALUES
      (1,1,101,'summary',10,20,0.0001,now()-interval '1 day','{"applicationId":99}'),
      (2,1,103,'summary',5,7,0.0001,now()-interval '2 days','{"candidateEmail":"private"}'),
      (3,1,101,'email_draft',3,4,0.0001,now()-interval '3 days','{"applicationId":88}'),
      (4,2,201,'summary',100,200,9.99,now()-interval '1 day','{"foreign":true}'),
      (5,NULL,101,'summary',300,400,9.99,now()-interval '1 day','{"nullOrg":true}'),
      (6,1,101,'summary',500,600,9.99,now()-interval '31 days','{"old":true}');
  `);
}

describe.skipIf(!enabled)("scoped financial/admin exact-schema PostgreSQL", () => {
  beforeAll(async () => {
    if (process.env.NODE_ENV !== "test") throw new Error("Disposable 2J integration requires NODE_ENV=test.");
    const migration = assertSafeUrl(migrationUrl, "migration");
    const runtime = assertSafeUrl(runtimeUrl, "runtime");
    if (migration.pathname !== runtime.pathname) throw new Error("Disposable 2J database mismatch.");
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
        throw new Error("Disposable 2J identity proof failed.");
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
    authorization = await import("../scopedFinancialAdminPublicAuthorization");
    runtimePool = (await import("../../db")).pool;
  }, 180_000);

  beforeEach(async () => {
    if (!owner || !safeTargetProven) throw new Error("Disposable 2J target not proven.");
    await owner.query("TRUNCATE public.subscription_plans, public.users, public.organizations RESTART IDENTITY CASCADE");
    await installFixture();
  });

  afterAll(async () => {
    if (runtimePool) await runtimePool.end();
    if (owner) await owner.end();
    if (safeTargetProven) await resetDatabase();
  });

  it("keeps the shipped six-migration schema unchanged", async () => {
    const row = (await owner!.query(`
      SELECT (SELECT COUNT(*)::integer FROM schema_control.applied) ledger,
             to_regclass('public.application_reviewer_notes')::text notes_relation,
             to_regclass('public.client_shortlists')::text shortlists_relation
    `)).rows[0];
    expect(row).toEqual({
      ledger: 6,
      notes_relation: "application_reviewer_notes",
      shortlists_relation: "client_shortlists",
    });
  });

  it("assigns and unassigns only the same-organization seat column", async () => {
    const before = (await owner!.query(`
      SELECT organization_id,user_id,role,seat_assigned,credits_allocated,credits_used,credits_rollover
        FROM organization_members WHERE id=7
    `)).rows[0];
    await expect(authorization.assignAuthorizedSeat(101, 7)).resolves.toMatchObject({
      ok: true, value: { memberId: 7, seatAssigned: true, changed: true, organizationId: 1 },
    });
    const after = (await owner!.query(`
      SELECT organization_id,user_id,role,seat_assigned,credits_allocated,credits_used,credits_rollover
        FROM organization_members WHERE id=7
    `)).rows[0];
    expect({ ...after, seat_assigned: before.seat_assigned }).toEqual(before);
    expect(after.seat_assigned).toBe(true);

    await expect(authorization.unassignAuthorizedSeat(101, 10)).resolves.toMatchObject({
      ok: true, value: { memberId: 10, seatAssigned: false, changed: true, organizationId: 1 },
    });
    await expect(authorization.unassignAuthorizedSeat(101, 10)).resolves.toMatchObject({
      ok: true, value: { memberId: 10, seatAssigned: false, changed: false },
    });
  });

  it("collapses foreign and absent seats and enforces actor, capacity and owner boundaries", async () => {
    await expect(authorization.assignAuthorizedSeat(101, 9))
      .resolves.toEqual({ ok: false, reason: "not_found" });
    await expect(authorization.assignAuthorizedSeat(101, 999999))
      .resolves.toEqual({ ok: false, reason: "not_found" });
    for (const actorId of [102, 103, 104, 105, 106, 401]) {
      await expect(authorization.assignAuthorizedSeat(actorId, 7))
        .resolves.toEqual({ ok: false, reason: "forbidden" });
    }
    await expect(authorization.assignAuthorizedSeat(201, 7))
      .resolves.toEqual({ ok: false, reason: "not_found" });
    await expect(authorization.unassignAuthorizedSeat(101, 8)).resolves.toEqual({
      ok: false, reason: "conflict", code: "owner_seat_required",
    });
    await owner!.query("UPDATE organization_subscriptions SET seats=6 WHERE id=1");
    await expect(authorization.assignAuthorizedSeat(101, 7)).resolves.toEqual({
      ok: false, reason: "conflict", code: "no_seats_available",
    });
    expect((await owner!.query("SELECT seat_assigned FROM organization_members WHERE id=7")).rows[0].seat_assigned)
      .toBe(false);
  });

  it("lists only the current organization completed invoice projection", async () => {
    const result = await authorization.listAuthorizedInvoices(101);
    expect(result).toEqual({ ok: true, rows: [
      {
        id: 502, invoiceNumber: "INV-202608-1-502", type: "seat_addition", totalAmount: 2360,
        completedAt: expect.any(String), downloadPath: "/api/subscription/invoices/502/pdf",
      },
      {
        id: 501, invoiceNumber: "INV-202608-1-501", type: "subscription", totalAmount: 11800,
        completedAt: expect.any(String), downloadPath: "/api/subscription/invoices/501/pdf",
      },
    ] });
    if (!result.ok) throw new Error("expected invoice authorization");
    expect(Object.keys(result.rows[0]!)).toEqual([
      "id", "invoiceNumber", "type", "totalAmount", "completedAt", "downloadPath",
    ]);
    for (const actorId of [102, 103, 104, 105, 106, 401]) {
      await expect(authorization.listAuthorizedInvoices(actorId))
        .resolves.toEqual({ ok: false, reason: "forbidden" });
    }
    await expect(authorization.listAuthorizedInvoices(201)).resolves.toMatchObject({
      ok: true,
      rows: [{ id: 601, invoiceNumber: "INV-202608-2-601" }],
    });
  });

  it("authorizes exact invoice ids and filenames while collapsing foreign, pending and absent", async () => {
    await expect(authorization.readAuthorizedInvoiceById(101, 501)).resolves.toEqual({
      ok: true,
      value: {
        id: 501,
        invoiceNumber: "INV-202608-1-501",
        invoiceUrl: "/api/invoices/INV-202608-1-501.pdf",
      },
    });
    await expect(authorization.readAuthorizedInvoiceByFileName(101, "INV-202608-1-501.pdf"))
      .resolves.toMatchObject({ ok: true, value: { id: 501 } });
    for (const invoiceId of [503, 601, 999999]) {
      await expect(authorization.readAuthorizedInvoiceById(101, invoiceId))
        .resolves.toEqual({ ok: false, reason: "not_found" });
    }
    for (const fileName of ["INV-202608-2-601.pdf", "INV-202608-1-999999.pdf"]) {
      await expect(authorization.readAuthorizedInvoiceByFileName(101, fileName))
        .resolves.toEqual({ ok: false, reason: "not_found" });
    }
  });

  it("aggregates only current-organization recent AI activity with deterministic kinds", async () => {
    await expect(authorization.readAuthorizedOrganizationAiActivity(101)).resolves.toEqual({
      ok: true,
      value: {
        windowDays: 30,
        totals: { operations: 3, tokensIn: 18, tokensOut: 31 },
        byKind: [
          { kind: "email_draft", operations: 1, tokensIn: 3, tokensOut: 4 },
          { kind: "summary", operations: 2, tokensIn: 15, tokensOut: 27 },
        ],
      },
    });
    for (const actorId of [102, 103, 104, 105, 106, 401]) {
      await expect(authorization.readAuthorizedOrganizationAiActivity(actorId))
        .resolves.toEqual({ ok: false, reason: "forbidden" });
    }
    await expect(authorization.readAuthorizedOrganizationAiActivity(201)).resolves.toMatchObject({
      ok: true,
      value: { totals: { operations: 1, tokensIn: 100, tokensOut: 200 } },
    });
  });

  it("requires the stored platform role, mutates only role and returns exactly six safe fields", async () => {
    const before = (await owner!.query(`
      SELECT username,password,email_verified,email_verification_token,password_reset_token,
             ai_content_free_used,onboarding_completed_at
        FROM users WHERE id=402
    `)).rows[0];
    const result = await authorization.updateAuthorizedUserRole(401, 402, "hiring_manager");
    expect(result).toEqual({ ok: true, value: {
      id: 402,
      email: "role-target@example.invalid",
      firstName: "Role",
      lastName: "Target",
      role: "hiring_manager",
      emailVerified: false,
    } });
    expect(Object.keys(result.ok ? result.value : {})).toEqual([
      "id", "email", "firstName", "lastName", "role", "emailVerified",
    ]);
    const after = (await owner!.query(`
      SELECT username,password,email_verified,email_verification_token,password_reset_token,
             ai_content_free_used,onboarding_completed_at
        FROM users WHERE id=402
    `)).rows[0];
    expect(after).toEqual(before);
    await expect(authorization.updateAuthorizedUserRole(101, 402, "recruiter"))
      .resolves.toEqual({ ok: false, reason: "forbidden" });
    await expect(authorization.updateAuthorizedUserRole(401, 999999, "recruiter"))
      .resolves.toEqual({ ok: false, reason: "not_found" });
  });

  it("keeps the runtime role DML-only", async () => {
    const runtime = await clientFor(runtimeUrl);
    try {
      const row = (await runtime.query(`
        SELECT current_user role,
               has_schema_privilege(current_user,'public','CREATE') can_create,
               has_table_privilege(current_user,'organization_members','UPDATE') can_update_members,
               has_table_privilege(current_user,'users','UPDATE') can_update_users,
               has_table_privilege(current_user,'payment_transactions','SELECT') can_read_invoices,
               has_table_privilege(current_user,'user_ai_usage','SELECT') can_read_usage,
               has_table_privilege(current_user,'schema_control.applied','INSERT') can_write_ledger
      `)).rows[0];
      expect(row).toMatchObject({
        can_create: false,
        can_update_members: true,
        can_update_users: true,
        can_read_invoices: true,
        can_read_usage: true,
        can_write_ledger: false,
      });
    } finally {
      await runtime.end();
    }
  });
});
