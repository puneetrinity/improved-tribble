import {describe,expect,it,vi,beforeEach} from 'vitest';
import express from 'express';
import request from 'supertest';
import {PgDialect} from 'drizzle-orm/pg-core';

const job=(over:Partial<{isActive:boolean;status:string;expiresAt:Date|null}>={})=>({isActive:true,status:'approved',expiresAt:null,...over});

// Route: the status endpoint returns jobState only through the existing
// organisation-scoped job lookup.
const h=vi.hoisted(()=>({jobWhere:[] as unknown[],job:undefined as unknown,run:undefined as unknown,user:{id:7,role:'recruiter'}}));
vi.mock('../../db',()=>({db:{query:{
  jobs:{findFirst:vi.fn(async(arg:{where:unknown})=>{h.jobWhere.push(arg.where);return h.job;})},
  organizations:{findFirst:vi.fn(async()=>({id:41,signalTenantId:'t-41'}))},
  jobSourcingRuns:{findFirst:vi.fn(async()=>h.run)},
}},pool:{}}));
vi.mock('../../auth',()=>({
  requireRole:()=>(req:any,_res:any,next:any)=>{req.user=h.user;next();},
  requireSeat:()=>(_req:any,_res:any,next:any)=>next(),
  requireAuth:(_req:any,_res:any,next:any)=>next(),
}));
vi.mock('../../lib/organizationService',()=>({getUserOrganization:vi.fn(async()=>({organization:{id:41}})),requireSignalTenantId:vi.fn()}));
vi.mock('../../lib/mauticService',()=>({queueMauticSourcingRunSync:vi.fn()}));
vi.mock('../../lib/services/signal-client',()=>({sourceJob:vi.fn(),enrichBatch:vi.fn(),getRcProgress:vi.fn()}));
vi.mock('../../lib/jdDigest',()=>({generateJDDigest:vi.fn(),CURRENT_DIGEST_VERSION:1}));

async function app(){
  const {registerSignalRoutes}=await import('../../signal.routes');
  const a=express();a.use(express.json());registerSignalRoutes(a,(_q:any,_s:any,n:any)=>n());return a;
}
beforeEach(()=>{h.jobWhere.length=0;h.run=undefined;h.user={id:7,role:'recruiter'};});

describe('GET /api/jobs/:id/sourcing-status jobState',()=>{
  it.each([
    [job(),'open'],[job({isActive:false}),'closed'],[job({status:'draft',isActive:false}),'unapproved'],
    [job({expiresAt:new Date('2020-01-01T00:00:00Z')}),'expired'],
  ])('returns %o as %s, with no run yet',async(row,state)=>{
    h.job={id:191,organizationId:41,...row};
    const r=await request(await app()).get('/api/jobs/191/sourcing-status');
    expect(r.status).toBe(200);expect(r.body).toEqual({hasRun:false,jobState:state});
  });
  it('returns jobState alongside an existing run',async()=>{
    h.job={id:191,organizationId:41,...job({isActive:false})};
    h.run={requestId:'req-1',status:'completed',candidateCount:3,submittedAt:null,completedAt:null,createdAt:new Date(),externalJobId:'191'};
    const r=await request(await app()).get('/api/jobs/191/sourcing-status');
    expect(r.status).toBe(200);expect(r.body).toMatchObject({hasRun:true,jobState:'closed',requestId:'req-1'});
  });
  it('scopes the job lookup to the recruiter organisation, and a foreign job is 404 with no state',async()=>{
    h.job=undefined; // the organisation filter excludes another organisation's job
    const r=await request(await app()).get('/api/jobs/191/sourcing-status');
    expect(r.status).toBe(404);expect(r.body.jobState).toBeUndefined();
    const q=new PgDialect().sqlToQuery(h.jobWhere[0] as any);
    expect(q.sql).toMatch(/"organization_id"/);expect(q.params).toEqual([191,41]);
  });
});
