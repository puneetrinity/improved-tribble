import {describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {reconcileSparkRestore,type Query,type Restored} from './restore-reconcile';

const EPOCH='b5-unit-epoch-000000001';
const h=(c:string)=>c.repeat(64);
type Action='grant'|'withdraw';
type Event={event_id:string;subject_id:string;version:number;hash:string;acknowledged:boolean;action:Action};
type World={
 accounts:{subject_id:string;user_id:number;binding_id:string}[];events:Event[];
 flowAck:Map<string,{acknowledged_version:number;acknowledged_action:Action|null}>;
 profiles:{subject_id:string;command_id:string;d:number;p:number;f:number}[];commands:{subject_id:string;command_id:string}[];
 restricting:{directive_id:string;version:number;state:string;user_id:number}[];flowCursor:number;discoverCursor?:number;
 memSubjects:{subject_id:string;flow_binding_id:string}[];
 memConsent:Map<string,{highest_version:number;effective_version:number;effective_action:Action|null}>;
 receipts:{event_id:string;subject_id:string;version:number;digest:string}[];
 heads:{subject_id:string;draft_version:number;profile_version:number;preference_version:number}[];
 profileReceipts:{subject_id:string;command_id:string}[];
 directives:{directive_id:string;state:string;version:number}[];memoryCursor:number;
 privileged:boolean;attestation?:{run_id:string};
 // Mutations applied while the job is running (before its final check), or just before the reopening.
 duringRun?:(w:World)=>void;beforeAttest?:(w:World)=>void;
};
const actionAt=(v:number,withdrawAt?:number)=>withdrawAt!==undefined&&v>=withdrawAt?'withdraw':'grant';
function subject(w:World,{user=1,consent=1,flowAcked=consent,withdrawAt,head=[1,1,1],flowProfile=head}:
 {user?:number;consent?:number;flowAcked?:number;withdrawAt?:number;head?:number[];flowProfile?:number[]}={}){
 const s=randomUUID(),b=randomUUID();
 w.accounts.push({subject_id:s,user_id:user,binding_id:b});w.memSubjects.push({subject_id:s,flow_binding_id:b});
 for(let v=1;v<=Math.max(consent,flowAcked);v++){const id=randomUUID();
  w.events.push({event_id:id,subject_id:s,version:v,hash:h(String(v%10)),acknowledged:v<=flowAcked,action:actionAt(v,withdrawAt)});
  if(v<=consent)w.receipts.push({event_id:id,subject_id:s,version:v,digest:h(String(v%10))});}
 w.flowAck.set(s,{acknowledged_version:flowAcked,acknowledged_action:flowAcked?actionAt(flowAcked,withdrawAt):null});
 w.memConsent.set(s,{highest_version:consent,effective_version:consent,effective_action:consent?actionAt(consent,withdrawAt):null});
 w.heads.push({subject_id:s,draft_version:head[0]!,profile_version:head[1]!,preference_version:head[2]!});
 const command=randomUUID();w.profiles.push({subject_id:s,command_id:command,d:flowProfile[0]!,p:flowProfile[1]!,f:flowProfile[2]!});
 w.commands.push({subject_id:s,command_id:command});
 // Memory keeps the receipt unless this edit is the one the restore lost.
 if(flowProfile.every((v,i)=>v<=head[i]!))w.profileReceipts.push({subject_id:s,command_id:command});
 return s;
}
const fp=(w:World)=>JSON.stringify([w.memoryCursor,w.directives,[...w.memConsent],w.receipts,w.heads,w.profileReceipts,w.memSubjects]);
function world():World{return {accounts:[],events:[],flowAck:new Map(),profiles:[],commands:[],restricting:[],flowCursor:0,
 memSubjects:[],memConsent:new Map(),receipts:[],heads:[],profileReceipts:[],directives:[],memoryCursor:0,privileged:true};}
function deps(w:World,{failReplay=false}={}){
 const holds:Array<[string,string]>=[],attests:unknown[][]=[],replayed:string[]=[];let flowReads=0;
 const flow:Query=async q=>{
  if(q.includes('candidate_product_accounts')){if(++flowReads===2)w.duringRun?.(w);return {rows:w.accounts};}
  if(q.includes('candidate_consent_events'))return {rows:w.events};
  if(q.includes('candidate_profile_outbox'))return {rows:w.profiles};
  if(q.includes('candidate_profile_commands'))return {rows:w.commands};
  if(q.includes('candidate_privacy_remote_projection'))return {rows:w.restricting};
  if(q.includes('candidate_consent_subjects'))return {rows:[...w.flowAck].map(([subject_id,a])=>({subject_id,...a}))};
  if(q.includes('candidate_privacy_sync_state'))return {rows:[{cursor:w.flowCursor}]};
  throw Error('unexpected flow query '+q);
 };
 const discover:Query=async()=>({rows:[{cursor:w.discoverCursor}]});
 const memory:Query=async(q,p)=>{
  if(q.includes('FROM public.candidate_network_recovery_attestations'))return {rows:w.attestation?[w.attestation]:[]};
  if(q.includes('pg_roles'))return {rows:[{ok:w.privileged}]};
  if(q.includes('candidate_owned_subjects'))return {rows:w.memSubjects};
  if(q.includes('candidate_consent_state'))return {rows:[...w.memConsent].map(([subject_id,c])=>({subject_id,...c}))};
  if(q.includes('candidate_consent_receipts'))return {rows:w.receipts};
  if(q.includes('candidate_profile_heads'))return {rows:w.heads};
  if(q.includes('candidate_profile_receipts'))return {rows:w.profileReceipts};
  if(q.includes('candidate_privacy_directive_events'))return {rows:[{cursor:w.memoryCursor}]};
  if(q.includes('candidate_privacy_directives'))return {rows:w.directives.filter(d=>(p![0] as string[]).includes(d.directive_id))};
  if(q.includes('recovery_hold'))return holds.push([p![0] as string,p![2] as string]),{rows:[{n:1}]};
  if(q.includes('recovery_fingerprint()'))return {rows:[{f:fp(w)}]};
  if(q.includes('recovery_attest')){
   w.beforeAttest?.(w);
   // Memory recomputes the fingerprint with writes blocked; any change refuses the reopening.
   if(p![4]!==fp(w))throw Object.assign(Error('recovery_state_changed'),{code:'40001'});
   return attests.push([...p!]),{rows:[{ok:true}]};
  }
  throw Error('unexpected memory query '+q);
 };
 const redeliverConsent=async(eventId:string)=>{
  if(failReplay)throw Error('remote_unavailable');
  const e=w.events.find(x=>x.event_id===eventId)!;replayed.push(eventId);
  // The receiver applies it: Memory now holds the original identity, hash and effective choice.
  w.receipts.push({event_id:e.event_id,subject_id:e.subject_id,version:e.version,digest:e.hash});
  w.memConsent.set(e.subject_id,{highest_version:e.version,effective_version:e.version,effective_action:e.action});
 };
 return {deps:{flow,memory,redeliverConsent,discover},holds,attests,replayed};
}
const run=(w:World,restored:Restored,d=deps(w),confirm=true,runId=randomUUID())=>
 reconcileSparkRestore({epoch:EPOCH,runId,restored,confirmNoOutsidePrivacyChangeSinceBackup:confirm},d.deps).then(r=>({r,d}));
const reasons=(d:{holds:Array<[string,string]>},s:string)=>d.holds.filter(([x])=>x===s).map(([,r])=>r);

describe('B5 restore reconciliation',()=>{
 it('Memory restored: re-sends the lost withdrawal, holds the lost edit, then reopens',async()=>{
  const w=world();
  const x=subject(w,{consent:1,flowAcked:2,withdrawAt:2});   // withdrawal acknowledged, then lost
  const y=subject(w,{head:[1,1,1],flowProfile:[2,1,1]});      // acknowledged edit lost
  subject(w);                                                 // unaffected
  const {r,d}=await run(w,'memory');
  expect(d.replayed).toHaveLength(1);
  expect(w.memConsent.get(x)).toEqual({highest_version:2,effective_version:2,effective_action:'withdraw'});
  expect(d.holds).toEqual([[y,'profile_rewound']]);
  expect(r.attested).toBe(true);expect(r.blockers).toEqual([]);
  expect(d.attests[0]?.slice(0,3)).toEqual([EPOCH,r.runId,'memory']);
  expect(d.attests[0]?.[4]).toBe(fp(w));
 });
 it('an edit lost and then overwritten by a reused version number is still caught',async()=>{
  const w=world();const s=subject(w,{head:[2,1,1]});
  w.profileReceipts=w.profileReceipts.filter(c=>c.command_id!==w.profiles[0]!.command_id);
  expect(reasons((await run(w,'memory')).d,s)).toEqual(['profile_rewound']);
 });
 it('Codex probe 2: Memory profile ahead of Flow (Flow restored) is held',async()=>{
  const w=world();const s=subject(w,{head:[3,1,1]});
  // Memory applied a later command that the restored Flow never recorded.
  w.profileReceipts.push({subject_id:s,command_id:randomUUID()});
  const {r,d}=await run(w,'flow');
  expect(reasons(d,s)).toEqual(['profile_flow_behind']);expect(r.attested).toBe(true);
 });
 it('never replays consent the worker has not delivered yet',async()=>{
  const w=world();const s=subject(w,{consent:1});
  w.events.push({event_id:randomUUID(),subject_id:s,version:2,hash:h('2'),acknowledged:false,action:'withdraw'});
  const {r,d}=await run(w,'memory');
  expect(d.replayed).toEqual([]);expect(d.holds).toEqual([]);expect(r.attested).toBe(true);
 });
 it('both databases restored stays closed',async()=>{
  const w=world();subject(w);
  const {r,d}=await run(w,'both');
  expect(r.attested).toBe(false);expect(r.blockers).toEqual(['both_restored']);expect(d.attests).toEqual([]);
 });
 it('Codex probe 4: Memory restore needs confirmation that nothing outside Flow changed',async()=>{
  const w=world();subject(w);
  const {r}=await run(w,'memory',undefined,false);
  expect(r.attested).toBe(false);expect(r.blockers).toEqual(['privacy_history_unconfirmed']);
 });
 it('Codex probe 4: Memory privacy log behind what Flow already read stays closed even with confirmation',async()=>{
  const w=world();subject(w);w.flowCursor=12;w.memoryCursor=9;
  const {r}=await run(w,'memory');
  expect(r.attested).toBe(false);expect(r.blockers).toEqual(['privacy_feed_regressed']);
 });
 it('Codex probe 4: Discover is a second witness',async()=>{
  const w=world();subject(w);w.flowCursor=9;w.memoryCursor=9;w.discoverCursor=11;
  expect((await run(w,'memory')).r.blockers).toEqual(['privacy_feed_regressed']);
  w.discoverCursor=9;
  expect((await run(w,'memory')).r.attested).toBe(true);
 });
 it('a Flow restore does not trip the log check (Flow is the older side)',async()=>{
  const w=world();subject(w);w.flowCursor=3;w.memoryCursor=9;
  expect((await run(w,'flow')).r.attested).toBe(true);
 });
 it('Flow restored: Memory consent ahead, so the candidate is held but nothing is downgraded',async()=>{
  const w=world();const s=subject(w,{consent:2,flowAcked:1,withdrawAt:2});
  w.events=w.events.filter(e=>!(e.subject_id===s&&e.version===2));
  const {r,d}=await run(w,'flow');
  expect(d.replayed).toEqual([]);expect(reasons(d,s)).toEqual(['consent_flow_behind']);expect(r.attested).toBe(true);
 });
 it('same revision with different content is a conflict, never last-write-wins',async()=>{
  const w=world();const s=subject(w,{consent:1});w.receipts[0]!.digest=h('f');
  const {d}=await run(w,'memory');
  expect(reasons(d,s)).toEqual(['consent_conflict']);expect(d.replayed).toEqual([]);
 });
 it('same revision but a different effective choice is a conflict',async()=>{
  const w=world();const s=subject(w,{consent:2,withdrawAt:2});
  w.memConsent.set(s,{highest_version:2,effective_version:2,effective_action:'grant'});
  expect(reasons((await run(w,'memory')).d,s)).toEqual(['consent_conflict']);
 });
 it('a restriction Flow knows but Memory lost keeps recovery closed and holds the candidate',async()=>{
  const w=world();const s=subject(w,{user:7});
  w.restricting.push({directive_id:randomUUID(),version:2,state:'active_quarantine',user_id:7});
  const {r,d}=await run(w,'memory');
  expect(r.attested).toBe(false);expect(r.blockers).toEqual(['privacy_directive_missing']);
  expect(r.missingDirectives).toBe(1);expect(reasons(d,s)).toEqual(['privacy_directive_missing']);
 });
 it('Codex probe 1: Memory back at an earlier "requested" revision is not the restriction Flow saw',async()=>{
  const w=world();subject(w,{user:7});const id=randomUUID();
  w.restricting.push({directive_id:id,version:3,state:'active_quarantine',user_id:7});
  w.directives.push({directive_id:id,state:'requested',version:1});
  const {r}=await run(w,'memory');
  expect(r.attested).toBe(false);expect(r.blockers).toEqual(['privacy_directive_missing']);
 });
 it('same revision in a different state is also a lost transition',async()=>{
  const w=world();subject(w,{user:7});const id=randomUUID();
  w.restricting.push({directive_id:id,version:2,state:'active_quarantine',user_id:7});
  w.directives.push({directive_id:id,state:'needs_review',version:2});
  expect((await run(w,'memory')).r.blockers).toEqual(['privacy_directive_missing']);
 });
 it('a released directive in Memory does not count as the restriction Flow saw',async()=>{
  const w=world();subject(w,{user:7});const id=randomUUID();
  w.restricting.push({directive_id:id,version:2,state:'active_quarantine',user_id:7});w.directives.push({directive_id:id,state:'released',version:3});
  expect((await run(w,'memory')).r.blockers).toEqual(['privacy_directive_missing']);
 });
 it('the same or a later restricting revision in Memory is fine',async()=>{
  const w=world();subject(w,{user:7});const a=randomUUID(),b=randomUUID();
  w.restricting.push({directive_id:a,version:2,state:'active_quarantine',user_id:7},{directive_id:b,version:1,state:'verified',user_id:7});
  w.directives.push({directive_id:a,state:'active_quarantine',version:2},{directive_id:b,state:'active_quarantine',version:2});
  expect((await run(w,'memory')).r.attested).toBe(true);
 });
 it('a failed replay holds that candidate instead of claiming success',async()=>{
  const w=world();const s=subject(w,{consent:1,flowAcked:2,withdrawAt:2});
  const {r,d}=await run(w,'memory',deps(w,{failReplay:true}));
  expect(reasons(d,s)).toContain('consent_replay_failed');expect(r.consentReplayed).toBe(0);
 });
 it('Codex probe 3: a conflict appearing during the run is held and keeps recovery closed',async()=>{
  const w=world();const s=subject(w,{consent:1});
  // While the job runs, Memory's receipt for this revision diverges from Flow's event.
  w.duringRun=x=>{x.receipts.find(r=>r.subject_id===s)!.digest=h('e');};
  const {r,d}=await run(w,'memory');
  expect(reasons(d,s)).toEqual(['consent_conflict']);
  expect(r.attested).toBe(false);expect(r.blockers).toEqual(['state_changed_during_run']);
 });
 it('Codex probe 5: a restriction Flow reveals during the run that Memory lacks keeps recovery closed',async()=>{
  const w=world();const s=subject(w,{user:7});
  w.duringRun=x=>{x.restricting.push({directive_id:randomUUID(),version:2,state:'active_quarantine',user_id:7});};
  const {r,d}=await run(w,'memory');
  expect(r.attested).toBe(false);expect(r.blockers).toEqual(['privacy_directive_missing']);
  expect(reasons(d,s)).toEqual(['privacy_directive_missing']);expect(d.attests).toEqual([]);
 });
 it('Codex probe 6: Flow\'s privacy-log position passing Memory\'s during the run keeps recovery closed',async()=>{
  const w=world();subject(w);w.flowCursor=4;w.memoryCursor=4;
  w.duringRun=x=>{x.flowCursor=7;};
  const {r,d}=await run(w,'memory');
  expect(r.attested).toBe(false);expect(r.blockers).toEqual(['privacy_feed_regressed']);expect(d.attests).toEqual([]);
 });
 it('a Memory write between the final check and the reopening is refused by the fence',async()=>{
  const w=world();const s=subject(w);
  w.beforeAttest=x=>{x.heads.find(h=>h.subject_id===s)!.draft_version=9;};
  const {r,d}=await run(w,'memory');
  expect(r.attested).toBe(false);expect(r.blockers).toEqual(['state_changed_during_run']);expect(d.attests).toEqual([]);
 });
 it('a fence that cannot pause writes in time stays closed',async()=>{
  const w=world();subject(w);const d=deps(w);
  const memory=d.deps.memory;d.deps.memory=async(q,p)=>{if(q.includes('recovery_attest('))throw Object.assign(Error('lock'),{code:'55P03'});return memory(q,p);};
  const {r}=await run(w,'memory',d);
  expect(r.attested).toBe(false);expect(r.blockers).toEqual(['state_changed_during_run']);
 });
 it('Codex probe 3: a new acknowledged event during the run that Memory lacks is held, not ignored',async()=>{
  const w=world();const s=subject(w,{consent:1});
  w.duringRun=x=>{x.events.push({event_id:randomUUID(),subject_id:s,version:2,hash:h('2'),acknowledged:true,action:'withdraw'});
   x.flowAck.set(s,{acknowledged_version:2,acknowledged_action:'withdraw'});};
  const {d}=await run(w,'memory');
  expect(reasons(d,s)).toEqual(['consent_replay_failed']);
 });
 it('Codex probe 3: a profile command lost during the run is held by the final check',async()=>{
  const w=world();const s=subject(w);
  w.duringRun=x=>{const c=randomUUID();x.commands.push({subject_id:s,command_id:c});x.profiles.push({subject_id:s,command_id:c,d:2,p:1,f:1});};
  expect(reasons((await run(w,'memory')).d,s)).toEqual(['profile_rewound']);
 });
 it('a candidate Memory no longer knows is reported, not invented',async()=>{
  const w=world();const s=subject(w);w.memSubjects=w.memSubjects.filter(m=>m.subject_id!==s);w.memConsent.delete(s);
  w.profileReceipts=w.profileReceipts.filter(r=>r.subject_id!==s);
  const {r,d}=await run(w,'memory');
  expect(r.bindingMissing).toBe(1);expect(d.holds).toEqual([]);expect(d.replayed).toEqual([]);
 });
 it('rerun with the same run is idempotent; another run cannot reattest',async()=>{
  const w=world();subject(w);w.attestation={run_id:'11111111-1111-4111-8111-111111111111'};
  const same=await run(w,'memory',undefined,true,'11111111-1111-4111-8111-111111111111');
  expect(same.r.alreadyAttested).toBe(true);expect(same.d.holds).toEqual([]);
  const other=await run(w,'memory');
  expect(other.r.attested).toBe(false);expect(other.r.blockers).toEqual(['attestation_conflict']);
 });
 it('refuses a Memory reader that row security would silently filter',async()=>{
  const w=world();subject(w);w.privileged=false;
  const {r,d}=await run(w,'memory');
  expect(r.blockers).toEqual(['memory_reader_not_privileged']);expect(d.attests).toEqual([]);
 });
 it('rejects malformed input before touching either database',async()=>{
  const w=world();
  await expect(reconcileSparkRestore({epoch:'short',runId:randomUUID(),restored:'memory',confirmNoOutsidePrivacyChangeSinceBackup:true},deps(w).deps)).rejects.toThrow('invalid_reconcile_input');
 });
});
