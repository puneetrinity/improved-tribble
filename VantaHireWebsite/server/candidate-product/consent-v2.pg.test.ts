import {describe,it,expect} from 'vitest';
import {Client} from 'pg';
import {randomUUID,createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {mkdtempSync,readdirSync,copyFileSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {runReleaseMigration,type MigrationClient} from '../schema-control/runner';
import {PROFILE_CATALOG_SQL,CONSENT_V2_CATALOG_SQL,PROFILE_CATALOG_MD5,CONSENT_V2_CATALOG_MD5,CANDIDATE_CONSENT_FUNCTIONS,assertSchemaReady,FLOW_CRITICAL_POSTCONDITIONS,consentV2PrivilegesReady,profilePrivilegesReady} from '../schema-control/readiness';
import {provisionRuntimeRole} from '../schema-control/runtimeRole';
import {PROFILE_FUNCTIONS,PROFILE_OWNER_FUNCTIONS} from './profile-contracts';
import {CONSENT_V2_OWNER_FUNCTIONS,CONSENT_V2_RUNTIME_FUNCTIONS,runConsentV2Once} from './consent-v2';
import {parseConsentProjection} from './spark-contracts';

const url=process.env.S2_FLOW_TEST_ADMIN_URL;
describe.skipIf(!url)('S2 consent on the full release schema',()=>{
 it.each(['fresh','upgrade'] as const)('%s applies the real migration with exact permissions and schema-version isolation',async(mode)=>{
  const parsed=new URL(url!);
  if(process.env.S2_PROTOTYPE_DISPOSABLE!=='1'||parsed.hostname!=='127.0.0.1'||parsed.pathname!=='/postgres')throw Error('disposable_only');
  const suffix=randomUUID().replaceAll('-','').slice(0,10),owner=`flow_schema_control_test_owner_${suffix}`;
  const database=`flow_schema_control_test_${suffix}`,target=`candidate-s2-${suffix}`,port=Number(parsed.port);
  const runtime=`flow_schema_control_test_runtime_${suffix}`;
  const admin=new Client({connectionString:url});await admin.connect();
  try{
   await admin.query(`CREATE ROLE ${owner} LOGIN NOSUPERUSER NOBYPASSRLS CREATEROLE`);
   await admin.query(`CREATE DATABASE ${database} OWNER ${owner} TEMPLATE template0 ENCODING 'UTF8'`);
  }finally{await admin.end();}
  const connect=async(role=owner)=>{const c=new Client({host:'127.0.0.1',port,user:role,database});await c.connect();return c;};
  const adapter=async(role=owner):Promise<MigrationClient>=>{const c=await connect(role);return {query:(q,p)=>c.query(q,p as any),end:()=>c.end()};};
  const input={migrationsDir:resolve('server/schema-migrations'),creds:{migrateUrl:`postgresql://${owner}:synthetic-local-only@127.0.0.1:${port}/${database}`,expectedTargetId:target,
   environment:'development' as const,allowFreshInitialization:true},connect:()=>adapter()};
  const provision=()=>provisionRuntimeRole({migrateUrl:input.creds.migrateUrl,runtimeUrl:`postgresql://${runtime}:synthetic-local-only@127.0.0.1:${port}/${database}`,runtimeRole:runtime,
   expectedTargetId:target,connectMigration:()=>adapter(),connectRuntime:()=>adapter(runtime)});
  if(mode==='upgrade'){
   const before=mkdtempSync('/tmp/candidate-s2-before-');
   try{
    for(const file of readdirSync(input.migrationsDir))if(!/^00(2[6-9]|3[0-2])_/.test(file))copyFileSync(resolve(input.migrationsDir,file),resolve(before,file));
    const lock=JSON.parse(readFileSync(resolve(before,'checksums.lock'),'utf8'));for(const v of ['0026','0027','0028','0029','0030','0031','0032'])delete lock.migrations[v];writeFileSync(resolve(before,'checksums.lock'),JSON.stringify(lock));
    expect((await runReleaseMigration({...input,migrationsDir:before})).applied).toHaveLength(26);
    await provision();
   }finally{rmSync(before,{recursive:true,force:true});}
  }
  expect((await runReleaseMigration(input)).applied).toHaveLength(mode==='fresh'?33:7);
  expect((await runReleaseMigration(input)).applied).toEqual([]);
  await provision();
  const db=await connect(),app=await connect(runtime);
  try{
   expect(await assertSchemaReady({pg:app,migrationsDir:input.migrationsDir,expectedTargetId:target,environment:'development',criticalPostconditions:FLOW_CRITICAL_POSTCONDITIONS})).toMatchObject({version:'0032',applied:33});
   expect((await db.query('SELECT count(*)::int n FROM schema_control.applied')).rows[0].n).toBe(33);
   expect((await db.query(PROFILE_CATALOG_SQL,[runtime,[...PROFILE_FUNCTIONS]])).rows[0]).toEqual({digest:PROFILE_CATALOG_MD5,privileges:true});
   expect((await db.query(CONSENT_V2_CATALOG_SQL,[runtime,[...CANDIDATE_CONSENT_FUNCTIONS.slice(0,3).map(s=>s.replace(/^public\./,'')),...CONSENT_V2_RUNTIME_FUNCTIONS]])).rows[0]).toEqual({digest:CONSENT_V2_CATALOG_MD5,privileges:true});
   const constraints=await db.query(`SELECT conrelid::regclass::text relation,conname,md5(pg_get_constraintdef(oid)) digest FROM pg_constraint
    WHERE conrelid IN ('candidate_consent_sources'::regclass,'candidate_consent_events'::regclass)
    AND conname IN ('consent_source_profile_shape','candidate_consent_sources_source_schema_version_check','consent_event_versioned_disclosure') ORDER BY conname`);
   expect(constraints.rows).toHaveLength(3);
   for(const table of ['candidate_consent_v2_copies','candidate_profile_commands','candidate_profile_outbox'])await expect(app.query(`SELECT * FROM ${table}`)).rejects.toThrow(/permission denied/);
   for(const signature of [...CONSENT_V2_OWNER_FUNCTIONS,...PROFILE_OWNER_FUNCTIONS])expect((await app.query("SELECT has_function_privilege(current_user,$1,'EXECUTE') ok",[signature])).rows[0].ok).toBe(false);
   await db.query('BEGIN');
   try{await db.query(`GRANT SELECT ON candidate_consent_v2_copies TO ${runtime}`);expect(await consentV2PrivilegesReady(app,runtime,true)).toBe(true);expect(await consentV2PrivilegesReady(db,runtime,true)).toBe(false);}finally{await db.query('ROLLBACK');}
   await db.query('BEGIN');
   try{await db.query(`GRANT EXECUTE ON FUNCTION flow_candidate_profile_expiry_pending() TO ${runtime}`);expect(await profilePrivilegesReady(db,runtime,true)).toBe(false);}finally{await db.query('ROLLBACK');}
   for(const name of ['flow_ack_candidate_consent_outbox','flow_fail_candidate_consent_outbox']){
    const {rows}=await db.query('SELECT prosrc FROM pg_proc WHERE pronamespace=\'public\'::regnamespace AND proname=$1',[name]);
    expect(rows).toHaveLength(1);expect(rows[0].prosrc).toContain('ev.schema_version=1');
   }
   expect((await db.query("SELECT prosrc FROM pg_proc WHERE oid='flow_claim_candidate_consent_outbox(text,integer,integer,uuid)'::regprocedure")).rows[0].prosrc).toContain('flow_claim_consent_version(1,');
   await db.query('BEGIN');
   try{
    const definition=(await db.query("SELECT pg_get_functiondef('flow_claim_candidate_consent_outbox(text,integer,integer,uuid)'::regprocedure) body")).rows[0].body;
    await db.query(definition.replace('SELECT * FROM public.flow_claim_consent_version(1,','SELECT  * FROM public.flow_claim_consent_version(1,'));
    expect(await consentV2PrivilegesReady(db,runtime,true)).toBe(false);
   }finally{await db.query('ROLLBACK');}
   // Real S1 account/consent structures; no hand-written stand-in tables.
   await db.query("INSERT INTO users(id,username,password,role,email_verified,auth_version,first_name,last_name) VALUES(901,'synthetic-consent@example.invalid','synthetic','candidate',true,1,'Test','Owner')");
   await app.query('SELECT flow_candidate_foundation_ensure($1,1,$2,clock_timestamp(),$3)',[901,createHash('sha256').update('synthetic').digest('hex'),randomUUID()]);
   await db.query("UPDATE candidate_product_accounts SET foundation_state='linked' WHERE user_id=901");
   const account=(await db.query('SELECT subject_id,binding_id FROM candidate_product_accounts WHERE user_id=901')).rows[0];
   const copy='a'.repeat(64);
   const capture=async(action:string,version:number,key=randomUUID())=>(await db.query('SELECT flow_consent_v2_capture(901,1,$1,$2,$3,$4,$5,2,$6) result',
    [account.subject_id,account.binding_id,key,version,action,copy])).rows[0].result;
   await expect(capture('grant',0)).rejects.toThrow('consent_copy_unapproved');
   await db.query('INSERT INTO candidate_consent_v2_copies VALUES(2,$1,true)',[copy]);
   const key=randomUUID(),grant=await capture('grant',0,key);
   expect(await capture('grant',0,key)).toEqual({eventId:grant.eventId,version:1,replayed:true});
   expect((await app.query("SELECT * FROM flow_claim_candidate_consent_outbox('legacy',1,30000,NULL)")).rows).toEqual([]);
   let sends=0;
   const deliver=async(raw:string,hash:string)=>{const command=parseConsentProjection(raw);expect(command.hash).toBe(hash);sends++;
    return {eventId:command.value.eventId,version:command.value.version,effectiveVersion:command.value.version,
     outcome:command.value.action==='grant'?'onboarding_granted' as const:'withdrawn' as const};};
   await runConsentV2Once({db:app,workerId:'full-schema-test',privacy:async()=> 'allowed',deliver});
   expect(sends).toBe(1);
   await runConsentV2Once({db:app,workerId:'full-schema-test',privacy:async()=> 'allowed',deliver});expect(sends).toBe(1);
   const pending=await capture('grant',1);
   const leased=(await db.query("SELECT * FROM flow_claim_candidate_consent_v2_outbox('late',1,30000,$1)",[pending.eventId])).rows[0];
   expect((await app.query('SELECT flow_ack_candidate_consent_outbox($1,$2,$3) ok',[leased.outbox_id,leased.generation,JSON.stringify({eventId:pending.eventId,version:2,outcome:'onboarding_granted',effectiveVersion:2})])).rows[0].ok).toBe(false);
   expect((await app.query("SELECT flow_fail_candidate_consent_outbox($1,$2,'network',true,clock_timestamp()) ok",[leased.outbox_id,leased.generation])).rows[0].ok).toBe(false);
   await capture('withdraw',2);
   // Withdrawal is delivered even when the privacy read is unavailable.
   await runConsentV2Once({db:app,workerId:'full-schema-test',privacy:async()=>{throw Error('must not check a withdrawal');},deliver});
   expect(sends).toBe(2);
   expect((await db.query('SELECT flow_consent_v2_ack($1,$2,$3,$4) ok',[leased.outbox_id,leased.generation,leased.command_sha256,
    JSON.stringify({eventId:pending.eventId,version:2,outcome:'onboarding_granted',effectiveVersion:2})])).rows[0].ok).toBe(false);
   expect((await db.query('SELECT acknowledged_version,acknowledged_action FROM candidate_consent_subjects WHERE subject_id=$1',[account.subject_id])).rows[0]).toEqual({acknowledged_version:'3',acknowledged_action:'withdraw'});
   const owned=async(action:string,version:number,key=randomUUID(),copyVersion:number|null=null,copyHash:string|null=null)=>(await app.query(
    'SELECT flow_consent_v2_capture_owned(901,1,$1,$2,$3,$4,$5) result',[key,version,action,copyVersion,copyHash])).rows[0].result;
   const grantKey=randomUUID(),ownedGrant=await owned('grant',3,grantKey,2,copy);
   expect(ownedGrant).toEqual({schemaVersion:2,eventId:expect.any(String),consentRevision:4,status:'recorded',replayed:false});
   expect(await owned('grant',3,grantKey,2,copy)).toEqual({...ownedGrant,replayed:true});
   await expect(owned('grant',3,grantKey,2,'b'.repeat(64))).rejects.toThrow('idempotency_conflict');
   await expect(owned('grant',3,randomUUID(),2,copy)).rejects.toThrow('consent_version_conflict');
   await expect(owned('withdraw',4,randomUUID(),2,copy)).rejects.toThrow('invalid_request');
   // Revoked verification or an unapproved copy cannot prevent withdrawal.
   await db.query('UPDATE users SET email_verified=false WHERE id=901');
   await db.query('UPDATE candidate_consent_v2_copies SET approved=false WHERE copy_version=2');
   const withdrawalKey=randomUUID(),ownedWithdrawal=await owned('withdraw',4,withdrawalKey);
   expect(ownedWithdrawal).toMatchObject({consentRevision:5,status:'recorded',replayed:false});
   await expect(owned('grant',5,randomUUID(),2,copy)).rejects.toThrow('authentication_changed');
   await db.query('UPDATE users SET email_verified=true WHERE id=901');
   await expect(owned('grant',5,randomUUID(),2,copy)).rejects.toThrow('consent_copy_unapproved');
   await db.query('INSERT INTO candidate_consent_v2_copies VALUES(3,$1,true)',['b'.repeat(64)]);
   await owned('grant',5,randomUUID(),3,'b'.repeat(64));
   expect(await owned('withdraw',4,withdrawalKey)).toEqual({...ownedWithdrawal,replayed:true});
   const ownerView=(await app.query('SELECT flow_consent_v2_owner_read(901,1) result')).rows[0].result;
   expect(ownerView).toEqual({schemaVersion:2,consentRevision:6,desiredAction:'grant',acknowledgedRevision:3,
    acknowledgedAction:'withdraw',desiredSchemaVersion:2,acknowledgedSchemaVersion:2,deliveryStatus:'pending'});
   await expect(app.query('SELECT flow_consent_v2_owner_read(901,2)')).rejects.toThrow('authentication_changed');
   await expect(app.query('SELECT flow_consent_v2_owner_read(999,1)')).rejects.toThrow('authentication_changed');
   // Public wrappers cannot choose another subject, and direct helper access is denied.
   await expect(app.query('SELECT flow_consent_v2_capture(901,1,$1,$2,$3,6,\'withdraw\',3,$4)',
    [account.subject_id,account.binding_id,randomUUID(),'b'.repeat(64)])).rejects.toThrow(/permission denied/);
  }finally{await app.end();await db.end();}
 },60000);
});
