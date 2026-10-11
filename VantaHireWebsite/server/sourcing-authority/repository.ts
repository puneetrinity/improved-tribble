import type { Pool, PoolClient } from 'pg';
import {closedDatabaseError} from '../job-brief/repository';
import {rankingContractSchema} from './ranking-contract';

export class SourcingError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}
const failures: Record<string, number> = {
  SOURCING_NOT_FOUND:404, SOURCING_DISABLED:503, SOURCING_ENTITLEMENT_REQUIRED:409,
  SOURCING_PREPARING:409, SOURCING_QUERY_STALE:409, SOURCING_REQUEST_CONFLICT:409,
  SOURCING_ALREADY_ADMITTED:409, SOURCING_PAYER_CHANGED:409, SOURCING_WINDOW_CHANGED:409,
  SOURCING_ALLOWANCE_EXHAUSTED:409, SOURCING_REVISION_CONFLICT:409,
  SOURCING_INVALID_COMMAND:400, SOURCING_INVALID_RECEIPT:409, SOURCING_LEASE_STALE:409,
  SOURCING_GRANT_EXPIRED:409, SOURCING_NEEDS_ATTENTION:409, SOURCING_CONVERTED:409,
  SOURCING_PREVIEW_LIMIT:429, SOURCING_DIGEST_RETRY_REFUSED:409,
  SOURCING_TENANT_REQUIRED:409,
  SOURCING_UPDATED_BRIEF_REQUIRED:409,
};
export function sourcingDatabaseError(error: unknown): SourcingError {
  const e = error as {code?: string; message?: string};
  if (e.code === 'P0001' && e.message && failures[e.message]) return new SourcingError(e.message, failures[e.message]!);
  if (['40001', '40P01', '55P03', '57014'].includes(e.code ?? '')) return new SourcingError('SOURCING_RETRY_SAME_REQUEST', 409);
  if (e.code?.startsWith('22') || e.code?.startsWith('23')) return new SourcingError('SOURCING_INVALID_COMMAND', 400);
  return new SourcingError('SOURCING_UNAVAILABLE', 503);
}
const statements = {
  orgState: 'SELECT public.flow_sourcing_org_state($1,$2) AS result',
  runBinding: 'SELECT public.flow_sourcing_run_binding($1,$2,$3) AS result',
  quote: 'SELECT public.flow_sourcing_quote($1,$2,$3) AS result',
  admit: 'SELECT public.flow_sourcing_admit($1,$2,$3,$4,$5::jsonb) AS result',
  dispatchClaim: 'SELECT public.flow_sourcing_dispatch_claim($1) AS result',
  dispatchFinish: 'SELECT public.flow_sourcing_dispatch_finish($1,$2,$3::jsonb) AS result',
  grant: 'SELECT public.flow_sourcing_grant($1,$2,$3::jsonb) AS result',
  grantContext: 'SELECT public.flow_sourcing_grant_context($1,$2) AS result',
  receipt: 'SELECT public.flow_sourcing_receipt($1,$2,$3::jsonb) AS result',
  cancel: 'SELECT public.flow_sourcing_cancel($1,$2,$3::jsonb) AS result',
  deliver: 'SELECT public.flow_sourcing_deliver($1,$2,$3::jsonb) AS result',
  decide: 'SELECT public.flow_sourcing_decide($1,$2,$3,$4,$5,$6::jsonb) AS result',
  previewRequest: 'SELECT public.flow_sourcing_preview_request($1,$2,$3,$4,$5::jsonb) AS result',
  previewClaim: 'SELECT public.flow_sourcing_preview_claim($1) AS result',
  previewFinish: 'SELECT public.flow_sourcing_preview_finish($1,$2,$3::jsonb) AS result',
  artifactPut: 'SELECT public.flow_sourcing_artifact_put($1,$2,$3,$4,$5::jsonb) AS result',
  digestClaim: 'SELECT public.flow_sourcing_digest_claim($1,$2,$3,$4,$5::jsonb) AS result',
  digestFinish: 'SELECT public.flow_sourcing_digest_finish($1,$2,$3::jsonb) AS result',
  digestNext: 'SELECT public.flow_sourcing_digest_next($1) AS result',
} as const;

/** Fixed statements only. No external I/O is permitted inside this transaction. */
export class SourcingRepository {
  constructor(private readonly suppliedPool?: Pool) {}
  /** Approval and its durable preparation intent commit together. A crash
   * after the response cannot leave an approved brief without its queued work. */
  async approveAndPrepare(scope: {organizationId: number; jobId: number; actorId: number},
    command: {requestId: string; expectedRevision: number; versionId: string}, requestHash: string, model: string): Promise<unknown> {
    const pool: Pool = this.suppliedPool ?? (await import('../db')).pool;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='5s'; SET LOCAL idle_in_transaction_session_timeout='5s'");
      const scoped = [scope.organizationId, scope.jobId, scope.actorId];
      const locked = await client.query(statements.orgState, [scope.organizationId,true]);
      const authority=locked.rows[0]?.result;
      if (!authority || typeof authority.enabled!=='boolean') throw new SourcingError('SOURCING_UNAVAILABLE',503);
      const result = (await client.query('SELECT public.flow_job_brief_approve($1,$2,$3,$4,$5,$6,$7) AS result',
        [...scoped, command.requestId, command.expectedRevision, command.versionId, requestHash])).rows[0]?.result;
      if (!result) throw new SourcingError('SOURCING_NOT_FOUND', 404);
      // Sourcing allowance never gates job publication. Only enabled orgs
      // schedule paid digest/preview work; plain brief approval still commits.
      if (authority.enabled) await client.query(statements.digestClaim, [...scoped, command.requestId, { action: 'schedule', model }]);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (error instanceof SourcingError) throw error;
      if ((error as {code?:string;message?:string}).code==='P0001' && (error as {message?:string}).message?.startsWith('BRIEF_')) throw closedDatabaseError(error);
      throw sourcingDatabaseError(error);
    } finally { client.release(); }
  }
  async call<T>(operation: keyof typeof statements, parameters: unknown[]): Promise<T | null> {
    const pool: Pool = this.suppliedPool ?? (await import('../db')).pool;
    let client: PoolClient | undefined;
    try {
      client = await pool.connect();
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      await client.query("SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='5s'; SET LOCAL idle_in_transaction_session_timeout='5s'");
      const result = (await client.query<{result: T | null}>(statements[operation], parameters)).rows[0]?.result ?? null;
      // Validate SQL's exact contract before committing the allowance reservation.
      // This internal field never becomes part of the public admission response.
      if (operation === 'admit' && result) {
        const admission = result as Record<string, unknown>;
        if (admission.rankingContract != null && !rankingContractSchema.safeParse(admission.rankingContract).success)
          throw new SourcingError('SOURCING_INVALID_COMMAND', 409);
        if (admission.rankingContract == null && admission.replayed !== true)
          throw new SourcingError('SOURCING_INVALID_COMMAND', 409);
        delete admission.rankingContract;
      }
      await client.query('COMMIT');
      return result;
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => undefined);
      if (error instanceof SourcingError) throw error;
      throw sourcingDatabaseError(error);
    } finally { client?.release(); }
  }
}
