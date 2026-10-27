import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import type {Express} from 'express';
const deps=vi.hoisted(()=>({ensure:vi.fn(),read:vi.fn(),readCommand:vi.fn(),claimIntent:vi.fn()}));
vi.mock('../db',()=>({pool:{}}));
vi.mock('../auth',()=>({requireVerifiedCandidate:(req:any,res:any,next:()=>void)=>{
  if(req.user?.role==='candidate' && req.user.emailVerified) next();
  else res.status(403).json({code:'verified_candidate_required'});
}}));
vi.mock('../candidate-consent/repository',()=>({recentConsentAuth:(at:number)=>at===123}));
vi.mock('../candidate-privacy/decision',()=>({requireCandidatePrivacyAllowed:vi.fn(),
  CandidatePrivacyRestrictedError:class extends Error {constructor(public code:string){super(code);}}}));
vi.mock('./repository',async original=>({...await original<typeof import('./repository')>(),foundationRepository:()=>deps}));
import {registerCandidateProductRoutes} from './routes';
import {FoundationRepositoryError} from './repository';
import {CandidatePrivacyRestrictedError} from '../candidate-privacy/decision';
const chains=new Map<string,Array<(req:any,res:any,next:()=>void)=>unknown>>();
registerCandidateProductRoutes({get:(path:string,...handlers:any[])=>chains.set(`GET ${path}`,handlers),
  post:(path:string,...handlers:any[])=>chains.set(`POST ${path}`,handlers)} as unknown as Express,
  (req:any,res,next)=>{if(req.csrf)next();else res.status(403).json({code:'csrf_required'});});
const key='11111111-1111-4111-8111-111111111111';
const post='POST /api/candidate/product/foundation';
async function request(path:string,changes:Record<string,unknown>={}){
  const req={user:{id:7,authVersion:3,role:'candidate',emailVerified:true,password:'unused'},
    session:{privacyReauthenticatedAt:123,privacyPasswordVersion:'a'.repeat(64)},query:{},params:{id:key},headers:{},csrf:true,
    is:()=>true,rawBody:JSON.stringify({schemaVersion:1,idempotencyKey:key}),...changes};
  const res={statusCode:200,body:undefined as any,status(n:number){this.statusCode=n;return this;},
    json(value:unknown){this.body=value;return this;}};
  for(const fn of chains.get(path)!){let next=false;await fn(req,res,()=>{next=true;});if(!next)break;}
  return res;
}
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv('CANDIDATE_FOUNDATION_ENABLED','true');
  deps.ensure.mockResolvedValue({schemaVersion:1,commandId:key,status:'pending',publicationActive:false});});
afterEach(()=>vi.unstubAllEnvs());
describe('foundation registered route chains',()=>{
  it('is dark before auth or database work',async()=>{
    vi.stubEnv('CANDIDATE_FOUNDATION_ENABLED','false');
    for(const path of chains.keys()) expect((await request(path,{user:null})).statusCode).toBe(404);
    for(const fn of Object.values(deps)) expect(fn).not.toHaveBeenCalled();
  });
  it.each([null,{role:'recruiter',emailVerified:true},{role:'candidate',emailVerified:false}])('requires verified candidate %s',async user=>{
    for(const path of chains.keys())expect((await request(path,{user})).statusCode).toBe(403);
  });
  it('requires csrf and recent auth on both writes',async()=>{
    for(const path of [...chains.keys()].filter(p=>p.startsWith('POST'))){
      expect((await request(path,{csrf:false})).statusCode).toBe(403);
      expect((await request(path,{session:{}})).body.code).toBe('recent_auth_required');
    }
    expect(deps.ensure).not.toHaveBeenCalled();expect(deps.claimIntent).not.toHaveBeenCalled();
  });
  it.each([undefined,'{"schemaVersion":1,"schemaVersion":1,"idempotencyKey":"'+key+'"}',
    '{"schemaVersion":1,"idempotencyKey":"'+key+'","subjectId":"'+key+'"}'])('rejects missing raw bytes or ambiguous input',async rawBody=>{
    expect((await request(post,{rawBody})).statusCode).toBe(400);expect(deps.ensure).not.toHaveBeenCalled();
  });
  it('passes only server identity and returns pending or acknowledged',async()=>{
    expect((await request(post)).statusCode).toBe(202);
    expect(deps.ensure).toHaveBeenCalledWith({userId:7,authVersion:3,passwordVersion:'a'.repeat(64),reauthenticatedAt:123},key);
    deps.ensure.mockResolvedValue({status:'acknowledged'});expect((await request(post)).statusCode).toBe(200);
  });
  it('rejects query or body on reads',async()=>{
    for(const path of [...chains.keys()].filter(p=>p.startsWith('GET'))){
      expect((await request(path,{query:{subjectId:key}})).statusCode).toBe(400);
      expect((await request(path,{headers:{'content-length':'2'}})).statusCode).toBe(400);
    }
  });
  it('claims an intent without granting consent',async()=>{
    deps.claimIntent.mockResolvedValue({schemaVersion:1,status:'claimed',requiresConfirmation:true,publicationActive:false});
    const response=await request('POST /api/candidate/product/intents/:id/claim',{rawBody:'{"schemaVersion":1}'});
    expect(response.body).toMatchObject({requiresConfirmation:true,publicationActive:false});
  });
  it('uses safe errors and terminal privacy status',async()=>{
    deps.ensure.mockRejectedValue(new Error('secret raw database detail'));
    expect((await request(post)).body).toEqual({code:'authority_unavailable'});
    deps.ensure.mockRejectedValue(new FoundationRepositoryError('not_found',404));
    expect((await request(post)).statusCode).toBe(404);
    deps.ensure.mockRejectedValue(new CandidatePrivacyRestrictedError('candidate_privacy_restricted'));
    expect((await request(post)).statusCode).toBe(451);
  });
});
