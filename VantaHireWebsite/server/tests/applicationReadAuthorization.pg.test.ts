import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

const migrationUrl = (process.env.FLOW_SCHEMA_TEST_DATABASE_URL ?? "").trim();
const runtimeUrl = (process.env.FLOW_SCHEMA_TEST_RUNTIME_DATABASE_URL ?? "").trim();
const enabled = process.env.FLOW_AUTHZ_TEST_DISPOSABLE === "1"
  && Boolean(migrationUrl)
  && Boolean(runtimeUrl);

type AuthorizationModule = typeof import("../lib/applicationReadAuthorization");

let authorization: AuthorizationModule;
let owner: Client | undefined;
let runtimePool: { end(): Promise<void> } | undefined;
let safeTargetProven = false;
const schemaName = `flow_authz_test_${randomUUID().replaceAll("-", "")}`;

function quotedIdentifier(value: string): string {
  if (!/^[a-z][a-z0-9_]{1,127}$/.test(value)) {
    throw new Error("Disposable authorization identifier refused.");
  }
  return `"${value}"`;
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

function runtimeUrlForSchema(): string {
  const parsed = new URL(runtimeUrl);
  parsed.searchParams.set("options", `-c search_path=${schemaName}`);
  return parsed.toString();
}

async function databaseState(): Promise<string> {
  if (!owner) throw new Error("Disposable authorization owner is unavailable.");
  const result = await owner.query(`
    SELECT jsonb_build_object(
      'users', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id), '[]'::jsonb) FROM users t),
      'memberships', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id), '[]'::jsonb) FROM organization_members t),
      'jobs', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id), '[]'::jsonb) FROM jobs t),
      'job_recruiters', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id), '[]'::jsonb) FROM job_recruiters t),
      'applications', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id), '[]'::jsonb) FROM applications t),
      'stage_history', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id), '[]'::jsonb) FROM application_stage_history t),
      'email_history', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id), '[]'::jsonb) FROM email_audit_log t),
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
  const runtimeRole = new URL(runtimeUrl).username;
  const schema = quotedIdentifier(schemaName);
  const role = quotedIdentifier(runtimeRole);
  await owner.query(`CREATE SCHEMA ${schema} AUTHORIZATION CURRENT_USER`);
  await owner.query(`SET search_path TO ${schema}`);
  await owner.query(`
    CREATE TABLE organizations (
      id integer PRIMARY KEY,
      name text NOT NULL
    );
    CREATE TABLE users (
      id integer PRIMARY KEY,
      username text NOT NULL,
      password text NOT NULL,
      role text NOT NULL,
      email_verified boolean NOT NULL DEFAULT false,
      first_name text,
      last_name text
    );
    CREATE TABLE organization_members (
      id integer PRIMARY KEY,
      organization_id integer NOT NULL REFERENCES organizations(id),
      user_id integer NOT NULL REFERENCES users(id),
      role text NOT NULL DEFAULT 'member',
      seat_assigned boolean NOT NULL DEFAULT true,
      UNIQUE (organization_id, user_id)
    );
    CREATE TABLE jobs (
      id integer PRIMARY KEY,
      organization_id integer REFERENCES organizations(id),
      posted_by integer NOT NULL REFERENCES users(id)
    );
    CREATE TABLE job_recruiters (
      id integer PRIMARY KEY,
      organization_id integer REFERENCES organizations(id),
      job_id integer NOT NULL REFERENCES jobs(id),
      recruiter_id integer NOT NULL REFERENCES users(id),
      UNIQUE (job_id, recruiter_id)
    );
    CREATE TABLE applications (
      id integer PRIMARY KEY,
      job_id integer NOT NULL REFERENCES jobs(id),
      organization_id integer REFERENCES organizations(id)
    );
    CREATE TABLE application_stage_history (
      id integer PRIMARY KEY,
      application_id integer NOT NULL REFERENCES applications(id),
      from_stage integer,
      to_stage integer NOT NULL,
      changed_by integer NOT NULL REFERENCES users(id),
      notes text,
      changed_at timestamp NOT NULL
    );
    CREATE TABLE email_templates (
      id integer PRIMARY KEY,
      name text NOT NULL
    );
    CREATE TABLE email_audit_log (
      id integer PRIMARY KEY,
      application_id integer REFERENCES applications(id),
      template_id integer REFERENCES email_templates(id),
      template_type text,
      recipient_email text NOT NULL,
      subject text NOT NULL,
      sent_at timestamp NOT NULL,
      sent_by integer REFERENCES users(id),
      status text NOT NULL,
      error_message text,
      preview_url text
    );
    CREATE TABLE candidate_privacy_requests (
      request_id uuid PRIMARY KEY,
      action text NOT NULL,
      state text NOT NULL
    );
    CREATE TABLE candidate_privacy_subject_links (
      request_id uuid PRIMARY KEY REFERENCES candidate_privacy_requests(request_id),
      subject_type text NOT NULL,
      application_id integer REFERENCES applications(id)
    );
    CREATE TABLE candidate_privacy_remote_projection (
      request_id uuid PRIMARY KEY REFERENCES candidate_privacy_requests(request_id),
      decision text NOT NULL
    );
  `);
  await owner.query(`
    INSERT INTO organizations (id,name) VALUES (1,'Fixture org one'),(2,'Fixture org two');
    INSERT INTO users (id,username,password,role,email_verified,first_name,last_name) VALUES
      (101,'primary@example.invalid','x','recruiter',true,'Primary','Recruiter'),
      (102,'co@example.invalid','x','recruiter',true,'Co','Recruiter'),
      (103,'unassigned@example.invalid','x','recruiter',true,'Unassigned','Recruiter'),
      (104,'unseated@example.invalid','x','recruiter',true,'Unseated','Recruiter'),
      (105,'removed@example.invalid','x','recruiter',true,'Removed','Recruiter'),
      (201,'foreign@example.invalid','x','recruiter',true,'Foreign','Recruiter'),
      (301,'candidate@example.invalid','x','candidate',true,'Test','Candidate'),
      (302,'hm@example.invalid','x','hiring_manager',true,'Test','Manager'),
      (401,'admin@example.invalid','x','super_admin',true,'Platform','Admin');
    INSERT INTO organization_members (id,organization_id,user_id,role,seat_assigned) VALUES
      (1,1,101,'owner',true),(2,1,102,'member',true),(3,1,103,'member',true),
      (4,1,104,'member',false),(5,2,201,'owner',true);
    INSERT INTO jobs (id,organization_id,posted_by) VALUES
      (1001,1,101),(1002,2,201),(1003,NULL,101),(1004,2,101);
    INSERT INTO job_recruiters (id,organization_id,job_id,recruiter_id) VALUES (1,1,1001,102);
    INSERT INTO applications (id,job_id,organization_id) VALUES
      (2001,1001,1),(2002,1002,2),(2003,1003,NULL),(2004,1004,1),
      (2005,1001,1),(2006,1001,1),(2007,1001,1),(2008,1001,1);
    INSERT INTO application_stage_history (id,application_id,from_stage,to_stage,changed_by,notes,changed_at) VALUES
      (3001,2001,NULL,1,101,'Created','2026-08-26T09:00:00Z'),
      (3002,2001,1,2,101,'Reviewed','2026-08-26T10:00:00Z');
    INSERT INTO email_templates (id,name) VALUES (6001,'Status update');
    INSERT INTO email_audit_log
      (id,application_id,template_id,template_type,recipient_email,subject,sent_at,sent_by,status,error_message,preview_url)
    VALUES
      (5001,2001,6001,'status_update','fixture@example.invalid','private subject','2026-08-26T11:00:00Z',101,'success',NULL,'https://invalid/private'),
      (5002,2001,NULL,NULL,'fixture@example.invalid','private subject','2026-08-26T10:30:00Z',NULL,'success',NULL,NULL);
    INSERT INTO candidate_privacy_requests (request_id,action,state) VALUES
      ('00000000-0000-0000-0000-000000000005','request_erasure','memory_active'),
      ('00000000-0000-0000-0000-000000000006','request_erasure','needs_review'),
      ('00000000-0000-0000-0000-000000000007','withdraw_global_matching','memory_active');
    INSERT INTO candidate_privacy_subject_links (request_id,subject_type,application_id) VALUES
      ('00000000-0000-0000-0000-000000000005','application',2005),
      ('00000000-0000-0000-0000-000000000006','application',2006),
      ('00000000-0000-0000-0000-000000000007','application',2007);
    INSERT INTO candidate_privacy_remote_projection (request_id,decision) VALUES
      ('00000000-0000-0000-0000-000000000005','block_all'),
      ('00000000-0000-0000-0000-000000000006','review'),
      ('00000000-0000-0000-0000-000000000007','block_global');
    GRANT USAGE ON SCHEMA ${schema} TO ${role};
    GRANT SELECT ON ALL TABLES IN SCHEMA ${schema} TO ${role};
  `);
}

describe.skipIf(!enabled)("application read authorization disposable PostgreSQL", () => {
  beforeAll(async () => {
    if (!['test', 'development'].includes(process.env.NODE_ENV ?? "")) {
      throw new Error("Disposable authorization integration requires NODE_ENV=test|development.");
    }
    const migrationTarget = assertSafeUrl(migrationUrl, "migration");
    const runtimeTarget = assertSafeUrl(runtimeUrl, "runtime");
    if (migrationTarget.pathname !== runtimeTarget.pathname) {
      throw new Error("Disposable authorization database identity mismatch.");
    }

    owner = new Client({ connectionString: migrationUrl, connectionTimeoutMillis: 2_000 });
    const runtime = new Client({ connectionString: runtimeUrl, connectionTimeoutMillis: 2_000 });
    await owner.connect();
    await runtime.connect();
    try {
      const ownerIdentity = (await owner.query(
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
    }

    await installFixture();
    process.env.DATABASE_URL = runtimeUrlForSchema();
    process.env.DATABASE_SSL = "false";
    authorization = await import("../lib/applicationReadAuthorization");
    runtimePool = (await import("../db")).pool;
  }, 60_000);

  afterAll(async () => {
    await runtimePool?.end();
    if (owner && safeTargetProven) {
      await owner.query("SET search_path TO public");
      await owner.query(`DROP SCHEMA IF EXISTS ${quotedIdentifier(schemaName)} CASCADE`);
    }
    await owner?.end();
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
});
