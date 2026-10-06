import {afterEach,describe,expect,it,vi} from 'vitest';
vi.mock('./job-brief',()=>({jobIntentRequest:vi.fn().mockResolvedValue({ok:true})}));
import {jobIntentRequest} from './job-brief';
import {admissionCommand,changePreparation,readSourcing,readSourcingCapability,recordSourcingDecision,
  sourcingErrorMessage,startGovernedSourcing} from './sourcing-authority';

const id='10000000-0000-4000-8000-000000000001';
const quote={payerUserId:4,payerDisplayName:'Fixture recruiter',payerSlotId:id,remaining:3,windowStart:'2026-10-01T00:00:00.000Z',
  windowEnd:'2026-11-01T00:00:00.000Z',revision:7,briefVersionId:id,materialHash:'a'.repeat(64),artifactId:id,
  quotedAt:'2026-10-05T00:00:00.000Z',expiresAt:'2026-10-05T00:01:00.000Z',quoteToken:'signed-token'};
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();});
describe('governed sourcing browser contract',()=>{
  it('does not guess legacy mode when configuration fails',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false}));
    await expect(readSourcingCapability()).rejects.toThrow('unavailable');
  });
  it('uses only explicit true feature settings',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({jobBriefEnabled:true,sourcingEnabled:'true'})}));
    expect(await readSourcingCapability()).toEqual({jobBriefEnabled:true,sourcingEnabled:false});
  });
  it('pool read is a GET only, with no preparation write',async()=>{
    const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({state:'unavailable'})});vi.stubGlobal('fetch',fetch);
    expect(await readSourcing(12,'preview')).toEqual({state:'unavailable'});
    expect(fetch).toHaveBeenCalledWith('/api/jobs/12/sourcing/preview',{credentials:'include',cache:'no-store'});
    expect(jobIntentRequest).not.toHaveBeenCalled();
  });
  it('refuses malformed allowance quotes rather than accepting extra controls',()=>{
    expect(()=>admissionCommand({...quote,remaining:0})).toThrow();
    expect(()=>admissionCommand({...quote,forceSourcing:true} as typeof quote)).toThrow();
  });
  it('sends the confirmed payer slot and original signed quote without legacy force flags',async()=>{
    await startGovernedSourcing(3,12,quote);
    expect(jobIntentRequest).toHaveBeenCalledWith(3,12,'sourcing-admission','/api/jobs/12/find-candidates',{
      expectedRevision:7,briefVersionId:id,materialHash:'a'.repeat(64),artifactId:id,
      expectedPayerSlotId:id,expectedWindowStart:quote.windowStart,quoteToken:'signed-token'},'POST');
  });
  it('refresh and preparation retry require explicit commands',async()=>{
    await changePreparation(3,12,{action:'refresh',artifactId:id});
    expect(jobIntentRequest).toHaveBeenLastCalledWith(3,12,'sourcing-preparation','/api/jobs/12/sourcing/preview',{action:'refresh',artifactId:id},'POST');
    await changePreparation(3,12,{action:'retry_preparation',briefVersionId:id});
    expect(jobIntentRequest).toHaveBeenLastCalledWith(3,12,'sourcing-preparation','/api/jobs/12/sourcing/preview',{action:'retry_preparation',briefVersionId:id},'POST');
  });
  it('Pass and correction are explicit versioned decisions, never hide/unhide',async()=>{
    await recordSourcingDecision(3,12,14,2,'pass','skills_gap');
    expect(jobIntentRequest).toHaveBeenLastCalledWith(3,12,'sourcing-decision:14','/api/jobs/12/sourced-candidates/14',{expectedRevision:2,action:'pass',reasonCode:'skills_gap'});
    await recordSourcingDecision(3,12,14,3,'clear');
    expect(jobIntentRequest).toHaveBeenLastCalledWith(3,12,'sourcing-decision:14','/api/jobs/12/sourced-candidates/14',{expectedRevision:3,action:'clear'});
  });
  it('explains allowance exhaustion and requires renewed confirmation on payer changes',()=>{
    expect(sourcingErrorMessage('SOURCING_ALLOWANCE_EXHAUSTED')).toContain('Neither');
    expect(sourcingErrorMessage('SOURCING_PAYER_CHANGED')).toContain('fresh confirmation');
    expect(sourcingErrorMessage('SOURCING_PREPARING')).toContain('prepared');
  });
});
