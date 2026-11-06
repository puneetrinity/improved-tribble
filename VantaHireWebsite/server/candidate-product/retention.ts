import {z} from 'zod';
import type {FoundationDb} from './repository';

/** Payload compaction only. Never deletes canonical Memory data or stored files. */
export async function redactSourceCopies(db:FoundationDb):Promise<number>{
 const result=await db.query('SELECT public.flow_candidate_source_redact_due() AS result',[]);
 if(result.rows.length!==1)throw Error('retention_result_invalid');
 return z.object({redacted:z.number().int().min(0).max(100)}).strict().parse(result.rows[0]!.result).redacted;
}
