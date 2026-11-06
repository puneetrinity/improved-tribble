import {describe,it,expect,vi} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {canonicalProfileJson} from './profile-contracts';
import {deliverInterpretationProposal,readInterpretationProposal} from './profile-client';
import {interpretCandidateText,parseInterpretationTransfer, type InterpretationDependencies,type InterpretationRequest,type InterpretationResponse} from './interpretation';
const versions={expectedDraftVersion:1,expectedProfileVersion:0,expectedPreferenceVersion:0,expectedPreferenceDraftRevision:2};
const request=():InterpretationRequest=>({schemaVersion:1,idempotencyKey:randomUUID(),...versions,use:'change_preferences',
 text:'I want permanent employment',sourceProposalId:null,sourceVersion:null,targetRowId:null});
const proposal={status:'proposal',summary:'Permanent employment',changes:[{kind:'preference_section',answer:{section:'employment_types',answered:true,value:['permanent']}}]};
function setup(){
 const entries=new Map<string,{hash:string;state:'reserved'|'sent'|'held'|'done';result?:InterpretationResponse}>();
 const deps:InterpretationDependencies={
  authorize:vi.fn(async()=>({authorityHash:'a'.repeat(64),versions,source:null,companyIds:[]})),
  budget:()=>({model:'production-model-from-config',maxInputTokens:10000,maxOutputTokens:1000,deadlineMs:20000,proposalTtlMs:86400000}),
  reserve:vi.fn(async input=>{
   const old=entries.get(input.idempotencyKey);
   if(old){if(old.hash!==input.requestHash)throw Error('idempotency_conflict');return old.result?{state:'replay',response:old.result}:{state:'held'};}
   entries.set(input.idempotencyKey,{hash:input.requestHash,state:'reserved'});return {state:'reserved',reservationId:input.idempotencyKey};
  }),
  dispatch:vi.fn(async id=>{const e=entries.get(id)!;if(e.state!=='reserved')return false;e.state='sent';return true;}),
  model:vi.fn(async()=>({content:JSON.stringify(proposal),usage:{inputTokens:100,outputTokens:100}})),
  settle:vi.fn(async(id,_authority,response)=>{const e=entries.get(id)!;e.state='done';e.result=response;return response;}),
  hold:vi.fn(async id=>{entries.get(id)!.state='held';}),now:()=>0,newId:()=> '00000000-0000-4000-8000-000000000001',
 };
 return {deps,entries,run:(r:unknown=request())=>interpretCandidateText(JSON.stringify(r),deps)};
}
describe('P6 isolated interpretation core; fake durable journal and model only',()=>{
 it('sends the exact proposal once, checks every receipt identity, and reads the immutable review',async()=>{
  const proposal=await setup().run();if(proposal.status!=='proposal')throw Error('fixture');
  const value={schemaVersion:1,commandId:randomUUID(),subjectId:randomUUID(),bindingId:randomUUID(),
   consentRevision:1,use:'change_preferences',sourceProposalId:null,sourceVersion:null,targetRowId:null,proposal};
  const raw=canonicalProfileJson(value),parsed=parseInterpretationTransfer(raw);
  const receipt={schemaVersion:1,commandId:value.commandId,subjectId:value.subjectId,bindingId:value.bindingId,
   commandHash:parsed.hash,proposalId:proposal.proposalId,proposalHash:proposal.proposalHash,outcome:'stored',reason:null};
  const fetcher=vi.fn(async()=>new Response(JSON.stringify(receipt)));
  const deps={env:{ACTIVEKG_BASE_URL:'https://memory.test'},sign:vi.fn(async()=>'signed'),fetch:fetcher as typeof fetch};
  expect(await deliverInterpretationProposal(raw,new AbortController().signal,deps)).toEqual(receipt);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const options=(fetcher.mock.calls as unknown as [string,RequestInit][])[0]![1];
  expect(options.body).toBe(raw);expect(options.redirect).toBe('error');
  expect(new Headers(options.headers).get('x-command-sha256')).toBe(parsed.hash);
  for(const field of ['commandId','subjectId','bindingId','commandHash','proposalId','proposalHash']){
   fetcher.mockImplementation(async()=>new Response(JSON.stringify({...receipt,[field]:field.endsWith('Hash')?'0'.repeat(64):randomUUID()})));
   await expect(deliverInterpretationProposal(raw,new AbortController().signal,deps)).rejects.toThrow();
  }
  fetcher.mockImplementation(async()=>new Response(JSON.stringify(proposal)));
  expect(await readInterpretationProposal(value.subjectId,value.bindingId,proposal.proposalId,deps)).toEqual(proposal);
 });
 it('transfers only a canonical immutable proposal, refusing drift, transcript fields and duplicate changes',async()=>{
  const result=await setup().run();
  expect(result.status).toBe('proposal');
  const value={schemaVersion:1,commandId:randomUUID(),subjectId:randomUUID(),bindingId:randomUUID(),
   consentRevision:1,use:'change_preferences',sourceProposalId:null,sourceVersion:null,targetRowId:null,proposal:result};
  const raw=canonicalProfileJson(value);
  expect(parseInterpretationTransfer(raw).value).toEqual(value);
  expect(()=>parseInterpretationTransfer(JSON.stringify(value))).toThrow();
  expect(()=>parseInterpretationTransfer(canonicalProfileJson({...value,prompt:'private text'}))).toThrow();
  expect(()=>parseInterpretationTransfer(canonicalProfileJson({...value,proposal:{...result,summary:'tampered'}}))).toThrow();
  if(result.status!=='proposal')throw Error('fixture');
  const {proposalHash:_,...body}=result;
  const duplicated={...body,changes:[...body.changes,...body.changes]};
  const proposalHash=createHash('sha256').update(canonicalProfileJson(duplicated)).digest('hex');
  expect(()=>parseInterpretationTransfer(canonicalProfileJson({...value,proposal:{...duplicated,proposalHash}}))).toThrow('duplicate_change');
 });
 it('returns a server-versioned proposal without applying it, and replays without a second call',async()=>{
  const {deps,run}=setup(),r=request(),first=await run(r);
  expect(first).toMatchObject({schemaVersion:1,status:'proposal',...versions,expiresAt:'1970-01-02T00:00:00.000Z'});
  expect(first).toHaveProperty('proposalHash');expect(await run(r)).toEqual(first);expect(deps.model).toHaveBeenCalledTimes(1);
 });
 it('concurrent same-key requests only dispatch once',async()=>{
  const {deps,run}=setup(),r=request();await Promise.all([run(r),run(r)]);expect(deps.model).toHaveBeenCalledTimes(1);
 });
 it('changed input cannot reuse a purchase',async()=>{
  const {run}=setup(),r=request();await run(r);await expect(run({...r,text:'Different text'})).rejects.toThrow('idempotency_conflict');
 });
 it('unset budgets and oversized input refuse before reservation',async()=>{
  const {deps,run}=setup();deps.budget=()=>null;expect(await run()).toMatchObject({reason:'budget_unavailable'});expect(deps.reserve).not.toHaveBeenCalled();
 });
 it('ownership and stale versions are checked before purchase',async()=>{
  const {deps,run}=setup();await expect(run({...request(),expectedDraftVersion:0})).rejects.toThrow('stale_edit');expect(deps.reserve).not.toHaveBeenCalled();
  deps.authorize=vi.fn(async()=>{throw Error('not_found');});await expect(run()).rejects.toThrow('not_found');expect(deps.model).not.toHaveBeenCalled();
 });
 it('dispatch refusal never calls the model',async()=>{
  const {deps,run}=setup();deps.dispatch=vi.fn(async()=>false);
  expect(await run()).toMatchObject({status:'cannot_help',reason:'budget_unavailable'});
  expect(deps.model).not.toHaveBeenCalled();
 });
 it('missing usage or lost model reply holds spend and never rebuys',async()=>{
  const {deps,run}=setup(),r=request();deps.model=vi.fn(async()=>({content:'{}',usage:null}));
  await run(r);await run(r);expect(deps.hold).toHaveBeenCalledWith(r.idempotencyKey,'outcome_unknown');expect(deps.model).toHaveBeenCalledTimes(1);
 });
 it('over-budget usage is held rather than treated as free or saved',async()=>{
  const {deps,run}=setup();deps.model=vi.fn(async()=>({content:JSON.stringify(proposal),usage:{inputTokens:100,outputTokens:1001}}));
  await run();expect(deps.hold).toHaveBeenCalledWith(expect.any(String),'budget_breach');expect(deps.settle).not.toHaveBeenCalled();
 });
 it('malformed paid output is settled, not bought again',async()=>{
  const {deps,run}=setup(),r=request();deps.model=vi.fn(async()=>({content:'not JSON',usage:{inputTokens:100,outputTokens:2}}));
  expect(await run(r)).toMatchObject({status:'cannot_help',reason:'unsafe'});await run(r);expect(deps.model).toHaveBeenCalledTimes(1);expect(deps.settle).toHaveBeenCalledTimes(1);
 });
 it('a lost settle reply holds and recovers the durable result without another model call',async()=>{
  const {deps,run}=setup(),r=request(),settle=deps.settle;deps.settle=vi.fn(async(...args)=>{await settle(...args);throw Error('reply_lost');});
  await run(r);expect(await run(r)).toMatchObject({status:'proposal'});expect(deps.model).toHaveBeenCalledTimes(1);
 });
 it('contacts are scrubbed in model input and raw text is not passed to journal methods',async()=>{
  const {deps,run}=setup(),r={...request(),text:'Email me at synthetic@example.invalid'};await run(r);
  expect(JSON.stringify(vi.mocked(deps.model).mock.calls)).not.toContain('synthetic@example.invalid');
  expect(JSON.stringify(vi.mocked(deps.reserve).mock.calls)).not.toContain(r.text);
 });
 it.each([
  {...proposal,subjectId:randomUUID()},
  {...proposal,changes:[{kind:'preference_section',answer:{section:'authorisation',answered:true,value:[]}}]},
  {...proposal,changes:[{kind:'exclusions',restrictions:[{kind:'remote_only'}]}]},
  {...proposal,changes:[{kind:'preference_section',answer:{section:'availability',answered:true,value:{mode:'notice_days',days:90}}}]},
  {...proposal,summary:'Contact synthetic@example.invalid'},
 ])('refuses authority expansion, invented numbers, wrong-use changes and contact leakage %#',async output=>{
  const {deps,run}=setup();deps.model=vi.fn(async()=>({content:JSON.stringify(output),usage:{inputTokens:100,outputTokens:100}}));
  expect(await run()).toMatchObject({status:'cannot_help',reason:'unsafe'});
 });
 it('does not accept invented company identifiers',async()=>{
  const {deps,run}=setup();deps.model=vi.fn(async()=>({content:JSON.stringify({status:'proposal',summary:'Exclude company',changes:[{kind:'exclusions',restrictions:[{kind:'exclude_company',companyId:randomUUID()}]}]}),usage:{inputTokens:100,outputTokens:100}}));
  expect(await run({...request(),use:'private_exclusions'})).toMatchObject({status:'cannot_help'});
 });
 it('keeps unsupported exclusions only as the candidate\'s exact private note',async()=>{
  const {deps,run}=setup(),r={...request(),use:'private_exclusions' as const,text:'No companies with more than 200 people'};
  const note={status:'proposal',summary:'Keep as a private note, not a filter',changes:[{kind:'preference_section',answer:{section:'private_notes',answered:true,value:[r.text]}}]};
  deps.model=vi.fn(async()=>({content:JSON.stringify(note),usage:{inputTokens:100,outputTokens:100}}));
  expect(await run(r)).toMatchObject({status:'proposal',changes:note.changes});
  note.changes[0]!.answer.value=['Prefer small companies'];
  expect(await run({...r,idempotencyKey:randomUUID()})).toMatchObject({status:'cannot_help',reason:'unsafe'});
 });
 it('refuses an over-budget prompt before reserving or calling the model',async()=>{
  const {deps,run}=setup(),budget=deps.budget()!;deps.budget=()=>({...budget,maxInputTokens:1});
  expect(await run()).toMatchObject({reason:'budget_unavailable'});
  expect(deps.reserve).not.toHaveBeenCalled();expect(deps.model).not.toHaveBeenCalled();
 });
 it('does not let the model choose server proposal identity or validity',async()=>{
  const {deps,run}=setup();
  deps.model=vi.fn(async()=>({content:JSON.stringify({...proposal,proposalId:randomUUID(),expiresAt:'2999-01-01T00:00:00.000Z'}),usage:{inputTokens:100,outputTokens:100}}));
  expect(await run()).toMatchObject({status:'cannot_help',reason:'unsafe'});
 });
 it('refuses browser-supplied ownership and duplicate JSON keys before authorization',async()=>{
  const {deps,run}=setup();
  await expect(run({...request(),subjectId:randomUUID()})).rejects.toThrow();
  await expect(interpretCandidateText('{"schemaVersion":1,"schemaVersion":1}',deps)).rejects.toThrow();
  expect(deps.authorize).not.toHaveBeenCalled();expect(deps.model).not.toHaveBeenCalled();
 });
 it('reports stale_edit for an intact replay against changed profile versions without buying again',async()=>{
  const {deps,run}=setup(),r=request();const saved=await run(r);
  deps.authorize=vi.fn(async()=>({authorityHash:'b'.repeat(64),versions:{...versions,expectedDraftVersion:2},source:null,companyIds:[]}));
  deps.reserve=vi.fn(async()=>({state:'replay' as const,response:saved}));
  await expect(run({...r,expectedDraftVersion:2})).rejects.toThrow('stale_edit');
  expect(deps.model).toHaveBeenCalledTimes(1);
 });
 it('requires a new key for an edited request but reuses the key for an unchanged retry',async()=>{
  const {deps,run}=setup(),r=request();const first=await run(r);
  expect(await run(r)).toEqual(first);expect(deps.model).toHaveBeenCalledTimes(1);
  await expect(run({...r,text:'I prefer permanent employment'})).rejects.toThrow('idempotency_conflict');
  expect(deps.model).toHaveBeenCalledTimes(1);
  expect((await run({...r,idempotencyKey:randomUUID(),text:'I prefer permanent employment'})).status).toBe('proposal');
  expect(deps.model).toHaveBeenCalledTimes(2);
 });
 it('refuses corrupted stored proposals without buying again',async()=>{
  const {deps,run,entries}=setup(),r=request();await run(r);
  const result=entries.get(r.idempotencyKey)!.result!;
  if(result.status!=='proposal')throw Error('fixture');
  result.summary='Corrupted stored result';
  await expect(run(r)).rejects.toThrow('invalid_stored_proposal');
  expect(deps.model).toHaveBeenCalledTimes(1);
 });
 it('holds a mismatched settlement reply instead of returning it as success',async()=>{
  const {deps,run}=setup();deps.settle=vi.fn(async()=>({schemaVersion:1,status:'clarify',question:'Different answer'}));
  expect(await run()).toMatchObject({status:'cannot_help'});
  expect(deps.hold).toHaveBeenCalledWith(expect.any(String),'outcome_unknown');
 });
 it('the total model deadline aborts once and does not settle a late result',async()=>{
  vi.useFakeTimers();try{
   const {deps,run}=setup();let signal:AbortSignal|undefined;
   deps.model=vi.fn(async input=>{signal=input.signal;return new Promise(()=>{});});
   const pending=run();await vi.advanceTimersByTimeAsync(20000);await pending;
   expect(signal?.aborted).toBe(true);expect(deps.hold).toHaveBeenCalledTimes(1);expect(deps.settle).not.toHaveBeenCalled();
  }finally{vi.useRealTimers();}
 });
});
