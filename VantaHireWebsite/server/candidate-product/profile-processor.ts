import {z} from 'zod';
import {profileUuid,profileHash,profileRevision} from '../../shared/candidate-profile';
import {parseProfileCommand,parseProfileJson,profileReceiptSchema} from './profile-contracts';
import {parseCommand as parseSparkCommand,receiptSchema as sparkReceiptSchema} from './spark-contracts';
import type {ExpiryLease} from './profile-repository';
import type {ExpiryIdentity} from './profile-client';

// Closed protocol dispatch: never reinterpret a rejected v3 command as v2.
// Admission still controls which actions can enter the durable queue.
export function parseQueuedProfileCommand(raw:string){
 const value=parseProfileJson(raw) as {schemaVersion?:unknown}|null;
 if(value?.schemaVersion===2)return parseProfileCommand(raw);
 if(value?.schemaVersion===3)return parseSparkCommand(raw);
 throw Error('invalid_request');
}
export function parseQueuedProfileReceipt(version:2|3,value:unknown){
 return version===3?sparkReceiptSchema.parse(value):profileReceiptSchema.parse(value);
}

const leaseSchema=z.object({commandId:profileUuid,subjectId:profileUuid,bindingId:profileUuid,
 userId:z.number().int().positive(),authVersion:profileRevision,idempotencyKey:profileUuid,
 leaseToken:profileUuid,leaseGeneration:profileRevision,attemptCount:z.number().int().positive(),
 body:z.string(),hash:profileHash}).strict();
export type ProfileLease=z.infer<typeof leaseSchema>;
export type ProfileRetryReason='authority_unavailable'|'memory_unavailable'|'delivery_outcome_unknown';
export type ProfileHeldReason='identity_conflict'|'authentication_changed'|'retry_exhausted'|'invalid_request';
export type ProfileFinish={state:'applied'|'rejected';receipt:unknown}|{state:'retry';reason:ProfileRetryReason;delayMs:number}
 |{state:'held';reason:ProfileHeldReason}|{state:'rejected';reason:'candidate_privacy_restricted'|'consent_changed'};
export interface ProfileProcessorDependencies {
 enabled:()=>boolean;
 // Database must atomically claim distinct subjects with lease/expiry fences.
 claim:(limit:number)=>Promise<unknown[]>;
 // Must recheck binding, verified email, auth version and owner privacy.
 authority:(lease:ProfileLease)=>Promise<void>;
 deliver:(lease:ProfileLease,signal:AbortSignal)=>Promise<unknown>;
 // Atomic finish compares token/generation. Unknown commit is left to lease recovery.
 finish:(lease:ProfileLease,result:ProfileFinish)=>Promise<void>;
}
export const PROFILE_MAX_ATTEMPTS=12;
export function profileRetryDelay(attempt:number):number{return Math.min(60_000,250*2**Math.max(0,attempt-1));}
function errorCode(error:unknown):unknown{return (error as {code?:unknown})?.code;}

async function processLease(lease:ProfileLease,deps:ProfileProcessorDependencies):Promise<void>{
 if(lease.attemptCount>PROFILE_MAX_ATTEMPTS){await deps.finish(lease,{state:'held',reason:'retry_exhausted'});return;}
 let result:ProfileFinish={state:'held',reason:'invalid_request'};
 let stage:'validate'|'authority'|'deliver'='validate';
 const controller=new AbortController();
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  const parsed=parseQueuedProfileCommand(lease.body);
  if(parsed.canonical!==lease.body||parsed.hash!==lease.hash||parsed.value.idempotencyKey!==lease.idempotencyKey)throw Error('invalid_request');
  const response=await Promise.race([
   (async()=>{
    stage='authority';await deps.authority(lease);
    if(controller.signal.aborted||!deps.enabled())throw Object.assign(Error('unavailable'),{code:'authority_unavailable'});
    stage='deliver';return deps.deliver(lease,controller.signal);
   })(),
   new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('deadline'));},15_000);}),
  ]);
  const receipt=parseQueuedProfileReceipt(parsed.value.schemaVersion,response);
  if(receipt.commandId!==lease.commandId||receipt.subjectId!==lease.subjectId||receipt.bindingId!==lease.bindingId||receipt.commandHash!==lease.hash)
   throw Object.assign(Error('identity_conflict'),{code:'identity_conflict'});
  result={state:receipt.status,receipt};
 }catch(error){
  const code=errorCode(error);
  if(code==='candidate_privacy_restricted'||code==='consent_changed')result={state:'rejected',reason:code};
  else if(code==='authentication_changed'||code==='identity_conflict')result={state:'held',reason:code};
  else if(stage==='validate')result={state:'held',reason:'invalid_request'};
  else if(lease.attemptCount>=PROFILE_MAX_ATTEMPTS)result={state:'held',reason:'retry_exhausted'};
  else result={state:'retry',reason:stage==='authority'?'authority_unavailable':code==='memory_unavailable'?'memory_unavailable':'delivery_outcome_unknown',delayMs:profileRetryDelay(lease.attemptCount)};
 }finally{if(timer)clearTimeout(timer);controller.abort();}
 await deps.finish(lease,result);
}

export async function runProfileBatch(deps:ProfileProcessorDependencies):Promise<number>{
 if(!deps.enabled())return 0;
 const raw=await deps.claim(20);
 if(!Array.isArray(raw)||raw.length>20)throw Error('invalid_profile_claim');
 const leases=raw.map(v=>leaseSchema.parse(v));
 if(new Set(leases.map(v=>v.subjectId)).size!==leases.length||new Set(leases.map(v=>v.commandId)).size!==leases.length)
  throw Error('invalid_profile_claim');
 let index=0;const failures:unknown[]=[];
 await Promise.all(Array.from({length:Math.min(4,leases.length)},async()=>{
  while(index<leases.length){const lease=leases[index++]!;
   if(!deps.enabled())break; // Unused leases expire; never send after switch-off.
   try{await processLease(lease,deps);}catch(error){failures.push(error);}
  }
 }));
 if(failures.length)throw Error('profile_finish_unavailable');
 return leases.length;
}

export function startProfileProcessor(deps:ProfileProcessorDependencies):()=>Promise<void>{
 let stopped=false;let timer:ReturnType<typeof setTimeout>|undefined;let active:Promise<void>|undefined;
 const gated={...deps,enabled:()=>!stopped&&deps.enabled()};
 const tick=()=>{if(stopped)return;
  active=runProfileBatch(gated).then(count=>{if(!stopped)timer=setTimeout(tick,count?0:250);})
   .catch(()=>{console.warn('[candidate-profile] delivery unavailable');if(!stopped)timer=setTimeout(tick,1000);})
   .finally(()=>{active=undefined;});
 };
 // No background polling when the feature was disabled at startup.
 if(deps.enabled())tick();
 return async()=>{stopped=true;if(timer)clearTimeout(timer);await active;};
}

export interface ProfileExpiryDependencies {
 enabled:()=>boolean;
 redactDue:()=>Promise<unknown>;
 claimExpiry:()=>Promise<ExpiryLease[]>;
 prepareExpiry:(lease:ExpiryLease)=>Promise<void>;
 settleExpiry:(lease:ExpiryLease,receipt:unknown|null)=>Promise<unknown>;
 recover:(identity:ExpiryIdentity,signal:AbortSignal)=>Promise<unknown>;
 refuseExpiry?:(lease:ExpiryLease)=>Promise<unknown>;
 recoveryReviewCount?:()=>Promise<number>;
}
/** Recovery only calls Memory; never reconstitutes a redacted body or calls a provider. */
export async function runProfileExpiryBatch(deps:ProfileExpiryDependencies):Promise<number>{
 if(!deps.enabled())return 0;
 await deps.redactDue();if(!deps.enabled())return 0;
 const leases=await deps.claimExpiry();
 if(leases.length>5||new Set(leases.map(l=>l.commandId)).size!==leases.length)throw Error('invalid_expiry_claim');
 let index=0;const errors:unknown[]=[];
 await Promise.all(Array.from({length:Math.min(2,leases.length)},async()=>{
  while(index<leases.length&&deps.enabled()){
   const lease=leases[index++]!,controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
   let receipt:unknown|null=null,permanent=false;
   try{
    const result=await Promise.race([(async()=>{
     await deps.prepareExpiry(lease);
     if(controller.signal.aborted||!deps.enabled())throw Error('expiry_unavailable');
     const {userId:_user,leaseToken:_token,leaseGeneration:_generation,...identity}=lease;
     return deps.recover(identity,controller.signal);
    })(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('expiry_deadline'));},15_000);})]);
    const checked=parseQueuedProfileReceipt(lease.schemaVersion,result);
    if(checked.commandId!==lease.commandId||checked.subjectId!==lease.subjectId||checked.bindingId!==lease.bindingId||checked.commandHash!==lease.commandHash)
     throw Object.assign(Error('expiry_identity_conflict'),{code:'identity_conflict'});
    receipt=checked;
   }catch(error){permanent=['candidate_privacy_restricted','identity_conflict','idempotency_conflict','not_found'].includes(String(errorCode(error)));}
   finally{if(timer)clearTimeout(timer);controller.abort();}
   try{if(permanent&&deps.refuseExpiry)await deps.refuseExpiry(lease);else await deps.settleExpiry(lease,receipt);}catch(error){errors.push(error);}
  }
 }));
 if(errors.length)throw Error('expiry_settlement_unavailable');
 if(deps.recoveryReviewCount){const count=await deps.recoveryReviewCount();if(count>0)console.warn('[candidate-profile] recovery review required', {count});}
 return leases.length;
}
export function startProfileExpiryProcessor(deps:ProfileExpiryDependencies):()=>Promise<void>{
 let stopped=false,timer:ReturnType<typeof setTimeout>|undefined,active:Promise<void>|undefined;
 const gated={...deps,enabled:()=>!stopped&&deps.enabled()};
 const tick=()=>{if(stopped)return;
  active=runProfileExpiryBatch(gated).then(()=>{}).catch(()=>{console.warn('[candidate-profile] expiry recovery unavailable');})
   .finally(()=>{active=undefined;if(!stopped)timer=setTimeout(tick,60_000);});
 };
 if(deps.enabled())tick();
 return async()=>{stopped=true;if(timer)clearTimeout(timer);await active;};
}
