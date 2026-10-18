import type { Pool, PoolClient } from 'pg';
import { candidateEligibilityBody, candidateEligibilityHash, candidateEligibilityResponse } from './candidate-eligibility-contract';
import type { verifySignalCandidateEligibilityJwt } from '../lib/services/jwt-signer';

type Claims = Awaited<ReturnType<typeof verifySignalCandidateEligibilityJwt>>;
const unavailable = () => Error('SOURCING_CANDIDATE_UNAVAILABLE');

/** Read only. Deadline includes pool acquisition; late connections are destroyed. */
export async function readCandidateEligibility(raw: unknown, claims: Claims, pool: Pick<Pool, 'connect'>,
  deadlineAt = Date.now() + 5000): Promise<ReturnType<typeof candidateEligibilityResponse.parse>> {
  const body = candidateEligibilityBody.parse(raw), bodyHash = candidateEligibilityHash(body);
  if (claims.bodyHash !== bodyHash || claims.flowRunId !== body.flowRunId || claims.requestId !== body.requestId)
    throw Error('SOURCING_CANDIDATE_AUTH_INVALID');
  const remaining = Math.min(5000, deadlineAt - Date.now());
  if (remaining <= 0) throw unavailable();
  let client: PoolClient | undefined, closed = false;
  const release = (destroy: boolean) => {
    if (client) { const acquired = client; client = undefined; acquired.release(destroy); }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { closed = true; release(true); reject(unavailable()); }, remaining);
  });
  const work = async () => {
    const acquired = await pool.connect();
    if (closed) { acquired.release(true); throw unavailable(); }
    client = acquired;
    try {
      await acquired.query('BEGIN READ ONLY');
      await acquired.query("SET LOCAL statement_timeout='3s'; SET LOCAL lock_timeout='1s'; SET LOCAL idle_in_transaction_session_timeout='3s'");
      const result = await acquired.query('SELECT public.flow_sourcing_candidate_eligibility($1,$2,$3,$4::jsonb,$5) AS result',
        [claims.tenantId, body.flowRunId, claims.executionAttemptId, JSON.stringify(body), bodyHash]);
      if (closed) throw unavailable();
      const response = candidateEligibilityResponse.parse(result.rows[0]?.result);
      if (result.rows.length !== 1 || response.bodyHash !== bodyHash || response.results.length !== body.items.length
        || response.results.some((item, index) => item.key !== body.items[index]!.key)) throw unavailable();
      await acquired.query('COMMIT');
      if (closed) throw unavailable();
      release(false);
      return response;
    } catch {
      // Destroying the connection rolls back, and cannot exceed the outer deadline waiting on cleanup.
      release(true);
      throw unavailable();
    }
  };
  try { return await Promise.race([work(), timeout]); }
  finally { if (timer) clearTimeout(timer); }
}
