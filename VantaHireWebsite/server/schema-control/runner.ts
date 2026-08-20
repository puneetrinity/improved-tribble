// Gate 1A0-F — Flow schema-control: release migration runner.
//
// This is the ONLY path that changes schema. It is invoked as an explicit,
// bounded release action (never at app/worker startup). It:
//   1. connects with the DEDICATED migration credential (never runtime),
//   2. serializes via one bounded advisory lock (timeout = failure),
//   3. initializes only an explicitly disposable development DB, or verifies
//      an identity already established by the separately approved adoption,
//   4. applies each pending manifest entry in one transaction (unless a
//      migration explicitly opts out), enforcing statement + total deadlines,
//   5. records immutable applied rows + a start/finish run attempt.
// Any mismatch/failure aborts without deploying new code.

import {
  CONTROL_DDL,
  finishRun,
  readApplied,
  readIdentity,
  recordApplied,
  startRun,
  type PgLike,
} from "./ledger";
import { diffManifest, loadManifest } from "./manifest";
import {
  SYSTEM,
  assertTargetIdentity,
  resolveMigrationCredentials,
  safeOperationalMessage,
  safeTargetFingerprint,
  type MigrationCredentials,
} from "./targetIdentity";

export class MigrationRunError extends Error {}

/** node-postgres-shaped client that supports an exclusive session. */
export interface MigrationClient extends PgLike {
  end?(): Promise<void>;
}

export interface RunnerOptions {
  migrationsDir: string;
  creds: MigrationCredentials;
  /** Create a fresh single-session client bound to the migration credential. */
  connect: (migrateUrl: string) => Promise<MigrationClient>;
  lockKey?: number; // advisory lock key; default derived from system
  lockWaitMs?: number; // max wait to acquire lock
  statementTimeoutMs?: number; // per-statement timeout
  totalBudgetMs?: number; // whole-run budget
  now?: () => number;
}

export const DEFAULT_LOCK_KEY = 0x1a0f1a0f; // stable, arbitrary 32-bit advisory-lock key (fits int4)
const DEFAULTS = { lockWaitMs: 10_000, statementTimeoutMs: 60_000, totalBudgetMs: 600_000 };

export interface RunResult {
  identityMode: "fresh" | "adopted";
  applied: string[]; // versions applied this run
}

export async function runReleaseMigration(opts: RunnerOptions): Promise<RunResult> {
  const creds = opts.creds;
  const now = opts.now ?? (() => Date.now());
  const statementTimeoutMs = Math.max(
    1,
    Math.floor(opts.statementTimeoutMs ?? DEFAULTS.statementTimeoutMs),
  );
  const totalBudgetMs = Math.max(1, Math.floor(opts.totalBudgetMs ?? DEFAULTS.totalBudgetMs));
  const deadline = now() + totalBudgetMs;
  const lockKey = opts.lockKey ?? DEFAULT_LOCK_KEY;
  const client = await opts.connect(creds.migrateUrl);
  const fingerprint = safeTargetFingerprint(creds.expectedTargetId);

  const assertBudget = (): number => {
    const remaining = deadline - now();
    if (remaining <= 0) throw new MigrationRunError("Migration total time budget exceeded — aborting (timeout is failure, never continue).");
    return remaining;
  };
  const constrainNextStatement = async () => {
    // The server cancels the next statement at the smaller of the per-statement
    // and whole-run remaining budgets. This matters most for a final long SQL:
    // checking only before it would allow the run to overrun while it executes.
    const remaining = assertBudget();
    await client.query(`SET statement_timeout = ${Math.max(1, Math.min(statementTimeoutMs, remaining))}`);
  };

  try {
    // Per-session bounded statement timeout so a hung statement cannot stall.
    await client.query(`SET statement_timeout = ${Math.min(statementTimeoutMs, totalBudgetMs)}`);
    await client.query(`SET lock_timeout = ${Number(opts.lockWaitMs ?? DEFAULTS.lockWaitMs)}`);

    // 1. Serialize: exclusive advisory lock, bounded by lock_timeout above.
    try {
      await client.query(`SELECT pg_advisory_lock($1)`, [lockKey]);
    } catch (e) {
      throw new MigrationRunError(`Could not acquire migration advisory lock within the wait budget (${fingerprint}).`);
    }

    let runId: number | null = null;
    try {
      // 2. Prove target identity BEFORE any persistent statement. Production,
      // staging, and non-disposable development databases are adopted only by
      // the separately approved 1A0-P catalog/identity procedure. The release
      // runner must never turn an arbitrary connection string into an adopted
      // target merely because an expected id was supplied beside it.
      const identity = await readIdentity(client);
      assertBudget();
      let identityMode: "fresh" | "adopted";
      if (identity === null) {
        if (!creds.allowFreshInitialization || creds.environment !== "development") {
          throw new MigrationRunError(
            `No verified schema-control identity exists for ${fingerprint}; production/staging adoption requires the separately approved 1A0-P catalog proof.`,
          );
        }

        // The sole automatic-adoption case is an explicitly disposable local/
        // CI database. Create the control plane, insert (never silently race via
        // ON CONFLICT), then re-read and prove the exact identity before the run
        // ledger or application schema is touched.
        await constrainNextStatement();
        await client.query(CONTROL_DDL);
        assertBudget();
        await constrainNextStatement();
        await client.query(
          `INSERT INTO schema_control.identity (system, environment, target_id)
             VALUES ($1,$2,$3)`,
          [SYSTEM, creds.environment, creds.expectedTargetId],
        );
        const adoptedIdentity = await readIdentity(client);
        assertTargetIdentity(
          { system: SYSTEM, environment: creds.environment, targetId: creds.expectedTargetId },
          adoptedIdentity,
        );
        identityMode = "fresh";
      } else {
        assertTargetIdentity(
          { system: SYSTEM, environment: creds.environment, targetId: creds.expectedTargetId },
          identity,
        );
        // Identity is proven. The idempotent control DDL may now repair only
        // the control-plane tables required by this migration mechanism.
        await constrainNextStatement();
        await client.query(CONTROL_DDL);
        assertBudget();
        identityMode = "adopted";
      }

      // 3. Open the auditable attempt only after identity proof.
      await constrainNextStatement();
      runId = await startRun(client, fingerprint);
      assertBudget();

      // 4. Diff manifest vs applied ledger (throws on checksum/history drift).
      const manifest = loadManifest(opts.migrationsDir);
      const applied = await readApplied(client);
      assertBudget();
      const pending = diffManifest(
        manifest,
        applied.map((a) => ({ version: a.version, checksum: a.checksum })),
      );

      const appliedNow: string[] = [];
      const applyMode = identityMode === "fresh" && applied.length === 0 ? "fresh" : "adopted";
      for (const entry of pending) {
        await constrainNextStatement();
        if (entry.transactional) {
          await client.query("BEGIN");
          try {
            await client.query(entry.sql);
            assertBudget();
            await recordApplied(client, {
              version: entry.version,
              file: entry.file,
              checksum: entry.checksum,
              applyMode: entry.version === "0000" ? applyMode : "adopted",
            });
            await client.query("COMMIT");
          } catch (e) {
            await client.query("ROLLBACK").catch(() => {});
            throw new MigrationRunError(`Migration ${entry.version} (${entry.file}) failed and was rolled back.`);
          }
        } else {
          // Non-transactional migration: explicitly declared; applied outside a
          // txn. Its own approval/compensation plan is required before use.
          await client.query(entry.sql);
          assertBudget();
          await recordApplied(client, {
            version: entry.version,
            file: entry.file,
            checksum: entry.checksum,
            applyMode: "adopted",
          });
        }
        appliedNow.push(entry.version);
      }

      await constrainNextStatement();
      await finishRun(client, runId, "success", `applied=${appliedNow.join(",") || "(none)"} mode=${identityMode}`);
      return { identityMode, applied: appliedNow };
    } catch (e) {
      if (runId !== null) {
        await finishRun(client, runId, "failure", safeOperationalMessage(e)).catch(() => {});
      }
      throw e;
    } finally {
      await client.query(`SELECT pg_advisory_unlock($1)`, [lockKey]).catch(() => {});
    }
  } finally {
    await client.end?.();
  }
}

/** Convenience for the release entrypoint: resolve creds then run. */
export async function runFromEnv(
  migrationsDir: string,
  connect: RunnerOptions["connect"],
  env: NodeJS.ProcessEnv = process.env,
): Promise<RunResult> {
  const creds = resolveMigrationCredentials(env);
  return runReleaseMigration({ migrationsDir, creds, connect });
}
