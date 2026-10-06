import {beforeEach,afterEach,describe,expect,it,vi} from 'vitest';
import type {Express,Request,Response,NextFunction} from 'express';
const mocks=vi.hoisted(()=>({organization:vi.fn(),digest:vi.fn()}));
vi.mock('../../auth',()=>({requireAuth:(req:Request,res:Response,next:NextFunction)=>req.user?next():res.status(401).json({code:'AUTH_REQUIRED'})}));
vi.mock('../../lib/organizationService',()=>({getUserOrganization:mocks.organization}));
vi.mock('../../candidate-privacy/decision',()=>({requireCandidatePrivacyAllowed:vi.fn()}));
vi.mock('../../lib/aiModelConfig',()=>({getGroqModel:()=> 'fixture-model'}));
vi.mock('../digest',()=>({executeDigestPreparation:mocks.digest}));
vi.mock('../../lib/services/signal-client',()=>({governedSignalPost:vi.fn(()=>{throw Error('NO_NETWORK');})}));
import {registerSourcingAuthorityRoutes} from '../routes';
import {readSourcingPreview,requestSourcingPreview} from '../commands';
import {SourcingRepository,SourcingError} from '../repository';
import {runSourcingAuthorityCycle} from '../worker';
const id='10000000-0000-4000-8000-000000000001';
const scope={organizationId:1,jobId:2,actorId:3};
const repository=()=>({call:vi.fn()}) as unknown as SourcingRepository;
type Middleware=(req:Request,res:Response,next:NextFunction)=>unknown;

function appHarness(repo:SourcingRepository) {
  const routes=new Map<string,Middleware[]>();
  const app={get:(path:string,...fn:Middleware[])=>routes.set('GET '+path,fn),post:(path:string,...fn:Middleware[])=>routes.set('POST '+path,fn)};
  const csrf=vi.fn((req:Request,res:Response,next:NextFunction)=>req.headers['x-csrf-token']==='fixture'?next():res.status(403).json({code:'CSRF_REQUIRED'}));
  registerSourcingAuthorityRoutes(app as unknown as Express,csrf,repo);
  return {routes,csrf,async invoke(method:string,path:string,patch:Record<string,unknown>={}) {
    const req={method,params:{id:'2'},user:{id:3},headers:{'x-csrf-token':'fixture'},body:undefined,...patch} as unknown as Request;
    const result={status:200,body:undefined as unknown,headers:{} as Record<string,string>};
    const res={set:(key:string,value:string)=>{result.headers[key]=value;return res;},status:(code:number)=>{result.status=code;return res;},json:(value:unknown)=>{result.body=value;return res;}} as unknown as Response;
    for(const fn of routes.get(method+' '+path)??[]) {
      let next=false;await fn(req,res,(()=>{next=true;}) as NextFunction);if(!next)break;
    }
    return result;
  }};
}
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('FLOW_SOURCING_V1_ENABLED','true');vi.stubEnv('FLOW_JOB_BRIEF_ENABLED','true');vi.stubEnv('BASE_URL','https://flow.example');mocks.organization.mockResolvedValue({organization:{id:1}});});
afterEach(()=>vi.unstubAllEnvs());

describe('sourcing preview commands and HTTP boundary',()=>{
  it('reads cached evidence without creating work or requiring a request ID',async()=>{
    const repo=repository();vi.mocked(repo.call).mockResolvedValue({state:'unavailable'});
    expect(await readSourcingPreview(repo,scope)).toEqual({state:'unavailable'});
    expect(repo.call).toHaveBeenCalledExactlyOnceWith('previewRequest',[1,2,3,null,{action:'read'}]);
    expect(mocks.digest).not.toHaveBeenCalled();
  });
  it('only schedules the explicit retry against the requested brief',async()=>{
    const repo=repository();vi.mocked(repo.call).mockResolvedValue({state:'reserved'});
    await requestSourcingPreview(repo,scope,{action:'retry_preparation',requestId:id,briefVersionId:id});
    expect(repo.call).toHaveBeenCalledExactlyOnceWith('digestClaim',[1,2,3,id,{action:'retry',model:'fixture-model',briefVersionId:id}]);
    expect(mocks.digest).not.toHaveBeenCalled();
  });
  it('does not allow browser auto/start/model/force commands',async()=>{
    const repo=repository();
    for(const input of [{action:'auto',requestId:id,artifactId:id},{action:'start',requestId:id,briefVersionId:id},
      {action:'refresh',requestId:id,artifactId:id,force:true},{action:'retry_preparation',requestId:id,briefVersionId:id,model:'other'}]) {
      await expect(requestSourcingPreview(repo,scope,input)).rejects.toThrow();
    }
    expect(repo.call).not.toHaveBeenCalled();
  });
  it('returns feature unavailable without looking up any organization when off',async()=>{
    vi.stubEnv('FLOW_SOURCING_V1_ENABLED','false');const repo=repository(),app=appHarness(repo);
    expect(await app.invoke('GET','/api/jobs/:id/sourcing/preview')).toMatchObject({status:503,body:{code:'SOURCING_DISABLED'}});
    expect(mocks.organization).not.toHaveBeenCalled();expect(repo.call).not.toHaveBeenCalled();
  });
  it('requires authentication and CSRF for a refresh',async()=>{
    const repo=repository(),app=appHarness(repo);
    expect((await app.invoke('GET','/api/jobs/:id/sourcing/preview',{user:undefined})).status).toBe(401);
    expect((await app.invoke('POST','/api/jobs/:id/sourcing/preview',{headers:{}})).status).toBe(403);
    expect(repo.call).not.toHaveBeenCalled();
  });
  it('refuses malformed identifiers rather than partially parsing them',async()=>{
    const repo=repository(),app=appHarness(repo);
    for(const value of ['2junk','0','-2','2.1','9007199254740992'])expect((await app.invoke('GET','/api/jobs/:id/sourcing/preview',{params:{id:value}})).status).toBe(404);
    expect(repo.call).not.toHaveBeenCalled();
  });
  it('retains scoped SQL refusal and never returns raw errors',async()=>{
    const repo=repository(),app=appHarness(repo);
    vi.mocked(repo.call).mockResolvedValue(null);
    expect((await app.invoke('GET','/api/jobs/:id/sourcing/preview')).status).toBe(404);
    vi.mocked(repo.call).mockRejectedValue(new Error('private connection data'));
    expect(await app.invoke('GET','/api/jobs/:id/sourcing/preview')).toMatchObject({status:503,body:{code:'SOURCING_UNAVAILABLE'}});
    vi.mocked(repo.call).mockRejectedValue(new SourcingError('SOURCING_PREVIEW_LIMIT',429));
    expect((await app.invoke('POST','/api/jobs/:id/sourcing/preview',{body:{action:'refresh',requestId:id,artifactId:id}})).status).toBe(429);
  });
});

describe('durable preparation and preview cycle',()=>{
  it('does nothing while off',async()=>{
    vi.stubEnv('FLOW_SOURCING_V1_ENABLED','false');const repo=repository(),transport=vi.fn();
    await runSourcingAuthorityCycle(repo,transport);expect(repo.call).not.toHaveBeenCalled();expect(transport).not.toHaveBeenCalled();
  });
  it('uses a preclaimed digest without another claim or a source admission',async()=>{
    const repo=repository(),work={input:{...scope,requestId:id,model:'fixture-model'},claim:{id,state:'started',lease:id}};
    vi.mocked(repo.call).mockImplementation(async operation=>operation==='digestNext'?work:null);
    await runSourcingAuthorityCycle(repo,vi.fn());
    expect(mocks.digest).toHaveBeenCalledExactlyOnceWith(repo,work.input,{claim:work.claim});
    expect(vi.mocked(repo.call).mock.calls.map(c=>c[0])).toEqual(['digestNext','dispatchClaim','previewClaim']);
  });
  it('uncertain preview transport polls the same identity, not a fresh purchase',async()=>{
    const repo=repository(),command={previewId:id},transport=vi.fn().mockRejectedValue(Error('timeout'));
    vi.mocked(repo.call).mockImplementation(async operation=>operation==='previewClaim'?{id,lease:id,tenantId:'fixture',externalJobId:'vanta:jobs:2',command}:null);
    await runSourcingAuthorityCycle(repo,transport);
    expect(transport).toHaveBeenCalledExactlyOnceWith({kind:'preview',tenantId:'fixture',externalJobId:'vanta:jobs:2',requestId:id,body:command});
    expect(repo.call).toHaveBeenLastCalledWith('previewFinish',[id,id,{state:'pending'}]);
  });
});
