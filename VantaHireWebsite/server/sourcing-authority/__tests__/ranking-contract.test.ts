import {describe,it,expect} from 'vitest';
import {createRankingContract,rankingContractSchema,rankingHash,rankedCandidateSchema} from '../ranking-contract';
import {flattenCandidateForUI} from '../../lib/services/signal-contracts';
const id='10000000-0000-4000-8000-000000000001';
const payload={schemaVersion:2,compilerVersion:2,taxonomyVersion:2,criteria:[{id,label:'Role',class:'preferred',subject:'title',
 requirement:{kind:'accepted_titles',values:['Backend Engineer','Backend Developer']},evidenceKinds:['profile_evidence'],use:'assessment',provenance:{kind:'recruiter_edit'}}]};
describe('ranking contract binding',()=>{
 it('keeps legacy rendering unchanged for an incidental malformed ranking key',()=>{
  const row={id:1,jobId:2,signalCandidateId:'legacy',fitScore:70,sourceType:'discovered',state:'new',candidateSummary:{}} as any;
  expect(flattenCandidateForUI({...row,candidateSummary:{ranking:{unexpected:true}}})).toEqual({
    ...flattenCandidateForUI(row),candidateSummary:{ranking:{unexpected:true}}});
  expect(()=>flattenCandidateForUI({...row,candidateSummary:{ranking:{unexpected:true}}},true)).toThrow();
 });
 it('binds the approved payload and source-neutral projection',()=>{
  const c=createRankingContract(id,'a'.repeat(64),payload);
  expect(c.policyVersion).toBe('rubric-range-v1');expect(c.payload.schemaVersion).toBe(2);
  expect(rankingContractSchema.parse(c)).toEqual(c);
  expect(c.contractHash).toMatch(/^[a-f0-9]{64}$/);
 });
 it('rejects silent alternative edits, hash changes and old schemas',()=>{
  const c=createRankingContract(id,'a'.repeat(64),payload);
  expect(()=>rankingContractSchema.parse({...c,materialHash:'b'.repeat(64)})).toThrow();
  const changed=structuredClone(c);changed.payload.criteria[0].label='different';
  expect(()=>rankingContractSchema.parse(changed)).toThrow();
  expect(()=>createRankingContract(id,'a'.repeat(64),{...payload,schemaVersion:1})).toThrow();
 });
 it('excludes notes, labels and provenance from matching, but binds them in the contract',()=>{
  const a=createRankingContract(id,'a'.repeat(64),payload),b=createRankingContract(id,'a'.repeat(64),{...payload,criteria:[{...payload.criteria[0],note:'Job-related clarification',label:'Role title'}]});
  expect(a.projectionText).toBe(b.projectionText);expect(a.contractHash).not.toBe(b.contractHash);
 });
 it('refuses oversized alternatives, duplicate normalized titles, maximum-only and protected notes',()=>{
  const c=payload.criteria[0];
  for(const requirement of [{kind:'accepted_titles',values:Array(21).fill('Backend Engineer')},
     {kind:'accepted_titles',values:['Backend Engineer',' backend engineer ']},{kind:'experience_range',maximum:10}]) {
    expect(()=>createRankingContract(id,'a'.repeat(64),{...payload,criteria:[{...c,requirement}]})).toThrow();
  }
  expect(()=>createRankingContract(id,'a'.repeat(64),{...payload,criteria:[{...c,note:'Married only'}]})).toThrow();
 });
 it('canonical hashing is independent of JSON object key insertion order',()=>{
  expect(rankingHash({b:1,a:2})).toBe(rankingHash({a:2,b:1}));
 });
 it('supports fractional years and byte-ordered Unicode without source-dependent hashing',()=>{
  const criteria=[{...payload.criteria[0],subject:'experience_years',requirement:{kind:'minimum_years',minimum:1e-7}}];
  const c=createRankingContract(id,'a'.repeat(64),{...payload,criteria});
  expect(c.projectionText).toContain('0.0000001');
  expect(rankingContractSchema.parse(c)).toEqual(c);
  expect(()=>createRankingContract(id,'a'.repeat(64),{...payload,criteria:criteria.map(x=>({...x,evidenceKinds:['candidate_provided']}))})).toThrow();
 });
 it('validates a closed assessment envelope without percentage or experience fallbacks',()=>{
  const asOf='2026-10-01T00:00:00.000Z';
  const envelope={protocolVersion:2,revisionId:id,contractHash:'a'.repeat(64),outputHash:'b'.repeat(64),asOf,
    candidateId:'test',ordinal:3,N:1,D:1,L:1_000_000,eligibility:'unconstrained',
    experience:{version:'recorded-experience-v1',asOf,status:'unavailable',lowerDays:null,upperDays:null,display:'Experience unavailable',reason:'no_roles'},
    assessments:[{criterionIds:[id],labels:['Backend role'],subject:'title',state:'met',mapped:true,weight:1,points:1,localPoints:1_000_000,refs:['role.title']}]};
  expect(rankedCandidateSchema.parse(envelope).ordinal).toBe(3);
  const contactShapedId='0de8fba0-b2de-4207-94f8-468240165166';
  const contactEnvelope={...envelope,assessments:[{...envelope.assessments[0],criterionIds:[contactShapedId],labels:['Contact person@fixture.invalid'],refs:['call 2025550147']}]};
  const before=rankingHash(contactEnvelope);
  const flat=flattenCandidateForUI({id:1,jobId:2,signalCandidateId:'test',state:'new',sourceType:'discovered',candidateSummary:{ranking:contactEnvelope}} as any,true);
  expect(flat.ranking?.assessments[0]?.criterionIds).toEqual([contactShapedId]);
  expect(flat.ranking?.revisionId).toBe(id);
  expect(flat.ranking?.assessments[0]?.labels).toEqual(['Contact [suppressed]']);
  expect(flat.ranking?.assessments[0]?.refs).toEqual(['call [suppressed]']);
  expect(JSON.stringify(flat)).not.toContain('person@fixture.invalid');
  expect(rankingHash(contactEnvelope)).toBe(before);
  for(const patch of [{N:2},{N:0},{ordinal:0},{L:0},{unexpected:true},
    {experience:{...envelope.experience,lowerDays:0}},
    {experience:{...envelope.experience,asOf:'2026-10-02T00:00:00.000Z'}}])
    expect(()=>rankedCandidateSchema.parse({...envelope,...patch})).toThrow();
 });
});
