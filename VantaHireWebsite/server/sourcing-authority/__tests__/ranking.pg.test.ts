import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sourceHash } from '../../job-brief/contracts';
import {sourcingHash} from '../contracts';
import {compileSourcingQuery,digestBasisHash,sourcingBasisSchema,validateProviderGrant} from '../compiler';
import {createRankingContract,rankingContractSchema} from '../ranking-contract';
// Approval requires experience and location (brief foundations, migration 0018).
const FOUNDATIONS = () => [
  { id: randomUUID(), label: 'Experience', class: 'must_have', subject: 'experience_years', requirement: { kind: 'minimum_years', minimum: 3 },
    use: 'assessment', evidenceKinds: ['profile_evidence'], provenance: { kind: 'recruiter_edit' } },
  { id: randomUUID(), label: 'Location', class: 'must_have', subject: 'location', requirement: { kind: 'text', value: 'Bengaluru' },
    use: 'assessment', evidenceKinds: ['profile_evidence'], provenance: { kind: 'recruiter_edit' } },
];


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
      payload: { schemaVersion: 3, compilerVersion: 3, taxonomyVersion: 3, criteria: [{
        id: randomUUID(), label: 'Python', class: 'must_have', subject: 'skill', requirement: { kind: 'accepted_skills', primary: 'Python', alternatives: [] },
        use: 'assessment', evidenceKinds: ['profile_evidence'], provenance: { kind: 'recruiter_edit' },
      }, ...FOUNDATIONS()] },
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
        experienceYears:artifact.jobContext.experienceYears??null,experienceYearsMax:null,education:null,titleSearchTerms:['backend engineer'],adjacentBuckets:[['platform engineer']],adjacentLocations:[]}}};
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
  it('binds applicant eligibility to the exact tenant, request and execution without returning applicant data',async()=>{
    const f=await boundAdmission();
    const identity={candidateId:randomUUID(),referenceId:randomUUID(),applicationId:123,applicationJobId:188,
      resumeVersionId:randomUUID(),sourceId:randomUUID(),generationId:randomUUID(),sourceHash:'a'.repeat(64)};
    const body={version:1,flowRunId:f.admitted.id,revisionId:randomUUID(),
      requestId:f.grantCommand.discoverRequestId,externalJobId:95201,items:[{key:'one',identity}]};
    const call=(tenant='sourcing-fixture-tenant',execution=f.grantCommand.executionAttemptId,value=body)=>
      one('SELECT flow_sourcing_candidate_eligibility($1,$2,$3,$4::jsonb,$5) result',
        [tenant,f.admitted.id,execution,value,'b'.repeat(64)]);
    expect(await call()).toMatchObject({version:1,bodyHash:'b'.repeat(64),results:[{key:'one',decision:'not_found'}]});
    await refusal(()=>call('another-tenant'),'SOURCING_CANDIDATE_BINDING');
    await refusal(()=>call('sourcing-fixture-tenant',randomUUID()),'SOURCING_CANDIDATE_BINDING');
    await refusal(()=>call('sourcing-fixture-tenant',f.grantCommand.executionAttemptId,{...body,externalJobId:95202}),
      'SOURCING_CANDIDATE_BINDING');
    await refusal(()=>call('sourcing-fixture-tenant',f.grantCommand.executionAttemptId,{...body,requestId:randomUUID()}),
      'SOURCING_CANDIDATE_BINDING');
  });
  it('allows an acknowledged past application, then excludes a same-job application and stale privacy',async()=>{
    const f=await boundAdmission();
    await job(95202);
    const crossPath=process.env.RESUME_XS_FIXTURE;
    if(crossPath&&!/^\/tmp\/resume-xs-[a-z0-9-]+\.json$/.test(crossPath))throw Error('SYNTHETIC_FIXTURE_REQUIRED');
    const transcript=crossPath?JSON.parse(readFileSync(crossPath,'utf8')):null;
    if(transcript){expect(transcript.synthetic).toBe(true);expect(transcript.scope).toBe(`org_${org}`);}
    const application=transcript?.response.results[0].identity.applicationId??95103;
    await db.query(`INSERT INTO applications(id,job_id,organization_id,user_id,name,email,phone,resume_url)
      VALUES($3,95202,$1,$2,'Synthetic applicant','synthetic@invalid.test','000','gs://test/resume')`,[org,peer,application]);
    const identity=transcript?.response.results[0].identity??{candidateId:randomUUID(),referenceId:randomUUID(),applicationId:application,applicationJobId:95202,
      resumeVersionId:randomUUID(),sourceId:randomUUID(),generationId:randomUUID(),sourceHash:'a'.repeat(64)};
    await db.query(`INSERT INTO organization_candidate_references(reference_id,organization_id,application_id,job_id,origin_code,schema_version,created_at)
      VALUES($1,$2,$3,95202,'candidate_applied',1,now())`,[identity.referenceId,org,application]);
    await db.query(`INSERT INTO application_resume_versions(resume_version_id,reference_id,organization_id,application_id,job_id,
      version,source_kind,source_observed_at,gcs_locator,content_sha256,byte_count,media_type,captured_at,created_at)
      VALUES($1,$2,$3,$4,95202,1,'direct_upload',now(),'gs://test/resume',$5,1,'application/pdf',now(),now())`,
      [identity.resumeVersionId,identity.referenceId,org,application,hash]);
    await db.query(`INSERT INTO organization_candidate_memory_outbox(outbox_id,reference_id,resume_version_id,organization_id,application_id,job_id,
      idempotency_key,state,next_attempt_at,memory_candidate_id,acknowledged_at,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,95202,$6,'acknowledged',now(),$7,now(),now(),now())`,
      [randomUUID(),identity.referenceId,identity.resumeVersionId,org,application,hash,identity.candidateId]);
    const outbox=await one('SELECT flow_capture_candidate_index_catchup($1,$2,$3) result',
      [org,identity.referenceId,identity.resumeVersionId]);
    await db.query(`INSERT INTO candidate_index_delivery_state(outbox_id,state,accepted_source_id,accepted_command_digest,accepted_at)
      VALUES($1,'accepted',$2,$3,now())`,[outbox,identity.sourceId,hash]);
    await db.query(`INSERT INTO candidate_privacy_sync_state(consumer_name,status,last_success_at)
      VALUES('flow','healthy',now()) ON CONFLICT(consumer_name) DO UPDATE SET status='healthy',last_success_at=now()`);
    const body={version:1,flowRunId:f.admitted.id,revisionId:randomUUID(),requestId:f.grantCommand.discoverRequestId,
      externalJobId:95201,items:[{key:'private',identity}]};
    const call=()=>one('SELECT flow_sourcing_candidate_eligibility($1,$2,$3,$4::jsonb,$5) result',
      ['sourcing-fixture-tenant',f.admitted.id,f.grantCommand.executionAttemptId,body,hash]);
    expect((await call()).results).toEqual([{key:'private',decision:'allow'}]);
    if(transcript){
      const root=process.env.RESUME_XS_DISCOVER_ROOT;
      if(root!=='/home/ews/wave5c-private-resume-discover')throw Error('EXPLICIT_LOCAL_PEER_REQUIRED');
      const {privateResumeHit}=await import(`${root}/src/lib/sourcing/private-resume-contracts.ts`);
      const {adaptPrivateResume}=await import(`${root}/src/lib/sourcing/rubric/private-resume-evidence.ts`);
      const {scoreEvidence}=await import(`${root}/src/lib/sourcing/rubric/score.ts`);
      const discoverContracts=await import(`${root}/src/lib/sourcing/rubric/contracts.ts`);
      const {parsePrivateOrigin}=await import('../candidate-origin');
      const {flattenCandidateForUI}=await import('../../lib/services/signal-contracts');
      const hit=privateResumeHit.parse(transcript.response.results[0]);
      const payload={schemaVersion:4,compilerVersion:4,taxonomyVersion:4,criteria:[
        {id:randomUUID(),label:'Python',class:'must_have',subject:'skill',
          requirement:{kind:'accepted_skills',primary:'Python',alternatives:[]},use:'assessment',
          evidenceKinds:['candidate_provided','profile_evidence'],provenance:{kind:'recruiter_edit'}},
        ...FOUNDATIONS().map(c=>({...c,evidenceKinds:['candidate_provided','profile_evidence']}))]};
      const contract=createRankingContract(randomUUID(),hash,payload);
      expect(discoverContracts.createRankingContract(contract.briefVersionId,hash,payload)).toEqual(contract);
      const evidence=adaptPrivateResume({candidateId:identity.candidateId,organizationRef:String(org),resume:hit});
      const scored=scoreEvidence(contract,evidence,'2026-10-18T00:00:00Z');
      expect(scored.N).toBe(6); // Python + dated experience; no invented location.
      expect(scored.D).toBe(9);
      const parsed=parsePrivateOrigin({candidateOrigin:{...identity,version:1,kind:'organization_candidate'}})!;
      const dto=flattenCandidateForUI({id:1,jobId:95201,signalCandidateId:identity.candidateId,
        fitScore:null,fitBreakdown:null,sourceType:'pool',state:'shortlisted',
        foundEmail:'must-not-leak@invalid.test',emailResolveStatus:'resolved',
        candidateSummary:{candidateOrigin:parsed.display,privateResumeIdentity:identity,
          linkedinUrl:'https://www.linkedin.com/in/must-not-leak'},lastSyncedAt:null,createdAt:null});
      expect(dto.candidateOrigin).toEqual(parsed.display);
      expect(JSON.stringify(dto)).not.toContain('must-not-leak');
      expect(JSON.stringify(dto)).not.toContain(identity.sourceHash);
      console.log('RESUME_CROSS_SYSTEM_PASS: signed Memory API -> Discover score 6/9 -> Flow eligibility/display; same-job and stale-privacy checks follow');
    }
    body.items[0].identity={...identity,sourceId:randomUUID()};
    expect((await call()).results).toEqual([{key:'private',decision:'not_found'}]);
    body.items[0].identity=identity;
    await db.query(`INSERT INTO applications(job_id,organization_id,user_id,name,email,phone,resume_url)
      VALUES(95201,$1,$2,'Same synthetic applicant','synthetic@invalid.test','000','gs://test/resume')`,[org,peer]);
    expect((await call()).results).toEqual([{key:'private',decision:'same_job'}]);
    await db.query("UPDATE candidate_privacy_sync_state SET last_success_at=now()-interval '5 minutes' WHERE consumer_name='flow'");
    expect((await call()).results).toEqual([{key:'private',decision:'unavailable'}]);
  });
  function rangePayload(){return {schemaVersion:3,compilerVersion:3,taxonomyVersion:3,criteria:[
    {id:randomUUID(),label:'Role',class:'preferred',subject:'title',requirement:{kind:'accepted_titles',values:['Backend Engineer','Backend Developer']},
      use:'assessment',evidenceKinds:['profile_evidence'],provenance:{kind:'recruiter_edit'}},
    {id:randomUUID(),label:'Experience',class:'must_have',subject:'experience_years',requirement:{kind:'experience_range',minimum:6,maximum:10},
      use:'assessment',evidenceKinds:['profile_evidence'],provenance:{kind:'recruiter_edit'}},
    // Approval requires a location as well (brief foundations, migration 0018). Appended so indexes above stay.
    {id:randomUUID(),label:'Location',class:'must_have',subject:'location',requirement:{kind:'text',value:'Bengaluru'},
      use:'assessment',evidenceKinds:['profile_evidence'],provenance:{kind:'recruiter_edit'}},
  ]};}
  async function savePayload(payload:unknown,request=randomUUID()){
    return one('SELECT flow_job_brief_save($1,$2,$3,$4,2,$5) result',[org,95201,actor,request,{
      action:'save_brief',currentJD:'Build Python services.',sourceChoice:'original_prose',requesterKind:'recruiter',reasonCode:'other',payload}]);
  }
  it('saves range/title schema3 immutably, invalidates approval and replays without another version',async()=>{
    const payload=rangePayload(),request=randomUUID(),saved=await savePayload(payload,request);
    expect(await savePayload(payload,request)).toEqual(saved);
    const version=(await db.query('SELECT schema_version,compiler_version,taxonomy_version,payload FROM job_brief_versions WHERE version_id=$1',[saved.versionId])).rows[0];
    expect(version).toMatchObject({schema_version:3,compiler_version:3,taxonomy_version:3,payload});
    expect(await one('SELECT approved_version_id result FROM job_brief_state WHERE job_id=95201')).toBeNull();
    await refusal(()=>quote(),'SOURCING_QUERY_STALE');
  });
  it.each(['maximum_only','reversed_range','negative','too_large','string_maximum','duplicate_title','too_many_titles','empty_titles',
    'protected_title','protected_note','duplicate_range','retrieval_range','mixed_version','historical_new_save','historical_v2_new_save'])('SQL refuses %s without mutating approval',async variant=>{
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
    if(variant==='historical_v2_new_save')payload.schemaVersion=payload.compilerVersion=payload.taxonomyVersion=2;
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
  it('retains explicit resume evidence through schema-4 save, approval and admission',async()=>{
    const payload=rangePayload();
    payload.schemaVersion=payload.compilerVersion=payload.taxonomyVersion=4;
    for(const criterion of payload.criteria)criterion.evidenceKinds=['profile_evidence','candidate_provided'];
    const saved=await savePayload(payload);
    await one('SELECT flow_job_brief_approve($1,$2,$3,$4,3,$5,$6) result',[org,95201,actor,randomUUID(),saved.versionId,hash]);
    await db.query(`INSERT INTO sourcing_query_artifacts(id,organization_id,job_id,brief_version_id,material_hash,compiler_version,query_hash,input)
      SELECT $1,organization_id,job_id,approved_version_id,approved_material_hash,'1',$2,'{}'::jsonb FROM job_brief_state WHERE job_id=95201`,[randomUUID(),hash]);
    const admitted=await admit(await quote());
    expect(rankingContractSchema.parse(admitted.rankingContract)).toEqual(admitted.rankingContract);
    expect(admitted.rankingContract.payload.schemaVersion).toBe(4);
    expect(createRankingContract(saved.versionId,admitted.rankingContract.materialHash,payload)).toEqual(admitted.rankingContract);
  });
  it.each([null,{version:1,kind:'organization_candidate',applicationId:123,applicationJobId:456}])('shortlisting a private or malformed origin never queues contact: %j',async origin=>{
    const candidate=await legacyCandidate();
    await db.query('UPDATE job_sourced_candidates SET candidate_summary=$1 WHERE id=$2',[{candidateOrigin:origin},candidate]);
    expect(await one('SELECT flow_sourcing_decide($1,$2,$3,$4,$5,$6) result',
      [org,95201,actor,candidate,randomUUID(),{action:'shortlist',expectedRevision:0}])).toMatchObject({state:'shortlisted'});
    expect(await one('SELECT email_resolve_status result FROM job_sourced_candidates WHERE id=$1',[candidate])).toBeNull();
  });
  it.each(['withdraw_global_matching','request_erasure'])('private decisions respect the scope of %s',async action=>{
    const candidate=await legacyCandidate(),privacy=randomUUID();
    await db.query('UPDATE job_sourced_candidates SET candidate_summary=$1 WHERE id=$2',
      [{candidateOrigin:{version:1,kind:'organization_candidate',applicationId:123,applicationJobId:456}},candidate]);
    await db.query("INSERT INTO candidate_privacy_requests(request_id,action,authority_type,actor_user_id,reason_code) VALUES($1,$2,'privacy_operator',$3,'verified_support_request')",[privacy,action,actor]);
    await db.query("INSERT INTO candidate_privacy_subject_links(link_id,request_id,subject_type,job_sourced_candidate_id,organization_id) VALUES($1,$2,'job_sourced_candidate',$3,$4)",[randomUUID(),privacy,candidate,org]);
    const result=await one('SELECT flow_sourcing_decide($1,$2,$3,$4,$5,$6) result',
      [org,95201,actor,candidate,randomUUID(),{action:'shortlist',expectedRevision:0}]);
    if(action==='request_erasure')expect(result).toBeNull();else expect(result).toMatchObject({state:'shortlisted'});
    expect(await one('SELECT email_resolve_status result FROM job_sourced_candidates WHERE id=$1',[candidate])).toBeNull();
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
