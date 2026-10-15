import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
vi.mock('../../lib/services/jwt-signer',()=>({signServiceJwt:vi.fn(async()=>'SECRET_TOKEN')}));
vi.mock('../digest',()=>({executeDigestPreparation:vi.fn()}));
import {governedSignalPost,GovernedTransportError,governedTransportDiagnostic} from '../../lib/services/signal-client';
import {runSourcingAuthorityCycle} from '../worker';
import type {SourcingRepository} from '../repository';
const id='10000000-0000-4000-8000-000000000001';
const input={kind:'source' as const,tenantId:'synthetic',externalJobId:'vanta:jobs:2',requestId:id,body:{}};
beforeEach(()=>{vi.stubEnv('SIGNAL_BASE_URL','https://discover.invalid');vi.stubEnv('FLOW_SOURCING_V1_ENABLED','true');vi.stubEnv('FLOW_JOB_BRIEF_ENABLED','true');vi.stubEnv('BASE_URL','https://flow.invalid');});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.useRealTimers();});
describe('closed governed diagnostics',()=>{
  it.each([
    [409,'GOVERNED_DISABLED','GOVERNED_DISABLED'],[409,'GOVERNED_TENANT_REQUIRED','GOVERNED_TENANT_REQUIRED'],
    [413,'GOVERNED_BODY_TOO_LARGE','GOVERNED_BODY_TOO_LARGE'],[400,'GOVERNED_INVALID_COMMAND','GOVERNED_INVALID_COMMAND'],
    [503,'GOVERNED_UNAVAILABLE','GOVERNED_UNAVAILABLE'],[503,'GOVERNED_PREVIEW_UNAVAILABLE','GOVERNED_PREVIEW_UNAVAILABLE'],
    [401,'Invalid token','AUTH_INVALID_TOKEN'],[403,'Invalid token claim','AUTH_INVALID_CLAIM'],
    [401,'SECRET_TOKEN candidate@example.com','UNLISTED'],
  ])('keeps only safe status/code: %s %s',async(status,code,safe)=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({error:code,token:'SECRET_TOKEN',candidate:'PRIVATE'}),{status:Number(status)})));
    const error=await governedSignalPost(input).catch(e=>e);
    expect(governedTransportDiagnostic(error)).toBe(`REMOTE_${status}:${safe}`);
    expect(JSON.stringify(error)).not.toMatch(/SECRET_TOKEN|PRIVATE|candidate@/);
  });
  it.each(['<html>SECRET_TOKEN</html>','x'.repeat(4097)])('bounds and discards malformed or oversized refusal bodies',async body=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(body,{status:409})));
    await expect(governedSignalPost(input)).rejects.toThrow('REMOTE_409:UNLISTED');
  });
  it.each([[302,'REDIRECT'],[200,'INVALID_JSON']] as const)('classifies %s without exposing content',async(status,code)=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response('SECRET_TOKEN',{status,headers:{Location:'https://secret.invalid'}})));
    await expect(governedSignalPost(input)).rejects.toThrow(`TRANSPORT:${code}`);
  });
  it('classifies a connection failure without retaining its message',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>{throw Error('SECRET_TOKEN');}));
    await expect(governedSignalPost(input)).rejects.toThrow('TRANSPORT:CONNECTION');
  });
  it('classifies timeout from its own signal',async()=>{
    const controller=new AbortController();controller.abort();
    const timer=vi.spyOn(AbortSignal,'timeout').mockReturnValue(controller.signal);
    vi.stubGlobal('fetch',vi.fn(async()=>{throw Error('SECRET_TOKEN');}));
    try{await expect(governedSignalPost(input)).rejects.toThrow('TRANSPORT:TIMEOUT');}finally{timer.mockRestore();}
  });
  it('bounds successful response bodies too',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response('x'.repeat(131073))));
    await expect(governedSignalPost(input)).rejects.toThrow('TRANSPORT:RESPONSE_TOO_LARGE');
  });
  it('keeps successful transport unchanged',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>Response.json({requestId:id})));
    expect(await governedSignalPost(input)).toEqual({requestId:id});
  });
  it('re-sanitises forged diagnostic text',()=>{
    const error=new GovernedTransportError(409,'GOVERNED_DISABLED');
    Object.assign(error,{diagnostic:'SECRET_TOKEN'});
    expect(governedTransportDiagnostic(error)).toBe('TRANSPORT:UNAVAILABLE');
  });
  it('never carries arbitrary remote body or token into worker receipts and logs',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>Response.json({error:'PRIVATE_CANDIDATE',token:'SECRET_TOKEN',message:'private@example.com'},{status:409})));
    const call=vi.fn(async(op:string,_args:unknown[])=>op==='dispatchClaim'?{admissionId:id,lease:id,tenantId:'synthetic',command:{externalJobId:'vanta:jobs:2'}}:null);
    const report=vi.fn();
    await runSourcingAuthorityCycle({call} as unknown as SourcingRepository,governedSignalPost,report);
    expect(call).toHaveBeenCalledWith('dispatchFinish',[id,id,{kind:'retry',code:'SOURCING_BIND_UNCERTAIN:REMOTE_409:UNLISTED'}]);
    expect(report).toHaveBeenCalledWith('DISPATCH_REMOTE_409_UNLISTED');
    expect(JSON.stringify({calls:call.mock.calls,logs:report.mock.calls})).not.toMatch(/PRIVATE_CANDIDATE|SECRET_TOKEN|private@example/);
  });
  it.each(['GOVERNED_DISABLED','GOVERNED_TENANT_REQUIRED','GOVERNED_PREVIEW_UNAVAILABLE','UNLISTED'])('stores bounded retry code and reports preview: %s',async code=>{
    const call=vi.fn(async(op:string,_args:unknown[])=>op==='dispatchClaim'?{admissionId:id,lease:id,tenantId:'synthetic',command:{externalJobId:'vanta:jobs:2'}}:
      op==='previewClaim'?{id,lease:id,tenantId:'synthetic',externalJobId:'vanta:jobs:2',command:{}}:null);
    const report=vi.fn();const transport=vi.fn(async()=>{throw new GovernedTransportError(409,code);});
    await runSourcingAuthorityCycle({call} as unknown as SourcingRepository,transport,report);
    const receipt=call.mock.calls.find(c=>c[0]==='dispatchFinish') as unknown as [string,unknown[]];
    const result=receipt[1][2] as {kind:string;code:string};
    expect(result).toEqual({kind:'retry',code:`SOURCING_BIND_UNCERTAIN:REMOTE_409:${code}`});
    expect(result.code.length).toBeLessThanOrEqual(100);
    expect(report.mock.calls).toEqual([[`DISPATCH_REMOTE_409_${code}`],[`PREVIEW_REMOTE_409_${code}`]]);
    expect(call).toHaveBeenLastCalledWith('previewFinish',[id,id,{state:'pending'}]);
    expect(transport).toHaveBeenCalledTimes(2);
  });
});
