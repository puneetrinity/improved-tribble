import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import type {Express} from 'express';
const deps=vi.hoisted(()=>({capture:vi.fn(),read:vi.fn(),activateSignup:vi.fn()}));
vi.mock('../db',()=>({pool:{}}));
vi.mock('../auth',()=>({requireVerifiedCandidate:(req:any,res:any,next:()=>void)=>{
 if(req.user?.role==='candidate'&&req.user.emailVerified)next();else res.status(403).json({code:'verified_candidate_required'});
}}));
vi.mock('../candidate-consent/repository',()=>({recentConsentAuth:vi.fn()}));
vi.mock('../candidate-privacy/decision',()=>({requireCandidatePrivacyAllowed:vi.fn(),
 CandidatePrivacyRestrictedError:class extends Error{constructor(public code:string){super(code);}}}));
vi.mock('./consent-v2',async original=>({...await original<typeof import('./consent-v2')>(),consentV2Repository:()=>deps}));
import {registerCandidateConsentV2Routes} from './routes';
import {ConsentCaptureError} from './consent-v2';
const chains=new Map<string,Array<(req:any,res:any,next:()=>void)=>unknown>>();
registerCandidateConsentV2Routes({get:(p:string,...h:any[])=>chains.set(`GET ${p}`,h),post:(p:string,...h:any[])=>chains.set(`POST ${p}`,h)} as unknown as Express,
 (req:any,res,next)=>{if(req.csrf)next();else res.status(403).json({code:'csrf_required'});});
const key='11111111-1111-4111-8111-111111111111',path='/api/candidate/product/consent';
const grant={schemaVersion:2,idempotencyKey:key,expectedConsentRevision:0,action:'grant',copyVersion:2,copyHash:'a'.repeat(64)};
const withdraw={schemaVersion:2,idempotencyKey:key,expectedConsentRevision:1,action:'withdraw'};
async function request(method='POST',change:Record<string,unknown>={},target=path){
 const req={user:{id:7,authVersion:3,role:'candidate',emailVerified:true},query:{},headers:{},csrf:true,is:()=>true,
 rawBody:JSON.stringify(grant),...change};
 const res={statusCode:200,body:undefined as any,headers:{} as Record<string,string>,setHeader(k:string,v:string){this.headers[k]=v;},
 status(n:number){this.statusCode=n;return this;},json(v:unknown){this.body=v;return this;}};
 for(const fn of chains.get(`${method} ${target}`)!){let next=false;await fn(req,res,()=>{next=true;});if(!next)break;}
 return res;
}
beforeEach(()=>{vi.resetAllMocks();for(const name of ['CANDIDATE_FOUNDATION_ENABLED','CANDIDATE_CONSENT_V2_DELIVERY_ENABLED','CANDIDATE_CONSENT_V2_CAPTURE_ENABLED'])vi.stubEnv(name,'true');
 deps.capture.mockResolvedValue({schemaVersion:2,eventId:key,consentRevision:1,status:'recorded',replayed:false});});
afterEach(()=>vi.unstubAllEnvs());
describe('consent capture registered routes',()=>{
 it('activates only the server-stored signup choice with verified session and CSRF',async()=>{
  const activate=path+'/signup-intent/activate',body={rawBody:'{"schemaVersion":2}'};
  deps.activateSignup.mockResolvedValue({schemaVersion:2,status:'none',receipt:null});
  expect((await request('POST',body,activate)).statusCode).toBe(202);
  expect(deps.activateSignup).toHaveBeenCalledWith({userId:7,authVersion:3});deps.activateSignup.mockClear();
  for(const change of [{user:null},{csrf:false},{user:{role:'candidate',emailVerified:false}}])
   expect((await request('POST',{...body,...change},activate)).statusCode).toBe(403);
  for(const rawBody of ['{"schemaVersion":2,"schemaVersion":2}','{"schemaVersion":2,"copyHash":"fake"}',' '.repeat(4097)])
   expect((await request('POST',{rawBody},activate)).statusCode).toBe(422);
  vi.stubEnv('CANDIDATE_CONSENT_V2_CAPTURE_ENABLED','false');expect((await request('POST',body,activate)).statusCode).toBe(404);
  expect(deps.activateSignup).not.toHaveBeenCalled();
 });
 it.each(['CANDIDATE_FOUNDATION_ENABLED','CANDIDATE_CONSENT_V2_DELIVERY_ENABLED'])('stays dark without %s',async flag=>{
  vi.stubEnv(flag,'false');for(const method of ['GET','POST'])expect((await request(method,{user:null})).statusCode).toBe(404);
  expect(deps.capture).not.toHaveBeenCalled();expect(deps.read).not.toHaveBeenCalled();
 });
 it('pausing new grants preserves withdrawal and status',async()=>{
  vi.stubEnv('CANDIDATE_CONSENT_V2_CAPTURE_ENABLED','false');
  expect((await request()).statusCode).toBe(404);
  expect((await request('POST',{rawBody:JSON.stringify(withdraw)})).statusCode).toBe(202);
  expect((await request('GET')).statusCode).toBe(200);
 });
 it('requires an authenticated candidate and CSRF',async()=>{
  expect((await request('POST',{user:null})).statusCode).toBe(401);
  expect((await request('GET',{user:{role:'recruiter'}})).statusCode).toBe(403);
  expect((await request('POST',{csrf:false})).statusCode).toBe(403);
  expect(deps.capture).not.toHaveBeenCalled();expect(deps.read).not.toHaveBeenCalled();
 });
 it('requires verification for grant, not withdrawal',async()=>{
  const user={id:7,authVersion:3,role:'candidate',emailVerified:false};
  expect((await request('POST',{user})).statusCode).toBe(403);
  expect((await request('POST',{user,rawBody:JSON.stringify(withdraw)})).statusCode).toBe(202);
  expect(deps.capture).toHaveBeenCalledTimes(1);
 });
 it('passes only session identity and does not claim consent has been delivered',async()=>{
  const response=await request();expect(response.statusCode).toBe(202);expect(response.body.status).toBe('recorded');
  expect(response.headers['Cache-Control']).toBe('no-store');
  expect(deps.capture).toHaveBeenCalledWith({userId:7,authVersion:3},JSON.stringify(grant));
 });
 it.each([undefined,'{"action":"grant","action":"withdraw"}',JSON.stringify({...grant,subjectId:key})])('rejects ambiguous body %s',async rawBody=>{
  expect((await request('POST',{rawBody})).statusCode).toBe(422);expect(deps.capture).not.toHaveBeenCalled();
 });
 it('rejects oversized bodies, queries and non-JSON writes',async()=>{
  expect((await request('POST',{rawBody:' '.repeat(4097)})).statusCode).toBe(413);
  expect((await request('POST',{query:{userId:9}})).statusCode).toBe(422);
  expect((await request('POST',{is:()=>false})).statusCode).toBe(422);
  expect(deps.capture).not.toHaveBeenCalled();
 });
 it('rejects query identities and bodies on the status read',async()=>{
  expect((await request('GET',{query:{userId:9}})).statusCode).toBe(400);
  expect((await request('GET',{headers:{'content-length':'2'}})).statusCode).toBe(400);
  expect(deps.read).not.toHaveBeenCalled();
 });
 it('exposes only safe error codes',async()=>{
  deps.capture.mockRejectedValue(new ConsentCaptureError('consent_version_conflict',409));
  expect((await request()).body).toEqual({code:'consent_version_conflict'});
  deps.capture.mockRejectedValue(Error('private SQL or provider detail'));
  expect((await request()).body).toEqual({code:'consent_temporarily_unavailable'});
 });
});
