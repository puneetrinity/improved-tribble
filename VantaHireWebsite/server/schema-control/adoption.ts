// Gate 1A0-R-A — one-time, metadata-only adoption of an exact existing Flow DB.
//
// Existing production must NEVER execute 0000_baseline.sql. After the
// separately controlled two-pass catalog comparison, this command records the
// already-present baseline in one bounded transaction. It can create/write
// only schema_control and proves zero non-control row mutation before commit.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { FLOW_SCHEMA_FROZEN_EVIDENCE, assertFrozenValue } from "./frozenEvidence";
import { CONTROL_DDL } from "./ledger";
import { loadManifest, sha256 } from "./manifest";
import { assertRuntimeRoleContract } from "./runtimeRole";
import { DEFAULT_LOCK_KEY, type MigrationClient } from "./runner";
import { assertRoleName, quoteIdentifier } from "./sqlIdentifier";
import {
  SYSTEM,
  resolveSchemaEnvironment,
  safeOperationalMessage,
  safeTargetFingerprint,
} from "./targetIdentity";

export class AdoptionError extends Error {}

export interface AdoptionOptions {
  migrationsDir: string;
  migrateUrl: string;
  expectedTargetId: string;
  runtimeRole: string;
  deployedSourceSha: string;
  sourceCatalogSha256: string;
  catalogLockSha256: string;
  connect: (url: string) => Promise<MigrationClient>;
  lockKey?: number;
  lockWaitMs?: number;
  statementTimeoutMs?: number;
  totalBudgetMs?: number;
  now?: () => number;
}

const REQUIRED_FLOW_MARKERS = [
  "public.users",
  "public.organizations",
  "public.organization_members",
  "public.jobs",
  "public.applications",
  "public.pipeline_stages",
  "public.candidate_resumes",
] as const;

function assertLocalFrozenInputs(opts: AdoptionOptions): ReturnType<typeof loadManifest>[number] {
  assertFrozenValue(
    "FLOW_SCHEMA_DEPLOYED_SOURCE_SHA",
    opts.deployedSourceSha,
    FLOW_SCHEMA_FROZEN_EVIDENCE.deployedSourceSha,
  );
  assertFrozenValue(
    "FLOW_SCHEMA_SOURCE_CATALOG_SHA256",
    opts.sourceCatalogSha256,
    FLOW_SCHEMA_FROZEN_EVIDENCE.sourceCatalogSha256,
  );
  assertFrozenValue(
    "FLOW_SCHEMA_CATALOG_LOCK_SHA256",
    opts.catalogLockSha256,
    FLOW_SCHEMA_FROZEN_EVIDENCE.catalogLockSha256,
  );
  const manifest = loadManifest(opts.migrationsDir);
  if (
    manifest.length !== 1 ||
    manifest[0]?.version !== "0000" ||
    manifest[0]?.file !== "0000_baseline.sql" ||
    manifest[0]?.checksum !== FLOW_SCHEMA_FROZEN_EVIDENCE.baselineSha256
  ) {
    throw new AdoptionError("Adoption requires the exact single-version 0000 manifest.");
  }
  const catalogHash = sha256(readFileSync(join(opts.migrationsDir, "catalog.lock.json")));
  if (catalogHash !== opts.catalogLockSha256) {
    throw new AdoptionError("Committed catalog lock does not match the independently approved hash.");
  }
  return manifest[0];
}

async function assertUnadoptedTarget(client: MigrationClient): Promise<void> {
  const state = await client.query(
    `SELECT to_regnamespace('schema_control') AS control_schema,
            to_regclass('schema_control.identity') AS identity,
            to_regclass('schema_control.applied') AS applied,
            to_regclass('schema_control.run') AS run`,
  );
  const row = state.rows[0] ?? {};
  if (row.control_schema || row.identity || row.applied || row.run) {
    throw new AdoptionError(
      "Refusing adoption: schema_control already exists wholly or partially; reconcile it read-only.",
    );
  }
  const markers = await client.query(
    `SELECT COUNT(*)::integer AS missing
       FROM unnest($1::text[]) AS required_relation(name)
      WHERE to_regclass(required_relation.name) IS NULL`,
    [[...REQUIRED_FLOW_MARKERS]],
  );
  if (Number(markers.rows[0]?.missing ?? REQUIRED_FLOW_MARKERS.length) !== 0) {
    throw new AdoptionError("Required Flow catalog markers are absent; refusing the database target.");
  }
}

export async function adoptExistingFlowDatabase(opts: AdoptionOptions): Promise<{
  identityMode: "adopted";
  applied: ["0000"];
}> {
  const baseline = assertLocalFrozenInputs(opts);
  const runtimeRole = assertRoleName(opts.runtimeRole);
  const runtimeIdent = quoteIdentifier(runtimeRole);
  const now = opts.now ?? (() => Date.now());
  const totalBudgetMs = Math.max(1, opts.totalBudgetMs ?? 120_000);
  const deadline = now() + totalBudgetMs;
  const statementTimeoutMs = Math.max(1, opts.statementTimeoutMs ?? 30_000);
  const fingerprint = safeTargetFingerprint(opts.expectedTargetId);
  const client = await opts.connect(opts.migrateUrl);
  try {
    await client.query("BEGIN");
    try {
      await client.query(`SET LOCAL statement_timeout = ${Math.min(statementTimeoutMs, totalBudgetMs)}`);
      await client.query(`SET LOCAL lock_timeout = ${Math.max(1, opts.lockWaitMs ?? 10_000)}`);
      await client.query("SET LOCAL idle_in_transaction_session_timeout = '120s'");
      await client.query("SELECT pg_advisory_xact_lock($1)", [opts.lockKey ?? DEFAULT_LOCK_KEY]);
      if (now() >= deadline) throw new AdoptionError("Adoption time budget expired before target proof.");

      // Repeat every target precondition after acquiring the shared lock.
      await assertUnadoptedTarget(client);
      await client.query(CONTROL_DDL);

      // P1 establishes the public-schema role contract. schema_control does
      // not exist until this transaction, so its read-only grants are completed
      // atomically here before the adopted control plane becomes visible.
      await client.query(`REVOKE ALL PRIVILEGES ON SCHEMA schema_control FROM ${runtimeIdent}`);
      await client.query(`GRANT USAGE ON SCHEMA schema_control TO ${runtimeIdent}`);
      await client.query(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA schema_control FROM ${runtimeIdent}`);
      await client.query(`GRANT SELECT ON ALL TABLES IN SCHEMA schema_control TO ${runtimeIdent}`);
      await client.query(
        `ALTER DEFAULT PRIVILEGES IN SCHEMA schema_control REVOKE ALL ON TABLES FROM ${runtimeIdent}`,
      );
      await client.query(
        `ALTER DEFAULT PRIVILEGES IN SCHEMA schema_control GRANT SELECT ON TABLES TO ${runtimeIdent}`,
      );

      await client.query(
        `INSERT INTO schema_control.identity (system,environment,target_id)
         VALUES ($1,'production',$2)`,
        [SYSTEM, opts.expectedTargetId],
      );
      await client.query(
        `INSERT INTO schema_control.applied (version,file,checksum,apply_mode)
         VALUES ($1,$2,$3,'adopted')`,
        [baseline.version, baseline.file, baseline.checksum],
      );
      await client.query(
        `INSERT INTO schema_control.run
           (finished_at,outcome,target_fingerprint,detail)
         VALUES (now(),'success',$1,$2)`,
        [fingerprint, "existing exact Flow baseline adopted after approved catalog comparison"],
      );

      const proof = await client.query(
        `SELECT
           (SELECT COUNT(*)::integer FROM schema_control.identity) AS identities,
           (SELECT COUNT(*)::integer FROM schema_control.applied) AS applied,
           (SELECT COUNT(*)::integer FROM schema_control.run) AS runs,
           (SELECT COUNT(*)::integer FROM schema_control.run
             WHERE finished_at IS NULL OR outcome IS DISTINCT FROM 'success') AS unhealthy_runs,
           (SELECT system FROM schema_control.identity WHERE singleton=true) AS system,
           (SELECT environment FROM schema_control.identity WHERE singleton=true) AS environment,
           (SELECT target_id FROM schema_control.identity WHERE singleton=true) AS target_id,
           (SELECT version FROM schema_control.applied) AS version,
           (SELECT file FROM schema_control.applied) AS file,
           (SELECT checksum FROM schema_control.applied) AS checksum,
           (SELECT apply_mode FROM schema_control.applied) AS apply_mode`,
      );
      const row = proof.rows[0] ?? {};
      if (
        row.identities !== 1 ||
        row.applied !== 1 ||
        row.runs !== 1 ||
        row.unhealthy_runs !== 0 ||
        row.system !== SYSTEM ||
        row.environment !== "production" ||
        row.target_id !== opts.expectedTargetId ||
        row.version !== baseline.version ||
        row.file !== baseline.file ||
        row.checksum !== baseline.checksum ||
        row.apply_mode !== "adopted"
      ) {
        throw new AdoptionError("Adoption control-plane read-back was not exact; rolling back.");
      }

      await assertRuntimeRoleContract(client, runtimeRole, true);
      const writes = await client.query(
        `SELECT COALESCE(SUM(n_tup_ins+n_tup_upd+n_tup_del),0)::bigint::text AS writes
           FROM pg_catalog.pg_stat_xact_user_tables
          WHERE schemaname <> 'schema_control'`,
      );
      if (writes.rows[0]?.writes !== "0") {
        throw new AdoptionError("Non-control application rows changed inside adoption; rolling back.");
      }
      if (now() >= deadline) throw new AdoptionError("Adoption time budget expired before commit.");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    }
  } finally {
    await client.end?.().catch(() => {});
  }
  return { identityMode: "adopted", applied: ["0000"] };
}

export function resolveAdoptionEnvironment(env: NodeJS.ProcessEnv = process.env): Omit<
  AdoptionOptions,
  "migrationsDir" | "connect"
> {
  if (env.FLOW_SCHEMA_ADOPT_EXISTING !== "1") {
    throw new AdoptionError("FLOW_SCHEMA_ADOPT_EXISTING=1 is required for one-time adoption.");
  }
  if (env.NODE_ENV !== "production" || resolveSchemaEnvironment(env) !== "production") {
    throw new AdoptionError("Existing-database adoption requires explicit production environment.");
  }
  const migrateUrl = (env.FLOW_MIGRATE_DATABASE_URL ?? "").trim();
  const expectedTargetId = (env.FLOW_SCHEMA_TARGET_ID ?? "").trim();
  const runtimeRole = assertRoleName(env.FLOW_RUNTIME_ROLE ?? "");
  if (!migrateUrl || !expectedTargetId) {
    throw new AdoptionError("Dedicated migration credential and opaque target id are required.");
  }
  return {
    migrateUrl,
    expectedTargetId,
    runtimeRole,
    deployedSourceSha: (env.FLOW_SCHEMA_DEPLOYED_SOURCE_SHA ?? "").trim(),
    sourceCatalogSha256: (env.FLOW_SCHEMA_SOURCE_CATALOG_SHA256 ?? "").trim(),
    catalogLockSha256: (env.FLOW_SCHEMA_CATALOG_LOCK_SHA256 ?? "").trim(),
  };
}

export function safeAdoptionError(error: unknown): string {
  return safeOperationalMessage(error);
}
