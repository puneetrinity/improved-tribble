import { sql } from 'drizzle-orm';

import { pool } from '../db';

export const OUTREACH_CANDIDATE_LOCK_NAMESPACE = 1748527104;
export const OUTREACH_EMAIL_LOCK_NAMESPACE = 1748527105;

export type OutreachDispatchFenceResult<T> =
  | { status: 'ran'; value: T }
  | { status: 'blocked'; reason: 'hard_bounce' | 'hygiene_sync_pending' };

// Cost guard only. The locked check in withOutreachDispatchFence remains the
// authority because a complaint can arrive after this early read.
export async function hasPendingGlobalOutreachComplaint(): Promise<boolean> {
  const result = await pool.query(`
    SELECT EXISTS (
      SELECT 1
      FROM outreach_hygiene_intents
      WHERE reason = 'complaint' AND status <> 'synced'
    ) AS pending
  `);
  return result.rows?.[0]?.pending === true;
}

export async function lockCandidateOutreach(
  tx: any,
  sourcedCandidateId: number,
): Promise<void> {
  await tx.execute(sql`
    SELECT pg_advisory_xact_lock(
      ${OUTREACH_CANDIDATE_LOCK_NAMESPACE}::integer,
      ${sourcedCandidateId}::integer
    )
  `);
}

export async function lockOutreachEmailHash(
  tx: any,
  emailHash: string,
): Promise<void> {
  await tx.execute(sql`
    SELECT pg_advisory_xact_lock(
      ${OUTREACH_EMAIL_LOCK_NAMESPACE}::integer,
      hashtext(${emailHash})
    )
  `);
}

export async function withOutreachDispatchFence<T>(
  jobId: number,
  sourcedCandidateId: number,
  emailHash: string,
  // The PLATFORM-WIDE person identity. A complaint is person-terminal across
  // every org, and the same person is a different sourced-candidate row in each
  // one, so the Flow-local id cannot scope this block correctly.
  signalCandidateId: string | null,
  run: () => Promise<T>,
): Promise<OutreachDispatchFenceResult<T>> {
  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await client.query('BEGIN');
    transactionOpen = true;
    const jobLock = await client.query(
      'SELECT id FROM jobs WHERE id = $1 FOR SHARE',
      [jobId],
    );
    if (jobLock.rowCount !== 1) {
      throw new Error('Outreach job no longer exists');
    }
    await client.query(
      'SELECT pg_advisory_xact_lock($1::integer, $2::integer)',
      [OUTREACH_CANDIDATE_LOCK_NAMESPACE, sourcedCandidateId],
    );
    await client.query(
      'SELECT pg_advisory_xact_lock($1::integer, hashtext($2))',
      [OUTREACH_EMAIL_LOCK_NAMESPACE, emailHash],
    );
    // Scope matters here. Blocking every send whenever ANY complaint is
    // unsynced turns one poison record into a permanent platform-wide outage,
    // and it is unnecessary: each intent records the person it concerns.
    //   * hard bounce   -> this mailbox only, always.
    //   * complaint     -> this PERSON (any address) and this ADDRESS (any
    //                      person), but only until Memory has durably recorded
    //                      it. After that Memory is authoritative and the send
    //                      path's revalidation enforces it, which is what makes
    //                      purging synced rows safe.
    //   * unidentifiable complaint -> fall back to stopping everything, because
    //                      we cannot tell who must not be mailed. Expected to
    //                      be unreachable: the column is NOT NULL.
    const hygieneFence = await client.query(
      `SELECT reason, status
       FROM outreach_hygiene_intents
       WHERE (reason = 'hard_bounce' AND email_hash = $1)
          OR (
               reason = 'complaint'
               AND status <> 'synced'
               AND (
                     email_hash = $1
                     OR ($2::text IS NOT NULL AND signal_candidate_id = $2::text)
                     OR btrim(coalesce(signal_candidate_id, '')) = ''
                   )
             )
       ORDER BY CASE WHEN reason = 'complaint' THEN 0 ELSE 1 END
       LIMIT 1`,
      [emailHash, signalCandidateId],
    );
    const hygieneRow = hygieneFence.rows?.[0] as {
      reason?: unknown;
      status?: unknown;
    } | undefined;
    const hygieneReason = hygieneRow?.reason;
    if (hygieneFence.rowCount && typeof hygieneReason === 'string') {
      await client.query('COMMIT');
      transactionOpen = false;
      return {
        status: 'blocked',
        reason: hygieneReason === 'complaint' || hygieneRow?.status !== 'synced'
          ? 'hygiene_sync_pending'
          : 'hard_bounce',
      };
    }
    const result = await run();
    await client.query('COMMIT');
    transactionOpen = false;
    return { status: 'ran', value: result };
  } catch (error) {
    if (transactionOpen) {
      await client.query('ROLLBACK').catch(() => undefined);
    }
    throw error;
  } finally {
    client.release();
  }
}
