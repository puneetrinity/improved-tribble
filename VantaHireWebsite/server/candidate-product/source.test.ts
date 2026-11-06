import {describe,it,expect,vi,afterEach} from 'vitest';
import {lookupProfessionalProfile,deliverLookupTransfer,LookupDeliveryError} from './source-adapters';
import {LOOKUP_RESPONSE_BYTES,parseLookupResponse,normalizeLookupLinkedin,buildLookupTransfer} from './source-contracts';
import {validateLookupTransfer,validateResumeTransfer,validateSourceReceipt} from './spark-contracts';
import {canonicalProfileJson} from './profile-contracts';
import {runLookupAttempt,runLookupQueueOnce,startLookupQueue,type LookupDispatch} from './source-processor';
import {randomUUID} from 'node:crypto';
import {lookupRequestSchema,lookupStatusSchema} from '../../shared/candidate-spark-v3';
const email={kind:'email' as const,email:'synthetic@example.invalid'},url='https://linkedin.com/in/synthetic';
const profile={linkedinUrl:url,firstName:'Synthetic',lastName:'Person',skills:['Python'],experience:[{companyName:'Example',title:'Engineer',description:'Team of 3',startEndDate:{start:'2020',end:null}}],education:[],location:{country:'India',countryCode:'IN',city:null},email:'excluded',photoUrl:'excluded',recommendations:['excluded']};
const envelope=(data:unknown,credits=2)=>({success:true,error:null,data,quotas:{creditsConsumed:credits}});
const raw=()=>envelope({person:profile,isFullProfile:true,alternativePersons:[]});
const setup=(reply=()=>Promise.resolve(new Response(JSON.stringify(raw()))))=>{
 const fetch=vi.fn(reply);return {fetch,run:(input:unknown=email,signal?:AbortSignal)=>lookupProfessionalProfile(input,{apiKey:'synthetic-key',fetch:fetch as typeof globalThis.fetch,signal})};
};
afterEach(()=>vi.useRealTimers());
describe('durable lookup scheduler',()=>{
 const setupQueue=()=>{
  const work={attemptId:randomUUID(),userId:1,authVersion:1,token:randomUUID(),generation:1,attempts:1,stage:'transferring' as const};
  const deps={enabled:()=>true,claim:vi.fn(async()=>work),prepare:vi.fn(async()=>true),finish:vi.fn(async()=>true),purchase:vi.fn(async()=>{}),deliver:vi.fn(async()=>{})};
  return {work,deps};
 };
 it.each([401,403])('alerts operators without contacts or tokens on delivery HTTP %s',async status=>{
  const log=vi.spyOn(console,'error').mockImplementation(()=>{});
  try{const {work,deps}=setupQueue();deps.deliver.mockRejectedValue(new LookupDeliveryError(false,status));
   await runLookupQueueOnce(deps);
   expect(log.mock.calls).toEqual([['[candidate-lookup] operator_attention delivery_auth_refused',{status}]]);
   expect(deps.finish).toHaveBeenCalledWith(work,'delivery_refused');expect(deps.purchase).not.toHaveBeenCalled();
  }finally{log.mockRestore();}
 });
 it.each([[400,false],[401,false],[403,false],[404,false],[409,false],[422,false],[451,false],[408,true],[429,true],[500,true],[503,true]])('classifies HTTP %s without repurchasing',async(status,retryable)=>{
  const {work,deps}=setupQueue();deps.deliver.mockRejectedValue(new LookupDeliveryError(retryable,status));
  expect(await runLookupQueueOnce(deps)).toBe(1);
  expect(deps.finish).toHaveBeenCalledWith(work,retryable?'temporary':'delivery_refused');expect(deps.purchase).not.toHaveBeenCalled();
 });
 it('does no work when disabled or when a stale lease is refused',async()=>{
  const {deps}=setupQueue();expect(await runLookupQueueOnce({...deps,enabled:()=>false})).toBe(0);expect(deps.claim).not.toHaveBeenCalled();
  deps.prepare.mockResolvedValue(false);expect(await runLookupQueueOnce(deps)).toBe(0);expect(deps.deliver).not.toHaveBeenCalled();
 });
 it('holds privacy refusal and backs off an unknown network failure',async()=>{
  const {work,deps}=setupQueue();deps.deliver.mockRejectedValue(Object.assign(Error(),{code:'candidate_privacy_restricted'}));
  await runLookupQueueOnce(deps);expect(deps.finish).toHaveBeenLastCalledWith(work,'privacy_restricted');
  deps.deliver.mockRejectedValue(Error('timeout'));await runLookupQueueOnce(deps);expect(deps.finish).toHaveBeenLastCalledWith(work,'temporary');
 });
 it('shutdown waits for active work and prevents another tick',async()=>{
  vi.useFakeTimers();const {deps}=setupQueue();let release!:()=>void;
  deps.deliver.mockImplementation(()=>new Promise<void>(r=>{release=r;}));const stop=startLookupQueue(deps);
  await vi.advanceTimersByTimeAsync(0);let done=false;const stopped=stop().then(()=>{done=true;});expect(done).toBe(false);
  release();await stopped;await vi.advanceTimersByTimeAsync(5000);expect(deps.claim).toHaveBeenCalledOnce();
 });
});
describe('paid lookup to explicit professional-source proposal',()=>{
 const context=()=>({commandId:randomUUID(),subjectId:randomUUID(),bindingId:randomUUID(),sourceId:randomUUID(),sourceVersion:1,consentRevision:1,
  originalDraftVersion:0,originalProfileVersion:0,originalPreferenceVersion:0,originalPreferenceDraftRevision:0,expiresAt:'2030-01-01T00:00:00.000Z'});
 it('keeps an allowed photo as an optional review fact, never importing a legacy avatar',()=>{
  const photoUrl='https://media.licdn.com/dms/image/test?e=1234567890';
  const result=parseLookupResponse(JSON.stringify(envelope({person:{...profile,photoUrl},isFullProfile:true,alternativePersons:[]})),200,email);
  expect(result.person?.photoUrl).toBe(photoUrl);
  expect(buildLookupTransfer(result,context()).value.proposal.facts.find(f=>f.kind==='photo')?.value).toEqual({url:photoUrl});
 });
 it.each(['http://media.licdn.com/a','https://media.licdn.com.evil.test/a','https://evil.test/a',
  'https://user@media.licdn.com/a','https://media.licdn.com:443/a','https://media.licdn.com/a#fragment',
  'https://media.licdn.com/a\\evil','https://media.licdn.com/'+ 'a'.repeat(2048)])('drops an invalid photo without losing the paid profile: %s',photoUrl=>{
  const result=parseLookupResponse(JSON.stringify(envelope({person:{...profile,photoUrl},isFullProfile:true,alternativePersons:[]})),200,email);
  expect(result.person?.photoUrl).toBeUndefined();expect(result.person?.firstName).toBe('Synthetic');expect(result.partial).toBe(true);
 });
 it('builds deterministic review facts, preserving date precision without inventing a city or current job',()=>{
  const result=parseLookupResponse(JSON.stringify(raw()),200,email),c=context(),t=buildLookupTransfer(result,c);
  expect(buildLookupTransfer(result,c)).toEqual(t);
  expect(t.value.proposal.sourceKind).toBe('professional_lookup');
  // RC marks a current job with end:null (B4): a known start + end:null is current.
  expect(t.value.proposal.facts.find(f=>f.kind==='employment')?.value).toMatchObject({start:{value:'2020',precision:'year'},end:null,current:true});
  expect(t.value.proposal.facts.some(f=>f.kind==='currentLocation')).toBe(false);
  expect(t.canonical).not.toContain('excluded');
  expect(()=>validateResumeTransfer(t.value)).toThrow('source_mismatch');
  expect(validateLookupTransfer(t.value)).toEqual(t);
 });
 it('B4: reads RC ISO date-times at month precision and treats end:null as current only with a known start',()=>{
  const experience=[
   {companyName:'Now Co',title:'Engineer',description:'',startEndDate:{start:'2021-06-01T00:00:00.000Z',end:null}},
   {companyName:'Past Co',title:'Engineer',description:'',startEndDate:{start:'2018-01-01T00:00:00.000Z',end:'2021-05-01T00:00:00.000Z'}},
   {companyName:'Text Co',title:'Engineer',description:'',startEndDate:{start:'2016-03',end:'Present'}},
   {companyName:'Undated Co',title:'Engineer',description:'',startEndDate:{start:null,end:null}},
   {companyName:'Bad Co',title:'Engineer',description:'',startEndDate:{start:'June 2015',end:'2016-01-01T00:00:00+05:30'}},
  ];
  const result=parseLookupResponse(JSON.stringify(envelope({person:{...profile,experience},isFullProfile:true,alternativePersons:[]})),200,email);
  const t=buildLookupTransfer(result,context());
  const jobs=t.value.proposal.facts.filter(f=>f.kind==='employment').map(f=>f.value as {employer:string;start:unknown;end:unknown;current:boolean});
  const by=(e:string)=>jobs.find(j=>j.employer===e);
  expect(by('Now Co')).toMatchObject({start:{value:'2021-06',precision:'month'},end:null,current:true});
  expect(by('Past Co')).toMatchObject({start:{value:'2018-01',precision:'month'},end:{value:'2021-05',precision:'month'},current:false});
  expect(by('Text Co')).toMatchObject({start:{value:'2016-03',precision:'month'},end:null,current:true});
  expect(by('Undated Co')).toMatchObject({start:null,end:null,current:false});
  expect(by('Bad Co')).toMatchObject({start:null,end:{value:'2016-01',precision:'month'},current:false});
  expect(t.value.proposal.reviewNotes).toContain('Some dates were not precise enough to import; please enter them yourself.');
 });
 it('refuses a missing profile and preserves supported facts when a paid optional field is unusable',()=>{
  expect(()=>buildLookupTransfer({outcome:'not_found',creditsConsumed:0,person:null,alternativeCount:0,partial:false},context())).toThrow('lookup_has_no_profile');
  const result=parseLookupResponse(JSON.stringify(raw()),200,email);result.person!.experience![0]!.description='x'.repeat(5000);
  const t=buildLookupTransfer(result,context());
  expect(t.value.proposal.facts.find(f=>f.kind==='employment')?.value).toMatchObject({description:''});
  expect(t.value.proposal.facts.some(f=>f.kind==='skill')).toBe(true);
  expect(t.value.proposal.reviewNotes.length).toBeGreaterThan(0);
 });
 it('rejects relabelled résumé text, mismatched normalized evidence and mismatched receipts',()=>{
  const t=buildLookupTransfer(parseLookupResponse(JSON.stringify(raw()),200,email),context());
  expect(()=>validateLookupTransfer({...t.value,policyVersion:'resume-v1'})).toThrow('source_mismatch');
  const changed=structuredClone(t.value);changed.proposal.facts[0]!.value='invented';
  expect(()=>validateLookupTransfer(changed)).toThrow('lookup_evidence_mismatch');
  const receipt={schemaVersion:1,commandId:t.value.commandId,subjectId:t.value.subjectId,bindingId:t.value.bindingId,commandHash:t.hash,
   sourceId:t.value.sourceId,sourceVersion:1,proposalId:t.value.proposal.proposalId,proposalHash:t.value.proposal.proposalHash,
   outcome:'stored',reason:null,canonicalProfileChanged:false,publicationActive:false};
  expect(validateSourceReceipt(t.value,receipt,'professional_lookup')).toEqual(receipt);
  expect(()=>validateSourceReceipt(t.value,{...receipt,commandHash:'0'.repeat(64)},'professional_lookup')).toThrow('receipt_mismatch');
  expect(t.value.text).toBe(canonicalProfileJson(t.value.proposal.facts.map(f=>({kind:f.kind,value:f.value}))));
 });
 it('refuses altered persisted bytes before signing or sending',async()=>{
  const t=buildLookupTransfer(parseLookupResponse(JSON.stringify(raw()),200,email),context());
  const sign=vi.fn(),fetch=vi.fn();
  await expect(deliverLookupTransfer({canonical:t.canonical,sha256:'0'.repeat(64)},{sign,fetch})).rejects.toThrow('lookup_document_changed');
  expect(sign).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
 });
 it.each([[422,false],[503,true],[429,true]])('sender preserves HTTP %s retry classification',async(status,retryable)=>{
  const t=buildLookupTransfer(parseLookupResponse(JSON.stringify(raw()),200,email),context());
  await expect(deliverLookupTransfer({canonical:t.canonical,sha256:t.hash},{env:{ACTIVEKG_BASE_URL:'https://memory.example.invalid'},
   sign:async()=>'synthetic',fetch:async()=>new Response('',{status})})).rejects.toMatchObject({status,retryable});
 });
 it('includes signing in its one deadline and never sends after a late signature',async()=>{
  vi.useFakeTimers();const t=buildLookupTransfer(parseLookupResponse(JSON.stringify(raw()),200,email),context());
  let resolve!:(value:string)=>void;const fetch=vi.fn();
  const promise=deliverLookupTransfer({canonical:t.canonical,sha256:t.hash},{env:{ACTIVEKG_BASE_URL:'https://memory.example.invalid'},
   sign:()=>new Promise<string>(r=>{resolve=r;}),fetch});
  const rejected=expect(promise).rejects.toThrow('delivery_outcome_unknown');
  await vi.advanceTimersByTimeAsync(10000);await rejected;resolve('late');await Promise.resolve();
  expect(fetch).not.toHaveBeenCalled();
 });
 it('uses one no-redirect signed request and refuses an oversized receipt',async()=>{
  const t=buildLookupTransfer(parseLookupResponse(JSON.stringify(raw()),200,email),context());
  const fetch=vi.fn(async()=>new Response('x'.repeat(8193),{status:200}));
  await expect(deliverLookupTransfer({canonical:t.canonical,sha256:t.hash},{env:{ACTIVEKG_BASE_URL:'https://memory.example.invalid'},sign:async()=>'synthetic',fetch}))
   .rejects.toThrow('delivery_outcome_unknown');
  expect(fetch).toHaveBeenCalledOnce();expect(fetch.mock.calls[0]).toEqual(['https://memory.example.invalid/candidate-profiles/sources/lookup',
   expect.objectContaining({redirect:'error',body:t.canonical,headers:expect.objectContaining({'x-command-sha256':t.hash})})]);
 });
});
describe('browser lookup contract',()=>{
 it('takes identity from the session, not browser email or subject fields',()=>{
  const r={schemaVersion:1,idempotencyKey:randomUUID(),expectedConsentRevision:1,kind:'email'};
  expect(lookupRequestSchema.parse(r)).toEqual(r);
  for(const field of ['email','userId','subjectId','bindingId'])expect(lookupRequestSchema.safeParse({...r,[field]:'attacker'}).success).toBe(false);
  expect(lookupRequestSchema.parse({...r,kind:'linkedin',url:'http://in.linkedin.com/in/John-Doe?utm=x'})).toMatchObject({url:'https://linkedin.com/in/john-doe'});
 });
 it('cannot claim review-ready before a proposal exists or offer fallback while held',()=>{
  const status={schemaVersion:1,attemptId:randomUUID(),state:'held',reason:'outcome_unknown',proposalId:null,canRequestLinkedin:false,waitLimitMs:20000};
  expect(lookupStatusSchema.safeParse(status).success).toBe(true);
  expect(lookupStatusSchema.safeParse({...status,canRequestLinkedin:true}).success).toBe(false);
  expect(lookupStatusSchema.safeParse({...status,state:'review_ready',reason:null}).success).toBe(false);
 });
});
describe('lookup dispatch boundary (fake journal; production repository still required)',()=>{
 const worker=()=>{
  const grant:LookupDispatch={attemptId:randomUUID(),dispatchId:randomUUID(),subjectId:randomUUID(),bindingId:randomUUID(),consentRevision:1,operation:email};
  const result=parseLookupResponse(JSON.stringify(raw()),200,email);
  const deps={enabled:()=>true,beginDispatch:vi.fn(async()=>grant as LookupDispatch|null),refuseUnsent:vi.fn(async()=>{}),cancelUnsent:vi.fn(async()=>{}),lookup:vi.fn(async()=>result),settle:vi.fn(async()=>{}),hold:vi.fn(async()=>{})};
  return {grant,result,deps};
 };
 it('waits for committed dispatch permission before the paid request',async()=>{
  const {grant,deps}=worker();let commit!:(g:LookupDispatch)=>void;
  deps.beginDispatch.mockImplementation(()=>new Promise(resolve=>{commit=resolve;}));
  const active=runLookupAttempt(grant.attemptId,deps);await Promise.resolve();expect(deps.lookup).not.toHaveBeenCalled();
  commit(grant);expect(await active).toBe('settled');expect(deps.lookup).toHaveBeenCalledOnce();
 });
 it('does not dispatch on an unknown journal commit',async()=>{
  const {grant,deps}=worker();deps.beginDispatch.mockRejectedValue(Error('commit_unknown'));
  await expect(runLookupAttempt(grant.attemptId,deps)).rejects.toThrow('commit_unknown');expect(deps.lookup).not.toHaveBeenCalled();
 });
 it('lost settlement never repeats the paid call on replay',async()=>{
  const {grant,deps}=worker();deps.beginDispatch.mockResolvedValueOnce(grant).mockResolvedValue(null);deps.settle.mockRejectedValue(Error('lost_reply'));
  expect(await runLookupAttempt(grant.attemptId,deps)).toBe('held');expect(deps.hold).toHaveBeenCalledWith(grant,'settlement_uncertain',2);
  expect(await runLookupAttempt(grant.attemptId,deps)).toBe('no_dispatch');expect(deps.lookup).toHaveBeenCalledOnce();
 });
 it('holds an uncertain provider call without a fallback',async()=>{
  const {grant,deps}=worker();deps.lookup.mockRejectedValue(Error('timeout'));
  expect(await runLookupAttempt(grant.attemptId,deps)).toBe('held');expect(deps.hold).toHaveBeenCalledWith(grant,'dispatch_uncertain',null);expect(deps.settle).not.toHaveBeenCalled();
 });
 it('holds after a failed cancellation without calling the provider',async()=>{
  const {grant,deps}=worker();
  deps.beginDispatch.mockImplementation(async()=>{deps.enabled=()=>false;return grant;});
  deps.cancelUnsent.mockRejectedValue(Error('cancel_failed'));
  expect(await runLookupAttempt(grant.attemptId,deps)).toBe('held');
  expect(deps.hold).toHaveBeenCalledWith(grant,'disabled_after_reservation',null);
  expect(deps.lookup).not.toHaveBeenCalled();
 });
 it('surfaces cancellation and hold failure without pretending recovery succeeded',async()=>{
  const {grant,deps}=worker();
  deps.beginDispatch.mockImplementation(async()=>{deps.enabled=()=>false;return grant;});
  deps.cancelUnsent.mockRejectedValue(Error('commit_unknown'));
  deps.hold.mockRejectedValue(Error('invalid_dispatch'));
  await expect(runLookupAttempt(grant.attemptId,deps)).rejects.toThrow('invalid_dispatch');
  expect(deps.lookup).not.toHaveBeenCalled();
 });
 it('refuses a mismatched grant and switch-off after reservation',async()=>{
  const {grant,deps}=worker();deps.beginDispatch.mockResolvedValue({...grant,attemptId:randomUUID()});
  await expect(runLookupAttempt(grant.attemptId,deps)).rejects.toThrow('invalid_dispatch_grant');expect(deps.lookup).not.toHaveBeenCalled();
  expect(deps.refuseUnsent).toHaveBeenCalledWith(grant.attemptId);expect(deps.hold).not.toHaveBeenCalled();
  deps.beginDispatch.mockImplementation(async()=>{deps.enabled=()=>false;return grant;});
  expect(await runLookupAttempt(grant.attemptId,deps)).toBe('disabled');expect(deps.lookup).not.toHaveBeenCalled();expect(deps.cancelUnsent).toHaveBeenCalledWith(grant);
 });
});
describe('candidate profile lookup: synthetic only, no runtime dispatch',()=>{
 it('sends only email in one request; keeps skills/evidence but strips unrelated personal fields',async()=>{
  const {fetch,run}=setup();const r=await run();expect(r.outcome).toBe('partial');expect(r.person?.skills).toEqual(['Python']);
  expect(r.person?.experience?.[0]?.description).toBe('Team of 3');expect(r.person?.location?.city).toBeNull();
  expect(JSON.stringify(r)).not.toContain('excluded');expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0]).toEqual(['https://api.reversecontact.com/v2/enrich/persons',expect.objectContaining({redirect:'error',body:JSON.stringify({email:email.email})})]);
 });
 it('fetches the explicit LinkedIn URL with no enrichment chain',async()=>{
  const {run,fetch}=setup(()=>Promise.resolve(new Response(JSON.stringify(envelope(profile,1)))));
  expect((await run({kind:'linkedin',url:'https://www.linkedin.com/in/synthetic/'})).person?.linkedinUrl).toBe(url);
  expect(fetch).toHaveBeenCalledOnce();expect(fetch.mock.calls[0]?.[0]).toBe('https://api.reversecontact.com/v2/fetch/persons');
 });
 it('keeps light responses partial and never buys missing fields',async()=>{
  const x=raw();x.data.isFullProfile=false;delete (x.data.person as Partial<typeof profile>).skills;
  const {run,fetch}=setup(()=>Promise.resolve(new Response(JSON.stringify(x))));expect((await run()).outcome).toBe('partial');expect(fetch).toHaveBeenCalledOnce();
 });
 it('marks alternatives ambiguous without storing their profiles',()=>{
  const x=raw();(x.data.alternativePersons as unknown[])=[{email:'other-person-private'}];
  const r=parseLookupResponse(JSON.stringify(x),200,email);expect(r.outcome).toBe('ambiguous');expect(r.alternativeCount).toBe(1);expect(JSON.stringify(r)).not.toContain('other-person');
 });
 it('accepts only explicit structured zero-credit misses',async()=>{
  const miss={success:false,error:'REQUEST_ERROR',data:null,quotas:{creditsConsumed:0}};
  const {run}=setup(()=>Promise.resolve(new Response(JSON.stringify(miss),{status:404})));expect((await run()).outcome).toBe('not_found');
  expect(()=>parseLookupResponse(JSON.stringify({...miss,quotas:{creditsConsumed:1}}),404,email)).toThrow('invalid_response');
 });
 it.each([301,401,403,429,500,503])('does not infer free failure or retry HTTP %s',async status=>{
  const {run,fetch}=setup(()=>Promise.resolve(new Response('secret upstream body',{status})));
  await expect(run()).rejects.toMatchObject({code:'outcome_unknown',dispatched:true});expect(fetch).toHaveBeenCalledOnce();
 });
 it('retains observed credit breach without exposing raw provider data',async()=>{
  const {run}=setup(()=>Promise.resolve(new Response(JSON.stringify({...raw(),quotas:{creditsConsumed:3}}))));
  await expect(run()).rejects.toMatchObject({code:'credits_breach',observedCredits:3,dispatched:true});
 });
 it('rejects a different LinkedIn identity',async()=>{
  const {run}=setup(()=>Promise.resolve(new Response(JSON.stringify(envelope({...profile,linkedinUrl:url+'-other'},1)))));
  await expect(run({kind:'linkedin',url})).rejects.toMatchObject({code:'identity_mismatch'});
 });
 it.each(['https://evil.invalid/in/test','https://linkedin.com.evil.invalid/in/test','https://evil.linkedin.com/in/test','https://user:secret@linkedin.com/in/test','ftp://linkedin.com/in/test','https://linkedin.com:444/in/test','https://linkedin.com/company/test','https://linkedin.com/in/%2ftest'])('refuses unsafe URL %s before dispatch',async value=>{
  const {run,fetch}=setup();await expect(run({kind:'linkedin',url:value})).rejects.toMatchObject({dispatched:false});expect(fetch).not.toHaveBeenCalled();
 });
 it.each(['https://linkedin.com/in/John-Doe','linkedin.com/in/John-Doe/','http://www.linkedin.com/in/John-Doe?utm=x#about','https://in.linkedin.com/in/John-Doe','https://linkedin.com/pub/John-Doe/12/34/56'])('normalizes pasted identity %s before charge and comparison',async input=>{
  const {run,fetch}=setup(()=>Promise.resolve(new Response(JSON.stringify(envelope({...profile,linkedinUrl:'https://www.linkedin.com/in/john-doe/'},1)))));
  const result=await run({kind:'linkedin',url:input});expect(result.person?.linkedinUrl).toBe('https://linkedin.com/in/john-doe');
  expect(normalizeLookupLinkedin(input)).toBe('https://linkedin.com/in/john-doe');
  expect((fetch.mock.calls[0]?.[1] as RequestInit).body).toBe(JSON.stringify({url:'https://linkedin.com/in/john-doe'}));
 });
 it('drops a blank skill but retains a charged profile, its valid evidence and partial marker',async()=>{
  const x=raw();x.data.person={...profile,skills:['Go','','  ', 'Python']};
  const {run,fetch}=setup(()=>Promise.resolve(new Response(JSON.stringify(x))));const result=await run();
  expect(result).toMatchObject({outcome:'partial',partial:true,creditsConsumed:2});expect(result.person?.skills).toEqual(['Go','Python']);
  expect(result.person?.experience?.[0]?.description).toBe('Team of 3');expect(fetch).toHaveBeenCalledOnce();
 });
 it('drops NUL fields without discarding a paid profile; malformed Unicode fails at the envelope',()=>{
  const x=raw();x.data.person={...profile,skills:['Go','bad\u0000skill'],headline:'bad\u0000headline'};
  const r=parseLookupResponse(JSON.stringify(x),200,email);
  expect(r).toMatchObject({partial:true,creditsConsumed:2});expect(r.person?.skills).toEqual(['Go']);
  expect(r.person).not.toHaveProperty('headline');
  x.data.person.skills=['bad\ud800skill'];expect(()=>parseLookupResponse(JSON.stringify(x),200,email)).toThrow('invalid_response');
 });
 it('scrubs contact text from professional fields without removing LinkedIn identity',()=>{
  const x=raw();x.data.person={...profile,headline:'Email private@example.com',summary:'Phone: +91 98765 43210',experience:[{...profile.experience[0],description:'Contact private@example.com'}]};
  const r=parseLookupResponse(JSON.stringify(x),200,email);
  expect(r.partial).toBe(true);expect(JSON.stringify(r)).not.toContain('private@example.com');expect(JSON.stringify(r)).not.toContain('98765');
  expect(r.person?.linkedinUrl).toBe(url);expect(r.creditsConsumed).toBe(2);
 });
 it('salvages independent fields, nested locations and history rows without trusting malformed identity',()=>{
  const data={...profile,headline:42,location:{city:7,country:'India',countryCode:'IN'},experience:[null,{title:'Engineer',companyName:'Example',description:42},'junk'],education:[]};
  const result=parseLookupResponse(JSON.stringify(envelope({person:data,isFullProfile:true,alternativePersons:[]})),200,email);
  expect(result.partial).toBe(true);expect(result.person).not.toHaveProperty('headline');expect(result.person?.location).toEqual({country:'India',countryCode:'IN'});
  expect(result.person?.experience).toEqual([{title:'Engineer',companyName:'Example'}]);
  expect(()=>parseLookupResponse(JSON.stringify(envelope({person:{...data,linkedinUrl:42},isFullProfile:true,alternativePersons:[]})),200,email)).toThrow('invalid_response');
 });
 it('retains ambiguity AND partial quality when an alternative exists',()=>{
  const x=raw();x.data.person={...profile,skills:['Go','']};(x.data.alternativePersons as unknown[])=[{}];
  expect(parseLookupResponse(JSON.stringify(x),200,email)).toMatchObject({outcome:'ambiguous',partial:true,alternativeCount:1});
 });
 it('waits the full 20 seconds, aborts and never resends even if fetch ignores abort',async()=>{
  vi.useFakeTimers();const {run,fetch}=setup(()=>new Promise<Response>(()=>{}));const check=expect(run()).rejects.toMatchObject({code:'deadline',dispatched:true});
  await vi.advanceTimersByTimeAsync(19_999);expect(fetch).toHaveBeenCalledOnce();await vi.advanceTimersByTimeAsync(1);await check;
  expect((fetch.mock.calls[0]?.[1] as RequestInit).signal?.aborted).toBe(true);
 });
 it('uses the same total deadline while the response body stalls',async()=>{
  vi.useFakeTimers();const {run}=setup(()=>Promise.resolve(new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{'));}}))));
  const check=expect(run()).rejects.toMatchObject({code:'deadline',dispatched:true});await vi.advanceTimersByTimeAsync(20_000);await check;
 });
 it('refuses oversized response and duplicate JSON keys',async()=>{
  const a=setup(()=>Promise.resolve(new Response('x',{headers:{'content-length':String(LOOKUP_RESPONSE_BYTES+1)}})));
  await expect(a.run()).rejects.toMatchObject({code:'invalid_response'});
  expect(()=>parseLookupResponse(JSON.stringify(raw()).replace('"success":true','"success":false,"success":true'),200,email)).toThrow('invalid_response');
 });
 it('honours cancellation before dispatch and sanitizes native failures',async()=>{
  const controller=new AbortController();controller.abort();const {run,fetch}=setup();await expect(run(email,controller.signal)).rejects.toMatchObject({dispatched:false});expect(fetch).not.toHaveBeenCalled();
  const failing=setup(()=>Promise.reject(Error('key-and-email-must-not-leak')));await expect(failing.run()).rejects.toMatchObject({message:'outcome_unknown',dispatched:true});
 });
});
