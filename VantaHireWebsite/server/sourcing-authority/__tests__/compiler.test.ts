import { describe, expect, it, vi } from 'vitest';
import type Groq from 'groq-sdk';
import {executeDigestPreparation} from '../digest';
import type {SourcingRepository} from '../repository';
import { compileSourcingQuery, digestBasisHash, QueryMappingError, validateProviderGrant, type SourcingBasis } from '../compiler';
import { sourceHash } from '../../job-brief/contracts';
const id = '10000000-0000-4000-8000-000000000001';
const criterion = { id, label: 'Python', class: 'must_have', subject: 'skill', requirement: { kind: 'text', value: 'Python' },
  evidenceKinds: ['profile_evidence'], use: 'assessment', provenance: { kind: 'recruiter_edit' } } as const;
const basis: SourcingBasis = { briefVersionId: id, materialHash: sourceHash('material'), sourceHash: sourceHash('Build Python services.'),
  sourceJD: 'Build Python services.', title: 'Backend Engineer', location: 'Bengaluru',
  payload: { schemaVersion: 1, compilerVersion: 1, taxonomyVersion: 1, criteria: [{ ...criterion, evidenceKinds: ['profile_evidence'] }] } };
const digest = { topSkills: ['Python','Invented skill'], seniorityLevel: 'senior', domain: 'Software', constraints: [], keyResponsibilities: [],
  titleSearchTerms: ['Backend Engineer','Software Engineer'], adjacentBuckets: [['Platform Engineer']], adjacentLocations: [], tokenCount: 100, version: 3 };

describe('durable preparation failure classification',()=>{
  it.each([401,429,503])('settles provider HTTP %s without leaving preparation started',async status=>{
    const call=vi.fn(async(operation:string,args:unknown[])=>operation==='digestFinish'?args[2]:null);
    const create=vi.fn(async()=>{throw Object.assign(Error('private provider detail'),{status});});
    const result=await executeDigestPreparation({call} as unknown as SourcingRepository,{organizationId:1,jobId:2,actorId:3,requestId:id,model:'fixture'},
      {client:{chat:{completions:{create}}} as unknown as Groq,claim:{id,state:'started',lease:id,model:'fixture',basis,basisHash:digestBasisHash(basis)}});
    expect(result).toEqual(status===503?{state:'unknown',code:'SOURCING_DIGEST_UNKNOWN'}:
      {state:'failed',code:status===401?'SOURCING_DIGEST_UNAUTHORIZED':'SOURCING_DIGEST_RATE_LIMITED'});
    expect(create).toHaveBeenCalledTimes(1);expect(call).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain('private provider detail');
  });
  it.each(['mapping','before-dispatch','timeout'])('records the actual %s failure boundary',async kind=>{
    const b=kind==='mapping'?{...basis,payload:{...basis.payload,criteria:[{...basis.payload.criteria[0]!,use:'retrieval' as const}]}}:basis;
    const call=vi.fn(async(operation:string,args:unknown[])=>operation==='digestFinish'?args[2]:null);
    const create=vi.fn(async()=>{if(kind==='timeout')throw Error('timeout');return {choices:[{finish_reason:'stop',message:{content:JSON.stringify(digest)}}]};});
    const result=await executeDigestPreparation({call} as unknown as SourcingRepository,{organizationId:1,jobId:2,actorId:3,requestId:id,model:'fixture'},
      {client:{chat:{completions:{create}}} as unknown as Groq,claim:{id,state:'started',lease:id,model:kind==='before-dispatch'?'wrong':'fixture',basis:b,basisHash:digestBasisHash(b)}});
    expect(result).toEqual(kind==='mapping'?{state:'failed',code:'QUERY_MAPPING_UNSUPPORTED',criterionIds:[id]}:
      kind==='before-dispatch'?{state:'failed',code:'SOURCING_DIGEST_NO_DISPATCH'}:{state:'unknown',code:'SOURCING_DIGEST_UNKNOWN'});
    expect(create).toHaveBeenCalledTimes(kind==='before-dispatch'?0:1);
    expect(call).toHaveBeenCalledTimes(1);
  });
});

describe('actual provider grant inputs',()=>{
  it('matches the versioned wire vector exercised independently by Discover CI',()=>{
    const b={...basis,materialHash:'a'.repeat(64),location:'Bengaluru, India'};
    const d={...digest,topSkills:['python'],titleSearchTerms:['Backend Engineer'],tokenCount:80};
    const artifact=compileSourcingQuery(b,d,digestBasisHash(b));
    expect(artifact.queryHash).toBe('2b087666c7f77b9c59d08ac15ab6a1f9a94db97300e808b0c388169b37c4015b');
    expect(artifact.previewQueryHash).toBe('793684637894a3c147d660530f7be6ba1e589eec33a4552140ecec82cfc53148');
    const command={action:'grant',protocolVersion:1,flowRunId:id,artifactHash:artifact.queryHash,discoverRequestId:id,executionAttemptId:id,
      slot:'exact',rungId:'exact',providerInput:{version:1,limit:300,excludePersonIds:[3,7],requirements:{title:b.title,topSkills:['python'],seniorityLevel:'senior',
        domain:'Software',roleFamily:'backend',location:b.location,experienceYears:null,experienceYearsMax:null,education:null,
        titleSearchTerms:['backend engineer'],adjacentBuckets:[['platform engineer']],adjacentLocations:[]}}};
    expect(validateProviderGrant(artifact,command,null).providerInputHash).toBe('cc2b39ef50c158e1400ddbf101356c9227d2cedc19ae995cb9572dd2b8993fae');
  });
  function fixture(){
    const query=compileSourcingQuery(basis,{...digest,adjacentLocations:[{metro:'Mumbai',country:'India'},{metro:'London',country:'UK'}]},digestBasisHash(basis));
    const command={action:'grant',protocolVersion:1,flowRunId:id,artifactHash:query.queryHash,discoverRequestId:id,executionAttemptId:id,
      slot:'exact',rungId:'exact',providerInput:{version:1,limit:300,excludePersonIds:[1,5],requirements:{
        title:'Backend Engineer',topSkills:['python'],seniorityLevel:'senior',domain:'Software',roleFamily:'backend',location:'Bengaluru',
        experienceYears:null,experienceYearsMax:null,education:null,titleSearchTerms:['backend engineer','software engineer'],
        adjacentBuckets:[['platform engineer']],adjacentLocations:[{metro:'Mumbai',country:'India'},{metro:'London',country:'UK'}],
      }}};
    return {query,command};
  }
  it('authorizes the exact compiled market, never just its claimed hash',()=>{
    const {query,command}=fixture();expect(validateProviderGrant(query,command,null).providerInputHash).toMatch(/^[a-f0-9]{64}$/);
    for(const patch of [{location:'Delhi'},{titleSearchTerms:['unapproved title']},{topSkills:['invented']},{experienceYearsMax:8},{querySeniorityLevels:['entry']}]){
      expect(()=>validateProviderGrant(query,{...command,providerInput:{...command.providerInput,requirements:{...command.providerInput.requirements,...patch}}},null)).toThrow();
    }
    expect(()=>validateProviderGrant(query,{...command,providerInput:{...command.providerInput,limit:100}},null)).toThrow();
  });
  it('bounds a spill by raw returned count, not deduplicated or shown results',()=>{
    const {query,command}=fixture();command.slot='spill';command.rungId='adjacent_title:0';command.providerInput.limit=43;
    command.providerInput.requirements.titleSearchTerms=['platform engineer'];
    expect(validateProviderGrant(query,command,{providerTotal:280,rawReturnedCount:257}).providerInputHash).toBeTruthy();
    for(const evidence of [null,{providerTotal:null,rawReturnedCount:257},{providerTotal:400,rawReturnedCount:257},{providerTotal:280,rawReturnedCount:260}]){
      expect(()=>validateProviderGrant(query,command,evidence)).toThrow('SPILL_REFUSED');
    }
  });
  it('allows only the unchanged same-country adjacent location rule',()=>{
    const {query,command}=fixture();command.slot='spill';command.rungId='adjacent_geo:0';command.providerInput.limit=43;
    command.providerInput.requirements.location='Mumbai, India';
    expect(validateProviderGrant(query,command,{providerTotal:280,rawReturnedCount:257}).providerInputHash).toBeTruthy();
    command.rungId='adjacent_geo:1';command.providerInput.requirements.location='London, UK';
    expect(()=>validateProviderGrant(query,command,{providerTotal:280,rawReturnedCount:257})).toThrow('SPILL_REFUSED');
  });
  it('requires the receipt-normalized exclusion list and rejects arbitrary fields',()=>{
    const {query,command}=fixture();
    for(const ids of [[5,1],[1,1,5],[-1],[1.5]])expect(()=>validateProviderGrant(query,{...command,providerInput:{...command.providerInput,excludePersonIds:ids}},null)).toThrow();
    expect(()=>validateProviderGrant(query,{...command,force:true},null)).toThrow();
  });
});

describe('approved sourcing query compiler', () => {
  it('is deterministic, preserves title variants and never adds unapproved digest skills', () => {
    const result = compileSourcingQuery(basis, digest, digestBasisHash(basis));
    expect(result).toEqual(compileSourcingQuery(basis, digest, digestBasisHash(basis)));
    const parsed = JSON.parse(result.jobContext.jdDigest);
    expect(parsed.titleSearchTerms).toEqual(['backend engineer','software engineer']);
    expect(parsed.adjacentBuckets).toEqual([['Platform Engineer']]);
    expect(parsed.topSkills).toEqual(['Python']);
    expect(result.jobContext).not.toHaveProperty('experienceYearsMax');
    expect(result.criterionMap).toEqual([{ criterionId: id, use: 'assessment', field: null }]);
  });
  it('does not accept a digest prepared for an older brief, title or location', () => {
    for (const patch of [{ title: 'New title' }, { location: 'Delhi' }, { materialHash: sourceHash('new') }]) {
      expect(() => compileSourcingQuery({ ...basis, ...patch }, digest, digestBasisHash(basis))).toThrow('SOURCING_QUERY_STALE');
    }
  });
  it('uses explicit recruiter retrieval titles rather than overriding them with model aliases', () => {
    const b: SourcingBasis = {...basis,payload:{...basis.payload,criteria:[{...basis.payload.criteria[0]!,
      subject:'title',label:'Platform Engineer',requirement:{kind:'text',value:'Platform Engineer'},use:'retrieval'}]}};
    const result=compileSourcingQuery(b,digest,digestBasisHash(b));
    expect(JSON.parse(result.jobContext.jdDigest).titleSearchTerms).toEqual(['platform engineer']);
  });
  it('does not buy a new market-size probe for an assessment-only change', () => {
    const b: SourcingBasis = {...basis,materialHash:sourceHash('new assessment'),payload:{...basis.payload,criteria:[{
      ...basis.payload.criteria[0]!,requirement:{kind:'text',value:'Go'},label:'Go'}]}};
    const before=compileSourcingQuery(basis,digest,digestBasisHash(basis));
    const after=compileSourcingQuery(b,digest,digestBasisHash(b));
    expect(after.previewQueryHash).toBe(before.previewQueryHash);
    expect(after.queryHash).not.toBe(before.queryHash);
  });
  it('does not silently claim unsupported retrieval filters were applied', () => {
    const b = { ...basis, payload: { ...basis.payload, criteria: [{ ...basis.payload.criteria[0]!, use: 'retrieval' as const }] } };
    expect(() => compileSourcingQuery(b, digest, digestBasisHash(b))).toThrow(QueryMappingError);
  });
  it('keeps preferred skills separate from must-haves in the wire context', () => {
    const b = { ...basis, payload: { ...basis.payload, criteria: [{ ...basis.payload.criteria[0]!, class: 'preferred' as const }] } };
    const query = compileSourcingQuery(b, digest, digestBasisHash(b));
    expect(query.jobContext.skills).toEqual([]); expect(query.jobContext.goodToHaveSkills).toEqual(['Python']);
  });
  it('disqualifier and evidence-required criteria never become provider exclusions', () => {
    for (const kind of ['disqualifier','evidence_required'] as const) {
      const b = { ...basis, payload: { ...basis.payload, criteria: [{ ...basis.payload.criteria[0]!, class: kind, use: 'retrieval' as const }] } };
      expect(compileSourcingQuery(b, digest, digestBasisHash(b)).criterionMap[0]?.use).toBe('assessment');
    }
  });
  it('refuses a digest with invented extra fields or mismatched source bytes', () => {
    expect(() => compileSourcingQuery(basis, { ...digest, maximumExperience: 5 }, digestBasisHash(basis))).toThrow();
    expect(() => compileSourcingQuery({ ...basis, sourceJD: 'Different text' }, digest, digestBasisHash(basis))).toThrow();
  });
});
