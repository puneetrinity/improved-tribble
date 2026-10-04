import Groq from 'groq-sdk';
import { describe,expect,it,vi } from 'vitest';
import { draftBrief } from '../draft';
import type { BriefRepository } from '../repository';
import { sourceHash } from '../contracts';

const jd='Build Python services.';const requestId='10000000-0000-4000-8000-000000000001';
const payload={schemaVersion:1,compilerVersion:1,taxonomyVersion:1,criteria:[{id:requestId,label:'Python',class:'must_have',subject:'skill',requirement:{kind:'text',value:'Python'},evidenceKinds:['profile_evidence'],use:'assessment',provenance:{kind:'jd',sourceHash:sourceHash(jd),start:6,end:12}}]};
const scope={organizationId:1,jobId:2,actorId:3};const input={requestId,expectedRevision:1};
function fixture(response:()=>Response|Promise<Response>,lease=true) {
  // The actual SDK executes request construction/error/retry handling. Only HTTP
  // transport is substituted, never credentials or a paid provider endpoint.
  const fetch=vi.fn(async()=>response());
  const client=new Groq({apiKey:'synthetic-not-a-provider-key',baseURL:'https://fixture.invalid',fetch:fetch as unknown as typeof globalThis.fetch,maxRetries:7});
  const call=vi.fn(async(operation:string,args:unknown[])=>{
    if(operation==='read') return {revision:'1',currentJD:jd,sourceHash:sourceHash(jd),originalJD:null,legacyDescription:null};
    if(operation==='claim') return {requestId,state:'dispatched',...(lease?{lease:'20000000-0000-4000-8000-000000000001',currentJD:jd,sourceHash:sourceHash(jd),model:'synthetic-model'}:{})};
    if(operation==='finish') return args[2];
    throw Error('Unexpected operation');
  });
  return {fetch,call,run:(signal?:AbortSignal)=>draftBrief({call} as unknown as BriefRepository,scope,input,{client,model:'synthetic-model',...(signal?{signal}:{})})};
}
function completion(content:string,finish_reason='stop') {return new Response(JSON.stringify({choices:[{index:0,finish_reason,message:{role:'assistant',content}}],usage:{prompt_tokens:20,completion_tokens:50}}),{status:200,headers:{'content-type':'application/json'}});}
describe('brief real SDK transport contract',()=>{
  it('produces only a validated proposal after the committed claim',async()=>{
    const f=fixture(()=>completion(JSON.stringify(payload)));
    expect(await f.run()).toMatchObject({state:'succeeded',result:payload});
    expect(f.call.mock.calls.map(c=>c[0])).toEqual(['read','claim','finish']);expect(f.fetch).toHaveBeenCalledOnce();
  });
  it.each([429,500,503])('does not let SDK retry HTTP %i despite client defaults',async(status)=>{
    const f=fixture(()=>new Response('{"error":{"message":"private provider body"}}',{status,headers:{'content-type':'application/json'}}));
    expect(await f.run()).toEqual({state:'failed',code:'BRIEF_MODEL_INVALID'});expect(f.fetch).toHaveBeenCalledOnce();
  });
  it.each(['broken JSON',JSON.stringify({...payload,approved:true}),JSON.stringify({...payload,criteria:[]}), 'x'.repeat(65537)])('refuses invalid output %#',async(content)=>{
    const f=fixture(()=>completion(content));expect(await f.run()).toMatchObject({state:'failed',code:'BRIEF_MODEL_INVALID'});
  });
  it('refuses truncation even when the returned JSON happens to parse',async()=>{
    const f=fixture(()=>completion(JSON.stringify(payload),'length'));expect(await f.run()).toEqual({state:'failed',code:'BRIEF_MODEL_TRUNCATED'});
  });
  it('makes no second dispatch on an ambiguous/inflight claim replay',async()=>{
    const f=fixture(()=>completion(JSON.stringify(payload)),false);expect(await f.run()).toMatchObject({state:'dispatched'});
    expect(f.fetch).not.toHaveBeenCalled();expect(f.call.mock.calls.map(c=>c[0])).toEqual(['read','claim']);
  });
  it('settles an aborted request without retrying or exposing provider content',async()=>{
    const f=fixture(()=>{throw new DOMException('private timeout context','AbortError');});
    expect(await f.run()).toMatchObject({state:'failed'});expect(f.fetch).toHaveBeenCalledOnce();
  });
});
