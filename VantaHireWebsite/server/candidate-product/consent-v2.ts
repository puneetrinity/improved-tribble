// Candidate S2 backend; runtime registration remains gated until migration and grants are integrated.
import {parseConsentProjection,parseConsentCapture} from './spark-contracts';
import {z} from 'zod';
import {sql} from 'drizzle-orm';
import {consentV2CaptureEnabled} from './config';
import {signupConsentIntentSchema,signupConsentActivationReceipt} from '../../shared/candidate-spark-v3';
import {profileUuid,profileRevision} from '../../shared/candidate-profile';
import {ConsentTransportError, type ConsentReceipt} from './spark-client';
// Capture and wire helpers stay owner-only; the worker has only these four entrypoints.
export const CONSENT_V2_TABLES=['candidate_consent_v2_copies','candidate_consent_signup_intents'] as const;
export const CONSENT_V2_OWNER_FUNCTIONS=[
 'flow_consent_v2_canonical(jsonb)',
 'flow_consent_v2_capture(integer,integer,uuid,uuid,uuid,bigint,text,integer,text)',
 'flow_consent_v2_wire(uuid)',
 'flow_claim_consent_version(integer,text,integer,integer,uuid)',
 ] as const;
export const CONSENT_V2_RUNTIME_FUNCTIONS=[
 'flow_consent_v2_ack(uuid,integer,text,jsonb)',
 'flow_claim_candidate_consent_v2_outbox(text,integer,integer,uuid)',
 'flow_fail_candidate_consent_v2_outbox(uuid,integer,text,boolean,timestamp with time zone)',
 'flow_consent_v2_prepare(uuid,integer)',
 'flow_consent_v2_capture_owned(integer,integer,uuid,bigint,text,integer,text)',
 'flow_consent_v2_owner_read(integer,integer)',
 'flow_consent_v2_signup_intent(integer,uuid,integer,text)',
 'flow_consent_v2_signup_origin(integer)',
 'flow_consent_v2_signup_activate(integer,integer)'] as const;
/** Optional registration intent: same account transaction, isolated savepoint.
 * Failure must be reported as not_recorded, never as an effective consent grant.
 * No account, password or session policy is changed by this adapter. */
export async function captureSignupConsentIntent(executor:any,userId:number,input:unknown):Promise<'recorded'|'not_recorded'|undefined>{
 if(input===undefined||input===false)return undefined;
 if(!consentV2CaptureEnabled())return 'not_recorded';
 const parsed=signupConsentIntentSchema.safeParse(input);
 if(!parsed.success)return 'not_recorded';
 const p=parsed.data;
 try{
  await executor.transaction(async(tx:any)=>{
   await tx.execute(sql`SELECT public.flow_consent_v2_signup_intent(${userId}::integer,${p.idempotencyKey}::uuid,${p.copyVersion}::integer,${p.copyHash}::text)`);
  });
  return 'recorded';
 }catch{return 'not_recorded';}
}
type Row={outbox_id:string;event_id:string;generation:number;command_sha256:string;attempts:number};
type Db={query:(sql:string,args:unknown[])=>Promise<{rows:any[]}>};
const captureActor=z.object({userId:z.number().int().positive(),authVersion:z.number().int().min(0).max(2147483647)}).strict();
import {captureReceipt,ownerConsent} from '../../shared/candidate-spark-v3';
export class ConsentCaptureError extends Error{
 constructor(public readonly code:string,public readonly status:number){super(code);}
}
export function consentV2Repository(db:Db,privacy:(userId:number)=>Promise<void>){
 const errors:Record<string,[string,number]>={invalid_request:['22023',422],not_found:['P0002',404],
  authentication_changed:['42501',403],consent_copy_unapproved:['42501',409],
  consent_version_conflict:['40001',409],idempotency_conflict:['23505',409]};
 async function call<T>(sql:string,args:unknown[],schema:z.ZodType<T>):Promise<T>{
  try{const {rows}=await db.query(sql,args);if(rows.length!==1)throw Error('invalid_result');return schema.parse(rows[0].result);}
  catch(error){const e=error as {code?:unknown;message?:unknown};const match=typeof e.message==='string'?errors[e.message]:undefined;
   if(match&&match[0]===e.code)throw new ConsentCaptureError(e.message as string,match[1]);
   throw new ConsentCaptureError('consent_temporarily_unavailable',503);}
 }
 return {
  async activateSignup(actor:z.infer<typeof captureActor>){
   const a=captureActor.parse(actor);await privacy(a.userId);
   return call('SELECT public.flow_consent_v2_signup_activate($1,$2) AS result',
    [a.userId,a.authVersion],signupConsentActivationReceipt);
  },
  async capture(actor:z.infer<typeof captureActor>,raw:string){
   const a=captureActor.parse(actor),c=parseConsentCapture(raw).value;
   // Withdrawal must work even when privacy is restricted or its service is
   // unavailable. SQL rechecks current actor, binding and version atomically.
   if(c.action==='grant')await privacy(a.userId);
   return call('SELECT public.flow_consent_v2_capture_owned($1,$2,$3,$4,$5,$6,$7) AS result',
    [a.userId,a.authVersion,c.idempotencyKey,c.expectedConsentRevision,c.action,
     c.action==='grant'?c.copyVersion:null,c.action==='grant'?c.copyHash:null],captureReceipt);
  },
  async read(actor:z.infer<typeof captureActor>){const a=captureActor.parse(actor);
   return call('SELECT public.flow_consent_v2_owner_read($1,$2) AS result',[a.userId,a.authVersion],ownerConsent);
  },
 };
}
type Dependencies={db:Db;workerId:string;privacy:(userId:number)=>Promise<'allowed'|'restricted'|'unavailable'>;
 deliver:(raw:string,hash:string)=>Promise<ConsentReceipt>};
class WorkerError extends Error {constructor(public code:string,public retry:boolean){super(code);}}
async function privacyBounded(check:()=>ReturnType<Dependencies['privacy']>){
 let timer:ReturnType<typeof setTimeout>;
 try{return await Promise.race([Promise.resolve().then(check),new Promise<'unavailable'>(resolve=>{timer=setTimeout(()=>resolve('unavailable'),5000);})]);}
 catch{return 'unavailable' as const;}finally{clearTimeout(timer!);}
}
export async function runConsentV2Once(d:Dependencies,eventId:string|null=null){
 const {rows}=await d.db.query('SELECT * FROM public.flow_claim_candidate_consent_v2_outbox($1,$2,$3,$4)',[d.workerId,1,30000,eventId]);
 for(const row of rows as Row[]){
  try{
   const prepare=async()=>{
    const r=await d.db.query('SELECT public.flow_consent_v2_prepare($1,$2) AS prepared',[row.outbox_id,row.generation]);
    const p=r.rows[0]?.prepared;if(!p)return null;
    const command=parseConsentProjection(JSON.stringify(p.command));
    if(command.hash!==row.command_sha256||p.commandHash!==row.command_sha256||command.value.eventId!==row.event_id)
     throw new WorkerError('identity_mismatch',false);
    if(!Number.isSafeInteger(p.userId)||p.userId<1)throw new WorkerError('account_changed',false);
    return {command,userId:p.userId};
   };
   const initial=await prepare();if(!initial)continue;
   if(initial.command.value.action==='grant'){
    const privacy=await privacyBounded(()=>d.privacy(initial.userId));
    if(privacy!=='allowed')throw new WorkerError(privacy==='restricted'?'privacy_restricted':'privacy_review',privacy!=='restricted');
   }
   // Recheck the lease and account after potentially slow privacy I/O. No SQL
   // lock is held over HTTP, and no dispatch follows a late privacy reply.
   const ready=await prepare();if(!ready)continue;
   if(ready.userId!==initial.userId||ready.command.hash!==initial.command.hash)throw new WorkerError('identity_mismatch',false);
   const receipt=await d.deliver(ready.command.canonical,ready.command.hash);
   await d.db.query('SELECT public.flow_consent_v2_ack($1,$2,$3,$4)',[row.outbox_id,row.generation,row.command_sha256,JSON.stringify(receipt)]);
  }catch(error){
   let code='internal_error',retry=true;
   if(error instanceof WorkerError){code=error.code;retry=error.retry;}
   else if(error instanceof ConsentTransportError){
    const mapped:Record<string,[string,boolean]>={privacy_restricted:['privacy_restricted',false],remote_rejected:['remote_denied',false],
     invalid_receipt:['invalid_response',false],command_mismatch:['identity_mismatch',false],outcome_unknown:['network',true],unavailable:['network',true]};
    [code,retry]=mapped[error.code]??['internal_error',true];
   }else if((error as {code?:string})?.code==='42501'){code='account_changed';retry=false;}
   // A lost ACK is harmless: failure cannot overwrite an acknowledged row;
   // otherwise queue replay uses the same immutable event, never a new grant.
   await d.db.query('SELECT public.flow_fail_candidate_consent_v2_outbox($1,$2,$3,$4,$5)',
    [row.outbox_id,row.generation,code,retry,new Date(Date.now()+Math.min(60,2**Math.min(8,row.attempts))*1000)]);
  }
 }
 return rows.length;
}
export function startConsentV2Worker(d:Dependencies,{enabled=false,tickMs=2000,onError=()=>{}}:{enabled?:boolean;tickMs?:number;onError?:()=>void}={}){
 if(!Number.isInteger(tickMs)||tickMs<1000||tickMs>60000)throw Error('invalid_tick');
 let stopped=false,running:Promise<void>|null=null;
 const tick=()=>{if(stopped||running)return;running=runConsentV2Once(d).then(()=>{},()=>{try{onError();}catch{/* logging cannot crash the loop */}}).finally(()=>{running=null;});};
 const timer=enabled?setInterval(tick,tickMs):null;timer?.unref();if(enabled)tick();
 return async()=>{stopped=true;if(timer)clearInterval(timer);await running;};
}
