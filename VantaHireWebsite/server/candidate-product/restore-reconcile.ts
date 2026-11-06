// B5 restore reconciliation (Claude, 5 Nov 2026). Operator capability only: never mounted on a route and
// never run by the web/worker processes. It runs while Memory's recovery gate is closed (a new
// CANDIDATE_NETWORK_RECOVERY_EPOCH deployed BEFORE the restore) and reopens native Spark discovery only
// by attesting that epoch once nothing remains unproven.
//
// Rules (Codex B5 design, first slice):
//  - Privacy first. Flow's retained consent events are the authority for candidate choices: an
//    acknowledged event Memory lost is re-sent through the normal signed receiver with its original
//    identity and hash. A restriction is never downgraded and no grant is invented.
//  - Anything that cannot be proven current is held per candidate (publications held, never deleted);
//    the candidate's next confirmation publishes a fresh version.
//  - Recovery stays closed when both databases were restored, when an active privacy restriction known
//    to Flow is missing or older in Memory, when Memory's privacy change log ends before what Flow or
//    Discover already read (restrictions from any source were lost), or when the operator has not
//    confirmed that no erasure and no restriction outside Flow (operator, Discover) changed since the backup.
//  - The final check re-reads both systems; any remaining mismatch is held, never ignored.
//  - Old recruiter searches, applications and stored publications are not rewritten.
// Output and the attestation carry counts only; per-subject detail is returned to the operator CLI.

export type Query=(sql:string,params?:readonly unknown[])=>Promise<{rows:any[]}>;
export type Restored='none'|'memory'|'flow'|'both';
export type HoldReason='profile_rewound'|'profile_flow_behind'|'consent_conflict'|'consent_flow_behind'|'consent_replay_failed'|'privacy_directive_missing';
export type Blocker='both_restored'|'privacy_directive_missing'|'privacy_feed_regressed'|'privacy_history_unconfirmed'|'memory_reader_not_privileged'|'attestation_conflict'|'state_changed_during_run';
export interface ReconcileInput{epoch:string;runId:string;restored:Restored;confirmNoOutsidePrivacyChangeSinceBackup:boolean}
// discover is optional: when given, its privacy-feed position is a second independent witness.
export interface ReconcileDeps{flow:Query;memory:Query;discover?:Query;redeliverConsent:(eventId:string)=>Promise<void>}
export interface ReconcileReport{
 epoch:string;runId:string;restored:Restored;attested:boolean;alreadyAttested:boolean;
 blockers:Blocker[];subjects:{flow:number;memory:number;union:number};
 consentReplayed:number;holds:Record<HoldReason,number>;bindingMissing:number;missingDirectives:number;
 detail:{held:Array<{subjectId:string;reason:HoldReason}>;bindingMissing:string[];missingDirectives:string[]};
}

const EPOCH=/^[A-Za-z0-9_-]{16,128}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const num=(v:unknown)=>v===null||v===undefined?0:Number(v);

interface FlowEvent{eventId:string;subjectId:string;version:number;hash:string;acknowledged:boolean}
interface MemoryConsent{highest:number;effectiveVersion:number;effectiveAction:string|null;receipts:Map<number,{eventId:string;digest:string}>}
interface FlowConsent{ackVersion:number;ackAction:string|null}

async function readFlow(flow:Query){
 const accounts=(await flow('SELECT subject_id::text,user_id,binding_id::text FROM public.candidate_product_accounts')).rows;
 const events=(await flow(`SELECT e.event_id::text,e.subject_id::text,e.version,e.command_sha256::text AS hash,
   coalesce(o.state='acknowledged',false) AS acknowledged
  FROM public.candidate_consent_events e LEFT JOIN public.candidate_consent_outbox o USING(event_id)
  WHERE e.schema_version=2 ORDER BY e.subject_id,e.version`)).rows;
 // Every command Memory acknowledged as applied. Matched by command id, so version numbers reused
 // after a restore cannot hide a lost edit.
 const profiles=(await flow(`SELECT c.subject_id::text,c.command_id::text,
   (o.receipt->>'draftVersion')::bigint AS d,(o.receipt->>'profileVersion')::bigint AS p,
   (o.receipt->>'preferenceVersion')::bigint AS f
  FROM public.candidate_profile_outbox o JOIN public.candidate_profile_commands c USING(command_id)
  WHERE o.state='applied' AND o.receipt->>'status'='applied'`)).rows;
 // Every command Flow ever created; Memory receipts outside this set mean Memory is ahead of Flow.
 const commands=(await flow('SELECT subject_id::text,command_id::text FROM public.candidate_profile_commands')).rows;
 // Restrictions Flow last saw as active in Memory, with the version and state it saw.
 const restricting=(await flow(`SELECT p.directive_id::text,p.version,p.state,r.actor_user_id AS user_id
  FROM public.candidate_privacy_remote_projection p JOIN public.candidate_privacy_requests r USING(request_id)
  WHERE p.decision<>'allow'`)).rows;
 const consent=(await flow(`SELECT subject_id::text,acknowledged_version,acknowledged_action
  FROM public.candidate_consent_subjects`)).rows;
 const feed=(await flow("SELECT cursor FROM public.candidate_privacy_sync_state WHERE consumer_name='flow'")).rows[0];
 return {accounts,events,profiles,commands,restricting,feedCursor:num(feed?.cursor),
  consent:new Map<string,FlowConsent>(consent.map((c:any)=>[c.subject_id,{ackVersion:num(c.acknowledged_version),ackAction:c.acknowledged_action??null}]))};
}

async function readMemory(memory:Query,directiveIds:string[]){
 const subjects=(await memory('SELECT subject_id::text,flow_binding_id::text FROM public.candidate_owned_subjects')).rows;
 const consent=(await memory('SELECT subject_id::text,highest_version,effective_version,effective_action FROM public.candidate_consent_state')).rows;
 const receipts=(await memory('SELECT event_id::text,subject_id::text,version,command_digest::text AS digest FROM public.candidate_consent_receipts')).rows;
 const heads=(await memory('SELECT subject_id::text,draft_version,profile_version,preference_version FROM public.candidate_profile_heads')).rows;
 const profileReceipts=(await memory(`SELECT subject_id::text,command_id::text FROM public.candidate_profile_receipts
  UNION ALL SELECT subject_id::text,command_id::text FROM public.candidate_profile_source_receipts
  UNION ALL SELECT subject_id::text,command_id::text FROM public.candidate_profile_interpretation_receipts`)).rows;
 const feed=(await memory('SELECT coalesce(max(cursor),0) AS cursor FROM public.candidate_privacy_directive_events')).rows[0];
 const directives=directiveIds.length?(await memory(
  'SELECT directive_id::text,state,version FROM public.candidate_privacy_directives WHERE directive_id=ANY($1::uuid[])',[directiveIds])).rows:[];
 const byConsent=new Map<string,MemoryConsent>();
 for(const c of consent)byConsent.set(c.subject_id,{highest:num(c.highest_version),effectiveVersion:num(c.effective_version),
  effectiveAction:c.effective_action??null,receipts:new Map()});
 for(const r of receipts){const c=byConsent.get(r.subject_id);if(c)c.receipts.set(num(r.version),{eventId:r.event_id,digest:r.digest});}
 return {subjects,byConsent,heads:new Map(heads.map((h:any)=>[h.subject_id,h])),
  profileReceipts:new Set<string>(profileReceipts.map((r:any)=>r.command_id)),
  profileReceiptRows:profileReceipts as Array<{subject_id:string;command_id:string}>,feedCursor:num(feed?.cursor),
  directives:new Map(directives.map((d:any)=>[d.directive_id,d]))};
}

/** Compare one subject's consent. Returns the acknowledged Flow events Memory is missing, or a hold. */
function compareConsent(events:FlowEvent[],mem:MemoryConsent|undefined,flow?:FlowConsent):{replay:FlowEvent[];hold?:HoldReason}{
 const highest=mem?.highest??0;
 for(const e of events){
  if(e.version>highest)continue;
  const r=mem?.receipts.get(e.version);
  // Same revision with different content is a conflict, never last-write-wins.
  if(!r||r.eventId!==e.eventId||r.digest!==e.hash)return {replay:[],hold:'consent_conflict'};
 }
 const flowMax=events.reduce((m,e)=>Math.max(m,e.version),0);
 if(highest>flowMax)return {replay:[],hold:'consent_flow_behind'};
 // At the revision Flow last saw acknowledged, Memory's effective choice must be that same choice.
 if(flow&&flow.ackVersion>0&&highest===flow.ackVersion&&mem
  &&(mem.effectiveVersion!==flow.ackVersion||mem.effectiveAction!==flow.ackAction))return {replay:[],hold:'consent_conflict'};
 // Only events Memory had acknowledged before the restore. Pending ones are the normal worker's job.
 const missing=events.filter(e=>e.version>highest&&e.acknowledged);
 // Replay must be contiguous from Memory's head, or ordering cannot be proven.
 for(let i=0;i<missing.length;i++)if(missing[i]!.version!==highest+1+i)return {replay:[],hold:'consent_conflict'};
 return {replay:missing};
}

export async function reconcileSparkRestore(input:ReconcileInput,deps:ReconcileDeps):Promise<ReconcileReport>{
 if(!EPOCH.test(input.epoch)||!UUID.test(input.runId)||!['none','memory','flow','both'].includes(input.restored))
  throw Error('invalid_reconcile_input');
 const holds:Record<HoldReason,number>={profile_rewound:0,profile_flow_behind:0,consent_conflict:0,consent_flow_behind:0,consent_replay_failed:0,privacy_directive_missing:0};
 const report:ReconcileReport={epoch:input.epoch,runId:input.runId,restored:input.restored,attested:false,alreadyAttested:false,
  blockers:[],subjects:{flow:0,memory:0,union:0},consentReplayed:0,holds,bindingMissing:0,missingDirectives:0,
  detail:{held:[],bindingMissing:[],missingDirectives:[]}};
 const existing=(await deps.memory('SELECT run_id::text FROM public.candidate_network_recovery_attestations WHERE epoch=$1',[input.epoch])).rows[0];
 if(existing){
  if(existing.run_id!==input.runId){report.blockers.push('attestation_conflict');return report;}
  report.attested=report.alreadyAttested=true;return report;
 }
 // Whole-population reads must not be silently filtered by row security.
 const reader=(await deps.memory('SELECT rolsuper OR rolbypassrls AS ok FROM pg_roles WHERE rolname=current_user')).rows[0];
 if(!reader?.ok){report.blockers.push('memory_reader_not_privileged');return report;}
 if(input.restored==='both')report.blockers.push('both_restored');
 if(input.restored==='memory'&&!input.confirmNoOutsidePrivacyChangeSinceBackup)report.blockers.push('privacy_history_unconfirmed');

 const held=new Set<string>();
 const hold=async(subjectId:string,reason:HoldReason)=>{
  if(held.has(`${subjectId}:${reason}`))return;held.add(`${subjectId}:${reason}`);
  await deps.memory('SELECT public.candidate_network_recovery_hold($1::uuid,$2,$3)',[subjectId,input.epoch,reason]);
  holds[reason]++;report.detail.held.push({subjectId,reason});
 };

 const flow=await readFlow(deps.flow);
 let memory=await readMemory(deps.memory,flow.restricting.map((r:any)=>r.directive_id));
 const memorySubjects=new Map(memory.subjects.map((s:any)=>[s.subject_id,s.flow_binding_id]));
 const eventsBySubject=new Map<string,FlowEvent[]>();
 for(const e of flow.events){const list=eventsBySubject.get(e.subject_id)??[];
  list.push({eventId:e.event_id,subjectId:e.subject_id,version:num(e.version),hash:e.hash,acknowledged:e.acknowledged===true});
  eventsBySubject.set(e.subject_id,list);}
 const union=new Set<string>([...flow.accounts.map((a:any)=>a.subject_id),...memorySubjects.keys(),...eventsBySubject.keys()]);
 report.subjects={flow:flow.accounts.length,memory:memorySubjects.size,union:union.size};
 const flowBinding=new Map(flow.accounts.map((a:any)=>[a.subject_id,a.binding_id]));
 const subjectByUser=new Map(flow.accounts.map((a:any)=>[Number(a.user_id),a.subject_id]));

 const block=(b:Blocker)=>{if(!report.blockers.includes(b))report.blockers.push(b);};
 const seenDirectives=new Set<string>();
 const checkPrivacy=async(f:typeof flow,m:typeof memory)=>{
  // 1a. Restrictions from any source. Memory's change log must reach at least as far as what Flow (and
  //     Discover, when given) already consumed; otherwise events were lost. Supporting evidence only:
  //     log positions can be reused after a restore, so the operator confirmation stays mandatory.
  const witnesses=[f.feedCursor];
  if(deps.discover){const d=(await deps.discover(`SELECT cursor FROM public.candidate_privacy_sync_state WHERE consumer_name='discover'`)).rows[0];witnesses.push(num(d?.cursor));}
  if(input.restored!=='flow'&&Math.max(...witnesses)>m.feedCursor)block('privacy_feed_regressed');
  // 1b. Flow-known restrictions. Missing, older (lower version), a different state at the same version,
  //     or released means a transition was lost; it cannot be replayed without its history.
  const memorySet=new Set(m.subjects.map((x:any)=>x.subject_id));
  for(const r of f.restricting){
   const d=m.directives.get(r.directive_id);
   if(!d||num(d.version)<num(r.version)||(num(d.version)===num(r.version)&&d.state!==r.state)||['released','superseded'].includes(d.state)){
    if(!seenDirectives.has(r.directive_id)){seenDirectives.add(r.directive_id);report.missingDirectives++;report.detail.missingDirectives.push(r.directive_id);}
    const sub=new Map(f.accounts.map((a:any)=>[Number(a.user_id),a.subject_id])).get(Number(r.user_id));
    if(sub&&memorySet.has(sub))await hold(sub,'privacy_directive_missing');
    block('privacy_directive_missing');
   }
  }
 };
 await checkPrivacy(flow,memory);

 // 2. Consent, then 3. profile. Subjects absent from Memory have nothing that can be exposed; they are
 //    reported for re-linking rather than held.
 for(const subjectId of [...union].sort()){
  const events=eventsBySubject.get(subjectId)??[];
  if(!memorySubjects.has(subjectId)){
   if(flowBinding.has(subjectId)){report.bindingMissing++;report.detail.bindingMissing.push(subjectId);}
   continue;
  }
  if(flowBinding.has(subjectId)&&memorySubjects.get(subjectId)!==flowBinding.get(subjectId)){await hold(subjectId,'consent_conflict');continue;}
  const consent=compareConsent(events,memory.byConsent.get(subjectId),flow.consent.get(subjectId));
  if(consent.hold)await hold(subjectId,consent.hold);
  for(const e of consent.replay){
   try{await deps.redeliverConsent(e.eventId);report.consentReplayed++;}
   catch{await hold(subjectId,'consent_replay_failed');break;}
  }
 }
 const checkProfiles=async(f:typeof flow,m:typeof memory)=>{
  const present=new Set(m.subjects.map((x:any)=>x.subject_id));
  for(const p of f.profiles){
   const h=m.heads.get(p.subject_id);if(!h||!present.has(p.subject_id))continue;
   if(!m.profileReceipts.has(p.command_id)||num(p.d)>num(h.draft_version)||num(p.p)>num(h.profile_version)
    ||num(p.f)>num(h.preference_version))await hold(p.subject_id,'profile_rewound');
  }
  // Memory applied a command Flow has no record of: Flow was restored behind Memory.
  const known=new Set(f.commands.map((c:any)=>c.command_id));
  const accounts=new Set(f.accounts.map((a:any)=>a.subject_id));
  for(const r of m.profileReceiptRows)if(accounts.has(r.subject_id)&&present.has(r.subject_id)&&!known.has(r.command_id))await hold(r.subject_id,'profile_flow_behind');
 };
 memory=await readMemory(deps.memory,[]);
 await checkProfiles(flow,memory);

 // 4. Final check: re-read BOTH systems after repairs (catches changes made during the run) and re-run
 //    every check. Memory's state is fingerprinted before and after; the reopening is then fenced in
 //    Memory against that fingerprint, so no write can slip between this check and the attestation.
 const fingerprint=async()=>(await deps.memory('SELECT public.candidate_network_recovery_fingerprint() AS f')).rows[0]?.f as string;
 const before=await fingerprint();
 const finalFlow=await readFlow(deps.flow);
 const finalMemory=await readMemory(deps.memory,finalFlow.restricting.map((r:any)=>r.directive_id));
 await checkPrivacy(finalFlow,finalMemory);
 const finalEvents=new Map<string,FlowEvent[]>();
 for(const e of finalFlow.events){const list=finalEvents.get(e.subject_id)??[];
  list.push({eventId:e.event_id,subjectId:e.subject_id,version:num(e.version),hash:e.hash,acknowledged:e.acknowledged===true});
  finalEvents.set(e.subject_id,list);}
 for(const subjectId of new Set([...union,...finalEvents.keys()])){
  if(!memorySubjects.has(subjectId))continue;
  const after=compareConsent(finalEvents.get(subjectId)??[],finalMemory.byConsent.get(subjectId),finalFlow.consent.get(subjectId));
  if(after.hold)await hold(subjectId,after.hold);
  else if(after.replay.length)await hold(subjectId,'consent_replay_failed');
 }
 await checkProfiles(finalFlow,finalMemory);
 const after=await fingerprint();
 if(!before||before!==after)block('state_changed_during_run');

 if(!report.blockers.length){
  const summary={subjects:report.subjects,consentReplayed:report.consentReplayed,holds,bindingMissing:report.bindingMissing};
  try{
   await deps.memory('SELECT public.candidate_network_recovery_attest($1,$2::uuid,$3,$4::jsonb,$5)',
    [input.epoch,input.runId,input.restored,JSON.stringify(summary),after]);
   report.attested=true;
  }catch(error){
   // Changed since the final check, or writes could not be paused in time: stay closed, rerun.
   const code=(error as {code?:string})?.code;
   if(code==='40001'||code==='55P03'||code==='57014'){block('state_changed_during_run');}else throw error;
  }
 }
 return report;
}
