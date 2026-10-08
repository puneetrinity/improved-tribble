import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sourceHash } from '../../job-brief/contracts';
import {sourcingHash} from '../contracts';
import {compileSourcingQuery,digestBasisHash,sourcingBasisSchema,validateProviderGrant} from '../compiler';
import {createRankingContract,rankingContractSchema} from '../ranking-contract';

const enabled = process.env.FLOW_SOURCING_DISPOSABLE === '1';
const url = process.env.FLOW_SOURCING_OWNER_URL ?? '';
const hash = sourceHash('fixture');
const org = 95101, actor = 95101, peer = 95102;

describe.skipIf(!enabled)('rubric ranking Flow admission and delivery on real PostgreSQL', () => {
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


  async function refusal(action:()=>Promise<unknown>,message:string){
    await db.query('SAVEPOINT refused');
    await expect(action()).rejects.toThrow(message);
    await db.query('ROLLBACK TO SAVEPOINT refused');
  }
  function rangePayload(){return {schemaVersion:2,compilerVersion:2,taxonomyVersion:2,criteria:[
    {id:randomUUID(),label:'Role',class:'preferred',subject:'title',requirement:{kind:'accepted_titles',values:['Backend Engineer','Backend Developer']},
      use:'assessment',evidenceKinds:['profile_evidence'],provenance:{kind:'recruiter_edit'}},
    {id:randomUUID(),label:'Experience',class:'must_have',subject:'experience_years',requirement:{kind:'experience_range',minimum:6,maximum:10},
      use:'assessment',evidenceKinds:['profile_evidence'],provenance:{kind:'recruiter_edit'}},
  ]};}
  async function savePayload(payload:unknown,request=randomUUID()){
    return one('SELECT flow_job_brief_save($1,$2,$3,$4,2,$5) result',[org,95201,actor,request,{
      action:'save_brief',currentJD:'Build Python services.',sourceChoice:'original_prose',requesterKind:'recruiter',reasonCode:'other',payload}]);
  }
  it('saves range/title schema2 immutably, invalidates approval and replays without another version',async()=>{
    const payload=rangePayload(),request=randomUUID(),saved=await savePayload(payload,request);
    expect(await savePayload(payload,request)).toEqual(saved);
    const version=(await db.query('SELECT schema_version,compiler_version,taxonomy_version,payload FROM job_brief_versions WHERE version_id=$1',[saved.versionId])).rows[0];
    expect(version).toMatchObject({schema_version:2,compiler_version:2,taxonomy_version:2,payload});
    expect(await one('SELECT approved_version_id result FROM job_brief_state WHERE job_id=95201')).toBeNull();
    await refusal(()=>quote(),'SOURCING_QUERY_STALE');
  });
  it.each(['maximum_only','reversed_range','negative','too_large','string_maximum','duplicate_title','too_many_titles','empty_titles',
    'protected_title','protected_note','duplicate_range','retrieval_range','mixed_version','historical_new_save'])('SQL refuses %s without mutating approval',async variant=>{
    const payload:any=rangePayload();
    const title=payload.criteria[0],years=payload.criteria[1];
    if(variant==='maximum_only')delete years.requirement.minimum;
    if(variant==='reversed_range')years.requirement.minimum=11;
    if(variant==='negative')years.requirement.minimum=-1;
    if(variant==='too_large')years.requirement.maximum=81;
    if(variant==='string_maximum')years.requirement.maximum='10';
    if(variant==='duplicate_title')title.requirement.values=['Backend Engineer',' backend engineer '];
    if(variant==='too_many_titles')title.requirement.values=Array.from({length:21},(_,i)=>'Role '+i);
    if(variant==='empty_titles')title.requirement.values=[];
    if(variant==='protected_title')title.requirement.values=['Unmarried only'];
    if(variant==='protected_note')years.note='Age limit 30';
    if(variant==='duplicate_range')payload.criteria.push({...years,id:randomUUID()});
    if(variant==='retrieval_range')years.use='both';
    if(variant==='mixed_version')payload.compilerVersion=1;
    if(variant==='historical_new_save')payload.schemaVersion=payload.compilerVersion=payload.taxonomyVersion=1;
    const before=await one('SELECT approved_version_id result FROM job_brief_state WHERE job_id=95201');
    await refusal(()=>savePayload(payload),'BRIEF_INVALID_PAYLOAD');
    expect(await one('SELECT approved_version_id result FROM job_brief_state WHERE job_id=95201')).toBe(before);
  });
  it('binds the SQL-produced ranking contract identically to TypeScript',async()=>{
    const admitted=await admit(await quote());
    const stored=await one('SELECT ranking_contract result FROM sourcing_admissions WHERE id=$1',[admitted.id]);
    expect(rankingContractSchema.parse(stored)).toEqual(stored);
    expect(createRankingContract(stored.briefVersionId,stored.materialHash,stored.payload)).toEqual(stored);
    const dispatch=await one('SELECT flow_sourcing_dispatch_claim($1) result',[randomUUID()]);
    expect(dispatch.command.protocolVersion).toBe(2);
    expect(dispatch.command.rankingContract).toEqual(stored);
    await refusal(()=>db.query("UPDATE sourcing_admissions SET ranking_contract=NULL WHERE id=$1",[admitted.id]),'SOURCING_RANKING_IMMUTABLE');
  });
  it('uses the same canonical bytes for fractional experience and Unicode labels before admission',async()=>{
    const payload=rangePayload();
    payload.criteria[1].requirement={kind:'experience_range',minimum:1e-7,maximum:10};
    payload.criteria[0].label='Backend 工程';
    const saved=await savePayload(payload);
    await one('SELECT flow_job_brief_approve($1,$2,$3,$4,3,$5,$6) result',[org,95201,actor,randomUUID(),saved.versionId,hash]);
    await db.query(`INSERT INTO sourcing_query_artifacts(id,organization_id,job_id,brief_version_id,material_hash,compiler_version,query_hash,input)
      SELECT $1,organization_id,job_id,approved_version_id,approved_material_hash,'1',$2,'{}'::jsonb FROM job_brief_state WHERE job_id=95201`,[randomUUID(),hash]);
    const admitted=await admit(await quote());
    expect(rankingContractSchema.parse(admitted.rankingContract)).toEqual(admitted.rankingContract);
    expect(admitted.rankingContract.projectionText).toContain('0.0000001');
  });
  it('refuses preparation of an old approved brief before reserving any model attempt',async()=>{
    const replace=(file:string,name:string)=>{
      const source=readFileSync(resolve('server/schema-migrations',file),'utf8');
      const definition=source.match(new RegExp(`CREATE(?: OR REPLACE)? FUNCTION public\\.${name}\\([\\s\\S]*?REVOKE ALL ON FUNCTION public\\.${name}\\([^;]*;`))?.[0];
      if(!definition)throw Error('Missing historical function fixture');
      return definition.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION');
    };
    for(const name of ['flow_job_brief_save','flow_job_brief_approve'])await db.query(replace('0014_job_brief_authority.sql',name));
    const payload={schemaVersion:1,compilerVersion:1,taxonomyVersion:1,criteria:[{
      id:randomUUID(),label:'Python',class:'must_have',subject:'skill',requirement:{kind:'text',value:'Python'},
      use:'assessment',evidenceKinds:['profile_evidence'],provenance:{kind:'recruiter_edit'}}]};
    const saved=await savePayload(payload);
    await one('SELECT flow_job_brief_approve($1,$2,$3,$4,3,$5,$6) result',[org,95201,actor,randomUUID(),saved.versionId,hash]);
    for(const name of ['flow_job_brief_save','flow_job_brief_approve'])await db.query(replace('0016_rubric_ranking.sql',name));
    const before=await one('SELECT count(*)::integer result FROM sourcing_digest_requests');
    await refusal(()=>one('SELECT flow_sourcing_digest_claim($1,$2,$3,$4,$5) result',[org,95201,actor,randomUUID(),{action:'retry',model:'fixture-model'}]),'SOURCING_UPDATED_BRIEF_REQUIRED');
    expect(await one('SELECT count(*)::integer result FROM sourcing_digest_requests')).toBe(before);
  });
  it('requires the admitted contract and one immutable delivery revision',async()=>{
    const f=await boundAdmission(),g=await f.grant();
    await one('SELECT flow_sourcing_receipt($1,$2,$3) result',[org,f.admitted.id,f.receipt(g,'started')]);
    const binding=await one('SELECT flow_sourcing_run_binding($1,$2,$3) result',[org,95201,f.grantCommand.discoverRequestId]);
    expect(binding).toMatchObject({protocolVersion:2,flowRunId:f.admitted.id});
    // A withheld first identity must not cause the remaining card to be renumbered.
    await db.query("INSERT INTO job_sourced_candidates(organization_id,job_id,request_id,signal_candidate_id,source_type) VALUES($1,95201,$2,'visible','discovered')",[org,f.grantCommand.discoverRequestId]);
    const command={requestId:f.grantCommand.discoverRequestId,executionAttemptId:f.grantCommand.executionAttemptId,
      artifactHash:f.artifact.queryHash,revision:1,orderedSignalIds:['visible'],
      rankingRevision:randomUUID(),rankingHash:hash,contractHash:binding.contractHash};
    const assessment={candidateId:'visible',ordinal:2,revisionId:command.rankingRevision,outputHash:hash,contractHash:binding.contractHash};
    await db.query("UPDATE job_sourced_candidates SET candidate_summary=$1 WHERE signal_candidate_id='visible'",[{ranking:assessment}]);
    const deliver=(body:unknown=command)=>one('SELECT flow_sourcing_deliver($1,$2,$3) result',[org,f.admitted.id,body]);
    const {rankingRevision:unused,...missing}=command;
    await refusal(()=>deliver(missing),'SOURCING_RANKING_CONFLICT');
    await refusal(()=>deliver({...command,contractHash:'f'.repeat(64)}),'SOURCING_RANKING_CONFLICT');
    expect(await deliver()).toMatchObject({revision:1,replayed:false});
    expect(await deliver()).toMatchObject({revision:1,replayed:true});
    expect((await db.query('SELECT ordinal,signal_candidate_id FROM sourcing_delivery_items')).rows).toEqual([{ordinal:2,signal_candidate_id:'visible'}]);
    await refusal(()=>deliver({...command,revision:2}),'SOURCING_RANKING_CONFLICT');
    await refusal(()=>deliver({...command,rankingHash:'b'.repeat(64)}),'SOURCING_RANKING_CONFLICT');
    await refusal(()=>deliver({...command,orderedSignalIds:['visible','withheld']}),'SOURCING_RANKING_CONFLICT');
    expect(await deliver({...command,orderedSignalIds:[]})).toMatchObject({replayed:true});
    const durable=await one('SELECT flow_sourcing_run_binding($1,$2,$3) result',[org,95201,f.grantCommand.discoverRequestId]);
    expect(durable.delivery).toMatchObject({revisionId:command.rankingRevision,outputHash:hash,items:[{candidateId:'visible',ordinal:2}]});
    await db.query("UPDATE job_sourced_candidates SET candidate_summary=$1 WHERE signal_candidate_id='visible'",[{ranking:{...assessment,ordinal:1}}]);
    await refusal(()=>deliver(),'SOURCING_RANKING_CONFLICT');
    expect(await one('SELECT count(*)::integer result FROM sourcing_deliveries')).toBe(1);
  });
  it('repairs missing preparation without treating the initial attempt as a retry',async()=>{
    const request=randomUUID();
    const call=(action:string,id=request)=>one('SELECT flow_sourcing_digest_claim($1,$2,$3,$4,$5) result',[org,95201,actor,id,{action,model:'fixture-model'}]);
    expect(await call('retry')).toMatchObject({state:'reserved',attempts:0});
    const start=await call('start');
    expect(start.state).toBe('started');
    await one('SELECT flow_sourcing_digest_finish($1,$2,$3) result',[start.id,start.lease,{state:'failed',code:'SOURCING_DIGEST_UNAUTHORIZED'}]);
    const retry=randomUUID();expect(await call('retry',retry)).toMatchObject({state:'reserved',attempts:1});
    const second=await call('start',retry);
    await one('SELECT flow_sourcing_digest_finish($1,$2,$3) result',[second.id,second.lease,{state:'failed',code:'SOURCING_DIGEST_RATE_LIMITED'}]);
    await refusal(()=>call('retry',randomUUID()),'SOURCING_DIGEST_RETRY_REFUSED');
  });
  it('settles an in-flight prompt1 draft as stale without accepting it or leaving it dispatched',async()=>{
    const definition=(file:string)=>{
      const source=readFileSync(resolve('server/schema-migrations',file),'utf8');
      const sql=source.match(/CREATE(?: OR REPLACE)? FUNCTION public\.flow_job_brief_draft_claim\([\s\S]*?REVOKE ALL ON FUNCTION public\.flow_job_brief_draft_claim\([^;]*;/)?.[0];
      if(!sql)throw Error('Missing draft claim fixture');
      return sql.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION');
    };
    await db.query(definition('0014_job_brief_authority.sql'));
    const request=randomUUID(),claim=await one('SELECT flow_job_brief_draft_claim($1,$2,$3,$4,2,$5,$6,$7) result',
      [org,95201,actor,request,sourceHash('Build Python services.'),'fixture-model',hash]);
    await db.query(definition('0016_rubric_ranking.sql'));
    const finished=await one('SELECT flow_job_brief_draft_finish($1,$2,$3) result',
      [request,claim.lease,{state:'succeeded',result:{schemaVersion:1},inputTokens:1,outputTokens:1}]);
    expect(finished).toMatchObject({state:'stale',code:'BRIEF_UPDATED_APPROVAL_REQUIRED',result:null});
    expect(await one('SELECT lease_token result FROM job_brief_draft_requests WHERE request_id=$1',[request])).toBeNull();
  });
});
