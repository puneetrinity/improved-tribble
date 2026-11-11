import { afterEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthContext } from '@/hooks/use-auth';
import { CandidatePortal } from '@/components/candidate-portal/CandidatePortal';
import { queryClient } from '@/lib/queryClient';
import { ResumeReadStatus } from './SourceReview';

let root: Root | null = null, host: HTMLDivElement | null = null;
afterEach(() => { if (root) act(() => root!.unmount()); root = null; host?.remove(); queryClient.clear(); vi.unstubAllGlobals(); });
const flush = async () => { for (let i=0;i<10;i++) await act(async () => { await new Promise(r=>setTimeout(r,0)); }); };
const button = (label: string) => [...document.querySelectorAll('button')].find(b=>b.textContent?.trim()===label)!;
const json = (body: unknown) => new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});

it('failed-read files require explicit confirmed removal; cancelling makes no request, removal frees an upload slot', async () => {
  let files = [1,2,3].map(id=>({id,label:`cv${id}`,isDefault:id===1,readFailed:id===1,createdAt:'2026-11-01'}));
  const deletes: string[] = [];
  vi.stubGlobal('ResizeObserver',class { observe(){} unobserve(){} disconnect(){} });
  vi.stubGlobal('fetch',vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input),'http://localhost').pathname;
    if (path==='/api/csrf-token') return json({token:'test'});
    if (init?.method==='DELETE') { deletes.push(path); files=files.filter(r=>r.id!==1); return json({}); }
    if (path==='/api/ai/resume') return json({resumes:files});
    if (path==='/api/my-applications') return json([]);
    return json({savedJobs:[]});
  }));
  host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);
  await act(async()=>{root!.render(<QueryClientProvider client={queryClient}><AuthContext.Provider value={{user:{id:1,role:'candidate',emailVerified:true},logoutMutation:{mutate:vi.fn()}} as any}>
    <CandidatePortal firstName="Test" userId={1} section="profile" onNavigate={()=>{}} discovery="not_ready" matching="not_ready" publicJobs={[]} resumeRouting="spark" profile={null} onSignOut={()=>{}} />
  </AuthContext.Provider></QueryClientProvider>);});await flush();
  expect(document.body.textContent).toContain('Couldn’t read');
  expect(button('Add a résumé')).toBeUndefined();
  await act(async()=>{document.querySelector<HTMLButtonElement>('[aria-label="Remove cv1"]')!.click();});
  expect(deletes).toEqual([]);
  expect(document.body.textContent).toContain('already submitted with applications will stay available');
  await act(async()=>{button('Cancel removal').click();});expect(deletes).toEqual([]);
  await act(async()=>{document.querySelector<HTMLButtonElement>('[aria-label="Remove cv1"]')!.click();});
  await act(async()=>{button('Remove résumé').click();});await flush();
  expect(deletes).toEqual(['/api/ai/resume/1']);
  expect(button('Add a résumé')).toBeDefined();
  expect(document.body.textContent).not.toContain('Couldn’t read');
});

it('onboarding limit points to the profile library without submitting or deleting anything',()=>{
  host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);
  act(()=>root!.render(<ResumeReadStatus read={{kind:'error',message:'Your résumé library already has 3 files. Use a résumé from My profile, or remove a file there before uploading another.'}} onRetry={vi.fn()} onContinue={vi.fn()} />));
  expect(document.querySelector('a')?.getAttribute('href')).toBe('/my-dashboard?resumes=1#profile');
});
