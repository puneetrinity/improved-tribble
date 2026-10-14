import {afterEach,describe,expect,it,vi} from 'vitest';
const signer=vi.hoisted(()=>vi.fn(async()=> 'synthetic'));
vi.mock('../../server/lib/services/jwt-signer',()=>({signServiceJwt:signer}));
import {getRcProgress} from '../../server/lib/services/signal-client';
import {signalRcProgressSchema} from '../../shared/rc-skills-progress';

const progress={version:1,state:'stalled',processed:3,total:5,updatedAt:'2026-10-09T10:00:00.123456+00:00',
 notificationDelivered:false,safeReason:'recovery_pending'};
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.clearAllMocks();});
function transport(response:Response){
 vi.stubEnv('SIGNAL_BASE_URL','http://127.0.0.1:12345');
 const call=vi.fn(async()=>response);vi.stubGlobal('fetch',call);return call;
}
describe('RC progress HTTP contract',()=>{
 it.each([
  {state:'queued',safeReason:'worker_queue',processed:0,total:0,workStarted:false},
  {state:'queued',safeReason:'quota_window',processed:3,total:5,workStarted:true},
 ])('accepts truthful queue progress without new admission state',async fields=>{
  const value={...progress,...fields};transport(Response.json({success:true,rcProgress:value}));
  expect(await getRcProgress('org_9','job','request')).toEqual(value);
 });
 it.each([
  {...progress,state:'queued',safeReason:'worker_queue'},
  {...progress,state:'queued',safeReason:'quota_window',workStarted:false},
  {...progress,workStarted:true},
  {...progress,safeReason:'worker_queue'},
  {...progress,state:'queued',safeReason:'working',workStarted:true},
 ])('refuses inconsistent queue metadata %#',value=>{
  expect(signalRcProgressSchema.safeParse(value).success).toBe(false);
 });
 it('accepts the real PostgreSQL timestamp shape and sends only the scoped read',async()=>{
  const call=transport(Response.json({success:true,rcProgress:progress}));
  expect(await getRcProgress('org_9','vanta:jobs:7','request-1')).toEqual(progress);
  expect(call).toHaveBeenCalledTimes(1);
  const [url,options]=call.mock.calls[0] as unknown as [string,RequestInit];
  expect(url).toContain('progressOnly=1');expect(url).toContain('requestId=request-1');
  expect(options).toMatchObject({method:'GET',redirect:'error'});expect(options.body).toBeUndefined();
  expect(signer).toHaveBeenCalledWith('signal',expect.objectContaining({tenantId:'org_9',requestId:'request-1'}));
 });
 it('treats only an explicit 404 as absent RC status',async()=>{
  transport(new Response(null,{status:404}));expect(await getRcProgress('org_9','job','request')).toBeNull();
  transport(new Response('private diagnostic',{status:503}));
  await expect(getRcProgress('org_9','job','request')).rejects.toMatchObject({message:'Sourcing status temporarily unavailable',status:503,body:undefined});
 });
 it.each([{...progress,processed:6},{...progress,total:301},{...progress,candidateId:'hidden'},
  {...progress,updatedAt:'invalid'},{...progress,safeReason:'provider secret'}])('rejects unsafe progress %#',async value=>{
  expect(signalRcProgressSchema.safeParse(value).success).toBe(false);
  transport(Response.json({success:true,rcProgress:value}));
  await expect(getRcProgress('org_9','job','request')).rejects.toThrow('Sourcing status temporarily unavailable');
 });
 it('refuses oversized streamed payloads and unknown envelope fields',async()=>{
  for(const response of [new Response('x'.repeat(4097),{headers:{'content-type':'application/json'}}),
   Response.json({success:true,rcProgress:progress,candidates:[{id:'hidden'}]})]){
   transport(response);await expect(getRcProgress('org_9','job','request')).rejects.toThrow('Sourcing status temporarily unavailable');
  }
 });
});
