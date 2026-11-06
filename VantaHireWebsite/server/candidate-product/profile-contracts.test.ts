import {describe,it,expect,vi,afterEach} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {parseProfileCommand,parseProfileJson,canonicalProfileJson} from './profile-contracts';
import {profileMissingFields,manualProfileSchema} from '../../shared/candidate-profile';
import {deliverProfile,readProfile,readSparkProfile,readSourceProposal,eraseSparkProfile} from './profile-client';
import {profileRepository} from './profile-repository';
import {runProfileBatch,startProfileProcessor,runProfileExpiryBatch,startProfileExpiryProcessor,type ProfileLease} from './profile-processor';
afterEach(()=>vi.useRealTimers());
describe('bound network erasure transport',()=>{
 const identity=()=>({schemaVersion:1 as const,subjectId:randomUUID(),bindingId:randomUUID(),requestId:randomUUID()});
 it('uses the dedicated erasure scope and exact immutable request',async()=>{
  const value=identity(),deps={sign:vi.fn().mockResolvedValue('token'),
   fetch:vi.fn().mockResolvedValue(new Response(JSON.stringify({...value,status:'erased'}))),env:{ACTIVEKG_BASE_URL:'https://memory.invalid'}};
  await eraseSparkProfile(value,new AbortController().signal,deps);
  expect(deps.sign).toHaveBeenCalledWith('activekg',expect.objectContaining({scopes:'candidate-profile:erase',requestId:value.requestId,tenantId:`candidate_${value.subjectId}`}));
  expect(deps.fetch).toHaveBeenCalledWith('https://memory.invalid/candidate-profiles/erase',expect.objectContaining({body:canonicalProfileJson(value),redirect:'error'}));
 });
 it.each(['subjectId','bindingId','requestId'])('refuses another %s receipt without retry',async key=>{
  const value=identity(),deps={sign:vi.fn().mockResolvedValue('token'),fetch:vi.fn().mockResolvedValue(
   new Response(JSON.stringify({...value,status:'erased',[key]:randomUUID()}))),env:{ACTIVEKG_BASE_URL:'https://memory.invalid'}};
  await expect(eraseSparkProfile(value,new AbortController().signal,deps)).rejects.toMatchObject({code:'identity_conflict'});
  expect(deps.fetch).toHaveBeenCalledTimes(1);
 });
 it('bounds signing and never dispatches after timeout',async()=>{
  vi.useFakeTimers();let release!:(token:string)=>void;
  const deps={sign:vi.fn().mockImplementation(()=>new Promise<string>(resolve=>{release=resolve;})),fetch:vi.fn(),env:{ACTIVEKG_BASE_URL:'https://memory.invalid'}};
  const pending=expect(eraseSparkProfile(identity(),new AbortController().signal,deps)).rejects.toMatchObject({code:'memory_unavailable'});
  await vi.advanceTimersByTimeAsync(10000);await pending;release('token');await Promise.resolve();expect(deps.fetch).not.toHaveBeenCalled();
 });
});
describe('private source proposal transport',()=>{
 const proposal=()=>{
  const body={schemaVersion:1,proposalId:randomUUID(),sourceId:randomUUID(),sourceVersion:1,
   originalDraftVersion:0,originalProfileVersion:0,originalPreferenceVersion:0,originalPreferenceDraftRevision:0,
   sourceKind:'resume',facts:[],reviewNotes:[],expiresAt:'2026-11-01T00:00:00.000Z'};
  return {...body,proposalHash:createHash('sha256').update(canonicalProfileJson(body)).digest('hex')};
 };
 it('reads only the exact owner proposal and verifies its fingerprint',async()=>{
  const value=proposal(),subject=randomUUID(),binding=randomUUID();
  const deps={fetch:vi.fn().mockResolvedValue(new Response(JSON.stringify(value))),sign:vi.fn().mockResolvedValue('token'),env:{ACTIVEKG_BASE_URL:'https://memory.invalid'}};
  expect(await readSourceProposal(subject,binding,value.sourceId,value.proposalId,deps)).toEqual(value);
  expect(deps.fetch).toHaveBeenCalledWith(`https://memory.invalid/candidate-profiles/sources/${value.sourceId}/proposals/${value.proposalId}?binding=${binding}`,expect.objectContaining({redirect:'error'}));
 });
 it.each(['hash','source','proposal'])('refuses a mismatched %s without retrying',async kind=>{
  const value=proposal(),source=value.sourceId,id=value.proposalId;
  if(kind==='hash')value.proposalHash='a'.repeat(64);
  if(kind==='source')value.sourceId=randomUUID();
  if(kind==='proposal')value.proposalId=randomUUID();
  const deps={fetch:vi.fn().mockResolvedValue(new Response(JSON.stringify(value))),sign:vi.fn().mockResolvedValue('token'),env:{ACTIVEKG_BASE_URL:'https://memory.invalid'}};
  await expect(readSourceProposal(randomUUID(),randomUUID(),source,id,deps)).rejects.toMatchObject({code:'identity_conflict'});
  expect(deps.fetch).toHaveBeenCalledTimes(1);
 });
 it('uses the source transfer size bound, not the smaller profile view bound',async()=>{
  const value=proposal();
  const deps={fetch:vi.fn().mockResolvedValue(new Response(' '.repeat(700*1024)+JSON.stringify(value))),sign:vi.fn().mockResolvedValue('token'),env:{ACTIVEKG_BASE_URL:'https://memory.invalid'}};
  expect(await readSourceProposal(randomUUID(),randomUUID(),value.sourceId,value.proposalId,deps)).toEqual(value);
  deps.fetch.mockResolvedValue(new Response(' '.repeat(2*1024*1024+1)));
  await expect(readSourceProposal(randomUUID(),randomUUID(),value.sourceId,value.proposalId,deps)).rejects.toMatchObject({code:'memory_unavailable'});
 });
});
describe('v3 private resume transport',()=>{
 const view=()=>({schemaVersion:3,draftVersion:0,profileVersion:0,preferenceVersion:0,sources:[],proposals:[],hasMoreSources:false,hasMoreProposals:false,
  draft:null,confirmedProfile:null,preferences:null,publicationActive:false,
  preferenceDraft:{preferenceDraftRevision:1,
   preferenceDraftHash:createHash('sha256').update(canonicalProfileJson({sections:{},exclusions:[]})).digest('hex'),
   sections:{},exclusions:[],promotedPreferenceVersion:null,promotedDraftRevision:null}});
 const setup=(raw=JSON.stringify(view()))=>({sign:vi.fn().mockResolvedValue('token'),
  fetch:vi.fn().mockResolvedValue(new Response(raw)),env:{ACTIVEKG_BASE_URL:'https://memory.invalid'}});
 it('reads the v3 endpoint with owner scope, exact binding and no redirects',async()=>{
  const deps=setup(),subject=randomUUID(),binding=randomUUID();
  expect(await readSparkProfile(subject,binding,deps)).toEqual(view());
  expect(deps.sign).toHaveBeenCalledWith('activekg',expect.objectContaining({tenantId:`candidate_${subject}`,scopes:'candidate-profile:owner-read'}));
  expect(deps.fetch).toHaveBeenCalledWith(`https://memory.invalid/candidate-profiles/spark?binding=${binding}`,
   expect.objectContaining({redirect:'error',headers:{authorization:'Bearer token'}}));
  expect(deps.fetch).toHaveBeenCalledTimes(1);
 });
 it.each(['legacy','duplicate','hash','unknown','oversized'])('refuses %s responses without legacy fallback',async kind=>{
  const value=view();let raw=JSON.stringify(value);
  if(kind==='legacy')raw=raw.replace('"schemaVersion":3','"schemaVersion":2');
  if(kind==='duplicate')raw=raw.replace('"draftVersion":0','"draftVersion":1,"draftVersion":0');
  if(kind==='hash')raw=raw.replace(value.preferenceDraft.preferenceDraftHash,'a'.repeat(64));
  if(kind==='unknown')raw=raw.replace('"schemaVersion":3','"unexpected":true,"schemaVersion":3');
  if(kind==='oversized')raw=' '.repeat(600*1024+1);
  const deps=setup(raw);
  await expect(readSparkProfile(randomUUID(),randomUUID(),deps)).rejects.toMatchObject({code:'memory_unavailable'});
  expect(deps.fetch).toHaveBeenCalledTimes(1);
 });
 it('preserves privacy refusal instead of returning an empty profile',async()=>{
  const deps=setup();deps.fetch.mockResolvedValue(new Response('',{status:451}));
  await expect(readSparkProfile(randomUUID(),randomUUID(),deps)).rejects.toMatchObject({code:'candidate_privacy_restricted'});
 });
 it('includes signing in the five-second deadline and never sends a late request',async()=>{
  vi.useFakeTimers();const deps=setup();let release!:(token:string)=>void;
  deps.sign.mockImplementation(()=>new Promise<string>(resolve=>{release=resolve;}));
  const result=expect(readSparkProfile(randomUUID(),randomUUID(),deps)).rejects.toMatchObject({code:'memory_unavailable'});
  await vi.advanceTimersByTimeAsync(5000);await result;release('late');await Promise.resolve();
  expect(deps.fetch).not.toHaveBeenCalled();
 });
});
describe('automatic expiry recovery',()=>{
 const setup=()=>{
  const l={schemaVersion:3 as const,commandId:randomUUID(),subjectId:randomUUID(),bindingId:randomUUID(),idempotencyKey:randomUUID(),
   commandHash:'a'.repeat(64),userId:1,leaseToken:randomUUID(),leaseGeneration:1};
  const r={schemaVersion:3,commandId:l.commandId,subjectId:l.subjectId,bindingId:l.bindingId,commandHash:l.commandHash,
   status:'rejected',reason:'command_expired',changed:false,draftVersion:0,profileVersion:0,preferenceVersion:0,
   preferenceDraftRevision:0,preferenceDraftHash:null,publicationActive:false};
  const d={enabled:()=>true,redactDue:vi.fn(async()=>{}),claimExpiry:vi.fn(async()=>[l]),prepareExpiry:vi.fn(async()=>{}),
   settleExpiry:vi.fn(async()=>{}),recover:vi.fn(async()=>r)};
  return {l,r,d};
 };
 it('does nothing when off',async()=>{const {d}=setup();d.enabled=()=>false;expect(await runProfileExpiryBatch(d)).toBe(0);expect(d.redactDue).not.toHaveBeenCalled();});
 it('settles the exact receipt without sending lease or user metadata',async()=>{
  const {l,r,d}=setup();expect(await runProfileExpiryBatch(d)).toBe(1);
  expect(d.settleExpiry).toHaveBeenCalledWith(l,r);expect(d.recover.mock.calls[0]![0]).not.toHaveProperty('userId');
  expect(d.recover.mock.calls[0]![0]).not.toHaveProperty('leaseToken');
 });
 it('leaves identity errors unresolved instead of inventing rejection',async()=>{
  const {l,d}=setup();d.recover.mockResolvedValue({...await d.recover(),commandId:randomUUID()});
  await runProfileExpiryBatch(d);expect(d.settleExpiry).toHaveBeenCalledWith(l,null);
 });
 it.each(['candidate_privacy_restricted','identity_conflict','idempotency_conflict','not_found'])('parks permanent %s for operator review',async code=>{
  const {l,d}=setup();d.recover.mockRejectedValue(Object.assign(Error(code),{code}));
  const refuseExpiry=vi.fn(async()=>{}),recoveryReviewCount=vi.fn(async()=>1);
  const log=vi.spyOn(console,'warn').mockImplementation(()=>{});
  try{
   await runProfileExpiryBatch({...d,refuseExpiry,recoveryReviewCount});
   expect(refuseExpiry).toHaveBeenCalledWith(l);expect(d.settleExpiry).not.toHaveBeenCalled();
   expect(recoveryReviewCount).toHaveBeenCalledTimes(1);
  }finally{log.mockRestore();}
 });
 it('never sends after late authority misses the total deadline',async()=>{
  vi.useFakeTimers();const {l,d}=setup();let finish!:()=>void;
  d.prepareExpiry.mockImplementation(()=>new Promise<void>(r=>{finish=r;}));
  const active=runProfileExpiryBatch(d);await vi.advanceTimersByTimeAsync(15001);await active;
  finish();await vi.advanceTimersByTimeAsync(0);expect(d.recover).not.toHaveBeenCalled();expect(d.settleExpiry).toHaveBeenCalledWith(l,null);
 });
 it('propagates a lost settlement so the lease can recover',async()=>{
  const {d}=setup();d.settleExpiry.mockRejectedValue(Error('synthetic'));await expect(runProfileExpiryBatch(d)).rejects.toThrow('expiry_settlement_unavailable');
 });
 it('shutdown waits for active work and schedules no more polling',async()=>{
  vi.useFakeTimers();const {r,d}=setup();let finish!:(v:typeof r)=>void;
  d.recover.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));const stop=startProfileExpiryProcessor(d);
  await vi.advanceTimersByTimeAsync(0);let stopped=false;const stopping=stop().then(()=>{stopped=true;});
  await Promise.resolve();expect(stopped).toBe(false);finish(r);await stopping;await vi.advanceTimersByTimeAsync(120000);
  expect(d.claimExpiry).toHaveBeenCalledTimes(1);
 });
});
const envelope={schemaVersion:2,idempotencyKey:'10000000-0000-4000-8000-000000000001',expectedDraftVersion:0,expectedProfileVersion:0,expectedPreferenceVersion:0};
const emptyProfile={displayName:'Synthetic',headline:'',linkedinUrl:null,currentLocation:null,skills:[],employment:[],education:[],projects:[]};
const fixtures:any={
 draft_save:{...envelope,action:'save_draft',payload:{profile:{...emptyProfile,currentLocation:{city:'Bengaluru',countryCode:'IN',displayCountry:'India'},skills:['Python']}}},
 preferences_save:{...envelope,action:'save_preferences',payload:{preferences:{desiredRoles:['Engineer'],preferredSeniority:[],workArrangements:['remote'],locations:{mode:'anywhere'},remoteRegions:{mode:'worldwide'},relocation:{mode:'discuss',destinations:[]},employmentTypes:['permanent'],availability:{mode:'unknown'},compensation:{mode:'open_to_discussion'},strengths:{roles:'firm',location:'flexible',workArrangement:'flexible',employmentType:'firm',compensation:'flexible'}}}},
 profile_read_incomplete:{draft:emptyProfile},
 numeric_compensation:{mode:'target',currency:'INR',period:'annual',component:'ctc',targetMin:'2000000.00',targetMax:'2500000.00',hardMinimum:'1800000.00'},
};
const parse=(v:unknown)=>parseProfileCommand(JSON.stringify(v));
describe('S2A profile command contracts',()=>{
 it('accepts manual draft and independently saved preferences',()=>{
  expect(parse(fixtures.draft_save).value.action).toBe('save_draft');
  expect(parse(fixtures.preferences_save).value.action).toBe('save_preferences');
 });
 it('canonicalizes text and object order without changing S1',()=>{
  const a=structuredClone(fixtures.draft_save),b=structuredClone(fixtures.draft_save);
  a.payload.profile.displayName='  Jose\u0301  ';b.payload.profile.displayName='José';
  expect(parse(a).hash).toBe(parse(b).hash);
  expect(parse(Object.fromEntries(Object.entries(a).reverse())).canonical).toBe(parse(a).canonical);
 });
 it.each(['userId','subjectId','bindingId','provenance','consent'])('rejects browser authority field %s',key=>{
  expect(()=>parse({...fixtures.draft_save,[key]:'injected'})).toThrow();
 });
 it('rejects preferences in draft and server-owned location timestamp',()=>{
  const a=structuredClone(fixtures.draft_save);a.payload.preferences={};expect(()=>parse(a)).toThrow();
  delete a.payload.preferences;a.payload.profile.currentLocation.confirmedAt='2026-10-27T00:00:00Z';expect(()=>parse(a)).toThrow();
 });
 it.each(['{"a":1,"a":2}','{"a":1,"\\u0061":2}','{"a":"\\ud800"}','{"a":1e999}'])('rejects ambiguous or invalid JSON %s',raw=>expect(()=>parseProfileJson(raw)).toThrow());
 it('rejects deeply nested and oversized raw input',()=>{
  expect(()=>parseProfileJson('['.repeat(13)+'0'+']'.repeat(13))).toThrow();
  expect(()=>parseProfileJson(JSON.stringify('a'.repeat(384*1024)))).toThrow();
 });
 it.each([-1,1.2,9007199254740992,true,'1'])('rejects invalid revision %s',value=>expect(()=>parse({...fixtures.draft_save,expectedDraftVersion:value})).toThrow());
 it('allows missing facts to stay unknown without requiring resume or LinkedIn',()=>{
  const p=manualProfileSchema.parse(fixtures.profile_read_incomplete.draft);
  expect(profileMissingFields(p,null)).toEqual(['currentLocation.city','currentLocation.countryCode','skills','preferences']);
 });
 it('rejects made-up currency/country and duplicate skills',()=>{
  const a=structuredClone(fixtures.preferences_save);a.payload.preferences.compensation={...fixtures.numeric_compensation,currency:'ZZZ'};expect(()=>parse(a)).toThrow();
  const b=structuredClone(fixtures.draft_save);b.payload.profile.currentLocation.countryCode='XX';expect(()=>parse(b)).toThrow();
  b.payload.profile.currentLocation.countryCode='IN';b.payload.profile.skills=['Python',' python '];expect(()=>parse(b)).toThrow();
 });
 it('normalizes exact decimal amounts and rejects inverted ranges',()=>{
  const a=structuredClone(fixtures.preferences_save);a.payload.preferences.compensation={...fixtures.numeric_compensation,targetMin:'2000000'};
  expect(parse(a).canonical).toContain('2000000.00');
  a.payload.preferences.compensation.targetMin='999999999';expect(()=>parse(a)).toThrow();
 });
 it('validates real partial dates and current employment',()=>{
  const a=structuredClone(fixtures.draft_save);a.payload.profile.employment=[{id:'10000000-0000-4000-8000-000000000009',employer:'Synthetic',title:'Engineer',description:'',start:{value:'2024-02-29',precision:'day'},end:null,current:true}];
  expect(()=>parse(a)).not.toThrow();a.payload.profile.employment[0].start.value='2023-02-29';expect(()=>parse(a)).toThrow();
  a.payload.profile.employment[0].start={value:'2024',precision:'year'};a.payload.profile.employment[0].end={value:'2025',precision:'year'};expect(()=>parse(a)).toThrow();
 });
 it('keeps source processing unavailable in the manual checkpoint',()=>{
  expect(()=>parse({...fixtures.draft_save,action:'request_enrichment'})).toThrow();
 });
});
describe('S2A signed transport and routine-only repository',()=>{
 afterEach(()=>vi.useRealTimers());
 const sample=()=>{
  const p=parse(fixtures.draft_save);
  return {commandId:randomUUID(),subjectId:randomUUID(),bindingId:randomUUID(),userId:1,authVersion:0,
   idempotencyKey:fixtures.draft_save.idempotencyKey,leaseToken:randomUUID(),leaseGeneration:1,attemptCount:1,body:p.canonical,hash:p.hash};
 };
 const response=(l:ReturnType<typeof sample>)=>({schemaVersion:2,commandId:l.commandId,subjectId:l.subjectId,bindingId:l.bindingId,
  commandHash:l.hash,status:'applied',draftVersion:1,profileVersion:0,preferenceVersion:0,reason:null,publicationActive:false});
 it('sends one bounded request with exact identity and hash',async()=>{
  const l=sample(),sign=vi.fn().mockResolvedValue('synthetic-token'),fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify(response(l))));
  expect(await deliverProfile(l,new AbortController().signal,{sign,fetch,env:{ACTIVEKG_BASE_URL:'https://memory.invalid'}})).toEqual(response(l));
  expect(sign).toHaveBeenCalledWith('activekg',expect.objectContaining({tenantId:`candidate_${l.subjectId}`,requestId:l.commandId,lifetimeSeconds:60}));
  expect(fetch).toHaveBeenCalledWith('https://memory.invalid/candidate-profiles/profile/commands',expect.objectContaining({redirect:'error',body:l.body}));
 });
 it('no send after cancellation during signing',async()=>{
  vi.useFakeTimers();const l=sample(),controller=new AbortController();let resolve!:(v:string)=>void;
  const fetch=vi.fn(),sign=vi.fn(()=>new Promise<string>(r=>{resolve=r;}));
  const pending=deliverProfile(l,controller.signal,{sign,fetch,env:{ACTIVEKG_BASE_URL:'https://memory.invalid'}});
  const assertion=expect(pending).rejects.toMatchObject({code:'memory_unavailable'});controller.abort();await assertion;resolve('late');await Promise.resolve();
  expect(fetch).not.toHaveBeenCalled();
 });
 it('foreign receipt identity is never acknowledged',async()=>{
  const l=sample();await expect(deliverProfile(l,new AbortController().signal,{sign:vi.fn().mockResolvedValue('token'),
   fetch:vi.fn().mockResolvedValue(new Response(JSON.stringify({...response(l),subjectId:randomUUID()}))),env:{ACTIVEKG_BASE_URL:'https://memory.invalid'}})).rejects.toMatchObject({code:'identity_conflict'});
 });
 it('rejects oversized receipt and origin paths',async()=>{
  const l=sample(),sign=vi.fn().mockResolvedValue('token');
  await expect(deliverProfile(l,new AbortController().signal,{sign,fetch:vi.fn().mockResolvedValue(new Response('x'.repeat(8193))),env:{ACTIVEKG_BASE_URL:'https://memory.invalid'}})).rejects.toMatchObject({code:'delivery_outcome_unknown'});
  await expect(deliverProfile(l,new AbortController().signal,{sign,env:{ACTIVEKG_BASE_URL:'https://memory.invalid/path'}})).rejects.toThrow();
 });
 it('rejects duplicate keys in owner reads instead of accepting the last value',async()=>{
  const view={schemaVersion:2,state:'draft',draftVersion:0,profileVersion:0,preferenceVersion:0,draftHash:null,
   draft:null,confirmedProfile:null,preferences:null,confirmedConsentVersion:0,missingFields:['profile','preferences'],sources:[],proposals:[],
   capabilities:{canEdit:true,editBlockedReason:null,canConfirm:false,confirmBlockedReason:'incomplete_profile',
    canEnrich:false,enrichBlockedReason:'feature_unavailable',canRequestResume:false,resumeBlockedReason:'feature_unavailable'},
   publicationActive:false,matchingState:'not_available'};
  const raw=JSON.stringify(view),sign=vi.fn().mockResolvedValue('token');
  const fetch=vi.fn().mockResolvedValue(new Response(raw));
  const options={sign,fetch,env:{ACTIVEKG_BASE_URL:'https://memory.invalid'}};
  expect(await readProfile(randomUUID(),randomUUID(),options)).toEqual(view);
  fetch.mockResolvedValueOnce(new Response(raw.replace('"draftVersion":0','"draftVersion":999,"draftVersion":0')));
  await expect(readProfile(randomUUID(),randomUUID(),options)).rejects.toMatchObject({code:'memory_unavailable'});
 });
 it('repository admits via exact routine with owner authority and no table access',async()=>{
  const id=randomUUID(),query=vi.fn().mockResolvedValue({rows:[{result:{schemaVersion:2,commandId:id,status:'pending'}}]}),privacy=vi.fn();
  const repo=profileRepository({query},privacy);
  expect((await repo.admit({userId:1,authVersion:0,passwordVersion:null,reauthenticatedAt:null},JSON.stringify(fixtures.draft_save))).commandId).toBe(id);
  expect(privacy).toHaveBeenCalledWith(1);expect(query).toHaveBeenCalledWith('SELECT public.flow_candidate_profile_admit($1,$2,$3,$4,$5,$6) AS result',expect.any(Array));
 });
 it('confirm requires recent authentication before database write',async()=>{
  const query=vi.fn(),repo=profileRepository({query},vi.fn());
  await expect(repo.admit({userId:1,authVersion:0,passwordVersion:null,reauthenticatedAt:null},JSON.stringify({...envelope,action:'confirm',payload:{draftHash:'a'.repeat(64),consentVersion:0}}))).rejects.toMatchObject({code:'recent_auth_required'});
  expect(query).not.toHaveBeenCalled();
 });
 it('database errors are mapped by exact safe message and SQLSTATE',async()=>{
  const query=vi.fn().mockRejectedValue({code:'P0002',message:'not_found'}),repo=profileRepository({query},vi.fn());
  await expect(repo.readCommand({userId:1,authVersion:0},randomUUID())).rejects.toMatchObject({status:404,code:'not_found'});
  query.mockRejectedValueOnce({code:'XX000',message:'private database internals'});
  await expect(repo.readCommand({userId:1,authVersion:0},randomUUID())).rejects.toMatchObject({status:503,code:'authority_unavailable'});
 });
});

const lease=(attemptCount=1):ProfileLease=>{
 const idempotencyKey=randomUUID();const parsed=parseProfileCommand(JSON.stringify({schemaVersion:2,idempotencyKey,expectedDraftVersion:0,expectedProfileVersion:0,expectedPreferenceVersion:0,
 action:'confirm',payload:{draftHash:'a'.repeat(64),consentVersion:0}}));
 return {commandId:randomUUID(),subjectId:randomUUID(),bindingId:randomUUID(),userId:1,authVersion:0,idempotencyKey,
 leaseToken:randomUUID(),leaseGeneration:1,attemptCount,body:parsed.canonical,hash:parsed.hash};
};
const receipt=(l:ProfileLease)=>({schemaVersion:2,commandId:l.commandId,subjectId:l.subjectId,bindingId:l.bindingId,commandHash:l.hash,
 status:'applied',draftVersion:1,profileVersion:1,preferenceVersion:1,reason:null,publicationActive:false});
const deps=(leases=[lease()])=>({enabled:()=>true,claim:vi.fn(async()=>leases),authority:vi.fn(async()=>{}),
 deliver:vi.fn(async(l:ProfileLease)=>receipt(l)),finish:vi.fn(async()=>{})});
it('disabled means no claims or startup polling',async()=>{
 vi.useFakeTimers();const d=deps();d.enabled=()=>false;expect(await runProfileBatch(d)).toBe(0);
 const stop=startProfileProcessor(d);await vi.advanceTimersByTimeAsync(1000);await stop();expect(d.claim).not.toHaveBeenCalled();
});
it('validates the immutable body before authority or dispatch',async()=>{
 const l=lease();l.hash='b'.repeat(64);const d=deps([l]);await runProfileBatch(d);
 expect(d.deliver).not.toHaveBeenCalled();expect(d.finish).toHaveBeenCalledWith(l,{state:'held',reason:'invalid_request'});
});
it('holds exhausted leases before sending',async()=>{
 const l=lease(13),d=deps([l]);await runProfileBatch(d);expect(d.deliver).not.toHaveBeenCalled();expect(d.finish).toHaveBeenCalledWith(l,{state:'held',reason:'retry_exhausted'});
});
it('automatically schedules the same command after transient authority failure',async()=>{
 const l=lease(),d=deps([l]);d.authority.mockRejectedValueOnce(Error('offline'));await runProfileBatch(d);
 expect(d.finish).toHaveBeenCalledWith(l,{state:'retry',reason:'authority_unavailable',delayMs:250});expect(d.deliver).not.toHaveBeenCalled();
});
it('rejects privacy restrictions without retries',async()=>{
 const l=lease(),d=deps([l]);d.authority.mockRejectedValueOnce({code:'candidate_privacy_restricted'});await runProfileBatch(d);
 expect(d.finish).toHaveBeenCalledWith(l,{state:'rejected',reason:'candidate_privacy_restricted'});
});
it('late authority reply never sends after total deadline',async()=>{
 vi.useFakeTimers();const l=lease(),d=deps([l]);let resolve!:()=>void;d.authority.mockImplementation(()=>new Promise<void>(r=>{resolve=r;}));
 const task=runProfileBatch(d);await vi.advanceTimersByTimeAsync(15001);await task;resolve();await Promise.resolve();
 expect(d.deliver).not.toHaveBeenCalled();expect(d.finish).toHaveBeenCalledTimes(1);
});
it('receipt for another identity is held, not applied',async()=>{
 const l=lease(),d=deps([l]);d.deliver.mockResolvedValueOnce({...receipt(l),bindingId:randomUUID()});await runProfileBatch(d);
 expect(d.finish).toHaveBeenCalledWith(l,{state:'held',reason:'identity_conflict'});
});
it('claims at most 20 and dispatches at most 4 concurrently',async()=>{
 const leases=Array.from({length:20},()=>lease()),d=deps(leases);let concurrent=0,max=0;
 d.deliver.mockImplementation(async l=>{concurrent++;max=Math.max(max,concurrent);await new Promise(r=>setTimeout(r,2));concurrent--;return receipt(l);});
 expect(await runProfileBatch(d)).toBe(20);expect(max).toBe(4);expect(d.claim).toHaveBeenCalledWith(20);expect(d.finish).toHaveBeenCalledTimes(20);
});
it('unknown finish commit is never blindly replayed in the processor',async()=>{
 const d=deps();d.finish.mockRejectedValueOnce(Error('lost response'));await expect(runProfileBatch(d)).rejects.toThrow('profile_finish_unavailable');expect(d.deliver).toHaveBeenCalledTimes(1);expect(d.finish).toHaveBeenCalledTimes(1);
});
it('slow delivery times out without accepting its late receipt',async()=>{
 vi.useFakeTimers();const l=lease(),d=deps([l]);let resolve!:(value:ReturnType<typeof receipt>)=>void;
 d.deliver.mockImplementation(()=>new Promise(r=>{resolve=r;}));
 const task=runProfileBatch(d);await vi.advanceTimersByTimeAsync(15001);await task;
 expect(d.finish).toHaveBeenCalledWith(l,{state:'retry',reason:'delivery_outcome_unknown',delayMs:250});
 resolve(receipt(l));await Promise.resolve();expect(d.finish).toHaveBeenCalledTimes(1);
});
it('finishes the other subjects even when one acknowledgement is lost',async()=>{
 const leases=Array.from({length:20},()=>lease()),d=deps(leases);
 d.finish.mockRejectedValueOnce(Error('lost acknowledgement'));
 await expect(runProfileBatch(d)).rejects.toThrow('profile_finish_unavailable');
 expect(d.deliver).toHaveBeenCalledTimes(20);expect(d.finish).toHaveBeenCalledTimes(20);
 expect(new Set(d.deliver.mock.calls.map(([l])=>l.commandId)).size).toBe(20);
});
it('shutdown waits for in-flight work and prevents another claim',async()=>{
 vi.useFakeTimers();const l=lease(),d=deps([l]);let resolve!:(value:ReturnType<typeof receipt>)=>void;
 d.deliver.mockImplementation(()=>new Promise(r=>{resolve=r;}));
 const stop=startProfileProcessor(d);await vi.advanceTimersByTimeAsync(0);
 expect(d.deliver).toHaveBeenCalledTimes(1);
 let stopped=false;const stopping=stop().then(()=>{stopped=true;});await Promise.resolve();expect(stopped).toBe(false);
 resolve(receipt(l));await stopping;await vi.advanceTimersByTimeAsync(1000);
 expect(d.claim).toHaveBeenCalledTimes(1);expect(d.finish).toHaveBeenCalledTimes(1);
});
