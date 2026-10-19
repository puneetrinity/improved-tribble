import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,generateKeyPairSync,createHash,verify} from 'node:crypto';
import {mkdtemp,chmod,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {hash,parseRequest,verifyPlan} from './sourcing-org-setup/contracts.mjs';
import {preview,apply} from './sourcing-org-setup/plan.mjs';
import {expectedEntitlement} from './sourcing-org-setup/flow.mjs';
import {desiredDiscover} from './sourcing-org-setup/discover.mjs';
import {readJson,writeJson} from './sourcing-org-setup/receipt.mjs';
import {probe} from './sourcing-org-setup/memory.mjs';

test('Flow target is exact opaque text; Discover target remains a UUID',()=>{
  const {r}=fixture();assert.equal(parseRequest(r).flowTargetId,'a1'.repeat(24));
  assert.equal(parseRequest({...r,flowTargetId:'Flow-Target_AbC:09'}).flowTargetId,'Flow-Target_AbC:09');
  for(const id of ['', 'x'.repeat(513),'target\nsecret',' target','target ','target\u007f']){
    assert.throws(()=>parseRequest({...r,flowTargetId:id}),/INVALID_REQUEST/);
  }
  assert.throws(()=>parseRequest({...r,discoverTargetId:r.flowTargetId}),/INVALID_REQUEST/);
});

test('stop invalidates an unexpired plan while already disabled; fresh approval works',async()=>{
  const x=fixture();x.f.state={revision:'9007199254740993',enabled:false,entitlement_id:null,anchor:null,capacity:0,high_water:0};
  const old=await preview(x.r,x.io);
  x.f.state.revision=(BigInt(x.f.state.revision)+1n).toString();
  assert.equal((await apply(old.plan,old.sha256,x.io)).state,'refused');assert.deepEqual(x.calls,[]);
  const fresh=await preview(x.r,x.io);assert.equal((await apply(fresh.plan,fresh.sha256,x.io)).state,'ready');
  assert.equal((await apply(old.plan,old.sha256,x.io)).state,'refused');
});
test('stop before first enable creates a tombstone and invalidates the initial plan',async()=>{
  const x=fixture(),old=await preview(x.r,x.io);
  x.f.state={revision:'1',enabled:false,entitlement_id:null,anchor:null,capacity:0,high_water:0};
  assert.equal((await apply(old.plan,old.sha256,x.io)).state,'refused');assert.deepEqual(x.calls,[]);
});
test('stop after successful enable cannot be undone by replaying its old plan',async()=>{
  const x=fixture(),old=await preview(x.r,x.io);assert.equal((await apply(old.plan,old.sha256,x.io)).state,'ready');
  x.f.state.enabled=false;x.f.state.revision='1';x.calls.length=0;
  assert.equal((await apply(old.plan,old.sha256,x.io)).state,'refused');assert.deepEqual(x.calls,[]);
  const fresh=await preview(x.r,x.io);assert.equal((await apply(fresh.plan,fresh.sha256,x.io)).state,'ready');
  assert.equal((await apply(old.plan,old.sha256,x.io)).state,'refused');
});

export function fixture(){
  const r={version:1,operationId:randomUUID(),organizationId:32,subscriptionId:32,operator:'test-operator',reason:'approved fixture',approvalEvidenceHash:'a'.repeat(64),environment:'development',flowTargetId:'a1'.repeat(24),discoverTargetId:randomUUID(),flowOrigin:'http://127.0.0.1:5000',discoverOrigin:'http://127.0.0.1:5001',memoryOrigin:'http://127.0.0.1:5002',configEvidenceHash:'c'.repeat(64),rcPolicyId:randomUUID(),rcPolicyHash:'b'.repeat(64),entitlement:{mode:'grant',id:randomUUID(),anchor:'2026-01-01T00:00:00.123456Z',validFrom:'2026-01-01T00:00:00.123456Z',validUntil:'2099-01-01T00:00:00.000000Z',capacity:1}};
  let f={org:{id:32,is_active:true,signal_tenant_id:'org_32'},sub:{id:32,organization_id:32,status:'active',paid_seats:1,anchor:r.entitlement.anchor,period_end:'2099-01-01T00:00:00.000000Z'},ent:null,state:null,slots:[],members:[],usage:[],pending:0,routines:'d'.repeat(64)};
  let d={registration:null,mapping:null,policy:{id:r.rcPolicyId,policy_hash:r.rcPolicyHash,rc_account_hash:'e'.repeat(64),rc_fetch_credits_max:1,rpm:450,enabled:true},pending:0,routine:'f'.repeat(64)};
  const calls=[];let locked=false;
  const io={config:async()=>{},probe:async()=>{calls.push('probe');},
    flow:{read:async()=>structuredClone(f),lock:async()=>{if(locked)throw Error('SETUP_BUSY');locked=true;},unlock:async()=>{locked=false;},enable:async()=>{calls.push('enable');f.ent=expectedEntitlement(r,f);f.state={revision:f.state?(BigInt(f.state.revision)+1n).toString():'0',enabled:true,entitlement_id:f.ent.id,anchor:f.ent.anchor,capacity:1,high_water:1};}},
    discover:{read:async()=>structuredClone(d),prepare:async()=>{calls.push('prepare');d=desiredDiscover(r,d);}}};
  return {r,io,calls,get f(){return f;},get d(){return d;}};
}
test('preview is read only and declares five runs per seat through existing capacity',async()=>{const x=fixture();const p=await preview(x.r,x.io);assert.equal(p.sha256,hash(p.plan));assert.deepEqual(x.calls,[]);assert.equal(p.plan.request.entitlement.capacity,1);});
test('prepare before enable; replay has no writes and does not change usage',async()=>{const x=fixture(),p=await preview(x.r,x.io);assert.equal((await apply(p.plan,p.sha256,x.io)).state,'ready');assert.deepEqual(x.calls,['probe','prepare','probe','enable']);x.calls.length=0;assert.equal((await apply(p.plan,p.sha256,x.io)).replayed,true);assert.deepEqual(x.calls,['probe']);assert.deepEqual(x.f.usage,[]);});
for(const phase of ['prepare','enable'])test('lost '+phase+' response replays without second write',async()=>{const x=fixture(),p=await preview(x.r,x.io),target=phase==='prepare'?x.io.discover:x.io.flow,original=target[phase];target[phase]=async(...args)=>{await original(...args);throw Error('lost');};assert.equal((await apply(p.plan,p.sha256,x.io)).state,'verify_before_resume');target[phase]=original;assert.equal((await apply(p.plan,p.sha256,x.io)).state,'ready');assert.equal(x.calls.filter(v=>v===phase).length,1);});
test('failed Memory check cannot prepare or enable',async()=>{const x=fixture(),p=await preview(x.r,x.io);x.io.probe=async()=>{throw Error('SETUP_MEMORY_AUTH_FAILED');};const y=await apply(p.plan,p.sha256,x.io);assert.equal(y.state,'refused');assert.deepEqual(x.calls,[]);});
test('failure after Discover commit leaves Flow disabled; same plan resumes',async()=>{const x=fixture(),p=await preview(x.r,x.io);let n=0;x.io.probe=async()=>{if(++n===2)throw Error('SETUP_MEMORY_AUTH_FAILED');};assert.equal((await apply(p.plan,p.sha256,x.io)).state,'verify_before_resume');assert.equal(x.f.state,null);assert.equal(x.d.registration.allow_new,true);x.io.probe=async()=>{};assert.equal((await apply(p.plan,p.sha256,x.io)).state,'ready');assert.equal(x.calls.filter(v=>v==='prepare').length,1);});
for(const field of ['capacity','anchor','validUntil'])test('changed grant '+field+' refuses after partial setup',async()=>{const x=fixture(),p=await preview(x.r,x.io);await apply(p.plan,p.sha256,x.io);const changed=structuredClone(x.r);changed.entitlement[field]=field==='capacity'?2:'2098-01-01T00:00:00.000000Z';await assert.rejects(preview(changed,x.io));});
test('subscription change after preview refuses before writes',async()=>{const x=fixture(),p=await preview(x.r,x.io);x.f.sub.paid_seats=2;assert.equal((await apply(p.plan,p.sha256,x.io)).state,'refused');assert.deepEqual(x.calls,[]);});
test('pending work and expired entitlement refuse preview',async()=>{const x=fixture();x.f.pending=1;await assert.rejects(preview(x.r,x.io),/SETUP_PENDING_WORK/);x.f.pending=0;x.r.entitlement.validUntil='2026-02-01T00:00:00.000000Z';await assert.rejects(preview(x.r,x.io),/SETUP_ENTITLEMENT_INVALID/);});
test('enabled incomplete org requires maintenance plan',async()=>{const x=fixture();x.f.ent=expectedEntitlement(x.r,x.f);x.f.state={enabled:true,entitlement_id:x.f.ent.id,capacity:1,anchor:x.f.ent.anchor};await assert.rejects(preview(x.r,x.io),/MAINTENANCE/);});
test('mismatched RC account policy never overwritten',async()=>{const x=fixture();x.d.policy.policy_hash='0'.repeat(64);await assert.rejects(preview(x.r,x.io),/RC_POLICY/);});
test('existing entitlement mode is reused without issuing a grant',async()=>{const x=fixture();x.f.ent=expectedEntitlement(x.r,x.f);x.r.entitlement={mode:'existing',id:x.f.ent.id};const p=await preview(x.r,x.io);assert.equal((await apply(p.plan,p.sha256,x.io)).state,'ready');});
test('existing entitlement missing is refused',async()=>{const x=fixture();x.r.entitlement={mode:'existing',id:x.r.entitlement.id};await assert.rejects(preview(x.r,x.io),/ENTITLEMENT_REQUIRED/);});
test('grant and plan are strict; expired or tampered plan refused',async()=>{const x=fixture(),p=await preview(x.r,x.io);assert.throws(()=>parseRequest({...x.r,tenantId:'org_99'}));assert.throws(()=>verifyPlan(p.plan,'0'.repeat(64)));assert.throws(()=>verifyPlan(p.plan,p.sha256,p.plan.expiresAt));assert.throws(()=>parseRequest({...x.r,environment:'production'}),/TLS/);});
test('concurrent operation is refused by shared org lock',async()=>{const x=fixture(),p=await preview(x.r,x.io);await x.io.flow.lock();await assert.rejects(apply(p.plan,p.sha256,x.io),/BUSY/);await x.io.flow.unlock();});
test('private files persist atomically and non-private inputs refused',async()=>{const dir=await mkdtemp(join(tmpdir(),'setup-file-test-'));try{const file=join(dir,'plan.json');await writeJson(file,{v:1});assert.deepEqual(await readJson(file),{v:1});await writeJson(file,{v:2});assert.deepEqual(await readJson(file),{v:2});await chmod(file,0o644);await assert.rejects(readJson(file),/PRIVATE_FILE/);}finally{await rm(dir,{recursive:true,force:true});}});
test('signed Memory probe has exact tenant/scope and no paid endpoints',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'setup-auth-test-'));const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  try{const x=fixture();const c={version:1,observedAt:Date.now(),environment:x.r.environment,flowTargetId:x.r.flowTargetId,discoverTargetId:x.r.discoverTargetId,flowOrigin:x.r.flowOrigin,discoverOrigin:x.r.discoverOrigin,memoryOrigin:x.r.memoryOrigin,signalPublicKeyHash:createHash('sha256').update(publicKey.export({format:'der',type:'spki'})).digest('hex'),flags:Object.fromEntries(['flowWebSourcing','flowWorkerSourcing','discoverWebGoverned','discoverWorkerGoverned','discoverRc','memoryRc','memoryIndexApi'].map(k=>[k,true]))};
    await writeJson(join(dir,'config'),c);x.r.configEvidenceHash=hash(c);
    let calls=0;const request=async(url,opts)=>{calls++;if(!opts.body){if(url===x.r.memoryOrigin+'/readyz')return {status:401};assert.ok([x.r.flowOrigin+'/readyz',x.r.discoverOrigin+'/api/health',x.r.memoryOrigin+'/health'].includes(url));return {status:200};}assert.equal(url,x.r.memoryOrigin+'/organization-candidates/sourcing/public-applicants');const [h,b,s]=opts.headers.authorization.slice(7).split('.');assert.ok(verify('RSA-SHA256',Buffer.from(h+'.'+b),publicKey,Buffer.from(s,'base64url')));const claims=JSON.parse(Buffer.from(b,'base64url')),body=JSON.parse(opts.body);assert.equal(claims.tenant_id,'org_32');assert.equal(claims.request_id,body.requestId);assert.deepEqual(claims.scopes,['organization-candidate-sourcing:read']);assert.equal(claims.exp-claims.iat,60);return {status:200,body:JSON.stringify({version:1,requestId:body.requestId,results:[{publicId:body.publicIds[0],isApplicant:false}]})};};
    const env={ORG_SETUP_CONFIG_FILE:join(dir,'config')};
    assert.equal(await probe(x.r,env,request),true);assert.equal(calls,3); // default: no signer, no POST
    calls=0;x.r.signedMemoryProbe=true;env.ORG_SETUP_SIGNAL_PRIVATE_KEY=privateKey.export({format:'pem',type:'pkcs8'});
    assert.equal(await probe(x.r,env,request),true);assert.equal(calls,4);await assert.rejects(probe(x.r,env,async()=>({status:503})),/SERVICE_UNAVAILABLE/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
