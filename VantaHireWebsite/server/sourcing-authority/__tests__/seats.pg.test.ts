import {randomUUID} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {Client} from 'pg';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {sourceHash} from '../../job-brief/contracts';

const enabled=process.env.FLOW_SOURCING_DISPOSABLE==='1';
// Separate from the rollback-only component database: concurrent transactions
// must see committed rows. This suite owns an initially EMPTY disposable DB.
describe.skipIf(!enabled)('sourcing seats and simultaneous admissions',()=>{
  let db:Client,clients:Client[]=[];let owned=false;let nextOrg=96100;
  const hash=sourceHash('concurrency-fixture');
  const one=async(c:Client,sql:string,args:unknown[]=[]) => (await c.query(sql,args)).rows[0]?.result;
  beforeAll(async()=>{
    const url=new URL(process.env.FLOW_SOURCING_CONCURRENCY_URL??'');
    if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!url.pathname.endsWith('_concurrency_test')||!url.username.endsWith('_test'))throw Error('DISPOSABLE_TARGET_REQUIRED');
    db=new Client({connectionString:url.toString(),connectionTimeoutMillis:2000});await db.connect();
    const role=(await db.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
    expect(role).toEqual({rolsuper:false,rolbypassrls:false});
    const lock=(await db.query('SELECT pg_try_advisory_lock(5105,2) ok')).rows[0].ok;
    if(!lock)throw Error('DISPOSABLE_ALREADY_IN_USE');
    const count=(await db.query("SELECT count(*)::integer n FROM pg_class WHERE relnamespace='public'::regnamespace")).rows[0].n;
    if(count!==0)throw Error('FRESH_DISPOSABLE_REQUIRED');
    owned=true;
    await db.query('BEGIN');
    try{
      for(const file of readdirSync('server/schema-migrations').filter(f=>/^\d{4}_.*\.sql$/.test(f)).sort())await db.query(readFileSync(resolve('server/schema-migrations',file),'utf8'));
      await db.query('COMMIT');
    }catch(error){await db.query('ROLLBACK');throw error;}
    for(let n=0;n<6;n++){
      const client=new Client({connectionString:url.toString(),connectionTimeoutMillis:2000});await client.connect();clients.push(client);
    }
  },120000);
  afterAll(async()=>{
    await Promise.all(clients.map(async c=>{await c.query('ROLLBACK').catch(()=>undefined);await c.end();}));
    // Only the exact initially-empty, loopback-only DB attested above. Preserve
    // any nonempty pre-existing target by never setting owned in that case.
    if(owned)await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    await db?.end();
  });
  async function fixture(){
    const org=++nextOrg,actor=org*10,peer=actor+1;
    await db.query('BEGIN');
    try{
      await db.query("INSERT INTO users(id,username,password,role,email_verified) VALUES($1,$2,'unusable','recruiter',true),($3,$4,'unusable','recruiter',true)",[actor,`owner${org}@concurrency.invalid`,peer,`peer${org}@concurrency.invalid`]);
      await db.query("INSERT INTO organizations(id,name,slug,is_active,signal_tenant_id) VALUES($1,'Concurrency fixture',$2,true,$2)",[org,`concurrency-${org}`]);
      await db.query("INSERT INTO organization_members(organization_id,user_id,role,seat_assigned) VALUES($1,$2,'owner',true),($1,$3,'member',true)",[org,actor,peer]);
      await db.query("INSERT INTO subscription_plans(id,name,display_name,price_per_seat_monthly,price_per_seat_annual,ai_credits_per_seat_monthly,features) VALUES($1,$2,'Fixture',899900,899900,0,'{}')",[org,`plan-${org}`]);
      await db.query("INSERT INTO organization_subscriptions(id,organization_id,plan_id,seats,paid_seats,billing_cycle,status,start_date,current_period_start,current_period_end) VALUES($1,$1,$1,2,2,'monthly','active','2026-01-31','2026-01-31','2030-01-31')",[org]);
      const ent=randomUUID();
      await db.query("INSERT INTO sourcing_entitlements(id,organization_id,subscription_id,anchor,valid_from,valid_until,capacity,origin,evidence_sha256) VALUES($1,$2,$2,'2026-01-31Z','2026-01-31Z','2030-01-31Z',2,'verified_paid',$3)",[ent,org,hash]);
      await db.query('SELECT flow_sourcing_enable($1,$2)',[org,ent]);
      const jobs:number[]=[];
      for(let n=0;n<6;n++){
        const id=org*10+n;jobs.push(id);
        await db.query("INSERT INTO jobs(id,organization_id,posted_by,title,location,type,description,original_jd,status,is_active) VALUES($1,$2,$3,'Backend engineer','Bengaluru','full-time','Build Python services.','Build Python services.','approved',true)",[id,org,actor]);
        await db.query('INSERT INTO job_recruiters(job_id,recruiter_id,organization_id) VALUES($1,$2,$3)',[id,peer,org]);
        const saved=await one(db,'SELECT flow_job_brief_save($1,$2,$3,$4,0,$5) result',[org,id,actor,randomUUID(),{
          action:'save_brief',currentJD:'Build Python services.',sourceChoice:'original_prose',requesterKind:'recruiter',reasonCode:'other',
          payload:{schemaVersion:1,compilerVersion:1,taxonomyVersion:1,criteria:[{id:randomUUID(),label:'Python',class:'must_have',subject:'skill',requirement:{kind:'text',value:'Python'},use:'assessment',evidenceKinds:['profile_evidence'],provenance:{kind:'recruiter_edit'}}]},
        }]);
        await one(db,'SELECT flow_job_brief_approve($1,$2,$3,$4,1,$5,$6) result',[org,id,actor,randomUUID(),saved.versionId,hash]);
        await db.query("INSERT INTO sourcing_query_artifacts(id,organization_id,job_id,brief_version_id,material_hash,compiler_version,query_hash,input) SELECT $1,organization_id,job_id,approved_version_id,approved_material_hash,'1',$2,'{}'::jsonb FROM job_brief_state WHERE job_id=$3",[randomUUID(),hash,id]);
      }
      await db.query('COMMIT');return{org,actor,peer,jobs};
    }catch(error){await db.query('ROLLBACK');throw error;}
  }
  const quote=(f:Awaited<ReturnType<typeof fixture>>,job=f.jobs[0])=>one(db,'SELECT flow_sourcing_quote($1,$2,$3) result',[f.org,job,f.actor]);
  const admit=(c:Client,f:Awaited<ReturnType<typeof fixture>>,job:number,q:any,request=randomUUID())=>one(c,'SELECT flow_sourcing_admit($1,$2,$3,$4,$5) result',[f.org,job,f.actor,request,{
    expectedRevision:q.revision,briefVersionId:q.briefVersionId,materialHash:q.materialHash,artifactId:q.artifactId,expectedPayerSlotId:q.payerSlotId,expectedWindowStart:q.windowStart,quoteExpiresAt:q.expiresAt,
  }]);
  it.each(['cancel','receipt'] as const)('cancel/receipt race serializes with %s first, never refunding a captured run',async first=>{
    const f=await fixture(),q=await quote(f),adm=await admit(db,f,f.jobs[0],q);
    const dispatch=await one(db,'SELECT flow_sourcing_dispatch_claim($1) result',[randomUUID()]);
    const requestId=randomUUID(),executionAttemptId=randomUUID(),grantId=randomUUID();
    await one(db,'SELECT flow_sourcing_dispatch_finish($1,$2,$3) result',[adm.id,dispatch.lease,{kind:'bound',requestId,
      flowRunId:adm.id,artifactHash:hash,acquisitionGeneration:1,executionAttemptId}]);
    // Controlled issued-grant fixture. The grant validator has its own component
    // tests; these connections exercise the real cancellation/receipt routines.
    await db.query(`INSERT INTO sourcing_execution_grants(id,organization_id,admission_id,slot,request_sha256,provider_input_sha256,issued_at,expires_at,state)
      VALUES($1,$2,$3,'exact',$4,$4,clock_timestamp(),clock_timestamp()+interval '59 seconds','issued')`,[grantId,f.org,adm.id,hash]);
    const common={protocolVersion:1,flowRunId:adm.id,artifactHash:hash,discoverRequestId:requestId,executionAttemptId};
    const cancel={...common,action:'no_dispatch',cancellationId:randomUUID(),cancelledAt:new Date().toISOString()};
    const receipt={...common,action:'receipt',grantId,slot:'exact',providerInputHash:hash,receiptId:'race-fixture',state:'started'};
    const invoke=(client:Client,kind:'cancel'|'receipt')=>one(client,`SELECT flow_sourcing_${kind}($1,$2,$3) result`,[f.org,adm.id,kind==='cancel'?cancel:receipt]);
    const [winner,loser]=clients;
    const loserPid=(await loser.query('SELECT pg_backend_pid() pid')).rows[0].pid;
    await winner.query('BEGIN');await loser.query('BEGIN');
    try {
      await invoke(winner,first); // retain the authority row lock until COMMIT
      const pending=invoke(loser,first==='cancel'?'receipt':'cancel').then(value=>({value,error:null}),error=>({value:null,error}));
      let blocked=false;
      for(let n=0;n<50;n++) {
        blocked=(await db.query('SELECT cardinality(pg_blocking_pids($1))>0 blocked',[loserPid])).rows[0].blocked;
        if(blocked)break;
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      expect(blocked).toBe(true);
      await winner.query('COMMIT');
      const result=await pending;
      expect(result.error).toMatchObject({code:'P0001',message:'SOURCING_INVALID_RECEIPT'});
      await loser.query('ROLLBACK');
      const events=(await db.query('SELECT kind FROM sourcing_account_events WHERE admission_id=$1 ORDER BY kind',[adm.id])).rows.map(r=>r.kind);
      expect(events).toContain(first==='cancel'?'release':'capture');
      expect(events).not.toContain(first==='cancel'?'capture':'release');
      expect((await db.query('SELECT reserved,captured FROM sourcing_allowance_windows WHERE organization_id=$1',[f.org])).rows)
        .toEqual([{reserved:0,captured:first==='cancel'?0:1}]);
    } finally {await winner.query('ROLLBACK');await loser.query('ROLLBACK');}
  });
  it('simultaneous duplicate intents reserve once and all return the same admission',async()=>{
    const f=await fixture(),q=await quote(f),request=randomUUID();
    const results=await Promise.all(clients.map(c=>admit(c,f,f.jobs[0],q,request)));
    expect(new Set(results.map(r=>r.id)).size).toBe(1);
    expect(results.filter(r=>r.replayed===false)).toHaveLength(1);
    expect((await db.query('SELECT reserved,captured FROM sourcing_allowance_windows WHERE organization_id=$1',[f.org])).rows).toEqual([{reserved:1,captured:0}]);
    expect((await db.query('SELECT count(*)::integer n FROM sourcing_dispatch_outbox WHERE organization_id=$1',[f.org])).rows[0].n).toBe(1);
  });
  it('six different jobs competing for one seat admit only five, without overdraft',async()=>{
    const f=await fixture(),quotes=await Promise.all(f.jobs.map(j=>quote(f,j)));
    const results=await Promise.allSettled(clients.map((c,n)=>admit(c,f,f.jobs[n],quotes[n])));
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(5);
    const refused=results.filter((r):r is PromiseRejectedResult=>r.status==='rejected');
    expect(refused).toHaveLength(1);expect(refused[0].reason.message).toContain('SOURCING_ALLOWANCE_EXHAUSTED');
    expect((await db.query('SELECT reserved,captured FROM sourcing_allowance_windows WHERE organization_id=$1',[f.org])).rows).toEqual([{reserved:5,captured:0}]);
  });
  it('different requests racing for the same job admit once',async()=>{
    const f=await fixture(),q=await quote(f);
    const results=await Promise.allSettled(clients.map(c=>admit(c,f,f.jobs[0],q)));
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    for(const result of results)if(result.status==='rejected')expect(result.reason.message).toContain('SOURCING_ALREADY_ADMITTED');
    expect((await db.query('SELECT reserved,captured FROM sourcing_allowance_windows WHERE organization_id=$1',[f.org])).rows).toEqual([{reserved:1,captured:0}]);
    expect((await db.query('SELECT count(*)::integer n FROM sourcing_dispatch_outbox WHERE organization_id=$1',[f.org])).rows[0].n).toBe(1);
  });
  it('a membership writer refuses boundedly when admission owns the coordination row',async()=>{
    const f=await fixture();await clients[0].query('BEGIN');
    try{
      await clients[0].query('SELECT organization_id FROM sourcing_org_state WHERE organization_id=$1 FOR UPDATE',[f.org]);
      await expect(clients[1].query('UPDATE organization_members SET seat_assigned=false WHERE organization_id=$1 AND user_id=$2',[f.org,f.actor])).rejects.toMatchObject({code:'55P03'});
      expect((await db.query('SELECT seat_assigned FROM organization_members WHERE organization_id=$1 AND user_id=$2',[f.org,f.actor])).rows[0].seat_assigned).toBe(true);
    }finally{await clients[0].query('ROLLBACK');}
  });
  it('committed seat revocation invalidates a quote before any reservation',async()=>{
    const f=await fixture(),q=await quote(f);
    await clients[1].query('UPDATE organization_members SET seat_assigned=false WHERE organization_id=$1 AND user_id=$2',[f.org,f.actor]);
    expect(await admit(clients[0],f,f.jobs[0],q)).toBeNull();
    expect((await db.query('SELECT count(*)::integer n FROM sourcing_admissions WHERE organization_id=$1',[f.org])).rows[0].n).toBe(0);
  });
});
