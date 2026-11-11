/** Permanent regression tests for candidate account isolation and recovery.
 * Synthetic input and injected transports only; no provider or database calls. */
import { expect, it, vi } from 'vitest';
import { createSparkSession, ProfileApiError, RESUME_SOURCE, watchResume } from '@/lib/candidate-profile-api';
import { resumeAdapters } from './SourceReview';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { OnboardingWizard } from './OnboardingWizard';
import { DEFAULT_PREFERENCES } from './PreferencesForm';
import { EMPTY_PROFILE } from './ProfessionalDetailsForm';
import { queryClient, clearUserScopedQueryCache } from '@/lib/queryClient';
import { PROFILE_QUERY_KEY, publicationPoll } from './CareerProfilePanel';
import { webcrypto } from 'node:crypto';
const reply=(status:number, body:unknown)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});

it('reselecting identical bytes reuses the upload, but a different file with the same name does not',async()=>{
 vi.stubGlobal('crypto',webcrypto);
 try {
  const upload=vi.fn(async()=>17);
  const post=vi.fn(async()=>reply(403,{code:'consent_required'}));
  const adapter=resumeAdapters({session:{acceptSource:vi.fn()},currentProfile:()=>null,deps:{upload,postFetcher:post as typeof fetch}});
  const file=(byte:number)=>{const f=new File(['x'],'cv.pdf');Object.defineProperty(f,'arrayBuffer',{value:async()=>new Uint8Array([byte]).buffer});return f;};
  await expect(adapter.readResume(file(1))).rejects.toBeDefined();
  await expect(adapter.readResume(file(1))).rejects.toBeDefined();
  expect(upload).toHaveBeenCalledOnce();
  await expect(adapter.readResume(file(2))).rejects.toBeDefined();
  expect(upload).toHaveBeenCalledTimes(2);
 } finally {vi.unstubAllGlobals();}
});

it('a lost snapshot response retains both its upload and request key on retry',async()=>{
 const upload=vi.fn(async()=>17);const bodies:any[]=[];
 const post=vi.fn(async(_url:any,init:any)=>{bodies.push(JSON.parse(init.body));throw new TypeError('lost response');});
 const adapter=resumeAdapters({session:{acceptSource:vi.fn()},currentProfile:()=>null,deps:{upload,postFetcher:post as typeof fetch,wait:async()=>{}}});
 const file=new File(['x'],'cv.pdf');
 await expect(adapter.readResume(file)).rejects.toBeDefined();
 await expect(adapter.readResume(file)).rejects.toBeDefined();
 expect(upload).toHaveBeenCalledOnce();expect(bodies).toHaveLength(6);
 expect(bodies.every(b=>JSON.stringify(b)===JSON.stringify(bodies[0]))).toBe(true);
});

it('publication polling is bounded and stops as soon as the authoritative state settles',()=>{
 const window={current:null as {version:string;until:number}|null};
 const data:any={kind:'ready',profile:{profileVersion:1,preferenceVersion:1,capabilities:{discoveryBlockedReason:'publication_pending'}}};
 expect(publicationPoll(data,window)).toBe(4000);
 window.current!.until=Date.now()-1;
 expect(publicationPoll(data,window)).toBe(false);
 data.profile.capabilities.discoveryBlockedReason=null;
 expect(publicationPoll(data,window)).toBe(false);expect(window.current).toBeNull();
});

it('a timed-out read checks the original command with GET only and reuses its uploaded file',async()=>{
 const file=new File(['synthetic'],'cv.pdf');
 const upload=vi.fn(async()=>17);
 const p={proposalId:'p',sourceId:'s',sourceVersion:1,proposalHash:'a'.repeat(64),facts:[]};
 const post=vi.fn(async(url:any)=>String(url)===RESUME_SOURCE.snapshot
  ?reply(200,{sourceId:'s',sourceVersion:1}):reply(202,{commandId:'c',sourceId:'s',sourceVersion:1,state:'queued',proposalId:null}));
 let ready=false;
 const fetcher=vi.fn(async()=>ready?reply(200,{commandId:'c',sourceId:'s',sourceVersion:1,state:'review_ready',proposalId:'p'}):reply(503,{code:'unavailable'}));
 const adapter=resumeAdapters({session:{acceptSource:vi.fn()},currentProfile:()=>null,
  deps:{upload,postFetcher:post as typeof fetch,fetcher:fetcher as typeof fetch,wait:async()=>{},fetchProposal:async()=>p}});
 await expect(adapter.readResume(file)).rejects.toMatchObject({read:{kind:'pending',commandId:'c'}});
 expect(fetcher).toHaveBeenCalledTimes(20);expect(post).toHaveBeenCalledTimes(2);
 ready=true;
 await expect(adapter.retryResume('c')).resolves.toMatchObject({resumeVersionId:'p'});
 await expect(adapter.readResume(file)).resolves.toMatchObject({resumeVersionId:'p'});
 expect(upload).toHaveBeenCalledOnce();expect(post).toHaveBeenCalledTimes(2);
});

it('restores a fresh candidate résumé proposal without an existing draft',async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 try {
  await act(async()=>root.render(<OnboardingWizard firstName="Test" imported="none" consentVersion="2" discovery="not_ready" matching="not_ready"
   pendingResume={async()=>({resumeVersionId:'p',items:[{id:'skill',kind:'skill',value:'RESTORED_SKILL',evidence:'RESTORED_SKILL',source:{resumeVersionId:'p',extractionVersion:'1'}}]})}
   onSave={vi.fn()} onConfirm={vi.fn()} />));
  await act(async()=>{await new Promise(r=>setTimeout(r,350));});
  expect(host.textContent).toContain('RESTORED_SKILL');
 } finally {await act(async()=>root.unmount());host.remove();}
});

it('account-change cleanup removes the prior candidate Spark profile',()=>{
 const privateProfile={displayName:'Synthetic previous account',privateNotes:['private synthetic note']};
 queryClient.setQueryData(PROFILE_QUERY_KEY,privateProfile);
 queryClient.setQueryData(['/api/candidate/example'],{private:true});
 clearUserScopedQueryCache();
 expect(queryClient.getQueryData(['/api/candidate/example'])).toBeUndefined();
 expect(queryClient.getQueryData(PROFILE_QUERY_KEY)).toBeUndefined();
 queryClient.removeQueries({queryKey:PROFILE_QUERY_KEY});
});

it('a lost login gives actionable résumé recovery copy',async()=>{
 const upload=vi.fn(async()=>17);
 const post=vi.fn(async()=>reply(403,{code:'recent_auth_required'}));
 const adapter=resumeAdapters({session:{acceptSource:vi.fn()},currentProfile:()=>null,deps:{upload,postFetcher:post as typeof fetch}});
 let error:any;try{await adapter.readResume(new File(['synthetic'],'cv.pdf'));}catch(e){error=e;}
 expect(upload).toHaveBeenCalledOnce();expect(post).toHaveBeenCalledOnce();
 expect(error).not.toBeInstanceOf(ProfileApiError);expect(error.code).toBeUndefined();
 expect(error.read.kind).toBe('error');
 expect(error.read.message).toContain('sign in again');
});

it('empty resume review closes for a fresh candidate with no draft',async()=>{
 const p={proposalId:'p',sourceId:'s',sourceVersion:1,proposalHash:'a'.repeat(64),facts:[]};
 const reject=vi.fn();
 const post=vi.fn(async(url:any)=>String(url)===RESUME_SOURCE.snapshot
  ?reply(200,{sourceId:'s',sourceVersion:1}):reply(202,{sourceId:'s',sourceVersion:1,state:'review_ready',proposalId:'p'}));
 const adapter=resumeAdapters({session:{acceptSource:vi.fn(),rejectSource:reject},currentProfile:()=>null,
  deps:{upload:async()=>17,postFetcher:post as typeof fetch,fetchProposal:async()=>p}});
 await adapter.readResume(new File(['synthetic'],'cv.pdf'));
 await expect(adapter.acceptResume('p',{},{})).resolves.toEqual(EMPTY_PROFILE);
 expect(reject).toHaveBeenCalledOnce();
});

it('retrying confirm after uncertain responses preserves the entire command',async()=>{
 const p:any={draftVersion:2,profileVersion:0,preferenceVersion:1,draftHash:'a'.repeat(64),
  preferenceDraft:{preferenceDraftRevision:4,preferenceDraftHash:'b'.repeat(64),sections:{},promotedDraftRevision:4,promotedPreferenceVersion:1},
  effectiveConsentRevision:1,capabilities:{canConfirm:true},pendingCommands:[]};
 const sent:any[]=[];let n=0;
 const session=createSparkSession(p,{newKey:()=>`key-${++n}`,wait:async()=>{},postFetcher:(async(_u:any,init:any)=>{
  sent.push(JSON.parse(init.body));throw new TypeError('lost response');}) as typeof fetch});
 const review={profileVersion:'2',preferencesVersion:'4'};
 for(let i=0;i<2;i++)await expect(session.confirm(review,async()=>({kind:'ready',profile:p}))).rejects.toMatchObject({code:'uncertain'});
 expect(sent).toHaveLength(6);
 expect(sent[0].idempotencyKey).toBe(sent[2].idempotencyKey);
 expect(sent[0]).toEqual(sent[3]);
});

it('resume watching stops during service outage without retrying paid work',async()=>{
 let waits=0;const fetcher=vi.fn(async()=>reply(503,{code:'unavailable'}));
 await expect(watchResume('c',()=>{},undefined,{fetcher:fetcher as typeof fetch,wait:async()=>{
  if(++waits===150)throw Error('audit stops unbounded poll');
 }})).rejects.toMatchObject({code:'resume_status_pending'});
 expect(fetcher).toHaveBeenCalledTimes(20);
});

it('an older file finishing last cannot replace the selected newer file review',async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 const pending:Record<string,(value:any)=>void>={};
 const read=vi.fn((file:File)=>new Promise<any>(resolve=>{pending[file.name]=resolve;}));
 const accept=vi.fn(async()=>({...EMPTY_PROFILE}));
 const flush=async()=>{await act(async()=>{await new Promise(r=>setTimeout(r,350));});};
 const click=async(name:string)=>{const b=[...host.querySelectorAll('button')].find(x=>x.textContent?.trim()===name);expect(b).toBeTruthy();await act(async()=>b!.click());await flush();};
 try{
  await act(async()=>root.render(<OnboardingWizard firstName="Test" imported="none" consentVersion="2" discovery="not_ready" matching="not_ready"
   saved={{profile:{...EMPTY_PROFILE,displayName:'Test',currentLocation:{city:'Pune',countryCode:'IN',displayCountry:'India'},skills:['Python']},preferences:DEFAULT_PREFERENCES,answered:[]} as any}
   readResume={read} acceptResume={accept} onSave={vi.fn()} onConfirm={vi.fn()} />));
  await flush();await click('Back');
  const select=async(name:string)=>{
   const input=host.querySelector('input[type="file"]')!;
   Object.defineProperty(input,'files',{value:[new File(['x'],name,{type:'application/pdf'})],configurable:true});
   await act(async()=>input.dispatchEvent(new Event('change',{bubbles:true})));
  };
  await select('old.pdf');await select('new.pdf');expect(read).toHaveBeenCalledTimes(2);
  const result=(id:string)=>({resumeVersionId:id,items:[{id,kind:'skill',value:id,evidence:id,source:{resumeVersionId:id,extractionVersion:'1'}}]});
  await act(async()=>pending['new.pdf']!(result('NEW_SKILL')));
  await act(async()=>pending['old.pdf']!(result('OLD_SKILL')));
  expect(host.textContent).toContain('new.pdf');await click('Continue');
  expect(host.textContent).toContain('NEW_SKILL');expect(host.textContent).not.toContain('OLD_SKILL');
 }finally{await act(async()=>root.unmount());host.remove();}
});
