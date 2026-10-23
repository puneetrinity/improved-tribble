import React from 'react';
import {act} from 'react-dom/test-utils';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
vi.mock('../../client/src/components/ui/dialog',()=>({
 Dialog:({open,children}:any)=>open?<div>{children}</div>:null,
 DialogContent:({children,...props}:any)=><div {...props}>{children}</div>,
 DialogTitle:({children}:any)=><h2>{children}</h2>,
}));
import {SourcingProgressModal,INITIAL_PROGRESS} from '../../client/src/components/sourcing/SourcingProgressModal';
import type {SignalRcProgress} from '../../shared/rc-skills-progress';

describe('RC bounded progress UI',()=>{
 let host:HTMLDivElement,root:Root;
 const onClose=vi.fn(),onRunAgain=vi.fn();
 const progress:SignalRcProgress={version:1,state:'enriching_skills',processed:3,total:5,
  updatedAt:'2026-10-09T10:00:00Z',notificationDelivered:false,safeReason:'working'};
 beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');
  document.body.append(host);root=createRoot(host);});
 afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.clearAllMocks();});
 const render=(value=progress,unavailable=false)=>act(async()=>root.render(<SourcingProgressModal open
  progress={{...INITIAL_PROGRESS,rcProgress:value,rcStatusUnavailable:unavailable}} onClose={onClose} onRunAgain={onRunAgain}/>));
 it.each(['enriching_skills','stalled','closed_unrecoverable','partial','complete'] as const)(
  'shows finite counts without a paid retry or fabricated percentage for %s',async state=>{
   await render({...progress,state});expect(host.textContent).toContain('3 of 5 profiles checked');
   expect(host.textContent).not.toContain('%');expect(host.textContent).not.toMatch(/Run again|Try again/i);
   expect(onRunAgain).not.toHaveBeenCalled();
   await act(async()=>host.querySelector('button')!.click());expect(onClose).toHaveBeenCalledTimes(1);
  });
 it('claims notification delivery only after acknowledgement',async()=>{
  await render({...progress,state:'stalled'});expect(host.textContent).toContain('letting support know');
  expect(host.textContent).not.toContain('has been notified');
  await render({...progress,state:'stalled',notificationDelivered:true});expect(host.textContent).toContain('has been notified');
 });
 it('shows a queue that has not started as waiting, never finished, and without empty counts',async()=>{
  await render({...progress,state:'queued',safeReason:'worker_queue',workStarted:false,processed:0,total:0});
  expect(host.textContent).toContain('Skills check queued');expect(host.textContent).toContain('waiting to start');
  expect(host.textContent).not.toMatch(/finished|profiles checked|%/);
  expect(host.querySelector('[data-rc-tone]')?.getAttribute('data-rc-tone')).toBe('waiting');
  expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBeNull();
 });
 it('shows a rate-window wait with work already done and keeps the processed count',async()=>{
  await render({...progress,state:'queued',safeReason:'quota_window',workStarted:true,processed:2,total:5});
  expect(host.textContent).toContain('Skills check waiting');expect(host.textContent).toContain('temporarily paused');
  expect(host.textContent).toContain('already checked are kept');expect(host.textContent).toContain('2 of 5 profiles checked');
  expect(host.textContent).not.toMatch(/finished|%|Run again|Try again/i);
  const bar=host.querySelector('[role="progressbar"]')!;
  expect(bar.getAttribute('aria-valuenow')).toBe('2');expect(bar.getAttribute('aria-valuemax')).toBe('5');
 });
 it('gives the close control a 44px minimum target',async()=>{
  await render();expect(host.querySelector('button')!.className).toMatch(/min-h-\[44px\]/);
 });
 it('makes unavailable status explicit without restarting or promising success',async()=>{
  await render(progress,true);expect(host.textContent).toContain('Status temporarily unavailable');
  expect(host.textContent).toContain('still saved');expect(onRunAgain).not.toHaveBeenCalled();
 });
});

describe('Main sourcing progress: plain language for recruiters',()=>{
 let host:HTMLDivElement,root:Root;
 beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');
  document.body.append(host);root=createRoot(host);});
 afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
 const running={...INITIAL_PROGRESS,phase:'discovery' as const,percent:5,
  message:'🚀 [PIPELINE] Sourcing job queued — waiting for worker',devLogs:['🚀 [PIPELINE] Phase started — worker is live']};
 it('hides the internal event log from recruiters and shows the stage in plain words',async()=>{
  await act(async()=>root.render(<SourcingProgressModal open progress={running} onClose={()=>{}}/>));
  const text=host.textContent??'';
  expect(text).not.toMatch(/event log|dev console/i);
  expect(text).not.toContain('[PIPELINE]');expect(text).not.toContain('waiting for worker');
  expect(text).toContain('Looking across the market and the candidate profiles you already have.');
  expect(text).toContain('This usually takes a couple of minutes.');
 });
 it('lets long stage labels wrap instead of cutting them off',async()=>{
  await act(async()=>root.render(<SourcingProgressModal open progress={running} onClose={()=>{}}/>));
  const items=[...host.querySelectorAll('li[data-stage]')];
  expect(items).toHaveLength(4);
  for(const li of items){expect(li.innerHTML).not.toContain('truncate');}
  expect(host.textContent).toContain('Searching the market and saved candidate profiles');
 });
 it('shows the event log only when the page allows it (super admins)',async()=>{
  await act(async()=>root.render(<SourcingProgressModal open progress={running} onClose={()=>{}} showDevConsole/>));
  const button=[...host.querySelectorAll('button')].find(b=>/event log/i.test(b.textContent??''));
  expect(button).toBeTruthy();
  await act(async()=>button!.click());
  expect(host.textContent).toContain('Phase started');
 });
});

import {CriteriaMatchPanel,evidenceSources,criterionLabel} from '../../client/src/components/sourcing/CandidateDrawer';
describe('Candidate criteria match panel: plain language',()=>{
 let host:HTMLDivElement,root:Root;
 beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');
  document.body.append(host);root=createRoot(host);});
 afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
 const id=(n:number)=>`00000000-0000-4000-8000-00000000000${n}`;
 const a=(n:number,label:string,state:'met'|'not_met'|'unknown',weight:0|1|3,refs:string[],mapped=true)=>({criterionIds:[id(n)],labels:[label],subject:'skill',state,mapped,weight,
  points:state==='met'?weight:0,localPoints:0,refs});
 const ranking:any={N:6,D:10,L:0,assessments:[
  a(1,'4 to 7 years of professional backend development experience.','met',3,['employment']),
  a(2,'Location','met',3,['basic_profile.location.city','basic_profile.location.country']),
  a(3,'AWS experience.','unknown',1,[]),a(4,'Kafka or another event streaming system.','not_met',3,[]),
  a(5,'Leadership','unknown',0,[],false)]};
 it('groups requirements and shows plain sources, never field paths',async()=>{
  await act(async()=>root.render(<CriteriaMatchPanel ranking={ranking}/>));
  const text=host.textContent??'';
  expect(text).toContain('How they match your criteria');expect(text).toContain('Score: 6 of 10');
  expect([...host.querySelectorAll('[data-match-group]')].map(e=>e.getAttribute('data-match-group'))).toEqual(['met','not_met','unknown','unscored']);
  expect(text).toContain('Found in: Location on profile');expect(text).toContain('Found in: Work history');
  expect(text).not.toMatch(/basic_profile|profile\.skills|Evidence:/);
  expect(text).toContain('4 to 7 years of professional backend development experience');
  expect(text).not.toContain('experience.:');
  expect(text).toContain('No points are deducted');
 });
 it('maps evidence references to plain names and tidies labels',()=>{
  expect(evidenceSources(['basic_profile.location.city','basic_profile.location.country'])).toEqual(['Location on profile']);
  expect(evidenceSources(['profile.skills','employment','something.else'])).toEqual(['Skills on profile','Work history','Profile']);
  expect(criterionLabel(['Strong Python are required.'])).toBe('Strong Python are required');
  expect(criterionLabel(['Any one of: Django, FastAPI'])).toBe('Any one of: Django, FastAPI');
 });
});

import {poolCardCopy} from '../../client/src/lib/sourcing-pool-copy';
describe('Main sourcing progress: completion and pool card wording',()=>{
 let host:HTMLDivElement,root:Root;
 beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');
  document.body.append(host);root=createRoot(host);});
 afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
 it('gives completion its own subtitle instead of the getting-ready fallback',async()=>{
  await act(async()=>root.render(<SourcingProgressModal open progress={{...INITIAL_PROGRESS,phase:'complete',percent:100}} onClose={()=>{}}/>));
  const text=host.textContent??'';
  expect(text).toContain('Your results are ready');expect(text).toContain('Your ranked candidates are ready to review.');
  expect(text).not.toContain('Getting your search ready');
 });
 it.each([undefined,{state:'unknown'},{state:'failed',preparation:'failed'},{state:'pending',preparation:null}] as any[])(
  'never promises results when the pool is not counted (%o)',p=>{
   const c=poolCardCopy(p);
   expect(c.counted).toBe(false);expect(c.note).toBe('The estimate is separate from your search results.');
   expect(c.note).not.toMatch(/can still find/i);
 });
 it('shows the count and staleness only when counted',()=>{
  const c=poolCardCopy({state:'complete',count:1240,countRelation:'gte',stale:true} as any);
  expect(c.headline).toBe(`At least ${(1240).toLocaleString()} people match your search`);
  expect(c.note).toContain('more than a day old');
 });
});

import {poolPreparationMessage} from '../../client/src/lib/sourcing-pool-copy';
describe('Talent pool readiness line while data loads',()=>{
 const base={previewError:false,briefLoaded:true,briefError:false,briefApproved:true,unsupported:[] as string[]};
 const ready={artifactId:'a',id:'i',state:'complete',count:1,countRelation:'eq',observedAt:null,stale:false,preparation:'ready'} as any;
 const unprepared={...ready,artifactId:null,preparation:null};
 it('does not ask for approval before the search status has loaded',()=>{
  const m=poolPreparationMessage({...base,preview:undefined});
  expect(m).toBe('Checking your search status…');expect(m).not.toMatch(/Approve/);
 });
 it('does not ask for approval before the criteria have loaded',()=>{
  expect(poolPreparationMessage({...base,preview:unprepared,briefLoaded:false,briefApproved:false})).toBe('Checking your search status…');
 });
 it('does not ask for approval when the criteria failed to load',()=>{
  const m=poolPreparationMessage({...base,preview:unprepared,briefLoaded:false,briefError:true,briefApproved:false});
  expect(m).toBe("We couldn't load the hiring criteria. Please refresh the page.");expect(m).not.toMatch(/Approve/);
 });
 it('says nothing once the search is ready',()=>{
  expect(poolPreparationMessage({...base,preview:ready})).toBeNull();
 });
 it('asks for approval only when the loaded criteria are not approved',()=>{
  expect(poolPreparationMessage({...base,preview:unprepared,briefApproved:false})).toBe('Approve the hiring criteria to get this search ready.');
  expect(poolPreparationMessage({...base,preview:unprepared,briefApproved:true})).toBe("Your search isn't ready yet.");
 });
 it('keeps the existing failure and in-progress wording',()=>{
  expect(poolPreparationMessage({...base,preview:undefined,previewError:true})).toBe("We couldn't confirm the search status. Please check again.");
  expect(poolPreparationMessage({...base,preview:{...unprepared,preparation:'started'}})).toMatch(/^Getting your search ready/);
  expect(poolPreparationMessage({...base,preview:{...unprepared,preparationCode:'QUERY_MAPPING_UNSUPPORTED'},unsupported:['Rust']})).toBe("Some requirements can't be used to search yet: Rust. Edit them to continue.");
 });
});
