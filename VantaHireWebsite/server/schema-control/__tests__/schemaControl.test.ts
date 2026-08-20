// Gate 1A0-F — disposable unit tests for the pure schema-control logic.
// No database, no network: fake pg + in-memory manifest only.
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadManifest, diffManifest, sha256, ManifestError } from "../manifest";
import {
  resolveMigrationCredentials,
  resolveSchemaEnvironment,
  assertTargetIdentity,
  safeOperationalMessage,
  safeTargetFingerprint,
  TargetIdentityError,
} from "../targetIdentity";
import {
  assertSchemaReady,
  FLOW_CRITICAL_POSTCONDITIONS,
  SchemaNotReadyError,
} from "../readiness";
import type { PgLike } from "../ledger";
import { runReleaseMigration, type MigrationClient } from "../runner";

function tmpMigrations(files: Record<string, string>, includeLock = true): string {
  const dir = mkdtempSync(join(tmpdir(), "flow-mig-"));
  for (const [name, sql] of Object.entries(files)) writeFileSync(join(dir, name), sql);
  if (includeLock) {
    const catalog = `${JSON.stringify({
      format_version: 1,
      projection_version: 1,
      source_sha: "0".repeat(40),
      source_catalog_sha256: "0".repeat(64),
      exclusions: [],
      records: [],
    })}\n`;
    writeFileSync(join(dir, "catalog.lock.json"), catalog);
    const migrations = Object.fromEntries(
      Object.entries(files).map(([name, sql]) => [name.split("_", 1)[0], sha256(sql)]),
    );
    writeFileSync(
      join(dir, "checksums.lock"),
      `${JSON.stringify({
        format_version: 1,
        catalog_lock_sha256: sha256(catalog),
        migrations,
      })}\n`,
    );
  }
  return dir;
}

describe("manifest", () => {
  it("loads contiguous versions and rejects gaps/dupes/bad names", () => {
    const dir = tmpMigrations({ "0000_baseline.sql": "SELECT 1;", "0001_add.sql": "SELECT 2;" });
    const m = loadManifest(dir);
    expect(m.map((e) => e.version)).toEqual(["0000", "0001"]);
    expect(m[0].checksum).toBe(sha256("SELECT 1;"));
    rmSync(dir, { recursive: true, force: true });

    const gap = tmpMigrations({ "0000_a.sql": "x", "0002_b.sql": "y" });
    expect(() => loadManifest(gap)).toThrow(ManifestError);
    rmSync(gap, { recursive: true, force: true });

    const bad = tmpMigrations({ "1_nope.sql": "x" });
    expect(() => loadManifest(bad)).toThrow(ManifestError);
    rmSync(bad, { recursive: true, force: true });
  });

  it("diff rejects a changed applied checksum and a removed applied version", () => {
    const dir = tmpMigrations({ "0000_b.sql": "SELECT 1;", "0001_c.sql": "SELECT 2;" });
    const m = loadManifest(dir);
    // pending when nothing applied
    expect(diffManifest(m, []).map((e) => e.version)).toEqual(["0000", "0001"]);
    // one applied, one pending
    expect(diffManifest(m, [{ version: "0000", checksum: m[0].checksum }]).map((e) => e.version)).toEqual(["0001"]);
    // tampered applied checksum
    expect(() => diffManifest(m, [{ version: "0000", checksum: "deadbeef" }])).toThrow(ManifestError);
    // applied version no longer on disk
    expect(() => diffManifest(m, [{ version: "0099", checksum: "x" }])).toThrow(ManifestError);
    rmSync(dir, { recursive: true, force: true });
  });

  it("requires exact migration and catalog checksum locks", () => {
    const missing = tmpMigrations({ "0000_base.sql": "SELECT 1;" }, false);
    expect(() => loadManifest(missing)).toThrow(/checksum lock/);
    rmSync(missing, { recursive: true, force: true });

    const catalogDrift = tmpMigrations({ "0000_base.sql": "SELECT 1;" });
    writeFileSync(join(catalogDrift, "catalog.lock.json"), "{}\n");
    expect(() => loadManifest(catalogDrift)).toThrow(/Catalog lock checksum changed/);
    rmSync(catalogDrift, { recursive: true, force: true });

    const migrationDrift = tmpMigrations({ "0000_base.sql": "SELECT 1;" });
    writeFileSync(join(migrationDrift, "0000_base.sql"), "SELECT 2;");
    expect(() => loadManifest(migrationDrift)).toThrow(/immutable checksum lock/);
    rmSync(migrationDrift, { recursive: true, force: true });
  });
});

describe("target identity", () => {
  it("fails closed without apply flag / migration credential / target id in production", () => {
    expect(() => resolveMigrationCredentials({ NODE_ENV: "production" })).toThrow(TargetIdentityError);
    expect(() =>
      resolveMigrationCredentials({ NODE_ENV: "production", FLOW_MIGRATION_APPLY: "1" }),
    ).toThrow(/FLOW_MIGRATE_DATABASE_URL/);
    expect(() =>
      resolveMigrationCredentials({
        NODE_ENV: "production",
        FLOW_MIGRATION_APPLY: "1",
        FLOW_MIGRATE_DATABASE_URL: "postgres://m",
      }),
    ).toThrow(/FLOW_SCHEMA_TARGET_ID/);
    const ok = resolveMigrationCredentials({
      NODE_ENV: "production",
      FLOW_MIGRATION_APPLY: "1",
      FLOW_MIGRATE_DATABASE_URL: "postgres://m",
      FLOW_SCHEMA_TARGET_ID: "abc123",
    });
    expect(ok.expectedTargetId).toBe("abc123");
    expect(ok.allowFreshInitialization).toBe(false);
  });

  it("never maps a missing/unknown environment to development", () => {
    expect(() => resolveSchemaEnvironment({})).toThrow(TargetIdentityError);
    expect(() => resolveSchemaEnvironment({ NODE_ENV: "preview" })).toThrow(TargetIdentityError);
    expect(() =>
      resolveMigrationCredentials({
        NODE_ENV: "preview",
        FLOW_MIGRATION_APPLY: "1",
        DATABASE_URL: "postgres://runtime",
        FLOW_SCHEMA_DISPOSABLE: "1",
      }),
    ).toThrow(TargetIdentityError);

    const disposable = resolveMigrationCredentials({
      NODE_ENV: "development",
      FLOW_MIGRATION_APPLY: "1",
      DATABASE_URL: "postgres://disposable",
      FLOW_SCHEMA_DISPOSABLE: "1",
    });
    expect(disposable.allowFreshInitialization).toBe(true);
  });

  it("logs only one-way target fingerprints and redacted operational errors", () => {
    const rawTarget = "production-target-secret-prefix";
    const fingerprint = safeTargetFingerprint(rawTarget);
    expect(fingerprint).toMatch(/^flow:[0-9a-f]{12}$/);
    expect(fingerprint).not.toContain("production-target");
    expect(safeTargetFingerprint(rawTarget)).toBe(fingerprint);

    const safe = safeOperationalMessage(
      new Error(
        "connect postgresql://user:pass@db.example/prod failed password=hunter2 token:bearer-secret api_key=provider-key",
      ),
    );
    expect(safe).not.toContain("user:pass");
    expect(safe).not.toContain("hunter2");
    expect(safe).not.toContain("bearer-secret");
    expect(safe).not.toContain("provider-key");
  });

  it("rejects a wrong / absent identity", () => {
    expect(() => assertTargetIdentity({ system: "flow", environment: "production", targetId: "t1" }, null)).toThrow(
      TargetIdentityError,
    );
    expect(() =>
      assertTargetIdentity(
        { system: "flow", environment: "production", targetId: "t1" },
        { system: "flow", environment: "production", target_id: "OTHER" },
      ),
    ).toThrow(TargetIdentityError);
    // exact match passes
    assertTargetIdentity(
      { system: "flow", environment: "production", targetId: "t1" },
      { system: "flow", environment: "production", target_id: "t1" },
    );
  });
});

describe("release runner target proof", () => {
  function targetProbeClient(identity: any): { client: MigrationClient; queries: string[] } {
    const queries: string[] = [];
    const client: MigrationClient = {
      async query(text: string) {
        queries.push(text);
        if (/to_regclass\('schema_control.identity'\)/.test(text)) {
          return { rows: [{ t: identity ? "schema_control.identity" : null }] };
        }
        if (/FROM schema_control.identity/.test(text)) {
          return { rows: identity ? [identity] : [] };
        }
        if (/pg_advisory_(?:lock|unlock)/.test(text) || /^SET\s/.test(text)) {
          return { rows: [] };
        }
        throw new Error(`unexpected query: ${text}`);
      },
      async end() {},
    };
    return { client, queries };
  }

  const prodCreds = {
    migrateUrl: "postgres://migration",
    expectedTargetId: "expected-target",
    environment: "production" as const,
    allowFreshInitialization: false,
  };

  it("does zero persistent work when production identity is absent", async () => {
    const { client, queries } = targetProbeClient(null);
    await expect(
      runReleaseMigration({
        migrationsDir: "/manifest-is-not-read-before-target-proof",
        creds: prodCreds,
        connect: async () => client,
      }),
    ).rejects.toThrow(/1A0-P catalog proof/);
    expect(queries.filter((q) => /\b(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE)\b/i.test(q))).toEqual([]);
  });

  it("does zero persistent work when production identity is wrong", async () => {
    const { client, queries } = targetProbeClient({
      system: "flow",
      environment: "production",
      target_id: "wrong-target",
    });
    await expect(
      runReleaseMigration({
        migrationsDir: "/manifest-is-not-read-before-target-proof",
        creds: prodCreds,
        connect: async () => client,
      }),
    ).rejects.toThrow(TargetIdentityError);
    expect(queries.filter((q) => /\b(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE)\b/i.test(q))).toEqual([]);
  });
});

describe("read-only readiness", () => {
  const dir = tmpMigrations({ "0000_base.sql": "SELECT 1;", "0001_x.sql": "SELECT 2;" });
  const m = loadManifest(dir);

  it("checks restricted runtime privileges and ownership using catalog reads only", async () => {
    const check = FLOW_CRITICAL_POSTCONDITIONS[1]!.check;
    let observedSql = "";
    const pg: PgLike = {
      async query(text: string) {
        observedSql = text;
        return { rows: [{ ok: true }] };
      },
    };
    await expect(check(pg)).resolves.toBe(true);
    expect(observedSql).toContain("NOT has_schema_privilege(current_user, 'public', 'CREATE')");
    expect(observedSql).toContain("pg_has_role");
    expect(observedSql.trimStart()).toMatch(/^SELECT\b/i);
    expect(observedSql).not.toMatch(
      /\b(?:CREATE\s+(?:TABLE|SCHEMA|SEQUENCE|FUNCTION)|ALTER\s+TABLE|DROP\s+(?:TABLE|SCHEMA)|INSERT\s+INTO|UPDATE\s+\S+\s+SET|DELETE\s+FROM|TRUNCATE\s+TABLE)\b/i,
    );

    await expect(
      check({ query: async () => ({ rows: [{ ok: false }] }) }),
    ).resolves.toBe(false);
  });

  function fakePg(rows: {
    identity: any;
    applied: any[];
    run?: { tablePresent?: boolean; unfinished?: number; latestOutcome?: "success" | "failure" | null };
  }): PgLike {
    const run = {
      tablePresent: true,
      unfinished: 0,
      latestOutcome: "success" as const,
      ...rows.run,
    };
    return {
      async query(text: string) {
        if (/to_regclass\('schema_control.identity'\)/.test(text)) return { rows: [{ t: rows.identity ? "x" : null }] };
        if (/to_regclass\('schema_control.applied'\)/.test(text)) return { rows: [{ t: rows.applied ? "x" : null }] };
        if (/to_regclass\('schema_control.run'\)/.test(text)) return { rows: [{ t: run.tablePresent ? "x" : null }] };
        if (/FROM schema_control.identity/.test(text)) return { rows: rows.identity ? [rows.identity] : [] };
        if (/FROM schema_control.applied/.test(text)) return { rows: rows.applied };
        if (/COUNT\(\*\) FILTER \(WHERE finished_at/.test(text)) {
          return { rows: [{ unfinished: run.unfinished, latest_outcome: run.latestOutcome }] };
        }
        throw new Error("unexpected query in readiness (write attempted?): " + text);
      },
    };
  }

  it("is ready only on exact identity + full applied ledger", async () => {
    const applied = m.map((e) => ({ version: e.version, file: e.file, checksum: e.checksum, apply_mode: "adopted", applied_at: "" }));
    const pg = fakePg({ identity: { system: "flow", environment: "production", target_id: "t1" }, applied });
    const res = await assertSchemaReady({
      pg,
      migrationsDir: dir,
      environment: "production",
      expectedTargetId: "t1",
      criticalPostconditions: [{ name: "test", check: async () => true }],
    });
    expect(res.applied).toBe(2);
  });

  it("fails closed on missing identity, partial ledger, and drift", async () => {
    const full = m.map((e) => ({ version: e.version, file: e.file, checksum: e.checksum, apply_mode: "adopted", applied_at: "" }));
    // no identity
    await expect(
      assertSchemaReady({ pg: fakePg({ identity: null, applied: full }), migrationsDir: dir, environment: "production", expectedTargetId: "t1" }),
    ).rejects.toBeInstanceOf(SchemaNotReadyError);
    // partial ledger
    await expect(
      assertSchemaReady({ pg: fakePg({ identity: { system: "flow", environment: "production", target_id: "t1" }, applied: full.slice(0, 1) }), migrationsDir: dir, environment: "production", expectedTargetId: "t1" }),
    ).rejects.toBeInstanceOf(SchemaNotReadyError);
    // checksum drift
    const drift = full.map((r, i) => (i === 1 ? { ...r, checksum: "bad" } : r));
    await expect(
      assertSchemaReady({ pg: fakePg({ identity: { system: "flow", environment: "production", target_id: "t1" }, applied: drift }), migrationsDir: dir, environment: "production", expectedTargetId: "t1" }),
    ).rejects.toBeInstanceOf(SchemaNotReadyError);
  });

  it("blocks unfinished/latest-failed attempts and omitted production postconditions", async () => {
    const full = m.map((e) => ({
      version: e.version,
      file: e.file,
      checksum: e.checksum,
      apply_mode: "adopted",
      applied_at: "",
    }));
    const base = {
      identity: { system: "flow", environment: "production", target_id: "t1" },
      applied: full,
    };
    const readyInput = {
      migrationsDir: dir,
      environment: "production" as const,
      expectedTargetId: "t1",
      criticalPostconditions: [{ name: "test", check: async () => true }],
    };

    await expect(
      assertSchemaReady({
        ...readyInput,
        pg: fakePg({ ...base, run: { unfinished: 1 } }),
      }),
    ).rejects.toThrow(/unfinished/);
    await expect(
      assertSchemaReady({
        ...readyInput,
        pg: fakePg({ ...base, run: { latestOutcome: "failure" } }),
      }),
    ).rejects.toThrow(/latest completed/);
    await expect(
      assertSchemaReady({
        pg: fakePg(base),
        migrationsDir: dir,
        environment: "production",
        expectedTargetId: "t1",
      }),
    ).rejects.toThrow(/No critical schema postconditions/);
  });
});
