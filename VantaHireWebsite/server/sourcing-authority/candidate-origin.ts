import {z} from 'zod';
import {candidateEligibilityIdentity,candidateEligibilityBody,candidateEligibilityHash,candidateEligibilityResponse} from './candidate-eligibility-contract';
import type {SourcingDelivery} from './contracts';
import {sql} from 'drizzle-orm';
import {readSourcingCandidateOrigin} from '@shared/sourcing-candidate-origin';

export const privateCandidateOrigin=candidateEligibilityIdentity.extend({version:z.literal(1),kind:z.literal('organization_candidate')}).strict();
export function parsePrivateOrigin(candidate:{candidateOrigin?:unknown}) {
 if(candidate.candidateOrigin===undefined)return null;
 const origin=privateCandidateOrigin.parse(candidate.candidateOrigin);
 const {version,kind,...identity}=origin;
 return {identity,display:{version,kind,applicationId:identity.applicationId,applicationJobId:identity.applicationJobId}};
}

/** Invoke under the callback's existing organisation/execution transaction lock. */
export async function verifyPrivateDelivery(transaction:{execute:Function},organizationId:number,jobId:number,
  requestId:string,delivery:SourcingDelivery,candidates:readonly {candidate:{id:string;candidateOrigin?:unknown}}[]) {
 const items=candidates.flatMap(candidate=>{
  const origin=parsePrivateOrigin(candidate.candidate);
  return origin?[{key:candidate.candidate.id,identity:origin.identity}]:[];
 });
 if(!items.length)return;
 if(delivery.protocolVersion!==2)throw Error('SOURCING_PRIVATE_BINDING');
 const response=await readPrivateDecisions(transaction,organizationId,jobId,requestId,
  {flowRunId:delivery.flowRunId,executionAttemptId:delivery.executionAttemptId,revisionId:delivery.rankingRevision},items);
 if(response.results.some(item=>item.decision!=='allow'))throw Error('SOURCING_PRIVATE_CHANGED');
}

async function readPrivateDecisions(transaction:{execute:Function},organizationId:number,jobId:number,requestId:string,
 binding:{flowRunId:unknown;executionAttemptId:unknown;revisionId:unknown},items:unknown[]) {
 const body=candidateEligibilityBody.parse({version:1,flowRunId:binding.flowRunId,revisionId:binding.revisionId,
  requestId,externalJobId:jobId,items});
 const hash=candidateEligibilityHash(body);
 // Resolve tenant from the stored organisation, never from a callback field.
 const result=await transaction.execute(sql`SELECT public.flow_sourcing_candidate_eligibility(
   (SELECT signal_tenant_id FROM public.organizations WHERE id=${organizationId}),${body.flowRunId}::uuid,
   ${z.string().uuid().parse(binding.executionAttemptId)}::uuid,${JSON.stringify(body)}::jsonb,${hash}) AS result`);
 const response=candidateEligibilityResponse.parse(result.rows?.[0]?.result);
 if(response.bodyHash!==hash||response.results.length!==items.length
  ||response.results.some((item,index)=>item.key!==body.items[index]!.key))
  throw Error('SOURCING_PRIVATE_CHANGED');
 return response;
}

/** Read-time checks also withhold applicants who applied to this job after sourcing. */
export async function filterStoredPrivateCandidates<T extends {signalCandidateId:string;candidateSummary:unknown}>(
 transaction:{execute:Function},organizationId:number,jobId:number,requestId:string,
 binding:{flowRunId?:unknown;executionAttemptId?:unknown;delivery?:{revisionId:unknown}|null}|null,candidates:T[]):Promise<T[]> {
 const items=candidates.flatMap(candidate=>{
  const summary=candidate.candidateSummary as Record<string,unknown>|null;
  const origin=readSourcingCandidateOrigin(summary?.candidateOrigin);
  if(origin.kind==='public_profile')return [];
  if(origin.kind==='invalid')throw Error('SOURCING_PRIVATE_BINDING');
  const identity=candidateEligibilityIdentity.parse(summary?.privateResumeIdentity);
  if(identity.applicationId!==origin.applicationId||identity.applicationJobId!==origin.applicationJobId)
   throw Error('SOURCING_PRIVATE_BINDING');
  return [{key:candidate.signalCandidateId,identity}];
 });
 if(!items.length)return candidates;
 if(!binding?.delivery)throw Error('SOURCING_PRIVATE_BINDING');
 const response=await readPrivateDecisions(transaction,organizationId,jobId,requestId,
  {...binding,flowRunId:binding.flowRunId,executionAttemptId:binding.executionAttemptId,revisionId:binding.delivery.revisionId},items);
 if(response.results.some(item=>item.decision==='unavailable'))throw Error('SOURCING_CANDIDATE_UNAVAILABLE');
 const decisions=new Map(response.results.map(item=>[item.key,item.decision]));
 return candidates.filter(candidate=>!decisions.has(candidate.signalCandidateId)||decisions.get(candidate.signalCandidateId)==='allow');
}
