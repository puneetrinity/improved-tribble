import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID,randomBytes,generateKeyPairSync,createHash,verify} from 'node:crypto';
import {createServer} from 'node:http';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {main} from './sourcing-org-setup.mjs';
import {writeJson,readJson} from './sourcing-org-setup/receipt.mjs';
import {connectOwner,makeFlow} from './sourcing-org-setup/flow.mjs';
import {makeDiscover} from './sourcing-org-setup/discover.mjs';
import {preview,apply} from './sourcing-org-setup/plan.mjs';
import {hash} from './sourcing-org-setup/contracts.mjs';

import {FIXTURE_SHA256,assertDiscoverCatalog} from './sourcing-org-setup/discover-catalog.mjs';
const urls=[process.env.ORG_SETUP_TEST_FLOW_URL,process.env.ORG_SETUP_TEST_DISCOVER_URL];
for(const value of urls){const u=new URL(value??'');if(!['127.0.0.1','[::1]'].includes(u.hostname)||!u.pathname.endsWith('_test')||!u.username.endsWith('_test'))throw Error('DISPOSABLE_TARGET_REQUIRED');}
if(urls[0]===urls[1])throw Error('SEPARATE_DATABASES_REQUIRED');
const f=await connectOwner(urls[0],null,'development'),d=await connectOwner(urls[1],null,'development');
let checks=0;const ok=()=>{checks++;};
try{
  for(const db of [f,d]){
    const role=(await db.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];assert.equal(role.rolsuper,false);assert.equal(role.rolbypassrls,false);
    const tables=(await db.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'")).rows[0].n;if(tables!==0)throw Error('EMPTY_DATABASE_REQUIRED');
  }
  const migrations=resolve('server/schema-migrations');
  await f.query('BEGIN');try{for(const name of readdirSync(migrations).filter(n=>/^\d{4}_.*\.sql$/.test(n)).sort())await f.query(readFileSync(resolve(migrations,name),'utf8'));await f.query('COMMIT');}catch(e){await f.query('ROLLBACK');throw e;}
  const flowTargetId=randomBytes(24).toString('hex'),discoverTargetId=randomUUID();
  await f.query('CREATE SCHEMA IF NOT EXISTS schema_control');
  await f.query('CREATE TABLE IF NOT EXISTS schema_control.identity(singleton boolean DEFAULT true,system text,environment text,target_id text)');
  await f.query("INSERT INTO schema_control.identity(system,environment,target_id) VALUES('flow','development',$1)",[flowTargetId]);
  if(process.env.ORG_SETUP_DISCOVER_SOURCE){
    const root=resolve(process.env.ORG_SETUP_DISCOVER_SOURCE),baseline=JSON.parse(readFileSync(resolve(root,'prisma/baseline/manifest.json'))),lock=JSON.parse(readFileSync(resolve(root,'prisma/migrations.lock.json')));
    assert.equal(lock.migrations.at(-1).name,'20261018000000_private_resume_sourcing');
    await d.query(readFileSync(resolve(root,baseline.baselinePath),'utf8'));
    for(const m of lock.migrations.slice(baseline.migrations.length)){const sql=readFileSync(resolve(root,'prisma/migrations',m.name,'migration.sql'),'utf8');assert.equal(hash(sql),m.sha256);await d.query('BEGIN');try{await d.query(sql);await d.query('COMMIT');}catch(e){await d.query('ROLLBACK');throw e;}}
  }else{
    const fixture=readFileSync(new URL('./sourcing-org-setup/discover-fixture.sql',import.meta.url),'utf8');
    assert.equal(hash(fixture),FIXTURE_SHA256);
    await d.query(fixture);
    await d.query(`CREATE TABLE job_sourcing_requests("tenantId" text NOT NULL,status text NOT NULL);
      CREATE TABLE rc_sourcing_runs(tenant_id text NOT NULL,state text NOT NULL,resume_token uuid,resume_enqueued_at timestamptz,closed_at timestamptz);`);
  }
  await d.query('CREATE SCHEMA signal_schema_control');
  await d.query('CREATE TABLE signal_schema_control.target_identity(system text,environment text,target_id uuid)');
  await d.query("INSERT INTO signal_schema_control.target_identity VALUES('discover','development',$1)",[discoverTargetId]);
  await f.query("INSERT INTO users(id,username,password,role,email_verified) VALUES(99001,'setup@test.invalid','unusable','recruiter',true)");
  await f.query("INSERT INTO organizations(id,name,slug,is_active,signal_tenant_id) VALUES(99001,'Setup fixture','setup-fixture',true,'org_99001')");
  await f.query("INSERT INTO organization_members(organization_id,user_id,role,seat_assigned) VALUES(99001,99001,'owner',true)");
  await f.query("INSERT INTO subscription_plans(id,name,display_name,price_per_seat_monthly,price_per_seat_annual,ai_credits_per_seat_monthly,features) VALUES(99001,'setup-fixture','Setup',1,1,0,'{}')");
  await f.query("INSERT INTO organization_subscriptions(id,organization_id,plan_id,seats,paid_seats,billing_cycle,status,start_date,current_period_start,current_period_end) VALUES(99001,99001,99001,1,1,'monthly','active','2026-01-01T00:00:00.123456','2026-01-01T00:00:00.123456','2099-01-01T00:00:00')");
  const rcPolicyId=randomUUID();
  const policy=(await d.query('SELECT signal_rc_set_policy($1) p',[{version:1,action:'rates',policy:{id:rcPolicyId,rcAccountHash:'a'.repeat(64),rcFetchCreditsMax:1,rpm:450,enabled:true}}])).rows[0].p;
  const r={version:1,operationId:randomUUID(),organizationId:99001,subscriptionId:99001,operator:'fixture',reason:'component test',approvalEvidenceHash:'b'.repeat(64),environment:'development',flowTargetId,discoverTargetId,flowOrigin:'http://127.0.0.1:5000',discoverOrigin:'http://127.0.0.1:5001',memoryOrigin:'http://127.0.0.1:5002',configEvidenceHash:'c'.repeat(64),rcPolicyId,rcPolicyHash:policy.policyHash,entitlement:{mode:'grant',id:randomUUID(),anchor:'2026-01-01T00:00:00.123456Z',validFrom:'2026-01-01T00:00:00.123456Z',validUntil:'2099-01-01T00:00:00.000000Z',capacity:1}};
  let probes=0;const io={flow:makeFlow(f),discover:makeDiscover(d),config:async()=>{},probe:async()=>{probes++;}};
  // Use the global user role, not organization_members.role ('owner' is not recruiter authority).
  assert.deepEqual((await preview(r,io)).warnings,[]);
  const recruiterPlan=await preview(r,io);
  await f.query("UPDATE users SET role='super_admin' WHERE id=99001");
  assert.equal((await preview(r,io)).warnings.length,1);
  assert.equal((await apply(recruiterPlan.plan,recruiterPlan.sha256,io)).state,'refused');
  assert.equal(probes,0);
  await f.query("UPDATE users SET role='recruiter' WHERE id=99001");
  await f.query('UPDATE organization_members SET seat_assigned=false WHERE user_id=99001');
  assert.equal((await preview(r,io)).warnings.length,1);
  await f.query('UPDATE organization_members SET seat_assigned=true WHERE user_id=99001');
  assert.deepEqual((await preview(r,io)).warnings,[]);ok();
  // Exact reviewed owner stop procedure, synthetic organisation only.
  async function stop(){
    await f.query('BEGIN');try{
      assert.equal((await f.query('SELECT pg_try_advisory_xact_lock(582190,$1) ok',[r.organizationId])).rows[0].ok,true);
      await f.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[r.organizationId]);
      await f.query(`INSERT INTO sourcing_org_state(organization_id,enabled,revision) VALUES($1,false,1)
        ON CONFLICT(organization_id) DO UPDATE SET enabled=false,revision=sourcing_org_state.revision+1`,[r.organizationId]);
      await f.query('COMMIT');
    }catch(e){await f.query('ROLLBACK');throw e;}
  }
  const firstPlan=await preview(r,io);await stop();
  assert.equal((await apply(firstPlan.plan,firstPlan.sha256,io)).state,'refused');assert.equal(probes,0);ok();
  const disabledPlan=await preview(r,io);await stop();
  assert.equal((await apply(disabledPlan.plan,disabledPlan.sha256,io)).state,'refused');assert.equal(probes,0);ok();
  const p=await preview(r,io);assert.equal((await f.query('SELECT count(*)::int n FROM sourcing_entitlements')).rows[0].n,0);assert.equal((await d.query('SELECT count(*)::int n FROM governed_sourcing_tenants')).rows[0].n,0);assert.equal(probes,0);ok();
  const original=io.flow.enable;io.flow.enable=async()=>{throw Error('connection lost');};
  assert.equal((await apply(p.plan,p.sha256,io)).state,'verify_before_resume');assert.equal((await f.query('SELECT count(*)::int n FROM sourcing_entitlements')).rows[0].n,0);assert.equal((await d.query('SELECT allow_new FROM governed_sourcing_tenants')).rows[0].allow_new,true);ok();
  io.flow.enable=async(...args)=>{await original(...args);throw Error('lost commit response');};
  assert.equal((await apply(p.plan,p.sha256,io)).state,'verify_before_resume');io.flow.enable=original;
  const result=await apply(p.plan,p.sha256,io);assert.equal(result.state,'ready');assert.equal(result.replayed,true);ok();
  const before=await io.flow.read(r);assert.equal(before.state.enabled,true);assert.equal(before.ent.anchor,r.entitlement.anchor);assert.equal(before.slots[0].current_user_id,99001);assert.equal((await f.query('SELECT count(*)::int n FROM sourcing_entitlements')).rows[0].n,1);ok();
  assert.equal((await apply(p.plan,p.sha256,io)).state,'ready');assert.deepEqual(await io.flow.read(r),before);ok();
  const [slot]=(await f.query('SELECT id FROM sourcing_seat_slots WHERE organization_id=99001')).rows;
  await f.query(`INSERT INTO sourcing_allowance_windows(organization_id,slot_id,starts_at,ends_at,entitlement_id,limit_count,reserved,captured)
    VALUES(99001,$1,'2026-01-01T00:00:00.123456Z','2026-02-01T00:00:00.123456Z',$2,5,2,1)`,[slot.id,r.entitlement.id]);
  const usedPlan=await preview(r,io),used=(await io.flow.read(r)).usage;
  assert.equal((await apply(usedPlan.plan,usedPlan.sha256,io)).replayed,true);assert.deepEqual((await io.flow.read(r)).usage,used);assert.equal(used[0].reserved,2);assert.equal(used[0].captured,1);ok();
  for(const [db,routine,table] of [[f,'public.flow_sourcing_enable(integer,uuid)','public.sourcing_entitlements'],[d,'public.signal_rc_set_policy(jsonb)','public.rc_org_policies']]){
    const rights=(await db.query("SELECT has_function_privilege('org_setup_runtime_test',$1,'EXECUTE') execute,has_table_privilege('org_setup_runtime_test',$2,'INSERT') insert",[routine,table])).rows[0];
    assert.equal(rights.execute,false);assert.equal(rights.insert,false);
  }ok();
  const connection=await connectOwner(urls[0],null,'development');try{await io.flow.lock(r);await assert.rejects(makeFlow(connection).lock(r),/SETUP_BUSY/);await io.flow.unlock(r);}finally{await connection.end();}ok();
  const beforeConflict=await io.flow.read(r);
  await stop();
  assert.equal((await apply(usedPlan.plan,usedPlan.sha256,io)).state,'refused');
  const freshApproval=await preview(r,io);assert.equal((await apply(freshApproval.plan,freshApproval.sha256,io)).state,'ready');
  assert.equal((await apply(usedPlan.plan,usedPlan.sha256,io)).state,'refused');
  assert.deepEqual((await io.flow.read(r)).usage,beforeConflict.usage);ok();
  const afterStop=await io.flow.read(r);
  await d.query("UPDATE governed_sourcing_tenants SET callback_url='https://wrong.invalid/callback'");assert.equal((await apply(usedPlan.plan,usedPlan.sha256,io)).state,'refused');assert.deepEqual(await io.flow.read(r),afterStop);ok();
  await assert.rejects(preview({...r,flowTargetId:randomUUID()},io),/TARGET_MISMATCH/);ok();
  // Exercise the actual CLI, plan/receipt files, HTTP and signer (no mocked
  // adapters). Local service fixtures verify the dedicated token contract.
  const dir=await mkdtemp(resolve(tmpdir(),'org-setup-cli-'));
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});let signedReads=0;
  const server=createServer(async(req,res)=>{
    if(req.method==='GET'&&['/readyz','/api/health','/health'].includes(req.url)){res.writeHead(200).end('{}');return;}
    if(req.method!=='POST'||req.url!=='/organization-candidates/sourcing/public-applicants'){res.writeHead(404).end();return;}
    try{let raw='';for await(const b of req){raw+=b;if(raw.length>8192)throw Error('limit');}
      const body=JSON.parse(raw),[h,b,s]=req.headers.authorization.slice(7).split('.'),claims=JSON.parse(Buffer.from(b,'base64url'));
      assert.ok(verify('RSA-SHA256',Buffer.from(h+'.'+b),publicKey,Buffer.from(s,'base64url')));
      assert.equal(claims.tenant_id,'org_99001');assert.equal(claims.iss,'signal');assert.equal(claims.aud,'activekg');assert.equal(claims.request_id,body.requestId);assert.deepEqual(claims.scopes,['organization-candidate-sourcing:read']);
      signedReads++;res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({version:1,requestId:body.requestId,results:[{publicId:body.publicIds[0],isApplicant:false}]}));
    }catch{res.writeHead(401).end('{}');}
  });
  // Separate Memory origin: public health, but readiness requires the actual
  // control-plane style bearer. Never let Flow's public /readyz mask F1 again.
  let memoryReadyReads=0;
  const memoryServer=createServer((req,res)=>{
    if(req.url==='/readyz'){
      memoryReadyReads++;
      res.writeHead(req.headers.authorization==='Bearer synthetic-control-plane'?200:401).end('{}');return;
    }
    server.emit('request',req,res);
  });
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  await new Promise(done=>memoryServer.listen(0,'127.0.0.1',done));
  try{
    const origin='http://127.0.0.1:'+server.address().port;
    const memoryOrigin='http://127.0.0.1:'+memoryServer.address().port;
    assert.equal((await fetch(memoryOrigin+'/readyz')).status,401);
    assert.equal((await fetch(memoryOrigin+'/readyz',{headers:{authorization:'Bearer synthetic-control-plane'}})).status,200);
    memoryReadyReads=0;
    const cliRequest={...r,flowOrigin:origin,discoverOrigin:origin,memoryOrigin};
    // Explicit fixture repair after the conflict test, not a product repair.
    await d.query('UPDATE governed_sourcing_tenants SET callback_url=$1',[origin+'/api/webhooks/signal/callback']);
    const config={version:1,observedAt:Date.now(),environment:'development',flowTargetId,discoverTargetId,flowOrigin:origin,discoverOrigin:origin,memoryOrigin,
      signalPublicKeyHash:createHash('sha256').update(publicKey.export({format:'der',type:'spki'})).digest('hex'),
      flags:Object.fromEntries(['flowWebSourcing','flowWorkerSourcing','discoverWebGoverned','discoverWorkerGoverned','discoverRc','memoryRc','memoryIndexApi'].map(k=>[k,true]))};
    cliRequest.configEvidenceHash=hash(config);
    const path=n=>resolve(dir,n);await writeJson(path('request'),cliRequest);await writeJson(path('config'),config);
    const env={ORG_SETUP_FLOW_OWNER_URL:urls[0],ORG_SETUP_DISCOVER_OWNER_URL:urls[1],ORG_SETUP_CONFIG_FILE:path('config')};
    await main(['plan','--request',path('request'),'--output',path('plan')],env);assert.equal(signedReads,0);
    const plan=await readJson(path('plan'));
    await main(['apply','--plan',path('plan'),'--approve-sha256',hash(plan),'--output',path('receipt')],env);
    assert.equal((await readJson(path('receipt'))).state,'ready');assert.equal(signedReads,0);assert.equal(memoryReadyReads,0);
    await main(['resume','--plan',path('plan'),'--approve-sha256',hash(plan),'--output',path('receipt')],env);
    assert.equal((await readJson(path('receipt'))).replayed,true);assert.equal(signedReads,0);assert.equal(memoryReadyReads,0);
    // Opt-in signed membership remains separately approved, with key in memory.
    cliRequest.signedMemoryProbe=true;await writeJson(path('request'),cliRequest);
    env.ORG_SETUP_SIGNAL_PRIVATE_KEY=privateKey.export({format:'pem',type:'pkcs8'});
    await main(['plan','--request',path('request'),'--output',path('signed-plan')],env);
    const signedPlan=await readJson(path('signed-plan'));
    await main(['apply','--plan',path('signed-plan'),'--approve-sha256',hash(signedPlan),'--output',path('receipt')],env);
    assert.equal((await readJson(path('receipt'))).state,'ready');assert.equal(signedReads,1);assert.equal(memoryReadyReads,0);ok();
  }finally{await new Promise(done=>memoryServer.close(done));await new Promise(done=>server.close(done));await rm(dir,{recursive:true,force:true});}
  // Mutation proof: catalogue drift refuses before any setup action.
  await d.query('BEGIN');
  try{
    await d.query('ALTER TABLE rc_org_policies ALTER COLUMN enabled DROP NOT NULL');
    await assert.rejects(assertDiscoverCatalog(d),/CATALOG_CHANGED/);
  }finally{await d.query('ROLLBACK');}
  await assertDiscoverCatalog(d);
  await d.query('BEGIN');
  try{
    const definition=(await d.query("SELECT pg_get_functiondef('public.signal_rc_set_policy(jsonb)'::regprocedure) sql")).rows[0].sql;
    const changed=definition.replace('DECLARE p jsonb','-- deliberate source drift\nDECLARE p jsonb');
    assert.notEqual(changed,definition);await d.query(changed);
    await assert.rejects(assertDiscoverCatalog(d),/CATALOG_CHANGED/);
  }finally{await d.query('ROLLBACK');}
  await assertDiscoverCatalog(d);ok();
  console.log(`Organisation setup PostgreSQL: ${checks} groups PASS; ${process.env.ORG_SETUP_DISCOVER_SOURCE?'full Discover migrations':'component Discover schema with real owner routine'}; Flow full migrations; zero paid calls`);
}finally{await f.end();await d.end();}
