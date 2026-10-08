import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sourceHash } from '../../job-brief/contracts';
import {sourcingHash} from '../contracts';
import {compileSourcingQuery,digestBasisHash,sourcingBasisSchema,validateProviderGrant} from '../compiler';
import {SOURCING_CATALOG_SQL,SOURCING_CATALOG_SHA256,SOURCING_FUNCTIONS,SOURCING_PRIVATE_FUNCTIONS} from '../catalog';

const enabled = process.env.FLOW_SOURCING_DISPOSABLE === '1';
const url = process.env.FLOW_SOURCING_OWNER_URL ?? '';
const hash = sourceHash('fixture');
const org = 95101, actor = 95101, peer = 95102;

describe.skipIf(!enabled)('sourcing SQL admission component on real PostgreSQL', () => {
  let db: Client;
  async function one(sql: string, values: unknown[] = []) { return (await db.query(sql, values)).rows[0]?.result; }
  async function legacyCandidate(state='new') {
    await db.query("INSERT INTO job_sourcing_runs(organization_id,job_id,request_id,external_job_id,status,context_hash) VALUES($1,95201,'legacy','vanta:jobs:95201','completed',$2)",[org,hash]);
    return (await db.query("INSERT INTO job_sourced_candidates(organization_id,job_id,request_id,signal_candidate_id,source_type,state) VALUES($1,95201,'legacy','decision-fixture','discovered',$2) RETURNING id",[org,state])).rows[0].id;
  }
  async function job(id: number) {
    await db.query("INSERT INTO jobs(id,organization_id,posted_by,title,location,type,description,original_jd,status,is_active) VALUES($1,$2,$3,'Backend engineer','Bengaluru','full-time','Build Python services.','Build Python services.','approved',true)", [id, org, actor]);
    await db.query('INSERT INTO job_recruiters(job_id,recruiter_id,organization_id) VALUES($1,$2,$3)', [id, peer, org]);
    const saved = await one('SELECT flow_job_brief_save($1,$2,$3,$4,0,$5) result', [org, id, actor, randomUUID(), {
      action: 'save_brief', currentJD: 'Build Python services.', sourceChoice: 'original_prose', requesterKind: 'recruiter', reasonCode: 'other',
      payload: { schemaVersion: 2, compilerVersion: 2, taxonomyVersion: 2, criteria: [{
        id: randomUUID(), label: 'Python', class: 'must_have', subject: 'skill', requirement: { kind: 'text', value: 'Python' },
        use: 'assessment', evidenceKinds: ['profile_evidence'], provenance: { kind: 'recruiter_edit' },
      }] },
    }]);
    await one('SELECT flow_job_brief_approve($1,$2,$3,$4,1,$5,$6) result', [org, id, actor, randomUUID(), saved.versionId, hash]);
    // Controlled component fixture only. The product artifact writer is tested
    // separately; this does not claim the full release/provisioner chain passed.
    await db.query(`INSERT INTO sourcing_query_artifacts(id,organization_id,job_id,brief_version_id,material_hash,compiler_version,query_hash,input)
      SELECT $1,organization_id,job_id,approved_version_id,approved_material_hash,'1',$2,'{}'::jsonb FROM job_brief_state WHERE job_id=$3`, [randomUUID(), hash, id]);
  }
  const quote = (jobId = 95201, user = actor) => one('SELECT flow_sourcing_quote($1,$2,$3) result', [org, jobId, user]);
  const command = (q: any) => ({ expectedRevision: q.revision, briefVersionId: q.briefVersionId, materialHash: q.materialHash,
    artifactId: q.artifactId, expectedPayerSlotId: q.payerSlotId, expectedWindowStart: q.windowStart, quoteExpiresAt:q.expiresAt });
  const admit = (q: any, jobId = 95201, request = randomUUID(), user = actor) => one('SELECT flow_sourcing_admit($1,$2,$3,$4,$5) result', [org, jobId, user, request, command(q)]);
  async function boundAdmission(bind=true,historical=false){
    await db.query("UPDATE organizations SET signal_tenant_id='sourcing-fixture-tenant' WHERE id=$1",[org]);
    const request=randomUUID();
    await one('SELECT flow_sourcing_digest_claim($1,$2,$3,$4,$5) result',[org,95201,actor,request,{action:'schedule',model:'fixture-model'}]);
    const claim=await one('SELECT flow_sourcing_digest_claim($1,$2,$3,$4,$5) result',[org,95201,actor,request,{action:'start',model:'fixture-model'}]);
    const digest={version:3,topSkills:['Python'],seniorityLevel:'senior',domain:'Software',constraints:[],keyResponsibilities:[],
      titleSearchTerms:['Backend Engineer'],adjacentBuckets:[['Platform Engineer']],adjacentLocations:[],tokenCount:50};
    await one('SELECT flow_sourcing_digest_finish($1,$2,$3) result',[request,claim.lease,{state:'succeeded',digest,inputTokens:80,outputTokens:50}]);
    const artifact=compileSourcingQuery(claim.basis,digest,claim.basisHash);
    await one('SELECT flow_sourcing_artifact_put($1,$2,$3,$4,$5) result',[org,95201,actor,artifact.briefVersionId,artifact]);
    // Rehearse an admission issued by shipped 5B, then restore the new routine.
    // This is test-transaction-only; no trigger bypass or historical row rewrite.
    const admissionDefinition=(file:string)=>{
      const source=readFileSync(resolve('server/schema-migrations',file),'utf8');
      const definition=source.match(/CREATE(?: OR REPLACE)? FUNCTION public\.flow_sourcing_admit\([\s\S]*?REVOKE ALL ON FUNCTION public\.flow_sourcing_admit\(integer,integer,integer,uuid,jsonb\) FROM PUBLIC;/)?.[0];
      if(!definition)throw Error('Missing admission fixture');
      return definition.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION');
    };
    if(historical)await db.query(admissionDefinition('0015_governed_sourcing.sql'));
    const admitted=await admit(await quote());
    if(historical)await db.query(admissionDefinition('0016_rubric_ranking.sql'));
    const dispatch=await one('SELECT flow_sourcing_dispatch_claim($1) result',[randomUUID()]);
    const discover=randomUUID(),execution=randomUUID();
    const finish=()=>one('SELECT flow_sourcing_dispatch_finish($1,$2,$3) result',[admitted.id,dispatch.lease,{kind:'bound',requestId:discover,flowRunId:admitted.id,
      artifactHash:artifact.queryHash,acquisitionGeneration:1,executionAttemptId:execution}]);
    if(bind)await finish();
    const raw={action:'grant',protocolVersion:1,flowRunId:admitted.id,artifactHash:artifact.queryHash,discoverRequestId:discover,executionAttemptId:execution,
      slot:'exact',rungId:'exact',providerInput:{version:1,limit:300,excludePersonIds:[],requirements:{title:artifact.jobContext.title,
        topSkills:['python'],seniorityLevel:'senior',domain:'Software',roleFamily:'backend',location:artifact.jobContext.location,
        experienceYears:null,experienceYearsMax:null,education:null,titleSearchTerms:['backend engineer'],adjacentBuckets:[['platform engineer']],adjacentLocations:[]}}};
    const {providerInputHash}=validateProviderGrant(artifact,raw,null),grantCommand={...raw,providerInputHash};
    const grant=()=>one('SELECT flow_sourcing_grant($1,$2,$3) result',[org,admitted.id,grantCommand]);
    return {admitted,artifact,grant,grantCommand,finish,receipt:(g:any,state:string,extra={})=>({action:'receipt',protocolVersion:1,
      flowRunId:admitted.id,artifactHash:artifact.queryHash,discoverRequestId:discover,executionAttemptId:execution,
      grantId:g.grantId,slot:'exact',providerInputHash,receiptId:'owned-receipt',state,...extra})};
  }

  beforeAll(async () => {
    const target = new URL(url);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) || !target.pathname.endsWith('_test') || !target.username.endsWith('_test')) throw Error('DISPOSABLE_TARGET_REQUIRED');
    db = new Client({ connectionString: url, connectionTimeoutMillis: 2000 }); await db.connect();
    const identity = (await db.query('SELECT current_database() db,current_user usr,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
    expect(identity.db.endsWith('_test') && identity.usr.endsWith('_test')).toBe(true);
    expect(identity.rolsuper).toBe(false); expect(identity.rolbypassrls).toBe(false);
    if(process.env.FLOW_SOURCING_EXPECT_LOCALE){
      expect((await db.query('SHOW server_version_num')).rows[0].server_version_num).toMatch(/^17/);
      expect((await db.query('SELECT datcollate FROM pg_database WHERE datname=current_database()')).rows[0].datcollate).toBe(process.env.FLOW_SOURCING_EXPECT_LOCALE);
    }
    // One isolated schema transaction per run: afterAll rolls all DDL back.
    // Refuse a nonempty database instead of resetting someone else's test data.
    if ((await db.query("SELECT to_regclass('public.jobs') relation")).rows[0].relation) throw Error('FRESH_DISPOSABLE_REQUIRED');
    {
      await db.query('BEGIN');
      try {
        const dir = resolve('server/schema-migrations');
        for (const file of readdirSync(dir).filter(f => /^\d{4}_.*\.sql$/.test(f)).sort()) await db.query(readFileSync(resolve(dir, file), 'utf8'));
        await db.query('SAVEPOINT installed');
      } catch (error) { await db.query('ROLLBACK'); throw error; }
    }
  }, 120000);
  beforeEach(async () => {
    await db.query('SAVEPOINT case_start');
    await db.query("SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='5s'");
    await db.query("INSERT INTO users(id,username,password,role,email_verified) VALUES($1,'owner@sourcing.invalid','unusable','recruiter',true),($2,'peer@sourcing.invalid','unusable','recruiter',true)", [actor, peer]);
    await db.query("INSERT INTO organizations(id,name,slug,is_active,signal_tenant_id) VALUES($1,'Sourcing fixture','sourcing-fixture',true,'sourcing-fixture-tenant')", [org]);
    await db.query("INSERT INTO organization_members(organization_id,user_id,role,seat_assigned) VALUES($1,$2,'owner',true),($1,$3,'member',true)", [org, actor, peer]);
    await db.query("INSERT INTO subscription_plans(id,name,display_name,price_per_seat_monthly,price_per_seat_annual,ai_credits_per_seat_monthly,features) VALUES($1,'fixture','Fixture',899900,899900,0,'{}')", [org]);
    await db.query(`INSERT INTO organization_subscriptions(id,organization_id,plan_id,seats,paid_seats,billing_cycle,status,start_date,current_period_start,current_period_end)
      VALUES($1,$1,$1,2,2,'monthly','active','2026-01-31T00:00:00.123456','2026-01-31T00:00:00.123456','2030-01-31T00:00:00')`, [org]);
    const entitlement = randomUUID();
    await db.query(`INSERT INTO sourcing_entitlements(id,organization_id,subscription_id,anchor,valid_from,valid_until,capacity,origin,evidence_sha256)
      VALUES($1,$2,$2,'2026-01-31T00:00:00.123456Z','2026-01-31T00:00:00.123456Z','2030-01-31T00:00:00Z',2,'verified_paid',$3)`, [entitlement, org, hash]);
    await db.query('SELECT flow_sourcing_enable($1,$2)', [org,entitlement]);
    await job(95201);
  });
  afterEach(async () => { await db?.query('ROLLBACK TO SAVEPOINT case_start'); });
  afterAll(async () => { await db?.query('ROLLBACK'); await db?.end(); });

  it('reuses the exact baseline composite unique index for both candidate FKs', async () => {
    const rows = (await db.query(`SELECT c.conname,i.relname FROM pg_constraint c JOIN pg_class i ON i.oid=c.conindid
      WHERE c.conname IN ('src_dec_cand_fk','src_item_cand_fk') ORDER BY c.conname`)).rows;
    expect(rows).toEqual([{ conname: 'src_dec_cand_fk', relname: 'job_sourced_candidates_id_org_job_idx' }, { conname: 'src_item_cand_fk', relname: 'job_sourced_candidates_id_org_job_idx' }]);
  });
  it('operator enable immediately supplies slots without an unrelated membership edit',async()=>{
    expect((await quote()).remaining).toBe(5);
    expect((await db.query('SELECT count(*)::int n FROM sourcing_seat_slots WHERE organization_id=$1 AND active',[org])).rows[0].n).toBe(2);
  });
  it('blocks a second purchase for a legacy sourced job on the server',async()=>{
    await legacyCandidate();
    await expect(admit(await quote())).rejects.toThrow('SOURCING_ALREADY_ADMITTED');
  });
  it('refuses missing tenant binding before reserving any allowance',async()=>{
    const q=await quote();await db.query('UPDATE organizations SET signal_tenant_id=NULL WHERE id=$1',[org]);
    await db.query('SAVEPOINT no_tenant');
    await expect(admit(q)).rejects.toThrow('SOURCING_TENANT_REQUIRED');
    await db.query('ROLLBACK TO SAVEPOINT no_tenant');
    expect((await db.query('SELECT count(*)::int n FROM sourcing_admissions')).rows[0].n).toBe(0);
  });
  it('allows fixed decisions on legacy candidates without a sourcing entitlement',async()=>{
    const candidate=await legacyCandidate();
    await db.query('DELETE FROM sourcing_org_state WHERE organization_id=$1',[org]);
    expect(await one('SELECT flow_sourcing_decide($1,$2,$3,$4,$5,$6) result',[org,95201,actor,candidate,randomUUID(),{action:'pass',expectedRevision:0}])).toMatchObject({state:'passed'});
  });
  for(const table of ['sourcing_entitlements','sourcing_seat_events','sourcing_query_artifacts','sourcing_account_events','sourcing_deliveries','sourcing_delivery_items','sourcing_decision_events']){
    for(const operation of ['UPDATE','DELETE','TRUNCATE'])it(`refuses ${operation} of immutable ${table}`,async()=>{
      // Explicit FK closure lets the trigger run instead of passing on an FK
      // refusal. Never use CASCADE: every target is named from the owned schema.
      const closure=operation==='TRUNCATE'?(await db.query(`WITH RECURSIVE refs(oid) AS (
        SELECT $1::regclass::oid UNION SELECT c.conrelid FROM pg_constraint c JOIN refs r ON c.confrelid=r.oid WHERE c.contype='f'
      ) SELECT string_agg(format('%I.%I',n.nspname,c.relname),', ' ORDER BY c.oid) names
        FROM refs r JOIN pg_class c ON c.oid=r.oid JOIN pg_namespace n ON n.oid=c.relnamespace`,[table])).rows[0].names:'';
      const sql=operation==='UPDATE'?`UPDATE ${table} SET organization_id=organization_id`:operation==='DELETE'?`DELETE FROM ${table}`:`TRUNCATE ${closure} RESTRICT`;
      await expect(db.query(sql)).rejects.toMatchObject({code:'55000',message:'SOURCING_IMMUTABLE'});
    });
  }
  async function replaceEntitlement(capacity:number,patch:{anchor?:string;origin?:string}={}){
    const next=randomUUID();
    await db.query(`INSERT INTO sourcing_entitlements(id,organization_id,subscription_id,anchor,valid_from,valid_until,capacity,origin,evidence_sha256,supersedes_id)
      SELECT $2,e.organization_id,e.subscription_id,coalesce($4::timestamptz,e.anchor),e.valid_from,e.valid_until,$3,coalesce($5,e.origin),e.evidence_sha256,e.id
      FROM sourcing_org_state o JOIN sourcing_entitlements e ON e.id=o.entitlement_id WHERE o.organization_id=$1`,[org,next,capacity,patch.anchor??null,patch.origin??null]);
    await db.query('SELECT flow_sourcing_enable($1,$2)',[org,next]);
    return next;
  }
  it('supersedes an entitlement without stranding an existing reservation or resetting counts',async()=>{
    const f=await boundAdmission();
    await replaceEntitlement(2);
    expect(await f.grant()).toMatchObject({state:'issued'});
    expect((await quote()).remaining).toBe(4);
    expect((await db.query('SELECT count(*)::int n FROM sourcing_allowance_windows')).rows[0].n).toBe(1);
  });
  it('refuses an anchor change instead of creating an overlapping allowance window',async()=>{
    await admit(await quote());
    await db.query("UPDATE organization_subscriptions SET start_date='2026-01-30' WHERE id=$1",[org]);
    await expect(replaceEntitlement(2,{anchor:'2026-01-30T00:00:00Z'})).rejects.toThrow('SOURCING_WINDOW_CHANGED');
  });
  it('capacity shrink/regrow reuses the same slots and consumption',async()=>{
    await admit(await quote());
    const before=(await db.query('SELECT id,slot_number FROM sourcing_seat_slots ORDER BY slot_number')).rows;
    await replaceEntitlement(1);await replaceEntitlement(2);
    expect((await db.query('SELECT id,slot_number FROM sourcing_seat_slots ORDER BY slot_number')).rows).toEqual(before);
    expect((await quote()).remaining).toBe(4);
  });
  it('an explicit operator grant can authorize a trial subscription without treating it as paid',async()=>{
    await db.query("UPDATE organization_subscriptions SET status='trial' WHERE id=$1",[org]);
    await replaceEntitlement(2,{origin:'explicit_grant'});
    expect((await quote()).remaining).toBe(5);
  });
  it('quote is read-only, prefers the poster even for the peer, and expires in60 seconds', async () => {
    await db.query('SAVEPOINT quote_read');
    const q = await quote(95201, peer);
    expect(q).toMatchObject({ payerUserId: actor, remaining: 5 });
    expect(Date.parse(q.expiresAt) - Date.parse(q.quotedAt)).toBeLessThanOrEqual(60001);
    expect((await db.query('SELECT count(*)::integer n FROM sourcing_allowance_windows')).rows[0].n).toBe(0);
  });
  it('reserves, journals and queues atomically; duplicate request spends once', async () => {
    const q = await quote(), request = randomUUID();
    const first = await admit(q, 95201, request);
    expect(await admit(q, 95201, request)).toMatchObject({ id: first.id, replayed: true });
    expect((await db.query('SELECT reserved,captured FROM sourcing_allowance_windows')).rows).toEqual([{ reserved: 1, captured: 0 }]);
    expect((await db.query('SELECT count(*)::integer n FROM sourcing_dispatch_outbox')).rows[0].n).toBe(1);
    expect((await db.query('SELECT count(*)::integer n FROM job_sourcing_runs WHERE sourcing_admission_id=$1', [first.id])).rows[0].n).toBe(1);
  });
  it('refuses a second initial run on the job', async () => {
    const q = await quote(); await admit(q);
    await expect(admit(q)).rejects.toThrow('SOURCING_ALREADY_ADMITTED');
  });
  it('closes an expired final dispatch lease without refunding or dispatching again', async () => {
    const admitted = await admit(await quote());
    await db.query(`UPDATE sourcing_dispatch_outbox SET attempts=8,state='leased',lease_id=$2,
      lease_until=clock_timestamp()-interval '1 second' WHERE admission_id=$1`, [admitted.id, randomUUID()]);
    expect(await one('SELECT flow_sourcing_dispatch_claim($1) result', [randomUUID()])).toBeNull();
    expect((await db.query('SELECT state,lease_id,attempts FROM sourcing_dispatch_outbox WHERE admission_id=$1', [admitted.id])).rows[0])
      .toEqual({state:'needs_attention',lease_id:null,attempts:8});
    expect((await db.query('SELECT state FROM sourcing_admissions WHERE id=$1', [admitted.id])).rows[0].state).toBe('needs_attention');
    expect((await db.query('SELECT reserved,captured FROM sourcing_allowance_windows')).rows).toEqual([{reserved:1,captured:0}]);
    expect((await db.query("SELECT count(*)::integer n FROM sourcing_account_events WHERE kind='release'")).rows[0].n).toBe(0);
  });
  it.each(['pending','leased'])('bounds %s preview polling without another provider command or a fabricated zero', async state => {
    const q = await quote(), previewId = randomUUID();
    await db.query(`INSERT INTO sourcing_count_previews(id,organization_id,job_id,artifact_id,request_id,state,query_hash,created_at)
      VALUES($1,$2,95201,$3,$4,$6,$5,clock_timestamp()-interval '16 minutes')`, [previewId,org,q.artifactId,randomUUID(),hash,state]);
    if(state==='leased')await db.query("UPDATE sourcing_count_previews SET lease_id=$2,lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[previewId,randomUUID()]);
    expect(await one('SELECT flow_sourcing_preview_claim($1) result', [randomUUID()])).toBeNull();
    expect((await db.query('SELECT state,count,credits_used,lease_id FROM sourcing_count_previews WHERE id=$1', [previewId])).rows[0])
      .toEqual({state:state==='pending'?'unavailable':'unknown',count:null,credits_used:null,lease_id:null});
  });
  it('falls back to the clicker only when the poster has exhausted five', async () => {
    for (let n = 0; n < 5; n++) {
      const jobId = 95201 + n;
      if (n) await job(jobId);
      await admit(await quote(jobId), jobId);
    }
    await job(95206);
    expect(await quote(95206, peer)).toMatchObject({ payerUserId: peer, remaining: 5 });
    await expect(quote(95206, actor)).rejects.toThrow('SOURCING_ALLOWANCE_EXHAUSTED');
  });
  it('a changed payer requires reconfirmation instead of silently charging the peer', async () => {
    const q = await quote(95201, peer);
    await db.query('UPDATE organization_members SET seat_assigned=false WHERE organization_id=$1 AND user_id=$2', [org, actor]);
    await expect(admit(q, 95201, randomUUID(), peer)).rejects.toThrow('SOURCING_PAYER_CHANGED');
  });
  it('unseating and reseating retains the used balance', async () => {
    await admit(await quote());
    await db.query('UPDATE organization_members SET seat_assigned=false WHERE organization_id=$1 AND user_id=$2', [org, actor]);
    await db.query('UPDATE organization_members SET seat_assigned=true WHERE organization_id=$1 AND user_id=$2', [org, actor]);
    await job(95202);
    expect(await quote(95202)).toMatchObject({ payerUserId: actor, remaining: 4 });
  });
  it('deleting and re-adding membership cannot mint a new seat allowance', async () => {
    await admit(await quote());
    const slot=(await quote()).payerSlotId;
    await db.query('DELETE FROM organization_members WHERE organization_id=$1 AND user_id=$2',[org,actor]);
    await db.query("INSERT INTO organization_members(organization_id,user_id,role,seat_assigned) VALUES($1,$2,'owner',true)",[org,actor]);
    await job(95202);
    expect(await quote(95202)).toMatchObject({payerSlotId:slot,payerUserId:actor,remaining:4});
    expect((await db.query('SELECT count(*)::integer n FROM sourcing_seat_slots WHERE organization_id=$1',[org])).rows[0].n).toBe(2);
  });
  it('a replacement recruiter inherits the stable slot balance, not five new runs', async () => {
    await admit(await quote());
    const slot=(await quote()).payerSlotId;
    await db.query('DELETE FROM organization_members WHERE organization_id=$1 AND user_id=$2',[org,actor]);
    const replacement=actor+2;
    await db.query("INSERT INTO users(id,username,password,role,email_verified) VALUES($1,'replacement@sourcing.invalid','unusable','recruiter',true)",[replacement]);
    await db.query("INSERT INTO organization_members(organization_id,user_id,role,seat_assigned) VALUES($1,$2,'member',true)",[org,replacement]);
    await db.query('INSERT INTO job_recruiters(job_id,recruiter_id,organization_id) VALUES(95201,$1,$2)',[replacement,org]);
    expect(await quote(95201,replacement)).toMatchObject({payerSlotId:slot,payerUserId:replacement,remaining:4});
  });
  it.each(['trial','expired','cancelled'])('fails closed for an ineligible subscription: %s',async status=>{
    await db.query('UPDATE organization_subscriptions SET status=$1 WHERE id=$2',[status,org]);
    await expect(quote()).rejects.toThrow('SOURCING_ENTITLEMENT_REQUIRED');
  });
  it('changing the subscription anchor cannot reset an existing entitlement',async()=>{
    await admit(await quote());
    await db.query("UPDATE organization_subscriptions SET start_date=start_date+interval '1 day' WHERE id=$1",[org]);
    await expect(quote()).rejects.toThrow('SOURCING_ENTITLEMENT_REQUIRED');
  });
  it('annual billing still uses the same monthly anniversary window',async()=>{
    const before=await quote();
    await db.query("UPDATE organization_subscriptions SET billing_cycle='annual' WHERE id=$1",[org]);
    expect(await quote()).toMatchObject({windowStart:before.windowStart,windowEnd:before.windowEnd,payerSlotId:before.payerSlotId});
  });
  it('candidate and cross-org authority cannot quote under a non-superuser owner', async () => {
    expect(await one('SELECT flow_sourcing_quote($1,$2,$3) result', [org + 1, 95201, actor])).toBeNull();
    await db.query("UPDATE users SET role='candidate' WHERE id=$1", [peer]);
    expect(await quote(95201, peer)).toBeNull();
  });
  it('SQL anniversary boundaries agree with the original anchor rather than drift', async () => {
    const window = (await db.query("SELECT * FROM flow_sourcing_window('2026-01-31T12:00:00Z','2026-02-28T12:00:00Z')")).rows[0];
    expect(window.starts_at.toISOString()).toBe('2026-02-28T12:00:00.000Z');
    expect(window.ends_at.toISOString()).toBe('2026-03-31T12:00:00.000Z');
  });
  it.each([
    ['2023-01-31T12:00:00Z','2024-02-29T12:00:00Z','2024-02-29T12:00:00.000Z','2024-03-31T12:00:00.000Z'],
    ['2025-01-31T12:00:00Z','2026-01-01T00:00:00Z','2025-12-31T12:00:00.000Z','2026-01-31T12:00:00.000Z'],
    ['2026-01-31T12:00:00Z','2026-02-28T11:59:59.999999Z','2026-01-31T12:00:00.000Z','2026-02-28T12:00:00.000Z'],
  ])('window edge %s at %s',async(anchor,at,start,end)=>{
    const w=(await db.query('SELECT * FROM flow_sourcing_window($1,$2)',[anchor,at])).rows[0];
    expect(w.starts_at.toISOString()).toBe(start);expect(w.ends_at.toISOString()).toBe(end);
  });
  it('issues one input-bound grant; started and repeated complete receipts capture only one run',async()=>{
    const f=await boundAdmission(),g=await f.grant();expect(await f.grant()).toEqual(g);
    expect(await one('SELECT flow_sourcing_grant_context($1,$2) result',['foreign',f.admitted.id])).toBeNull();
    const receive=(body:unknown)=>one('SELECT flow_sourcing_receipt($1,$2,$3) result',[org,f.admitted.id,body]);
    expect(await receive(f.receipt(g,'started'))).toMatchObject({state:'started',captured:true});
    expect(await receive(f.receipt(g,'complete',{providerTotal:270,rawReturnedCount:250}))).toMatchObject({state:'complete'});
    expect(await receive(f.receipt(g,'complete',{providerTotal:270,rawReturnedCount:250}))).toMatchObject({state:'complete',replayed:true});
    expect(await receive(f.receipt(g,'started'))).toMatchObject({state:'complete',replayed:true});
    expect((await db.query('SELECT reserved,captured FROM sourcing_allowance_windows')).rows).toEqual([{reserved:0,captured:1}]);
    expect((await db.query("SELECT count(*)::integer n FROM sourcing_account_events WHERE kind='capture'")).rows[0].n).toBe(1);
    expect(await one('SELECT flow_sourcing_grant_context($1,$2) result',['sourcing-fixture-tenant',f.admitted.id])).toMatchObject({exact:{providerTotal:270,rawReturnedCount:250}});
    await expect(receive(f.receipt(g,'complete',{providerTotal:270,rawReturnedCount:249}))).rejects.toThrow('SOURCING_REQUEST_CONFLICT');
  });
  it.each([280,null,400])('SQL spill grant requires a complete shortfall, total=%s',async total=>{
    const f=await boundAdmission(),g=await f.grant();
    await one('SELECT flow_sourcing_receipt($1,$2,$3) result',[org,f.admitted.id,f.receipt(g,'complete',{rawReturnedCount:257,providerTotal:total})]);
    const providerInput={...f.grantCommand.providerInput,limit:43,requirements:{...f.grantCommand.providerInput.requirements,titleSearchTerms:['platform engineer']}};
    const spill={...f.grantCommand,slot:'spill',rungId:'adjacent_title:0',providerInput,providerInputHash:sourcingHash(providerInput)};
    const grant=()=>one('SELECT flow_sourcing_grant($1,$2,$3) result',[org,f.admitted.id,spill]);
    if(total===280){
      const issued=await grant();expect(issued).toMatchObject({state:'issued'});expect(await grant()).toEqual(issued);
      expect((await db.query('SELECT reserved,captured FROM sourcing_allowance_windows')).rows).toEqual([{reserved:0,captured:1}]);
      expect((await db.query('SELECT count(*)::int n FROM sourcing_execution_grants')).rows[0].n).toBe(2);
    }else await expect(grant()).rejects.toThrow('SOURCING_INVALID_RECEIPT');
  });
  it('refuses a new grant after payer revocation before the paid boundary',async()=>{
    const f=await boundAdmission();
    await db.query('UPDATE organization_members SET seat_assigned=false WHERE organization_id=$1 AND user_id=$2',[org,actor]);
    await expect(f.grant()).rejects.toThrow('SOURCING_NOT_FOUND');
  });
  it('a late uncertain receipt consumes once even after new admissions are paused',async()=>{
    const f=await boundAdmission(),g=await f.grant();
    await db.query('UPDATE sourcing_org_state SET enabled=false WHERE organization_id=$1',[org]);
    expect(await one('SELECT flow_sourcing_receipt($1,$2,$3) result',[org,f.admitted.id,f.receipt(g,'uncertain')])).toMatchObject({captured:true,state:'uncertain'});
    expect((await db.query('SELECT state FROM sourcing_admissions WHERE id=$1',[f.admitted.id])).rows[0].state).toBe('needs_attention');
    expect((await db.query('SELECT reserved,captured FROM sourcing_allowance_windows')).rows).toEqual([{reserved:0,captured:1}]);
  });
  it('handles a worker grant arriving before the dispatch HTTP acknowledgement',async()=>{
    const f=await boundAdmission(false),g=await f.grant();
    expect(g.state).toBe('issued');
    expect(await f.finish()).toMatchObject({id:f.admitted.id,state:'bound'});
    expect(await f.grant()).toEqual(g);
  });
  it('pins the complete source catalog under the non-superuser table owner',async()=>{
    const digest=(await db.query(SOURCING_CATALOG_SQL)).rows[0].digest;
    if(process.env.FLOW_SOURCING_CATALOG_PRINT==='1')console.info('SOURCING_CATALOG_SHA256='+digest);
    else expect(digest).toBe(SOURCING_CATALOG_SHA256);
    const actual=(await db.query("SELECT p.oid::regprocedure::text signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'flow_sourcing_%'")).rows.map(r=>r.signature).sort();
    expect(actual).toEqual([...SOURCING_FUNCTIONS,...SOURCING_PRIVATE_FUNCTIONS].sort());
  });
  it('terminal no-dispatch evidence refunds once and prevents any later capture',async()=>{
    const f=await boundAdmission(),g=await f.grant();
    const proof={action:'no_dispatch',protocolVersion:1,flowRunId:f.admitted.id,artifactHash:f.artifact.queryHash,
      discoverRequestId:f.grantCommand.discoverRequestId,executionAttemptId:f.grantCommand.executionAttemptId,
      cancellationId:randomUUID(),cancelledAt:new Date().toISOString()};
    const cancel=()=>one('SELECT flow_sourcing_cancel($1,$2,$3) result',[org,f.admitted.id,proof]);
    expect(await cancel()).toMatchObject({state:'cancelled_no_dispatch',released:true,replayed:false});
    expect(await cancel()).toMatchObject({released:true,replayed:true});
    expect((await db.query('SELECT reserved,captured FROM sourcing_allowance_windows')).rows).toEqual([{reserved:0,captured:0}]);
    expect((await db.query("SELECT count(*)::integer n FROM sourcing_account_events WHERE kind='release'")).rows[0].n).toBe(1);
    expect((await db.query('SELECT state FROM sourcing_execution_grants WHERE id=$1',[g.grantId])).rows[0].state).toBe('no_dispatch');
    expect(await one('SELECT flow_sourcing_preview_request($1,$2,$3,NULL,$4) result',[org,95201,actor,{action:'read'}])).toMatchObject({admissionState:'cancelled_no_dispatch',canAdmit:true});
    const next=await admit(await quote());
    expect(await one('SELECT flow_sourcing_preview_request($1,$2,$3,NULL,$4) result',[org,95201,actor,{action:'read'}])).toMatchObject({canAdmit:false});
    expect(next.id).not.toBe(f.admitted.id);
    expect((await db.query('SELECT count(*)::int n FROM sourcing_admissions')).rows[0].n).toBe(2);
    expect((await db.query('SELECT reserved,captured FROM sourcing_allowance_windows')).rows).toEqual([{reserved:1,captured:0}]);
    await db.query('SAVEPOINT cancelled_grant');
    await expect(f.grant()).rejects.toThrow('SOURCING_INVALID_COMMAND');
    await db.query('ROLLBACK TO SAVEPOINT cancelled_grant');
    await expect(one('SELECT flow_sourcing_receipt($1,$2,$3) result',[org,f.admitted.id,f.receipt(g,'started')])).rejects.toThrow('SOURCING_INVALID_RECEIPT');
  });
  const cancellation=(f:Awaited<ReturnType<typeof boundAdmission>>)=>({action:'no_dispatch',protocolVersion:1,
    flowRunId:f.admitted.id,artifactHash:f.artifact.queryHash,discoverRequestId:f.grantCommand.discoverRequestId,
    executionAttemptId:f.grantCommand.executionAttemptId,cancellationId:randomUUID(),cancelledAt:new Date().toISOString()});
  it.each(['started','uncertain','receipt','capture'])('refuses cancellation after independent possible-purchase evidence: %s',async kind=>{
    const f=await boundAdmission(),grant=await f.grant();
    if(kind==='capture')await db.query("INSERT INTO sourcing_account_events(id,organization_id,admission_id,kind,evidence_sha256) VALUES($1,$2,$3,'capture',$4)",[randomUUID(),org,f.admitted.id,hash]);
    else if(kind==='receipt')await db.query("UPDATE sourcing_execution_grants SET receipt=$2 WHERE id=$1",[grant.grantId,f.receipt(grant,'started')]);
    else await db.query('UPDATE sourcing_execution_grants SET state=$2 WHERE id=$1',[grant.grantId,kind]);
    const census=()=>db.query(`SELECT (SELECT row_to_json(a) FROM sourcing_admissions a WHERE id=$1) admission,
      (SELECT json_agg(w) FROM sourcing_allowance_windows w) windows,
      (SELECT count(*)::int FROM sourcing_account_events WHERE kind='release') releases`,[f.admitted.id]);
    const before=(await census()).rows;await db.query('SAVEPOINT refused_cancel');
    await expect(one('SELECT flow_sourcing_cancel($1,$2,$3) result',[org,f.admitted.id,cancellation(f)]))
      .rejects.toMatchObject({code:'P0001',message:'SOURCING_INVALID_RECEIPT'});
    await db.query('ROLLBACK TO SAVEPOINT refused_cancel');expect((await census()).rows).toEqual(before);
  });
  it.each(['artifactHash','discoverRequestId','executionAttemptId','flowRunId'])('refuses mismatched cancellation %s without refund',async field=>{
    const f=await boundAdmission();await f.grant();
    await db.query('SAVEPOINT mismatch');
    await expect(one('SELECT flow_sourcing_cancel($1,$2,$3) result',[org,f.admitted.id,{...cancellation(f),[field]:field==='artifactHash'?'0'.repeat(64):randomUUID()}]))
      .rejects.toMatchObject({code:'P0001',message:'SOURCING_INVALID_RECEIPT'});
    await db.query('ROLLBACK TO SAVEPOINT mismatch');
    expect((await db.query('SELECT reserved,captured FROM sourcing_allowance_windows')).rows).toEqual([{reserved:1,captured:0}]);
  });
  it('refuses cancellation replay with a different payload and never refunds twice',async()=>{
    const f=await boundAdmission(),proof=cancellation(f);await f.grant();
    await one('SELECT flow_sourcing_cancel($1,$2,$3) result',[org,f.admitted.id,proof]);
    await db.query('SAVEPOINT replay');
    await expect(one('SELECT flow_sourcing_cancel($1,$2,$3) result',[org,f.admitted.id,{...proof,cancellationId:randomUUID()}]))
      .rejects.toMatchObject({code:'P0001',message:'SOURCING_REQUEST_CONFLICT'});
    await db.query('ROLLBACK TO SAVEPOINT replay');
    expect((await db.query("SELECT count(*)::int n FROM sourcing_account_events WHERE kind='release'")).rows[0].n).toBe(1);
  });
  it('binds immutable delivered order and preserves a recruiter decision on replay',async()=>{
    const f=await boundAdmission(true,true),grant=await f.grant();
    await one('SELECT flow_sourcing_receipt($1,$2,$3) result',[org,f.admitted.id,f.receipt(grant,'started')]);
    const candidate=(await db.query("INSERT INTO job_sourced_candidates(organization_id,job_id,request_id,signal_candidate_id,source_type) VALUES($1,95201,$2,'delivery-person','discovered') RETURNING id",[org,f.grantCommand.discoverRequestId])).rows[0].id;
    const command={requestId:f.grantCommand.discoverRequestId,executionAttemptId:f.grantCommand.executionAttemptId,
      artifactHash:f.artifact.queryHash,revision:1,orderedSignalIds:['delivery-person']};
    const deliver=(body=command)=>one('SELECT flow_sourcing_deliver($1,$2,$3) result',[org,f.admitted.id,body]);
    expect(await deliver()).toMatchObject({revision:1,replayed:false});
    await db.query("UPDATE job_sourcing_runs SET status='completed' WHERE sourcing_admission_id=$1",[f.admitted.id]);
    await one('SELECT flow_sourcing_decide($1,$2,$3,$4,$5,$6) result',[org,95201,actor,candidate,randomUUID(),{action:'pass',expectedRevision:0}]);
    expect(await deliver()).toMatchObject({revision:1,replayed:true});
    expect((await db.query('SELECT state,decision_revision FROM job_sourced_candidates WHERE id=$1',[candidate])).rows[0]).toEqual({state:'passed',decision_revision:'1'});
    expect((await db.query('SELECT ordinal,signal_candidate_id FROM sourcing_delivery_items')).rows).toEqual([{ordinal:1,signal_candidate_id:'delivery-person'}]);
    await db.query('SAVEPOINT changed_delivery');
    await expect(deliver({...command,orderedSignalIds:[]})).rejects.toThrow('SOURCING_REQUEST_CONFLICT');
    await db.query('ROLLBACK TO SAVEPOINT changed_delivery');
    expect(await deliver({...command,revision:2,orderedSignalIds:[]})).toMatchObject({revision:2,replayed:false});
    await db.query('SAVEPOINT superseded_delivery');
    await expect(deliver()).rejects.toThrow('SOURCING_REVISION_CONFLICT');
    await db.query('ROLLBACK TO SAVEPOINT superseded_delivery');
    expect((await db.query('SELECT count(*)::integer n FROM sourcing_account_events WHERE kind=\'capture\'')).rows[0].n).toBe(1);
  });
  it('approval preparation schedules once; one failed attempt can be retried only once', async () => {
    const request = randomUUID();
    const claim = (action: string, req = request) => one('SELECT flow_sourcing_digest_claim($1,$2,$3,$4,$5) result', [org,95201,actor,req,{action,model:'fixture-model'}]);
    const scheduled = await claim('schedule');
    expect(scheduled.state).toBe('reserved');
    expect((await claim('schedule')).id).toBe(scheduled.id);
    const first = await claim('start');
    expect(first.lease).toBeTruthy();
    expect((await claim('start')).lease).toBeUndefined();
    expect(await one('SELECT flow_sourcing_digest_finish($1,$2,$3) result', [first.id,first.lease,{state:'failed',code:'SOURCING_DIGEST_INVALID'}])).toMatchObject({state:'failed'});
    const retry = randomUUID();
    expect(await claim('retry',retry)).toMatchObject({state:'reserved'});
    expect(await claim('retry',retry)).toMatchObject({replayed:true});
    const second = await claim('start');
    await one('SELECT flow_sourcing_digest_finish($1,$2,$3) result', [second.id,second.lease,{state:'failed',code:'SOURCING_DIGEST_INVALID'}]);
    await expect(claim('retry',randomUUID())).rejects.toThrow('SOURCING_DIGEST_RETRY_REFUSED');
  });
  it('an uncertain model outcome never permits another paid attempt', async () => {
    const request = randomUUID();
    const call = (action: string) => one('SELECT flow_sourcing_digest_claim($1,$2,$3,$4,$5) result',[org,95201,actor,request,{action,model:'fixture-model'}]);
    await call('schedule'); const claim = await call('start');
    await one('SELECT flow_sourcing_digest_finish($1,$2,$3) result',[claim.id,claim.lease,{state:'unknown',code:'SOURCING_DIGEST_UNKNOWN'}]);
    await expect(call('retry')).rejects.toThrow('SOURCING_DIGEST_RETRY_REFUSED');
  });
  it('a browser retry cannot schedule preparation against a different approved brief',async()=>{
    const request=randomUUID();
    await one('SELECT flow_sourcing_digest_claim($1,$2,$3,$4,$5) result',[org,95201,actor,request,{action:'schedule',model:'fixture-model'}]);
    await expect(one('SELECT flow_sourcing_digest_claim($1,$2,$3,$4,$5) result',
      [org,95201,actor,randomUUID(),{action:'retry',model:'fixture-model',briefVersionId:randomUUID()}])).rejects.toThrow('SOURCING_QUERY_STALE');
  });
  it('recovers a completed model result and atomically creates its artifact and preview', async () => {
    const request=randomUUID();
    await one('SELECT flow_sourcing_digest_claim($1,$2,$3,$4,$5) result',[org,95201,actor,request,{action:'schedule',model:'fixture-model'}]);
    const work=await one('SELECT flow_sourcing_digest_next($1) result',[randomUUID()]);
    expect(work.input.requestId).toBe(request);expect(work.claim.lease).toBeTruthy();
    const basis=sourcingBasisSchema.parse(work.claim.basis);
    expect(digestBasisHash(basis)).toBe(work.claim.basisHash);
    const digest={version:3,topSkills:['Python'],seniorityLevel:'senior',domain:'Software',constraints:[],
      keyResponsibilities:[],titleSearchTerms:['Backend Engineer'],adjacentBuckets:[],adjacentLocations:[],tokenCount:50};
    await one('SELECT flow_sourcing_digest_finish($1,$2,$3) result',[request,work.claim.lease,{state:'succeeded',digest,inputTokens:80,outputTokens:50}]);
    // Simulate process death before artifact persistence: next work returns the
    // recorded digest without a fresh model lease or another paid attempt.
    const recovered=await one('SELECT flow_sourcing_digest_next($1) result',[randomUUID()]);
    expect(recovered.claim).toMatchObject({state:'succeeded',result:{digest}});expect(recovered.claim.lease).toBeUndefined();
    const artifact=compileSourcingQuery(recovered.claim.basis,recovered.claim.result.digest,recovered.claim.basisHash);
    const put=()=>one('SELECT flow_sourcing_artifact_put($1,$2,$3,$4,$5) result',[org,95201,actor,artifact.briefVersionId,artifact]);
    const stored=await put();expect(await put()).toEqual(stored);
    expect((await db.query('SELECT count(*)::integer n FROM sourcing_count_previews WHERE artifact_id=$1',[stored.id])).rows[0].n).toBe(1);
    expect((await db.query('SELECT attempt_count FROM sourcing_digest_requests WHERE id=$1',[request])).rows[0].attempt_count).toBe(1);
    expect(await one('SELECT flow_sourcing_digest_next($1) result',[randomUUID()])).toBeNull();
    const read=()=>one('SELECT flow_sourcing_preview_request($1,$2,$3,NULL,$4) result',[org,95201,actor,{action:'read'}]);
    expect(await read()).toMatchObject({artifactId:stored.id,state:'pending',preparation:'succeeded'});
    // A later unapproved brief must not show an older search's market count.
    const current=await one('SELECT flow_job_brief_read($1,$2,$3) result',[org,95201,actor]);
    await one('SELECT flow_job_brief_save($1,$2,$3,$4,$5,$6) result',[org,95201,actor,randomUUID(),current.revision,{
      action:'save_brief',currentJD:basis.sourceJD,sourceChoice:'original_prose',requesterKind:'recruiter',reasonCode:'other',payload:basis.payload,
    }]);
    expect(await read()).toMatchObject({artifactId:null,state:'unavailable',count:null});
    expect((await db.query('SELECT count(*)::integer n FROM sourcing_count_previews')).rows[0].n).toBe(1);
  });
  it('decisions append history and idempotently maintain current state', async () => {
    await db.query("INSERT INTO job_sourcing_runs(organization_id,job_id,request_id,external_job_id,status,context_hash) VALUES($1,95201,'legacy','vanta:jobs:95201','completed',$2)",[org,hash]);
    const candidate=(await db.query("INSERT INTO job_sourced_candidates(organization_id,job_id,request_id,signal_candidate_id,source_type) VALUES($1,95201,'legacy','fixture-candidate','discovered') RETURNING id",[org])).rows[0].id;
    const request=randomUUID(), command={action:'pass',expectedRevision:0,reasonCode:'skills_gap'};
    const decide=()=>one('SELECT flow_sourcing_decide($1,$2,$3,$4,$5,$6) result',[org,95201,actor,candidate,request,command]);
    expect(await decide()).toMatchObject({state:'passed',revision:1,replayed:false});
    expect(await decide()).toMatchObject({state:'passed',revision:1,replayed:true});
    expect((await db.query('SELECT count(*)::integer n FROM sourcing_decision_events')).rows[0].n).toBe(1);
    expect(await one('SELECT flow_sourcing_decide($1,$2,$3,$4,$5,$6) result',[org,95201,actor,candidate,randomUUID(),{action:'clear',expectedRevision:1}])).toMatchObject({state:'new',revision:2});
    expect((await db.query('SELECT count(*)::integer n FROM sourcing_decision_events')).rows[0].n).toBe(2);
  });
  it('rechecks recruiter scope even for decision replay, with no second event',async()=>{
    const c=await legacyCandidate();
    const request=randomUUID(),body={action:'pass',expectedRevision:0};
    const call=()=>one('SELECT flow_sourcing_decide($1,95201,$2,$3,$4,$5) result',[org,peer,c,request,body]);
    expect(await call()).toMatchObject({state:'passed',revision:1});
    await db.query('DELETE FROM job_recruiters WHERE job_id=95201 AND recruiter_id=$1',[peer]);
    expect(await call()).toBeNull();
    expect((await db.query('SELECT count(*)::integer n FROM sourcing_decision_events')).rows[0].n).toBe(1);
  });
  it.each([
    ['free text',{action:'pass',expectedRevision:0,note:'invented reason'}],
    ['unknown reason',{action:'pass',expectedRevision:0,reasonCode:'culture_fit'}],
    ['clear with reason',{action:'clear',expectedRevision:0,reasonCode:'other'}],
    ['unbound criterion',{action:'pass',expectedRevision:0,reasonCode:'skills_gap',criterionId:randomUUID()}],
  ])('refuses invalid decision payload: %s',async(_label,body)=>{
    const c=await legacyCandidate();
    await expect(one('SELECT flow_sourcing_decide($1,95201,$2,$3,$4,$5) result',[org,actor,c,randomUUID(),body])).rejects.toThrow('SOURCING_INVALID_COMMAND');
  });
  it('converted candidates cannot be passed or cleared back into sourcing',async()=>{
    const c=await legacyCandidate('converted');
    await expect(one('SELECT flow_sourcing_decide($1,95201,$2,$3,$4,$5) result',[org,actor,c,randomUUID(),{action:'pass',expectedRevision:0}])).rejects.toThrow('SOURCING_CONVERTED');
  });
  it.each(['unleased','expired','leased','resolved'])('Pass preserves owned contact work and cancels only eligible pending work: %s',async(kind)=>{
    const c=await legacyCandidate('shortlisted'),lease=randomUUID();
    await db.query(`UPDATE job_sourced_candidates SET email_resolve_status=$2,found_email='owned@sourcing.invalid',
      found_emails='["owned@sourcing.invalid"]'::jsonb,email_resolve_attempts=1,
      email_resolve_lease_token=$3,email_resolve_lease_expires_at=CASE WHEN $4='expired' THEN clock_timestamp()-interval '1 minute'
        WHEN $4='leased' THEN clock_timestamp()+interval '1 minute' ELSE NULL END WHERE id=$1`,
    [c,kind==='resolved'?'resolved':'pending',['leased','expired'].includes(kind)?lease:null,kind]);
    expect(await one('SELECT flow_sourcing_decide($1,95201,$2,$3,$4,$5) result',
      [org,actor,c,randomUUID(),{action:'pass',expectedRevision:0}])).toMatchObject({state:'passed',revision:1});
    const kept=kind==='leased'||kind==='resolved';
    expect((await db.query('SELECT email_resolve_status,found_email,email_resolve_lease_token FROM job_sourced_candidates WHERE id=$1',[c])).rows[0])
      .toEqual({email_resolve_status:kept?(kind==='resolved'?'resolved':'pending'):null,
        found_email:kept?'owned@sourcing.invalid':null,email_resolve_lease_token:kind==='leased'?lease:null});
    expect((await db.query('SELECT count(*)::integer n FROM sourcing_decision_events')).rows[0].n).toBe(1);
  });
  it('cannot reuse a decision request to change the action',async()=>{
    const c=await legacyCandidate(),request=randomUUID();
    await one('SELECT flow_sourcing_decide($1,95201,$2,$3,$4,$5) result',[org,actor,c,request,{action:'pass',expectedRevision:0}]);
    await expect(one('SELECT flow_sourcing_decide($1,95201,$2,$3,$4,$5) result',
      [org,actor,c,request,{action:'shortlist',expectedRevision:1}])).rejects.toThrow('SOURCING_REQUEST_CONFLICT');
  });
  it.each(['withdraw_global_matching','request_erasure'])('privacy blocks new decisions and old request replay: %s',async(action)=>{
    const c=await legacyCandidate(),request=randomUUID(),privacy=randomUUID();
    const call=(id:string,body:unknown)=>one('SELECT flow_sourcing_decide($1,95201,$2,$3,$4,$5) result',[org,actor,c,id,body]);
    const body={action:'pass',expectedRevision:0};
    expect(await call(request,body)).toMatchObject({state:'passed',revision:1});
    await db.query(`INSERT INTO candidate_privacy_requests(request_id,action,authority_type,actor_user_id,reason_code)
      VALUES($1,$2,'privacy_operator',$3,'verified_support_request')`,[privacy,action,actor]);
    await db.query(`INSERT INTO candidate_privacy_subject_links(link_id,request_id,subject_type,job_sourced_candidate_id,organization_id)
      VALUES($1,$2,'job_sourced_candidate',$3,$4)`,[randomUUID(),privacy,c,org]);
    expect(await call(request,body)).toBeNull();
    expect(await call(randomUUID(),{action:'shortlist',expectedRevision:1})).toBeNull();
    expect((await db.query('SELECT state,decision_revision FROM job_sourced_candidates WHERE id=$1',[c])).rows[0])
      .toEqual({state:'passed',decision_revision:'1'});
    expect((await db.query('SELECT count(*)::integer n FROM sourcing_decision_events')).rows[0].n).toBe(1);
  });
});
