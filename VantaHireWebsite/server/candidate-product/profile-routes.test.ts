import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import type {Express} from 'express';
const deps=vi.hoisted(()=>({interpret:vi.fn(),interpretRead:vi.fn(),interpretDeliver:vi.fn(),owner:vi.fn(),admit:vi.fn(),readCommand:vi.fn(),readProfile:vi.fn(),readSparkProfile:vi.fn(),readSourceProposal:vi.fn(),consentRead:vi.fn(),resolution:vi.fn(),sourceSnapshot:vi.fn(),lookupAdmit:vi.fn(),lookupStatus:vi.fn(),lookupActor:vi.fn()}));
vi.mock('./interpretation',async original=>({...await original<typeof import('./interpretation')>(),interpretCandidateText:deps.interpret,interpretationJournal:()=>({})}));
vi.mock('./source-repository',async original=>({...await original<typeof import('./source-repository')>(),sourceObjectDependencies:()=>({snapshot:deps.sourceSnapshot}),
 lookupRepository:(_db:unknown,_privacy:unknown,actor:unknown)=>{deps.lookupActor(actor);return {admit:deps.lookupAdmit,status:deps.lookupStatus};}}));
vi.mock('../db',()=>({pool:{query:vi.fn().mockResolvedValue({rows:[]})}}));
vi.mock('../auth',()=>({requireVerifiedCandidate:(req:any,res:any,next:()=>void)=>{
 if(req.user?.role==='candidate'&&req.user.emailVerified)next();else res.status(403).json({code:'verified_candidate_required'});
}}));
vi.mock('../candidate-consent/repository',()=>({recentConsentAuth:(at:number)=>at===123}));
vi.mock('../candidate-privacy/decision',()=>({requireCandidatePrivacyAllowed:vi.fn(),CandidatePrivacyRestrictedError:class extends Error{constructor(public code:string){super(code);}}}));
vi.mock('./profile-repository',async original=>({...await original<typeof import('./profile-repository')>(),profileRepository:()=>deps}));
vi.mock('./profile-client',async original=>({...await original<typeof import('./profile-client')>(),readProfile:deps.readProfile,readSparkProfile:deps.readSparkProfile,readSourceProposal:deps.readSourceProposal,
 readInterpretationProposal:deps.interpretRead,deliverInterpretationProposal:deps.interpretDeliver,
 readNetworkStatus:vi.fn().mockImplementation(async()=>({schemaVersion:1,publicationActive:false,blockedReason:'confirmation_required'}))}));
vi.mock('./consent-v2',async original=>({...await original<typeof import('./consent-v2')>(),consentV2Repository:()=>({read:deps.consentRead})}));
import {registerCandidateProfileRoutes,registerCandidateResumeRoutes} from './routes';
import {ProfileRepositoryError} from './profile-repository';
import {readNetworkStatus} from './profile-client';
import {CandidatePrivacyRestrictedError} from '../candidate-privacy/decision';
const chains=new Map<string,Array<(req:any,res:any,next:()=>void)=>unknown>>();
registerCandidateProfileRoutes({get:(p:string,...h:any[])=>chains.set(`GET ${p}`,h),post:(p:string,...h:any[])=>chains.set(`POST ${p}`,h)} as unknown as Express,
 (req:any,res,next)=>{if(req.csrf)next();else res.status(403).json({code:'csrf_required'});});
const base='/api/candidate/product/profile',key='11111111-1111-4111-8111-111111111111';
const resumeChains=new Map<string,Array<(req:any,res:any,next:()=>void)=>unknown>>();
registerCandidateResumeRoutes({get:(p:string,...h:any[])=>resumeChains.set(`GET ${p}`,h),post:(p:string,...h:any[])=>resumeChains.set(`POST ${p}`,h)} as unknown as Express,
 (req:any,res,next)=>{if(req.csrf)next();else res.status(403).json({code:'csrf_required'});});
const command={schemaVersion:2,idempotencyKey:key,expectedDraftVersion:0,expectedProfileVersion:0,expectedPreferenceVersion:0,
 action:'save_draft',payload:{profile:{displayName:'Synthetic',headline:'',linkedinUrl:null,currentLocation:null,skills:[],employment:[],education:[],projects:[]}}};
async function request(path:string,change:Record<string,unknown>={}){
 const req={user:{id:7,authVersion:3,role:'candidate',emailVerified:true,password:'unused'},
 session:{privacyReauthenticatedAt:123,privacyPasswordVersion:'a'.repeat(64)},query:{},params:{id:key},headers:{},csrf:true,is:()=>true,
 rawBody:JSON.stringify(command),...change};
 const res={statusCode:200,body:undefined as any,headers:{} as Record<string,unknown>,setHeader(k:string,v:string){this.headers[k]=v;},
 status(n:number){this.statusCode=n;return this;},json(v:unknown){this.body=v;return this;}};
 for(const fn of (chains.get(path)??resumeChains.get(path))!){let next=false;await fn(req,res,()=>{next=true;});if(!next)break;}
 return res;
}
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv('CANDIDATE_FOUNDATION_ENABLED','true');vi.stubEnv('CANDIDATE_PROFILE_ENABLED','true');
 deps.owner.mockResolvedValue({subjectId:key,bindingId:key,pendingCommands:[],hasMorePendingCommands:false});
 deps.readProfile.mockResolvedValue({schemaVersion:2,draft:null,capabilities:{canConfirm:true,confirmBlockedReason:null},publicationActive:false});
 deps.admit.mockResolvedValue({schemaVersion:2,commandId:key,status:'pending'});
});
afterEach(()=>vi.unstubAllEnvs());
describe('P6 owner interpretation routes',()=>{
 const post='POST /api/candidate/product/interpretations';
 const rawBody=JSON.stringify({schemaVersion:1,idempotencyKey:key,expectedDraftVersion:0,expectedProfileVersion:0,
  expectedPreferenceVersion:0,expectedPreferenceDraftRevision:0,use:'change_preferences',text:'Prefer permanent employment',
  sourceProposalId:null,sourceVersion:null,targetRowId:null});
 const enabled=()=>{
  for(const flag of ['CANDIDATE_PROFILE_DELIVERY_ENABLED','CANDIDATE_CONSENT_V2_DELIVERY_ENABLED','CANDIDATE_SPARK_ENABLED','CANDIDATE_INTERPRETATION_ENABLED'])vi.stubEnv(flag,'true');
  deps.readSparkProfile.mockResolvedValue({draftVersion:0,profileVersion:0,preferenceVersion:0,preferenceDraft:null});
  deps.consentRead.mockResolvedValue({desiredAction:'grant',acknowledgedAction:'grant',desiredSchemaVersion:2,acknowledgedSchemaVersion:2,
   consentRevision:1,acknowledgedRevision:1,deliveryStatus:'delivered'});
  deps.interpret.mockResolvedValue({schemaVersion:1,status:'cannot_help',reason:'budget_unavailable'});
 };
 it('is off by default and returns configured budget refusal without a Memory write',async()=>{
  expect((await request(post,{rawBody})).statusCode).toBe(404);enabled();
  const response=await request(post,{rawBody});expect(response.statusCode).toBe(200);
  expect(response.body.reason).toBe('budget_unavailable');expect(response.headers['Cache-Control']).toBe('no-store');
  expect(deps.interpretDeliver).not.toHaveBeenCalled();
 });
 it('requires verified ownership, CSRF and recent sign-in before paid work',async()=>{
  enabled();for(const change of [{csrf:false},{session:{}},{user:null},{user:{role:'recruiter',emailVerified:true}}])
   expect((await request(post,{rawBody,...change})).statusCode).toBe(403);
  expect(deps.interpret).not.toHaveBeenCalled();
 });
 it('rejects browser identity fields and duplicate input',async()=>{
  enabled();for(const raw of [JSON.stringify({...JSON.parse(rawBody),subjectId:key}),'{"schemaVersion":1,"schemaVersion":1}',' '.repeat(32769)])
   expect((await request(post,{rawBody:raw})).statusCode).toBe(422);
  expect(deps.interpret).not.toHaveBeenCalled();
 });
 it('blocks pending saves and unapplied consent before invoking the model',async()=>{
  enabled();deps.owner.mockResolvedValueOnce({subjectId:key,bindingId:key,pendingCommands:[{}],hasMorePendingCommands:false});
  expect((await request(post,{rawBody})).body.code).toBe('pending_changes');
  deps.consentRead.mockResolvedValue({desiredAction:'withdraw'});
  expect((await request(post,{rawBody})).body.code).toBe('consent_required');expect(deps.interpret).not.toHaveBeenCalled();
 });
 it.each(['stale_edit','idempotency_conflict'])('returns a clear 409 for %s without delivery',async code=>{
  enabled();deps.interpret.mockRejectedValue(new Error(code));
  const response=await request(post,{rawBody});expect(response.statusCode).toBe(409);expect(response.body.code).toBe(code);
  expect(deps.interpretDeliver).not.toHaveBeenCalled();
 });
 it('does not expose a proposal when Memory refuses to store it',async()=>{
  enabled();deps.interpret.mockResolvedValue({schemaVersion:1,status:'proposal',proposalId:key});
  deps.interpretDeliver.mockResolvedValue({outcome:'rejected',reason:'consent_changed'});
  const response=await request(post,{rawBody});expect(response.statusCode).toBe(409);expect(response.body.code).toBe('consent_changed');
 });
});
describe('RC owner routes',()=>{
 const post='POST /api/candidate/product/lookups',get='GET /api/candidate/product/lookups/:attemptId';
 const rawBody=JSON.stringify({schemaVersion:1,idempotencyKey:key,expectedConsentRevision:1,kind:'email'});
 const enabled=()=>{for(const flag of ['CANDIDATE_PROFILE_DELIVERY_ENABLED','CANDIDATE_CONSENT_V2_DELIVERY_ENABLED','CANDIDATE_SPARK_ENABLED','CANDIDATE_LOOKUP_SOURCE_ENABLED'])vi.stubEnv(flag,'true');vi.stubEnv('CANDIDATE_RC_API_KEY','synthetic-key');};
 it('is dark by default and queues only session-owned requests without calling RC',async()=>{
  expect((await request(post,{rawBody})).statusCode).toBe(404);expect(deps.lookupAdmit).not.toHaveBeenCalled();enabled();
  deps.lookupAdmit.mockResolvedValue({state:'queued'});const r=await request(post,{rawBody});expect(r.statusCode).toBe(202);
  expect(r.headers['Cache-Control']).toBe('no-store');expect(deps.lookupActor).toHaveBeenCalledWith({userId:7,authVersion:3});
  expect(deps.lookupAdmit).toHaveBeenCalledWith(rawBody);
 });
 it('requires verification, CSRF and recent authentication',async()=>{
  enabled();for(const change of [{csrf:false},{session:{}},{user:null},{user:{role:'candidate',emailVerified:false}}])
   expect((await request(post,{rawBody,...change})).statusCode).toBe(403);
  expect(deps.lookupAdmit).not.toHaveBeenCalled();
 });
 it('rejects duplicate fields, contacts, oversized bodies and query identities',async()=>{
  enabled();for(const rawBody of ['{"kind":"email","kind":"email"}',JSON.stringify({schemaVersion:1,idempotencyKey:key,expectedConsentRevision:1,kind:'email',email:'other@example.invalid'}),' '.repeat(4097)])
   expect((await request(post,{rawBody})).statusCode).toBe(422);
  expect((await request(post,{rawBody,query:{userId:99}})).statusCode).toBe(422);expect(deps.lookupAdmit).not.toHaveBeenCalled();
 });
 it('status never queues work and returns safe errors only',async()=>{
  enabled();deps.lookupStatus.mockResolvedValue({state:'running'});
  expect((await request(get,{params:{attemptId:key}})).statusCode).toBe(200);expect(deps.lookupAdmit).not.toHaveBeenCalled();
  expect((await request(get,{params:{attemptId:key},headers:{'content-length':'2'}})).statusCode).toBe(400);
  deps.lookupStatus.mockRejectedValue(Object.assign(Error('not_found'),{code:'P0002'}));
  expect((await request(get,{params:{attemptId:key}})).statusCode).toBe(404);
  deps.lookupStatus.mockRejectedValue(Error('private SQL details'));expect((await request(get,{params:{attemptId:key}})).body).toEqual({code:'lookup_temporarily_unavailable'});
 });
});
describe('P0 mounted resume routes',()=>{
 const path='POST /api/candidate/product/sources/resume-snapshots';
 const rawBody=JSON.stringify({schemaVersion:1,idempotencyKey:key,resumeId:9});
 const enabled=()=>{for(const flag of ['CANDIDATE_PROFILE_DELIVERY_ENABLED','CANDIDATE_CONSENT_V2_DELIVERY_ENABLED','CANDIDATE_SPARK_ENABLED','CANDIDATE_RESUME_SOURCE_ENABLED'])vi.stubEnv(flag,'true');};
 it('allows résumé reading with a valid older session',async()=>{
  enabled();
  expect((await request(path,{rawBody,session:{privacyReauthenticatedAt:0}})).statusCode).toBe(200);
  expect(deps.sourceSnapshot).toHaveBeenCalled();
 });
 it('reads a proposal using session identity only and checks ownership again before replying',async()=>{
  enabled();deps.readSourceProposal.mockResolvedValue({proposalId:key});
  const result=await request('GET /api/candidate/product/sources/:sourceId/proposals/:proposalId',{params:{sourceId:key,proposalId:key}});
  expect(result.statusCode).toBe(200);expect(result.headers['Cache-Control']).toBe('no-store');
  expect(deps.readSourceProposal).toHaveBeenCalledWith(key,key,key,key);expect(deps.owner).toHaveBeenCalledTimes(2);
 });
 it('reports an unavailable stored proposal as non-retryable, not a service outage',async()=>{
  enabled();const {ProfileTransportError}=await import('./profile-client');
  deps.readSourceProposal.mockRejectedValue(new ProfileTransportError('source_proposal_unavailable'));
  const result=await request('GET /api/candidate/product/sources/:sourceId/proposals/:proposalId',{params:{sourceId:key,proposalId:key}});
  expect(result.statusCode).toBe(404);expect(result.body).toEqual({code:'source_proposal_unavailable',retryable:false});
 });
 it('does not return a proposal after the source switch is turned off mid-read',async()=>{
  enabled();deps.readSourceProposal.mockImplementation(async()=>{vi.stubEnv('CANDIDATE_RESUME_SOURCE_ENABLED','false');return {proposalId:key};});
  expect((await request('GET /api/candidate/product/sources/:sourceId/proposals/:proposalId',{params:{sourceId:key,proposalId:key}})).statusCode).toBe(409);
 });
 it('is dark with Spark saving enabled but no source switch',async()=>{
  enabled();vi.stubEnv('CANDIDATE_RESUME_SOURCE_ENABLED','false');
  expect((await request(path,{rawBody})).statusCode).toBe(404);
  expect(deps.owner).not.toHaveBeenCalled();expect(deps.sourceSnapshot).not.toHaveBeenCalled();
 });
 it.each([
  ['unverified',{user:{id:7,role:'candidate',emailVerified:false}},403],
  ['CSRF',{csrf:false},403],
 ])('refuses %s before reading a source',async(_name,change,code)=>{
  enabled();expect((await request(path,{rawBody,...change})).statusCode).toBe(code);
  expect(deps.sourceSnapshot).not.toHaveBeenCalled();
 });
 it('binds snapshot to session user and server-owned subject/binding',async()=>{
  enabled();deps.sourceSnapshot.mockResolvedValue({schemaVersion:1,sourceId:key,sourceVersion:1,contentHash:'a'.repeat(64)});
  const res=await request(path,{rawBody});expect(res.statusCode).toBe(200);
  expect(res.headers['Cache-Control']).toBe('no-store');
  expect(deps.owner).toHaveBeenCalledWith({userId:7,authVersion:3});
  expect(deps.sourceSnapshot).toHaveBeenCalledWith({userId:7,subjectId:key,bindingId:key},JSON.parse(rawBody));
 });
});
describe('S2 registered owner routes',()=>{
 const enableSpark=()=>{
  for(const flag of ['CANDIDATE_PROFILE_DELIVERY_ENABLED','CANDIDATE_CONSENT_V2_DELIVERY_ENABLED','CANDIDATE_SPARK_ENABLED','CANDIDATE_INTERPRETATION_ENABLED'])vi.stubEnv(flag,'true');
  deps.readSparkProfile.mockResolvedValue({schemaVersion:3,draftVersion:1,profileVersion:0,preferenceVersion:1,
   draft:{...command.payload.profile,currentLocation:{city:'Pune',countryCode:'IN',displayCountry:'India'},skills:['TypeScript']},
   confirmedProfile:null,preferences:null,publicationActive:false,preferenceDraft:{preferenceDraftRevision:2,preferenceDraftHash:'a'.repeat(64),
    sections:Object.fromEntries(['roles','location','arrangement','relocation','employment_types','availability','compensation'].map(s=>[s,{answered:true,value:[]}])) ,
    exclusions:[],promotedPreferenceVersion:1,promotedDraftRevision:2}});
  deps.consentRead.mockResolvedValue({schemaVersion:2,consentRevision:3,desiredAction:'grant',acknowledgedRevision:3,acknowledgedAction:'grant',
   desiredSchemaVersion:2,acknowledgedSchemaVersion:2,deliveryStatus:'delivered'});
 };
 it('loads v3 saved answers, versions and current consent without publishing or falling back',async()=>{
  enableSpark();const response=await request(`GET ${base}`);
  expect(response.statusCode).toBe(200);expect(response.headers['Cache-Control']).toBe('no-store');
  expect(response.body).toMatchObject({schemaVersion:3,effectiveConsentRevision:3,publicationActive:false,
   preferenceDraft:{preferenceDraftRevision:2},missingFields:[],capabilities:{canConfirm:true,canDiscover:false,canMatch:false}});
  expect(response.body.draftHash).toMatch(/^[0-9a-f]{64}$/);expect(deps.readProfile).not.toHaveBeenCalled();
  expect(deps.readSparkProfile).toHaveBeenCalledWith(key,key);expect(deps.consentRead).toHaveBeenCalledWith({userId:7,authVersion:3});
  expect(response.body).not.toHaveProperty('subjectId');expect(response.body).not.toHaveProperty('bindingId');
 });
 it.each(['confirmation_required','publication_pending','publication_held'] as const)('reports authoritative discovery reason %s without guessing',async blockedReason=>{
  enableSpark();vi.stubEnv('CANDIDATE_NETWORK_SOURCING_ENABLED','true');
  vi.mocked(readNetworkStatus).mockResolvedValue({schemaVersion:1,publicationActive:false,blockedReason});
  expect((await request(`GET ${base}`)).body.capabilities).toMatchObject({canDiscover:false,discoveryBlockedReason:blockedReason});
  const consent=await deps.consentRead();deps.consentRead.mockResolvedValue({...consent,deliveryStatus:'pending'});
  expect((await request(`GET ${base}`)).body.capabilities.discoveryBlockedReason).toBe('consent_required');
  vi.stubEnv('CANDIDATE_NETWORK_SOURCING_ENABLED','false');
  expect((await request(`GET ${base}`)).body.capabilities.discoveryBlockedReason).toBe('feature_unavailable');
 });
 it('reports source/AI availability only behind its own switch and delivered consent',async()=>{
  enableSpark();vi.stubEnv('CANDIDATE_RESUME_SOURCE_ENABLED','true');vi.stubEnv('CANDIDATE_LOOKUP_SOURCE_ENABLED','true');vi.stubEnv('CANDIDATE_RC_API_KEY','synthetic-key');
  let response=await request(`GET ${base}`);
  expect(response.body.capabilities).toMatchObject({canRequestResume:true,resumeBlockedReason:null,canEnrich:true,canInterpret:true});
  const consent=await deps.consentRead();deps.consentRead.mockResolvedValue({...consent,deliveryStatus:'pending'});
  response=await request(`GET ${base}`);
  expect(response.body.capabilities).toMatchObject({canRequestResume:false,resumeBlockedReason:'consent_required',canEnrich:false,canInterpret:false});
  vi.stubEnv('CANDIDATE_RESUME_SOURCE_ENABLED','false');
  expect((await request(`GET ${base}`)).body.capabilities.resumeBlockedReason).toBe('feature_unavailable');
 });
 it('returns canonical review locators without raw source text',async()=>{
  enableSpark();const view=await deps.readSparkProfile();
  const proposals=[{proposalId:key,proposalHash:'a'.repeat(64),kind:'source',sourceId:key,sourceVersion:1,expiresAt:'2026-12-01T00:00:00.000Z'}];
  deps.readSparkProfile.mockResolvedValue({...view,sources:[{sourceId:key,sourceVersion:1}],proposals,hasMoreSources:false,hasMoreProposals:true});
  const response=await request(`GET ${base}`);expect(response.body.proposals).toEqual(proposals);expect(response.body.hasMoreProposals).toBe(true);
 });
 it.each(['expiry_reconciling','retry_exhausted','authentication_changed'])('blocks confirm for held %s without reconstructing its body',async reason=>{
  enableSpark();const pending=[{schemaVersion:3,commandId:key,action:'confirm',status:'held',reason}];
  deps.owner.mockResolvedValue({subjectId:key,bindingId:key,pendingCommands:pending,hasMorePendingCommands:false});
  const response=await request(`GET ${base}`);
  expect(response.body.pendingCommands).toEqual(pending);expect(response.body.capabilities.confirmBlockedReason).toBe('pending_changes');
 });
 it.each(['withdraw','pending','legacy'])('does not treat %s consent as an effective grant',async state=>{
  enableSpark();const consent=await deps.consentRead();
  if(state==='withdraw'){consent.desiredAction='withdraw';consent.consentRevision=4;}
  if(state==='pending')consent.deliveryStatus='pending';
  if(state==='legacy')consent.acknowledgedSchemaVersion=1;
  deps.consentRead.mockResolvedValue(consent);const response=await request(`GET ${base}`);
  expect(response.body.effectiveConsentRevision).toBeNull();expect(response.body.capabilities).toMatchObject({canEdit:true,canConfirm:false,confirmBlockedReason:'consent_required'});
 });
 it('does not invent answers or confirm an unpromoted draft',async()=>{
  enableSpark();const view=await deps.readSparkProfile();view.preferenceDraft.promotedDraftRevision=1;
  expect((await request(`GET ${base}`)).body.capabilities.confirmBlockedReason).toBe('preferences_not_promoted');
  view.preferenceDraft.sections.employment_types={answered:false,value:null};
  const response=await request(`GET ${base}`);expect(response.body.missingFields).toContain('preferences.employment_types');
  expect(response.body.preferenceDraft.sections.employment_types).toEqual({answered:false,value:null});
 });
 it('blocks confirmation on stale authentication or truncated pending metadata',async()=>{
  enableSpark();expect((await request(`GET ${base}`,{session:{}})).body.capabilities.confirmBlockedReason).toBe('recent_auth_required');
  deps.owner.mockResolvedValue({subjectId:key,bindingId:key,pendingCommands:[],hasMorePendingCommands:true});
  expect((await request(`GET ${base}`)).body.capabilities.confirmBlockedReason).toBe('pending_changes');
 });
 it('never falls back on a failed v3 read or returns data after Spark is disabled mid-read',async()=>{
  enableSpark();deps.readSparkProfile.mockRejectedValueOnce(Error('private remote detail'));
  expect((await request(`GET ${base}`)).body).toEqual({code:'profile_temporarily_unavailable',retryable:true});
  const view=await deps.readSparkProfile();
  deps.readSparkProfile.mockImplementationOnce(async()=>{vi.stubEnv('CANDIDATE_SPARK_ENABLED','false');return view;});
  const response=await request(`GET ${base}`);expect(response.statusCode).toBe(409);
  expect(response.body).toEqual({code:'feature_unavailable'});expect(deps.readProfile).not.toHaveBeenCalled();
 });
 it('refuses v3 outages, changed identity and privacy changes without leaking the loaded data',async()=>{
  enableSpark();deps.consentRead.mockRejectedValueOnce(Error('private error'));
  expect((await request(`GET ${base}`)).statusCode).toBe(503);
  deps.owner.mockResolvedValueOnce({subjectId:key,bindingId:key,pendingCommands:[],hasMorePendingCommands:false})
   .mockRejectedValueOnce(new CandidatePrivacyRestrictedError('candidate_privacy_restricted'));
  expect((await request(`GET ${base}`)).statusCode).toBe(451);
  deps.owner.mockResolvedValueOnce({subjectId:key,bindingId:key,pendingCommands:[],hasMorePendingCommands:false})
   .mockResolvedValueOnce({subjectId:'changed',bindingId:key,pendingCommands:[],hasMorePendingCommands:false});
  expect((await request(`GET ${base}`)).statusCode).toBe(409);
  expect(deps.readProfile).not.toHaveBeenCalled();
 });
 it('admits v3 only with both delivery workers and the Spark switch enabled',async()=>{
  const rawBody=JSON.stringify({...command,schemaVersion:3,expectedPreferenceDraftRevision:0,action:'save_preference_section',
   payload:{section:'employment_types',answered:true,value:['gig_freelance']}});
  const flags=['CANDIDATE_PROFILE_DELIVERY_ENABLED','CANDIDATE_CONSENT_V2_DELIVERY_ENABLED','CANDIDATE_SPARK_ENABLED'];
  for(const flag of flags)vi.stubEnv(flag,'true');
  for(const flag of flags){vi.stubEnv(flag,'false');expect((await request(`POST ${base}/commands`,{rawBody})).statusCode).toBe(404);vi.stubEnv(flag,'true');}
  expect(deps.admit).not.toHaveBeenCalled();deps.admit.mockResolvedValue({schemaVersion:3,commandId:key,status:'pending'});
  const response=await request(`POST ${base}/commands`,{rawBody,session:{}});
  expect(response.statusCode).toBe(202);expect(response.body.schemaVersion).toBe(3);
  expect(deps.admit).toHaveBeenCalledWith({userId:7,authVersion:3,passwordVersion:null,reauthenticatedAt:null},rawBody);
 });
 it('keeps recent authentication mandatory for v3 confirmation',async()=>{
  for(const flag of ['CANDIDATE_PROFILE_DELIVERY_ENABLED','CANDIDATE_CONSENT_V2_DELIVERY_ENABLED','CANDIDATE_SPARK_ENABLED'])vi.stubEnv(flag,'true');
  const rawBody=JSON.stringify({...command,schemaVersion:3,expectedPreferenceDraftRevision:1,action:'confirm',
   payload:{draftHash:'a'.repeat(64),preferenceDraftHash:'b'.repeat(64),consentRevision:1}});
  expect((await request(`POST ${base}/commands`,{rawBody,session:{}})).body.code).toBe('recent_auth_required');
  expect(deps.admit).not.toHaveBeenCalled();
 });
 it('is off before auth or storage',async()=>{
  vi.stubEnv('CANDIDATE_PROFILE_ENABLED','false');for(const path of chains.keys())expect((await request(path,{user:null})).statusCode).toBe(404);
  expect(deps.owner).not.toHaveBeenCalled();expect(deps.admit).not.toHaveBeenCalled();
 });
 it.each([null,{role:'recruiter',emailVerified:true},{role:'candidate',emailVerified:false}])('requires verified candidate %s',async user=>{
  enableSpark();
  for(const path of chains.keys())expect((await request(path,{user})).statusCode).toBe(403);
 });
 it('requires CSRF but permits private draft edits without recent reauthentication',async()=>{
  expect((await request(`POST ${base}/commands`,{csrf:false})).statusCode).toBe(403);
  expect((await request(`POST ${base}/commands`,{session:{}})).statusCode).toBe(202);
  expect(deps.admit).toHaveBeenCalledWith({userId:7,authVersion:3,passwordVersion:null,reauthenticatedAt:null},JSON.stringify(command));
 });
 it('confirmation requires recent authentication',async()=>{
  const rawBody=JSON.stringify({...command,action:'confirm',payload:{draftHash:'a'.repeat(64),consentVersion:0}});
  expect((await request(`POST ${base}/commands`,{rawBody,session:{}})).body.code).toBe('recent_auth_required');
  expect(deps.admit).not.toHaveBeenCalled();
 });
 it.each([undefined,'{"a":1,"a":2}',JSON.stringify({...command,subjectId:key})])('rejects ambiguous or injected requests',async rawBody=>{
  expect((await request(`POST ${base}/commands`,{rawBody})).statusCode).toBe(422);expect(deps.admit).not.toHaveBeenCalled();
 });
 it('returns 202 with the same command even when the original save already applied',async()=>{
  deps.admit.mockResolvedValue({schemaVersion:2,commandId:key,status:'applied'});
  expect((await request(`POST ${base}/commands`)).statusCode).toBe(202);
 });
 it('merges pending saves without bodies, preventing confirmation while retrying',async()=>{
  const pending=[{commandId:key,action:'save_draft',status:'held',reason:'memory_unavailable'}];
  deps.owner.mockResolvedValue({subjectId:key,bindingId:key,pendingCommands:pending,hasMorePendingCommands:false});
  const response=await request(`GET ${base}`);
  expect(response.headers['Cache-Control']).toBe('no-store');expect(response.body.pendingCommands).toEqual(pending);
  expect(response.body.capabilities).toMatchObject({canConfirm:false,confirmBlockedReason:'pending_changes'});
  expect(deps.owner).toHaveBeenCalledTimes(2);
 });
 it('never turns a Memory outage into an empty successful profile',async()=>{
  deps.readProfile.mockRejectedValue(Error('private detail'));
  const response=await request(`GET ${base}`);expect(response.statusCode).toBe(503);
  expect(response.body).toEqual({code:'profile_temporarily_unavailable',retryable:true});
 });
 it('rechecks privacy after the remote read',async()=>{
  deps.owner.mockResolvedValueOnce({subjectId:key,bindingId:key,pendingCommands:[],hasMorePendingCommands:false})
   .mockRejectedValueOnce(new CandidatePrivacyRestrictedError('candidate_privacy_restricted'));
  expect((await request(`GET ${base}`)).statusCode).toBe(451);
 });
 it('foreign command IDs disclose no status',async()=>{
  deps.readCommand.mockRejectedValue(new ProfileRepositoryError('not_found',404));
  expect((await request(`GET ${base}/commands/:id`)).body).toEqual({code:'not_found'});
 });
 it('refuses query identity and bodies on reads',async()=>{
  enableSpark();
  for(const path of chains.keys())if(path.startsWith('GET')){
   expect((await request(path,{query:{subjectId:key}})).statusCode).toBe(400);
   expect((await request(path,{headers:{'content-length':'2'}})).statusCode).toBe(400);
  }
 });
 it('resolution reads are owner-bound and writes require CSRF and recent auth',async()=>{
  enableSpark();const path=`${base}/commands/:id/resolution`,rawBody=JSON.stringify({schemaVersion:1,idempotencyKey:key,expectedResolutionRevision:0,action:'discard'});
  deps.resolution.mockResolvedValue({state:'resolving'});
  expect((await request(`GET ${path}`)).headers['Cache-Control']).toBe('no-store');
  expect(deps.resolution).toHaveBeenCalledWith({userId:7,authVersion:3},key);
  expect((await request(`POST ${path}`,{rawBody,csrf:false})).statusCode).toBe(403);
  expect((await request(`POST ${path}`,{rawBody,session:{}})).statusCode).toBe(403);
  expect((await request(`POST ${path}`,{rawBody})).statusCode).toBe(202);
  expect(deps.resolution).toHaveBeenCalledWith({userId:7,authVersion:3},key,rawBody);
  expect((await request(`POST ${path}`,{rawBody:rawBody.replace('"action":"discard"','"action":"discard","body":"replacement"')})).statusCode).toBe(422);
  deps.resolution.mockRejectedValue(new ProfileRepositoryError('not_found',404));
  expect((await request(`GET ${path}`)).body).toEqual({code:'not_found'});
 });
});
