import React from 'react';
import {act} from 'react-dom/test-utils';
import {createRoot,type Root} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

const apiRequest=vi.fn();
vi.mock('../../client/src/lib/queryClient',()=>({apiRequest:(...args:unknown[])=>apiRequest(...args)}));
vi.mock('../../client/src/hooks/use-auth',()=>({useAuth:()=>({user:{id:7}})}));
import {HiringCriteriaStep,starterCriteria,withDetailFoundations,starterPlan,sections,usedSlots,foundationsReady,skillCriterion,MAX_CRITERIA,upgradedPayload,BRIEF_SCHEMA}
  from '../../client/src/components/hiring-criteria-step';

const JD='We are hiring a Senior Backend Engineer in Bengaluru. Python and PostgreSQL are required. Kafka is nice to have.';
const details={title:'Senior Backend Engineer',location:'Bengaluru, India',experienceYears:'6',skills:['Python','PostgreSQL','python'],goodToHaveSkills:['Kafka']};
const baseBrief={revision:'1',currentJD:JD,sourceHash:'a'.repeat(64),latest:null,approvedVersionId:null,approvedMaterialHash:null,draft:null,
  source:{classifierVersion:1,initialized:true,selectionRequired:false,ambiguous:false,choices:[],legacyStructured:false}};

describe('hiring criteria helpers',()=>{
 it('builds starter criteria only from details, deduplicated, with experience and location',()=>{
  const p=starterCriteria(details);const s=sections(p);
  expect(s.experience).toHaveLength(1);expect(s.location).toHaveLength(1);
  expect(s.must.map(c=>c.requirement.kind==='accepted_skills'&&c.requirement.primary)).toEqual(['Python','PostgreSQL']);
  expect(s.nice).toHaveLength(1);expect(p.criteria.every(c=>c.provenance.kind==='recruiter_edit')).toBe(true);
  expect(foundationsReady(p)).toBe(true);expect(usedSlots(p)).toBe(5);
 });
 it('saves new briefs as schema 4 and lets resumes count as evidence for starter requirements',()=>{
  const p=starterCriteria(details);
  expect(p).toMatchObject({schemaVersion:4,compilerVersion:4,taxonomyVersion:4});expect(BRIEF_SCHEMA).toBe(4);
  expect(p.criteria.every(c=>JSON.stringify(c.evidenceKinds)===JSON.stringify(['profile_evidence','candidate_provided']))).toBe(true);
 });
 it('upgrades an older brief only when asked, adding resume evidence only where a resume can count',()=>{
  const old={schemaVersion:3,compilerVersion:3,taxonomyVersion:3,criteria:[
   {...skillCriterion('Python','must_have'),evidenceKinds:['profile_evidence']},
   {...skillCriterion('x','preferred'),subject:'leadership',requirement:{kind:'text',value:'Leads'},evidenceKinds:['recruiter_judgement']},
   {...skillCriterion('y','must_have'),subject:'work_eligibility',requirement:{kind:'text',value:'EU'},evidenceKinds:['candidate_provided']}]} as any;
  const frozen=JSON.stringify(old);const up=upgradedPayload(old);
  expect(JSON.stringify(old)).toBe(frozen);
  expect(up).toMatchObject({schemaVersion:4,compilerVersion:4,taxonomyVersion:4});
  expect(up.criteria.map(c=>c.evidenceKinds)).toEqual([['profile_evidence','candidate_provided'],['recruiter_judgement'],['candidate_provided']]);
  const current=starterCriteria(details);expect(upgradedPayload(current)).toBe(current);
 });
 it('never invents experience or location and always reserves their two slots',()=>{
  const p=starterCriteria({...details,location:' ',experienceYears:''});
  expect(sections(p).experience).toHaveLength(0);expect(sections(p).location).toHaveLength(0);
  expect(foundationsReady(p)).toBe(false);expect(usedSlots(p)).toBe(2+3);
 });
 it('counts every skill separately against the 12 total',()=>{
  const p={...starterCriteria(details),criteria:[...starterCriteria(details).criteria,...Array.from({length:8},(_,i)=>skillCriterion(`S${i}`,'must_have'))]};
  expect(usedSlots(p)).toBe(13);expect(usedSlots(p)>MAX_CRITERIA).toBe(true);
 });
});

const many={...details,skills:Array.from({length:15},(_,i)=>`Must${i}`),goodToHaveSkills:Array.from({length:18},(_,i)=>`Nice${i}`)};
describe('detail foundations',()=>{
 it('fills a location the AI left out from confirmed details, without overwriting or adding twice',()=>{
  const ai=starterCriteria({...details,location:''});
  expect(sections(ai).location).toHaveLength(0);
  const filled=withDetailFoundations(ai,details);const s=sections(filled);
  expect(s.location).toHaveLength(1);expect(s.location[0].requirement).toMatchObject({kind:'text',value:'Bengaluru, India'});
  expect(s.location[0].provenance.kind).toBe('recruiter_edit');expect(foundationsReady(filled)).toBe(true);
  expect(usedSlots(filled)).toBe(usedSlots(ai));
  expect(withDetailFoundations(filled,{...details,location:'Pune'})).toBe(filled);
 });
 it('does not pick from Details when the JD itself states conflicting values',()=>{
  const ai=starterCriteria({...details,location:'',experienceYears:''});
  const conflict=(topic:string)=>({id:'x'+topic,text:topic,priority:'required',topic,quote:topic,sourceHash:'a'.repeat(64),span:null,proposedCriterion:null,reason:'conflicting_foundation'});
  const ws={contractVersion:1,extractionId:'e',sourceHash:'a'.repeat(64),extractionLimit:false,items:[conflict('location'),conflict('location')],dispositions:[],reviewHash:null,versionId:null,exclusionsConfirmed:false} as any;
  const out=withDetailFoundations(ai,details,ws);
  expect(sections(out).location).toHaveLength(0);expect(sections(out).experience).toHaveLength(1);
  const ws2={...ws,items:[conflict('overall_experience'),conflict('overall_experience')]};
  const out2=withDetailFoundations(ai,details,ws2);
  expect(sections(out2).experience).toHaveLength(0);expect(sections(out2).location).toHaveLength(1);
 });
 it('leaves an AI experience range alone and adds nothing when details are empty',()=>{
  const ai=starterCriteria(details);
  expect(withDetailFoundations(ai,{...details,experienceYears:'2',location:'Pune'})).toBe(ai);
  const bare=starterCriteria({...details,experienceYears:'',location:''});
  expect(withDetailFoundations(bare,{...details,experienceYears:'',location:'  '})).toBe(bare);
 });
 it('does not override an unsupported AI location with a broader Details value',()=>{
  const ai=starterCriteria({...details,location:''});
  const ws={items:[{topic:'location',text:'Bavaria, Germany',proposedCriterion:null,reason:'unsupported_mapping'}]} as any;
  expect(withDetailFoundations(ai,{...details,location:'Germany'},ws)).toBe(ai);
 });
});

describe('starter plan',()=>{
 it('prefills everything when it fits in 12',()=>{
  const p=starterPlan(details);expect(p.suggestions).toEqual([]);expect(usedSlots(p.payload)).toBe(5);
 });
 it('keeps every skill as a suggestion instead of truncating when it does not fit',()=>{
  const p=starterPlan(many);
  expect(sections(p.payload).experience).toHaveLength(1);expect(sections(p.payload).location).toHaveLength(1);
  expect(p.payload.criteria).toHaveLength(2);expect(p.suggestions).toHaveLength(33);
  expect(p.suggestions.filter(x=>x.cls==='must_have')).toHaveLength(15);
 });
});

describe('HiringCriteriaStep',()=>{
 let host:HTMLDivElement,root:Root,brief:any,config:any,preview:any,calls:string[];
 const onSubmitted=vi.fn();
 beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.append(host);root=createRoot(host);
  brief={...baseBrief};config={jobBriefEnabled:true,sourcingEnabled:true};preview={artifactId:null,id:null,state:'pending',count:null,countRelation:null,observedAt:null,stale:false,preparation:'started'};calls=[];
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>{calls.push(`GET ${url}`);
   const body=url.endsWith('/brief')?brief:url==='/api/client-config'?config:url.endsWith('/sourcing/preview')?preview:{};
   return {ok:true,json:async()=>body} as Response;}));
  apiRequest.mockReset();
 });
 afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();sessionStorage.clear();vi.clearAllMocks();});
 const settle=async(ms=0)=>{for(let i=0;i<6;i++)await act(async()=>{await new Promise(r=>setTimeout(r,ms));});};
 const render=async(d=details)=>{const qc=new QueryClient({defaultOptions:{queries:{retry:false}}});
  await act(async()=>root.render(<QueryClientProvider client={qc}><HiringCriteriaStep jobId={42} actorId={7} details={d} onSubmitted={onSubmitted}/></QueryClientProvider>));await settle();};
 const button=(text:string)=>[...host.querySelectorAll('button')].find(b=>b.textContent===text) as HTMLButtonElement;

 it('shows labelled starter criteria when automatic drafting is off, with no model call',async()=>{
  await render();
  expect(host.textContent).toContain('From your job details — not checked against the JD');
  expect(host.textContent).toContain('5 of 12 criteria used');
  expect(host.querySelector('[aria-label="Remove Python"]')).not.toBeNull();
  expect([...host.querySelectorAll('label')].some(l=>l.textContent?.startsWith('Skill'))).toBe(true);
  expect(apiRequest).not.toHaveBeenCalled();
  expect(button('Post job').disabled).toBe(true);
  expect(host.textContent).toContain('Available after you approve the criteria');
  expect(host.textContent).not.toMatch(/crustdata/i);
 });

 it('blocks approval until location is entered',async()=>{
  await render();
  const loc=host.querySelector('input[placeholder^="City, Country"]') as HTMLInputElement;
  const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;
  await act(async()=>{setter.call(loc,'');loc.dispatchEvent(new Event('input',{bubbles:true}));});
  expect(button('Approve criteria').disabled).toBe(true);
  expect(host.textContent).toContain('Add experience and location to approve');
  expect(loc.getAttribute('aria-invalid')).toBe('true');expect(loc.getAttribute('aria-describedby')).toBe('loc-missing');
  expect(host.querySelector('#loc-missing')?.textContent).toContain('Required');
  await act(async()=>{setter.call(loc,'India');loc.dispatchEvent(new Event('input',{bubbles:true}));});
  expect(button('Approve criteria').disabled).toBe(false);
 });

 it('does not interpret raw Details geography; preserves wording for review',async()=>{
  await render({...details,location:'Bengaluru, India (hybrid, three days a week in office)'});
  const loc=host.querySelector('input[placeholder^="City, Country"]') as HTMLInputElement;
  const arr=host.querySelector('input[placeholder^="e.g. Hybrid"]') as HTMLInputElement;
  expect(loc.value).toBe('Bengaluru, India (hybrid, three days a week in office)');expect(arr.value).toBe('');
  expect(host.textContent).toContain('Put hybrid, remote or office details under Work arrangement');
  expect(button('Approve criteria').disabled).toBe(true);
 });

 it('asks for the country instead of guessing one, and blocks approval until it is a place we can match',async()=>{
  await render();
  const loc=host.querySelector('input[placeholder^="City, Country"]') as HTMLInputElement;
  const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;
  for(const [value,text] of [['Bengaluru','End the location with a country'],['Bengaluru, India (hybrid)','Put hybrid, remote or office details under Work arrangement'],['Bengaluru or Pune, India','Use one place']] as const){
   await act(async()=>{setter.call(loc,value);loc.dispatchEvent(new Event('input',{bubbles:true}));});
   expect(button('Approve criteria').disabled).toBe(true);
   expect(host.querySelector('#loc-missing')?.textContent).toContain(text);
   expect(loc.value).toBe(value);
  }
  await act(async()=>{setter.call(loc,'Bengaluru, India');loc.dispatchEvent(new Event('input',{bubbles:true}));});
  expect(button('Approve criteria').disabled).toBe(false);
 });

 it.each([['Bengaluru or Pune, India','Use one place'],['Lahore, Punjab','End the location with a country'],['Dubai, UAE','Write the country as "United Arab Emirates"']] as const)
 ('Details location %s is shown as written with a fix, never changed, and blocks approval',async(raw,text)=>{
  await render({...details,location:raw});
  const loc=host.querySelector('input[placeholder^="City, Country"]') as HTMLInputElement;
  expect(loc.value).toBe(raw);
  expect(host.querySelector('#loc-missing')?.textContent).toContain(text);
  expect(button('Approve criteria').disabled).toBe(true);
 });

 it('a typed alias the scorer cannot match gets the exact spelling to use',async()=>{
  await render();
  const loc=host.querySelector('input[placeholder^="City, Country"]') as HTMLInputElement;
  const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;
  await act(async()=>{setter.call(loc,'Dubai, UAE');loc.dispatchEvent(new Event('input',{bubbles:true}));});
  expect(host.querySelector('#loc-missing')?.textContent).toContain('Write the country as "United Arab Emirates"');
  expect(button('Approve criteria').disabled).toBe(true);
  await act(async()=>{setter.call(loc,'Bengaluru, India.');loc.dispatchEvent(new Event('input',{bubbles:true}));});
  expect(host.querySelector('#loc-missing')?.textContent).toContain('no full stop');
 });

 it('saves the place and the work arrangement together, then approves',async()=>{
  apiRequest.mockImplementation(async(_m:string,url:string)=>{
   if(url.endsWith('/brief'))return {json:async()=>({revision:'2',versionId:'11111111-1111-4111-8111-111111111111'})};
   if(url.endsWith('/brief/approve'))return {json:async()=>({revision:'3',versionId:'11111111-1111-4111-8111-111111111111'})};
   return {json:async()=>({})};});
  await render();
  const arr=host.querySelector('input[placeholder^="e.g. Hybrid"]') as HTMLInputElement;
  const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;
  await act(async()=>{setter.call(arr,'Hybrid, 3 days a week in office');arr.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>button('Approve criteria').click());await settle(10);
  const saved=apiRequest.mock.calls.find(c=>c[1]==='/api/jobs/42/brief')![2];
  const loc=saved.payload.criteria.find((c:any)=>c.subject==='location');
  expect(loc.requirement).toEqual({kind:'text',value:'Bengaluru, India'});expect(loc.note).toBe('Hybrid, 3 days a week in office');
 });

 it('drafts automatically exactly once when the server switch is on, and shows the AI draft',async()=>{
  config={...config,jobBriefAutoDraftEnabled:true};
  const ai={schemaVersion:3,compilerVersion:3,taxonomyVersion:3,criteria:starterCriteria(details).criteria};
  apiRequest.mockResolvedValue({json:async()=>({state:'succeeded',result:ai})});
  await render();await settle(10);
  const drafts=apiRequest.mock.calls.filter(c=>String(c[1]).endsWith('/brief/draft'));
  expect(drafts).toHaveLength(1);expect(drafts[0][2]).toMatchObject({mode:'automatic',expectedRevision:1});
  expect(host.textContent).toContain('Drafted by AI from your JD');
 });

 it('never spends a draft when one already exists, and refetches on skipped',async()=>{
  config={...config,jobBriefAutoDraftEnabled:true};
  brief={...baseBrief,draft:{state:'failed',code:'BRIEF_MODEL_INVALID'}};
  await render();
  expect(apiRequest).not.toHaveBeenCalled();
  expect(host.textContent).toContain('We could not build a complete, valid draft');
 });

 it('after a failed draft: no call on reload; uncertain errors keep the same request; only a confirmed result frees it',async()=>{
  config={...config,jobBriefAutoDraftEnabled:true};
  brief={...baseBrief,draft:{state:'failed',code:'BRIEF_MODEL_TIMEOUT'}};
  await render();
  expect(apiRequest).not.toHaveBeenCalled();
  expect(host.textContent).toContain('AI drafting timed out.');
  const retry=()=>button('Try the AI draft again');
  // Lost response, BRIEF_UNAVAILABLE and BRIEF_RETRY_SAME_REQUEST are all uncertain: the SAME request id is reused.
  apiRequest.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  await act(async()=>retry().click());await settle();
  expect(host.textContent).toContain('will not start a second one');
  apiRequest.mockRejectedValueOnce(new Error('503: BRIEF_UNAVAILABLE'));
  await act(async()=>retry().click());await settle();
  apiRequest.mockRejectedValueOnce(new Error('409: BRIEF_RETRY_SAME_REQUEST'));
  await act(async()=>retry().click());await settle();
  // The server confirms a terminal result (HTTP 200): the id is released...
  apiRequest.mockResolvedValueOnce({json:async()=>({state:'failed',code:'BRIEF_MODEL_FAILED'})});
  await act(async()=>retry().click());await settle();
  expect(host.textContent).toContain('AI drafting was unavailable.');
  // ...so the next deliberate click is a new request; the server then reports the attempt limit.
  apiRequest.mockRejectedValueOnce(new Error('429: BRIEF_DRAFT_LIMIT'));
  await act(async()=>retry().click());await settle();
  const ids=apiRequest.mock.calls.filter(c=>String(c[1]).endsWith('/brief/draft')).map(c=>c[2]);
  expect(ids).toHaveLength(5);expect(ids.every(b=>b.mode==='manual')).toBe(true);
  expect(new Set(ids.slice(0,4).map(b=>b.requestId)).size).toBe(1);
  expect(ids[4].requestId).not.toBe(ids[3].requestId);
  expect(host.textContent).toContain('drafting limit for this JD is reached');
  expect(retry()).toBeUndefined();
 });

 it('a replay that finds the earlier draft still running waits for it instead of failing',async()=>{
  config={...config,jobBriefAutoDraftEnabled:true};
  brief={...baseBrief,draft:{state:'failed',code:'BRIEF_MODEL_FAILED'}};
  await render();
  apiRequest.mockResolvedValueOnce({json:async()=>({state:'dispatched'})});
  brief={...baseBrief,draft:{state:'dispatched'}};
  await act(async()=>button('Try the AI draft again').click());await settle();
  expect(host.textContent).toContain('Drafting the hiring criteria from your JD');
  expect(host.textContent).not.toContain('AI drafting was unavailable');
 });

 it('a successful retry loads the new AI draft',async()=>{
  config={...config,jobBriefAutoDraftEnabled:true};
  brief={...baseBrief,draft:{state:'failed',code:'BRIEF_MODEL_FAILED'}};
  await render();
  const ai={schemaVersion:3,compilerVersion:3,taxonomyVersion:3,criteria:starterCriteria(details).criteria};
  apiRequest.mockResolvedValueOnce({json:async()=>({state:'succeeded',result:ai})});
  brief={...baseBrief,draft:{state:'succeeded',result:ai}};
  await act(async()=>button('Try the AI draft again').click());await settle(10);
  expect(host.textContent).toContain('Drafted by AI from your JD');
  expect(button('Try the AI draft again')).toBeUndefined();
 });

 it('saves then approves, shows the persistent pool card, then enables Post job; never starts sourcing',async()=>{
  apiRequest.mockImplementation(async(_m:string,url:string)=>{
   if(url.endsWith('/brief')){brief={...brief,revision:'2',latest:{version_id:'11111111-1111-4111-8111-111111111111',version_number:1,payload:starterCriteria(details)}};}
   if(url.endsWith('/brief/approve')){brief={...brief,revision:'3',approvedVersionId:brief.latest.version_id};
    preview={...preview,state:'complete',count:12400,countRelation:'eq',observedAt:'2026-10-15T08:00:00Z',artifactId:'a',preparation:'ready'};}
   if(url.endsWith('/brief/submit')){brief={...brief,revision:'4'};}
   if(url.endsWith('/brief'))return {json:async()=>({revision:'2',versionId:'11111111-1111-4111-8111-111111111111'})};
   if(url.endsWith('/brief/approve'))return {json:async()=>({revision:'3',versionId:'11111111-1111-4111-8111-111111111111'})};
   return {json:async()=>({})};});
  await render();
  await act(async()=>button('Approve criteria').click());await settle(10);
  const urls=apiRequest.mock.calls.map(c=>c[1]);
  expect(urls).toEqual(['/api/jobs/42/brief','/api/jobs/42/brief/approve']);
  expect(apiRequest.mock.calls[0][2]).toMatchObject({expectedRevision:1});
  expect(apiRequest.mock.calls[1][2]).toMatchObject({expectedRevision:2,versionId:'11111111-1111-4111-8111-111111111111'});
  expect(host.textContent).toContain('About 12,400');
  expect(host.textContent).toContain('No sourcing has started');
  expect(host.textContent).toContain('When you start sourcing from Find candidates');
  expect(calls.some(c=>/sourcing\/(start|admission|runs)/.test(c))).toBe(false);
  expect(button('Post job').disabled).toBe(false);
  await act(async()=>button('Post job').click());await settle();
  const submit=apiRequest.mock.calls.find(c=>String(c[1]).endsWith('/brief/submit'))!;
  expect(submit[0]).toBe('POST');expect(submit[2]).toMatchObject({expectedRevision:3});expect(submit[2].requestId).toMatch(/^[0-9a-f-]{36}$/);
  expect(onSubmitted).toHaveBeenCalledTimes(1);
 });

 it('an approved schema-3 brief loads as approved and unchanged; Update and approve saves schema 4 then approves',async()=>{
  const vid='11111111-1111-4111-8111-111111111111',v3={...starterCriteria(details),schemaVersion:3,compilerVersion:3,taxonomyVersion:3,
   criteria:starterCriteria(details).criteria.map(c=>({...c,evidenceKinds:['profile_evidence']}))};
  brief={...brief,latest:{version_id:vid,version_number:1,payload:v3},approvedVersionId:vid};
  apiRequest.mockImplementation(async(_m:string,url:string)=>{
   if(url.endsWith('/brief'))return {json:async()=>({revision:'2',versionId:'22222222-2222-4222-8222-222222222222'})};
   if(url.endsWith('/brief/approve'))return {json:async()=>({revision:'3'})};
   return {json:async()=>({})};});
  await render();
  expect(apiRequest).not.toHaveBeenCalled();
  expect(host.textContent).toContain('To include previous applicants, review these requirements, then save and approve them again.');
  expect(button('Post job').disabled).toBe(false);
  await act(async()=>button('Update and approve').click());await settle(10);
  expect(apiRequest.mock.calls.map(c=>c[1])).toEqual(['/api/jobs/42/brief','/api/jobs/42/brief/approve']);
  const saved=apiRequest.mock.calls[0][2].payload;
  expect(saved).toMatchObject({schemaVersion:4,compilerVersion:4,taxonomyVersion:4});
  expect(saved.criteria.every((c:any)=>c.evidenceKinds.includes('candidate_provided'))).toBe(true);
  expect(apiRequest.mock.calls[1][2]).toMatchObject({versionId:'22222222-2222-4222-8222-222222222222'});
 });

 it('does not navigate when the submission is unconfirmed, and retries with the same request id',async()=>{
  brief={...baseBrief,revision:'3',latest:{version_id:'11111111-1111-4111-8111-111111111111',version_number:1,payload:starterCriteria(details)},approvedVersionId:'11111111-1111-4111-8111-111111111111'};
  apiRequest.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({json:async()=>({action:'submit'})});
  await render();
  await act(async()=>button('Post job').click());await settle();
  expect(onSubmitted).not.toHaveBeenCalled();
  expect(host.textContent).toContain('it won’t be sent twice');
  await act(async()=>button('Post job').click());await settle();
  const ids=apiRequest.mock.calls.filter(c=>String(c[1]).endsWith('/brief/submit')).map(c=>c[2].requestId);
  expect(ids).toHaveLength(2);expect(ids[0]).toBe(ids[1]);expect(onSubmitted).toHaveBeenCalledTimes(1);
 });

 it('treats an already-submitted job as confirmed success',async()=>{
  brief={...baseBrief,revision:'3',latest:{version_id:'11111111-1111-4111-8111-111111111111',version_number:1,payload:starterCriteria(details)},approvedVersionId:'11111111-1111-4111-8111-111111111111'};
  apiRequest.mockRejectedValue(new Error('409: {"code":"BRIEF_SUBMISSION_REQUIRED"}'));
  await render();await act(async()=>button('Post job').click());await settle();
  expect(onSubmitted).toHaveBeenCalledTimes(1);expect(host.querySelector('[role=alert]')).toBeNull();
 });

 it('lists overflowing starter skills as suggestions, adds one on click, and says how many are not included',async()=>{
  const qc=new QueryClient({defaultOptions:{queries:{retry:false}}});
  await act(async()=>root.render(<QueryClientProvider client={qc}><HiringCriteriaStep jobId={42} actorId={7} details={many} onSubmitted={onSubmitted}/></QueryClientProvider>));await settle();
  expect(host.textContent).toContain('Suggested from your job details');expect(host.textContent).toContain('33 · not included yet');
  expect(host.textContent).toContain('2 of 12 criteria used');expect(host.textContent).toContain('33 suggested skills are not included');
  await act(async()=>[...host.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='Add Must0 as must-have skill')!.click());
  expect(host.textContent).toContain('3 of 12 criteria used');expect(host.textContent).toContain('32 · not included yet');
 });

 it('never approves a version changed in another tab that is not on screen',async()=>{
  const v1={version_id:'11111111-1111-4111-8111-111111111111',version_number:1,payload:starterCriteria(details)};
  brief={...baseBrief,revision:'2',latest:v1};
  const qc=new QueryClient({defaultOptions:{queries:{retry:false}}});
  await act(async()=>root.render(<QueryClientProvider client={qc}><HiringCriteriaStep jobId={42} actorId={7} details={details} onSubmitted={onSubmitted}/></QueryClientProvider>));await settle();
  expect(button('Approve criteria').disabled).toBe(false);
  // Another tab saves version 2 with different criteria; this screen refreshes its server state.
  brief={...brief,revision:'3',latest:{version_id:'22222222-2222-4222-8222-222222222222',version_number:2,payload:{...starterCriteria(details),criteria:starterCriteria(details).criteria.slice(0,2)}}};
  await act(async()=>{await qc.invalidateQueries();});await settle();
  expect(host.textContent).toContain('changed in another tab or by a teammate');
  expect(button('Approve criteria').disabled).toBe(true);
  expect(apiRequest).not.toHaveBeenCalled();
  expect(host.textContent).toContain('5 of 12 criteria used');
  await act(async()=>button('Load latest version').click());await settle();
  expect(host.textContent).toContain('2 of 12 criteria used');expect(host.textContent).not.toContain('changed in another tab');
  apiRequest.mockResolvedValue({json:async()=>({revision:'4'})});
  await act(async()=>button('Approve criteria').click());await settle();
  expect(apiRequest.mock.calls[0][1]).toBe('/api/jobs/42/brief/approve');
  expect(apiRequest.mock.calls[0][2]).toMatchObject({expectedRevision:3,versionId:'22222222-2222-4222-8222-222222222222'});
 });

 it('shows and edits the upper limit of an experience range',async()=>{
  const p=starterCriteria(details);const exp=p.criteria.find(c=>c.subject==='experience_years')!;
  exp.requirement={kind:'experience_range',minimum:6,maximum:8} as any;
  brief={...baseBrief,revision:'2',latest:{version_id:'11111111-1111-4111-8111-111111111111',version_number:1,payload:p}};
  await render();
  const max=[...host.querySelectorAll('label')].find(l=>l.textContent?.startsWith('Maximum years'))!.querySelector('input') as HTMLInputElement;
  expect(max.value).toBe('8');
  const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;
  await act(async()=>{set.call(max,'5');max.dispatchEvent(new Event('input',{bubbles:true}));});
  expect(host.textContent).toContain('Must be at least the minimum');expect(button('Approve criteria').disabled).toBe(true);
  await act(async()=>{set.call(max,'');max.dispatchEvent(new Event('input',{bubbles:true}));});
  expect(max.value).toBe('');expect(button('Approve criteria').disabled).toBe(false);
 });

 describe('with an AI review workspace',()=>{
  const H='a'.repeat(64);
  const mk=()=>{const base=starterCriteria(details);const s0=sections(base);const py=s0.must[0],pg=s0.must[1];const go=skillCriterion('Go','preferred');
   const it_=(id:string,c:any,reason:any=null,span:any={start:0,end:4})=>({id,text:c?c.label:'Mentors engineers weekly',priority:'required',topic:'skill',quote:span?'JDQ':'made up',sourceHash:H,span,proposedCriterion:c,reason});
   const ws={contractVersion:1,extractionId:'33333333-3333-4333-8333-333333333333',sourceHash:H,extractionLimit:false,reviewHash:null,versionId:null,exclusionsConfirmed:false,dispositions:[],
    items:[it_('i1',py),it_('i2',pg),it_('i3',go,'capacity'),it_('i4',null,'quote_not_found',null)]};
   const result={...base,criteria:[...s0.experience,...s0.location,py,pg]};
   return {ws,result,go};};
  const V2='44444444-4444-4444-8444-444444444444';
  it('shows what was left out, lets the recruiter add it, and approves without extra steps',async()=>{
   const {ws,result,go}=mk();brief={...baseBrief,sourceHash:H,draft:{state:'review_required',result},reviewWorkspace:ws};
   apiRequest.mockImplementation(async(_m:string,url:string)=>url.endsWith('/brief')
     ?{json:async()=>({revision:'2',versionId:V2,reviewHash:'b'.repeat(64)})}:{json:async()=>({revision:'3'})});
   await render();
   expect(host.textContent).toContain('Other requirements from the job description · 2');
   expect(host.querySelector('[aria-label="Add “Mentors engineers weekly” to the requirements"]')).toBeNull();
   expect(host.querySelectorAll('input[type=checkbox]')).toHaveLength(0);expect(host.querySelector('select[aria-label^="Exclude"]')).toBeNull();
   expect(button('Approve criteria').disabled).toBe(false);
   await act(async()=>(host.querySelector('[aria-label="Add “Go” to the requirements"]') as HTMLButtonElement).click());
   expect(host.textContent).toContain('Other requirements from the job description · 1');expect(host.textContent).toContain('Nice-to-have skills · 1');
   await act(async()=>button('Approve criteria').click());await settle(10);
   const save=apiRequest.mock.calls.find(c=>String(c[1]).endsWith('/brief'))![2];
   expect(save.reviewSelection.dispositions).toEqual([
    {itemId:'i1',state:'included',criterionIds:[(ws.items[0] as any).proposedCriterion.id]},{itemId:'i2',state:'included',criterionIds:[(ws.items[1] as any).proposedCriterion.id]},
    {itemId:'i3',state:'included',criterionIds:[go.id]},{itemId:'i4',state:'excluded',reason:'other'}]);
   const approve=apiRequest.mock.calls.find(c=>String(c[1]).endsWith('/brief/approve'))![2];
   expect(approve).toEqual(expect.objectContaining({versionId:V2,expectedRevision:2}));expect(approve.reviewConfirmation).toBeUndefined();
  });
  it('long JD: shows a note, does not block approval',async()=>{
   const {ws,result}=mk();brief={...baseBrief,sourceHash:H,draft:{state:'review_required',result},reviewWorkspace:{...ws,extractionLimit:true}};
   await render();
   expect(host.textContent).toContain('may have missed some requirements');expect(button('Approve criteria').disabled).toBe(false);
  });
 });

 it('warns before leaving with unsaved edits',async()=>{
  const add=vi.spyOn(window,'addEventListener');
  await render();
  expect(add.mock.calls.some(c=>c[0]==='beforeunload')).toBe(false);
  const loc=host.querySelector('input[placeholder^="City, Country"]') as HTMLInputElement;
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(loc,'India');loc.dispatchEvent(new Event('input',{bubbles:true}));});
  expect(add.mock.calls.some(c=>c[0]==='beforeunload')).toBe(true);add.mockRestore();
 });

 it('shows a submitted job as sent, without approve or post controls',async()=>{
  const qc=new QueryClient({defaultOptions:{queries:{retry:false}}});
  await act(async()=>root.render(<QueryClientProvider client={qc}><HiringCriteriaStep jobId={42} actorId={7} details={details} onSubmitted={onSubmitted} jobStatus="pending"/></QueryClientProvider>));await settle();
  expect(host.textContent).toContain('Sent for admin approval');expect(host.textContent).not.toContain('Draft saved');
  expect(button('Post job')).toBeUndefined();expect(apiRequest).not.toHaveBeenCalled();
 });

 it('waits on an in-flight (dispatched) draft without a second call or a failure label',async()=>{
  config={...config,jobBriefAutoDraftEnabled:true};
  brief={...baseBrief,draft:{state:'dispatched'}};
  await render();
  expect(host.textContent).toContain('Drafting the hiring criteria from your JD');
  expect(host.textContent).not.toContain('From your job details');
  expect(apiRequest).not.toHaveBeenCalled();
 });

 it('maps the server foundations refusal to a fix-it message and keeps edits',async()=>{
  apiRequest.mockImplementation(async(_m:string,url:string)=>{
   if(url.endsWith('/brief')){brief={...brief,revision:'2',latest:{version_id:'11111111-1111-4111-8111-111111111111',version_number:1,payload:starterCriteria(details)}};return {json:async()=>({revision:'2',versionId:'11111111-1111-4111-8111-111111111111'})};}
   throw new Error('BRIEF_FOUNDATIONS_REQUIRED');});
  await render();await act(async()=>button('Approve criteria').click());await settle();
  expect(host.textContent).toContain('Add the experience and location criteria, then approve again');
  expect(button('Post job').disabled).toBe(true);
 });
});
