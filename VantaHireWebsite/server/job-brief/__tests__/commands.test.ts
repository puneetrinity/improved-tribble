import { describe,expect,it,vi } from 'vitest';
import type { Pool } from 'pg';
import { BriefRepository,closedDatabaseError } from '../repository';
import { readBrief,transitionJob,publicationCycle,parseDraftProposal } from '../commands';

const scope={organizationId:1,jobId:2,actorId:3};
const requestId='10000000-0000-4000-8000-000000000001';
describe('brief application commands',()=>{
  it('does not expose structured legacy source or initialize a source on GET',async()=>{
    const call=vi.fn().mockResolvedValue({revision:'0',currentJD:null,sourceHash:null,latest:null,approvedVersionId:null,draft:null,originalJD:'Build systems.',legacyDescription:'{"roleTitle":"private"}'});
    const result=await readBrief({call} as unknown as BriefRepository,scope);
    expect(result.source.choices).toEqual([{kind:'original_prose',text:'Build systems.'}]);
    expect(result.source.selectionRequired).toBe(true);
    expect(result).not.toHaveProperty('legacyDescription');expect(call).toHaveBeenCalledExactlyOnceWith('read',[1,2,3]);
  });
  it('reports two different valid sources as ambiguous without choosing',async()=>{
    const call=vi.fn().mockResolvedValue({currentJD:null,originalJD:'Original prose',legacyDescription:'Different prose'});
    expect((await readBrief({call} as unknown as BriefRepository,scope)).source.ambiguous).toBe(true);
  });
  it('requires recruiter revisions but A1 sends a server-selected null for admin transition',async()=>{
    const call=vi.fn().mockResolvedValue({revision:'9'});const repo={call} as unknown as BriefRepository;
    await expect(transitionJob(repo,scope,'recruiter',{action:'publish',requestId})).rejects.toMatchObject({code:'BRIEF_REVISION_REQUIRED'});
    expect(call).not.toHaveBeenCalled();
    await transitionJob(repo,scope,'super_admin',{action:'publish',requestId,expectedRevision:123});
    expect(call).toHaveBeenCalledWith('save',[1,2,3,requestId,null,{action:'publish'}]);
    await transitionJob(repo,scope,'recruiter',{action:'publish',requestId,expectedRevision:8});
    expect(call).toHaveBeenLastCalledWith('save',[1,2,3,requestId,8,{action:'publish'}]);
  });
  it('never accepts an actor role override or an approval in a transition payload',async()=>{
    const call=vi.fn();const repo={call} as unknown as BriefRepository;
    for(const extra of [{actorRole:'super_admin'},{approved:true}]) await expect(transitionJob(repo,scope,'recruiter',{action:'publish',requestId,expectedRevision:1,...extra})).rejects.toThrow();
    expect(call).not.toHaveBeenCalled();
  });
  it('publication cycles use only valid past reactivation dates',()=>{
    const createdAt='2026-01-01T00:00:00Z';const now=new Date('2026-03-01T00:00:00Z');
    for(const reactivatedAt of [null,'invalid','2025-12-31','2026-03-02']) expect(publicationCycle({createdAt,reactivatedAt},now).getTime()).toBe(Date.parse(createdAt));
    expect(publicationCycle({createdAt,reactivatedAt:'2026-02-01'},now).getTime()).toBe(Date.parse('2026-02-01'));
  });
  it('closes database errors without leaking SQL or row text',()=>{
    expect(closedDatabaseError({code:'P0001',message:'BRIEF_APPROVAL_REQUIRED'})).toMatchObject({code:'BRIEF_APPROVAL_REQUIRED',status:409});
    expect(closedDatabaseError({code:'55P03',message:'private row'})).toMatchObject({code:'BRIEF_RETRY_SAME_REQUEST'});
    expect(closedDatabaseError({message:'connection string private'}).message).toBe('BRIEF_UNAVAILABLE');
    expect(()=>parseDraftProposal('x'.repeat(65537),'JD')).toThrow('BRIEF_MODEL_INVALID');
  });
  it('commits and releases a read before its result is returned',async()=>{
    const query=vi.fn().mockResolvedValue({rows:[{result:{revision:'0'}}]});const release=vi.fn();
    const repo=new BriefRepository({connect:async()=>({query,release})} as unknown as Pool);
    expect(await repo.call('read',[1,2,3])).toEqual({revision:'0'});
    expect(query.mock.calls.map(x=>x[0])).toEqual(['BEGIN ISOLATION LEVEL READ COMMITTED',expect.stringContaining('lock_timeout'),expect.stringContaining('flow_job_brief_read'),'COMMIT']);
    expect(release).toHaveBeenCalledOnce();
  });
  it('rolls back a not-found read and releases the connection',async()=>{
    const query=vi.fn().mockResolvedValue({rows:[{result:null}]});const release=vi.fn();
    const repo=new BriefRepository({connect:async()=>({query,release})} as unknown as Pool);
    await expect(repo.call('read',[1,2,3])).rejects.toMatchObject({code:'BRIEF_NOT_FOUND'});
    expect(query).toHaveBeenLastCalledWith('ROLLBACK');expect(release).toHaveBeenCalledOnce();
  });
});
