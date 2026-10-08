import {z} from 'zod';
import {jobIntentRequest} from './job-brief';

export const admissionQuoteSchema=z.object({
  payerDisplayName:z.string().min(1).max(160),
  payerUserId:z.number().int().positive(),payerSlotId:z.string().uuid(),remaining:z.number().int().min(1).max(5),
  windowStart:z.string().datetime({offset:true}),windowEnd:z.string().datetime({offset:true}),revision:z.number().int().nonnegative(),
  briefVersionId:z.string().uuid(),materialHash:z.string().regex(/^[a-f0-9]{64}$/),artifactId:z.string().uuid(),
  quotedAt:z.string().datetime({offset:true}),expiresAt:z.string().datetime({offset:true}),quoteToken:z.string().min(1).max(8192),
}).strict();
export type AdmissionQuote=z.infer<typeof admissionQuoteSchema>;
export type SourcingPreview={artifactId:string|null;id:string|null;state:string;count:number|null;
  countRelation:string|null;observedAt:string|null;stale:boolean;preparation:string|null;
  preparationCode?:string|null;criterionIds?:string[]|null;allowanceResetAt?:string|null;
  admissionState?:string|null;canAdmit?:boolean};

export async function readSourcingCapability() {
  const response=await fetch('/api/client-config',{credentials:'include',cache:'no-store'});
  if(!response.ok)throw Error('Sourcing settings are unavailable. Please retry.');
  const value=await response.json();
  return {jobBriefEnabled:value.jobBriefEnabled===true,sourcingEnabled:value.sourcingEnabled===true};
}
export async function readSourcing<T>(jobId:number,part:'admission'|'preview',signal?:AbortSignal):Promise<T> {
  const response=await fetch(`/api/jobs/${jobId}/sourcing/${part}`,{credentials:'include',cache:'no-store',...(signal?{signal}:{})});
  const value=await response.json();
  if(!response.ok)throw Error(sourcingErrorMessage(value.code));
  return (part==='admission'?admissionQuoteSchema.parse(value):value) as T;
}
export function sourcingErrorMessage(code:unknown):string {
  switch(code) {
    case 'BRIEF_UPDATED_APPROVAL_REQUIRED':
    case 'SOURCING_UPDATED_BRIEF_REQUIRED':return 'Review, save and approve the updated brief before sourcing.';
    case 'SOURCING_DIGEST_UNAUTHORIZED':return 'Brief preparation is unavailable because the service credentials need attention. Contact your workspace administrator.';
    case 'SOURCING_DIGEST_RATE_LIMITED':return 'Brief preparation was rate-limited. Retry preparation once when the service is available.';
    case 'SOURCING_ALLOWANCE_EXHAUSTED':return 'Neither the job poster nor you has a sourcing run available this month.';
    case 'SOURCING_ALREADY_ADMITTED':return 'This job already has its one sourcing run. Refresh to see its progress.';
    case 'SOURCING_PAYER_CHANGED':
    case 'SOURCING_WINDOW_CHANGED':
    case 'SOURCING_QUERY_STALE':
    case 'SOURCING_REVISION_CONFLICT':
    case 'SOURCING_QUOTE_EXPIRED':return 'The allowance or brief changed. Review a fresh confirmation before starting.';
    case 'SOURCING_DIGEST_REQUIRED':
    case 'SOURCING_PREPARING':
    case 'SOURCING_ARTIFACT_REQUIRED':return 'The approved brief is still being prepared. Please check again shortly.';
    case 'SOURCING_ENTITLEMENT_REQUIRED':return 'Sourcing allowance is not configured. Contact your workspace administrator.';
    default:return 'Sourcing is unavailable. Check the approved brief, published job and seat allowance; no automatic retry will spend a run.';
  }
}
export function admissionCommand(quote:AdmissionQuote) {
  const q=admissionQuoteSchema.parse(quote);
  return {expectedRevision:q.revision,briefVersionId:q.briefVersionId,materialHash:q.materialHash,
    artifactId:q.artifactId,expectedPayerSlotId:q.payerSlotId,expectedWindowStart:q.windowStart,quoteToken:q.quoteToken};
}
export function startGovernedSourcing(actorId:number,jobId:number,quote:AdmissionQuote) {
  return jobIntentRequest(actorId,jobId,'sourcing-admission',`/api/jobs/${jobId}/find-candidates`,admissionCommand(quote),'POST');
}
export function changePreparation(actorId:number,jobId:number,payload:
  {action:'refresh';artifactId:string}|{action:'retry_preparation';briefVersionId:string}) {
  return jobIntentRequest(actorId,jobId,'sourcing-preparation',`/api/jobs/${jobId}/sourcing/preview`,payload,'POST');
}
export function recordSourcingDecision(actorId:number,jobId:number,candidateId:number,expectedRevision:number,
  action:'shortlist'|'pass'|'clear',reasonCode?:string,criterionId?:string) {
  return jobIntentRequest(actorId,jobId,`sourcing-decision:${candidateId}`,`/api/jobs/${jobId}/sourced-candidates/${candidateId}`,
    {expectedRevision,action,...(reasonCode?{reasonCode}:{}),...(criterionId?{criterionId}:{})});
}
