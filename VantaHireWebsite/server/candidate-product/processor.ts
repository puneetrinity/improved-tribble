import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { foundationDeliveryEnabled } from './config';
import { parseWire, uuid } from './contracts';
import { deliverFoundation, FoundationDeliveryError } from './memory-client';
import type { FoundationDb } from './repository';

const leaseSchema = z.object({commandId:uuid,subjectId:uuid,bindingId:uuid,
  userId:z.number().int().positive(),sequence:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  wireBody:z.string(),wireSha256:z.string().regex(/^[0-9a-f]{64}$/),leaseToken:uuid,
  leaseGeneration:z.number().int().positive().max(Number.MAX_SAFE_INTEGER)}).strict();
export interface FoundationProcessorDependencies {
  db:FoundationDb;
  privacy:(userId:number)=>Promise<void>;
  enabled?:()=>boolean;
  deliver?:typeof deliverFoundation;
}
/** One claim per tick, no transaction or DB connection spans the HTTP request. */
export async function runFoundationOnce(deps:FoundationProcessorDependencies):Promise<boolean> {
  const enabled=deps.enabled ?? foundationDeliveryEnabled;
  if (!enabled()) return false;
  const claimed=await deps.db.query('SELECT public.flow_candidate_foundation_claim_delivery($1) AS result',[randomUUID()]);
  if (claimed.rows.length!==1) throw Error('invalid_claim');
  if (claimed.rows[0]!.result===null) return false;
  const lease=leaseSchema.parse(claimed.rows[0]!.result);
  let outcome='invalid_response';
  let response:unknown={};
  let deadline:ReturnType<typeof setTimeout>|undefined;
  let expired=false;
  const started=performance.now();
  try {
    const parsed=parseWire(lease.wireBody);
    if(parsed.hash!==lease.wireSha256 || parsed.value.commandId!==lease.commandId
      || parsed.value.subjectId!==lease.subjectId || parsed.value.bindingId!==lease.bindingId
      || parsed.value.sequence!==lease.sequence) throw new FoundationDeliveryError('invalid_response');
    response=await Promise.race([
      (async()=>{
        try { await deps.privacy(lease.userId); }
        catch(error) {
          if ((error as {code?:string}).code==='candidate_privacy_restricted')
            throw new FoundationDeliveryError('remote_denied');
          throw new FoundationDeliveryError('network');
        }
        // A late privacy reply or disabled switch must never dispatch a send.
        const remaining=Math.floor(15_000-(performance.now()-started));
        if(expired || remaining<=0 || !enabled()) throw new FoundationDeliveryError('timeout');
        return (deps.deliver ?? deliverFoundation)(lease.wireBody,lease.wireSha256,Math.min(10_000,remaining));
      })(),
      new Promise<never>((_resolve,reject)=>{
        deadline=setTimeout(()=>{expired=true;reject(new FoundationDeliveryError('timeout'));},15_000);
      }),
    ]);
    outcome='acknowledged';
  } catch(error) {
    if(error instanceof FoundationDeliveryError) {
      outcome=error.code;
      response=error.retryAfterSeconds===undefined?{}:{retryAfterSeconds:error.retryAfterSeconds};
    }
  } finally { if(deadline) clearTimeout(deadline); }
  // Unknown commit failures are never retried here. Lease recovery replays the immutable command.
  const finished=await deps.db.query('SELECT public.flow_candidate_foundation_finish_delivery($1,$2,$3,$4,$5) AS result',
    [lease.commandId,lease.leaseToken,lease.leaseGeneration,outcome,JSON.stringify(response)]);
  if(finished.rows.length!==1 || !z.object({applied:z.boolean()}).strict().safeParse(finished.rows[0]?.result).success)
    throw Error('invalid_finish');
  return true;
}

export function startFoundationProcessor(deps:FoundationProcessorDependencies):()=>Promise<void> {
  let stopped=false;
  let active:Promise<void>|undefined;
  const tick=()=>{
    if(stopped || active) return;
    active=runFoundationOnce(deps).then(()=>undefined).catch(()=>{
      // No wire, subject, email, credential or raw database error in logs.
      console.warn('[candidate-foundation] delivery tick unavailable');
    }).finally(()=>{active=undefined;});
  };
  const timer=setInterval(tick,1000);
  timer.unref();
  tick();
  return async()=>{stopped=true;clearInterval(timer);await active;};
}
