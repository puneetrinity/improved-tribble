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
   await render({...progress,state});expect(host.textContent).toContain('3 of 5 profiles processed');
   expect(host.textContent).not.toContain('%');expect(host.textContent).not.toMatch(/Run again|Try again/i);
   expect(onRunAgain).not.toHaveBeenCalled();
   await act(async()=>host.querySelector('button')!.click());expect(onClose).toHaveBeenCalledTimes(1);
  });
 it('claims notification delivery only after acknowledgement',async()=>{
  await render({...progress,state:'stalled'});expect(host.textContent).toContain('notification is pending');
  expect(host.textContent).not.toContain('has been notified');
  await render({...progress,state:'stalled',notificationDelivered:true});expect(host.textContent).toContain('has been notified');
 });
 it('shows a queue that has not started as waiting, never finished, and without empty counts',async()=>{
  await render({...progress,state:'queued',safeReason:'worker_queue',workStarted:false,processed:0,total:0});
  expect(host.textContent).toContain('Skills check queued');expect(host.textContent).toContain('free worker');
  expect(host.textContent).not.toMatch(/finished|profiles processed|%/);
  expect(host.querySelector('[data-rc-tone]')?.getAttribute('data-rc-tone')).toBe('waiting');
  expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBeNull();
 });
 it('shows a rate-window wait with work already done and keeps the processed count',async()=>{
  await render({...progress,state:'queued',safeReason:'quota_window',workStarted:true,processed:2,total:5});
  expect(host.textContent).toContain('Skills check waiting');expect(host.textContent).toContain('request window');
  expect(host.textContent).toContain('already processed are kept');expect(host.textContent).toContain('2 of 5 profiles processed');
  expect(host.textContent).not.toMatch(/finished|%|Run again|Try again/i);
  const bar=host.querySelector('[role="progressbar"]')!;
  expect(bar.getAttribute('aria-valuenow')).toBe('2');expect(bar.getAttribute('aria-valuemax')).toBe('5');
 });
 it('gives the close control a 44px minimum target',async()=>{
  await render();expect(host.querySelector('button')!.className).toMatch(/min-h-\[44px\]/);
 });
 it('makes unavailable status explicit without restarting or promising success',async()=>{
  await render(progress,true);expect(host.textContent).toContain('Status temporarily unavailable');
  expect(host.textContent).toContain('has not been restarted');expect(onRunAgain).not.toHaveBeenCalled();
 });
});
