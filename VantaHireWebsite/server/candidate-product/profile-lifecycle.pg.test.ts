import {describe,it,expect} from 'vitest';
import {Client} from 'pg';
import {randomUUID,createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {runReleaseMigration,type MigrationClient} from '../schema-control/runner';
import {provisionRuntimeRole} from '../schema-control/runtimeRole';
import {profileRepository} from './profile-repository';
import {parseProfileCommand} from './profile-contracts';
import {PROFILE_FUNCTIONS} from './profile-contracts';
import {PROFILE_CATALOG_SQL} from '../schema-control/readiness';

const url=process.env.S2_FLOW_TEST_ADMIN_URL;
describe.skipIf(!url)('S2 outbox on the actual full S1 release schema',()=>{
 it('proves admission, exact receipts, fencing, bounded leases, ownership and held-command progress',async()=>{
  const parsed=new URL(url!);
  if(process.env.S2_PROTOTYPE_DISPOSABLE!=='1'||parsed.hostname!=='127.0.0.1'||parsed.pathname!=='/postgres')throw Error('disposable_only');
  const suffix=randomUUID().replaceAll('-','').slice(0,10),owner=`flow_schema_control_test_owner_${suffix}`;
  const runtime=`flow_schema_control_test_runtime_${suffix}`,database=`flow_schema_control_test_${suffix}`;
  const target=`candidate-s2-${suffix}`,port=Number(parsed.port);
  const admin=new Client({connectionString:url});await admin.connect();
  try{
   await admin.query(`CREATE ROLE ${owner} LOGIN NOSUPERUSER NOBYPASSRLS CREATEROLE`);
   await admin.query(`CREATE DATABASE ${database} OWNER ${owner} TEMPLATE template0 ENCODING 'UTF8'`);
  }finally{await admin.end();}
  const connect=async(role:string)=>{const c=new Client({host:'127.0.0.1',port,user:role,database});await c.connect();return c;};
  const adapter=async(role:string):Promise<MigrationClient>=>{const c=await connect(role);return {query:(q,p)=>c.query(q,p as any),end:()=>c.end()};};
  const roleUrl=(role:string)=>`postgresql://${role}:synthetic-local-only@127.0.0.1:${port}/${database}`;
  await runReleaseMigration({migrationsDir:resolve('server/schema-migrations'),creds:{migrateUrl:roleUrl(owner),expectedTargetId:target,
   environment:'development',allowFreshInitialization:true},connect:()=>adapter(owner)});
  await provisionRuntimeRole({migrateUrl:roleUrl(owner),runtimeUrl:roleUrl(runtime),runtimeRole:runtime,
   expectedTargetId:target,connectMigration:()=>adapter(owner),connectRuntime:()=>adapter(runtime)});
  const db=await connect(owner),app=await connect(runtime);
  try{
   const catalog=(await db.query(PROFILE_CATALOG_SQL,[runtime,[...PROFILE_FUNCTIONS]])).rows[0];
   expect(catalog.privileges).toBe(true);console.log('S2 Flow catalog',catalog.digest);
   await expect(app.query('SELECT * FROM candidate_profile_commands')).rejects.toThrow(/permission denied/);
   await db.query("INSERT INTO users(id,username,password,role,email_verified,auth_version,first_name,last_name) VALUES(901,'synthetic901@example.invalid','synthetic','candidate',true,1,'Test','Owner'),(902,'synthetic902@example.invalid','synthetic','candidate',true,1,'Other','Owner')");
   for(const id of [901,902]){
    await app.query('SELECT flow_candidate_foundation_ensure($1,1,$2,clock_timestamp(),$3)',[id,createHash('sha256').update('synthetic').digest('hex'),randomUUID()]);
    // S1 delivery is independently tested. Here seed its acknowledged state,
    // without fake profile tables or a hand-written replacement schema.
    await db.query("UPDATE candidate_product_accounts SET foundation_state='linked',acknowledged_sequence=command_sequence WHERE user_id=$1",[id]);
   }
   const repo=profileRepository(app,async()=>{}),actor={userId:901,authVersion:1,passwordVersion:null,reauthenticatedAt:null};
   const reader={userId:901,authVersion:1};
   const make=()=>({schemaVersion:2,idempotencyKey:randomUUID(),expectedDraftVersion:0,expectedProfileVersion:0,expectedPreferenceVersion:0,
    action:'save_draft',payload:{profile:{displayName:'Synthetic',headline:'',linkedinUrl:null,currentLocation:null,skills:[],employment:[],education:[],projects:[]}}});
   const req=make(),first=await repo.admit(actor,JSON.stringify(req));
   expect(first.status).toBe('pending');expect(await repo.admit(actor,JSON.stringify(req))).toEqual(first);
   await expect(repo.admit(actor,JSON.stringify({...req,payload:{profile:{...req.payload.profile,headline:'Different'}}}))).rejects.toMatchObject({code:'idempotency_conflict'});
   await expect(repo.readCommand({userId:902,authVersion:1},first.commandId)).rejects.toMatchObject({code:'not_found'});
   const claims=await repo.claim(20);expect(claims).toHaveLength(1);const lease=claims[0] as any;
   expect(lease.body).toBe(parseProfileCommand(JSON.stringify(req)).canonical);
   const remaining=(await db.query('SELECT extract(epoch FROM lease_expires_at-clock_timestamp()) seconds FROM candidate_profile_outbox WHERE command_id=$1',[first.commandId])).rows[0].seconds;
   expect(Number(remaining)).toBeGreaterThan(100);
   const receipt={schemaVersion:2,commandId:lease.commandId,subjectId:lease.subjectId,bindingId:lease.bindingId,commandHash:lease.hash,
    status:'applied',draftVersion:1,profileVersion:0,preferenceVersion:0,reason:null,publicationActive:false};
   await expect(repo.finish(lease,{state:'applied',receipt:{...receipt,extra:'private'}})).rejects.toMatchObject({code:'invalid_request'});
   await repo.finish({...lease,leaseToken:randomUUID()},{state:'applied',receipt});
   expect((await repo.readCommand(reader,first.commandId)).status).toBe('pending');
   await repo.finish(lease,{state:'held',reason:'identity_conflict'});
   const second=await repo.admit(actor,JSON.stringify(make()));
   const next=(await repo.claim(20))[0] as any;expect(next.commandId).toBe(second.commandId);
   await repo.finish(next,{state:'retry',reason:'memory_unavailable',delayMs:250});
   expect(await repo.readCommand(reader,second.commandId)).toMatchObject({status:'held',reason:'memory_unavailable'});
   expect(await repo.owner(reader)).toMatchObject({pendingCommands:expect.arrayContaining([expect.objectContaining({commandId:first.commandId,status:'held'})])});
   await db.query("UPDATE candidate_profile_outbox SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE command_id=$1",[second.commandId]);
   const retry=(await repo.claim(20))[0] as any;
   await repo.finish(retry,{state:'applied',receipt:{...receipt,commandId:retry.commandId,commandHash:retry.hash}});
   expect(await repo.readCommand(reader,second.commandId)).toMatchObject({status:'applied',draftVersion:1});
   await repo.finish(next,{state:'held',reason:'identity_conflict'});
   expect((await repo.readCommand(reader,second.commandId)).status).toBe('applied');
   // A crashed worker's lease expires. Its replacement may finish, but the
   // original token/generation can neither overwrite nor acknowledge it.
   const third=await repo.admit(actor,JSON.stringify(make()));
   const abandoned=(await repo.claim(20))[0] as any;
   expect(abandoned.commandId).toBe(third.commandId);
   await db.query("UPDATE candidate_profile_outbox SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE command_id=$1",[third.commandId]);
   const recovered=(await repo.claim(20))[0] as any;
   expect(recovered.leaseGeneration).toBe(abandoned.leaseGeneration+1);
   expect(recovered.leaseToken).not.toBe(abandoned.leaseToken);
   await repo.finish(abandoned,{state:'held',reason:'identity_conflict'});
   expect((await repo.readCommand(reader,third.commandId)).status).toBe('pending');
   await repo.finish(recovered,{state:'applied',receipt:{...receipt,commandId:recovered.commandId,commandHash:recovered.hash}});
   expect((await repo.readCommand(reader,third.commandId)).status).toBe('applied');
   const exhausted=await repo.admit(actor,JSON.stringify(make()));
   await db.query('UPDATE candidate_profile_outbox SET attempts=12 WHERE command_id=$1',[exhausted.commandId]);
   expect(await repo.claim(20)).toHaveLength(0);
   expect(await repo.readCommand(reader,exhausted.commandId)).toMatchObject({status:'held',reason:'retry_exhausted'});
   await expect(repo.admit({...actor,authVersion:2},JSON.stringify(make()))).rejects.toMatchObject({code:'authentication_changed'});
   { // Retention is part of real migration 0026; never load prototype SQL.
    await expect(app.query('SELECT flow_candidate_profile_expiry_pending()')).rejects.toThrow(/permission denied/);
    const oldAckRequest=make(),oldAck=await repo.admit(actor,JSON.stringify(oldAckRequest));
    const oldAckHash=parseProfileCommand(JSON.stringify(oldAckRequest)).hash;
    const ack={...receipt,commandId:oldAck.commandId,commandHash:oldAckHash};
    // Synthetic historical outbox row, representing a receipt acknowledged eight
    // days ago. Normal updates cannot rewrite the server-owned acknowledgement time.
    await db.query('DELETE FROM candidate_profile_outbox WHERE command_id=$1',[oldAck.commandId]);
    await db.query("INSERT INTO candidate_profile_outbox(command_id,state,receipt,acknowledged_at) VALUES($1,'applied',$2,clock_timestamp()-interval '8 days')",[oldAck.commandId,JSON.stringify(ack)]);
    const oldPending=await repo.admit(actor,JSON.stringify(make()));
    const oldLease=(await repo.claim(20))[0] as any;
    expect(oldLease.commandId).toBe(oldPending.commandId);
    await db.query("UPDATE candidate_profile_commands SET created_at=clock_timestamp()-interval '31 days' WHERE command_id=$1",[oldPending.commandId]);
    const heldOld=await repo.admit(actor,JSON.stringify(make()));
    await db.query("UPDATE candidate_profile_commands SET created_at=clock_timestamp()-interval '31 days' WHERE command_id=$1",[heldOld.commandId]);
    await db.query("UPDATE candidate_profile_outbox SET state='held',safe_reason='retry_exhausted' WHERE command_id=$1",[heldOld.commandId]);
    const recent=await repo.admit(actor,JSON.stringify(make()));
    expect((await db.query('SELECT flow_candidate_profile_redact_due() result')).rows[0].result).toEqual({redacted:3,awaitingExpiry:2});
    for(const id of [oldAck.commandId,oldPending.commandId,heldOld.commandId]){
     const row=(await db.query('SELECT body,body_hash,redacted_at FROM candidate_profile_commands WHERE command_id=$1',[id])).rows[0];
     expect(row.body).toBeNull();expect(row.body_hash).toMatch(/^[0-9a-f]{64}$/);expect(row.redacted_at).toBeTruthy();
    }
    expect((await db.query('SELECT body FROM candidate_profile_commands WHERE command_id=$1',[recent.commandId])).rows[0].body).toBeTruthy();
    expect((await repo.readCommand(reader,oldAck.commandId)).status).toBe('applied');
    expect(await repo.admit(actor,JSON.stringify(oldAckRequest))).toMatchObject({commandId:oldAck.commandId,status:'applied'});
    await repo.finish(oldLease,{state:'applied',receipt:{...receipt,commandId:oldLease.commandId,commandHash:oldLease.hash}});
    const expired=(await db.query('SELECT state,safe_reason,lease_token FROM candidate_profile_outbox WHERE command_id=$1',[oldPending.commandId])).rows[0];
    expect(expired).toEqual({state:'held',safe_reason:'expiry_reconciling',lease_token:null});
    const pendingExpiry=(await db.query('SELECT flow_candidate_profile_expiry_pending() result')).rows[0].result;
    expect(pendingExpiry).toHaveLength(2);
    expect(pendingExpiry.every((x:any)=>!('body' in x))).toBe(true);
    const heldIdentity=pendingExpiry.find((x:any)=>x.commandId===heldOld.commandId);
    const expiredReceipt={...receipt,commandId:heldOld.commandId,commandHash:heldIdentity.commandHash,status:'rejected',reason:'command_expired'};
    await expect(db.query('SELECT flow_candidate_profile_expiry_finish($1,$2)',[heldOld.commandId,JSON.stringify({...expiredReceipt,subjectId:randomUUID()})])).rejects.toThrow('invalid_request');
    expect((await db.query('SELECT flow_candidate_profile_expiry_finish($1,$2) result',[heldOld.commandId,JSON.stringify(expiredReceipt)])).rows[0].result).toEqual({applied:true});
    expect(await repo.readCommand(reader,heldOld.commandId)).toMatchObject({status:'rejected',reason:'command_expired'});
    expect((await db.query('SELECT flow_candidate_profile_expiry_finish($1,$2) result',[heldOld.commandId,JSON.stringify(expiredReceipt)])).rows[0].result).toEqual({applied:false});
    // A lost receipt is reconciled as applied, not falsely presented as expired.
    expect((await db.query('SELECT flow_candidate_profile_expiry_finish($1,$2) result',[oldPending.commandId,JSON.stringify({...receipt,commandId:oldLease.commandId,commandHash:oldLease.hash})])).rows[0].result).toEqual({applied:true});
    expect((await repo.readCommand(reader,oldPending.commandId)).status).toBe('applied');
    expect((await db.query('SELECT flow_candidate_profile_expiry_pending() result')).rows[0].result).toEqual([]);
    expect((await db.query('SELECT flow_candidate_profile_redact_due() result')).rows[0].result).toEqual({redacted:0,awaitingExpiry:0});
    expect((await repo.claim(20)).map((l:any)=>l.commandId)).toEqual([recent.commandId]);
   }
   console.log('Retained full-schema S2 Flow fixture',database);
  }finally{await app.end();await db.end();}
 },120000);
});
