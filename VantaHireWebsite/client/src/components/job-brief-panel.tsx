import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { useJobBrief, jobIntentRequest } from '../lib/job-brief';
import { AlsoInJd, initialCriteria, selectionFor } from './brief-review-workspace';
import type { BriefPayload } from '../../../server/job-brief/contracts';
import { acceptedSkillsShape, duplicateSkillNames, overlappingSkillCriteria, skillAlternativesFromEditor } from '../../../shared/skill-alternatives';

type Criterion=BriefPayload['criteria'][number];
const subjects=['title','seniority','experience_years','skill','domain','function','location','certification','language','education_requirement','relevant_work','responsibility','leadership','availability','work_eligibility'] as const;
const reasons=['clarification_typo','hm_client_feedback','role_scope_changed','seniority_changed','skills_changed','location_changed','compensation_changed','sourcing_quality_volume','market_availability','application_interview_evidence','policy_compliance','other'];
const CURRENT=4 as const;
const empty:BriefPayload={schemaVersion:CURRENT,compilerVersion:CURRENT,taxonomyVersion:CURRENT,criteria:[]};
// Same rule as the server's AI draft: judged criteria stay recruiter-only, work eligibility keeps its
// own rule, everything else can be met by a profile or by what the candidate provided (resume).
export const evidenceForSubject=(subject:Criterion['subject']):Criterion['evidenceKinds']=>
  ['responsibility','leadership','availability'].includes(subject)?['recruiter_judgement']
    :subject==='work_eligibility'?['candidate_provided']:['profile_evidence','candidate_provided'];
const withResumeEvidence=(c:Criterion):Criterion=>
  c.evidenceKinds.includes('profile_evidence') && !c.evidenceKinds.includes('candidate_provided')
    && !['responsibility','leadership','availability','work_eligibility'].includes(c.subject)
    ? {...c,evidenceKinds:[...c.evidenceKinds,'candidate_provided']} : c;
// Presentation of an old brief is a proposal for explicit save, never a backfilled approval.
function editablePayload(value:BriefPayload):BriefPayload {
  const historical=value.schemaVersion<CURRENT;
  return {...value,schemaVersion:CURRENT,compilerVersion:CURRENT,taxonomyVersion:CURRENT,criteria:value.criteria.map(c=>historical?withResumeEvidence(c):c).map(c=>
    c.subject==='skill' && c.requirement.kind==='text' ? {...c,requirement:{kind:'accepted_skills',primary:c.requirement.value,alternatives:[]}} :
    c.subject==='title' && c.requirement.kind==='text' ? {...c,class:'preferred',use:'assessment',requirement:{kind:'accepted_titles',values:[c.requirement.value]}} :
    c.subject==='experience_years' ? {...c,use:'assessment'} : c)};
}
const label=(value:string)=>value.replaceAll('_',' ');
const REASON_LABEL:Record<string,string>={clarification_typo:'Fixing a typo or wording',hm_client_feedback:'Hiring manager or client feedback',
  role_scope_changed:'The role changed',seniority_changed:'Seniority changed',skills_changed:'Skills changed',location_changed:'Location changed',
  compensation_changed:'Pay changed',sourcing_quality_volume:'Not enough good candidates',market_availability:'Hard to find in the market',
  application_interview_evidence:'Learned from applications or interviews',policy_compliance:'Policy or compliance',other:'Other'};
const CLASS_LABEL:Record<string,string>={must_have:'Must have',preferred:'Nice to have',disqualifier:'Red flag (for review only)',evidence_required:'Evidence to review manually'};
const SUBJECT_LABEL:Record<string,string>={title:'Job title',seniority:'Seniority',experience_years:'Years of experience',skill:'Skill',domain:'Industry or domain',
  function:'Function',location:'Location',certification:'Certification',language:'Language',education_requirement:'Education',relevant_work:'Relevant experience',
  responsibility:'Responsibility',leadership:'Leadership',availability:'Availability',work_eligibility:'Work eligibility'};
const SOURCE_LABEL:Record<string,string>={original_prose:'the description you first entered',description_prose:'the description on the job post',current_jd:'the saved description',recruiter_edit:'my own text'};
const field='mt-1 block min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
function draftNotice(code:unknown):string {
  const messages:Record<string,string>={BRIEF_MODEL_TRUNCATED:'The AI draft was incomplete.',
    BRIEF_MODEL_INVALID:'We couldn’t use the AI draft.',BRIEF_MODEL_TIMEOUT:'The AI draft took too long.',
    BRIEF_DRAFT_STALE:'The job description changed while the AI was drafting. Discard unsaved changes to reload it.',
    BRIEF_MODEL_FAILED:'AI drafting isn’t available right now.',BRIEF_MODEL_UNKNOWN:'We couldn’t tell whether the AI draft finished. Please try again.'};
  return (typeof code==='string' && Object.hasOwn(messages,code)?messages[code]:'No usable AI draft is available.')+' You can edit the requirements yourself.';
}
export function JobBriefPanel({jobId,actorId}:{jobId:number;actorId:number}) {
  const query=useJobBrief(jobId,actorId,true);const cache=useQueryClient();
  const [payload,setPayload]=useState<BriefPayload>(empty);const [source,setSource]=useState('');
  const [choice,setChoice]=useState('recruiter_edit');const [reason,setReason]=useState('other');
  const [requester,setRequester]=useState('recruiter');const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');const [notice,setNotice]=useState('');const [dirty,setDirty]=useState(false);
  const workspace=query.data?.reviewWorkspace && query.data.reviewWorkspace.sourceHash===query.data.sourceHash ? query.data.reviewWorkspace : null;
  useEffect(()=>{
    if(query.data && !dirty) {setSource(query.data.currentJD??'');setChoice(query.data.currentJD!==null?'current_jd':'recruiter_edit');
      const ws=query.data.reviewWorkspace && query.data.reviewWorkspace.sourceHash===query.data.sourceHash ? query.data.reviewWorkspace : null;
      const savedHere=!!ws && !!query.data.latest && ws.versionId===query.data.latest.version_id;
      const start=editablePayload(ws && !savedHere ? (query.data.draft?.result ?? {...empty,criteria:initialCriteria(ws)}) : query.data.latest?.payload??empty);
      setPayload(start);
    }
  },[query.data,dirty]);
  if(query.isPending) return <p role="status">Loading hiring criteria…</p>;
  if(query.isError || !query.data) return <p role="alert">We couldn’t load the hiring criteria. Nothing has been changed.</p>;
  const brief=query.data;
  const revision=Number(brief.revision);
  const refresh=async()=>{await cache.invalidateQueries({queryKey:['job-brief',actorId,jobId]});await cache.invalidateQueries({queryKey:['job-management',actorId,jobId]});};
  const invoke=async(operation:'initialize'|'draft'|'save'|'approve')=>{
    setBusy(true);setError('');setNotice('');
    try {
      if(operation==='initialize') {
        await jobIntentRequest(actorId,jobId,'initialize',`/api/jobs/${jobId}`,{currentJD:source,sourceChoice:choice,requesterKind:requester,reasonCode:reason,expectedRevision:revision});
        setDirty(false);await refresh();setNotice('Job description saved. You can now draft the criteria with AI or write them yourself.');
      } else if(operation==='draft') {
        const result=await jobIntentRequest(actorId,jobId,'draft',`/api/jobs/${jobId}/brief/draft`,{expectedRevision:revision},'POST');
        if(result.state==='review_required') {setDirty(false);await query.refetch();setNotice('AI draft ready. Check each criterion and anything left out below, then save.');return;}
        if(result.state!=='succeeded' || !result.result) {setNotice(draftNotice(result.code));await query.refetch();return;}
        setPayload(result.result);setDirty(true);setNotice('AI proposal only — nothing is saved yet. Check every criterion and save before approving.');
      } else if(operation==='save') {
        const savedPayload={...payload,criteria:payload.criteria.map(c=>c.requirement.kind==='accepted_titles'
          ? {...c,requirement:{...c.requirement,values:c.requirement.values.map(v=>v.trim()).filter(Boolean)}} :
          c.requirement.kind==='accepted_skills' ? {...c,requirement:{...c.requirement,primary:c.requirement.primary.trim(),
            alternatives:skillAlternativesFromEditor(c.requirement.alternatives.join('\n'))}} : c)};
        if(savedPayload.criteria.some(c=>c.requirement.kind==='accepted_skills' &&
          (!acceptedSkillsShape.safeParse(c.requirement).success || duplicateSkillNames(c.requirement))) ||
          overlappingSkillCriteria(savedPayload.criteria).length) throw Error('SKILL_NAMES_INVALID');
        await jobIntentRequest(actorId,jobId,'save-brief',`/api/jobs/${jobId}/brief`,{currentJD:source,sourceChoice:source===brief.currentJD?'current_jd':choice,requesterKind:requester,reasonCode:reason,expectedRevision:revision,payload:savedPayload,
          ...(workspace?{reviewSelection:{extractionId:workspace.extractionId,dispositions:selectionFor(workspace,savedPayload)}}:{})});
        setDirty(false);await refresh();setNotice('Changes saved. Approve the criteria when you are happy with them.');
      } else {
        if(!brief.latest || dirty || brief.latest.payload.schemaVersion!==CURRENT) throw new Error('Save your changes before approving.');
        await jobIntentRequest(actorId,jobId,'approve-brief',`/api/jobs/${jobId}/brief/approve`,{expectedRevision:revision,versionId:brief.latest.version_id},'POST');
        await refresh();setNotice('Criteria approved. This did not publish the job or start a search.');
      }
    } catch(error) {setError(operation==='draft' && error instanceof Error && /\bBRIEF_DRAFT_LIMIT\b/.test(error.message)
      ? 'You’ve reached the AI drafting limit. You can edit the requirements yourself.'
      : error instanceof Error && error.message==='SKILL_NAMES_INVALID'
      ? 'Fix the skill names: up to 20 names per skill, no blank or repeated names, and no name used by two skills.'
      : error instanceof Error && /BRIEF_REVIEW_CONFLICT|BRIEF_INVALID_REVIEW/.test(error.message)
      ? 'The list of requirements changed elsewhere. Discard your unsaved changes to load it, then save and approve again. Your edits are kept until you do.'
      : error instanceof Error && /BRIEF_UPDATED_APPROVAL_REQUIRED|Save your changes before approving/.test(error.message)
      ? 'Save and approve the updated criteria. Your edits are kept.'
      : 'We couldn’t confirm whether your changes were saved. Your edits are still here — try again, or discard unsaved changes if someone else changed the criteria.');}
    finally {setBusy(false);}
  };
  const setCriteria=(criteria:Criterion[])=>{setDirty(true);setPayload({...payload,criteria});};
  const update=(index:number,patch:Partial<Criterion>)=>setCriteria(payload.criteria.map((c,i)=>i===index?{...c,...patch,provenance:{kind:'recruiter_edit'}}:c));

  const approved=!!brief.approvedVersionId;
  const changedSinceApproval=approved && (dirty || brief.latest?.version_id!==brief.approvedVersionId);
  const status=!approved?'Not approved yet':changedSinceApproval?'Changes not approved yet':'Approved';
  return <section aria-labelledby="job-brief-title" className="space-y-5 rounded-xl border border-border bg-card p-4 sm:p-6" id="job-brief">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 id="job-brief-title" className="text-xl font-semibold text-foreground">Hiring criteria</h2>
        <p className="mt-1 text-sm text-muted-foreground">What we look for when finding and ranking candidates. Approving criteria doesn't publish the job or start a search.</p>
      </div>
      <span role="status" data-brief-status="" className={`rounded-full border px-3 py-1 text-sm font-medium ${status==='Approved'?'border-emerald-200 bg-emerald-50 text-emerald-800':'border-amber-200 bg-amber-50 text-amber-800'}`}>{status}</span>
    </div>
    {brief.latest && brief.latest.payload.schemaVersion===3 && <p role="status" className="text-sm">To include previous applicants, review these requirements, then save and approve them again.</p>}
    {brief.latest && brief.latest.payload.schemaVersion<3 && <p role="status" className="text-sm">These criteria use an older format. Check the skill names, then save and approve.</p>}
    {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {notice && <p role="status" className="rounded-md border border-border bg-muted/40 p-3 text-sm">{notice}</p>}
    {!error && !notice && brief.draft && ['failed','stale','unknown'].includes(brief.draft.state) && <p role="status" className="text-sm">{draftNotice(brief.draft.code)}</p>}

    <div className="space-y-3">
      <h3 className="text-base font-semibold">Job description</h3>
      {!brief.source.initialized && <div className="space-y-2"><p className="text-sm text-muted-foreground">Choose which description to use, or paste it below.</p>
        <div className="flex flex-wrap gap-2">{brief.source.choices.map(c=><Button key={c.kind} type="button" variant="outline" className="min-h-11" onClick={()=>{setSource(c.text);setChoice(c.kind);setDirty(true);}}>Use {SOURCE_LABEL[c.kind]??label(c.kind)}</Button>)}</div>
      </div>}
      <label className="block text-sm font-medium"><span className="sr-only">Job description</span><Textarea aria-label="Job description" value={source} onChange={e=>{setSource(e.target.value);setChoice('recruiter_edit');setDirty(true);}} rows={8}/></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium">Why are you changing this?<select aria-label="Reason for change" className={field} value={reason} onChange={e=>setReason(e.target.value)}>{reasons.map(r=><option key={r} value={r}>{REASON_LABEL[r]??label(r)}</option>)}</select></label>
        <label className="block text-sm font-medium">Who asked for it?<select aria-label="Requested by" className={field} value={requester} onChange={e=>setRequester(e.target.value)}><option value="recruiter">Me (recruiter)</option><option value="hiring_manager">Hiring manager</option></select></label>
      </div>
      <div className="flex flex-wrap gap-2"><Button type="button" className="min-h-11" disabled={busy || !source.trim()} onClick={()=>void invoke('initialize')}>Save job description</Button>
        <Button type="button" variant="outline" className="min-h-11" disabled={busy || !brief.source.initialized || source!==brief.currentJD} onClick={()=>void invoke('draft')}>Draft criteria with AI</Button></div>
    </div>

    <div className="space-y-3">
      <h3 className="text-base font-semibold">Requirements <span className="font-normal text-muted-foreground">· {payload.criteria.length} of 12</span></h3>
      <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        <li>Missing information earns no points. No points are deducted. Red flags are for your review; they never exclude anyone automatically.</li>
        <li>People within your experience range are shown first. People within 2 years either side are shown separately, only if they have every required skill. Candidates more than 2 years outside the range, or without enough work-history dates to calculate experience, are not shown. Internships do not count toward years. You may see fewer than 100 people.</li>
      </ul>
      {payload.criteria.map((c,index)=><fieldset key={c.id} className="space-y-3 rounded-lg border border-border p-3 sm:p-4"><legend className="px-1 text-sm font-semibold">Requirement {index+1}</legend>
        <label className="block text-sm font-medium">Name<Input aria-label={`Requirement ${index+1} label`} className="mt-1 min-h-11" value={c.label} maxLength={120} onChange={e=>update(index,{label:e.target.value})}/></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium">Importance<select aria-label={`Requirement ${index+1} class`} className={field} value={c.class} onChange={e=>update(index,{class:e.target.value as Criterion['class']})}>{['must_have','preferred','disqualifier','evidence_required'].map(k=><option key={k} value={k}>{CLASS_LABEL[k]}</option>)}</select></label>
          <label className="block text-sm font-medium">What kind of requirement?<select aria-label={`Requirement ${index+1} type`} className={field} value={c.subject} onChange={e=>{
            const subject=e.target.value as Criterion['subject'];update(index,{subject,use:'assessment',...(subject==='title'?{class:'preferred' as const}:{}),requirement:subject==='experience_years'?{kind:'minimum_years',minimum:0}:subject==='title'?{kind:'accepted_titles',values:['']}:subject==='skill'?{kind:'accepted_skills',primary:'',alternatives:[]}:{kind:'text',value:''},
              evidenceKinds:evidenceForSubject(subject)});
          }}>{subjects.map(k=><option key={k} value={k}>{SUBJECT_LABEL[k]}</option>)}</select></label>
        </div>
        {c.requirement.kind==='accepted_skills' ? <div className="space-y-2">
          <label className="block text-sm font-medium">Skill<Input aria-label={`Requirement ${index+1} requirement`} className="mt-1 min-h-11" maxLength={120} value={c.requirement.primary}
            onChange={e=>{if(c.requirement.kind==='accepted_skills')update(index,{requirement:{...c.requirement,primary:e.target.value}});}}/></label>
          <label className="block text-sm font-medium">Also accepted — any one counts (one per line)
            <Textarea aria-label={`Requirement ${index+1} accepted skills`} className="mt-1" placeholder="e.g. Python (programming language)" value={c.requirement.alternatives.join('\n')}
              onChange={e=>{if(c.requirement.kind==='accepted_skills')update(index,{requirement:{...c.requirement,alternatives:e.target.value.split('\n')}});}}/>
          </label>
          <p className="text-xs text-muted-foreground">{1+skillAlternativesFromEditor(c.requirement.alternatives.join('\n')).length} of 20 names. Each skill counts once, whichever name matches.</p>
          {(duplicateSkillNames({...c.requirement,alternatives:skillAlternativesFromEditor(c.requirement.alternatives.join('\n'))}) ||
            overlappingSkillCriteria(payload.criteria).includes(c.id)) && <p role="alert" className="text-sm text-red-700">This name is used twice. Remove it from one place.</p>}
        </div> : c.requirement.kind==='accepted_titles' ? <label className="block text-sm font-medium">Job titles that count (one per line, up to 20)
          <Textarea aria-label={`Requirement ${index+1} accepted titles`} className="mt-1" value={c.requirement.values.join('\n')} onChange={e=>update(index,{requirement:{kind:'accepted_titles',values:e.target.value.split('\n')}})}/>
          <span className="mt-1 block text-xs font-normal text-muted-foreground">These titles add points once you approve. They don’t change which job titles we search for.</span></label> :
          c.requirement.kind==='minimum_years' || c.requirement.kind==='experience_range' ? <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-medium">Minimum years<Input aria-label={`Requirement ${index+1} requirement`} className="mt-1 min-h-11" type="number" min={0} max={80} step="any" value={Number.isFinite(c.requirement.minimum)?c.requirement.minimum:''}
              onChange={e=>{const minimum=e.target.value===''?NaN:Number(e.target.value);update(index,{requirement:c.requirement.kind==='experience_range'?{...c.requirement,minimum}:{kind:'minimum_years',minimum}});}}/></label>
            <label className="block text-sm font-medium">Maximum years (optional)<Input aria-label={`Requirement ${index+1} maximum years`} className="mt-1 min-h-11" type="number" min={0} max={80} step="any" value={c.requirement.kind==='experience_range'?c.requirement.maximum:''}
              onChange={e=>update(index,{requirement:e.target.value===''?{kind:'minimum_years',minimum:'minimum' in c.requirement?c.requirement.minimum:0}:{kind:'experience_range',minimum:'minimum' in c.requirement?c.requirement.minimum:0,maximum:Number(e.target.value)}})}/></label>
          </div> : <label className="block text-sm font-medium">Requirement<Input aria-label={`Requirement ${index+1} requirement`} className="mt-1 min-h-11" value={c.requirement.value}
            onChange={e=>update(index,{requirement:{kind:'text',value:e.target.value}})}/></label>}
        {(c.evidenceKinds.includes('recruiter_judgement')||c.subject==='work_eligibility') && <p className="text-xs text-muted-foreground">{c.evidenceKinds.includes('recruiter_judgement')?'You judge this one; it is never scored automatically.':'Only what the candidate tells you counts.'}</p>}
        <Button type="button" variant="outline" className="min-h-11" aria-label={`Remove requirement ${index+1}`} onClick={()=>setCriteria(payload.criteria.filter((_,i)=>i!==index))}>Remove</Button>
      </fieldset>)}
      {workspace && <AlsoInJd workspace={workspace} payload={payload} canAdd={payload.criteria.length<12} disabled={busy} onAdd={c=>setCriteria([...payload.criteria,c])}/>}
      <Button type="button" variant="outline" className="min-h-11" disabled={busy || payload.criteria.length>=12} onClick={()=>{setDirty(true);setPayload({...payload,criteria:[...payload.criteria,{id:crypto.randomUUID(),label:'',class:'must_have',subject:'skill',requirement:{kind:'accepted_skills',primary:'',alternatives:[]},evidenceKinds:evidenceForSubject('skill'),use:'assessment',provenance:{kind:'recruiter_edit'}}]});}}>Add requirement</Button>
    </div>

    <div className="flex flex-wrap gap-2 border-t border-border pt-4">
      <Button type="button" className="min-h-11" disabled={busy || payload.criteria.length===0} onClick={()=>void invoke('save')}>Save changes</Button>
      <Button type="button" className="min-h-11" disabled={busy || dirty || !brief.latest || brief.latest.payload.schemaVersion!==CURRENT} onClick={()=>void invoke('approve')}>Approve criteria</Button>
      <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={()=>{setDirty(false);void query.refetch();}}>Discard unsaved changes</Button>
    </div>
  </section>;
}
