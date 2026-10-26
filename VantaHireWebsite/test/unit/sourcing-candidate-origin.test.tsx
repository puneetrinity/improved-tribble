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
 const entryLevel={...base,crustdata:{basic_profile:{name:'Test Person',headline:'Backend Engineer'},experience:{employment_details:{
  current:[{title:'Staff Engineer',name:'Acme',seniority_level:'Entry Level',years_at_company_raw:7}],
  past:[{title:'Engineer',name:'Beta',seniority_level:'Entry Level',years_at_company_raw:5}]}}}};
 it('card: shows our experience, never the provider seniority label',async()=>{
  await card(entryLevel);
  expect(host.textContent).toContain('12 yrs exp');expect(host.textContent).not.toContain('Entry Level');
 });
 it('detail panel: shows experience years, never provider seniority (summary or per job)',async()=>{
  await drawer(entryLevel);
  expect(host.textContent).toContain('12 Yrs Exp');expect(host.textContent).not.toContain('Entry Level');
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

import {candidateSourceGroup,countSourceGroups} from '../../client/src/lib/sourcing-source-label';
describe('result source badges, applicant location and source summary',()=>{
 let host:HTMLDivElement,root:Root;
 beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');
  document.body.append(host);root=createRoot(host);});
 afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
 const card=(c:any)=>act(async()=>root.render(<TooltipProvider><CandidateCard candidate={c} onClick={()=>{}} onShortlist={()=>{}}
  governed isUpdating={false}/></TooltipProvider>));
 const drawer=(c:any)=>act(async()=>root.render(<QueryClientProvider client={new QueryClient()}><TooltipProvider>
  <CandidateDrawer candidate={c} open onClose={()=>{}} onUpdateState={()=>{}} isUpdating={false} governed/></TooltipProvider></QueryClientProvider>));
 const located={...applicant,sourceType:'pool',resumeLocation:{city:'Bengaluru',country:'India'},
  crustdata:{basic_profile:{location:{full_location:'Should Not Show'}}}};
 const memory={...base,sourceType:'pool',crustdata:{basic_profile:{name:'Pool Person',location:{full_location:'Pune, Maharashtra, India'}}}};
 const fresh={...base,sourceType:'discovered'};
 const badge=()=>host.querySelector('[data-source-badge]')?.getAttribute('data-source-badge')??null;

 it('labels each group once, previous applicant first, and never guesses a malformed origin',()=>{
  expect(candidateSourceGroup(located)).toBe('previous_applicant');
  expect(candidateSourceGroup(memory)).toBe('from_memory');
  expect(candidateSourceGroup({...base,sourceType:'pool_enriched'})).toBe('from_memory');
  expect(candidateSourceGroup(fresh)).toBe('new');
  expect(candidateSourceGroup(malformed)).toBeNull();
  expect(candidateSourceGroup({...base,sourceType:'mystery'})).toBeNull();
 });
 it('card: previous applicant shows their résumé location and no memory/new badge',async()=>{
  await card(located);
  expect(host.textContent).toContain('Previous applicant');expect(badge()).toBeNull();
  const loc=host.querySelector('[data-location-source]')!;
  expect(loc.getAttribute('data-location-source')).toBe('resume');
  expect(loc.textContent).toContain('Bengaluru, India');expect(loc.textContent).toContain('(from résumé)');
  expect(host.textContent).not.toContain('Should Not Show');
 });
 it('card: country-only and unknown applicant locations stay as given',async()=>{
  await card({...located,resumeLocation:{city:null,country:'India'}});
  expect(host.querySelector('[data-location-source="resume"]')?.textContent).toContain('India');
  await card({...located,resumeLocation:null});
  expect(host.querySelector('[data-location-source]')?.getAttribute('data-location-source')).toBe('unknown');
  expect(host.textContent).toContain('Location unknown');expect(host.textContent).not.toContain('Should Not Show');
 });
 it('card: public results keep their profile location with From memory / New badges',async()=>{
  await card(memory);
  expect(badge()).toBe('from_memory');expect(host.textContent).toContain('From memory');
  expect(host.querySelector('[data-location-source="profile"]')?.textContent).toContain('Pune, Maharashtra, India');
  await card(fresh);expect(badge()).toBe('new');
  await card(malformed);expect(badge()).toBeNull();
 });
 it('card: applicant contact restrictions are unchanged by the location',async()=>{
  await card(located);
  expect([...host.querySelectorAll('a')].some(a=>a.getAttribute('href')?.includes('linkedin.com'))).toBe(false);
  expect(host.textContent).not.toMatch(/Reveal|person@example\.com/);
 });
 it('detail panel: shows résumé location, or says the résumé gives none',async()=>{
  await drawer(located);
  expect(host.textContent).toContain('Bengaluru, India');expect(host.textContent).toContain('From their résumé');
  expect(host.textContent).not.toContain('Should Not Show');
  await drawer({...located,resumeLocation:null});
  expect(host.textContent).toContain('Location unknown');
 });
 it('summary counts mutually exclusive groups and skips hidden results',()=>{
  const rows=[located,{...located,id:2},memory,{...memory,id:4,state:'hidden'},fresh,malformed];
  expect(countSourceGroups(rows)).toEqual({total:5,previous_applicant:2,from_memory:1,new:1});
  expect(countSourceGroups([])).toEqual({total:0,previous_applicant:0,from_memory:0,new:0});
 });
});
