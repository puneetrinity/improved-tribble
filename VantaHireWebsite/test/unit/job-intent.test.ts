import {afterEach,describe,expect,it,vi} from 'vitest';
const apiRequest=vi.fn();
vi.mock('../../client/src/lib/queryClient',()=>({apiRequest:(...args:unknown[])=>apiRequest(...args)}));
import {jobIntentRequest} from '../../client/src/lib/job-brief';
import {changePreparation} from '../../client/src/lib/sourcing-authority';

const reply=(body:unknown)=>({json:async()=>body});
const send=()=>jobIntentRequest(7,42,'draft-retry','/api/jobs/42/brief/draft',{expectedRevision:1,mode:'manual'},'POST');
const ids=()=>apiRequest.mock.calls.map(c=>(c[2] as {requestId:string}).requestId);

describe('jobIntentRequest request identity',()=>{
  afterEach(()=>{apiRequest.mockReset();sessionStorage.clear();});
  it.each([
    ['retry_preparation','reserved','succeeded'],
    ['retry_preparation','started','failed'],
    ['refresh','pending','complete'],
    ['refresh','leased','unavailable'],
  ] as const)('preparation %s retains %s through errors and releases on %s',async(action,state,terminal)=>{
    const id='10000000-0000-4000-8000-000000000001';
    const run=()=>changePreparation(7,42,action==='refresh'?{action,artifactId:id}:{action,briefVersionId:id});
    apiRequest.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(run()).rejects.toThrow();
    apiRequest.mockResolvedValueOnce(reply({state}));await run();
    apiRequest.mockRejectedValueOnce(new Error('503: SOURCING_UNAVAILABLE'));
    await expect(run()).rejects.toThrow();
    apiRequest.mockResolvedValueOnce(reply({state}));await run();
    apiRequest.mockResolvedValueOnce(reply({state:terminal}));await run();
    apiRequest.mockResolvedValueOnce(reply({state}));await run();
    expect(new Set(ids().slice(0,5)).size).toBe(1);
    expect(ids()[5]).not.toBe(ids()[4]);
  });
  it.each(['reserved','bound','dispatched','needs_attention'])('retains unresolved admission state %s',async state=>{
    const run=()=>jobIntentRequest(7,42,'sourcing-admission','/api/jobs/42/find-candidates',{},'POST');
    apiRequest.mockResolvedValue(reply({state}));await run();await run();
    apiRequest.mockResolvedValueOnce(reply({state:'delivered'}));await run();
    apiRequest.mockResolvedValueOnce(reply({state:'reserved'}));await run();
    expect(new Set(ids().slice(0,3)).size).toBe(1);expect(ids()[3]).not.toBe(ids()[2]);
  });
  it.each(['save-brief','approve-brief','submit-brief','sourcing-decision:14'])('does not apply draft states to %s',async action=>{
    apiRequest.mockResolvedValue(reply({state:'reserved'}));
    await jobIntentRequest(7,42,action,'/synthetic',{});
    await jobIntentRequest(7,42,action,'/synthetic',{});
    expect(ids()[0]).not.toBe(ids()[1]);
  });
  it('lost response -> replay says dispatched -> another replay uses the same id -> terminal result clears it',async()=>{
    apiRequest.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(send()).rejects.toThrow();
    apiRequest.mockResolvedValueOnce(reply({state:'dispatched'}));
    expect(await send()).toMatchObject({state:'dispatched'});
    apiRequest.mockResolvedValueOnce(reply({state:'dispatched'}));
    expect(await send()).toMatchObject({state:'dispatched'});
    apiRequest.mockResolvedValueOnce(reply({state:'failed',code:'BRIEF_MODEL_FAILED'}));
    expect(await send()).toMatchObject({state:'failed'});
    // Released only now: the next deliberate request is new.
    apiRequest.mockResolvedValueOnce(reply({state:'review_required'}));
    await send();
    const all=ids();
    expect(new Set(all.slice(0,4)).size).toBe(1);
    expect(all[4]).not.toBe(all[3]);
  });
  it('keeps the id for reserved too, and for coded errors',async()=>{
    apiRequest.mockResolvedValueOnce(reply({state:'reserved'}));await send();
    apiRequest.mockRejectedValueOnce(new Error('503: BRIEF_UNAVAILABLE'));await expect(send()).rejects.toThrow();
    apiRequest.mockResolvedValueOnce(reply({state:'succeeded'}));await send();
    apiRequest.mockResolvedValueOnce(reply({ok:true}));await send();
    const all=ids();
    expect(new Set(all.slice(0,3)).size).toBe(1);expect(all[3]).not.toBe(all[2]);
  });
  it('results without a state (save, approve, submit) still release the id as before',async()=>{
    apiRequest.mockResolvedValue(reply({revision:'2',versionId:'v'}));
    await send();await send();
    const all=ids();expect(all[0]).not.toBe(all[1]);
  });
});
