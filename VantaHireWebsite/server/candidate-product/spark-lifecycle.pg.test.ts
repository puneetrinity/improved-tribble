import {beforeAll,beforeEach,afterAll,afterEach,describe,it,expect} from 'vitest';
import {Client} from 'pg';
import {randomUUID,createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {runReleaseMigration,type MigrationClient} from '../schema-control/runner';
import {provisionRuntimeRole} from '../schema-control/runtimeRole';
import {profileRepository} from './profile-repository';
import {runProfileBatch,runProfileExpiryBatch,type ProfileLease} from './profile-processor';
import {runConsentV2Once} from './consent-v2';
import {parseCommand} from './spark-contracts';
import {canonicalProfileJson} from './profile-contracts';
import {sourcePaidRequestIdentity,assertSourceSettledReservation,lookupRepository,SOURCE_TABLES,SOURCE_RUNTIME_FUNCTIONS,sql as sourceRoutines} from './source-repository';
import {runLookupAttempt,runLookupDelivery} from './source-processor';
import {SOURCE_CATALOG_SQL,CONSENT_V2_CATALOG_SQL} from '../schema-control/readiness';
import {interpretationJournal,interpretCandidateText,type InterpretationDependencies} from './interpretation';
import {applyGlobalBudgets} from './budget-config';

const url=process.env.S2_FLOW_TEST_ADMIN_URL;
describe.skipIf(!url)('v3 queue on the full Flow schema and restricted runtime',()=>{
 let db:Client,app:Client,repo:ReturnType<typeof profileRepository>,database:string,runtime:string,port:number;
 let user=1000;
 let restoreMutation:string|undefined;
 const copy='a'.repeat(64),password=createHash('sha256').update('synthetic').digest('hex');
 const connect=async(role:string)=>{const c=new Client({host:'127.0.0.1',port,user:role,database});await c.connect();return c;};
 beforeAll(async()=>{
  const parsed=new URL(url!);if(process.env.S2_PROTOTYPE_DISPOSABLE!=='1'||parsed.hostname!=='127.0.0.1'||parsed.pathname!=='/postgres')throw Error('disposable_only');
  port=Number(parsed.port);const suffix=randomUUID().replaceAll('-','').slice(0,10),owner=`flow_schema_control_test_owner_${suffix}`;
  runtime=`flow_schema_control_test_runtime_${suffix}`;database=`flow_schema_control_test_${suffix}`;
  const admin=new Client({connectionString:url});await admin.connect();
  try{await admin.query(`CREATE ROLE ${owner} LOGIN NOSUPERUSER NOBYPASSRLS CREATEROLE`);await admin.query(`CREATE DATABASE ${database} OWNER ${owner} TEMPLATE template0 ENCODING 'UTF8'`);}finally{await admin.end();}
  const adapter=async(role:string):Promise<MigrationClient>=>{const c=await connect(role);return {query:(q,p)=>c.query(q,p as any),end:()=>c.end()};};
  const roleUrl=(role:string)=>`postgresql://${role}:synthetic-local-only@127.0.0.1:${port}/${database}`;
  const migrationsDir=resolve('server/schema-migrations'),target='spark-queue-'+suffix;
  const input={migrationsDir,creds:{migrateUrl:roleUrl(owner),expectedTargetId:target,environment:'development' as const,allowFreshInitialization:true},connect:()=>adapter(owner)};
  expect((await runReleaseMigration(input)).applied).toHaveLength(34);
  expect((await runReleaseMigration(input)).applied).toEqual([]);
  console.log('Retained full-schema Spark queue fixture',database);
  const catalogClient=await connect(owner);try{console.log('Source catalogue', (await catalogClient.query(SOURCE_CATALOG_SQL,[owner,[]])).rows[0].digest);
   console.log('Consent catalogue',(await catalogClient.query(CONSENT_V2_CATALOG_SQL,[owner,[]])).rows[0].digest);
  }finally{await catalogClient.end();}
  await provisionRuntimeRole({migrateUrl:roleUrl(owner),runtimeUrl:roleUrl(runtime),runtimeRole:runtime,expectedTargetId:target,
   connectMigration:()=>adapter(owner),connectRuntime:()=>adapter(runtime)});
  db=await connect(owner);app=await connect(runtime);repo=profileRepository(app,async()=>{});
  await db.query('INSERT INTO candidate_consent_v2_copies VALUES(2,$1,true)',[copy]);
  // Disposable-only mutation proof: no migration/checksum/readiness file changes.
  const mutation=process.env.RC_COMPLETION_TEST_MUTATION;
  if(mutation){
   const variants:Record<string,[string,string,string]>={
    charge:['flow_candidate_source_lookup_work_finish(uuid,uuid,bigint,text)','charged_credits=greatest(coalesce(charged_credits,0),reserved_credits)','charged_credits=0'],
    proposal:['flow_candidate_source_lookup_delivery_finish(bigint,uuid,jsonb)',"   AND c.body::jsonb->'payload'->>'proposalId'=v->>'proposalId'\n   AND c.body::jsonb->'payload'->'sourceVersion'='1'::jsonb\n   AND c.body::jsonb->'payload'->>'proposalHash'=v->>'proposalHash'",''],
    binding:['flow_candidate_source_lookup_delivery_finish(bigint,uuid,jsonb)',' AND c.binding_id=j.binding_id',''],
   };
   const variant=variants[mutation];if(!variant)throw Error('unknown_test_mutation');
   const [signature,from,to]=variant;
   restoreMutation=(await db.query('SELECT pg_get_functiondef($1::regprocedure) source',[signature])).rows[0].source;
   if(restoreMutation!.split(from).length!==2)throw Error('mutation_anchor_drift');
   await db.query(restoreMutation!.replace(from,to));
  }
 },60000);
 afterEach(async()=>{if(db){await db.query('DELETE FROM candidate_source_interpretation_reviews');await db.query('DELETE FROM candidate_source_interpretations');await db.query('DELETE FROM candidate_source_interpretation_budgets');await db.query("UPDATE candidate_profile_outbox SET state='held',safe_reason='invalid_request',lease_token=NULL,lease_expires_at=NULL WHERE state IN ('queued','retry','leased')");
  await db.query("UPDATE candidate_source_jobs SET state='held',reason='outcome_unknown',lease_token=NULL,lease_until=NULL WHERE state IN ('queued','extracting','building','transferring')");
  await db.query("UPDATE candidate_source_lookups SET state='held',reason='outcome_unknown',work_token=NULL,work_until=NULL WHERE state IN ('queued','running','transferring')");}});
 afterAll(async()=>{try{if(db&&restoreMutation)await db.query(restoreMutation);}finally{await app?.end();await db?.end();}});
 beforeEach(async()=>{
  await db.query("INSERT INTO candidate_source_ocr_prices VALUES('test-ocr',1500,'2020-01-01','2099-01-01','synthetic fixture') ON CONFLICT DO NOTHING");
  await db.query('DELETE FROM candidate_source_ai_spend');
  await db.query('UPDATE candidate_source_ai_policy SET enabled=true,candidate_day_micro=250000,candidate_month_micro=2000000,global_day_micro=10000000,global_month_micro=100000000,candidate_day_calls=10');
  await db.query("INSERT INTO candidate_source_ai_prices SELECT 'test-'||m,m,1000000,1000000,'2020-01-01','2099-01-01','synthetic test fixture' FROM unnest(ARRAY['synthetic','synthetic-only']) m ON CONFLICT DO NOTHING");
 });
 const actor=async()=>{
  const id=++user;await db.query("INSERT INTO users(id,username,password,role,email_verified,auth_version,first_name,last_name) VALUES($1,$2,'synthetic','candidate',true,1,'Synthetic','Queue')",[id,`queue${id}@example.invalid`]);
  await app.query('SELECT flow_candidate_foundation_ensure($1,1,$2,clock_timestamp(),$3)',[id,password,randomUUID()]);
  await db.query("UPDATE candidate_product_accounts SET foundation_state='linked',acknowledged_sequence=command_sequence WHERE user_id=$1",[id]);
  return {userId:id,authVersion:1,passwordVersion:password,reauthenticatedAt:Date.now()};
 };
 it('verified erasure is owner-bound, replayable and permanently fences new work',async()=>{
  const a=await actor(),other=await actor(),request=randomUUID(),command=randomUUID();
  const identity=(await db.query('SELECT subject_id,binding_id FROM candidate_product_accounts WHERE user_id=$1',[a.userId])).rows[0];
  const sharedSpend=randomUUID();
  expect((await db.query("SELECT flow_candidate_source_ai_admit($1,$2,'help','synthetic',100,100) ok",[sharedSpend,a.userId])).rows[0].ok).toBe(true);
  await db.query(`INSERT INTO candidate_source_interpretations(user_id,request_key,request_hash,authority_hash,auth_version,consent_revision,model,input_tokens,output_tokens,charged_tokens,state,response)
   VALUES($1,$2,repeat('a',64),repeat('b',64),1,1,'synthetic',100,100,200,'settled','{"exactPrivateText":"Do not keep this candidate request"}')`,[a.userId,randomUUID()]);
  await db.query("INSERT INTO candidate_privacy_requests(request_id,action,authority_type,actor_user_id,reason_code) VALUES($1,'request_erasure','verified_candidate',$2,'candidate_erasure_request')",[request,a.userId]);
  await db.query("INSERT INTO candidate_privacy_subject_links(link_id,request_id,subject_type,candidate_user_id) VALUES($1,$2,'candidate_user',$3)",[randomUUID(),request,other.userId]);
  await expect(db.query('SELECT flow_candidate_source_erasure_prepare($1)',[request])).rejects.toMatchObject({code:'P0002'});
  await db.query("INSERT INTO candidate_privacy_subject_links(link_id,request_id,subject_type,candidate_user_id) VALUES($1,$2,'candidate_user',$3)",[randomUUID(),request,a.userId]);
  await db.query("INSERT INTO candidate_profile_commands(command_id,user_id,subject_id,binding_id,idempotency_key,action,body,body_hash,admitted_auth_version) VALUES($1,$2,$3,$4,$5,'save_draft',$6,$7,1)",
   [command,a.userId,identity.subject_id,identity.binding_id,randomUUID(),JSON.stringify({private:'erase this'}),'a'.repeat(64)]);
  await db.query('INSERT INTO candidate_profile_outbox(command_id) VALUES($1)',[command]);
  const expired=randomUUID();
  await db.query("INSERT INTO candidate_profile_commands(command_id,user_id,subject_id,binding_id,idempotency_key,action,body,body_hash,admitted_auth_version,redacted_at) SELECT $2,user_id,subject_id,binding_id,$3,action,NULL,body_hash,admitted_auth_version,clock_timestamp() FROM candidate_profile_commands WHERE command_id=$1",[command,expired,randomUUID()]);
  await db.query("INSERT INTO candidate_profile_outbox(command_id,state) VALUES($1,'rejected')",[expired]);
  const prepared=(await db.query('SELECT flow_candidate_source_erasure_prepare($1) value',[request])).rows[0].value;
  expect(prepared).toEqual({schemaVersion:1,requestId:request,subjectId:identity.subject_id,bindingId:identity.binding_id});
  await expect(db.query('SELECT flow_candidate_source_owner($1)',[a.userId])).rejects.toMatchObject({code:'42501'});
  await expect(db.query('SELECT flow_candidate_source_erasure_finish($1,$2,$3)',[request,identity.subject_id,randomUUID()])).rejects.toMatchObject({code:'P0002'});
  for(let n=0;n<2;n++)expect((await db.query('SELECT flow_candidate_source_erasure_finish($1,$2,$3) value',[request,identity.subject_id,identity.binding_id])).rows[0].value).toBe(true);
  expect((await db.query('SELECT user_id,charged_micro,reservation_id<>$1 unlinked FROM candidate_source_ai_spend',[sharedSpend])).rows[0]).toEqual({user_id:null,charged_micro:'200',unlinked:true});
  await expect(db.query('SELECT flow_candidate_source_ai_settle($1,0,0)',[sharedSpend])).rejects.toMatchObject({code:'55000'});
  expect((await db.query('SELECT body FROM candidate_profile_commands WHERE command_id=$1',[command])).rows[0].body).toBeNull();
  expect((await db.query('SELECT body,redacted_at IS NOT NULL redacted FROM candidate_profile_commands WHERE command_id=$1',[expired])).rows[0]).toEqual({body:null,redacted:true});
  expect((await db.query('SELECT stage FROM candidate_source_erasures WHERE request_id=$1',[request])).rows[0].stage).toBe('network_erased_files_pending');
  expect((await db.query('SELECT response,request_hash,authority_hash,charged_tokens::text charge FROM candidate_source_interpretations WHERE user_id=$1',[a.userId])).rows[0])
   .toEqual({response:null,request_hash:'0'.repeat(64),authority_hash:'0'.repeat(64),charge:'200'});
  // Restored old payload rows must be scrubbed even with a retained audit.
  await db.query("UPDATE candidate_profile_commands SET body='{\"restored\":true}',redacted_at=NULL WHERE command_id=$1",[command]);
  await db.query('SELECT flow_candidate_source_erasure_finish($1,$2,$3)',[request,identity.subject_id,identity.binding_id]);
  expect((await db.query('SELECT body FROM candidate_profile_commands WHERE command_id=$1',[command])).rows[0].body).toBeNull();
  await db.query("UPDATE candidate_privacy_requests SET state='released' WHERE request_id=$1",[request]);
  await expect(db.query('SELECT flow_candidate_source_owner($1)',[a.userId])).rejects.toMatchObject({code:'42501'});
  expect((await db.query('SELECT flow_candidate_source_interpretation_authorized($1,1,1) value',[a.userId])).rows[0].value).toBe(false);
  await expect(app.query('SELECT * FROM candidate_source_erasures')).rejects.toMatchObject({code:'42501'});
  await expect(app.query('SELECT flow_candidate_source_erasure_prepare($1)',[request])).rejects.toMatchObject({code:'42501'});
  await expect(app.query('SELECT flow_candidate_source_erasure_finish($1,$2,$3)',[request,identity.subject_id,identity.binding_id])).rejects.toMatchObject({code:'42501'});
 });
 it('P4 stores independent facts, refuses runtime rewrites, and permits owner-only erasure',async()=>{
  const a=await actor();
  const job=(await db.query("INSERT INTO jobs(title,location,type,description,posted_by,status) VALUES('Location fixture','Remote','full-time','Synthetic',$1,'pending') RETURNING id",[a.userId])).rows[0].id;
  const location={version:2,provenance:'candidate_confirmed',city:'Bengaluru',countryCode:'IN',confirmedAt:'2026-11-03T12:00:00.000Z'};
  const id=(await app.query("INSERT INTO applications(job_id,user_id,name,email,phone,resume_url,candidate_location,willing_to_relocate) VALUES($1,$2,'Synthetic','location@example.invalid','000','gs://synthetic/resume.pdf',$3,false) RETURNING id",[job,a.userId,location])).rows[0].id;
  expect((await app.query('SELECT candidate_location,willing_to_relocate FROM applications WHERE id=$1',[id])).rows[0]).toEqual({candidate_location:location,willing_to_relocate:false});
  await app.query('UPDATE applications SET candidate_location=candidate_location WHERE id=$1',[id]);
  await expect(app.query('UPDATE applications SET willing_to_relocate=true WHERE id=$1',[id])).rejects.toMatchObject({code:'23514'});
  await expect(app.query('UPDATE applications SET candidate_location=NULL WHERE id=$1',[id])).rejects.toMatchObject({code:'23514'});
  await expect(db.query('UPDATE applications SET candidate_location=$2 WHERE id=$1',[id,{...location,city:'Delhi'}])).rejects.toMatchObject({code:'23514'});
  await db.query('UPDATE applications SET candidate_location=NULL,willing_to_relocate=NULL WHERE id=$1',[id]);
  expect((await app.query('SELECT candidate_location,willing_to_relocate FROM applications WHERE id=$1',[id])).rows[0]).toEqual({candidate_location:null,willing_to_relocate:null});
  for(const bad of [{...location,version:null},{...location,city:null},{...location,confirmedAt:'2026-02-30T00:00:00.000Z'},{...location,extra:true}]){
   expect((await app.query('SELECT application_candidate_location_valid($1) ok',[bad])).rows[0].ok).toBe(false);
  }
 });
 const signup=async()=>{
  const a=await actor();await db.query('UPDATE users SET email_verified=false WHERE id=$1',[a.userId]);
  const key=randomUUID();
  await app.query('SELECT flow_consent_v2_signup_intent($1,$2,2,$3)',[a.userId,key,copy]);
  return {...a,key};
 };
 const activateSignup=async(a:Awaited<ReturnType<typeof actor>>)=>(await app.query('SELECT flow_consent_v2_signup_activate($1,1) result',[a.userId])).rows[0].result;
 it('verification branding reads recorded signup origin only, without exposing consent tables',async()=>{
  const a=await signup(),other=await actor();
  const origin=async(id:number)=>(await app.query('SELECT flow_consent_v2_signup_origin($1) result',[id])).rows[0].result;
  expect(await origin(a.userId)).toBe(true);
  expect(await origin(a.userId)).toBe(true); // resend does not consume origin
  expect(await origin(other.userId)).toBe(false);
  await expect(app.query('SELECT * FROM candidate_consent_signup_intents')).rejects.toMatchObject({code:'42501'});
  await db.query("UPDATE users SET username='changed'||id||'@example.invalid' WHERE id=$1",[a.userId]);
  expect(await origin(a.userId)).toBe(false);
  await db.query("UPDATE users SET role='recruiter' WHERE id=$1",[a.userId]);
  expect(await origin(a.userId)).toBe(false);
 });
 it('signup intent waits for verified email then grants the five purposes exactly once',async()=>{
  const a=await signup();await expect(activateSignup(a)).rejects.toMatchObject({code:'42501'});
  expect((await db.query('SELECT count(*) n FROM candidate_consent_events WHERE user_id=$1',[a.userId])).rows[0].n).toBe('0');
  await app.query('SELECT flow_consent_v2_signup_intent($1,$2,2,$3)',[a.userId,a.key,copy]);
  await expect(app.query('SELECT flow_consent_v2_signup_intent($1,$2,2,$3)',[a.userId,randomUUID(),copy])).rejects.toMatchObject({code:'23505'});
  await db.query('UPDATE users SET email_verified=true WHERE id=$1',[a.userId]);
  const r=await activateSignup(a);expect(r.status).toBe('activated');expect(r.receipt.consentRevision).toBe(1);
  expect((await activateSignup(a)).receipt).toEqual({...r.receipt,replayed:true});
  const events=(await db.query('SELECT public.flow_consent_v2_wire(event_id) AS wire FROM candidate_consent_events WHERE user_id=$1',[a.userId])).rows;
  expect(events).toHaveLength(1);expect(events[0].wire.purposes).toHaveLength(5);
  await capture(a,'withdraw',1);expect((await activateSignup(a)).status).toBe('superseded');
  expect((await db.query('SELECT count(*) n FROM candidate_consent_events WHERE user_id=$1',[a.userId])).rows[0].n).toBe('2');
 });
 it.each(['expired','email_changed','copy_revoked','not_linked'])('does not silently activate a %s signup intent',async mode=>{
  const a=await signup();await db.query('UPDATE users SET email_verified=true WHERE id=$1',[a.userId]);
  if(mode==='expired')await db.query("UPDATE candidate_consent_signup_intents SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id=$1",[a.userId]);
  if(mode==='email_changed')await db.query("UPDATE users SET username='changed'||id||'@example.invalid' WHERE id=$1",[a.userId]);
  if(mode==='copy_revoked')await db.query('UPDATE candidate_consent_v2_copies SET approved=false WHERE copy_version=2');
  if(mode==='not_linked')await db.query("UPDATE candidate_product_accounts SET foundation_state='pending' WHERE user_id=$1",[a.userId]);
  try{
   if(mode==='copy_revoked')await expect(activateSignup(a)).rejects.toMatchObject({code:'42501'});
   else if(mode==='not_linked')await expect(activateSignup(a)).rejects.toMatchObject({code:'P0002'});
   else expect((await activateSignup(a)).status).toBe(mode==='expired'?'expired':'superseded');
  }finally{await db.query('UPDATE candidate_consent_v2_copies SET approved=true WHERE copy_version=2');}
 });
 const command=()=>({schemaVersion:3,idempotencyKey:randomUUID(),expectedDraftVersion:0,expectedProfileVersion:0,expectedPreferenceVersion:0,expectedPreferenceDraftRevision:0,
  action:'save_preference_section',payload:{section:'employment_types',answered:true,value:['gig_freelance']}});
 const confirm=(revision=1)=>({...command(),action:'confirm',payload:{draftHash:copy,preferenceDraftHash:'b'.repeat(64),consentRevision:revision}});
 const capture=async(a:Awaited<ReturnType<typeof actor>>,action:'grant'|'withdraw',expected:number)=>(await app.query('SELECT flow_consent_v2_capture_owned($1,1,$2,$3,$4,$5,$6) result',
  [a.userId,randomUUID(),expected,action,action==='grant'?2:null,action==='grant'?copy:null])).rows[0].result;
 const grant=async(a:Awaited<ReturnType<typeof actor>>)=>{
  const c=await capture(a,'grant',0);
  await runConsentV2Once({db:app,workerId:'spark-queue-consent',privacy:async()=> 'allowed',deliver:async raw=>{
   const x=JSON.parse(raw);return {eventId:x.eventId,version:x.version,effectiveVersion:x.version,outcome:'onboarding_granted'};
  }},c.eventId);return c;
 };
 const receipt=(l:ProfileLease)=>({schemaVersion:3,commandId:l.commandId,subjectId:l.subjectId,bindingId:l.bindingId,commandHash:l.hash,
  status:'applied',reason:null,changed:true,draftVersion:0,profileVersion:0,preferenceVersion:0,preferenceDraftRevision:1,preferenceDraftHash:'b'.repeat(64),publicationActive:false});
 const interpretationFixture=async()=>{
  const a=await actor();await grant(a);
  await db.query("INSERT INTO candidate_source_interpretation_budgets SELECT p,clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour',10000,5000,10,5 FROM unnest(ARRAY['day','month']) p");
  const journal=interpretationJournal(db,{userId:a.userId,authVersion:1,consentRevision:1});
  const input={idempotencyKey:randomUUID(),requestHash:'a'.repeat(64),authorityHash:'b'.repeat(64),model:'synthetic-only',inputTokens:100,outputTokens:100};
  return {a,journal,input};
 };
 it('P6 journal persists exact settlement and lost-reply replay with routine-only app grants',async()=>{
  const {journal,input}=await interpretationFixture();
  const first=await journal.reserve(input),second=await journal.reserve(input);
  expect(second).toEqual(first);if(first.state!=='reserved')throw Error('fixture');
  expect(await journal.dispatch(first.reservationId,input.authorityHash)).toBe(true);
  expect(await journal.dispatch(first.reservationId,input.authorityHash)).toBe(false);
  const response={schemaVersion:1 as const,status:'clarify' as const,question:'Which role?'};
  expect(await journal.settle(first.reservationId,input.authorityHash,response,{inputTokens:80,outputTokens:20})).toEqual(response);
  await journal.hold(first.reservationId,'outcome_unknown'); // lost reply cannot downgrade the stored result
  expect(await journal.reserve(input)).toEqual({state:'replay',response});
  await expect(journal.reserve({...input,requestHash:'c'.repeat(64)})).rejects.toMatchObject({code:'23505'});
  await expect(app.query('SELECT * FROM candidate_source_interpretations')).rejects.toMatchObject({code:'42501'});
  expect((await app.query('SELECT flow_candidate_source_interpretation_dispatch($1,$2) value',[first.reservationId,input.authorityHash])).rows[0].value).toBe(false);
  await expect(app.query('SELECT flow_candidate_source_interpretation_authorized(1,1,1)')).rejects.toMatchObject({code:'42501'});
 });
 it.each([false,true])('temporary AI cleanup retains spend and prevents late resurrection (ack=%s)',async ack=>{
  const {journal,input}=await interpretationFixture(),reserved=await journal.reserve(input);
  if(reserved.state!=='reserved')throw Error('fixture');await journal.dispatch(reserved.reservationId,input.authorityHash);
  await journal.settle(reserved.reservationId,input.authorityHash,{schemaVersion:1,status:'clarify',question:'Which role?'},{inputTokens:1,outputTokens:1});
  await db.query("UPDATE candidate_source_interpretations SET created_at=clock_timestamp()-interval '31 days',acknowledged_at=CASE WHEN $2 THEN clock_timestamp()-interval '6 days' ELSE NULL END WHERE reservation_id=$1",[reserved.reservationId,ack]);
  await app.query('SELECT flow_candidate_source_redact_due()');
  if(ack){
   expect((await db.query('SELECT response FROM candidate_source_interpretations WHERE reservation_id=$1',[reserved.reservationId])).rows[0].response).not.toBeNull();
   await db.query("UPDATE candidate_source_interpretations SET acknowledged_at=clock_timestamp()-interval '8 days' WHERE reservation_id=$1",[reserved.reservationId]);
   await app.query('SELECT flow_candidate_source_redact_due()');
  }
  expect((await db.query('SELECT response,state,charged_tokens::text charge FROM candidate_source_interpretations WHERE reservation_id=$1',[reserved.reservationId])).rows[0])
   .toEqual({response:null,state:'held',charge:'200'});
  expect(await journal.reserve(input)).toEqual({state:'held'});
  await expect(db.query("UPDATE candidate_source_interpretations SET response='{}',state='settled' WHERE reservation_id=$1",[reserved.reservationId])).rejects.toMatchObject({code:'40001'});
  expect((await app.query('SELECT flow_candidate_source_redact_due() value')).rows[0].value.redacted).toBe(0);
 });
 it('P6 held spend cannot be settled or redispatched; budget breaches stop new purchases',async()=>{
  const {journal,input}=await interpretationFixture();const first=await journal.reserve(input);if(first.state!=='reserved')throw Error('fixture');
  await journal.dispatch(first.reservationId,input.authorityHash);await journal.hold(first.reservationId,'budget_breach');
  expect(await journal.dispatch(first.reservationId,input.authorityHash)).toBe(false);
  await expect(journal.settle(first.reservationId,input.authorityHash,{schemaVersion:1,status:'cannot_help',reason:'unsafe'},{inputTokens:0,outputTokens:0})).rejects.toMatchObject({code:'40001'});
  expect(await journal.reserve({...input,idempotencyKey:randomUUID()})).toEqual({state:'unavailable'});
  expect((await db.query('SELECT charged_tokens::text charge FROM candidate_source_interpretations WHERE reservation_id=$1',[first.reservationId])).rows[0].charge).toBe('200');
 });
 it('owner review resumes new AI purchases without releasing held spend, bypassing budgets or hiding a new breach',async()=>{
  const {journal,input}=await interpretationFixture();
  const first=await journal.reserve(input),next=await journal.reserve({...input,idempotencyKey:randomUUID()});
  if(first.state!=='reserved'||next.state!=='reserved')throw Error('fixture');
  await journal.dispatch(first.reservationId,input.authorityHash);await journal.hold(first.reservationId,'budget_breach');
  expect(await journal.dispatch(next.reservationId,input.authorityHash)).toBe(false);
  const sql='SELECT flow_candidate_source_interpretation_review($1,$2,$3,$4) resumed',evidence=randomUUID();
  await expect(app.query(sql,[first.reservationId,200,250,evidence])).rejects.toMatchObject({code:'42501'});
  await expect(app.query('SELECT * FROM candidate_source_interpretation_reviews')).rejects.toMatchObject({code:'42501'});
  await expect(db.query(sql,[first.reservationId,199,250,evidence])).rejects.toMatchObject({code:'40001'});
  await expect(db.query(sql,[first.reservationId,200,199,evidence])).rejects.toMatchObject({code:'22023'});
  expect((await db.query(sql,[first.reservationId,200,250,evidence])).rows[0].resumed).toBe(true);
  expect((await db.query(sql,[first.reservationId,200,250,evidence])).rows[0].resumed).toBe(true);
  expect((await db.query('SELECT count(*) n FROM candidate_source_interpretation_reviews')).rows[0].n).toBe('1');
  expect((await db.query('SELECT state,reason,charged_tokens::text charge FROM candidate_source_interpretations WHERE reservation_id=$1',[first.reservationId])).rows[0])
   .toEqual({state:'held',reason:'budget_breach',charge:'250'});
  expect(await journal.reserve(input)).toEqual({state:'held'});
  expect(await journal.dispatch(first.reservationId,input.authorityHash)).toBe(false);
  expect(await journal.dispatch(next.reservationId,input.authorityHash)).toBe(true);
  await journal.hold(next.reservationId,'budget_breach');
  expect((await db.query(sql,[first.reservationId,200,250,evidence])).rows[0].resumed).toBe(false);
  expect(await journal.reserve({...input,idempotencyKey:randomUUID()})).toEqual({state:'unavailable'});
  expect((await db.query(sql,[next.reservationId,200,200,randomUUID()])).rows[0].resumed).toBe(true);
  await db.query('UPDATE candidate_source_ai_policy SET candidate_day_micro=450');
  const pending=await journal.reserve({...input,idempotencyKey:randomUUID()});if(pending.state!=='reserved')throw Error('fixture');
  expect(await journal.dispatch(pending.reservationId,input.authorityHash)).toBe(false);
  await db.query('SELECT flow_candidate_source_ai_configure(5000,2000000,10000000,100000000,10,true,$1)',[randomUUID()]);
  expect(await journal.dispatch(pending.reservationId,input.authorityHash)).toBe(true);
 });
 it('P6 refuses missing limits and releases only an unsent slot after authority changes',async()=>{
  const {a,journal,input}=await interpretationFixture();await db.query('UPDATE candidate_source_ai_policy SET enabled=false');
  const blocked=await journal.reserve(input);if(blocked.state!=='reserved')throw Error('fixture');
  expect(await journal.dispatch(blocked.reservationId,input.authorityHash)).toBe(false);
  expect((await db.query('SELECT count(*) n FROM candidate_source_ai_spend')).rows[0].n).toBe('0');
  await db.query('UPDATE candidate_source_ai_policy SET enabled=true');
  const first=await journal.reserve(input);if(first.state!=='reserved')throw Error('fixture');
  await capture(a,'withdraw',1);
  expect(await journal.dispatch(first.reservationId,input.authorityHash)).toBe(false);
  expect((await db.query('SELECT state,charged_tokens::text charge FROM candidate_source_interpretations WHERE reservation_id=$1',[first.reservationId])).rows[0]).toEqual({state:'released',charge:'0'});
 });
 it('P6 real journal permits one model call across concurrent requests and a fresh-client replay',async()=>{
  const {a}=await interpretationFixture();
  const versions={expectedDraftVersion:0,expectedProfileVersion:0,expectedPreferenceVersion:0,expectedPreferenceDraftRevision:0};
  const request=JSON.stringify({schemaVersion:1,idempotencyKey:randomUUID(),...versions,use:'change_preferences',text:'I want permanent employment',sourceProposalId:null,sourceVersion:null,targetRowId:null});
  let calls=0;
  const dependencies=(connection:Client):InterpretationDependencies=>({
   ...interpretationJournal(connection,{userId:a.userId,authVersion:1,consentRevision:1}),
   authorize:async()=>({authorityHash:'b'.repeat(64),versions,source:null,companyIds:[]}),
   budget:()=>({model:'synthetic-only',maxInputTokens:3000,maxOutputTokens:100,deadlineMs:20000,proposalTtlMs:86400000}),
   model:async()=>{calls++;return {content:JSON.stringify({status:'clarify',question:'Which type of role?'}),usage:{inputTokens:100,outputTokens:20}};},
  });
  const second=await connect(`flow_schema_control_test_owner_${database.slice('flow_schema_control_test_'.length)}`);
  try{
   await Promise.all([interpretCandidateText(request,dependencies(db)),interpretCandidateText(request,dependencies(second))]);
   expect(calls).toBe(1);
   expect(await interpretCandidateText(request,dependencies(second))).toEqual({schemaVersion:1,status:'clarify',question:'Which type of role?'});
   expect(calls).toBe(1);
   expect((await db.query('SELECT count(*) n FROM candidate_source_interpretations WHERE user_id=$1',[a.userId])).rows[0].n).toBe('1');
  }finally{await second.end();}
 });
 const claims=async()=>await repo.claim(20) as ProfileLease[];
 const resolution=(action:'retry'|'discard',revision=0,key=randomUUID())=>JSON.stringify({schemaVersion:1,idempotencyKey:key,expectedResolutionRevision:revision,action});
 const sqlSource=async(fn:string,...args:unknown[]) => (await db.query(`SELECT public.flow_candidate_source_${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')}) AS result`,args)).rows[0].result;
 const sourceFixture=async()=>{
  const a=await actor();await grant(a);
  const path=`resumes/${randomUUID()}.pdf`;
  const resume=(await db.query("INSERT INTO candidate_resumes(user_id,label,gcs_path,is_default) VALUES($1,'Synthetic',$2,false) RETURNING id",[a.userId,path])).rows[0].id;
  const versions={originalDraftVersion:0,originalProfileVersion:0,originalPreferenceVersion:0,originalPreferenceDraftRevision:0};
  const location=await sqlSource('locator',a.userId,resume);
  const registered=await sqlSource('register_object',a.userId,{resumeId:resume,gcsPath:path,generation:'1',contentHash:'a'.repeat(64),byteLength:100,
   mediaType:'application/pdf',policyVersion:'synthetic',originalVersions:versions,subjectId:location.subjectId,bindingId:location.bindingId});
  const s=registered.sourceId;
  const queued=await sqlSource('enqueue',a.userId,{schemaVersion:1,idempotencyKey:randomUUID(),sourceId:s,sourceVersion:1});
  const claim=await sqlSource('claim',randomUUID());expect(claim?.lease.commandId).toBe(queued.commandId);
  const request={schemaVersion:1,lease:claim.lease,source:claim.source.source,consentRevision:claim.consentRevision,operationKey:randomUUID(),
   limit:{kind:'semantic_model',model:'synthetic',inputTokens:100,maxOutputTokens:200,textHash:'b'.repeat(64)}};
  return {a,claim,request,resume,sourceId:s};
 };
 it('explicit reread: completed legacy result gets one new interpretation, current versions, no extra library copy and a content-wide limit',async()=>{
  const f=await sourceFixture(),old=f.claim.lease.commandId;
  const versions={originalDraftVersion:7,originalProfileVersion:4,originalPreferenceVersion:2,originalPreferenceDraftRevision:3};
  const request={schemaVersion:1,idempotencyKey:randomUUID(),sourceId:f.sourceId,sourceVersion:1,rereadOfCommandId:old,_rereadVersions:versions};
  await expect(sqlSource('enqueue',f.a.userId,request)).rejects.toMatchObject({message:'source_changed'});
  await db.query("UPDATE candidate_source_jobs SET state='review_ready',proposal_id=gen_random_uuid(),lease_token=NULL,lease_until=NULL WHERE command_id=$1",[old]);
  const other=await actor();
  await expect(sqlSource('enqueue',other.userId,request)).rejects.toMatchObject({code:'P0002'});
  const second=await connect((await db.query('SELECT current_user name')).rows[0].name);
  let next:any;
  try {
   const results=await Promise.all([sqlSource('enqueue',f.a.userId,request),second.query('SELECT flow_candidate_source_enqueue($1,$2) result',[f.a.userId,{...request,idempotencyKey:randomUUID()}]).then(r=>r.rows[0].result)]);
   expect(results[0].commandId).toBe(results[1].commandId);next=results[0];
  } finally {await second.end();}
  expect(next.commandId).not.toBe(old);
  expect((await sqlSource('enqueue',f.a.userId,{...request,_rereadVersions:{...versions,originalDraftVersion:8}})).commandId).toBe(next.commandId);
  expect((await db.query('SELECT count(*) n FROM candidate_resumes WHERE user_id=$1',[f.a.userId])).rows[0].n).toBe('1');
  const claim=await sqlSource('claim',randomUUID());
  expect(claim).toMatchObject({...versions,lease:{commandId:next.commandId}});
  await db.query("UPDATE candidate_source_jobs SET state='review_ready',proposal_id=gen_random_uuid(),lease_token=NULL,lease_until=NULL WHERE command_id=$1",[next.commandId]);
  await db.query("UPDATE candidate_source_jobs SET state='unavailable',reason='empty' WHERE command_id=$1",[next.commandId]);
  const third=await sqlSource('retry',f.a.userId,{schemaVersion:1,idempotencyKey:randomUUID(),retryOfCommandId:next.commandId});
  expect(await sqlSource('claim',randomUUID())).toMatchObject({...versions,lease:{commandId:third.commandId}});
  await db.query("UPDATE candidate_source_jobs SET state='review_ready',proposal_id=gen_random_uuid() WHERE command_id=$1",[third.commandId]);
  await expect(sqlSource('enqueue',f.a.userId,{...request,idempotencyKey:randomUUID(),rereadOfCommandId:third.commandId})).rejects.toMatchObject({message:'source_attempt_limit'});
 });
 it('explicit reread refuses unsettled charges, then reserves a new budgeted model call after settlement; withdrawal still blocks it',async()=>{
  await budgets();const f=await sourceFixture();
  const reserved=await sqlSource('paid_reserve',f.request);
  const dispatch=await sqlSource('paid_dispatch',{lease:f.claim.lease,reservationId:reserved.reservation.reservationId});
  const request={schemaVersion:1,idempotencyKey:randomUUID(),sourceId:f.sourceId,sourceVersion:1,rereadOfCommandId:f.claim.lease.commandId,
   _rereadVersions:{originalDraftVersion:0,originalProfileVersion:0,originalPreferenceVersion:0,originalPreferenceDraftRevision:0}};
  await db.query("UPDATE candidate_source_jobs SET state='review_ready',proposal_id=gen_random_uuid() WHERE command_id=$1",[f.claim.lease.commandId]);
  await expect(sqlSource('enqueue',f.a.userId,request)).rejects.toMatchObject({message:'source_changed'});
  await db.query("UPDATE candidate_source_jobs SET state='building' WHERE command_id=$1",[f.claim.lease.commandId]);
  await sqlSource('paid_settle',{lease:f.claim.lease,grant:dispatch.grant,observedUsage:{kind:'semantic_model',inputTokens:90,outputTokens:20},result:document({synthetic:'old result'})});
  await db.query("UPDATE candidate_source_jobs SET state='review_ready',lease_token=NULL,lease_until=NULL WHERE command_id=$1",[f.claim.lease.commandId]);
  const next=await sqlSource('enqueue',f.a.userId,request);
  const claim=await sqlSource('claim',randomUUID());expect(claim.lease.commandId).toBe(next.commandId);
  const purchase={...f.request,lease:claim.lease,operationKey:randomUUID()};
  const freshReservation=await sqlSource('paid_reserve',purchase);
  expect(freshReservation).toMatchObject({state:'reserved'});
  await db.query('UPDATE candidate_source_ai_policy SET enabled=false');
  expect(await sqlSource('paid_dispatch',{lease:claim.lease,reservationId:freshReservation.reservation.reservationId})).toMatchObject({state:'refused',reason:'budget_unavailable'});
  await capture(f.a,'withdraw',1);
  expect(await sqlSource('prepare',claim.lease)).toBeNull();
 });
 const budgets=async()=>{
  await db.query('DELETE FROM candidate_source_budget_windows');
  await db.query(`INSERT INTO candidate_source_budget_windows(kind,period,starts_at,ends_at,global_units,per_candidate_units)
   SELECT k,p,clock_timestamp()-interval '1 day',clock_timestamp()+interval '1 day',1000000,1000000
   FROM unnest(ARRAY['ocr','semantic_model']) k CROSS JOIN unnest(ARRAY['day','month']) p`);
 };
 const document=(value:unknown)=>{const canonical=canonicalProfileJson(value);return {canonical,sha256:createHash('sha256').update(canonical).digest('hex')};};
 const lookupBudgets=async(limit=100)=>{
  await db.query("UPDATE candidate_source_lookup_budgets SET ends_at=clock_timestamp()-interval '1 minute' WHERE ends_at>clock_timestamp()-interval '1 minute'");
  await db.query(`INSERT INTO candidate_source_lookup_budgets(period,starts_at,ends_at,credit_limit)
   SELECT p,clock_timestamp()-interval '1 day',clock_timestamp()+interval '1 day',$1 FROM unnest(ARRAY['day','month']) p`,[limit]);
 };
 const lookupFixture=async()=>{const a=await actor();await grant(a);return {a,r:lookupRepository(db,async()=>{},{userId:a.userId,authVersion:1}),
  request:{schemaVersion:1,idempotencyKey:randomUUID(),kind:'email',expectedConsentRevision:1}};};
 const foundLookup=()=>({outcome:'matched' as const,creditsConsumed:2,person:{linkedinUrl:'https://linkedin.com/in/synthetic',skills:['Go']},alternativeCount:0,partial:false});
 it('RC alerts on the real admission path and lowered env caps stop queued dispatch without resetting slots',async()=>{
  await lookupBudgets(2);const f=await lookupFixture(),admitted=await f.r.admit(JSON.stringify(f.request));
  const before=(await db.query('SELECT day_window,month_window,reserved_credits FROM candidate_source_lookups WHERE attempt_id=$1',[admitted.attemptId])).rows[0];
  const warnings=(await db.query("SELECT metric FROM candidate_source_budget_alerts WHERE dedupe_key IN($1,$2)",[`rc:${before.day_window}:2`,`rc:${before.month_window}:2`])).rows;
  expect(warnings.map(r=>r.metric).sort()).toEqual(['global_day_credits','global_month_credits']);
  const caps=(n:string)=>({aiDayMicro:'10000000',aiMonthMicro:'100000000',ocrDayMicro:'2000000',ocrMonthMicro:'20000000',rcDayCredits:n,rcMonthCredits:n});
  try{
   await expect(app.query('SELECT flow_candidate_source_global_configure($1,$2)',[caps('1'),'a'.repeat(64)])).rejects.toMatchObject({code:'42501'});
   await applyGlobalBudgets(db,caps('1'));expect(await f.r.beginDispatch(admitted.attemptId)).toBeNull();
   await applyGlobalBudgets(db,caps('2'));expect(await f.r.beginDispatch(admitted.attemptId)).not.toBeNull();
   expect((await db.query('SELECT day_window,month_window,reserved_credits FROM candidate_source_lookups WHERE attempt_id=$1',[admitted.attemptId])).rows[0]).toEqual(before);
  }finally{await db.query('UPDATE candidate_source_global_policy SET configured=false');}
 });
 it('expires unfinished resume payloads without deleting files, canonical data or re-opening retry',async()=>{
  const f=await sourceFixture(),id=f.claim.lease.commandId;
  await db.query("UPDATE candidate_source_jobs SET created_at=clock_timestamp()-interval '31 days',extraction_document='{\"private\":\"resume text\"}',extraction_context_hash=repeat('a',64) WHERE command_id=$1",[id]);
  await app.query('SELECT flow_candidate_source_redact_due()');
  const row=(await db.query('SELECT state,reason,extraction_document,lease_token FROM candidate_source_jobs WHERE command_id=$1',[id])).rows[0];
  expect(row).toEqual({state:'unavailable',reason:'source_changed',extraction_document:null,lease_token:null});
  expect((await sqlSource('retry_status',f.a.userId,id)).canRetry).toBe(false);
  expect((await db.query('SELECT count(*) n FROM candidate_resumes WHERE id=$1',[f.resume])).rows[0].n).toBe('1');
  await expect(db.query("UPDATE candidate_source_jobs SET extraction_document='{}' WHERE command_id=$1",[id])).rejects.toMatchObject({code:'40001'});
 });
 it('compacts a paid RC result while keeping charge, slot and no fallback after unknown delivery',async()=>{
  await lookupBudgets();const f=await lookupFixture(),admitted=await f.r.admit(JSON.stringify(f.request));
  await runLookupAttempt(admitted.attemptId,{...f.r,enabled:()=>true,lookup:async()=>foundLookup()});
  await db.query("UPDATE candidate_source_lookups SET created_at=clock_timestamp()-interval '31 days' WHERE attempt_id=$1",[admitted.attemptId]);
  await app.query('SELECT flow_candidate_source_redact_due()');
  expect((await db.query('SELECT state,charged_credits::text charge,slot_released,result_document FROM candidate_source_lookups WHERE attempt_id=$1',[admitted.attemptId])).rows[0])
   .toEqual({state:'held',charge:'2',slot_released:false,result_document:null});
  expect((await f.r.status(admitted.attemptId)).canRequestLinkedin).toBe(false);
  await expect(db.query("UPDATE candidate_source_lookups SET result_document='{}' WHERE attempt_id=$1",[admitted.attemptId])).rejects.toMatchObject({code:'40001'});
 });
 it('RC missing budgets refuse admission; exact one-slot requests replay without a new purchase',async()=>{
  await db.query("UPDATE candidate_source_lookup_budgets SET ends_at=clock_timestamp()-interval '1 minute' WHERE ends_at>clock_timestamp()-interval '1 minute'");
  const f=await lookupFixture();
  await expect(f.r.admit(JSON.stringify(f.request))).rejects.toMatchObject({message:'budget_unavailable'});
  await lookupBudgets();const x=await f.r.admit(JSON.stringify(f.request));
  expect(await f.r.admit(JSON.stringify({...f.request,idempotencyKey:randomUUID()}))).toEqual(x);
  await expect(f.r.admit(JSON.stringify({...f.request,expectedConsentRevision:2}))).rejects.toMatchObject({message:'idempotency_conflict'});
  const rows=(await db.query('SELECT * FROM candidate_source_lookups WHERE user_id=$1',[f.a.userId])).rows;
  expect(rows).toHaveLength(1);expect(JSON.stringify(rows)).not.toContain(`queue${f.a.userId}@example.invalid`);
 });
 it('budget time cannot move backwards for lookup, OCR or model allowances',async()=>{
  for(const kind of ['lookup','ocr','semantic_model']){
   const t=(await db.query("SELECT clock_timestamp()+interval '1 hour' t")).rows[0].t;
   await db.query('INSERT INTO candidate_source_budget_clocks VALUES($1,$2) ON CONFLICT(kind) DO UPDATE SET observed_at=excluded.observed_at',[kind,t]);
   const observed=await sqlSource('budget_now',kind);expect(new Date(observed).getTime()).toBeGreaterThanOrEqual(t.getTime());
  }
  await lookupBudgets();const f=await lookupFixture();
  // The old window looks active to the regressed wall clock, but expired at
  // the persisted budget time. It must not count as a second day/month pair.
  await db.query("INSERT INTO candidate_source_lookup_budgets(period,starts_at,ends_at,credit_limit) SELECT p,clock_timestamp()-interval '1 day',clock_timestamp()+interval '1 second',100 FROM unnest(ARRAY['day','month']) p");
  const x=await f.r.admit(JSON.stringify(f.request));
  const row=(await db.query('SELECT next_work_at::text FROM candidate_source_lookups WHERE attempt_id=$1',[x.attemptId])).rows[0];
  expect(row.next_work_at).toBe('-infinity');expect((await sqlSource('lookup_claim')).attemptId).toBe(x.attemptId);
  // End even the chosen windows before the logical high-water mark: dispatch
  // must release the unsent slot, not revive a window on the regressed clock.
  await db.query("UPDATE candidate_source_lookup_budgets SET ends_at=clock_timestamp()+interval '1 second' WHERE ends_at>clock_timestamp()+interval '1 second'");
  expect(await f.r.beginDispatch(x.attemptId)).toBeNull();
  expect(await f.r.status(x.attemptId)).toMatchObject({reason:'budget_window_closed'});
  await budgets();const resume=await sourceFixture();
  const reserved=await sqlSource('paid_reserve',resume.request);expect(reserved.state).toBe('reserved');
  expect((await db.query("SELECT created_at >= (SELECT observed_at FROM candidate_source_budget_clocks WHERE kind='semantic_model') ok FROM candidate_source_paid_operations WHERE reservation_id=$1",[reserved.reservation.reservationId])).rows[0].ok).toBe(true);
  await db.query("UPDATE candidate_source_budget_clocks SET observed_at=observed_at+interval '1 day' WHERE kind='semantic_model'");
  expect(await sqlSource('paid_dispatch',{lease:resume.claim.lease,reservationId:reserved.reservation.reservationId})).toEqual({state:'refused',reason:'budget_unavailable'});
  // Reset the injected clock only in this isolated fixture.
  await db.query("UPDATE candidate_source_paid_operations SET state='released' WHERE reservation_id=$1",[reserved.reservation.reservationId]);
  await db.query('DELETE FROM candidate_source_budget_clocks');
 });
 it('RC durable dispatch serialises two workers and a committed result is never bought again',async()=>{
  await lookupBudgets();const f=await lookupFixture(),x=await f.r.admit(JSON.stringify(f.request));let calls=0;
  const deps={...f.r,enabled:()=>true,lookup:async()=>{calls++;return foundLookup();}};
  const owner=(await db.query('SELECT current_user role')).rows[0].role,secondDb=await connect(owner);
  let result:string[];
  try{
   const second=lookupRepository(secondDb,async()=>{},{userId:f.a.userId,authVersion:1});
   result=await Promise.all([runLookupAttempt(x.attemptId,deps),runLookupAttempt(x.attemptId,{...deps,...second})]);
  }finally{await secondDb.end();}
  expect(result.sort()).toEqual(['no_dispatch','settled']);expect(calls).toBe(1);
  expect(await f.r.status(x.attemptId)).toMatchObject({state:'transferring',proposalId:null,canRequestLinkedin:false});
  expect(await runLookupAttempt(x.attemptId,deps)).toBe('no_dispatch');
 });
 it('RC lost settlement reply retains the exact result and never buys it again',async()=>{
  await lookupBudgets();const f=await lookupFixture(),x=await f.r.admit(JSON.stringify(f.request));let calls=0;
  const deps={...f.r,enabled:()=>true,lookup:async()=>{calls++;return foundLookup();},
   settle:async(g:Parameters<typeof f.r.settle>[0],v:Parameters<typeof f.r.settle>[1])=>{await f.r.settle(g,v);throw Error('reply_lost');}};
  expect(await runLookupAttempt(x.attemptId,deps)).toBe('held');
  // The worker cannot know commit succeeded; its hold must not overwrite it.
  expect(await f.r.status(x.attemptId)).toMatchObject({state:'transferring'});
  const row=(await db.query('SELECT result_document,charged_credits,dispatch_id FROM candidate_source_lookups WHERE attempt_id=$1',[x.attemptId])).rows[0];
  expect(row.result_document).toEqual(document(foundLookup()));expect(row.charged_credits).toBe('2');
  expect(await runLookupAttempt(x.attemptId,deps)).toBe('no_dispatch');expect(calls).toBe(1);
  await sqlSource('lookup_finish',f.a.userId,x.attemptId,row.dispatch_id,document(foundLookup()));
  await expect(sqlSource('lookup_finish',f.a.userId,x.attemptId,row.dispatch_id,document({...foundLookup(),creditsConsumed:1}))).rejects.toThrow('idempotency_conflict');
 });
 it('RC zero-credit miss releases unused units and permits only one explicit LinkedIn fallback',async()=>{
  await lookupBudgets(2);const f=await lookupFixture(),x=await f.r.admit(JSON.stringify(f.request));
  const g=await f.r.beginDispatch(x.attemptId);await f.r.settle(g!,{outcome:'not_found',creditsConsumed:0,person:null,alternativeCount:0,partial:false});
  expect(await f.r.status(x.attemptId)).toMatchObject({state:'not_found',canRequestLinkedin:true});
  const req={...f.request,idempotencyKey:randomUUID(),kind:'linkedin',url:'HTTP://www.linkedin.com/in/Synthetic?utm=1'};
  const next=await f.r.admit(JSON.stringify(req)),second=await f.r.beginDispatch(next.attemptId);
  expect(second!.operation).toEqual({kind:'linkedin',url:'https://linkedin.com/in/synthetic'});
  await f.r.settle(second!,{...foundLookup(),creditsConsumed:1});
  expect(await f.r.status(x.attemptId)).toMatchObject({canRequestLinkedin:false});
  await expect(f.r.admit(JSON.stringify({...req,idempotencyKey:randomUUID(),url:'https://linkedin.com/in/other'}))).rejects.toThrow('idempotency_conflict');
  expect((await db.query('SELECT count(*) n FROM candidate_source_lookups WHERE user_id=$1',[f.a.userId])).rows[0].n).toBe('2');
 });
 it('RC unknown outcome keeps the reservation and never opens fallback',async()=>{
  await lookupBudgets();const f=await lookupFixture(),x=await f.r.admit(JSON.stringify(f.request));let calls=0;
  const deps={...f.r,enabled:()=>true,lookup:async()=>{calls++;throw Error('timeout');}};
  expect(await runLookupAttempt(x.attemptId,deps)).toBe('held');expect(await runLookupAttempt(x.attemptId,deps)).toBe('no_dispatch');expect(calls).toBe(1);
  expect(await f.r.status(x.attemptId)).toMatchObject({state:'held',canRequestLinkedin:false});
  await expect(f.r.admit(JSON.stringify({...f.request,idempotencyKey:randomUUID(),kind:'linkedin',url:'https://linkedin.com/in/synthetic'}))).rejects.toThrow('fallback_unavailable');
  expect((await db.query('SELECT charged_credits FROM candidate_source_lookups WHERE attempt_id=$1',[x.attemptId])).rows[0].charged_credits).toBe('2');
 });
 it('RC withdrawal fences dispatch and discards a late result without refunding the paid call',async()=>{
  await lookupBudgets();const f=await lookupFixture(),x=await f.r.admit(JSON.stringify(f.request)),g=await f.r.beginDispatch(x.attemptId);
  await capture(f.a,'withdraw',1);await f.r.settle(g!,foundLookup());
  expect((await db.query('SELECT state,result_document,charged_credits FROM candidate_source_lookups WHERE attempt_id=$1',[x.attemptId])).rows[0])
   .toEqual({state:'rejected',result_document:null,charged_credits:'2'});
  const other=await lookupFixture(),q=await other.r.admit(JSON.stringify(other.request));await capture(other.a,'withdraw',1);
  expect(await other.r.beginDispatch(q.attemptId)).toBeNull();
  expect((await db.query('SELECT dispatch_id,charged_credits FROM candidate_source_lookups WHERE attempt_id=$1',[q.attemptId])).rows[0]).toEqual({dispatch_id:null,charged_credits:'0'});
 });
 it('RC SQL rejects raw contact payloads, wrong identity and over-credit results never become review ready',async()=>{
  await lookupBudgets();const f=await lookupFixture(),x=await f.r.admit(JSON.stringify(f.request)),g=await f.r.beginDispatch(x.attemptId);
  await expect(sqlSource('lookup_finish',f.a.userId,x.attemptId,g!.dispatchId,document({...foundLookup(),person:{...foundLookup().person,email:'private@example.invalid'}}))).rejects.toThrow('invalid_request');
  await expect(sqlSource('lookup_finish',f.a.userId,x.attemptId,randomUUID(),document(foundLookup()))).rejects.toThrow('invalid_dispatch');
  await f.r.settle(g!,{...foundLookup(),creditsConsumed:3});
  expect(await f.r.status(x.attemptId)).toMatchObject({state:'held',canRequestLinkedin:false});
  expect((await db.query('SELECT bool_and(stopped) stopped FROM candidate_source_lookup_budgets WHERE ends_at>clock_timestamp()')).rows[0].stopped).toBe(true);
 });
 it('RC budget is shared across candidates and another owner cannot read or dispatch an attempt',async()=>{
  await lookupBudgets(2);const f=await lookupFixture(),other=await lookupFixture();
  const x=await f.r.admit(JSON.stringify(f.request));
  await expect(other.r.admit(JSON.stringify(other.request))).rejects.toThrow('budget_unavailable');
  await expect(other.r.status(x.attemptId)).rejects.toThrow('not_found');
  await expect(other.r.beginDispatch(x.attemptId)).rejects.toThrow('not_found');
 });
 it('RC entrypoints work with real provisioner grants and no table or helper privileges',async()=>{
  await lookupBudgets();const f=await lookupFixture();
   const r=lookupRepository(app,async()=>{},{userId:f.a.userId,authVersion:1}),x=await r.admit(JSON.stringify(f.request));
   const g=await r.beginDispatch(x.attemptId);await r.settle(g!,foundLookup());
   expect(await r.status(x.attemptId)).toMatchObject({state:'transferring'});
   await expect(app.query('SELECT * FROM candidate_source_lookups')).rejects.toMatchObject({code:'42501'});
   await expect(app.query('SELECT flow_candidate_source_lookup_person_valid($1)',[foundLookup().person])).rejects.toMatchObject({code:'42501'});
 });
 it.each([2,5])('held RC charge %s cannot be lowered by a later finish or open fallback',async charge=>{
  await lookupBudgets();const f=await lookupFixture(),x=await f.r.admit(JSON.stringify(f.request)),g=(await f.r.beginDispatch(x.attemptId))!;
  await f.r.hold(g,'dispatch_uncertain',charge);
  for(const result of [foundLookup(),{outcome:'not_found',creditsConsumed:0,person:null,alternativeCount:0,partial:false}])
   await expect(sqlSource('lookup_finish',f.a.userId,x.attemptId,g.dispatchId,document(result))).rejects.toThrow('invalid_dispatch');
  expect((await db.query('SELECT charged_credits FROM candidate_source_lookups WHERE attempt_id=$1',[x.attemptId])).rows[0].charged_credits).toBe(String(charge));
  expect(await f.r.status(x.attemptId)).toMatchObject({state:'held',canRequestLinkedin:false});
 });
 it.each(['authentication_changed','budget_window_closed','consent_changed'])('unused RC slot survives %s and old key remains terminal',async reason=>{
  await lookupBudgets();const f=await lookupFixture(),x=await f.r.admit(JSON.stringify(f.request));let auth=1,revision=1;
  if(reason==='authentication_changed'){auth=2;await db.query('UPDATE users SET auth_version=2 WHERE id=$1',[f.a.userId]);}
  if(reason==='budget_window_closed')await lookupBudgets();
  if(reason==='consent_changed'){
   const w=await capture(f.a,'withdraw',1);const c=await capture(f.a,'grant',2);revision=3;
   await runConsentV2Once({db:app,workerId:'lookup-regrant',privacy:async()=>'allowed',deliver:async raw=>{const v=JSON.parse(raw);return {eventId:v.eventId,version:v.version,effectiveVersion:v.version,outcome:v.action==='withdraw'?'withdrawn':'onboarding_granted'};}},w.eventId);
   await runConsentV2Once({db:app,workerId:'lookup-regrant',privacy:async()=>'allowed',deliver:async raw=>{const v=JSON.parse(raw);return {eventId:v.eventId,version:v.version,effectiveVersion:v.version,outcome:'onboarding_granted'};}},c.eventId);
  }
  const r=lookupRepository(db,async()=>{},{userId:f.a.userId,authVersion:auth});
  expect(await r.beginDispatch(x.attemptId)).toBeNull();expect(await r.status(x.attemptId)).toMatchObject({state:'rejected',reason});
  const next=await r.admit(JSON.stringify({...f.request,idempotencyKey:randomUUID(),expectedConsentRevision:revision}));
  expect(next.attemptId).not.toBe(x.attemptId);expect(await r.admit(JSON.stringify(f.request))).toMatchObject({attemptId:x.attemptId,state:'rejected'});
  expect(await r.beginDispatch(x.attemptId)).toBeNull();expect(await r.beginDispatch(next.attemptId)).not.toBeNull();
 });
 it.each(['unverified','unlinked'])('RC spend settlement survives %s account state without retaining profile',async mode=>{
  await lookupBudgets();const f=await lookupFixture(),x=await f.r.admit(JSON.stringify(f.request)),g=(await f.r.beginDispatch(x.attemptId))!;
  if(mode==='unverified')await db.query('UPDATE users SET email_verified=false WHERE id=$1',[f.a.userId]);
  else await db.query("UPDATE candidate_product_accounts SET foundation_state='pending' WHERE user_id=$1",[f.a.userId]);
  await f.r.settle(g,foundLookup());
  expect((await db.query('SELECT state,reason,charged_credits,result_document FROM candidate_source_lookups WHERE attempt_id=$1',[x.attemptId])).rows[0])
   .toEqual({state:'rejected',reason:'account_changed',charged_credits:'2',result_document:null});
  await expect(f.r.status(x.attemptId)).rejects.toThrow('not_found');
 });
 it('a proven free miss still permits the single LinkedIn fallback after renewed consent',async()=>{
  await lookupBudgets();const f=await lookupFixture(),x=await f.r.admit(JSON.stringify(f.request)),g=(await f.r.beginDispatch(x.attemptId))!;
  await f.r.settle(g,{outcome:'not_found',creditsConsumed:0,person:null,alternativeCount:0,partial:false});
  const w=await capture(f.a,'withdraw',1),c=await capture(f.a,'grant',2);
  for(const event of [w,c])await runConsentV2Once({db:app,workerId:'lookup-renew',privacy:async()=>'allowed',deliver:async raw=>{
   const v=JSON.parse(raw);return {eventId:v.eventId,version:v.version,effectiveVersion:v.version,outcome:v.action==='withdraw'?'withdrawn':'onboarding_granted'};
  }},event.eventId);
  expect(await f.r.status(x.attemptId)).toMatchObject({canRequestLinkedin:true});
  const request={...f.request,idempotencyKey:randomUUID(),kind:'linkedin',url:'https://linkedin.com/in/synthetic',expectedConsentRevision:3};
  const next=await f.r.admit(JSON.stringify(request));expect(await f.r.beginDispatch(next.attemptId)).not.toBeNull();
  expect(await f.r.status(x.attemptId)).toMatchObject({canRequestLinkedin:false});
 });
 it('over-limit RC hold records spend and stops budgets after account eligibility is lost',async()=>{
  await lookupBudgets();const f=await lookupFixture(),x=await f.r.admit(JSON.stringify(f.request)),g=(await f.r.beginDispatch(x.attemptId))!;
  await db.query('UPDATE users SET email_verified=false WHERE id=$1',[f.a.userId]);await f.r.hold(g,'dispatch_uncertain',5);
  expect((await db.query('SELECT charged_credits FROM candidate_source_lookups WHERE attempt_id=$1',[x.attemptId])).rows[0].charged_credits).toBe('5');
  expect((await db.query('SELECT bool_and(stopped) stopped FROM candidate_source_lookup_budgets WHERE ends_at>clock_timestamp()')).rows[0].stopped).toBe(true);
 });
 it('switch-off before HTTP releases an unused RC slot, but cannot release a held purchase',async()=>{
  await lookupBudgets();const f=await lookupFixture(),x=await f.r.admit(JSON.stringify(f.request));let enabled=true,calls=0;
  const deps={...f.r,enabled:()=>enabled,beginDispatch:async(id:string)=>{const g=await f.r.beginDispatch(id);enabled=false;return g;},lookup:async()=>{calls++;return foundLookup();}};
  expect(await runLookupAttempt(x.attemptId,deps)).toBe('disabled');expect(calls).toBe(0);
  const next=await f.r.admit(JSON.stringify({...f.request,idempotencyKey:randomUUID()})),g=(await f.r.beginDispatch(next.attemptId))!;
  await f.r.hold(g,'dispatch_uncertain',null);await expect(f.r.cancelUnsent(g)).rejects.toThrow('invalid_dispatch');
 });
 it('cancelled RC dispatch refuses late charge reports and cannot finish',async()=>{
  await lookupBudgets();const f=await lookupFixture(),x=await f.r.admit(JSON.stringify(f.request)),g=(await f.r.beginDispatch(x.attemptId))!;
  await f.r.cancelUnsent(g);
  await expect(f.r.hold(g,'dispatch_uncertain',5)).rejects.toThrow('invalid_dispatch');
  await expect(f.r.settle(g,foundLookup())).rejects.toThrow('invalid_dispatch');
  expect((await db.query('SELECT charged_credits,slot_released FROM candidate_source_lookups WHERE attempt_id=$1',[x.attemptId])).rows[0])
   .toEqual({charged_credits:'0',slot_released:true});
 });
 it('undispatched malformed grant release has an accurate reason',async()=>{
  await lookupBudgets();const f=await lookupFixture(),x=await f.r.admit(JSON.stringify(f.request));
  await f.r.refuseUnsent(x.attemptId);
  expect(await f.r.status(x.attemptId)).toMatchObject({state:'rejected',reason:'invalid_dispatch_grant'});
 });
 it('late authentication change retains spend with its actual reason',async()=>{
  await lookupBudgets();const f=await lookupFixture(),x=await f.r.admit(JSON.stringify(f.request)),g=(await f.r.beginDispatch(x.attemptId))!;
  await db.query('UPDATE users SET auth_version=auth_version+1 WHERE id=$1',[f.a.userId]);await f.r.settle(g,foundLookup());
  expect((await db.query('SELECT reason,charged_credits FROM candidate_source_lookups WHERE attempt_id=$1',[x.attemptId])).rows[0])
   .toEqual({reason:'authentication_changed',charged_credits:'2'});
 });
 it('lookup delivery retries stored bytes after a lost reply, without buying or rereading versions',async()=>{
  await lookupBudgets();const f=await lookupFixture(),x=await f.r.admit(JSON.stringify(f.request));let paid=0,reads=0;
  await runLookupAttempt(x.attemptId,{...f.r,enabled:()=>true,lookup:async()=>{paid++;return foundLookup();}});
  const sent:string[]=[];let answer:unknown;
  const deps={repository:f.r,readVersions:async()=>{reads++;return {originalDraftVersion:0,originalProfileVersion:0,originalPreferenceVersion:0,originalPreferenceDraftRevision:0};},
   deliver:async(stored:{canonical:string;sha256:string})=>{sent.push(stored.canonical);const t=JSON.parse(stored.canonical);
    const receipt={schemaVersion:1,commandId:t.commandId,subjectId:t.subjectId,bindingId:t.bindingId,commandHash:stored.sha256,
     sourceId:t.sourceId,sourceVersion:t.sourceVersion,proposalId:t.proposal.proposalId,proposalHash:t.proposal.proposalHash,
     outcome:'stored' as const,reason:null,canonicalProfileChanged:false as const,publicationActive:false as const};answer=receipt;
    if(sent.length===1)throw Error('reply_lost');return receipt;}};
  await expect(runLookupDelivery(x.attemptId,deps)).rejects.toThrow('reply_lost');
  expect(await f.r.status(x.attemptId)).toMatchObject({state:'transferring',proposalId:null});
  const stored=(await f.r.prepareDelivery(x.attemptId))!.transfer!;
  await expect(f.r.finishDelivery(x.attemptId,stored,{...(answer as object),commandHash:'0'.repeat(64)})).rejects.toThrow('receipt_mismatch');
  expect(await runLookupDelivery(x.attemptId,deps)).toMatchObject({state:'review_ready'});
  expect(await runLookupDelivery(x.attemptId,deps)).toBe('no_delivery');
  expect(sent[0]).toBe(sent[1]);expect(paid).toBe(1);expect(reads).toBe(1);
  expect(await f.r.finishDelivery(x.attemptId,stored,answer)).toMatchObject({state:'review_ready'});
  // Browser intent alone is insufficient: eligibility follows Memory's applied receipt.
  const proposal=JSON.parse(stored.canonical).proposal;
  const reject={...command(),action:'reject_source',payload:{proposalId:proposal.proposalId,proposalHash:proposal.proposalHash,sourceVersion:1,reason:'not_me'}};
  await repo.admit(f.a,JSON.stringify(reject));
  expect((await f.r.status(x.attemptId)).canRequestLinkedin).toBe(false);
  const lease=(await claims()).find(l=>l.userId===f.a.userId)!;expect(lease).toBeDefined();
  await repo.finish(lease,{state:'applied',receipt:receipt(lease)});
  expect(await f.r.status(x.attemptId)).toMatchObject({state:'rejected',reason:'not_me',canRequestLinkedin:true});
  const fallback=await f.r.admit(JSON.stringify({...f.request,idempotencyKey:randomUUID(),kind:'linkedin',url:'https://linkedin.com/in/synthetic'}));
  expect(fallback.state).toBe('queued');expect((await f.r.status(x.attemptId)).canRequestLinkedin).toBe(false);
 });
 it('not-me applied during a lost delivery reply survives reconciliation and replay',async()=>{
  await lookupBudgets();const f=await lookupFixture(),x=await f.r.admit(JSON.stringify(f.request));let purchases=0,answer:any;
  await runLookupAttempt(x.attemptId,{...f.r,enabled:()=>true,lookup:async()=>{purchases++;return foundLookup();}});
  await expect(runLookupDelivery(x.attemptId,{repository:f.r,
   readVersions:async()=>({originalDraftVersion:0,originalProfileVersion:0,originalPreferenceVersion:0,originalPreferenceDraftRevision:0}),
   deliver:async stored=>{const t=JSON.parse(stored.canonical);answer={schemaVersion:1,commandId:t.commandId,subjectId:t.subjectId,bindingId:t.bindingId,commandHash:stored.sha256,
    sourceId:t.sourceId,sourceVersion:t.sourceVersion,proposalId:t.proposal.proposalId,proposalHash:t.proposal.proposalHash,
    outcome:'stored',reason:null,canonicalProfileChanged:false,publicationActive:false};throw Error('lost');}})).rejects.toThrow('lost');
  const stored=(await f.r.prepareDelivery(x.attemptId))!.transfer!,proposal=JSON.parse(stored.canonical).proposal;
  await repo.admit(f.a,JSON.stringify({...command(),action:'reject_source',payload:{proposalId:proposal.proposalId,proposalHash:proposal.proposalHash,sourceVersion:1,reason:'not_me'}}));
  const lease=(await claims()).find(l=>l.userId===f.a.userId)!;
  await repo.finish(lease,{state:'applied',receipt:receipt(lease)});
  expect(await f.r.status(x.attemptId)).toMatchObject({state:'transferring',canRequestLinkedin:false});
  for(let i=0;i<2;i++){
   await f.r.finishDelivery(x.attemptId,stored,answer);
   expect(await f.r.status(x.attemptId)).toMatchObject({state:'rejected',reason:'not_me',canRequestLinkedin:true});
  }
  expect(purchases).toBe(1);expect((await db.query('SELECT charged_credits FROM candidate_source_lookups WHERE attempt_id=$1',[x.attemptId])).rows[0].charged_credits).toBe('2');
 });
 it.each(['proposalId','proposalHash','sourceVersion','binding'] as const)('C2 unrelated not-me receipt (%s) cannot open the fallback after a lost delivery reply',async mismatch=>{
  await lookupBudgets();const f=await lookupFixture(),x=await f.r.admit(JSON.stringify(f.request));let answer:any;
  await runLookupAttempt(x.attemptId,{...f.r,enabled:()=>true,lookup:async()=>foundLookup()});
  await expect(runLookupDelivery(x.attemptId,{repository:f.r,
   readVersions:async()=>({originalDraftVersion:0,originalProfileVersion:0,originalPreferenceVersion:0,originalPreferenceDraftRevision:0}),
   deliver:async stored=>{const t=JSON.parse(stored.canonical);answer={schemaVersion:1,commandId:t.commandId,subjectId:t.subjectId,bindingId:t.bindingId,commandHash:stored.sha256,
    sourceId:t.sourceId,sourceVersion:t.sourceVersion,proposalId:t.proposal.proposalId,proposalHash:t.proposal.proposalHash,
    outcome:'stored',reason:null,canonicalProfileChanged:false,publicationActive:false};throw Error('lost');}})).rejects.toThrow('lost');
  const stored=(await f.r.prepareDelivery(x.attemptId))!.transfer!,proposal=JSON.parse(stored.canonical).proposal;
  const payload={proposalId:proposal.proposalId,proposalHash:proposal.proposalHash,sourceVersion:1,reason:'not_me'};
  if(mismatch==='proposalId')payload.proposalId=randomUUID();
  if(mismatch==='proposalHash')payload.proposalHash=proposal.proposalHash==='b'.repeat(64)?'c'.repeat(64):'b'.repeat(64);
  if(mismatch==='sourceVersion')payload.sourceVersion=2;
  await repo.admit(f.a,JSON.stringify({...command(),action:'reject_source',payload}));
  const lease=(await claims()).find(l=>l.userId===f.a.userId)!;expect(lease).toBeDefined();
  await repo.finish(lease,{state:'applied',receipt:receipt(lease)});
  await db.query('BEGIN');
  try{
   if(mismatch==='binding'){
    // A stale foreign binding cannot normally coexist under this FK. Defer it
    // only inside a rolled-back owner fixture to isolate the settlement fence
    // without also changing user/subject and masking a missing binding check.
    const fk=(await db.query("SELECT conname FROM pg_constraint WHERE conrelid='candidate_profile_commands'::regclass AND confrelid='candidate_product_accounts'::regclass AND contype='f'")).rows;
    expect(fk).toHaveLength(1);expect(fk[0].conname).toMatch(/^[a-z_]+$/);
    await db.query(`ALTER TABLE candidate_profile_commands ALTER CONSTRAINT ${fk[0].conname} DEFERRABLE INITIALLY DEFERRED`);
    await db.query('UPDATE candidate_profile_commands SET binding_id=$2 WHERE command_id=$1',[lease.commandId,randomUUID()]);
   }
   for(let i=0;i<2;i++){
    await f.r.finishDelivery(x.attemptId,stored,answer);
    expect(await f.r.status(x.attemptId)).toMatchObject({state:'review_ready',canRequestLinkedin:false});
   }
  }finally{await db.query('ROLLBACK');}
 });
 it('password change does not strand a paid delivery on its stored binding',async()=>{
  await lookupBudgets();const f=await lookupFixture(),x=await f.r.admit(JSON.stringify(f.request));
  await runLookupAttempt(x.attemptId,{...f.r,enabled:()=>true,lookup:async()=>foundLookup()});
  await db.query('UPDATE users SET auth_version=2 WHERE id=$1',[f.a.userId]);
  expect(await f.r.prepareDelivery(x.attemptId)).toMatchObject({attemptId:x.attemptId});
  await expect(f.r.status(x.attemptId)).rejects.toThrow('authentication_changed');
 });
 it('queue leases fence competing/stale workers and retain paid charges on terminal refusal',async()=>{
  await lookupBudgets();const f=await lookupFixture(),x=await f.r.admit(JSON.stringify(f.request));
  const lease=await sqlSource('lookup_claim');expect(lease.attemptId).toBe(x.attemptId);expect(await sqlSource('lookup_claim')).toBeNull();
  expect(await sqlSource('lookup_work_prepare',x.attemptId,randomUUID(),lease.generation)).toBe(false);
  await runLookupAttempt(x.attemptId,{...f.r,enabled:()=>true,lookup:async()=>foundLookup()});
  expect(await sqlSource('lookup_work_finish',x.attemptId,lease.token,lease.generation,null)).toBe(true);
  const delivery=await sqlSource('lookup_claim');expect(delivery.stage).toBe('transferring');
  await sqlSource('lookup_work_finish',x.attemptId,delivery.token,delivery.generation,'delivery_refused');
  expect(await sqlSource('lookup_claim')).toBeNull();
  expect(await f.r.status(x.attemptId)).toMatchObject({state:'held',reason:'delivery_refused',canRequestLinkedin:false});
  expect((await db.query('SELECT charged_credits FROM candidate_source_lookups WHERE attempt_id=$1',[x.attemptId])).rows[0].charged_credits).toBe('2');
 });
 it('C1 work finish holds a still-running dispatched lookup at its reserved charge without releasing its slot',async()=>{
  await lookupBudgets();const f=await lookupFixture(),x=await f.r.admit(JSON.stringify(f.request));
  const lease=await sqlSource('lookup_claim');expect(lease.attemptId).toBe(x.attemptId);
  await f.r.beginDispatch(x.attemptId);
  expect((await db.query('SELECT state,charged_credits FROM candidate_source_lookups WHERE attempt_id=$1',[x.attemptId])).rows[0]).toEqual({state:'running',charged_credits:null});
  expect(await sqlSource('lookup_work_finish',x.attemptId,lease.token,lease.generation,'temporary')).toBe(true);
  expect(await f.r.status(x.attemptId)).toMatchObject({state:'held',reason:'outcome_unknown',canRequestLinkedin:false});
  expect((await db.query('SELECT charged_credits,reserved_credits,slot_released,slot FROM candidate_source_lookups WHERE attempt_id=$1',[x.attemptId])).rows[0])
   .toEqual({charged_credits:'2',reserved_credits:2,slot_released:false,slot:1});
  expect(await f.r.beginDispatch(x.attemptId)).toBeNull();
  await expect(f.r.admit(JSON.stringify({...f.request,idempotencyKey:randomUUID(),kind:'linkedin',url:'https://linkedin.com/in/synthetic'}))).rejects.toThrow();
 });
 it('a crashed dispatched lookup is held without resetting its paid slot',async()=>{
  await lookupBudgets();const f=await lookupFixture(),x=await f.r.admit(JSON.stringify(f.request));
  const lease=await sqlSource('lookup_claim');await f.r.beginDispatch(x.attemptId);
  await db.query("UPDATE candidate_source_lookups SET work_until=clock_timestamp()-interval '1 second',dispatched_at=clock_timestamp()-interval '61 seconds' WHERE attempt_id=$1",[x.attemptId]);
  expect(await sqlSource('lookup_claim')).toBeNull();expect(await f.r.status(x.attemptId)).toMatchObject({state:'held',reason:'outcome_unknown'});
  expect((await db.query('SELECT charged_credits FROM candidate_source_lookups WHERE attempt_id=$1',[x.attemptId])).rows[0].charged_credits).toBe('2');
  expect(await sqlSource('lookup_work_finish',x.attemptId,lease.token,lease.generation,null)).toBe(false);
  expect(await f.r.beginDispatch(x.attemptId)).toBeNull();
 });
 it('temporary delivery failure backs off and the twelfth attempt ends in review',async()=>{
  await lookupBudgets();const f=await lookupFixture(),x=await f.r.admit(JSON.stringify(f.request));
  await runLookupAttempt(x.attemptId,{...f.r,enabled:()=>true,lookup:async()=>foundLookup()});
  let l=await sqlSource('lookup_claim');await sqlSource('lookup_work_finish',x.attemptId,l.token,l.generation,'temporary');
  expect(await sqlSource('lookup_claim')).toBeNull();
  await db.query('UPDATE candidate_source_lookups SET work_attempts=11,next_work_at=clock_timestamp() WHERE attempt_id=$1',[x.attemptId]);
  l=await sqlSource('lookup_claim');expect(l.attempts).toBe(12);await sqlSource('lookup_work_finish',x.attemptId,l.token,l.generation,'temporary');
  expect(await f.r.status(x.attemptId)).toMatchObject({state:'held',reason:'retry_exhausted'});expect(await sqlSource('lookup_claim')).toBeNull();
 });
 it('only active leases block the next source job; completed receipt leases do not',async()=>{
  const f=await sourceFixture();
  const next=(await db.query(`INSERT INTO candidate_source_jobs(user_id,source_id,subject_id,binding_id,consent_revision,admitted_auth_version)
   SELECT user_id,source_id,subject_id,binding_id,consent_revision,admitted_auth_version FROM candidate_source_jobs WHERE command_id=$1 RETURNING command_id`,[f.claim.lease.commandId])).rows[0].command_id;
  expect(await sqlSource('claim',randomUUID())).toBeNull();
  await db.query("UPDATE candidate_source_jobs SET state='review_ready' WHERE command_id=$1",[f.claim.lease.commandId]);
  expect((await sqlSource('claim',randomUUID())).lease.commandId).toBe(next);
  expect((await db.query('SELECT lease_token,lease_until>clock_timestamp() live FROM candidate_source_jobs WHERE command_id=$1',[f.claim.lease.commandId])).rows[0])
   .toEqual({lease_token:f.claim.lease.claimToken,live:true});
 });
 it('only RC entrypoints are executable after the real runtime provisioner; source tables and helpers stay private',async()=>{
  const tables=(await db.query("SELECT relname FROM pg_class WHERE relkind='r' AND relname LIKE 'candidate_source_%'")).rows;
  expect(tables).toHaveLength(SOURCE_TABLES.length);
  for(const {relname} of tables)expect((await app.query("SELECT has_table_privilege(current_user,$1,'SELECT,INSERT,UPDATE,DELETE') allowed",[relname])).rows[0].allowed).toBe(false);
  const functions=(await db.query("SELECT oid::regprocedure::text signature FROM pg_proc WHERE proname LIKE 'flow_candidate_source_%'")).rows;
  expect(functions.length).toBeGreaterThanOrEqual(14);
  for(const {signature} of functions)expect((await app.query("SELECT has_function_privilege(current_user,$1,'EXECUTE') allowed",[signature])).rows[0].allowed)
   .toBe((SOURCE_RUNTIME_FUNCTIONS as readonly string[]).includes(signature));
 });
 it('source snapshot checks ownership and immutable path; initial enqueue cannot buy again under a new key',async()=>{
  const f=await sourceFixture();const q={schemaVersion:1,idempotencyKey:randomUUID(),resumeId:f.resume};
  const first=await sqlSource('snapshot',f.a.userId,q);expect(await sqlSource('snapshot',f.a.userId,q)).toEqual(first);
  const other=await actor();await expect(sqlSource('snapshot',other.userId,q)).rejects.toMatchObject({code:'P0002'});
  expect((await sqlSource('enqueue',f.a.userId,{schemaVersion:1,idempotencyKey:randomUUID(),sourceId:f.sourceId,sourceVersion:1})).commandId).toBe(f.claim.lease.commandId);
  await db.query("UPDATE candidate_resumes SET gcs_path='changed' WHERE id=$1",[f.resume]);
  await expect(sqlSource('snapshot',f.a.userId,q)).rejects.toMatchObject({code:'P0002'});
 });
 it('source routines execute through a restricted role without table or helper access',async()=>{
  await budgets();const f=await sourceFixture();
  const signatures=Object.values(sourceRoutines);
  // B2: the provisioner grants these; no test-only grant.
  for(const signature of signatures)expect((await db.query("SELECT has_function_privilege($1,$2,'EXECUTE') ok",[runtime,signature])).rows[0].ok).toBe(true);
  expect((await app.query('SELECT flow_candidate_source_prepare($1) result',[f.claim.lease])).rows[0].result).toEqual(f.claim);
  expect((await app.query('SELECT flow_candidate_source_paid_reserve($1) result',[f.request])).rows[0].result.state).toBe('reserved');
  await expect(app.query('SELECT * FROM candidate_source_paid_operations')).rejects.toMatchObject({code:'42501'});
  await expect(app.query('SELECT flow_candidate_source_owner($1)',[f.a.userId])).rejects.toMatchObject({code:'42501'});
 });
 it('source prepare reads the current verified email and refuses stale leases and withdrawal',async()=>{
  const f=await sourceFixture();expect(f.claim.scrubContext).toEqual({verifiedAccountEmail:`queue${f.a.userId}@example.invalid`});
  await db.query("UPDATE users SET username='changed@example.invalid' WHERE id=$1",[f.a.userId]);
  expect((await sqlSource('prepare',f.claim.lease)).scrubContext.verifiedAccountEmail).toBe('changed@example.invalid');
  expect(await sqlSource('prepare',{...f.claim.lease,claimToken:randomUUID()})).toBeNull();
  await capture(f.a,'withdraw',1);expect(await sqlSource('prepare',f.claim.lease)).toBeNull();
 });
 it('source dispatch refuses a disabled shared budget without creating a paid charge',async()=>{
  await db.query('UPDATE candidate_source_ai_policy SET enabled=false');const f=await sourceFixture();
  const r=await sqlSource('paid_reserve',f.request);expect(r.state).toBe('reserved');
  expect(await sqlSource('paid_dispatch',{lease:f.claim.lease,reservationId:r.reservation.reservationId})).toEqual({state:'refused',reason:'budget_unavailable'});
  expect((await db.query('SELECT count(*) n FROM candidate_source_ai_spend')).rows[0].n).toBe('0');
 });
 it('source paid request fingerprint has exact TypeScript/SQL parity and forbids raw contacts',async()=>{
  const f=await sourceFixture();expect(document(await sqlSource('paid_identity',f.request))).toEqual(sourcePaidRequestIdentity(f.request));
  await expect(sqlSource('paid_identity',{...f.request,email:'private@example.invalid'})).rejects.toMatchObject({code:'22023',message:'invalid_request'});
 });
 it('source dispatch is issued once; unknown dispatch never refunds or automatically repurchases',async()=>{
  await budgets();const f=await sourceFixture(),r=await sqlSource('paid_reserve',f.request);
  expect(r.state).toBe('reserved');expect(await sqlSource('paid_reserve',f.request)).toEqual(r);
  const input={lease:f.claim.lease,reservationId:r.reservation.reservationId};
  const dispatch=await sqlSource('paid_dispatch',input);expect(dispatch.state).toBe('dispatch');
  expect(await sqlSource('paid_dispatch',input)).toEqual({state:'refused',reason:'outcome_unknown'});
  expect(await sqlSource('paid_release_unsent',input)).toEqual({state:'held'});
  expect(await sqlSource('paid_reserve',f.request)).toEqual({state:'refused',reason:'outcome_unknown'});
  expect(await sqlSource('paid_reserve',{...f.request,operationKey:randomUUID()})).toEqual({state:'refused',reason:'idempotency_conflict'});
 });
 it('source settlement is atomic with its result; a new lease reuses it but changed cleaned text cannot',async()=>{
  await budgets();const f=await sourceFixture(),r=await sqlSource('paid_reserve',f.request);
  const dispatch=await sqlSource('paid_dispatch',{lease:f.claim.lease,reservationId:r.reservation.reservationId});
  const result=document({synthetic:'proposal'}),settle={lease:f.claim.lease,grant:dispatch.grant,observedUsage:{kind:'semantic_model',inputTokens:90,outputTokens:20},result};
  const receipt=await sqlSource('paid_settle',settle);expect(receipt.state).toBe('settled');expect(await sqlSource('paid_settle',settle)).toEqual(receipt);
  const expected={state:'settled',receipt,result};expect(await sqlSource('paid_reserve',f.request)).toEqual(expected);
  await db.query("UPDATE candidate_source_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE command_id=$1",[f.claim.lease.commandId]);
  const fresh=await sqlSource('claim',randomUUID());expect(fresh.lease.generation).toBe(2);
  expect(await sqlSource('paid_reserve',{...f.request,lease:fresh.lease})).toEqual(expected);
  for(const limit of [{...f.request.limit,textHash:'c'.repeat(64)},{...f.request.limit,model:'changed'}, {...f.request.limit,inputTokens:101},{...f.request.limit,maxOutputTokens:201}])
   expect(await sqlSource('paid_reserve',{...f.request,lease:fresh.lease,limit})).toEqual({state:'refused',reason:'idempotency_conflict'});
  expect(await sqlSource('paid_reserve',f.request)).toEqual({state:'refused',reason:'lease_lost'});
  await expect(sqlSource('paid_settle',{...settle,lease:fresh.lease,result:document({changed:true})})).rejects.toMatchObject({code:'23505'});
 });
 it('settlement replay preserves the original receipt after withdrawal without bypassing a lease fence',async()=>{
  await budgets();const f=await sourceFixture(),r=await sqlSource('paid_reserve',f.request);
  const dispatch=await sqlSource('paid_dispatch',{lease:f.claim.lease,reservationId:r.reservation.reservationId});
  const settle={lease:f.claim.lease,grant:dispatch.grant,observedUsage:{kind:'semantic_model',inputTokens:90,outputTokens:20},result:document({synthetic:'result'})};
  const receipt=await sqlSource('paid_settle',settle);
  await capture(f.a,'withdraw',1);
  expect(await sqlSource('paid_settle',settle)).toEqual(receipt);
  await expect(sqlSource('paid_settle',{...settle,result:document({changed:true})})).rejects.toMatchObject({code:'23505'});
  await db.query("UPDATE candidate_source_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE command_id=$1",[f.claim.lease.commandId]);
  await expect(sqlSource('paid_settle',settle)).rejects.toMatchObject({code:'40001'});
 });
 it('source units remain charged on uncertain usage; only never-dispatched slots release',async()=>{
  await budgets();const f=await sourceFixture(),r=await sqlSource('paid_reserve',f.request),input={lease:f.claim.lease,reservationId:r.reservation.reservationId};
  expect(await sqlSource('paid_release_unsent',input)).toEqual({state:'released'});
  expect(await sqlSource('paid_dispatch',input)).toEqual({state:'refused',reason:'outcome_unknown'});
  const ocr={...f.request,operationKey:randomUUID(),limit:{kind:'ocr',pageCount:2,totalPageCount:3,pageNumbers:[1,3],contentHash:f.request.source.contentHash}};
  const reserved=await sqlSource('paid_reserve',ocr),dispatch=await sqlSource('paid_dispatch',{lease:f.claim.lease,reservationId:reserved.reservation.reservationId});
  const receipt=await sqlSource('paid_hold',{lease:f.claim.lease,grant:dispatch.grant,observedUsage:{kind:'ocr',pagesSubmitted:null,transportAttempts:null},reason:'provider_uncertain'});
  expect(receipt.state).toBe('held');expect((await db.query('SELECT units,state FROM candidate_source_paid_operations WHERE reservation_id=$1',[reserved.reservation.reservationId])).rows[0]).toEqual({units:'2',state:'held'});
 });
 it('real restricted resume and help dispatch share one allowance and one increase',async()=>{
  const f=await sourceFixture();
  await db.query('SELECT flow_candidate_source_ai_configure(400,2000000,10000000,100000000,10,true,$1)',[randomUUID()]);
  const r=await sqlSource('paid_reserve',f.request);
  expect((await sqlSource('paid_dispatch',{lease:f.claim.lease,reservationId:r.reservation.reservationId})).state).toBe('dispatch');
  const journal=interpretationJournal(app,{userId:f.a.userId,authVersion:1,consentRevision:1});
  const input={idempotencyKey:randomUUID(),requestHash:'a'.repeat(64),authorityHash:'b'.repeat(64),model:'synthetic-only',inputTokens:100,outputTokens:100};
  const h=await journal.reserve(input);if(h.state!=='reserved')throw Error('fixture');
  expect(await journal.dispatch(h.reservationId,input.authorityHash)).toBe(false);
  await db.query('SELECT flow_candidate_source_ai_configure(500,2000000,10000000,100000000,10,true,$1)',[randomUUID()]);
  expect(await journal.dispatch(h.reservationId,input.authorityHash)).toBe(true);
  expect(await journal.dispatch(h.reservationId,input.authorityHash)).toBe(false);
  expect((await db.query('SELECT sum(charged_micro) n FROM candidate_source_ai_spend')).rows[0].n).toBe('500');
 });
 it('source budget is enforced atomically across competing candidates',async()=>{
  await budgets();const f=await sourceFixture();await db.query('UPDATE candidate_source_ai_policy SET global_day_micro=300');
  // Isolate prior synthetic spending without using a wall-clock edge, which
  // can regress on this host. Only this disposable fixture is changed.
  await db.query("UPDATE candidate_source_paid_operations SET created_at=clock_timestamp()-interval '2 days' WHERE kind='semantic_model'");
  const g=await sourceFixture(),second=await connect((await db.query('SELECT current_user name')).rows[0].name);
  try{
   const a=await sqlSource('paid_reserve',f.request),b=await sqlSource('paid_reserve',g.request);
   const results=await Promise.all([sqlSource('paid_dispatch',{lease:f.claim.lease,reservationId:a.reservation.reservationId}),second.query('SELECT flow_candidate_source_paid_dispatch($1) result',[{lease:g.claim.lease,reservationId:b.reservation.reservationId}]).then(x=>x.rows[0].result)]);
   expect(results.filter(x=>x.state==='dispatch')).toHaveLength(1);expect(results.filter(x=>x.reason==='budget_unavailable')).toHaveLength(1);
  }finally{await second.end();}
 });
 it('renewed consent can enqueue the same terminal library source without re-uploading',async()=>{
  const f=await sourceFixture();await sqlSource('fail',f.claim.lease,'provider_refused');
  const withdrawal=await capture(f.a,'withdraw',1),renewed=await capture(f.a,'grant',2);
  await runConsentV2Once({db:app,workerId:'regrant-proof',privacy:async()=> 'allowed',deliver:async raw=>{
   const x=JSON.parse(raw);return {eventId:x.eventId,version:x.version,effectiveVersion:x.version,outcome:x.action==='grant'?'onboarding_granted':'withdrawn'};
  }},withdrawal.eventId);
  await runConsentV2Once({db:app,workerId:'regrant-proof',privacy:async()=> 'allowed',deliver:async raw=>{
   const x=JSON.parse(raw);return {eventId:x.eventId,version:x.version,effectiveVersion:x.version,outcome:'onboarding_granted'};
  }},renewed.eventId);
  const next=await sqlSource('enqueue',f.a.userId,{schemaVersion:1,idempotencyKey:randomUUID(),sourceId:f.sourceId,sourceVersion:1});
  expect(next.commandId).not.toBe(f.claim.lease.commandId);
  expect((await db.query('SELECT consent_revision FROM candidate_source_jobs WHERE command_id=$1',[next.commandId])).rows[0].consent_revision).toBe('3');
 });
 it('explicit reading retry is capped at three per file and double-clicks create one successor',async()=>{
  const f=await sourceFixture();await sqlSource('fail',f.claim.lease,'provider_refused');
  expect(await sqlSource('retry_status',f.a.userId,f.claim.lease.commandId)).toMatchObject({attemptsUsed:1,maxAttempts:3,canRetry:true,canContinueWithoutResume:true,message:'Something went wrong processing your résumé.'});
  const req={schemaVersion:1,idempotencyKey:randomUUID(),retryOfCommandId:f.claim.lease.commandId};
  const first=await sqlSource('retry',f.a.userId,req);
  expect(await sqlSource('retry',f.a.userId,req)).toEqual(first);
  expect(await sqlSource('retry',f.a.userId,{...req,idempotencyKey:randomUUID()})).toEqual(first);
  const secondClaim=await sqlSource('claim',randomUUID());expect(secondClaim.lease.commandId).toBe(first.commandId);
  await sqlSource('fail',secondClaim.lease,'empty');
  const third=await sqlSource('retry',f.a.userId,{...req,idempotencyKey:randomUUID(),retryOfCommandId:first.commandId});
  const thirdClaim=await sqlSource('claim',randomUUID());expect(thirdClaim.lease.commandId).toBe(third.commandId);
  await sqlSource('fail',thirdClaim.lease,'provider_refused');
  expect(await sqlSource('retry_status',f.a.userId,third.commandId)).toMatchObject({attemptsUsed:3,canRetry:false,canContinueWithoutResume:true,reason:'attempt_limit'});
  await expect(sqlSource('retry',f.a.userId,{...req,idempotencyKey:randomUUID(),retryOfCommandId:third.commandId})).rejects.toMatchObject({code:'40001'});
  expect((await db.query('SELECT count(*) n FROM candidate_source_jobs WHERE user_id=$1',[f.a.userId])).rows[0].n).toBe('3');
 });
 it('three unpaid budget refusals consume no tries; explicit retry is idempotent and real failures still stop at three',async()=>{
  await budgets();const f=await sourceFixture();let claim=f.claim;
  await db.query('UPDATE candidate_source_ai_policy SET enabled=false');
  for(let n=0;n<3;n++){
   const reserved=await sqlSource('paid_reserve',{...f.request,lease:claim.lease,operationKey:randomUUID()});
   expect(await sqlSource('paid_dispatch',{lease:claim.lease,reservationId:reserved.reservation.reservationId})).toEqual({state:'refused',reason:'budget_unavailable'});
   await sqlSource('paid_release_unsent',{lease:claim.lease,reservationId:reserved.reservation.reservationId});
   await sqlSource('fail',claim.lease,'budget_unavailable');
   expect(await sqlSource('retry_status',f.a.userId,claim.lease.commandId)).toMatchObject({attemptsUsed:0,canRetry:true});
   const request={schemaVersion:1,idempotencyKey:randomUUID(),retryOfCommandId:claim.lease.commandId};
   const retry=await sqlSource('retry',f.a.userId,request);
   expect(await sqlSource('retry',f.a.userId,{...request,idempotencyKey:randomUUID()})).toEqual(retry);
   claim=await sqlSource('claim',randomUUID());expect(claim.lease.commandId).toBe(retry.commandId);
  }
  expect((await db.query('SELECT count(*) n FROM candidate_source_ai_spend WHERE user_id=$1',[f.a.userId])).rows[0].n).toBe('0');
  await db.query('UPDATE candidate_source_ai_policy SET enabled=true');
  for(let n=1;n<=3;n++){
   const reserved=await sqlSource('paid_reserve',{...f.request,lease:claim.lease,operationKey:randomUUID()});
   expect((await sqlSource('paid_dispatch',{lease:claim.lease,reservationId:reserved.reservation.reservationId})).state).toBe('dispatch');
   await sqlSource('fail',claim.lease,n===1?'budget_unavailable':'outcome_unknown');
   expect(await sqlSource('retry_status',f.a.userId,claim.lease.commandId)).toMatchObject({attemptsUsed:n,canRetry:n<3});
   if(n<3){const next=await sqlSource('retry',f.a.userId,{schemaVersion:1,idempotencyKey:randomUUID(),retryOfCommandId:claim.lease.commandId});claim=await sqlSource('claim',randomUUID());expect(claim.lease.commandId).toBe(next.commandId);}
  }
  expect((await db.query('SELECT count(*) n FROM candidate_source_ai_spend WHERE user_id=$1',[f.a.userId])).rows[0].n).toBe('3');
 });
 it('explicit retries retain uncertain cost and share one cap across OCR and AI failures',async()=>{
  await budgets();const f=await sourceFixture();
  const request={...f.request,limit:{kind:'ocr',pageCount:2,totalPageCount:3,pageNumbers:[1,3],contentHash:f.request.source.contentHash}};
  expect(document(await sqlSource('paid_identity',request))).toEqual(sourcePaidRequestIdentity(request));
  for(const pageNumbers of [[1,1],[3,1],[0,3],[1,4]])
   await expect(sqlSource('paid_reserve',{...request,limit:{...request.limit,pageNumbers}})).rejects.toMatchObject({code:'22023'});
  const reserved=await sqlSource('paid_reserve',request),dispatch=await sqlSource('paid_dispatch',{lease:f.claim.lease,reservationId:reserved.reservation.reservationId});
  await sqlSource('paid_hold',{lease:f.claim.lease,grant:dispatch.grant,observedUsage:{kind:'ocr',pagesSubmitted:null,transportAttempts:null},reason:'provider_uncertain'});
  await sqlSource('fail',f.claim.lease,'outcome_unknown');
  const successor=await sqlSource('retry',f.a.userId,{schemaVersion:1,idempotencyKey:randomUUID(),retryOfCommandId:f.claim.lease.commandId});
  expect(successor.commandId).not.toBe(f.claim.lease.commandId);
  expect((await db.query('SELECT state,units FROM candidate_source_paid_operations WHERE reservation_id=$1',[reserved.reservation.reservationId])).rows[0]).toEqual({state:'held',units:'2'});
  const claim=await sqlSource('claim',randomUUID());
  await sqlSource('paid_reserve',{...f.request,lease:claim.lease,operationKey:randomUUID()});
  await sqlSource('fail',claim.lease,'outcome_unknown');
  expect((await sqlSource('retry_status',f.a.userId,successor.commandId)).canRetry).toBe(true);
  const third=await sqlSource('retry',f.a.userId,{schemaVersion:1,idempotencyKey:randomUUID(),retryOfCommandId:successor.commandId});
  const last=await sqlSource('claim',randomUUID());expect(last.lease.commandId).toBe(third.commandId);
  await sqlSource('fail',last.lease,'outcome_unknown');
  expect(await sqlSource('retry_status',f.a.userId,third.commandId)).toMatchObject({attemptsUsed:3,canRetry:false,reason:'attempt_limit'});
 });
 it('an AI retry reuses settled OCR and keeps its uncertain model charge',async()=>{
  await budgets();const f=await sourceFixture();
  const request={...f.request,operationKey:randomUUID(),limit:{kind:'ocr',pageCount:1,totalPageCount:1,pageNumbers:[1],contentHash:f.request.source.contentHash}};
  const r=await sqlSource('paid_reserve',request),g=await sqlSource('paid_dispatch',{lease:f.claim.lease,reservationId:r.reservation.reservationId});
  const output=document({schemaVersion:1,...f.request.source,policyVersion:'synthetic',status:'extracted',text:'Synthetic Go',textHash:createHash('sha256').update('Synthetic Go').digest('hex'),method:'google_vision_ocr',providerCalls:1});
  await sqlSource('paid_settle',{lease:f.claim.lease,grant:g.grant,observedUsage:{kind:'ocr',pagesSubmitted:1,transportAttempts:2},result:output});
  const model=await sqlSource('paid_reserve',f.request),sent=await sqlSource('paid_dispatch',{lease:f.claim.lease,reservationId:model.reservation.reservationId});
  await sqlSource('paid_hold',{lease:f.claim.lease,grant:sent.grant,observedUsage:{kind:'semantic_model',inputTokens:null,outputTokens:null},reason:'provider_uncertain'});
  await sqlSource('fail',f.claim.lease,'outcome_unknown');
  const next=await sqlSource('retry',f.a.userId,{schemaVersion:1,idempotencyKey:randomUUID(),retryOfCommandId:f.claim.lease.commandId});
  const claim=await sqlSource('claim',randomUUID());expect(claim.lease.commandId).toBe(next.commandId);
  const retryRequest={...request,lease:claim.lease,operationKey:randomUUID()};
  const cached=await sqlSource('paid_reserve',retryRequest);
  expect(cached).toMatchObject({state:'settled',result:output});
  expect(cached.reuseFor).toEqual(sourcePaidRequestIdentity(retryRequest));
  expect(cached.receipt.operationKey).toBe(request.operationKey);
  expect(()=>assertSourceSettledReservation(retryRequest as any,cached)).not.toThrow();
  expect((await sqlSource('paid_reserve',{...f.request,lease:claim.lease,operationKey:randomUUID()})).state).toBe('reserved');
  expect((await db.query("SELECT o.kind,o.state,count(*) n FROM candidate_source_paid_operations o JOIN candidate_source_jobs j USING(command_id) WHERE j.user_id=$1 GROUP BY o.kind,o.state ORDER BY o.kind,o.state",[f.a.userId])).rows).toEqual([
   {kind:'ocr',state:'settled',n:'1'},{kind:'semantic_model',state:'held',n:'1'},{kind:'semantic_model',state:'reserved',n:'1'}]);
  await expect(sqlSource('paid_settle',{lease:f.claim.lease,grant:sent.grant,observedUsage:{kind:'semantic_model',inputTokens:1,outputTokens:1},result:document({late:true})})).rejects.toMatchObject({code:'40001'});
 });
 it('native extraction is copied to an explicit successor and changed scrub context refuses reuse',async()=>{
  const f=await sourceFixture(),text='Synthetic Go',output=document({schemaVersion:1,...f.request.source,policyVersion:'synthetic',status:'extracted',text,textHash:createHash('sha256').update(text).digest('hex'),method:'native_text',providerCalls:0});
  expect(await sqlSource('extraction_cache',f.claim.lease,null)).toBeNull();
  expect(await sqlSource('extraction_cache',f.claim.lease,output)).toEqual(output);
  await sqlSource('fail',f.claim.lease,'outcome_unknown');
  await sqlSource('retry',f.a.userId,{schemaVersion:1,idempotencyKey:randomUUID(),retryOfCommandId:f.claim.lease.commandId});
  const claim=await sqlSource('claim',randomUUID());
  expect(await sqlSource('extraction_cache',claim.lease,null)).toEqual(output);
  await db.query("UPDATE users SET username=$2 WHERE id=$1",[f.a.userId,`changed-${randomUUID()}@example.invalid`]);
  await expect(sqlSource('extraction_cache',claim.lease,null)).rejects.toMatchObject({code:'40001'});
 });
 it('concurrent explicit retry keys allocate only one successor and preserve owner isolation',async()=>{
  const f=await sourceFixture();await sqlSource('fail',f.claim.lease,'empty');const other=await actor();
  const req={schemaVersion:1,idempotencyKey:randomUUID(),retryOfCommandId:f.claim.lease.commandId};
  await expect(sqlSource('retry',other.userId,req)).rejects.toMatchObject({code:'P0002'});
  const second=await connect((await db.query('SELECT current_user name')).rows[0].name);
  try{
   const [a,b]=await Promise.all([sqlSource('retry',f.a.userId,req),second.query('SELECT flow_candidate_source_retry($1,$2) result',[f.a.userId,{...req,idempotencyKey:randomUUID()}]).then(r=>r.rows[0].result)]);
   expect(a.commandId).toBe(b.commandId);
   expect((await db.query('SELECT count(*) n FROM candidate_source_jobs WHERE previous_command_id=$1',[req.retryOfCommandId])).rows[0].n).toBe('1');
  }finally{await second.end();}
 });
 it('source transfer stores only the settled proposal and records the exact Memory receipt after withdrawal',async()=>{
  await budgets();const f=await sourceFixture(),text='Synthetic engineer with Go skills';
  const textHash=createHash('sha256').update(text).digest('hex');f.request.limit.textHash=textHash;
  const body={schemaVersion:1,proposalId:randomUUID(),sourceId:f.sourceId,sourceVersion:1,
   originalDraftVersion:0,originalProfileVersion:0,originalPreferenceVersion:0,originalPreferenceDraftRevision:0,
   sourceKind:'resume',facts:[],reviewNotes:[],expiresAt:new Date(Date.now()+86400000).toISOString()};
  const proposal={...body,proposalHash:document(body).sha256};
  const r=await sqlSource('paid_reserve',f.request),dispatch=await sqlSource('paid_dispatch',{lease:f.claim.lease,reservationId:r.reservation.reservationId});
  await sqlSource('paid_settle',{lease:f.claim.lease,grant:dispatch.grant,observedUsage:{kind:'semantic_model',inputTokens:90,outputTokens:20},result:document(proposal)});
  const transfer={schemaVersion:1,commandId:f.claim.lease.commandId,subjectId:f.claim.actor.subjectId,bindingId:f.claim.actor.bindingId,
   ...f.request.source,textHash,policyVersion:'synthetic',consentRevision:1,text,proposal};
  const wire=document(transfer);expect((await sqlSource('transfer_store',f.claim.lease,wire)).state).toBe('transferring');
  expect((await sqlSource('transfer_store',f.claim.lease,wire)).state).toBe('transferring');
  await expect(sqlSource('transfer_store',f.claim.lease,document({...transfer,text:'tampered'}))).rejects.toMatchObject({code:'22023'});
  const receipt={schemaVersion:1,commandId:transfer.commandId,subjectId:transfer.subjectId,bindingId:transfer.bindingId,commandHash:wire.sha256,
   sourceId:transfer.sourceId,sourceVersion:1,proposalId:proposal.proposalId,proposalHash:proposal.proposalHash,
   outcome:'stored',reason:null,canonicalProfileChanged:false,publicationActive:false};
  await expect(sqlSource('transfer_finish',f.claim.lease,document({...receipt,outcome:null}))).rejects.toMatchObject({code:'22023'});
  await expect(sqlSource('transfer_finish',f.claim.lease,document({...receipt,commandHash:'f'.repeat(64)}))).rejects.toMatchObject({code:'22023'});
  await capture(f.a,'withdraw',1);
  expect((await sqlSource('transfer_finish',f.claim.lease,document(receipt))).state).toBe('review_ready');
  expect((await sqlSource('transfer_finish',f.claim.lease,document(receipt))).state).toBe('review_ready');
  expect((await db.query('SELECT receipt_document FROM candidate_source_jobs WHERE command_id=$1',[transfer.commandId])).rows[0].receipt_document).toEqual(document(receipt));
 });
 it('owner retry keeps the original bytes/key, replays once, and cannot reset its allowance twice',async()=>{
  const a=await actor(),c=command(),admitted=await repo.admit(a,JSON.stringify(c)),l=(await claims())[0]!;
  await repo.finish(l,{state:'held',reason:'retry_exhausted'});
  const other=await actor();await expect(repo.resolution({userId:other.userId,authVersion:other.authVersion},admitted.commandId,resolution('retry'))).rejects.toMatchObject({code:'not_found'});
  const raw=resolution('retry'),first=await repo.resolution({userId:a.userId,authVersion:a.authVersion},admitted.commandId,raw);
  expect(first).toMatchObject({state:'retry_queued',resolutionRevision:1,canRetry:false,blocksConfirmation:true});
  expect(await repo.resolution({userId:a.userId,authVersion:a.authVersion},admitted.commandId,raw)).toEqual(first);
  await expect(repo.resolution({userId:a.userId,authVersion:a.authVersion},admitted.commandId,raw.replace('"retry"','"discard"'))).rejects.toMatchObject({code:'idempotency_conflict'});
  await expect(repo.resolution({userId:a.userId,authVersion:a.authVersion},admitted.commandId,resolution('discard'))).rejects.toMatchObject({code:'resolution_conflict'});
  const retried=(await claims())[0]!;expect(retried.body).toBe(l.body);expect(retried.commandId).toBe(l.commandId);expect(retried.idempotencyKey).toBe(c.idempotencyKey);
  await repo.finish(retried,{state:'held',reason:'retry_exhausted'});
  await expect(repo.resolution({userId:a.userId,authVersion:a.authVersion},admitted.commandId,resolution('retry',1))).rejects.toMatchObject({code:'resolution_unavailable'});
  expect((await repo.resolution({userId:a.userId,authVersion:a.authVersion},admitted.commandId)).canDiscard).toBe(true);
 });
 it.each([2,3])('discard v%s fences an in-flight sender and waits for a Memory tombstone',async version=>{
  const a=await actor(),c=version===3?command():{schemaVersion:2,idempotencyKey:randomUUID(),expectedDraftVersion:0,expectedProfileVersion:0,expectedPreferenceVersion:0,
   action:'save_draft',payload:{profile:{displayName:'Synthetic',headline:'',linkedinUrl:null,currentLocation:null,skills:[],employment:[],education:[],projects:[]}}};
  const admitted=await repo.admit(a,JSON.stringify(c)),l=(await claims())[0]!;
  const request=resolution('discard');expect(await repo.resolution({userId:a.userId,authVersion:a.authVersion},admitted.commandId,request)).toMatchObject({state:'resolving',blocksConfirmation:true});
  expect((await db.query('SELECT body FROM candidate_profile_commands WHERE command_id=$1',[admitted.commandId])).rows[0].body).toBeNull();
  if(version===3)await expect(repo.authority(l)).rejects.toThrow();
  await repo.finish(l,{state:'applied',receipt:receipt(l)});
  expect((await repo.resolution({userId:a.userId,authVersion:a.authVersion},admitted.commandId)).state).toBe('resolving');
  const lease=(await repo.claimExpiry()).find(x=>x.commandId===admitted.commandId)!;expect(lease.schemaVersion).toBe(version);
  const base={schemaVersion:version,commandId:l.commandId,subjectId:l.subjectId,bindingId:l.bindingId,commandHash:l.hash,status:'rejected',reason:'command_expired',
   draftVersion:0,profileVersion:0,preferenceVersion:0,publicationActive:false};
  await repo.settleExpiry(lease,version===3?{...base,changed:false,preferenceDraftRevision:0,preferenceDraftHash:null}:base);
  expect(await repo.resolution({userId:a.userId,authVersion:a.authVersion},admitted.commandId)).toMatchObject({state:'discarded',reason:'discard_acknowledged',blocksConfirmation:false});
  expect(await repo.resolution({userId:a.userId,authVersion:a.authVersion},admitted.commandId,request)).toMatchObject({state:'resolving'}); // Original request receipt, not current state.
 });
 it('discard preserves a Memory-applied receipt and a stale resolver cannot overwrite it',async()=>{
  const a=await actor(),admitted=await repo.admit(a,JSON.stringify(command())),l=(await claims())[0]!;
  await repo.resolution({userId:a.userId,authVersion:a.authVersion},admitted.commandId,resolution('discard'));
  const recovery=(await repo.claimExpiry()).find(x=>x.commandId===l.commandId)!;
  await repo.settleExpiry(recovery,receipt(l));
  expect(await repo.resolution({userId:a.userId,authVersion:a.authVersion},l.commandId)).toMatchObject({state:'applied',reason:'already_applied',blocksConfirmation:false});
  expect(await repo.refuseExpiry(recovery)).toEqual({applied:false});
  expect((await db.query('SELECT receipt FROM candidate_profile_outbox WHERE command_id=$1',[l.commandId])).rows[0].receipt).toEqual(receipt(l));
 });
 it('caps reconciliation at 12 claims including crashed workers, and exposes operator count',async()=>{
  const a=await actor(),admitted=await repo.admit(a,JSON.stringify(command()));await repo.resolution({userId:a.userId,authVersion:a.authVersion},admitted.commandId,resolution('discard'));
  for(let n=0;n<12;n++){
   const lease=(await repo.claimExpiry()).find(x=>x.commandId===admitted.commandId);expect(lease).toBeDefined();
   await db.query("UPDATE candidate_profile_outbox SET lease_expires_at=clock_timestamp()-interval '1 second',next_attempt_at=clock_timestamp() WHERE command_id=$1",[admitted.commandId]);
  }
  expect((await repo.claimExpiry()).find(x=>x.commandId===admitted.commandId)).toBeUndefined();
  expect(await repo.resolution({userId:a.userId,authVersion:a.authVersion},admitted.commandId)).toMatchObject({state:'operator_review',blocksConfirmation:true});
  expect(await repo.recoveryReviewCount()).toBeGreaterThan(0);
  expect((await db.query('SELECT recovery_attempts FROM candidate_profile_outbox WHERE command_id=$1',[admitted.commandId])).rows[0].recovery_attempts).toBe(12);
 });
 it('permanent recovery refusal is lease fenced and stops further claims',async()=>{
  const a=await actor(),admitted=await repo.admit(a,JSON.stringify(command()));await repo.resolution({userId:a.userId,authVersion:a.authVersion},admitted.commandId,resolution('discard'));
  const l=(await repo.claimExpiry()).find(x=>x.commandId===admitted.commandId)!;
  expect(await repo.refuseExpiry({...l,leaseToken:randomUUID()})).toEqual({applied:false});
  expect(await repo.refuseExpiry(l)).toEqual({applied:true});
  expect((await repo.claimExpiry()).find(x=>x.commandId===admitted.commandId)).toBeUndefined();
  expect((await repo.resolution({userId:a.userId,authVersion:a.authVersion},admitted.commandId)).state).toBe('operator_review');
 });
 it('two competing owner requests with one revision cannot schedule two actions',async()=>{
  const a=await actor(),admitted=await repo.admit(a,JSON.stringify(command())),l=(await claims())[0]!;
  await repo.finish(l,{state:'held',reason:'retry_exhausted'});
  const other=await connect(runtime);try{
   const results=await Promise.allSettled([repo.resolution({userId:a.userId,authVersion:a.authVersion},l.commandId,resolution('retry')),profileRepository(other,async()=>{}).resolution({userId:a.userId,authVersion:a.authVersion},l.commandId,resolution('discard'))]);
   expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);
   expect(results.filter(x=>x.status==='rejected')).toHaveLength(1);
  }finally{await other.end();}
 });
 it('admits exact v3 commands once and refuses unsupported actions before storage',async()=>{
  const a=await actor(),c=command(),raw=JSON.stringify(c),first=await repo.admit(a,raw);
  expect(first).toMatchObject({schemaVersion:3,status:'pending'});expect(await repo.admit(a,raw)).toEqual(first);
  await expect(repo.admit(a,JSON.stringify({...c,payload:{...c.payload,value:['contract']}}))).rejects.toMatchObject({code:'idempotency_conflict'});
  await expect(repo.admit(a,JSON.stringify({...c,idempotencyKey:randomUUID(),action:'request_source',payload:{kind:'professional_lookup',attemptId:randomUUID()}}))).rejects.toMatchObject({code:'feature_unavailable'});
  const foreign=await actor();await expect(repo.readCommand({userId:foreign.userId,authVersion:foreign.authVersion},first.commandId)).rejects.toMatchObject({code:'not_found'});
  expect((await repo.owner({userId:a.userId,authVersion:a.authVersion})).pendingCommands[0]).toMatchObject({schemaVersion:3,commandId:first.commandId,action:c.action});
  expect((await claims())[0]!.body).toBe(parseCommand(raw).canonical);
 });
 it('source acceptance needs consent at admission and before sending, while rejection remains available',async()=>{
  const a=await actor();
  const c={...command(),action:'accept_source',payload:{proposalId:randomUUID(),proposalHash:copy,sourceVersion:1,selectedFactIds:[randomUUID()],replaceFactIds:[],corrections:[]}};
  await expect(repo.admit(a,JSON.stringify(c))).rejects.toMatchObject({code:'consent_changed'});
  await grant(a);const admitted=await repo.admit(a,JSON.stringify(c));
  expect(await repo.admit(a,JSON.stringify(c))).toEqual(admitted);
  const l=(await claims())[0]!;await capture(a,'withdraw',1);
  await expect(repo.authority(l)).rejects.toMatchObject({code:'consent_changed'});
  await repo.finish(l,{state:'rejected',reason:'consent_changed'});
  const reject={...c,idempotencyKey:randomUUID(),action:'reject_source',payload:{proposalId:c.payload.proposalId,proposalHash:copy,sourceVersion:1,reason:'not_needed'}};
  expect(await repo.admit(a,JSON.stringify(reject))).toMatchObject({schemaVersion:3,status:'pending'});
 });
 it('settles only matching v3 receipts and retains protocol after redaction',async()=>{
  const a=await actor(),c=command(),admitted=await repo.admit(a,JSON.stringify(c)),l=(await claims())[0]!;
  await repo.authority(l);const r=receipt(l);
  for(const bad of [{...r,schemaVersion:2},{...r,extra:true},{...r,changed:'yes'},{...r,preferenceDraftRevision:-1},{...r,commandHash:'f'.repeat(64)}])
   await expect(repo.finish(l,{state:'applied',receipt:bad})).rejects.toMatchObject({code:'invalid_request'});
  await repo.finish({...l,leaseToken:randomUUID()},{state:'applied',receipt:r});expect((await repo.readCommand({userId:a.userId,authVersion:a.authVersion},admitted.commandId)).status).toBe('pending');
  await repo.finish(l,{state:'applied',receipt:r});await repo.finish(l,{state:'applied',receipt:r});
  expect(await repo.readCommand({userId:a.userId,authVersion:a.authVersion},admitted.commandId)).toMatchObject({schemaVersion:3,status:'applied',preferenceDraftRevision:1,preferenceDraftHash:'b'.repeat(64)});
  // Advance only the test acknowledgement clock; production trigger is unchanged.
  await db.query('ALTER TABLE candidate_profile_outbox DISABLE TRIGGER candidate_profile_ack_clock');
  try{await db.query("UPDATE candidate_profile_outbox SET acknowledged_at=clock_timestamp()-interval '8 days' WHERE command_id=$1",[admitted.commandId]);}
  finally{await db.query('ALTER TABLE candidate_profile_outbox ENABLE TRIGGER candidate_profile_ack_clock');}
  await db.query('SELECT flow_candidate_profile_redact_due()');
  expect((await db.query('SELECT body,schema_version FROM candidate_profile_commands WHERE command_id=$1',[admitted.commandId])).rows[0]).toEqual({body:null,schema_version:3});
  expect((await repo.readCommand({userId:a.userId,authVersion:a.authVersion},admitted.commandId)).schemaVersion).toBe(3);
  expect(await repo.admit(a,JSON.stringify(c))).toMatchObject({schemaVersion:3,commandId:admitted.commandId,status:'applied'});
 });
 it('two real workers claim a subject only once and cannot prepare a stale lease',async()=>{
  const a=await actor();await repo.admit(a,JSON.stringify(command()));const other=await connect(runtime);
  try{const second=profileRepository(other,async()=>{});const [x,y]=await Promise.all([repo.claim(20),second.claim(20)]);
   expect(x.length+y.length).toBe(1);const l=[...x,...y][0] as ProfileLease;
   await expect(repo.authority({...l,leaseToken:randomUUID()})).rejects.toMatchObject({code:'authority_unavailable'});
   await repo.authority(l);
   await db.query("UPDATE candidate_profile_outbox SET lease_expires_at=clock_timestamp()+interval '5 seconds' WHERE command_id=$1",[l.commandId]);
   await expect(repo.authority(l)).rejects.toMatchObject({code:'authority_unavailable'});
  }finally{await other.end();}
 });
 it('requires acknowledged current consent and no unresolved saves before confirm',async()=>{
  const a=await actor();await expect(repo.admit(a,JSON.stringify(confirm()))).rejects.toMatchObject({code:'consent_changed'});
  const pending=await capture(a,'grant',0);
  await expect(repo.admit(a,JSON.stringify(confirm()))).rejects.toMatchObject({code:'consent_changed'});
  await runConsentV2Once({db:app,workerId:'grant',privacy:async()=> 'allowed',deliver:async()=>({eventId:pending.eventId,version:1,effectiveVersion:1,outcome:'onboarding_granted'})},pending.eventId);
  await repo.admit(a,JSON.stringify(command()));
  await expect(repo.admit(a,JSON.stringify(confirm()))).rejects.toMatchObject({code:'pending_changes'});
  const l=(await claims())[0]!;await repo.finish(l,{state:'applied',receipt:receipt(l)});
  await expect(repo.admit({...a,passwordVersion:null,reauthenticatedAt:null},JSON.stringify(confirm()))).rejects.toMatchObject({code:'recent_auth_required'});
  await db.query('UPDATE candidate_consent_v2_copies SET approved=false WHERE copy_version=2');
  try{await expect(repo.admit(a,JSON.stringify(confirm()))).rejects.toMatchObject({code:'consent_changed'});}
  finally{await db.query('UPDATE candidate_consent_v2_copies SET approved=true WHERE copy_version=2');}
  expect(await repo.admit(a,JSON.stringify(confirm()))).toMatchObject({schemaVersion:3,status:'pending'});
 });
 it.each(['before_claim','before_dispatch'] as const)('withdrawal blocks dispatch %s',async when=>{
  const a=await actor();await grant(a);const admitted=await repo.admit(a,JSON.stringify(confirm()));
  if(when==='before_claim'){
   await capture(a,'withdraw',1);expect(await claims()).toEqual([]);
  }else{
   const l=(await claims())[0]!;
    await capture(a,'withdraw',1);await expect(repo.authority(l)).rejects.toMatchObject({code:'consent_changed'});
    await repo.finish(l,{state:'rejected',reason:'consent_changed'});
  }
  expect(await repo.readCommand({userId:a.userId,authVersion:a.authVersion},admitted.commandId)).toMatchObject({status:'rejected',reason:'consent_changed'});
 });
 it.each(['applied','rejected'] as const)('preserves Memory %s receipt after withdrawal during dispatch',async status=>{
  const a=await actor();await grant(a);const admitted=await repo.admit(a,JSON.stringify(confirm()));
  const l=(await claims())[0]!;await repo.authority(l);await capture(a,'withdraw',1);
  const ack={...receipt(l),status,reason:status==='applied'?null:'consent_changed',changed:status==='applied',
   draftVersion:3,profileVersion:2,preferenceVersion:4,preferenceDraftRevision:5};
  await expect(repo.finish(l,{state:status,receipt:{...ack,commandHash:'f'.repeat(64)}})).rejects.toMatchObject({code:'invalid_request'});
  await repo.finish(l,{state:status,receipt:ack});await repo.finish(l,{state:status,receipt:ack});
  expect((await db.query('SELECT receipt FROM candidate_profile_outbox WHERE command_id=$1',[admitted.commandId])).rows[0].receipt).toEqual(ack);
  expect(await repo.readCommand({userId:a.userId,authVersion:a.authVersion},admitted.commandId)).toMatchObject({status,reason:ack.reason,
   draftVersion:3,profileVersion:2,preferenceVersion:4,preferenceDraftRevision:5});
  expect((await db.query('SELECT desired_action,version FROM candidate_consent_subjects WHERE user_id=$1',[a.userId])).rows[0]).toMatchObject({desired_action:'withdraw',version:'2'});
 });
 it('private preference edits still work after withdrawal through the real worker',async()=>{
  const a=await actor();await grant(a);await capture(a,'withdraw',1);const admission=await repo.admit(a,JSON.stringify(command()));let sent=0;
  await runProfileBatch({enabled:()=>true,claim:repo.claim,authority:repo.authority,finish:repo.finish,deliver:async l=>{sent++;return receipt(l);}});
  expect(sent).toBe(1);expect((await repo.readCommand({userId:a.userId,authVersion:a.authVersion},admission.commandId)).status).toBe('applied');
 });
 it('leases recovery once, fences stale workers and retries without losing the receipt',async()=>{
  const a=await actor(),admitted=await repo.admit(a,JSON.stringify(command()));
  await db.query("UPDATE candidate_profile_commands SET created_at=clock_timestamp()-interval '31 days' WHERE command_id=$1",[admitted.commandId]);
  await repo.redactDue();const other=await connect(runtime),second=profileRepository(other,async()=>{});
  try{
   const [first,racing]=await Promise.all([repo.claimExpiry(),second.claimExpiry()]);
   const matches=[...first,...racing].filter(l=>l.commandId===admitted.commandId);expect(matches).toHaveLength(1);
   const l=matches[0]!;await repo.prepareExpiry(l);
   await expect(repo.prepareExpiry({...l,leaseToken:randomUUID()})).rejects.toMatchObject({code:'authority_unavailable'});
   expect(await repo.settleExpiry({...l,leaseToken:randomUUID()},null)).toEqual({applied:false});
   await repo.settleExpiry(l,null);expect(await repo.claimExpiry()).toEqual([]);
   await db.query('UPDATE candidate_profile_outbox SET next_attempt_at=clock_timestamp() WHERE command_id=$1',[admitted.commandId]);
   let sends=0;
   await runProfileExpiryBatch({enabled:()=>true,redactDue:repo.redactDue,claimExpiry:repo.claimExpiry,prepareExpiry:repo.prepareExpiry,
    settleExpiry:repo.settleExpiry,recover:async identity=>{sends++;return {schemaVersion:3,commandId:identity.commandId,subjectId:identity.subjectId,
     bindingId:identity.bindingId,commandHash:identity.commandHash,status:'rejected',reason:'command_expired',changed:false,
     draftVersion:0,profileVersion:0,preferenceVersion:0,preferenceDraftRevision:0,preferenceDraftHash:null,publicationActive:false};}});
   expect(sends).toBe(1);expect(await repo.claimExpiry()).toEqual([]);
   expect((await repo.readCommand({userId:a.userId,authVersion:1},admitted.commandId)).reason).toBe('command_expired');
   expect(await repo.settleExpiry(l,null)).toEqual({applied:false});
  }finally{await other.end();}
 });
 it.each(['applied','rejected'] as const)('30-day redaction recovers v3 %s without a protocol downgrade',async status=>{
  const a=await actor(),admission=await repo.admit(a,JSON.stringify(command())),l=(await claims())[0]!;
  await db.query("UPDATE candidate_profile_commands SET created_at=clock_timestamp()-interval '31 days' WHERE command_id=$1",[admission.commandId]);
  await db.query('SELECT flow_candidate_profile_redact_due()');
  const pending=(await db.query('SELECT flow_candidate_profile_expiry_pending() result')).rows[0].result;
  expect(pending.find((p:any)=>p.commandId===admission.commandId)).toMatchObject({schemaVersion:3});
  await expect(repo.authority(l)).rejects.toMatchObject({code:'authority_unavailable'});
  await expect(db.query('SELECT flow_candidate_profile_expiry_finish($1,$2)',[admission.commandId,JSON.stringify({...receipt(l),schemaVersion:2})])).rejects.toThrow('invalid_request');
  expect((await repo.readCommand({userId:a.userId,authVersion:a.authVersion},admission.commandId)).reason).toBe('expiry_reconciling');
  const ack={...receipt(l),status,changed:status==='applied',reason:status==='rejected'?'command_expired':null};
  for(const bad of [{...ack,commandHash:'f'.repeat(64)},{...ack,preferenceDraftRevision:-1},{...ack,extra:true}])
   await expect(db.query('SELECT flow_candidate_profile_expiry_finish($1,$2)',[admission.commandId,JSON.stringify(bad)])).rejects.toThrow('invalid_request');
  expect((await db.query('SELECT flow_candidate_profile_expiry_finish($1,$2) result',[admission.commandId,JSON.stringify(ack)])).rows[0].result).toEqual({applied:true});
  expect((await db.query('SELECT flow_candidate_profile_expiry_finish($1,$2) result',[admission.commandId,JSON.stringify(ack)])).rows[0].result).toEqual({applied:false});
  await repo.finish(l,{state:'applied',receipt:receipt(l)});
  expect((await db.query('SELECT receipt FROM candidate_profile_outbox WHERE command_id=$1',[admission.commandId])).rows[0].receipt).toEqual(ack);
  await expect(app.query('SELECT flow_candidate_profile_consent_ready($1,$2,$3,1)',[a.userId,l.subjectId,l.bindingId])).rejects.toThrow(/permission denied/);
 });
});
