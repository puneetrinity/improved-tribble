import React from 'react';
import {act} from 'react-dom/test-utils';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {TooltipProvider} from '../../client/src/components/ui/tooltip';
import {readCandidateOrigin,allowsPublicContact,applicationHref,candidateDisplayName} from '../../client/src/lib/sourcing-candidate-origin';
import {CandidateCard} from '../../client/src/components/sourcing/CandidateCard';
vi.mock('../../client/src/components/ui/sheet',()=>({
 Sheet:({open,children}:any)=>open?<div>{children}</div>:null,
 SheetContent:({children,...props}:any)=><div {...props}>{children}</div>,
 SheetHeader:({children}:any)=><div>{children}</div>,
 SheetTitle:({children}:any)=><h2>{children}</h2>,
 SheetDescription:({children}:any)=><p>{children}</p>,
}));
import {CandidateDrawer} from '../../client/src/components/sourcing/CandidateDrawer';

describe('past-applicant origin reader (fails closed)',()=>{
 it('treats a missing origin as the historical public profile',()=>{
  expect(readCandidateOrigin(undefined)).toEqual({kind:'public_profile'});
  expect(readCandidateOrigin({version:1,kind:'public_profile'})).toEqual({kind:'public_profile'});
 });
 it('names applicants from their application, never a profile name; public profiles keep the profile name',()=>{
  const app=readCandidateOrigin({version:1,kind:'organization_candidate',applicationId:41,applicationJobId:7});
  expect(candidateDisplayName(app,'Profile Name','Asha Previous')).toBe('Asha Previous');
  expect(candidateDisplayName(app,'Profile Name',undefined)).toBe('Previous applicant');
  expect(candidateDisplayName(app,'Profile Name','  ')).toBe('Previous applicant');
  expect(candidateDisplayName(readCandidateOrigin(undefined),'Profile Name','Asha Previous')).toBe('Profile Name');
  expect(candidateDisplayName(readCandidateOrigin(undefined),null,null)).toBe('Unknown Candidate');
 });
 it('reads a valid applicant origin and builds the application link',()=>{
  const o=readCandidateOrigin({version:1,kind:'organization_candidate',applicationId:41,applicationJobId:7});
  expect(o).toEqual({kind:'organization_candidate',applicationId:41,applicationJobId:7});
  expect(allowsPublicContact(o)).toBe(false);
  expect(applicationHref(o)).toBe('/jobs/7/applications?applicationId=41');
 });
 it.each([
  ['wrong version',{version:2,kind:'organization_candidate',applicationId:41,applicationJobId:7}],
  ['unknown kind',{version:1,kind:'mystery'}],
  ['missing ids',{version:1,kind:'organization_candidate'}],
  ['string id',{version:1,kind:'organization_candidate',applicationId:'41',applicationJobId:7}],
  ['zero id',{version:1,kind:'organization_candidate',applicationId:0,applicationJobId:7}],
  ['extra field',{version:1,kind:'organization_candidate',applicationId:41,applicationJobId:7,email:'x@y.z'}],
  ['public with extra field',{version:1,kind:'public_profile',linkedinUrl:'https://linkedin.com/in/x'}],
  ['array',[]],['string','organization_candidate'],['null (damaged)',null],
 ])('marks %s as invalid with no public contact',(_l,v)=>{
  const o=readCandidateOrigin(v);
  expect(o).toEqual({kind:'invalid'});expect(allowsPublicContact(o)).toBe(false);expect(applicationHref(o)).toBeNull();
 });
});

const now='2026-10-16T10:00:00Z';
const base:any={id:9001,jobId:1,signalCandidateId:'sig-1',signalRank:1,fitScore:null,fitScoreRaw:null,fitBreakdown:null,
 sourceType:'discovered',displayBucket:'newly_discovered',state:'shortlisted',decisionRevision:1,
 foundEmail:'person@example.com',foundEmails:['person@example.com'],emailResolvedAt:now,emailResolveStatus:'resolved',
 outreachCount:0,lastOutreachRound:null,lastOutreachCampaignId:null,lastOutreachAt:null,lastOutreachStatus:null,
 crustdata:{basic_profile:{name:'Test Person',headline:'Backend Engineer'}},linkedinUrl:'https://linkedin.com/in/test-person',
 enrichmentStatus:null,confidenceScore:null,searchSnippet:null,searchProvider:null,
 searchSignals:{serpDate:null,serpDateDaysAgo:null,linkedinHost:null,linkedinLocale:null},matchStrength:null,identitySummary:null,
 snapshot:null,freshness:{lastEnrichedAt:now,lastIdentityCheckAt:null,enrichedDaysAgo:0,identityCheckDaysAgo:null},
 cardSignals:{email:'person@example.com',phone:null,github:'https://github.com/x',twitter:null,skillsTopN:['Python'],activeSeeker:false,
  summaryShort:null,emailAvailable:true,phoneAvailable:false},aiSummary:null,candidateSummary:null,lastSyncedAt:now,createdAt:now};
const applicant={...base,candidateOrigin:{version:1,kind:'organization_candidate',applicationId:41,applicationJobId:7},candidateSummary:{nameHint:'Asha Previous'}};
const malformed={...base,candidateOrigin:{version:1,kind:'organization_candidate',applicationId:'41'}};

describe('past-applicant card and detail panel',()=>{
 let host:HTMLDivElement,root:Root;
 beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');
  document.body.append(host);root=createRoot(host);});
 afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
 const card=(c:any)=>act(async()=>root.render(<TooltipProvider><CandidateCard candidate={c} onClick={()=>{}} onShortlist={()=>{}}
  governed isUpdating={false} shortlistMode/></TooltipProvider>));
 const drawer=(c:any)=>act(async()=>root.render(<QueryClientProvider client={new QueryClient()}><TooltipProvider>
  <CandidateDrawer candidate={c} open onClose={()=>{}} onUpdateState={()=>{}} isUpdating={false} governed/></TooltipProvider></QueryClientProvider>));
 const linkedin=()=>[...host.querySelectorAll('a')].filter(a=>a.getAttribute('href')?.includes('linkedin.com'));

 it('public profile keeps LinkedIn and contact controls (unchanged behaviour)',async()=>{
  await card(base);
  expect(linkedin().length).toBe(1);expect(host.textContent).not.toContain('Previous applicant');
  expect(host.textContent).not.toContain('Open application');
 });
 it('card: past applicant shows the label and application link, never LinkedIn or contact',async()=>{
  await card(applicant);
  expect(host.textContent).toContain('Previous applicant');expect(host.textContent).toContain('Asha Previous');
  const open=[...host.querySelectorAll('a')].find(a=>a.textContent?.includes('Open application'));
  expect(open?.getAttribute('href')).toBe('/jobs/7/applications?applicationId=41');
  expect(linkedin()).toHaveLength(0);
  expect(host.textContent).not.toMatch(/Reveal|Finding email|person@example\.com|pe•/);
  expect([...host.querySelectorAll('a')].some(a=>a.getAttribute('href')?.includes('github.com'))).toBe(false);
 });
 it('card: malformed origin fails closed',async()=>{
  await card(malformed);
  expect(host.textContent).toContain('Applicant details unavailable');
  expect(linkedin()).toHaveLength(0);expect(host.textContent).not.toContain('Open application');
  expect(host.textContent).not.toMatch(/Reveal|person@example\.com/);
 });
 it('detail panel: past applicant has no LinkedIn, no email lookup, and an application link',async()=>{
  await drawer(applicant);
  const text=host.textContent??'';
  expect(text).toContain('Previous applicant');expect(text).toContain('Contact them through their application.');
  expect(text).not.toContain('Find Personal Email');expect(text).not.toContain('person@example.com');
  expect(linkedin()).toHaveLength(0);
  const open=[...host.querySelectorAll('a')].find(a=>a.textContent?.includes('Open application'));
  expect(open?.getAttribute('href')).toBe('/jobs/7/applications?applicationId=41');
 });
 it('detail panel: malformed origin withholds contact',async()=>{
  await drawer(malformed);
  expect(host.textContent).toContain('Contact details aren’t available for this result.');
  expect(host.textContent).not.toContain('person@example.com');expect(linkedin()).toHaveLength(0);
 });
});

import {ColdOutreachSidebar} from '../../client/src/components/outreach/ColdOutreachSidebar';
describe('cold outreach re-checks eligibility before sending',()=>{
 let host:HTMLDivElement,root:Root;
 beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');
  document.body.append(host);root=createRoot(host);});
 afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
 const a={...base,id:1,outreachCount:0},b={...base,id:2,outreachCount:0,crustdata:{basic_profile:{name:'Second Person'}}};
 const drafts={campaignLabel:'First Campaign',campaignSummary:'s',drafts:[1,2].map(id=>({candidateId:id,name:'n'+id,email:`p${id}@example.com`,subject:'Hi',body:'<p>Hello</p>'}))};
 const button=(label:string)=>[...host.querySelectorAll('button')].find(x=>x.textContent?.trim()===label) as HTMLButtonElement|undefined;
 const render=(cands:any[],onDraft:any,onSend:any)=>act(async()=>root.render(<ColdOutreachSidebar open onOpenChange={()=>{}} candidates={cands}
  campaignRound={1} onDraft={onDraft} onSend={onSend} isDrafting={false} isSending={false}/>));
 it('never drafts for a past applicant',async()=>{
  const onDraft=vi.fn().mockResolvedValue(drafts);
  await render([a,{...b,candidateOrigin:{version:1,kind:'organization_candidate',applicationId:5,applicationJobId:1}}],onDraft,vi.fn());
  await act(async()=>button('Start First Campaign')!.click());
  expect(onDraft).toHaveBeenCalledTimes(1);expect(onDraft.mock.calls[0][0].candidateIds).toEqual([1]);
 });
 it('holds back a draft whose candidate became an applicant after drafting, and reports it',async()=>{
  const onDraft=vi.fn().mockResolvedValue(drafts);
  const onSend=vi.fn().mockResolvedValue({sent:1,failed:0,skipped:0,campaign:{campaignId:'x',campaignRound:1,audienceCount:1},results:[]});
  await render([a,b],onDraft,onSend);
  await act(async()=>button('Start First Campaign')!.click());
  expect(onDraft.mock.calls[0][0].candidateIds).toEqual([1,2]);
  // Candidate 2 applies while the drafts are open.
  await render([a,{...b,candidateOrigin:{version:1,kind:'organization_candidate',applicationId:5,applicationJobId:1}}],onDraft,onSend);
  expect(host.querySelector('[data-withheld-drafts]')?.textContent).toContain('1 draft won’t be sent');
  await act(async()=>button('Send First Campaign')!.click());
  expect(onSend).toHaveBeenCalledTimes(1);
  expect(onSend.mock.calls[0][0].messages.map((m:any)=>m.candidateId)).toEqual([1]);
  expect(host.textContent).toContain('1 not sent (no longer eligible)');
 });
 it('sends nothing when every draft became ineligible',async()=>{
  const onDraft=vi.fn().mockResolvedValue({...drafts,drafts:drafts.drafts.slice(0,1)});const onSend=vi.fn();
  await render([a],onDraft,onSend);
  await act(async()=>button('Start First Campaign')!.click());
  await render([{...a,candidateOrigin:null}],onDraft,onSend);
  expect(button('Send First Campaign')!.disabled).toBe(true);
  await act(async()=>button('Send First Campaign')!.click());
  expect(onSend).not.toHaveBeenCalled();
 });
});
