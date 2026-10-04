import { apiRequest } from './queryClient';
import { useQuery } from '@tanstack/react-query';
import type { BriefPayload } from '../../../server/job-brief/contracts';

/** Retain an ambiguous request across retries/reloads without persisting its text. */
export async function jobIntentRequest(actorId:number,jobId:number,action:string,url:string,payload:Record<string,unknown>,method:'PATCH'|'POST'='PATCH') {
  const bytes=new TextEncoder().encode(JSON.stringify(payload));
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  const key=`job-intent:v1:${actorId}:${jobId}:${action}:${digest}`;
  let requestId=sessionStorage.getItem(key);
  if(!requestId) {requestId=crypto.randomUUID();sessionStorage.setItem(key,requestId);}
  const response=await apiRequest(method,url,{...payload,requestId});
  const result=await response.json();
  sessionStorage.removeItem(key);
  return result;
}

export type JobBrief={revision:string;currentJD:string|null;sourceHash:string|null;
  latest:{version_id:string;version_number:number;payload:BriefPayload}|null;approvedVersionId:string|null;
  draft:{state:string;code?:string;result?:BriefPayload}|null;
  source:{initialized:boolean;ambiguous:boolean;choices:Array<{kind:'original_prose'|'description_prose';text:string}>}};
export async function fetchJobBrief(jobId:number,signal?:AbortSignal):Promise<JobBrief> {
  const response=await fetch(`/api/jobs/${jobId}/brief`,{...(signal?{signal}:{}),credentials:'include',cache:'no-store'});
  if(!response.ok) throw new Error('The job brief is unavailable. Check your job assignment and seat.');
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

export type BriefCapability={jobBriefEnabled:boolean};
export async function readBriefCapability():Promise<BriefCapability> {
  const response=await fetch('/api/client-config',{credentials:'include',cache:'no-store'});
  if(!response.ok) return {jobBriefEnabled:false};
  const result=await response.json();
  return {jobBriefEnabled:result.jobBriefEnabled===true};
}
