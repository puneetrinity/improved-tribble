import {describe,it,expect,vi} from 'vitest';
import {Client} from 'pg';
import {createHash,randomUUID} from 'node:crypto';
import {drizzle} from 'drizzle-orm/node-postgres';
import {sql} from 'drizzle-orm';
import {draftIntentHash,intentPurposes} from './contracts';
import {captureOptionalIntent} from './guest-intent';

const socket=process.env.CANDIDATE_FOUNDATION_TEST_SOCKET;
const database=process.env.CANDIDATE_FOUNDATION_FLOW_TEST_DATABASE;
const port=Number(process.env.CANDIDATE_FOUNDATION_TEST_PORT);
describe.skipIf(!database)('foundation full-schema intent lifecycle',()=>{
 it.each(['delete_first','claim_first'] as const)('serializes the actual claim/delete race: %s',async(order)=>{
  const suffix=database?.match(/^flow_schema_control_test_([a-f0-9]{10})$/)?.[1];
  if(!suffix || !socket?.startsWith('/tmp/candidate-s1-') || !Number.isInteger(port))throw Error('disposable_only');
  const owner=new Client({host:socket,port,user:`flow_schema_control_test_owner_${suffix}`,database});
  const runtime=new Client({host:socket,port,user:`flow_schema_control_test_runtime_${suffix}`,database});
  const observer=new Client({host:socket,port,user:'ews',database});
  await owner.connect();await runtime.connect();await observer.connect();
  const id=300_000_000+parseInt(randomUUID().replaceAll('-','').slice(0,6),16);
  const password=createHash('sha256').update('synthetic').digest('hex');
  const blocked=async(pid:number)=>{
    for(let attempt=0;attempt<200;attempt++){
      if((await observer.query('SELECT cardinality(pg_blocking_pids($1))>0 blocked',[pid])).rows[0].blocked)return;
      await new Promise(done=>setTimeout(done,5));
    }
    throw Error('expected_actual_lock_wait');
  };
  try{
    await owner.query("INSERT INTO users(id,username,password,role,email_verified,auth_version,first_name,last_name) VALUES($1,$2,'synthetic','candidate',true,1,'Synthetic','Race')",[id,`race-${id}@example.invalid`]);
    await owner.query("INSERT INTO organizations(id,name,slug) VALUES($1,'Synthetic',$2)",[id,`race-${id}`]);
    await owner.query("INSERT INTO jobs(id,organization_id,title,location,type,description,posted_by,status) VALUES($1,$1,'Synthetic','Remote','full-time','Synthetic',$1,'pending')",[id]);
    await owner.query("INSERT INTO applications(id,organization_id,job_id,user_id,name,email,phone,resume_url,status) VALUES($1,$1,$1,$1,'Synthetic',$2,'000','gs://synthetic/race.pdf','submitted')",[id,`race-${id}@example.invalid`]);
    await runtime.query('SELECT flow_candidate_foundation_ensure($1,1,$2,clock_timestamp(),$3)',[id,password,randomUUID()]);
    await runtime.query("SELECT flow_candidate_foundation_intent('guest',$1,$2,1,$3,$4::jsonb)",[id,randomUUID(),draftIntentHash,JSON.stringify(intentPurposes)]);
    const intent=(await owner.query('SELECT intent_id FROM candidate_network_intents WHERE application_id=$1',[id])).rows[0].intent_id;
    const runtimePid=(await runtime.query('SELECT pg_backend_pid() pid')).rows[0].pid;
    const ownerPid=(await owner.query('SELECT pg_backend_pid() pid')).rows[0].pid;
    if(order==='delete_first'){
      await owner.query('BEGIN');await owner.query('DELETE FROM applications WHERE id=$1',[id]);
      const claim=runtime.query('SELECT flow_candidate_foundation_claim_intent($1,1,$2,clock_timestamp(),$3)',[id,password,intent]).then(()=>({code:'unexpected_success'}),error=>error);
      await blocked(runtimePid);await owner.query('COMMIT');
      expect(await claim).toMatchObject({code:'P0002',message:'not_found'});
    }else{
      await runtime.query('BEGIN');
      await runtime.query('SELECT flow_candidate_foundation_claim_intent($1,1,$2,clock_timestamp(),$3)',[id,password,intent]);
      const deletion=owner.query('DELETE FROM applications WHERE id=$1',[id]);
      await blocked(ownerPid);await runtime.query('COMMIT');await deletion;
    }
    expect((await owner.query('SELECT state,application_id,identity_email_sha256,claimed_subject_id FROM candidate_network_intents WHERE intent_id=$1',[intent])).rows[0])
      .toEqual({state:'cancelled',application_id:null,identity_email_sha256:null,claimed_subject_id:null});
    expect((await owner.query('SELECT event_id FROM candidate_consent_events WHERE user_id=$1',[id])).rows).toEqual([]);
  }finally{
    await runtime.query('ROLLBACK');await owner.query('ROLLBACK');
    await runtime.end();await owner.end();await observer.end();
  }
 },30000);
 it('isolates optional capture failure in a real savepoint and rolls successful capture back with signup',async()=>{
  const suffix=database?.match(/^flow_schema_control_test_([a-f0-9]{10})$/)?.[1];
  if(!suffix || !socket?.startsWith('/tmp/candidate-s1-') || !Number.isInteger(port))throw Error('disposable_only');
  const owner=`flow_schema_control_test_owner_${suffix}`;
  const conn=new Client({host:socket,port,user:'ews',database});await conn.connect();
  const db=drizzle(conn),id=200_000_000+parseInt(randomUUID().replaceAll('-','').slice(0,6),16);
  vi.stubEnv('CANDIDATE_FOUNDATION_ENABLED','true');vi.stubEnv('CANDIDATE_FOUNDATION_DISPOSABLE_TEST','1');
  const intent={copyVersion:1,copySha256:draftIntentHash,accepted:true};
  try{
    await db.transaction(async tx=>{
      await tx.execute(sql.raw(`SET LOCAL ROLE ${owner}`));
      await tx.execute(sql`INSERT INTO users(id,username,password,role,email_verified,first_name,last_name) VALUES(${id},${`savepoint-${id}@example.invalid`},'synthetic','candidate',false,'Synthetic','Savepoint')`);
      // Missing application causes a real routine error, not a mocked throw.
      expect(await captureOptionalIntent(tx,'guest',-1,intent)).toBe('not_recorded');
      expect((await tx.execute(sql`SELECT id FROM users WHERE id=${id}`)).rows).toHaveLength(1);
      expect(await captureOptionalIntent(tx,'signup',id,intent)).toBe('recorded');
    });
    expect((await conn.query('SELECT state FROM candidate_network_intents WHERE signup_user_id=$1',[id])).rows).toEqual([{state:'pending'}]);
    await expect(db.transaction(async tx=>{
      await tx.execute(sql.raw(`SET LOCAL ROLE ${owner}`));
      await tx.execute(sql`INSERT INTO users(id,username,password,role,email_verified,first_name,last_name) VALUES(${id+1},${`rollback-${id}@example.invalid`},'synthetic','candidate',false,'Synthetic','Rollback')`);
      expect(await captureOptionalIntent(tx,'signup',id+1,intent)).toBe('recorded');
      throw Error('synthetic_outer_rollback');
    })).rejects.toThrow('synthetic_outer_rollback');
    expect((await conn.query('SELECT id FROM users WHERE id=$1',[id+1])).rows).toEqual([]);
    expect((await conn.query('SELECT intent_id FROM candidate_network_intents WHERE signup_user_id=$1',[id+1])).rows).toEqual([]);
    expect((await conn.query('SELECT event_id FROM candidate_consent_events WHERE user_id=ANY($1::int[])',[[id,id+1]])).rows).toEqual([]);
  }finally{vi.unstubAllEnvs();await conn.end();}
 },30000);
 it('keeps immutable retries, held successors and stale lease completions fenced',async()=>{
  const suffix=database?.match(/^flow_schema_control_test_([a-f0-9]{10})$/)?.[1];
  if(!suffix || !socket?.startsWith('/tmp/candidate-s1-') || !Number.isInteger(port))throw Error('disposable_only');
  const owner=`flow_schema_control_test_owner_${suffix}`,runtime=`flow_schema_control_test_runtime_${suffix}`;
  const conn=new Client({host:socket,port,user:'ews',database});await conn.connect();
  try{
    await conn.query('BEGIN');await conn.query(`SET LOCAL ROLE ${owner}`);
    // Retained race/E2E fixtures may have pending work. Isolate this test's due
    // queue inside the rolled-back transaction without deleting their evidence.
    await conn.query("UPDATE candidate_product_outbox SET next_attempt_at='infinity' WHERE state IN ('queued','retry')");
    await conn.query("INSERT INTO users(id,username,password,role,email_verified,auth_version,first_name,last_name) VALUES(99004,'queue@example.invalid','synthetic','candidate',true,1,'Synthetic','Queue')");
    const invoke=async(text:string,args:unknown[]=[])=>{
      await conn.query('RESET ROLE');await conn.query(`SET LOCAL ROLE ${runtime}`);
      try{return (await conn.query(text,args)).rows[0].result;}finally{await conn.query('RESET ROLE');await conn.query(`SET LOCAL ROLE ${owner}`);}
    };
    const password=createHash('sha256').update('synthetic').digest('hex');
    const ensure=(key=randomUUID())=>invoke('SELECT flow_candidate_foundation_ensure(99004,1,$1,clock_timestamp(),$2) result',[password,key]);
    const claim=()=>invoke('SELECT flow_candidate_foundation_claim_delivery($1) result',[randomUUID()]);
    const finish=(row:any,outcome:string,body:unknown)=>invoke('SELECT flow_candidate_foundation_finish_delivery($1,$2,$3,$4,$5::jsonb) result',[row.commandId,row.leaseToken,row.leaseGeneration,outcome,JSON.stringify(body)]);
    const receipt=(row:any)=>({schemaVersion:1,commandId:row.commandId,subjectId:row.subjectId,bindingId:row.bindingId,sequence:row.sequence,wireSha256:row.wireSha256,outcome:'subject_ready',profileVersion:0,preferenceVersion:0,publicationActive:false});
    const key=randomUUID(),one=await ensure(key);expect(await ensure(key)).toEqual(one);
    const two=await ensure(),first=await claim();expect(first.commandId).toBe(one.commandId);expect(await claim()).toBeNull();
    expect(await finish(first,'remote_denied',{})).toEqual({applied:true});
    const second=await claim();expect(second.commandId).toBe(two.commandId);expect(second.sequence).toBe(2);
    expect(await finish(second,'acknowledged',receipt(second))).toEqual({applied:true});
    expect(await finish(first,'acknowledged',receipt(first))).toEqual({applied:false});
    const three=await ensure(),third=await claim();expect(third.commandId).toBe(three.commandId);
    // Simulate process loss after dispatch: only a new valid lease can finish.
    await conn.query("UPDATE candidate_product_outbox SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE command_id=$1",[third.commandId]);
    const recovered=await claim();expect(recovered.wireBody).toBe(third.wireBody);expect(recovered.wireSha256).toBe(third.wireSha256);
    expect(recovered.leaseGeneration).toBeGreaterThan(third.leaseGeneration);
    expect(await finish(third,'acknowledged',receipt(third))).toEqual({applied:false});
    expect(await finish(recovered,'network',{})).toEqual({applied:true});expect(await claim()).toBeNull();
    await conn.query("UPDATE candidate_product_outbox SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE command_id=$1",[third.commandId]);
    const retried=await claim();expect(retried.wireBody).toBe(third.wireBody);
    await finish(retried,'acknowledged',{...receipt(retried),bindingId:randomUUID()});
    expect((await invoke('SELECT flow_candidate_foundation_command_read(99004,1,$1) result',[third.commandId])).reason).toBe('invalid_response');
    expect((await invoke('SELECT flow_candidate_foundation_read(99004,1) result')).state).toBe('linked');
    const fourthCommand=await ensure(),fourth=await claim();expect(fourth.commandId).toBe(fourthCommand.commandId);
    await conn.query('UPDATE users SET auth_version=2 WHERE id=99004');
    await finish(fourth,'acknowledged',receipt(fourth));
    expect((await conn.query('SELECT state,safe_reason FROM candidate_product_commands WHERE command_id=$1',[fourth.commandId])).rows[0]).toEqual({state:'held',safe_reason:'identity_changed'});
    expect((await conn.query('SELECT count(*)::int n FROM candidate_consent_events WHERE user_id=99004')).rows[0].n).toBe(0);
  }finally{await conn.query('ROLLBACK');await conn.end();}
 },30000);
 it('preserves withdrawal/deletion, ownership-before-expiry, normalized identity and zero effective consent',async()=>{
  const suffix=database?.match(/^flow_schema_control_test_([a-f0-9]{10})$/)?.[1];
  if(!suffix || !socket?.startsWith('/tmp/candidate-s1-') || !Number.isInteger(port))throw Error('disposable_only');
  const owner=`flow_schema_control_test_owner_${suffix}`,runtime=`flow_schema_control_test_runtime_${suffix}`;
  const conn=new Client({host:socket,port,user:'ews',database});await conn.connect();
  try {
    await conn.query('BEGIN');
    await conn.query(`SET LOCAL ROLE ${owner}`);
    await conn.query(`INSERT INTO users(id,username,password,role,email_verified,auth_version,first_name,last_name) VALUES
      (99001,'candidate@example.invalid','synthetic','candidate',true,1,'Synthetic','One'),
      (99002,'other@example.invalid','synthetic','candidate',true,1,'Synthetic','Other');
      INSERT INTO organizations(id,name,slug,settings,is_active) VALUES(99001,'Synthetic','s1-synthetic','{}',true);
      INSERT INTO jobs(id,organization_id,title,location,type,description,posted_by,is_active,status,slug)
      VALUES(99001,99001,'Synthetic','Remote','full-time','Synthetic',99002,false,'pending','s1-synthetic'),
        (99002,99001,'Synthetic two','Remote','full-time','Synthetic',99002,false,'pending','s1-synthetic-two');`);
    const password=createHash('sha256').update('synthetic').digest('hex');
    const asRuntime=async(sql:string,args:unknown[]=[])=>{
      await conn.query('RESET ROLE');await conn.query(`SET LOCAL ROLE ${runtime}`);
      const result=await conn.query(sql,args);
      await conn.query('RESET ROLE');await conn.query(`SET LOCAL ROLE ${owner}`);
      return result;
    };
    for(const user of [99001,99002]) await asRuntime('SELECT flow_candidate_foundation_ensure($1,1,$2,clock_timestamp(),$3)',[user,password,randomUUID()]);
    const insert=async(id:number,linked=true)=>{
      await conn.query(`INSERT INTO applications(id,organization_id,job_id,user_id,name,email,phone,resume_url,status,submitted_by_recruiter,whatsapp_consent,platform_discovery_consent)
        VALUES($1,99001,$2,$3,'Synthetic',' Candidate@Example.Invalid ','000','gs://synthetic/fixture.pdf','submitted',false,false,false)`,[id,id===99003?99002:99001,linked?99001:null]);
      await asRuntime('SELECT flow_candidate_foundation_intent($1,$2,$3,1,$4,$5::jsonb)',
        ['guest',id,randomUUID(),draftIntentHash,JSON.stringify(intentPurposes)]);
      return (await conn.query('SELECT intent_id FROM candidate_network_intents WHERE application_id=$1',[id])).rows[0].intent_id;
    };
    const claimed=await insert(99001,false);
    await conn.query('SAVEPOINT unowned_guest');
    await expect(asRuntime('SELECT flow_candidate_foundation_claim_intent(99001,1,$1,clock_timestamp(),$2) result',[password,claimed])).rejects.toThrow('not_found');
    await conn.query('ROLLBACK TO SAVEPOINT unowned_guest');
    await conn.query('UPDATE applications SET user_id=99001 WHERE id=99001');
    await conn.query("UPDATE users SET username='changed@example.invalid' WHERE id=99001");
    await conn.query('SAVEPOINT changed_email');
    await expect(asRuntime('SELECT flow_candidate_foundation_claim_intent(99001,1,$1,clock_timestamp(),$2) result',[password,claimed])).rejects.toThrow('not_found');
    await conn.query('ROLLBACK TO SAVEPOINT changed_email');
    await conn.query("UPDATE users SET username='candidate@example.invalid' WHERE id=99001");
    await conn.query('SAVEPOINT nullable_verification_old_rule');
    const definition=(await conn.query("SELECT pg_get_functiondef('flow_candidate_foundation_claim_intent(integer,integer,text,timestamptz,uuid)'::regprocedure) definition")).rows[0].definition as string;
    expect(definition).toContain('u.email_verified IS NOT TRUE');
    await conn.query(definition.replace('u.email_verified IS NOT TRUE','NOT u.email_verified'));
    await conn.query('UPDATE users SET email_verified=NULL WHERE id=99001');
    expect((await asRuntime('SELECT flow_candidate_foundation_claim_intent(99001,1,$1,clock_timestamp(),$2) result',[password,claimed])).rows[0].result.status).toBe('claimed');
    await conn.query('ROLLBACK TO SAVEPOINT nullable_verification_old_rule');
    // SQL authority must refuse both false and unknown verification, even when
    // an account binding already exists (bypassing HTTP middleware).
    for(const verified of [false,null]){
      await conn.query('SAVEPOINT verification_state');
      await conn.query('UPDATE users SET email_verified=$1 WHERE id=99001',[verified]);
      await expect(asRuntime('SELECT flow_candidate_foundation_claim_intent(99001,1,$1,clock_timestamp(),$2) result',[password,claimed]))
        .rejects.toMatchObject({code:'42501',message:'identity_changed'});
      await conn.query('ROLLBACK TO SAVEPOINT verification_state');
      expect((await conn.query('SELECT state FROM candidate_network_intents WHERE intent_id=$1',[claimed])).rows[0].state).toBe('pending');
    }
    expect((await asRuntime('SELECT flow_candidate_foundation_claim_intent(99001,1,$1,clock_timestamp(),$2) result',[password,claimed])).rows[0].result)
      .toEqual({schemaVersion:1,status:'claimed',requiresConfirmation:true,publicationActive:false});
    await conn.query('DELETE FROM applications WHERE id=99001');
    const cancelled=(await conn.query('SELECT * FROM candidate_network_intents WHERE intent_id=$1',[claimed])).rows[0];
    expect(cancelled).toMatchObject({state:'cancelled',application_id:null,signup_user_id:null,identity_email_sha256:null,
      request_id:null,request_sha256:null,claimed_subject_id:null,claimed_at:null,cancellation_reason:'application_deleted'});
    await conn.query('SAVEPOINT deleted_replay');
    await expect(asRuntime('SELECT flow_candidate_foundation_claim_intent(99001,1,$1,clock_timestamp(),$2) result',[password,claimed])).rejects.toThrow('not_found');
    await conn.query('ROLLBACK TO SAVEPOINT deleted_replay');
    const expired=await insert(99002);
    await conn.query("UPDATE candidate_network_intents SET captured_at=statement_timestamp()-interval '8 days',expires_at=statement_timestamp()-interval '1 day' WHERE intent_id=$1",[expired]);
    for(const [user,marker] of [[99002,'not_found'],[99001,'intent_expired']] as const){
      await conn.query('SAVEPOINT expected_error');
      await conn.query('RESET ROLE');
      await conn.query(`SET LOCAL ROLE ${runtime}`);
      await expect(conn.query('SELECT flow_candidate_foundation_claim_intent($1,1,$2,clock_timestamp(),$3)',[user,password,expired])).rejects.toThrow(marker);
      await conn.query('ROLLBACK TO SAVEPOINT expected_error');
    }
    const pending=await insert(99003);
    // Negative control: restoring the rejected FK design blocks withdrawal.
    await conn.query('SAVEPOINT old_intent_design');
    await conn.query('ALTER TABLE candidate_network_intents DROP CONSTRAINT candidate_network_intents_application_id_fkey');
    await conn.query('ALTER TABLE candidate_network_intents ADD CONSTRAINT candidate_network_intents_application_id_fkey FOREIGN KEY(application_id) REFERENCES applications(id) ON DELETE RESTRICT');
    await conn.query('ALTER TABLE applications DISABLE TRIGGER candidate_foundation_application_delete');
    await expect(conn.query('DELETE FROM applications WHERE id=99003')).rejects.toMatchObject({code:'23503'});
    await conn.query('ROLLBACK TO SAVEPOINT old_intent_design');
    // Existing application ownership deliberately blocks direct org deletion.
    // Remove its applications/jobs first; S1 must add no additional blocker.
    await conn.query('DELETE FROM applications WHERE organization_id=99001');
    await conn.query('DELETE FROM jobs WHERE organization_id=99001');
    await conn.query('DELETE FROM organizations WHERE id=99001');
    expect((await conn.query('SELECT state,application_id,identity_email_sha256 FROM candidate_network_intents WHERE intent_id=ANY($1::uuid[])',[[pending,expired]])).rows)
      .toEqual(expect.arrayContaining([{state:'cancelled',application_id:null,identity_email_sha256:null}]));
    expect((await conn.query('SELECT count(*)::int n FROM candidate_consent_events WHERE user_id IN(99001,99002)')).rows[0].n).toBe(0);
    expect((await conn.query('SELECT version,desired_action FROM candidate_consent_subjects WHERE user_id=99001')).rows[0])
      .toEqual({version:'0',desired_action:null});
  }finally{await conn.query('ROLLBACK');await conn.end();}
 },30000);
});
