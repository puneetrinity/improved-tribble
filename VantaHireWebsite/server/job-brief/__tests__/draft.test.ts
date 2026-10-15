import Groq from 'groq-sdk';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { draftBrief } from '../draft';
import type { BriefRepository } from '../repository';
import { sourceHash } from '../contracts';

const jd='Build Python services.';const requestId='10000000-0000-4000-8000-000000000001';
const payload={items:[{text:'Python',priority:'required',topic:'skill',terms:['Python'],minimum:null,maximum:null,quote:jd}],overflow:false};
const scope={organizationId:1,jobId:2,actorId:3};const input={requestId,expectedRevision:1};
function fixture(response:(init?:RequestInit)=>Response|Promise<Response>,lease=true,model='synthetic-model') {
  // The actual SDK executes request construction/error/retry handling. Only HTTP
  // transport is substituted, never credentials or a paid provider endpoint.
  const fetch=vi.fn(async(_url:unknown,init:unknown)=>response(init as RequestInit|undefined));
  const client=new Groq({apiKey:'synthetic-not-a-provider-key',baseURL:'https://fixture.invalid',fetch:fetch as unknown as typeof globalThis.fetch,maxRetries:7});
  const call=vi.fn(async(operation:string,args:unknown[])=>{
    if(operation==='read') return {revision:'1',currentJD:jd,sourceHash:sourceHash(jd),originalJD:null,legacyDescription:null};
    if(operation==='claim') return {requestId,state:'dispatched',...(lease?{lease:'20000000-0000-4000-8000-000000000001',currentJD:jd,sourceHash:sourceHash(jd),model}:{})};
    if(operation==='finish' || operation==='finishReview') return args[2];
    throw Error('Unexpected operation');
  });
  return {fetch,call,run:(signal?:AbortSignal)=>draftBrief({call} as unknown as BriefRepository,scope,input,{client,model,...(signal?{signal}:{})})};
}
function completion(content:string,finish_reason='stop') {return new Response(JSON.stringify({choices:[{index:0,finish_reason,message:{role:'assistant',content}}],usage:{prompt_tokens:20,completion_tokens:50}}),{status:200,headers:{'content-type':'application/json'}});}
describe('brief real SDK transport contract',()=>{
  beforeEach(()=>{vi.spyOn(console,'info').mockImplementation(()=>undefined);});
  afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
  it('automatic drafting is off by default and never dispatches when off',async()=>{
    vi.stubEnv('FLOW_JOB_BRIEF_ENABLED','true');vi.stubEnv('FLOW_JOB_BRIEF_AUTO_DRAFT_ENABLED','false');
    const call=vi.fn();
    expect(await draftBrief({call} as unknown as BriefRepository,scope,{...input,mode:'automatic'})).toEqual({state:'skipped'});
    expect(call).not.toHaveBeenCalled();
  });
  it('passes automatic intent to the durable gate and does not dispatch a skipped claim',async()=>{
    vi.stubEnv('FLOW_JOB_BRIEF_ENABLED','true');vi.stubEnv('FLOW_JOB_BRIEF_AUTO_DRAFT_ENABLED','true');
    const call=vi.fn(async(operation:string)=>operation==='read'?{revision:'1',currentJD:jd,sourceHash:sourceHash(jd),originalJD:null,legacyDescription:null}:{state:'skipped'});
    const create=vi.fn();const client={chat:{completions:{create}}} as unknown as Groq;
    expect(await draftBrief({call} as unknown as BriefRepository,scope,{...input,mode:'automatic'},{client,model:'synthetic-model'})).toEqual({state:'skipped'});
    expect(call).toHaveBeenLastCalledWith('claim',expect.arrayContaining(['automatic']));expect(create).not.toHaveBeenCalled();
  });
  it('produces only a validated proposal after the committed claim',async()=>{
    const f=fixture(()=>completion(JSON.stringify(payload)));
    expect(await f.run()).toMatchObject({state:'succeeded',result:{schemaVersion:3,criteria:[{label:'Python',use:'assessment'}]}});
    expect(f.call.mock.calls.map(c=>c[0])).toEqual(['read','claim','finishReview']);expect(f.fetch).toHaveBeenCalledOnce();
  });
  it.each([429,500,503])('does not let SDK retry HTTP %i despite client defaults',async(status)=>{
    const f=fixture(()=>new Response('{"error":{"message":"private provider body"}}',{status,headers:{'content-type':'application/json'}}));
    expect(await f.run()).toEqual({state:'failed',code:'BRIEF_MODEL_FAILED'});expect(f.fetch).toHaveBeenCalledOnce();
    expect(console.info).toHaveBeenCalledWith('brief_draft_diagnostic',expect.objectContaining({category:'provider_http',httpStatus:status}));
  });
  it.each(['broken JSON',JSON.stringify({...payload,approved:true}),JSON.stringify({...payload,items:[]}), 'x'.repeat(65537)])('refuses invalid output %#',async(content)=>{
    const f=fixture(()=>completion(content));expect(await f.run()).toMatchObject({state:'failed',code:'BRIEF_MODEL_INVALID'});
  });
  it('refuses truncation even when the returned JSON happens to parse',async()=>{
    const f=fixture(()=>completion(JSON.stringify(payload),'length'));expect(await f.run()).toEqual({state:'failed',code:'BRIEF_MODEL_TRUNCATED',inputTokens:20,outputTokens:50});
  });
  it('makes no second dispatch on an ambiguous/inflight claim replay',async()=>{
    const f=fixture(()=>completion(JSON.stringify(payload)),false);expect(await f.run()).toMatchObject({state:'dispatched'});
    expect(f.fetch).not.toHaveBeenCalled();expect(f.call.mock.calls.map(c=>c[0])).toEqual(['read','claim']);
  });
  it('refuses before claiming when settlement could not fit in the lease (no attempt, no paid call)',async()=>{
    const prior=process.env.PGPOOL_CONNECT_TIMEOUT_MS;
    try {
      for(const wait of ['0','45000']) {
        process.env.PGPOOL_CONNECT_TIMEOUT_MS=wait;
        const f=fixture(()=>completion(JSON.stringify(payload)));
        await expect(f.run()).rejects.toMatchObject({code:'BRIEF_MODEL_UNAVAILABLE'});
        expect(f.call.mock.calls.map(c=>c[0])).not.toContain('claim');expect(f.fetch).not.toHaveBeenCalled();
      }
    } finally { if(prior===undefined) delete process.env.PGPOOL_CONNECT_TIMEOUT_MS; else process.env.PGPOOL_CONNECT_TIMEOUT_MS=prior; }
  });
  it('a provider slower than the lease-derived budget is cut off and settled as a timeout, once',async()=>{
    const controller=new AbortController();let asked:number|undefined;
    const spy=vi.spyOn(AbortSignal,'timeout').mockImplementation((ms:number)=>{asked=ms;return controller.signal;});
    try {
      // Provider never answers on its own; like real HTTP, it stops when the request is aborted.
      const f=fixture(()=>new Promise<Response>((_,reject)=>controller.signal.addEventListener('abort',()=>reject(controller.signal.reason))));
      const done=f.run();
      await new Promise(r=>setTimeout(r,20));
      expect(asked).toBeGreaterThan(39_000);expect(asked).toBeLessThanOrEqual(40_000);   // lease-derived, not 45 s
      controller.abort(new DOMException('deadline','TimeoutError'));
      expect(await done).toMatchObject({state:'failed',code:'BRIEF_MODEL_TIMEOUT'});
      expect(f.fetch).toHaveBeenCalledTimes(1);
      expect(f.call.mock.calls.filter(c=>c[0]==='finish'||c[0]==='finishReview')).toHaveLength(1);
    } finally { spy.mockRestore(); }
  });
  it("the SDK's own request timer firing is reported as a timeout, not a generic failure",async()=>{
    // Only the SDK timer may fire: neutralise our deadline signal, advance a fake clock past the 40 s budget.
    const spy=vi.spyOn(AbortSignal,'timeout').mockImplementation(()=>new AbortController().signal);
    vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
    try {
      const f=fixture(init=>new Promise<Response>((_,reject)=>init?.signal?.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')))));
      const done=f.run();
      await vi.advanceTimersByTimeAsync(40_001);
      expect(await done).toMatchObject({state:'failed',code:'BRIEF_MODEL_TIMEOUT'});expect(f.fetch).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); spy.mockRestore(); }
  });
  it('settles an aborted request without retrying or exposing provider content',async()=>{
    const f=fixture(()=>{throw new DOMException('private timeout context','AbortError');});
    expect(await f.run()).toMatchObject({state:'failed'});expect(f.fetch).toHaveBeenCalledOnce();
  });
  it.each(['openai/gpt-oss-120b','synthetic-model'])('sends exact request settings for %s',async(model)=>{
    const f=fixture(()=>completion(JSON.stringify(payload)),true,model);await f.run();
    const body=JSON.parse((f.fetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.response_format).toEqual({type:'json_object'});
    // Inspect the real SDK's serialized request, not just a mocked completion.
    // The fixture JD contains no "json": the system instruction must supply it.
    expect(body.messages[0].content).toMatch(/\bJSON\b/i);
    if(model==='openai/gpt-oss-120b') {expect(body).toMatchObject({reasoning_effort:'medium',max_completion_tokens:4096});expect(body).not.toHaveProperty('max_tokens');}
    else {expect(body.max_tokens).toBe(4096);expect(body).not.toHaveProperty('reasoning_effort');}
  });
  it.each([
    ['broken secret JSON','extraction_invalid'],[JSON.stringify({...payload,secret:'private-marker'}),'extraction_invalid'],
    [JSON.stringify({...payload,items:[{...payload.items[0],topic:'not_a_topic'}]}),'extraction_invalid'],
    ['', 'empty_output'],['x'.repeat(65537),'output_oversize'],
  ])('classifies rejected content without leaking it (%s)',async(content,category)=>{
    const f=fixture(()=>completion(content));expect(await f.run()).toMatchObject({state:'failed',inputTokens:20,outputTokens:50});
    expect(console.info).toHaveBeenCalledWith('brief_draft_diagnostic',expect.objectContaining({category}));
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toMatch(/private-marker|broken secret|Build Python|lease/);
  });
  it.each(['tool_calls','function_call','private-marker'])('does not call %s truncation',async(reason)=>{
    const f=fixture(()=>completion('{}',reason));expect(await f.run()).toMatchObject({code:'BRIEF_MODEL_FAILED'});
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain('private-marker');
  });
  it.each([null,{prompt_tokens:1,completion_tokens:4097},{prompt_tokens:-1,completion_tokens:2}])('handles missing/invalid usage %#',async(usage)=>{
    const f=fixture(()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(payload)}}],usage}),{headers:{'content-type':'application/json'}}));
    const result=await f.run();expect(result).not.toHaveProperty('outputTokens');
    expect(result).toMatchObject({state:usage===null?'succeeded':'failed'});
  });
  it('does not retry ambiguous settlement',async()=>{
    const f=fixture(()=>completion(JSON.stringify(payload)));
    const original=f.call.getMockImplementation()!;
    f.call.mockImplementation(async(op,args)=>{if(op==='finishReview')throw Error('private-marker');return original(op,args);});
    await expect(f.run()).rejects.toThrow('private-marker');expect(f.fetch).toHaveBeenCalledOnce();
    expect(console.info).toHaveBeenCalledWith('brief_draft_diagnostic',expect.objectContaining({category:'settlement_unconfirmed'}));
  });
  it('logging cannot prevent settlement',async()=>{
    vi.mocked(console.info).mockImplementation(()=>{throw Error('logger');});
    expect(await fixture(()=>completion(JSON.stringify(payload))).run()).toMatchObject({state:'succeeded'});
  });
  it.each(['stale','unknown'])('reports database %s rather than local success',async(state)=>{
    const f=fixture(()=>completion(JSON.stringify(payload)));const original=f.call.getMockImplementation()!;
    f.call.mockImplementation(async(op,args)=>op==='finishReview'?{state}:original(op,args));
    expect(await f.run()).toEqual({state});expect(f.fetch).toHaveBeenCalledOnce();
    expect(console.info).toHaveBeenCalledWith('brief_draft_diagnostic',expect.objectContaining({settlement:state}));
  });
  it('refuses a missing choice without claiming truncation',async()=>{
    const f=fixture(()=>new Response('{"choices":[]}',{headers:{'content-type':'application/json'}}));
    expect(await f.run()).toEqual({state:'failed',code:'BRIEF_MODEL_FAILED'});
    expect(console.info).toHaveBeenCalledWith('brief_draft_diagnostic',expect.objectContaining({category:'unexpected_finish'}));
  });
});
