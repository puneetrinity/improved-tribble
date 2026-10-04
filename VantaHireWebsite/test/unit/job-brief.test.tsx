import React from 'react';
import {act} from 'react-dom/test-utils';
import {createRoot,type Root} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {webcrypto} from 'node:crypto';
const mocks=vi.hoisted(()=>({query:vi.fn(),intent:vi.fn(),api:vi.fn()}));
vi.mock('../../client/src/lib/job-brief',async importOriginal=>({...await importOriginal<any>(),useJobBrief:mocks.query,jobIntentRequest:mocks.intent}));
vi.mock('../../client/src/lib/queryClient',()=>({apiRequest:mocks.api}));
import {JobBriefPanel} from '../../client/src/components/job-brief-panel';
const id='10000000-0000-4000-8000-000000000001';
const criterion={id,label:'Python',class:'must_have',subject:'skill',requirement:{kind:'text',value:'Python'},evidenceKinds:['profile_evidence'],use:'assessment',provenance:{kind:'recruiter_edit'}};
const payload={schemaVersion:1,compilerVersion:1,taxonomyVersion:1,criteria:[criterion]};
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
  it('approval sends only the saved version and never publishes or sources',async()=>{
    await render();expect(mocks.intent).not.toHaveBeenCalled();await click('Approve brief');
    expect(mocks.intent).toHaveBeenCalledExactlyOnceWith(3,9,'approve-brief','/api/jobs/9/brief/approve',{expectedRevision:2,versionId:id},'POST');
    expect(host.textContent).toContain('This did not publish the job or start sourcing');
  });
  it('AI output stays an unsaved proposal with approval disabled',async()=>{
    mocks.intent.mockResolvedValue({state:'succeeded',result:payload});await render();await click('Draft brief with AI');
    expect(mocks.intent).toHaveBeenCalledTimes(1);expect(button('Approve brief').disabled).toBe(true);expect(host.textContent).toContain('AI proposal only');
    await click('Save brief');expect(mocks.intent.mock.calls[1]?.[2]).toBe('save-brief');
  });
  it('does not auto-select ambiguous legacy sources or call a model',async()=>{
    mocks.query.mockReturnValue({data:{...brief,currentJD:null,latest:null,source:{initialized:false,ambiguous:true,choices:[{kind:'original_prose',text:'First JD'},{kind:'description_prose',text:'Other JD'}]}},isPending:false,isError:false});
    await render();expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toBe('');expect(button('Draft brief with AI').disabled).toBe(true);
    await click('Use original prose');expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toBe('First JD');expect(mocks.intent).not.toHaveBeenCalled();
  });
  it('preserves edits on a refused save and does not approve them',async()=>{
    await render();await click('Add criterion');mocks.intent.mockRejectedValue(new Error('Conflict'));await click('Save brief');
    expect(host.querySelectorAll('fieldset')).toHaveLength(2);expect(host.textContent).toContain('Your edits are kept');expect(button('Approve brief').disabled).toBe(true);
  });
  it('allows at most twelve criteria and keeps disqualifiers as flags',async()=>{
    await render();for(let n=1;n<12;n++)await click('Add criterion');expect(button('Add criterion').disabled).toBe(true);
    expect(host.querySelectorAll('fieldset')).toHaveLength(12);expect(host.textContent).toContain('Disqualifiers are review flags');
  });
  it('keeps manual editing available after a failed AI attempt',async()=>{
    mocks.intent.mockResolvedValue({state:'failed',code:'BRIEF_MODEL_INVALID'});await render();await click('Draft brief with AI');
    expect(button('Add criterion').disabled).toBe(false);expect(host.textContent).toContain('You can edit manually');
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
