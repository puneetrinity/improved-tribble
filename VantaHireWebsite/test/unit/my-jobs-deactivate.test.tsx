import React, {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
const mocks=vi.hoisted(()=>({change:vi.fn(),toast:vi.fn(),invalidate:vi.fn(),request:vi.fn(),user:{id:3,role:'recruiter'}}));
vi.mock('../../client/src/hooks/use-auth',()=>({useAuth:()=>({user:mocks.user})}));
vi.mock('../../client/src/hooks/use-toast',()=>({useToast:()=>({toast:mocks.toast})}));
vi.mock('../../client/src/lib/job-brief',()=>({changeJobPublication:mocks.change,readBriefCapability:async()=>({jobBriefEnabled:true})}));
vi.mock('../../client/src/lib/queryClient',()=>({apiRequest:mocks.request,queryClient:{invalidateQueries:mocks.invalidate}}));
import MyJobsPage from '../../client/src/pages/my-jobs-page';

let root:Root, host:HTMLDivElement, client:QueryClient;
const job={id:7,title:'Backend Engineer',description:'Build APIs',location:'Pune',isActive:true,status:'approved',postedBy:3,createdAt:new Date().toISOString()};
const button=(label:string)=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent?.trim()===label)!;
async function click(label:string){await act(async()=>{button(label).click();await new Promise(r=>setTimeout(r,10));});}
async function mount(jobs:any[]=[job]){
 client.setQueryData(['/api/my-jobs'],jobs);client.setQueryData(['job-brief-capability'],{jobBriefEnabled:true});
 await act(async()=>{root.render(<QueryClientProvider client={client}><MyJobsPage/></QueryClientProvider>);});
}
beforeEach(()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
 vi.clearAllMocks();mocks.user.role='recruiter';mocks.change.mockResolvedValue({ok:true});
 client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity,queryFn:async()=>null},mutations:{retry:false}}});
 host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();client.clear();vi.unstubAllGlobals();sessionStorage.clear();});
describe('recruiter deactivation',()=>{
 it('asks first, uses plain wording, and cancelling sends nothing',async()=>{
  await mount();await click('Deactivate');
  expect(document.body.textContent).toContain('will no longer be public or accept new applications');
  expect(document.body.textContent).toContain('existing applications will stay available');
  expect(document.body.textContent).toContain('search already running will continue');
  expect(mocks.change).not.toHaveBeenCalled();await click('Keep job active');
  expect(button('Deactivate job')).toBeUndefined();expect(mocks.change).not.toHaveBeenCalled();
 });
 it('uses the existing publication helper with false, then refreshes and confirms success',async()=>{
  await mount();await click('Deactivate');await click('Deactivate job');
  expect(mocks.change).toHaveBeenCalledExactlyOnceWith(3,'recruiter',7,false,true);
  expect(mocks.invalidate).toHaveBeenCalledWith({queryKey:['/api/my-jobs']});
  expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({title:'Job deactivated'}));
  expect(button('Deactivate job')).toBeUndefined();
 });
 it('disables duplicate submits while waiting',async()=>{
  let finish!:(v:unknown)=>void;mocks.change.mockImplementation(()=>new Promise(r=>{finish=r;}));
  await mount();await click('Deactivate');await click('Deactivate job');
  expect(button('Deactivating…').disabled).toBe(true);await click('Deactivating…');expect(mocks.change).toHaveBeenCalledTimes(1);
  await act(async()=>{finish({ok:true});await new Promise(r=>setTimeout(r,10));});
 });
 it('does not claim success or expose raw errors after rejection',async()=>{
  mocks.change.mockRejectedValue(new Error('BRIEF_CONFLICT private internals'));
  await mount();await click('Deactivate');await click('Deactivate job');
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('Refresh the page to check its status');
  expect(document.body.textContent).not.toContain('BRIEF_CONFLICT');expect(mocks.toast).not.toHaveBeenCalled();
  expect(button('Deactivate job').disabled).toBe(true);
 });
 it('does not show Deactivate for inactive jobs and keeps Publish',async()=>{
  await mount([{...job,isActive:false}]);expect(button('Deactivate')).toBeUndefined();expect(button('Publish')).toBeDefined();
 });
 it('does not offer deactivation to a non-recruiter',async()=>{
  mocks.user.role='hiring_manager';await mount();expect(button('Deactivate')).toBeUndefined();
 });
 it('the real helper sends false with the current revision and an idempotency key',async()=>{
  const {changeJobPublication}=await vi.importActual<typeof import('../../client/src/lib/job-brief')>('../../client/src/lib/job-brief');
  const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({revision:'12'})});vi.stubGlobal('fetch',fetch);
  mocks.request.mockResolvedValue({json:async()=>({state:'done'})});
  await changeJobPublication(3,'recruiter',7,false,true);
  expect(fetch).toHaveBeenCalledWith('/api/jobs/7/brief',expect.objectContaining({credentials:'include',cache:'no-store'}));
  expect(mocks.request).toHaveBeenCalledWith('PATCH','/api/jobs/7/status',{isActive:false,expectedRevision:12,requestId:expect.any(String)});
 });
});
