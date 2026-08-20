// Gate 1A0-F — Flow schema-control: applied ledger + run-attempt evidence.
//
// The control-plane lives in a dedicated `schema_control` schema so it is never
// confused with an application table. It holds exactly:
//   - identity        : one row; the opaque target identity of THIS database
//   - applied          : the ordered applied-migration ledger (immutable rows)
//   - run              : start/finish/failure attempt records (audit; a
//                        rolled-back failure stays visible)
//
// Only the release runner (migration credential) creates the schema or writes
// rows. The readiness path reads these tables and never writes.
//
// `PgLike` is the minimal query surface (node-postgres client/pool) so this
// module has no hard dependency on a specific driver instance.

export interface PgLike {
  query(text: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

export const CONTROL_SCHEMA = "schema_control";

export interface AppliedRow {
  version: string;
  file: string;
  checksum: string;
  apply_mode: "fresh" | "adopted";
  applied_at: string;
}

export interface RunHealth {
  tablePresent: boolean;
  unfinished: number;
  latestOutcome: "success" | "failure" | null;
}

/** DDL to create the control-plane. Idempotent; run only by the release path. */
export const CONTROL_DDL = `
CREATE SCHEMA IF NOT EXISTS ${CONTROL_SCHEMA};

CREATE TABLE IF NOT EXISTS ${CONTROL_SCHEMA}.identity (
  singleton    boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  system       text NOT NULL,
  environment  text NOT NULL,
  target_id    text NOT NULL,
  adopted_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ${CONTROL_SCHEMA}.applied (
  version      text PRIMARY KEY,
  file         text NOT NULL,
  checksum     text NOT NULL,
  apply_mode   text NOT NULL CHECK (apply_mode IN ('fresh','adopted')),
  applied_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ${CONTROL_SCHEMA}.run (
  run_id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  started_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz,
  outcome          text CHECK (outcome IN ('success','failure')),
  target_fingerprint text NOT NULL,
  detail           text
);
`;

/** Read the single identity row (or null if the control-plane is unadopted). */
export async function readIdentity(
  pg: PgLike,
): Promise<{ system: string; environment: string; target_id: string } | null> {
  // to_regclass avoids an error on a database that has no control-plane yet.
  const exists = await pg.query(
    `SELECT to_regclass('${CONTROL_SCHEMA}.identity') AS t`,
  );
  if (!exists.rows[0]?.t) return null;
  const r = await pg.query(
    `SELECT system, environment, target_id FROM ${CONTROL_SCHEMA}.identity WHERE singleton = true`,
  );
  return r.rows[0] ?? null;
}

/** Read the applied ledger ordered by version (empty if unadopted). */
export async function readApplied(pg: PgLike): Promise<AppliedRow[]> {
  const exists = await pg.query(
    `SELECT to_regclass('${CONTROL_SCHEMA}.applied') AS t`,
  );
  if (!exists.rows[0]?.t) return [];
  const r = await pg.query(
    `SELECT version, file, checksum, apply_mode, applied_at
       FROM ${CONTROL_SCHEMA}.applied ORDER BY version`,
  );
  return r.rows as AppliedRow[];
}

/**
 * Read only the migration-attempt health needed by process startup. Historical
 * failed attempts remain audit evidence; startup blocks when any attempt is
 * unfinished or when the latest completed attempt did not succeed.
 */
export async function readRunHealth(pg: PgLike): Promise<RunHealth> {
  const exists = await pg.query(
    `SELECT to_regclass('${CONTROL_SCHEMA}.run') AS t`,
  );
  if (!exists.rows[0]?.t) {
    return { tablePresent: false, unfinished: 0, latestOutcome: null };
  }
  const r = await pg.query(
    `SELECT
       COUNT(*) FILTER (WHERE finished_at IS NULL OR outcome IS NULL)::integer AS unfinished,
       (SELECT outcome
          FROM ${CONTROL_SCHEMA}.run
         WHERE finished_at IS NOT NULL AND outcome IS NOT NULL
         ORDER BY run_id DESC
         LIMIT 1) AS latest_outcome
       FROM ${CONTROL_SCHEMA}.run`,
  );
  return {
    tablePresent: true,
    unfinished: Number(r.rows[0]?.unfinished ?? 0),
    latestOutcome: (r.rows[0]?.latest_outcome ?? null) as RunHealth["latestOutcome"],
  };
}

export async function recordApplied(
  pg: PgLike,
  row: { version: string; file: string; checksum: string; applyMode: "fresh" | "adopted" },
): Promise<void> {
  await pg.query(
    `INSERT INTO ${CONTROL_SCHEMA}.applied (version, file, checksum, apply_mode)
       VALUES ($1,$2,$3,$4)`,
    [row.version, row.file, row.checksum, row.applyMode],
  );
}

export async function startRun(pg: PgLike, targetFingerprint: string): Promise<number> {
  const r = await pg.query(
    `INSERT INTO ${CONTROL_SCHEMA}.run (target_fingerprint) VALUES ($1) RETURNING run_id`,
    [targetFingerprint],
  );
  return Number(r.rows[0].run_id);
}

export async function finishRun(
  pg: PgLike,
  runId: number,
  outcome: "success" | "failure",
  detail: string,
): Promise<void> {
  await pg.query(
    `UPDATE ${CONTROL_SCHEMA}.run
        SET finished_at = now(), outcome = $2, detail = $3
      WHERE run_id = $1`,
    [runId, outcome, detail.slice(0, 2000)],
  );
}
