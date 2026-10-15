import {describe,it,expect,vi} from 'vitest';
import type {Pool} from 'pg';
import {SourcingRepository} from '../repository';
import {approveBrief} from '../../job-brief/commands';
import {BriefRepository} from '../../job-brief/repository';
const scope={organizationId:1,jobId:2,actorId:3};
const command={requestId:'10000000-0000-4000-8000-000000000001',versionId:'10000000-0000-4000-8000-000000000002',expectedRevision:4};
function fixture(enabled=true,failAt?:'approval'|'digest') {
  const query=vi.fn(async(sql:string)=>{
    if(sql.includes('flow_sourcing_org_state'))return {rows:[{result:{enabled}}]};
    if(sql.includes('flow_job_brief_approve')){
      if(failAt==='approval')throw {code:'P0001',message:'BRIEF_REVISION_CONFLICT'};
      return {rows:[{result:{revision:'5'}}]};
    }
    if(sql.includes('flow_sourcing_digest_claim') && failAt==='digest')throw {code:'P0001',message:'SOURCING_QUERY_STALE'};
    return {rows:[]};
  });
  const release=vi.fn(),pool={connect:vi.fn().mockResolvedValue({query,release})} as unknown as Pool;
  return {query,release,repo:new SourcingRepository(pool)};
}
describe('both approval routes keep simple version-bound approval',()=>{
  it('plain approval needs only the exact displayed version',async()=>{
    const call=vi.fn().mockResolvedValue({revision:'5'});
    await approveBrief({call} as unknown as BriefRepository,scope,command);
    expect(call).toHaveBeenCalledWith('approve',expect.arrayContaining([command.versionId]));
  });
  it.each([true,false])('sourcing org enabled=%s uses ordinary approval in its transaction',async(enabled)=>{
    const f=fixture(enabled);await f.repo.approveAndPrepare(scope,command,'hash','model');
    const sql=f.query.mock.calls.map(c=>c[0]);
    expect(sql.some(s=>s.includes('flow_job_brief_approve('))).toBe(true);
    expect(sql.some(s=>s.includes('flow_sourcing_digest_claim'))).toBe(enabled);
    expect(sql.at(-1)).toBe('COMMIT');expect(f.release).toHaveBeenCalledOnce();
    const approval=f.query.mock.calls.find(c=>c[0].includes('flow_job_brief_approve(')) as unknown as [string,unknown[]];
    expect(approval[1]).toHaveLength(7);
  });
  it('stale version rolls back without scheduling',async()=>{
    const f=fixture(true,'approval');await expect(f.repo.approveAndPrepare(scope,command,'hash','model')).rejects.toMatchObject({code:'BRIEF_REVISION_CONFLICT'});
    const sql=f.query.mock.calls.map(c=>c[0]);expect(sql.at(-1)).toBe('ROLLBACK');
    expect(sql.some(s=>s.includes('digest_claim'))).toBe(false);expect(sql).not.toContain('COMMIT');
  });
  it('digest failure rolls approval back too',async()=>{
    const f=fixture(true,'digest');await expect(f.repo.approveAndPrepare(scope,command,'hash','model')).rejects.toThrow();
    expect(f.query.mock.calls.map(c=>c[0]).at(-1)).toBe('ROLLBACK');
  });
  it('keeps one approval signature',async()=>{
    const f=fixture(false);await f.repo.approveAndPrepare(scope,command,'hash','model');
    expect(f.query.mock.calls.some(c=>c[0].includes('flow_job_brief_approve('))).toBe(true);
  });
});
