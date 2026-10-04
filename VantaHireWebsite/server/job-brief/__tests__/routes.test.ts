import express from 'express';
import request from 'supertest';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {BriefError,type BriefRepository} from '../repository';
const mocks=vi.hoisted(()=>({organization:vi.fn(),draft:vi.fn()}));
vi.mock('../../auth',()=>({requireAuth:(req:any,res:any,next:any)=>req.user?next():res.status(401).json({code:'AUTH_REQUIRED'})}));
vi.mock('../../lib/organizationService',()=>({getUserOrganization:mocks.organization}));
vi.mock('../draft',()=>({draftBrief:mocks.draft}));
import {registerJobBriefRoutes} from '../routes';

const requestId='10000000-0000-4000-8000-000000000001';
describe('five registered brief routes',()=>{
  let app:ReturnType<typeof express>;let call:ReturnType<typeof vi.fn>;
  beforeEach(()=>{
    vi.stubEnv('FLOW_JOB_BRIEF_ENABLED','true');mocks.organization.mockResolvedValue({organization:{id:12}});
    call=vi.fn().mockResolvedValue({revision:'0',currentJD:null,originalJD:'Public source prose',legacyDescription:'{"eliteSchools":true}',latest:null,draft:null});
    app=express();app.use(express.json({limit:'1mb'}));app.use((req,res,next)=>{if(req.headers['x-test-actor'])req.user={id:3,role:'recruiter'} as any;next();});
    registerJobBriefRoutes(app,((req:any,res:any,next:any)=>req.headers['x-test-csrf']==='yes'?next():res.status(403).json({code:'CSRF_REQUIRED'})) as any,{call} as unknown as BriefRepository);
  });
  afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
  it('has exactly five distinct registrations',()=>{
    const routes=(app as any)._router.stack.filter((r:any)=>r.route).map((r:any)=>Object.keys(r.route.methods)[0]+' '+r.route.path);
    expect(routes).toEqual(['get /api/jobs/:id/brief','post /api/jobs/:id/brief/draft','patch /api/jobs/:id/brief','post /api/jobs/:id/brief/approve','get /api/jobs/:id/brief/history']);
  });
  it('disabled mode refuses before database or model dispatch',async()=>{
    vi.stubEnv('FLOW_JOB_BRIEF_ENABLED','false');
    expect((await request(app).get('/api/jobs/9/brief').set('x-test-actor','1')).status).toBe(503);
    expect(call).not.toHaveBeenCalled();expect(mocks.organization).not.toHaveBeenCalled();expect(mocks.draft).not.toHaveBeenCalled();
  });
  it('authenticates reads and removes internal source configuration',async()=>{
    expect((await request(app).get('/api/jobs/9/brief')).status).toBe(401);
    const response=await request(app).get('/api/jobs/9/brief').set('x-test-actor','1');
    expect(response.status).toBe(200);expect(response.headers['cache-control']).toBe('private, no-store');
    expect(JSON.stringify(response.body)).not.toContain('eliteSchools');expect(call).toHaveBeenCalledWith('read',[12,9,3]);
  });
  it('requires CSRF on every mutation before execution',async()=>{
    for(const [method,path]of [['post','draft'],['post','approve'],['patch','']] as const){
      const result=await request(app)[method]('/api/jobs/9/brief'+(path?'/'+path:'')).set('x-test-actor','1').send({requestId});expect(result.status).toBe(403);
    }
    expect(call).not.toHaveBeenCalled();expect(mocks.draft).not.toHaveBeenCalled();
  });
  it('refuses oversized and open-ended mutation payloads',async()=>{
    expect((await request(app).patch('/api/jobs/9/brief').set('x-test-actor','1').set('x-test-csrf','yes').send({text:'x'.repeat(65537)})).status).toBe(413);
    expect((await request(app).post('/api/jobs/9/brief/approve').set('x-test-actor','1').set('x-test-csrf','yes').send({requestId,expectedRevision:0,versionId:requestId,actorRole:'super_admin'})).status).toBe(400);
    expect(call).not.toHaveBeenCalled();
  });
  it.each(['0','-1','1e2','1junk'])('rejects malformed job ID %s without authority lookup',async id=>{
    expect((await request(app).get(`/api/jobs/${id}/brief`).set('x-test-actor','1')).status).toBe(404);expect(call).not.toHaveBeenCalled();
  });
  it('bounds history and pairs both cursor parts',async()=>{
    for(const query of ['limit=51','limit=0','limit=1x','beforeId='+requestId,'beforeTime=bad&beforeId='+requestId])expect((await request(app).get('/api/jobs/9/brief/history?'+query).set('x-test-actor','1')).status).toBe(400);
    expect(call).not.toHaveBeenCalled();
  });
  it('preserves closed authority failures without leaking underlying exceptions',async()=>{
    call.mockRejectedValueOnce(new BriefError('BRIEF_NOT_FOUND',404));expect((await request(app).get('/api/jobs/9/brief').set('x-test-actor','1')).status).toBe(404);
    call.mockRejectedValueOnce(new Error('private connection row'));const response=await request(app).get('/api/jobs/9/brief').set('x-test-actor','1');expect(response.body).toEqual({code:'BRIEF_UNAVAILABLE'});
  });
});
