import type { Pool, PoolClient } from 'pg';

export class BriefError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}
const failures: Record<string, number> = {
  BRIEF_REQUEST_CONFLICT:409, BRIEF_REVISION_CONFLICT:409, BRIEF_SOURCE_CONFLICT:409,
  BRIEF_APPROVAL_REQUIRED:409, BRIEF_SOURCE_REQUIRED:409, BRIEF_DRAFT_INFLIGHT:409,
  BRIEF_DRAFT_SETTLED:409, BRIEF_DRAFT_LIMIT:429,
  BRIEF_UPDATED_APPROVAL_REQUIRED:409,
};
export function closedDatabaseError(error: unknown): BriefError {
  const e=error as {code?:string;message?:string};
  if (e.code==='P0001' && e.message && failures[e.message]) return new BriefError(e.message,failures[e.message]!);
  if (['40001','40P01','55P03','57014'].includes(e.code??'')) return new BriefError('BRIEF_RETRY_SAME_REQUEST',409);
  if (e.code?.startsWith('22') || e.code?.startsWith('23')) return new BriefError('BRIEF_INVALID_COMMAND',400);
  return new BriefError('BRIEF_UNAVAILABLE',503);
}
const statements = {
  read:'SELECT public.flow_job_brief_read($1,$2,$3) AS result',
  history:'SELECT public.flow_job_brief_history($1,$2,$3,$4,$5,$6) AS result',
  save:'SELECT public.flow_job_brief_save($1,$2,$3,$4,$5,$6::jsonb) AS result',
  approve:'SELECT public.flow_job_brief_approve($1,$2,$3,$4,$5,$6,$7) AS result',
  claim:'SELECT public.flow_job_brief_draft_claim($1,$2,$3,$4,$5,$6,$7,$8) AS result',
  finish:'SELECT public.flow_job_brief_draft_finish($1,$2,$3::jsonb) AS result',
} as const;

/** No network/model callback can run inside this bounded database transaction. */
export class BriefRepository {
  constructor(private readonly suppliedPool?: Pool) {}
  async call<T>(operation: keyof typeof statements, parameters: unknown[]): Promise<T> {
    const pool: Pool=this.suppliedPool??(await import('../db')).pool;
    let client: PoolClient | undefined;
    try {
      client=await pool.connect();
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      await client.query("SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='5s'; SET LOCAL idle_in_transaction_session_timeout='5s'");
      const rows=await client.query<{result:T|null}>(statements[operation],parameters);
      const result=rows.rows[0]?.result;
      if (result===null || result===undefined) throw new BriefError('BRIEF_NOT_FOUND',404);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(()=>undefined);
      if (error instanceof BriefError) throw error;
      throw closedDatabaseError(error);
    } finally { client?.release(); }
  }
}

export type BriefScope = {organizationId:number;jobId:number;actorId:number};
export const scopeParameters=(scope:BriefScope)=>[scope.organizationId,scope.jobId,scope.actorId];
