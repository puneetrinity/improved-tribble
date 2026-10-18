import {describe,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {filterStoredPrivateCandidates,parsePrivateOrigin} from '../../sourcing-authority/candidate-origin';
import {candidateEligibilityHash} from '../../sourcing-authority/candidate-eligibility-contract';

const identity={candidateId:randomUUID(),referenceId:randomUUID(),applicationId:12,applicationJobId:3,
 resumeVersionId:randomUUID(),sourceId:randomUUID(),generationId:randomUUID(),sourceHash:'a'.repeat(64)};
const display={version:1,kind:'organization_candidate',applicationId:12,applicationJobId:3};
const row={signalCandidateId:randomUUID(),candidateSummary:{candidateOrigin:display,privateResumeIdentity:identity}};
const binding={flowRunId:randomUUID(),executionAttemptId:randomUUID(),delivery:{revisionId:randomUUID()}};
const requestId=randomUUID();
const hash=candidateEligibilityHash({version:1,flowRunId:binding.flowRunId,revisionId:binding.delivery.revisionId,
 requestId,externalJobId:189,items:[{key:row.signalCandidateId,identity}]});
function database(decision:string) {
 return {execute:vi.fn().mockResolvedValue({rows:[{result:{version:1,bodyHash:hash,checkedAt:new Date().toISOString(),
  results:[{key:row.signalCandidateId,decision}]}}]})};
}
describe('private applicant service origin',()=>{
 it('keeps absent historical origin distinct from explicit null',()=>{
  expect(parsePrivateOrigin({})).toBeNull();
  expect(()=>parsePrivateOrigin({candidateOrigin:null})).toThrow();
 });
 it('reduces a validated private origin to application links only',()=>{
  expect(parsePrivateOrigin({candidateOrigin:{...identity,version:1,kind:'organization_candidate'}})?.display).toEqual(display);
 });
 it('preserves public ordering and withholds a new same-job applicant',async()=>{
  const publicRow={signalCandidateId:randomUUID(),candidateSummary:{}};
  expect(await filterStoredPrivateCandidates(database('same_job'),32,189,requestId,binding,[publicRow,row])).toEqual([publicRow]);
 });
 it('retains a currently eligible applicant',async()=>{
  expect(await filterStoredPrivateCandidates(database('allow'),32,189,requestId,binding,[row])).toEqual([row]);
 });
 it('fails closed on stale privacy rather than silently returning an empty result',async()=>{
  await expect(filterStoredPrivateCandidates(database('unavailable'),32,189,requestId,binding,[row])).rejects.toThrow('UNAVAILABLE');
 });
 it('refuses mismatched display identity before querying',async()=>{
  const db=database('allow');
  await expect(filterStoredPrivateCandidates(db,32,189,requestId,binding,[{...row,candidateSummary:{
   ...row.candidateSummary,candidateOrigin:{...display,applicationId:99}}}])).rejects.toThrow('BINDING');
  expect(db.execute).not.toHaveBeenCalled();
 });
 it('requires the current bound delivery and matching response hash',async()=>{
  await expect(filterStoredPrivateCandidates(database('allow'),32,189,requestId,null,[row])).rejects.toThrow('BINDING');
  await expect(filterStoredPrivateCandidates(database('allow'),32,190,requestId,binding,[row])).rejects.toThrow('CHANGED');
 });
});
