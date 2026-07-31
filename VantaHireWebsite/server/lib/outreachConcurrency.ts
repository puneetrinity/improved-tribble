import { sql } from 'drizzle-orm';

import { pool } from '../db';

export const OUTREACH_CANDIDATE_LOCK_NAMESPACE = 1748527104;
export const OUTREACH_EMAIL_LOCK_NAMESPACE = 1748527105;

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
  run: () => Promise<T>,
): Promise<T> {
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
    const result = await run();
    await client.query('COMMIT');
    transactionOpen = false;
    return result;
  } catch (error) {
    if (transactionOpen) {
      await client.query('ROLLBACK').catch(() => undefined);
    }
    throw error;
  } finally {
    client.release();
  }
}
