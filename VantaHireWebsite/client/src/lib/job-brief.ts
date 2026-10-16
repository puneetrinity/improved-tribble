import { apiRequest } from './queryClient';
import { useQuery } from '@tanstack/react-query';
import type { BriefPayload } from '../../../server/job-brief/contracts';
import type { ReviewWorkspace } from '../../../shared/brief-review';
export type BriefCriterion=BriefPayload['criteria'][number];
export type BriefReviewWorkspace=ReviewWorkspace<BriefCriterion>;

/** Retain an ambiguous request across retries/reloads without persisting its text. */
const IN_PROGRESS_BY_ACTION: Readonly<Record<string, ReadonlySet<string>>> = {
  draft: new Set(['reserved', 'dispatched']),
  'draft-automatic': new Set(['reserved', 'dispatched']),
  'draft-retry': new Set(['reserved', 'dispatched']),
  // Digest preparation and count-preview preparation have distinct state machines.
  'sourcing-preparation': new Set(['reserved', 'started', 'pending', 'leased']),
  // Keep an unresolved admission, including operator intervention, tied to its original intent.
  'sourcing-admission': new Set(['reserved', 'bound', 'dispatched', 'needs_attention']),
};
async function intentKey(actorId:number,jobId:number,action:string,payload:Record<string,unknown>) {
  const bytes=new TextEncoder().encode(JSON.stringify(payload));
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  return `job-intent:v1:${actorId}:${jobId}:${action}:${digest}`;
}
export async function jobIntentRequest(actorId:number,jobId:number,action:string,url:string,payload:Record<string,unknown>,method:'PATCH'|'POST'='PATCH') {
  const key=await intentKey(actorId,jobId,action,payload);
  let requestId=sessionStorage.getItem(key);
  if(!requestId) {requestId=crypto.randomUUID();sessionStorage.setItem(key,requestId);}
  const response=await apiRequest(method,url,{...payload,requestId});
  const result=await response.json();
  // HTTP success need not mean completion. Interpret states in the action's own contract;
  // save/approve/submit and candidate decisions retain their existing behaviour.
  if(!IN_PROGRESS_BY_ACTION[action]?.has(result?.state)) sessionStorage.removeItem(key);
  return result;
}

export type JobBrief={revision:string;currentJD:string|null;sourceHash:string|null;
  latest:{version_id:string;version_number:number;payload:BriefPayload}|null;approvedVersionId:string|null;
  draft:{state:string;code?:string;result?:BriefPayload|null}|null;
  /** D4: persisted AI requirement inventory for the current JD (null for manual briefs). */
  reviewWorkspace?:BriefReviewWorkspace|null;
  source:{initialized:boolean;ambiguous:boolean;choices:Array<{kind:'original_prose'|'description_prose';text:string}>}};
export async function fetchJobBrief(jobId:number,signal?:AbortSignal):Promise<JobBrief> {
  const response=await fetch(`/api/jobs/${jobId}/brief`,{...(signal?{signal}:{}),credentials:'include',cache:'no-store'});
  if(!response.ok) throw new Error('We couldn’t load the hiring criteria. Check that you’re assigned to this job and have a seat.');
  return response.json();
}
export async function changeJobPublication(actorId:number,role:string,jobId:number,isActive:boolean,enabled:boolean) {
  if(!enabled) return (await apiRequest('PATCH',`/api/jobs/${jobId}/status`,{isActive})).json();
  const expectedRevision=role==='super_admin'?undefined:Number((await fetchJobBrief(jobId)).revision);
  return jobIntentRequest(actorId,jobId,'status',`/api/jobs/${jobId}/status`,{isActive,...(expectedRevision!==undefined?{expectedRevision}:{})});
}
export function useJobBrief(jobId:number|null,actorId:number|undefined,enabled:boolean) {
  return useQuery<JobBrief>({queryKey:['job-brief',actorId,jobId],queryFn:({signal})=>fetchJobBrief(jobId!,signal),
    enabled:enabled && !!jobId && !!actorId,gcTime:0,staleTime:0,retry:false});
}

/** autoDraftEnabled: server switch for the one automatic first draft (field name to be agreed with Codex's backend contract). */
export type BriefCapability={jobBriefEnabled:boolean;autoDraftEnabled:boolean};
export async function readBriefCapability():Promise<BriefCapability> {
  const response=await fetch('/api/client-config',{credentials:'include',cache:'no-store'});
  if(!response.ok) return {jobBriefEnabled:false,autoDraftEnabled:false};
  const result=await response.json();
  return {jobBriefEnabled:result.jobBriefEnabled===true,autoDraftEnabled:result.jobBriefEnabled===true&&result.jobBriefAutoDraftEnabled===true};
}
