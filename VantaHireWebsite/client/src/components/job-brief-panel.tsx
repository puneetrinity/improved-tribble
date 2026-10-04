import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { useJobBrief, jobIntentRequest } from '../lib/job-brief';
import type { BriefPayload } from '../../../server/job-brief/contracts';

type Criterion=BriefPayload['criteria'][number];
const subjects=['title','seniority','experience_years','skill','domain','function','location','certification','language','education_requirement','relevant_work','responsibility','leadership','availability','work_eligibility'] as const;
const reasons=['clarification_typo','hm_client_feedback','role_scope_changed','seniority_changed','skills_changed','location_changed','compensation_changed','sourcing_quality_volume','market_availability','application_interview_evidence','policy_compliance','other'];
const empty:BriefPayload={schemaVersion:1,compilerVersion:1,taxonomyVersion:1,criteria:[]};
const label=(value:string)=>value.replaceAll('_',' ');
export function JobBriefPanel({jobId,actorId}:{jobId:number;actorId:number}) {
  const query=useJobBrief(jobId,actorId,true);const cache=useQueryClient();
  const [payload,setPayload]=useState<BriefPayload>(empty);const [source,setSource]=useState('');
  const [choice,setChoice]=useState('recruiter_edit');const [reason,setReason]=useState('other');
  const [requester,setRequester]=useState('recruiter');const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');const [notice,setNotice]=useState('');const [dirty,setDirty]=useState(false);
  useEffect(()=>{
    if(query.data && !dirty) {setSource(query.data.currentJD??'');setPayload(query.data.latest?.payload??empty);setChoice(query.data.currentJD!==null?'current_jd':'recruiter_edit');}
  },[query.data,dirty]);
  if(query.isPending) return <p role="status">Loading job brief…</p>;
  if(query.isError || !query.data) return <p role="alert">The brief is unavailable. No changes have been saved.</p>;
  const brief=query.data;
  const revision=Number(brief.revision);
  const refresh=async()=>{await cache.invalidateQueries({queryKey:['job-brief',actorId,jobId]});await cache.invalidateQueries({queryKey:['job-management',actorId,jobId]});};
  const invoke=async(operation:'initialize'|'draft'|'save'|'approve')=>{
    setBusy(true);setError('');setNotice('');
    try {
      if(operation==='initialize') {
        await jobIntentRequest(actorId,jobId,'initialize',`/api/jobs/${jobId}`,{currentJD:source,sourceChoice:choice,requesterKind:requester,reasonCode:reason,expectedRevision:revision});
        setDirty(false);await refresh();setNotice('JD saved. You can now draft or write the brief.');
      } else if(operation==='draft') {
        const result=await jobIntentRequest(actorId,jobId,'draft',`/api/jobs/${jobId}/brief/draft`,{expectedRevision:revision},'POST');
        if(result.state!=='succeeded' || !result.result) {setNotice('No usable draft is available. You can edit manually; drafting has at most two attempts per JD.');await query.refetch();return;}
        setPayload(result.result);setDirty(true);setNotice('AI proposal only. Review every criterion and save before approving.');
      } else if(operation==='save') {
        await jobIntentRequest(actorId,jobId,'save-brief',`/api/jobs/${jobId}/brief`,{currentJD:source,sourceChoice:source===brief.currentJD?'current_jd':choice,requesterKind:requester,reasonCode:reason,expectedRevision:revision,payload});
        setDirty(false);await refresh();setNotice('Brief saved. Approval is a separate action.');
      } else {
        if(!brief.latest || dirty) throw new Error('Save the brief before approving.');
        await jobIntentRequest(actorId,jobId,'approve-brief',`/api/jobs/${jobId}/brief/approve`,{expectedRevision:revision,versionId:brief.latest.version_id},'POST');
        await refresh();setNotice('Brief approved. This did not publish the job or start sourcing.');
      }
    } catch {setError('The change was not confirmed. Your edits are kept. Refresh the brief after a conflict, or retry the same action after a connection failure.');}
    finally {setBusy(false);}
  };
  const update=(index:number,patch:Partial<Criterion>)=>{setDirty(true);setPayload({...payload,criteria:payload.criteria.map((c,i)=>i===index?{...c,...patch,provenance:{kind:'recruiter_edit'}}:c)});};
  return <section aria-label="Job brief" className="space-y-4 rounded-lg border p-4" id="job-brief">
    <h2 className="text-xl font-semibold">Job brief and approval</h2>
    <p>{brief.approvedVersionId?`Approved version retained${brief.latest?.version_id!==brief.approvedVersionId?'; latest revision is cosmetic':''}.`:'No approved brief yet.'} Approval never publishes or starts sourcing.</p>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {!brief.source.initialized && <div><p>Select the actual JD or enter it below. Nothing is inferred from the old screening configuration.</p>
      {brief.source.choices.map(c=><Button key={c.kind} type="button" variant="outline" onClick={()=>{setSource(c.text);setChoice(c.kind);setDirty(true);}}>Use {label(c.kind)}</Button>)}
    </div>}
    <label className="block">Current JD<Textarea aria-label="Current JD" value={source} onChange={e=>{setSource(e.target.value);setChoice('recruiter_edit');setDirty(true);}} rows={8}/></label>
    <div className="flex flex-wrap gap-3">
      <label>Change reason <select aria-label="Brief change reason" value={reason} onChange={e=>setReason(e.target.value)}>{reasons.map(r=><option key={r} value={r}>{label(r)}</option>)}</select></label>
      <label>Requested by <select aria-label="Requested by" value={requester} onChange={e=>setRequester(e.target.value)}><option value="recruiter">Recruiter</option><option value="hiring_manager">Hiring manager input</option></select></label>
    </div>
    <div className="flex flex-wrap gap-2"><Button type="button" disabled={busy || !source.trim()} onClick={()=>void invoke('initialize')}>Save JD</Button>
      <Button type="button" variant="outline" disabled={busy || !brief.source.initialized || source!==brief.currentJD} onClick={()=>void invoke('draft')}>Draft brief with AI</Button></div>
    <p>At most 12 criteria. Disqualifiers are review flags, not automatic exclusions. Unknown evidence is not a failure.</p>
    {payload.criteria.map((c,index)=><fieldset key={c.id} className="space-y-2 rounded border p-3"><legend>Criterion {index+1}</legend>
      <label className="block">Label<Input aria-label={`Criterion ${index+1} label`} value={c.label} maxLength={120} onChange={e=>update(index,{label:e.target.value})}/></label>
      <label>Class <select aria-label={`Criterion ${index+1} class`} value={c.class} onChange={e=>update(index,{class:e.target.value as Criterion['class']})}>{['must_have','preferred','disqualifier','evidence_required'].map(k=><option key={k} value={k}>{label(k)}</option>)}</select></label>{' '}
      <label>Type <select aria-label={`Criterion ${index+1} type`} value={c.subject} onChange={e=>{
        const subject=e.target.value as Criterion['subject'];update(index,{subject,use:'assessment',requirement:subject==='experience_years'?{kind:'minimum_years',minimum:0}:{kind:'text',value:''},
          evidenceKinds:['responsibility','leadership','availability'].includes(subject)?['recruiter_judgement']:subject==='work_eligibility'?['candidate_provided']:['profile_evidence']});
      }}>{subjects.map(k=><option key={k} value={k}>{label(k)}</option>)}</select></label>
      <label className="block">{c.requirement.kind==='minimum_years'?'Minimum years':'Requirement'}<Input aria-label={`Criterion ${index+1} requirement`} type={c.requirement.kind==='minimum_years'?'number':'text'} min={0} max={80}
        value={c.requirement.kind==='minimum_years'?c.requirement.minimum:c.requirement.value} onChange={e=>update(index,{requirement:c.subject==='experience_years'?{kind:'minimum_years',minimum:Number(e.target.value)}:{kind:'text',value:e.target.value}})}/></label>
      <p>{c.evidenceKinds.includes('recruiter_judgement')?'Recruiter-judged; never automatically scored.':c.subject==='work_eligibility'?'Candidate-provided evidence only.':'Evidence required; missing information stays unknown.'}</p>
      <Button type="button" variant="outline" onClick={()=>{setDirty(true);setPayload({...payload,criteria:payload.criteria.filter((_,i)=>i!==index)});}}>Remove criterion {index+1}</Button>
    </fieldset>)}
    <Button type="button" variant="outline" disabled={busy || payload.criteria.length>=12} onClick={()=>{setDirty(true);setPayload({...payload,criteria:[...payload.criteria,{id:crypto.randomUUID(),label:'',class:'must_have',subject:'skill',requirement:{kind:'text',value:''},evidenceKinds:['profile_evidence'],use:'assessment',provenance:{kind:'recruiter_edit'}}]});}}>Add criterion</Button>
    <div className="flex flex-wrap gap-2"><Button type="button" disabled={busy || payload.criteria.length===0} onClick={()=>void invoke('save')}>Save brief</Button>
      <Button type="button" disabled={busy || dirty || !brief.latest} onClick={()=>void invoke('approve')}>Approve brief</Button>
      <Button type="button" variant="outline" disabled={busy} onClick={()=>{setDirty(false);void query.refetch();}}>Reload saved brief</Button></div>
  </section>;
}
