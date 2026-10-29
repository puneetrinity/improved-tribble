import {describe,expect,it} from 'vitest';
import {sourcingJobState} from '../job-state';

const now=new Date('2026-10-29T12:00:00.000Z');
const job=(over:Partial<{isActive:boolean;status:string;expiresAt:Date|null}>={})=>({isActive:true,status:'approved',expiresAt:null,...over});

describe('sourcingJobState mirrors the governed quote refusal',()=>{
  it('is open only for an active, approved, unexpired job',()=>{
    expect(sourcingJobState(job(),now)).toBe('open');
    expect(sourcingJobState(job({expiresAt:new Date('2026-10-29T12:00:00.001Z')}),now)).toBe('open');
  });
  it('reports a closed job',()=>expect(sourcingJobState(job({isActive:false}),now)).toBe('closed'));
  it('reports an unapproved job before inactivity, since drafts are also inactive',()=>{
    for(const status of ['draft','pending','declined'])
      expect(sourcingJobState(job({status,isActive:false}),now)).toBe('unapproved');
  });
  it('treats expiry at or before now as expired',()=>{
    expect(sourcingJobState(job({expiresAt:now}),now)).toBe('expired');
    expect(sourcingJobState(job({expiresAt:new Date('2026-10-01T00:00:00Z')}),now)).toBe('expired');
  });
  it('reports closed ahead of expired',()=>expect(sourcingJobState(job({isActive:false,expiresAt:now}),now)).toBe('closed'));
});
