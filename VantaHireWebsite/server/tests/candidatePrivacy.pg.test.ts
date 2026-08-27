// Phase 1AF — opt-in disposable PostgreSQL privacy-authority matrix.
//
// This suite owns the same strictly local *_test identities as the schema
// matrix, but runs in a separate process after that matrix. It resets and
// freshly installs the database before importing application DB code.

import { randomUUID } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";

import { runReleaseMigration, type MigrationClient } from "../schema-control/runner";
import { sha256 } from "../schema-control/manifest";
import { provisionRuntimeRole } from "../schema-control/runtimeRole";

const migrationUrl = (process.env.FLOW_SCHEMA_TEST_DATABASE_URL ?? "").trim();
const runtimeUrl = (process.env.FLOW_SCHEMA_TEST_RUNTIME_DATABASE_URL ?? "").trim();
const enabled = process.env.FLOW_SCHEMA_TEST_DISPOSABLE === "1"
  && Boolean(migrationUrl)
  && Boolean(runtimeUrl);
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "schema-migrations");
const targetId = "flow-candidate-privacy-test-target";

type Repository = typeof import("../candidate-privacy/repository");
let repository: Repository;
let runtimePool: { end(): Promise<void> } | undefined;
let safeTargetProven = false;
let baselineOnlyDir = "";

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

function createBaselineOnlyManifest(): string {
  const dir = mkdtempSync(join(tmpdir(), "flow-privacy-baseline-"));
  copyFileSync(join(migrationsDir, "0000_baseline.sql"), join(dir, "0000_baseline.sql"));
  copyFileSync(join(migrationsDir, "catalog.lock.json"), join(dir, "catalog.lock.json"));
  const lock = JSON.parse(readFileSync(join(migrationsDir, "checksums.lock"), "utf8")) as {
    catalog_lock_sha256: string;
    migrations: Record<string, string>;
  };
  writeFileSync(join(dir, "checksums.lock"), `${JSON.stringify({
    format_version: 1,
    catalog_lock_sha256: lock.catalog_lock_sha256,
    migrations: { "0000": sha256(readFileSync(join(dir, "0000_baseline.sql"))) },
  }, null, 2)}\n`);
  return dir;
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

async function resetFixtures(): Promise<void> {
  const client = await clientFor(migrationUrl);
  try {
    await client.query(`TRUNCATE TABLE
      candidate_privacy_request_events,
      candidate_privacy_remote_projection,
      candidate_privacy_outbox,
      candidate_privacy_subject_links,
      candidate_privacy_sync_state,
      candidate_privacy_requests,
      talent_pool_membership_events,
      users RESTART IDENTITY CASCADE`);
  } finally {
    await client.end();
  }
}

async function createCandidate(): Promise<number> {
  const client = await clientFor(migrationUrl);
  try {
    return Number((await client.query(
      `INSERT INTO users (username,password,role,email_verified)
       VALUES ('candidate@example.invalid','not-a-real-hash','candidate',true)
       RETURNING id`,
    )).rows[0]?.id);
  } finally {
    await client.end();
  }
}

function requestInput(userId: number, requestId = randomUUID()) {
  return {
    requestId,
    action: "withdraw_global_matching" as const,
    authorityType: "verified_candidate" as const,
    actorUserId: userId,
    evidenceRef: randomUUID(),
    reasonCode: "candidate_global_opt_out" as const,
    anchor: { type: "candidate_user" as const, id: userId },
  };
}

describe.skipIf(!enabled)("candidate privacy disposable PostgreSQL", () => {
  beforeAll(async () => {
    if (process.env.NODE_ENV !== "test") {
      throw new Error("Disposable candidate privacy integration requires NODE_ENV=test.");
    }
    const migration = await clientFor(migrationUrl);
    const runtime = await clientFor(runtimeUrl);
    try {
      const migrationIdentity = (await migration.query(
        "SELECT current_database() AS database,current_user AS role,host(inet_server_addr()) AS server_addr",
      )).rows[0] ?? {};
      const runtimeIdentity = (await runtime.query(
        "SELECT current_database() AS database,current_user AS role,host(inet_server_addr()) AS server_addr",
      )).rows[0] ?? {};
      const local = (value: unknown) => [null, "127.0.0.1", "::1"].includes(value as any);
      if (
        !String(migrationIdentity.database ?? "").startsWith("flow_schema_control_test_")
        || migrationIdentity.role !== "flow_schema_control_test_runner"
        || !local(migrationIdentity.server_addr)
        || runtimeIdentity.database !== migrationIdentity.database
        || runtimeIdentity.role !== "flow_schema_control_test_runtime"
        || !local(runtimeIdentity.server_addr)
      ) {
        throw new Error("Refusing candidate privacy integration: disposable target proof failed.");
      }
      safeTargetProven = true;
    } finally {
      await runtime.end();
      await migration.end();
    }

    await resetDatabase();
    baselineOnlyDir = createBaselineOnlyManifest();
    await runReleaseMigration({
      migrationsDir: baselineOnlyDir,
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
      runtimeRole: "flow_schema_control_test_runtime",
      expectedTargetId: targetId,
      connectMigration,
      connectRuntime,
    });
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

    process.env.DATABASE_URL = runtimeUrl;
    process.env.DATABASE_SSL = "false";
    repository = await import("../candidate-privacy/repository");
    runtimePool = (await import("../db")).pool;
  }, 180_000);

  beforeEach(async () => {
    if (!safeTargetProven) throw new Error("Disposable target proof did not complete.");
    await resetFixtures();
  });

  afterAll(async () => {
    await runtimePool?.end();
    if (safeTargetProven) await resetDatabase();
    if (baselineOnlyDir) rmSync(baselineOnlyDir, { recursive: true, force: true });
  });

  it("installs the seven-table authority with durable restricted privileges", async () => {
    const runtime = await clientFor(runtimeUrl);
    const migration = await clientFor(migrationUrl);
    try {
      const catalog = await runtime.query(
        `SELECT COUNT(*)::integer AS table_count
           FROM information_schema.tables
          WHERE table_schema='public'
            AND table_name IN (
              'candidate_privacy_requests','candidate_privacy_request_events',
              'candidate_privacy_subject_links','candidate_privacy_outbox',
              'candidate_privacy_remote_projection','candidate_privacy_sync_state',
              'talent_pool_membership_events'
            )`,
      );
      expect(catalog.rows[0]?.table_count).toBe(7);
      expect((await runtime.query(
        "SELECT has_table_privilege(current_user,'candidate_privacy_request_events','INSERT') AS can_insert",
      )).rows[0]?.can_insert).toBe(true);

      const before = await runtime.query(
        `SELECT has_table_privilege(current_user,'candidate_privacy_request_events','UPDATE') AS can_update,
                has_table_privilege(current_user,'candidate_privacy_request_events','DELETE') AS can_delete`,
      );
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
      const after = await runtime.query(
        `SELECT has_table_privilege(current_user,'candidate_privacy_request_events','UPDATE') AS can_update,
                has_table_privilege(current_user,'candidate_privacy_request_events','DELETE') AS can_delete`,
      );
      expect(after.rows[0]).toEqual(before.rows[0]);
      expect((await migration.query(
        "SELECT COUNT(*)::integer AS applied FROM schema_control.applied",
      )).rows[0]?.applied).toBe(3);
    } finally {
      await migration.end();
      await runtime.end();
    }
  });

  it("creates the request, event, links and payload-free outbox atomically and replays exactly", async () => {
    const userId = await createCandidate();
    const input = requestInput(userId);
    const first = await repository.createLocalPrivacyRequest(input);
    const second = await repository.createLocalPrivacyRequest(input);
    expect(second).toEqual(first);

    await expect(repository.createLocalPrivacyRequest({
      ...input,
      action: "request_erasure",
    })).rejects.toThrow("candidate_privacy_request_conflict");

    const client = await clientFor(migrationUrl);
    try {
      const counts = (await client.query(
        `SELECT
          (SELECT COUNT(*)::integer FROM candidate_privacy_requests) AS requests,
          (SELECT COUNT(*)::integer FROM candidate_privacy_request_events) AS events,
          (SELECT COUNT(*)::integer FROM candidate_privacy_subject_links) AS links,
          (SELECT COUNT(*)::integer FROM candidate_privacy_outbox) AS outbox`,
      )).rows[0];
      expect(counts).toEqual({ requests: 1, events: 1, links: 1, outbox: 1 });
      const outboxColumns = (await client.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema='public' AND table_name='candidate_privacy_outbox'
          ORDER BY ordinal_position`,
      )).rows.map((row) => row.column_name);
      expect(outboxColumns).not.toContain("payload");
      expect(outboxColumns).not.toContain("body");
      expect(outboxColumns).not.toContain("email");
    } finally {
      await client.end();
    }
  });

  it("serializes concurrent creation into one projection, event and outbox row", async () => {
    const userId = await createCandidate();
    const input = requestInput(userId);
    const [a, b] = await Promise.all([
      repository.createLocalPrivacyRequest(input),
      repository.createLocalPrivacyRequest(input),
    ]);
    expect(a).toEqual(b);
    const client = await clientFor(migrationUrl);
    try {
      const counts = (await client.query(
        `SELECT
          (SELECT COUNT(*)::integer FROM candidate_privacy_requests) AS requests,
          (SELECT COUNT(*)::integer FROM candidate_privacy_request_events) AS events,
          (SELECT COUNT(*)::integer FROM candidate_privacy_outbox) AS outbox`,
      )).rows[0];
      expect(counts).toEqual({ requests: 1, events: 1, outbox: 1 });
    } finally {
      await client.end();
    }
  });

  it("recovers expired outbox leases without destructive dequeue", async () => {
    const userId = await createCandidate();
    await repository.createLocalPrivacyRequest(requestInput(userId));
    const first = await repository.claimPrivacyOutbox(1_000);
    expect(first).not.toBeNull();
    const migration = await clientFor(migrationUrl);
    try {
      await migration.query(
        "UPDATE candidate_privacy_outbox SET lease_expires_at=now()-interval '1 second' WHERE outbox_id=$1",
        [first!.outboxId],
      );
    } finally {
      await migration.end();
    }
    const reclaimed = await repository.claimPrivacyOutbox(1_000);
    expect(reclaimed?.outboxId).toBe(first?.outboxId);
    expect(reclaimed?.leaseToken).not.toBe(first?.leaseToken);
    await repository.markOutboxRetry(reclaimed!, "memory_unavailable", true);

    const client = await clientFor(migrationUrl);
    try {
      expect((await client.query(
        "SELECT state,attempt_count FROM candidate_privacy_outbox WHERE outbox_id=$1",
        [first!.outboxId],
      )).rows[0]).toEqual({ state: "retry", attempt_count: 2 });
      expect((await client.query(
        "SELECT COUNT(*)::integer AS n FROM candidate_privacy_outbox",
      )).rows[0]?.n).toBe(1);
    } finally {
      await client.end();
    }
  });

  it("commits Memory delivery, projection and audit together", async () => {
    const userId = await createCandidate();
    const input = requestInput(userId);
    await repository.createLocalPrivacyRequest(input);
    const claim = await repository.claimPrivacyOutbox(5_000);
    const directiveId = randomUUID();
    await expect(repository.markOutboxDelivered(claim!, {
      request_id: randomUUID(),
      directive_id: directiveId,
      action: "request_erasure",
      scope: "active_profile",
      state: "active_quarantine",
      version: 1,
      effective_at: new Date().toISOString(),
      decision: "block_all",
    })).rejects.toThrow("candidate_privacy_remote_contract_conflict");
    await repository.markOutboxDelivered(claim!, {
      request_id: input.requestId,
      directive_id: directiveId,
      action: input.action,
      scope: "global_matching",
      state: "active_quarantine",
      version: 1,
      effective_at: new Date().toISOString(),
      decision: "block_global",
    });
    expect(await repository.privacyDecisionForAnchor(
      input.anchor,
      { globalUse: true },
    )).toBe("block_global");
    expect(await repository.privacyDecisionForAnchor(
      input.anchor,
      { globalUse: false },
    )).toBe("allow_existing_org_workflow");

    const client = await clientFor(migrationUrl);
    try {
      expect((await client.query(
        `SELECT r.state,r.version,o.state AS outbox_state,p.decision,
                (SELECT COUNT(*)::integer FROM candidate_privacy_request_events) AS events
           FROM candidate_privacy_requests r
           JOIN candidate_privacy_outbox o USING (request_id)
           JOIN candidate_privacy_remote_projection p USING (request_id)`,
      )).rows[0]).toEqual({
        state: "memory_active",
        version: 2,
        outbox_state: "succeeded",
        decision: "block_global",
        events: 2,
      });
    } finally {
      await client.end();
    }
  });

  it("fails closed on feed gaps and converges through a generation swap", async () => {
    const userId = await createCandidate();
    const input = requestInput(userId);
    await repository.createLocalPrivacyRequest(input);
    const claim = await repository.claimPrivacyOutbox(5_000);
    const directiveId = randomUUID();
    await repository.markOutboxDelivered(claim!, {
      request_id: input.requestId,
      directive_id: directiveId,
      action: input.action,
      scope: "global_matching",
      state: "active_quarantine",
      version: 1,
      effective_at: new Date().toISOString(),
      decision: "block_global",
    });

    await expect(repository.applyMemoryChanges([{
      cursor: 2,
      event_id: randomUUID(),
      directive_id: directiveId,
      action: input.action,
      scope: "global_matching",
      state: "released",
      version: 2,
      effective_at: new Date().toISOString(),
    }])).rejects.toThrow("candidate_privacy_cursor_gap");
    expect(await repository.privacyDecisionForAnchor(
      input.anchor,
      { globalUse: true, newGlobalOperation: true },
    )).toBe("review");

    await repository.replaceProjectionFromSnapshot({
      highWaterCursor: 2,
      directives: [{
        directive_id: directiveId,
        action: input.action,
        scope: "global_matching",
        state: "released",
        version: 2,
        effective_at: new Date().toISOString(),
      }],
    });
    expect(await repository.syncCursor()).toBe(2);
    expect(await repository.privacyDecisionForAnchor(
      input.anchor,
      { globalUse: true },
    )).toBe("allow_existing_org_workflow");
    const client = await clientFor(migrationUrl);
    try {
      expect((await client.query(
        `SELECT r.state,r.version,p.state AS remote_state,p.version AS remote_version,
                COUNT(e.event_id) FILTER (WHERE e.event_type='remote_projection')::integer AS projection_events
           FROM candidate_privacy_requests r
           JOIN candidate_privacy_remote_projection p USING (request_id)
           LEFT JOIN candidate_privacy_request_events e USING (request_id)
          GROUP BY r.state,r.version,p.state,p.version`,
      )).rows[0]).toEqual({
        state: "released",
        version: 3,
        remote_state: "released",
        remote_version: 2,
        projection_events: 1,
      });
    } finally {
      await client.end();
    }
  });

  it("advances local lifecycle once for a newer feed event and not for a duplicate", async () => {
    const userId = await createCandidate();
    const input = requestInput(userId);
    await repository.createLocalPrivacyRequest(input);
    const claim = await repository.claimPrivacyOutbox(5_000);
    const directiveId = randomUUID();
    const effectiveAt = new Date().toISOString();
    await repository.markOutboxDelivered(claim!, {
      request_id: input.requestId,
      directive_id: directiveId,
      action: input.action,
      scope: "global_matching",
      state: "active_quarantine",
      version: 1,
      effective_at: effectiveAt,
      decision: "block_global",
    });

    const released = {
      event_id: randomUUID(),
      directive_id: directiveId,
      action: input.action,
      scope: "global_matching" as const,
      state: "released" as const,
      version: 2,
      effective_at: effectiveAt,
    };
    expect(await repository.applyMemoryChanges([{ ...released, cursor: 1 }])).toBe(1);
    expect(await repository.applyMemoryChanges([{ ...released, cursor: 2 }])).toBe(2);

    const client = await clientFor(migrationUrl);
    try {
      expect((await client.query(
        `SELECT r.state,r.version,p.state AS remote_state,p.version AS remote_version,
                COUNT(e.event_id) FILTER (WHERE e.event_type='remote_projection')::integer AS projection_events
           FROM candidate_privacy_requests r
           JOIN candidate_privacy_remote_projection p USING (request_id)
           LEFT JOIN candidate_privacy_request_events e USING (request_id)
          GROUP BY r.state,r.version,p.state,p.version`,
      )).rows[0]).toEqual({
        state: "released",
        version: 3,
        remote_state: "released",
        remote_version: 2,
        projection_events: 1,
      });
    } finally {
      await client.end();
    }
  });

  it("keeps request and pool membership event ledgers append-only", async () => {
    const userId = await createCandidate();
    const input = requestInput(userId);
    await repository.createLocalPrivacyRequest(input);
    const runtime = await clientFor(runtimeUrl);
    try {
      await expect(runtime.query(
        "UPDATE candidate_privacy_request_events SET reason_code='candidate_erasure_request'",
      )).rejects.toMatchObject({ code: "P0001" });
      await expect(runtime.query(
        "DELETE FROM candidate_privacy_request_events",
      )).rejects.toMatchObject({ code: "P0001" });
      expect((await runtime.query(
        "SELECT COUNT(*)::integer AS n FROM candidate_privacy_request_events",
      )).rows[0]?.n).toBe(1);
    } finally {
      await runtime.end();
    }
  });
});
