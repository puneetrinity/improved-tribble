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
 it('makes unavailable status explicit without restarting or promising success',async()=>{
  await render(progress,true);expect(host.textContent).toContain('Status temporarily unavailable');
  expect(host.textContent).toContain('has not been restarted');expect(onRunAgain).not.toHaveBeenCalled();
 });
});
