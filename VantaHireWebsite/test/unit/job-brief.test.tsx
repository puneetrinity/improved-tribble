import React from 'react';
import {act,Simulate} from 'react-dom/test-utils';
import {createRoot,type Root} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {webcrypto} from 'node:crypto';
const mocks=vi.hoisted(()=>({query:vi.fn(),intent:vi.fn(),api:vi.fn()}));
vi.mock('../../client/src/lib/job-brief',async importOriginal=>({...await importOriginal<any>(),useJobBrief:mocks.query,jobIntentRequest:mocks.intent}));
vi.mock('../../client/src/lib/queryClient',()=>({apiRequest:mocks.api}));
import {JobBriefPanel} from '../../client/src/components/job-brief-panel';
const id='10000000-0000-4000-8000-000000000001';
const criterion={id,label:'Python',class:'must_have',subject:'skill',requirement:{kind:'accepted_skills',primary:'Python',alternatives:[]},evidenceKinds:['profile_evidence','candidate_provided'],use:'assessment',provenance:{kind:'recruiter_edit'}};
const payload={schemaVersion:4,compilerVersion:4,taxonomyVersion:4,criteria:[criterion]};
const brief={revision:'2',currentJD:'Build Python services.',sourceHash:'a'.repeat(64),latest:{version_id:id,version_number:1,payload},approvedVersionId:null,draft:null,source:{initialized:true,ambiguous:false,choices:[]}};
describe('brief recruiter UI',()=>{
  let host:HTMLDivElement;let root:Root;let cache:QueryClient;
  beforeEach(()=>{
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;vi.stubGlobal('crypto',webcrypto);
    host=document.createElement('div');document.body.append(host);root=createRoot(host);cache=new QueryClient({defaultOptions:{queries:{retry:false}}});
    mocks.query.mockReturnValue({data:brief,isPending:false,isError:false,refetch:vi.fn()});mocks.intent.mockResolvedValue({revision:'3'});
  });
  afterEach(async()=>{await act(async()=>root.unmount());host.remove();cache.clear();vi.clearAllMocks();vi.unstubAllGlobals();sessionStorage.clear();});
  const render=()=>act(async()=>{root.render(<QueryClientProvider client={cache}><JobBriefPanel jobId={9} actorId={3}/></QueryClientProvider>);});
  const button=(label:string)=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent===label)!;
  const click=(label:string)=>act(async()=>{button(label).click();});
  const change=(label:string,value:string)=>act(async()=>{
    const element=host.querySelector(`[aria-label="${label}"]`) as HTMLInputElement;
    element.value=value;Simulate.change(element);
  });
  it('historical briefs need explicit save and reapproval without an automatic request',async()=>{
    mocks.query.mockReturnValue({data:{...brief,latest:{...brief.latest,payload:{...payload,schemaVersion:1,compilerVersion:1,taxonomyVersion:1,criteria:[{...criterion,requirement:{kind:'text',value:'Python'}}]}}},isPending:false,isError:false});
    await render();expect(button('Approve criteria').disabled).toBe(true);expect(mocks.intent).not.toHaveBeenCalled();
    await click('Save changes');expect(mocks.intent.mock.calls[0][4].payload).toMatchObject({schemaVersion:4,compilerVersion:4,taxonomyVersion:4});
    expect(mocks.intent).toHaveBeenCalledTimes(1);
  });
  it('a schema-3 brief loads unchanged, asks to save again, and only an explicit save adds resume evidence',async()=>{
    const judged={...criterion,id:'10000000-0000-4000-8000-000000000002',label:'Leads a team',subject:'leadership',requirement:{kind:'text',value:'Leads a team'},evidenceKinds:['recruiter_judgement']};
    const v3={schemaVersion:3,compilerVersion:3,taxonomyVersion:3,criteria:[{...criterion,evidenceKinds:['profile_evidence']},judged]};
    mocks.query.mockReturnValue({data:{...brief,approvedVersionId:id,latest:{...brief.latest,payload:v3}},isPending:false,isError:false});
    await render();
    expect(host.textContent).toContain('To include previous applicants, review these requirements, then save and approve them again.');
    expect(button('Approve criteria').disabled).toBe(true);expect(mocks.intent).not.toHaveBeenCalled();
    await click('Save changes');
    const saved=mocks.intent.mock.calls[0][4].payload;
    expect(saved).toMatchObject({schemaVersion:4,compilerVersion:4,taxonomyVersion:4});
    expect(saved.criteria[0].evidenceKinds).toEqual(['profile_evidence','candidate_provided']);
    expect(saved.criteria[1].evidenceKinds).toEqual(['recruiter_judgement']);
  });
  it('new requirements accept resume evidence except judged ones and work eligibility',async()=>{
    await render();
    for(const [n,type,text] of [[2,'location','Berlin, Germany'],[3,'responsibility','Owns the API'],[4,'work_eligibility','Can work in Germany']] as const){
      await click('Add requirement');await change(`Requirement ${n} type`,type);
      await change(`Requirement ${n} label`,text);await change(`Requirement ${n} requirement`,text);
    }
    await click('Save changes');
    const kinds=mocks.intent.mock.calls[0][4].payload.criteria.map((c:any)=>c.evidenceKinds);
    expect(kinds).toEqual([['profile_evidence','candidate_provided'],['profile_evidence','candidate_provided'],['recruiter_judgement'],['candidate_provided']]);
  });
  it('shows editable scoring titles in the one approval flow, defaulting to preferred',async()=>{
    await render();await change('Requirement 1 type','title');
    await change('Requirement 1 accepted titles','Backend Engineer\n\nBackend Developer\n');
    expect(button('Approve criteria').disabled).toBe(true);expect(mocks.intent).not.toHaveBeenCalled();
    expect(host.textContent).toContain('which job titles we search for');
    await click('Save changes');expect(mocks.intent.mock.calls[0][4].payload.criteria[0]).toMatchObject({
      subject:'title',class:'preferred',use:'assessment',requirement:{kind:'accepted_titles',values:['Backend Engineer','Backend Developer']}});
  });
  it('shows skill alternatives, drops blank editor lines only on save and requires reapproval',async()=>{
    await render();
    await change('Requirement 1 requirement','AWS');
    await change('Requirement 1 accepted skills','Amazon Web Services\n\nAmazon AWS\n');
    expect(button('Approve criteria').disabled).toBe(true);
    expect(mocks.intent).not.toHaveBeenCalled();
    await click('Save changes');
    expect(mocks.intent.mock.calls[0][4].payload.criteria[0].requirement).toEqual({
      kind:'accepted_skills',primary:'AWS',alternatives:['Amazon Web Services','Amazon AWS']});
  });
  it('refuses duplicate skill names locally without a request',async()=>{
    await render();await change('Requirement 1 accepted skills','python');
    await click('Save changes');
    expect(mocks.intent).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Fix the skill names');
  });
  it('saves an explicit range and does not convert a cleared minimum into zero',async()=>{
    await render();await change('Requirement 1 type','experience_years');
    await change('Requirement 1 requirement','6');await change('Requirement 1 maximum years','10');
    await click('Save changes');expect(mocks.intent.mock.calls[0][4].payload.criteria[0].requirement).toEqual({kind:'experience_range',minimum:6,maximum:10});
    await change('Requirement 1 type','experience_years');await change('Requirement 1 maximum years','10');
    await change('Requirement 1 requirement','');await click('Save changes');
    expect(Number.isNaN(mocks.intent.mock.calls[1][4].payload.criteria[0].requirement.minimum)).toBe(true);
    expect(host.textContent).toContain('Internships do not count');
  });
  it('approval sends only the saved version and never publishes or sources',async()=>{
    await render();expect(mocks.intent).not.toHaveBeenCalled();await click('Approve criteria');
    expect(mocks.intent).toHaveBeenCalledExactlyOnceWith(3,9,'approve-brief','/api/jobs/9/brief/approve',{expectedRevision:2,versionId:id},'POST');
    expect(host.textContent).toContain('This did not publish the job or start a search');
  });
  it('AI output stays an unsaved proposal with approval disabled',async()=>{
    mocks.intent.mockResolvedValue({state:'succeeded',result:payload});await render();await click('Draft criteria with AI');
    expect(mocks.intent).toHaveBeenCalledTimes(1);expect(button('Approve criteria').disabled).toBe(true);expect(host.textContent).toContain('AI proposal only');
    await click('Save changes');expect(mocks.intent.mock.calls[1]?.[2]).toBe('save-brief');
  });
  it('does not auto-select ambiguous legacy sources or call a model',async()=>{
    mocks.query.mockReturnValue({data:{...brief,currentJD:null,latest:null,source:{initialized:false,ambiguous:true,choices:[{kind:'original_prose',text:'First JD'},{kind:'description_prose',text:'Other JD'}]}},isPending:false,isError:false});
    await render();expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toBe('');expect(button('Draft criteria with AI').disabled).toBe(true);
    await click('Use the description you first entered');expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toBe('First JD');expect(mocks.intent).not.toHaveBeenCalled();
  });
  it('preserves edits on a refused save and does not approve them',async()=>{
    await render();await click('Add requirement');await change('Requirement 2 label','Kafka');await change('Requirement 2 requirement','Kafka');
    mocks.intent.mockRejectedValue(new Error('Conflict'));await click('Save changes');
    expect(host.querySelectorAll('fieldset')).toHaveLength(2);expect(host.textContent).toContain('Your edits are still here');expect(button('Approve criteria').disabled).toBe(true);
  });
  it('allows at most twelve criteria and keeps disqualifiers as flags',async()=>{
    await render();for(let n=1;n<12;n++)await click('Add requirement');expect(button('Add requirement').disabled).toBe(true);
    expect(host.querySelectorAll('fieldset')).toHaveLength(12);expect(host.textContent).toContain('Red flags are for your review');
  });
  it('keeps manual editing available after a failed AI attempt',async()=>{
    mocks.intent.mockResolvedValue({state:'failed',code:'BRIEF_MODEL_INVALID'});await render();await click('Draft criteria with AI');
    expect(button('Add requirement').disabled).toBe(false);expect(host.textContent).toContain('edit the requirements yourself');
  });
  it.each([['BRIEF_MODEL_TRUNCATED','incomplete'],['BRIEF_MODEL_INVALID','couldn’t use the AI draft'],['BRIEF_MODEL_TIMEOUT','took too long'],['BRIEF_DRAFT_STALE','job description changed'],['BRIEF_MODEL_FAILED','isn’t available']])('explains %s immediately and on reload',async(code,text)=>{
    mocks.query.mockReturnValue({data:{...brief,draft:{state:'failed',code}},isPending:false,isError:false,refetch:vi.fn()});
    await render();expect(host.textContent).toContain(text);expect(mocks.intent).not.toHaveBeenCalled();
    mocks.intent.mockResolvedValue({state:'failed',code});await click('Draft criteria with AI');
    expect(host.textContent).toContain(text);expect(button('Add requirement').disabled).toBe(false);
  });
  it('explains the draft limit without losing manual edits or calling save',async()=>{
    await render();await change('Requirement 1 label','Edited label');
    mocks.intent.mockRejectedValue(new Error('429: BRIEF_DRAFT_LIMIT private-marker'));
    await click('Draft criteria with AI');
    expect(host.textContent).toContain('AI drafting limit');expect(host.textContent).not.toContain('private-marker');
    expect((host.querySelector('[aria-label="Requirement 1 label"]') as HTMLInputElement).value).toBe('Edited label');
    expect(button('Approve criteria').disabled).toBe(true);expect(mocks.intent).toHaveBeenCalledTimes(1);
    mocks.intent.mockResolvedValue({});await click('Save changes');expect(mocks.intent.mock.calls[1][2]).toBe('save-brief');
  });
  it('edit page: shows what the AI left out, add puts it in, save records it, approve has no extra step',async()=>{
    const go={...criterion,id:'20000000-0000-4000-8000-000000000002',label:'Go',class:'preferred',requirement:{kind:'accepted_skills',primary:'Go',alternatives:[]}};
    const H='a'.repeat(64);
    const ws={contractVersion:1,extractionId:'30000000-0000-4000-8000-000000000003',sourceHash:H,extractionLimit:false,versionId:id,reviewHash:'d'.repeat(64),exclusionsConfirmed:false,dispositions:[],
      items:[{id:'i1',text:'Python',priority:'required',topic:'skill',quote:'Python',sourceHash:H,span:{start:6,end:12},proposedCriterion:criterion,reason:null},
        {id:'i2',text:'Go',priority:'preferred',topic:'skill',quote:'Go',sourceHash:H,span:{start:0,end:2},proposedCriterion:go,reason:'capacity'}]};
    mocks.query.mockReturnValue({data:{...brief,reviewWorkspace:ws},isPending:false,isError:false,refetch:vi.fn()});
    await render();
    expect(host.textContent).toContain('Other requirements from the job description · 1');
    expect(button('Approve criteria').disabled).toBe(false);
    await act(async()=>{(host.querySelector('[aria-label="Add “Go” to the requirements"]') as HTMLButtonElement).click();});
    await click('Save changes');
    const save=mocks.intent.mock.calls.find(c=>c[2]==='save-brief')![4];
    expect(save.reviewSelection).toEqual({extractionId:ws.extractionId,dispositions:[{itemId:'i1',state:'included',criterionIds:[id]},{itemId:'i2',state:'included',criterionIds:[go.id]}]});
  });
});

describe('ambiguous intent identity',()=>{
  beforeEach(()=>{vi.stubGlobal('crypto',webcrypto);sessionStorage.clear();mocks.api.mockReset();});
  afterEach(()=>{vi.unstubAllGlobals();sessionStorage.clear();});
  it('reuses a failed request UUID but binds distinct content to another UUID',async()=>{
    const {jobIntentRequest}=await vi.importActual<typeof import('../../client/src/lib/job-brief')>('../../client/src/lib/job-brief');
    mocks.api.mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValue({json:async()=>({ok:true})});
    await expect(jobIntentRequest(3,9,'save','/synthetic',{expectedRevision:2,note:'one'})).rejects.toThrow();
    const first=mocks.api.mock.calls[0]?.[2].requestId;
    expect(sessionStorage.length).toBe(1);expect(JSON.stringify(sessionStorage)).not.toContain('note');
    await jobIntentRequest(3,9,'save','/synthetic',{expectedRevision:2,note:'one'});expect(mocks.api.mock.calls[1]?.[2].requestId).toBe(first);expect(sessionStorage.length).toBe(0);
    await jobIntentRequest(3,9,'save','/synthetic',{expectedRevision:2,note:'two'});expect(mocks.api.mock.calls[2]?.[2].requestId).not.toBe(first);
  });

});
