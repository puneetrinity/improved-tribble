import {lookupOperationSchema,LookupError,type LookupOperation,type LookupResult} from './source-contracts';
import {profileUuid} from '../../shared/candidate-profile';
import {buildLookupTransfer,type LookupProposalContext} from './source-contracts';
import type {lookupRepository} from './source-repository';
import type {deliverLookupTransfer} from './source-adapters';
import {LookupDeliveryError} from './source-adapters';
import {lookupWorkSchema,type LookupWork,type LookupWorkFailure} from './source-repository';

/** Durable source-only delivery. A crash/lost reply repeats stored bytes, never
 * a paid lookup. Both version reads and provider acquisition are outside replay. */
export async function runLookupDelivery(attemptId:string,deps:{repository:ReturnType<typeof lookupRepository>;
 readVersions:(subjectId:string,bindingId:string)=>Promise<Pick<LookupProposalContext,'originalDraftVersion'|'originalProfileVersion'|'originalPreferenceVersion'|'originalPreferenceDraftRevision'>>;
 deliver:typeof deliverLookupTransfer}){
 const prepared=await deps.repository.prepareDelivery(attemptId);if(!prepared)return 'no_delivery' as const;
 let stored=prepared.transfer;
 if(!stored){
  const versions=await deps.readVersions(prepared.subjectId,prepared.bindingId);
  const transfer=buildLookupTransfer(prepared.result,{...versions,commandId:attemptId,sourceId:attemptId,sourceVersion:1,
   subjectId:prepared.subjectId,bindingId:prepared.bindingId,consentRevision:prepared.consentRevision,expiresAt:prepared.expiresAt});
  stored=await deps.repository.storeDelivery(attemptId,{canonical:transfer.canonical,sha256:transfer.hash});
 }
 const receipt=await deps.deliver(stored);
 return deps.repository.finishDelivery(attemptId,stored,receipt);
}

export interface LookupDispatch {
 attemptId:string;dispatchId:string;subjectId:string;bindingId:string;consentRevision:number;operation:LookupOperation;
}
export interface LookupWorkerDependencies {
 enabled:()=>boolean;
 // Production implementation MUST atomically recheck consent/account/privacy,
 // reserve the one slot, mark dispatched and COMMIT before returning. It returns
 // null for every replay/unknown commit, never a second dispatch permission.
 beginDispatch:(attemptId:string)=>Promise<LookupDispatch|null>;
 // Original requested attempt, not identifiers from a malformed grant. Repository
 // must fence its own claim; record unsent/review evidence, never reset a sent slot.
 refuseUnsent:(attemptId:string)=>Promise<void>;
 // Only called by this worker before invoking lookup; never for timeout/recovery.
 cancelUnsent:(dispatch:LookupDispatch)=>Promise<void>;
 lookup:(operation:LookupOperation)=>Promise<LookupResult>;
 // Transactionally fences withdrawal/erasure and persists the allowlisted source
 // plus idempotent Memory delivery work. Not a direct canonical-profile write.
 settle:(dispatch:LookupDispatch,result:LookupResult)=>Promise<void>;
 // Metadata-only terminal hold. Never resets the slot or authorizes fallback.
 hold:(dispatch:LookupDispatch,reason:'dispatch_uncertain'|'settlement_uncertain'|'disabled_after_reservation',observedCredits:number|null)=>Promise<void>;
}
/** One paid dispatch only; queue retries cannot recreate that permission. */
export async function runLookupAttempt(attemptId:string,deps:LookupWorkerDependencies):Promise<'disabled'|'no_dispatch'|'settled'|'held'>{
 profileUuid.parse(attemptId);
 if(!deps.enabled())return 'disabled';
 // A failed/unknown COMMIT escapes without any network call.
 const grant=await deps.beginDispatch(attemptId);
 if(grant===null)return 'no_dispatch';
 try{
  if(grant.attemptId!==attemptId)throw Error();
  for(const id of [grant.dispatchId,grant.subjectId,grant.bindingId])profileUuid.parse(id);
  if(!Number.isSafeInteger(grant.consentRevision)||grant.consentRevision<1)throw Error();
  lookupOperationSchema.parse(grant.operation);
 }catch{await deps.refuseUnsent(attemptId);throw Error('invalid_dispatch_grant');}
 if(!deps.enabled()){
  try{await deps.cancelUnsent(grant);return 'disabled';}
  catch{
   // Cancellation may have failed before or after COMMIT. Never call the
   // provider; preserve a hold if still running, otherwise surface the conflict.
   await deps.hold(grant,'disabled_after_reservation',null);return 'held';
  }
 }
 let result:LookupResult;
 try{result=await deps.lookup(grant.operation);}
 catch(error){await deps.hold(grant,'dispatch_uncertain',error instanceof LookupError?error.observedCredits:null);return 'held';}
 try{await deps.settle(grant,result);return 'settled';}
 catch{await deps.hold(grant,'settlement_uncertain',result.creditsConsumed);return 'held';}
}

export interface LookupQueueDependencies {
 enabled:()=>boolean;
 claim:()=>Promise<LookupWork|null>;
 prepare:(work:LookupWork)=>Promise<boolean>;
 finish:(work:LookupWork,failure:LookupWorkFailure)=>Promise<boolean>;
 purchase:(work:LookupWork)=>Promise<unknown>;
 deliver:(work:LookupWork)=>Promise<unknown>;
}
/** One item per tick, bounded by the adapter deadlines and SQL statement bounds.
 * Queue errors never invoke a paid adapter directly or reset a dispatched row. */
export async function runLookupQueueOnce(deps:LookupQueueDependencies):Promise<number>{
 if(!deps.enabled())return 0;
 const raw=await deps.claim();if(!raw)return 0;
 const work=lookupWorkSchema.parse(raw);let failure:LookupWorkFailure=null;
 try{
  if(!deps.enabled()||!await deps.prepare(work))return 0;
  if(!deps.enabled())return 0;
  if(work.stage==='queued')await deps.purchase(work);else await deps.deliver(work);
 }catch(error){
  const e=error as {code?:string;message?:string};
  if(error instanceof LookupDeliveryError){
   failure=error.retryable?'temporary':'delivery_refused';
   // Fixed metadata only: never log the JWT, request, response, or candidate.
   // A delivery-auth failure is held for operator repair, never repurchased.
   if(error.status===401||error.status===403)
    console.error('[candidate-lookup] operator_attention delivery_auth_refused', {status:error.status});
  }
  else if(['candidate_privacy_restricted','privacy_restricted'].includes(e.code??''))failure='privacy_restricted';
  else if(e.message==='consent_changed')failure='consent_changed';
  else failure='temporary';
 }
 // A failed/unknown finish leaves its lease to recovery, never a second purchase.
 await deps.finish(work,failure);return 1;
}
export function startLookupQueue(deps:LookupQueueDependencies):()=>Promise<void>{
 let stopped=false,timer:ReturnType<typeof setTimeout>|undefined,active:Promise<unknown>|undefined;
 const gated={...deps,enabled:()=>!stopped&&deps.enabled()};
 const tick=()=>{if(stopped)return;
  active=runLookupQueueOnce(gated).catch(()=>console.warn('[candidate-lookup] queue cycle unavailable'))
   .finally(()=>{active=undefined;if(!stopped)timer=setTimeout(tick,1000);});
 };
 if(deps.enabled())tick();
 return async()=>{stopped=true;if(timer)clearTimeout(timer);await active;};
}
