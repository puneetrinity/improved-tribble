import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe,expect,it} from 'vitest';
// @ts-expect-error Source CLI deliberately has no declaration output.
import {verifyFrozen,verifyAuthority,frozenFiles,frozenRegions} from '../../../scripts/check-job-brief.mjs';
const root=resolve(import.meta.dirname,'../../..');
const read=(path:string)=>readFileSync(resolve(root,path),'utf8');
describe('brief guard mutation controls',()=>{
  it('accepts the implementation with all15 frozen witnesses and2 regions intact',()=>{
    expect(Object.keys(frozenFiles)).toHaveLength(15);expect(frozenRegions).toHaveLength(2);
    expect(()=>verifyFrozen(read)).not.toThrow();expect(()=>verifyAuthority(read)).not.toThrow();
  });
  it.each(Object.keys(frozenFiles))('refuses changed witness %s',path=>{
    expect(()=>verifyFrozen((p:string)=>read(p)+(p===path?'\nmutated':''))).toThrow('brief_frozen_file');
  });
  it.each([0,1])('refuses changed mixed-file region %i',index=>{
    const region=frozenRegions[index];
    expect(()=>verifyFrozen((p:string)=>p===region.path?read(p).replace(region.start,region.start+' '):read(p))).toThrow('brief_frozen_region');
  });
  it.each([
    ['server/job-brief/draft.ts','maxRetries:0'],
    ['server/job-brief/routes.ts','requireAuth,csrf'],
    ['server/schema-migrations/0014_job_brief_authority.sql','BRIEF_APPROVAL_REQUIRED'],
    ['server/signal.routes.ts','SOURCING_ACTIVATION_PENDING'],
    ['server/storage.ts','JOB_PERMANENT_DELETION_DISABLED'],
  ])('refuses authority regression %s %s',(path,token)=>{
    expect(()=>verifyAuthority((p:string)=>p===path?read(p).replaceAll(token,'MUTATED'):read(p))).toThrow('brief_authority');
  });
});
