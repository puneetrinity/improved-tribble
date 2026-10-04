import { randomUUID } from 'node:crypto';
import { Client, Pool } from 'pg';
import { retireJobCycle } from '../commands';
import { copyFileSync,mkdtempSync,readFileSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import {runReleaseMigration} from '../../schema-control/runner';
import {loadManifest} from '../../schema-control/manifest';
import {provisionRuntimeRole} from '../../schema-control/runtimeRole';
import {assertSchemaReady,FLOW_CRITICAL_POSTCONDITIONS,jobBriefPrivilegesReady} from '../../schema-control/readiness';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sourceHash } from '../contracts';
import {persistWorkerDigest,type JDDigest} from '../../lib/jdDigest';

const enabled=process.env.FLOW_BRIEF_DISPOSABLE==='1';
const ownerUrl=process.env.FLOW_BRIEF_OWNER_URL??'';
const runtimeUrl=process.env.FLOW_BRIEF_RUNTIME_URL??'';
const jd='Build Python services.';
const criterion={id:'10000000-0000-4000-8000-000000000001',label:'Python',class:'must_have',subject:'skill',requirement:{kind:'text',value:'Python'},evidenceKinds:['profile_evidence'],use:'assessment',provenance:{kind:'jd',sourceHash:sourceHash(jd),start:6,end:12}};
const payload={schemaVersion:1,compilerVersion:1,taxonomyVersion:1,criteria:[criterion]};
const save={action:'save_brief',currentJD:jd,payload,sourceChoice:'original_prose',requesterKind:'recruiter',reasonCode:'other'};
function checkTarget(raw:string) {
  const u=new URL(raw);
  if (!['127.0.0.1','localhost','[::1]'].includes(u.hostname) || !u.pathname.endsWith('_test') || !decodeURIComponent(u.username).endsWith('_test')) throw Error('DISPOSABLE_TARGET_REQUIRED');
}
describe.skipIf(!enabled)('brief restricted-role PostgreSQL contract',()=>{
  let owner:Client; let runtime:Client;
  const call=async(sql:string,args:unknown[]=[])=> (await runtime.query(sql,args)).rows[0]?.result;
  const saveVersion=async(request=randomUUID(),revision=0,command:unknown=save)=>call('SELECT flow_job_brief_save(90001,90001,90001,$1,$2,$3::jsonb) result',[request,revision,command]);
  const read=()=>call('SELECT flow_job_brief_read(90001,90001,90001) result');
  beforeAll(async()=>{
    checkTarget(ownerUrl);checkTarget(runtimeUrl);
    owner=new Client({connectionString:ownerUrl});runtime=new Client({connectionString:runtimeUrl});
    await owner.connect();await runtime.connect();
    for(const c of [owner,runtime]) {
      const r=await c.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user');
      expect(r.rows[0]).toEqual({rolsuper:false,rolbypassrls:false});
    }
    if(!(await owner.query("SELECT to_regclass('public.jobs') present")).rows[0].present) {
      // Exercise the actual shipped ledger14 -> 15 release, not hand-written
      // test DDL or a superuser runtime. Only a fresh explicitly local DB enters.
      const migrations=resolve('server/schema-migrations'),base=mkdtempSync(join(tmpdir(),'brief-ledger14-'));
      const connect=async(url:string)=>{const c=new Client({connectionString:url});await c.connect();return c;};
      const release=(migrationsDir:string)=>runReleaseMigration({migrationsDir,creds:{migrateUrl:ownerUrl,expectedTargetId:'brief-ci-test',environment:'development',allowFreshInitialization:true},connect});
      try {
        const lock=JSON.parse(readFileSync(join(migrations,'checksums.lock'),'utf8'));delete lock.migrations['0014'];
        for(const entry of loadManifest(migrations).filter(e=>Number(e.version)<14))copyFileSync(join(migrations,entry.file),join(base,entry.file));
        copyFileSync(join(migrations,'catalog.lock.json'),join(base,'catalog.lock.json'));writeFileSync(join(base,'checksums.lock'),JSON.stringify(lock));
        expect((await release(base)).applied).toHaveLength(14);
        const prior=(await owner.query('SELECT row_to_json(a) value FROM schema_control.applied a ORDER BY version')).rows;
        expect((await release(migrations)).applied).toEqual(['0014']);
        expect((await owner.query("SELECT row_to_json(a) value FROM schema_control.applied a WHERE version<'0014' ORDER BY version")).rows).toEqual(prior);
        expect((await release(migrations)).applied).toEqual([]);
        await provisionRuntimeRole({migrateUrl:ownerUrl,runtimeUrl,runtimeRole:new URL(runtimeUrl).username,expectedTargetId:'brief-ci-test',connectMigration:connect,connectRuntime:connect});
        await assertSchemaReady({pg:runtime,migrationsDir:migrations,environment:'development',expectedTargetId:'brief-ci-test',criticalPostconditions:FLOW_CRITICAL_POSTCONDITIONS});
        expect(await jobBriefPrivilegesReady(runtime,new URL(runtimeUrl).username,true)).toBe(true);
        await owner.query("INSERT INTO users(id,username,password,role,email_verified) VALUES(90001,'recruiter@fixture.invalid','unusable','recruiter',true),(90002,'other@fixture.invalid','unusable','recruiter',true),(90003,'candidate@fixture.invalid','unusable','candidate',true),(90004,'admin@fixture.invalid','unusable','super_admin',true)");
        await owner.query("INSERT INTO organizations(id,name,slug,is_active) VALUES(90001,'Brief fixture','brief-fixture',true),(90002,'Other fixture','other-fixture',true)");
        await owner.query("INSERT INTO organization_members(organization_id,user_id,role,seat_assigned) VALUES(90001,90001,'owner',true),(90002,90002,'owner',true)");
        await owner.query("INSERT INTO jobs(id,organization_id,posted_by,title,location,type,description,original_jd,status,is_active) VALUES(90001,90001,90001,'Backend engineer','Bengaluru','full-time','{\"roleTitle\":\"private\"}','Build Python services.','approved',false)");
      } finally {rmSync(base,{recursive:true,force:true});}
    }
    expect((await owner.query("SELECT to_regclass('public.job_brief_state') present")).rows[0].present).not.toBeNull();
  },120_000);
  beforeEach(async()=>{await runtime.query('BEGIN');await runtime.query("SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='5s'");});
  afterEach(async()=>{await runtime.query('ROLLBACK');});
  afterAll(async()=>{await runtime?.end();await owner?.end();});
  it('reads an uninitialized job without creating state',async()=>{
    expect(await read()).toMatchObject({revision:'0',currentJD:null,latest:null});
    expect((await owner.query('SELECT count(*)::integer n FROM job_brief_state WHERE organization_id=90001 AND job_id=90001')).rows[0].n).toBe(0);
  });
  it('does not grant candidates, foreign recruiters or admins brief authority',async()=>{
    for(const actor of [90002,90003,90004]) expect(await call('SELECT flow_job_brief_read(90001,90001,$1) result',[actor])).toBeNull();
    expect(await call('SELECT flow_job_brief_read(90002,90001,90001) result')).toBeNull();
  });
  it('denies direct reads and writes to all four tables',async()=>{
    for(const table of ['job_brief_state','job_brief_versions','job_brief_events','job_brief_draft_requests']) {
      const r=await runtime.query("SELECT has_table_privilege(current_user,$1,'SELECT') s,has_table_privilege(current_user,$1,'INSERT') i,has_table_privilege(current_user,$1,'UPDATE') u,has_table_privilege(current_user,$1,'DELETE') d,has_table_privilege(current_user,$1,'TRUNCATE') t",[table]);
      expect(r.rows[0]).toEqual({s:false,i:false,u:false,d:false,t:false});
    }
  });
  it('composite version pointers cannot reference another job in the same organization',async()=>{
    await owner.query('BEGIN');
    try {
      const first=(await owner.query('SELECT flow_job_brief_save(90001,90001,90001,$1,0,$2) result',[randomUUID(),save])).rows[0].result;
      const other=(await owner.query("INSERT INTO jobs(organization_id,posted_by,title,location,type,description,status,is_active) VALUES(90001,90001,'Other fixture','Test','full-time','Test prose','approved',false) RETURNING id")).rows[0].id;
      await owner.query('INSERT INTO job_brief_state(organization_id,job_id) VALUES(90001,$1)',[other]);
      await expect(owner.query('UPDATE job_brief_state SET latest_version_id=$1 WHERE job_id=$2',[first.versionId,other]))
        .rejects.toMatchObject({code:'23503'});
    } finally {await owner.query('ROLLBACK');}
  });
  it('the actual storage deletion entrypoint refuses before deleting applications',async()=>{
    const prior=process.env.DATABASE_URL;process.env.DATABASE_URL=runtimeUrl;
    try {
      const {storage}=await import('../../storage');
      const {pool:storagePool}=await import('../../db');
      try {
        const before=(await owner.query('SELECT id FROM applications WHERE job_id=90001 ORDER BY id')).rows;
        await expect(storage.deleteJob(90001)).rejects.toThrow('JOB_PERMANENT_DELETION_DISABLED');
        expect((await owner.query('SELECT id FROM applications WHERE job_id=90001 ORDER BY id')).rows).toEqual(before);
        expect((await owner.query('SELECT id FROM jobs WHERE id=90001')).rowCount).toBe(1);
      } finally {await storagePool.end();}
    } finally {if(prior===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=prior;}
  });
  it('retained brief evidence prevents owner deletion of its job and actor',async()=>{
    await owner.query('BEGIN');
    try {
      await owner.query('SELECT flow_job_brief_save(90001,90001,90001,$1,0,$2)',[randomUUID(),save]);
      for(const statement of ['DELETE FROM jobs WHERE id=90001','DELETE FROM users WHERE id=90001']) {
        await owner.query('SAVEPOINT deletion');
        await expect(owner.query(statement)).rejects.toMatchObject({code:'23503'});
        await owner.query('ROLLBACK TO SAVEPOINT deletion');
      }
    } finally {await owner.query('ROLLBACK');}
  });
  it('saves without publishing or approving, then approves without publishing',async()=>{
    const saved=await saveVersion();expect(saved.revision).toBe('1');expect(saved.approvedVersionId).toBeNull();
    const approval=await call('SELECT flow_job_brief_approve(90001,90001,90001,$1,1,$2,$3) result',[randomUUID(),saved.versionId,sourceHash('approval')]);
    expect(approval).toMatchObject({revision:'2',approvedVersionId:saved.versionId});
    expect((await owner.query('SELECT is_active FROM jobs WHERE id=90001')).rows[0].is_active).toBe(false);
  });
  it('replays a lost-response command exactly once',async()=>{
    const request=randomUUID();const first=await saveVersion(request);expect(await saveVersion(request)).toEqual(first);
    expect((await read()).revision).toBe('1');
    const history=await call('SELECT flow_job_brief_history(90001,90001,90001,NULL,NULL,50) result');
    expect(history).toHaveLength(1);expect(history[0].timing).toBe('unknown');
  });
  it('refuses reused request identity with different content',async()=>{
    const request=randomUUID();await saveVersion(request);
    await expect(saveVersion(request,0,{...save,note:'Different'})).rejects.toThrow('BRIEF_REQUEST_CONFLICT');
  });
  it('refuses stale revisions',async()=>{await saveVersion();await expect(saveVersion()).rejects.toThrow('BRIEF_REVISION_CONFLICT');});
  it('refuses an experience maximum through the SQL entrypoint',async()=>{
    await expect(saveVersion(randomUUID(),0,{...save,payload:{...payload,criteria:[{...criterion,requirement:{kind:'minimum_years',minimum:3,maximum:8},subject:'experience_years'}]}})).rejects.toThrow('BRIEF_INVALID_PAYLOAD');
  });
  it('refuses publication without approval',async()=>{
    await expect(saveVersion(randomUUID(),0,{action:'publish'})).rejects.toThrow('BRIEF_APPROVAL_REQUIRED');
  });
  it('C3 refuses an experience disqualifier at the SQL boundary',async()=>{
    await expect(saveVersion(randomUUID(),0,{...save,payload:{...payload,criteria:[{...criterion,subject:'experience_years',class:'disqualifier',requirement:{kind:'minimum_years',minimum:10}}]}})).rejects.toThrow('BRIEF_INVALID_PAYLOAD');
  });
  it('C7 fences the actual worker digest writer across canonical and legacy source changes',async()=>{
    const input={id:90001,title:'Backend engineer',location:'Bengaluru',currentJDHash:null as string|null};
    const digest={version:3,topSkills:['Python']} as JDDigest;
    expect(await persistWorkerDigest(runtime,input,digest)).toBe(true);
    await saveVersion();
    expect(await persistWorkerDigest(runtime,input,digest)).toBe(false);
    input.currentJDHash=sourceHash(jd);
    expect(await persistWorkerDigest(runtime,input,digest)).toBe(true);
    await runtime.query("UPDATE jobs SET title='Changed title' WHERE id=90001");
    expect(await persistWorkerDigest(runtime,input,digest)).toBe(false);
  });
  it.each(['age','disability','nationality','national origin','native-speaker','citizenship'])('C4 refuses protected note %s at the SQL boundary',async(note)=>{
    await expect(saveVersion(randomUUID(),0,{...save,payload:{...payload,criteria:[{...criterion,note}]}})).rejects.toThrow('BRIEF_INVALID_PAYLOAD');
  });
  it.each([["No career gaps",false],["Career gap",false],["Married",false],["Marriott hospitality systems experience",true],["unmarried only",false],["Native Hindi speaker",false],["Native English speaker",false],["Native fluent English speaker",false],["US citizens only",false],["Citizen of India",false],["Recent graduate",false],["age limit 30",false],["male candidates only",false],["female applicants preferred",false],["Debug race conditions in Go services",true],["Handle a race condition",true],["Age of Empires modding",true],["male/female connectors",true]])('C4 SQL contextual phrase %s accepted=%s in every text field',async(text,accepted)=>{
    for(const patch of [{label:text},{requirement:{kind:'text',value:text}},{note:text}]) {
      await runtime.query('SAVEPOINT trait_probe');
      const operation=saveVersion(randomUUID(),0,{...save,payload:{...payload,criteria:[{...criterion,...patch}]}});
      if(accepted) await expect(operation).resolves.toHaveProperty('versionId');
      else await expect(operation).rejects.toThrow('BRIEF_INVALID_PAYLOAD');
      await runtime.query('ROLLBACK TO SAVEPOINT trait_probe');
    }
  });
  it('C4 SQL permits citizenship only with the work-eligibility evidence contract',async()=>{
    const c={...criterion,subject:'work_eligibility',label:'Citizen of India',evidenceKinds:['candidate_provided']};
    await runtime.query('SAVEPOINT eligibility');
    await expect(saveVersion(randomUUID(),0,{...save,payload:{...payload,criteria:[c]}})).resolves.toHaveProperty('versionId');
    await runtime.query('ROLLBACK TO SAVEPOINT eligibility');
    await expect(saveVersion(randomUUID(),0,{...save,payload:{...payload,criteria:[{...c,evidenceKinds:['profile_evidence']}]}})).rejects.toThrow('BRIEF_INVALID_PAYLOAD');
  });
  it('C5 requires a new version after a governed title/salary edit',async()=>{
    const version=await saveVersion();
    const changed=await saveVersion(randomUUID(),1,{action:'edit_governed_job',currentJD:jd,sourceChoice:'current_jd',requesterKind:'recruiter',reasonCode:'compensation_changed',patch:{title:'Changed role',salaryMin:1000}});
    expect(changed.revision).toBe('2');
    await runtime.query('SAVEPOINT stale_approval');
    await expect(call('SELECT flow_job_brief_approve(90001,90001,90001,$1,2,$2,$3) result',[randomUUID(),version.versionId,sourceHash('approve')])).rejects.toThrow('BRIEF_REVISION_CONFLICT');
    await runtime.query('ROLLBACK TO SAVEPOINT stale_approval');
    const fresh=await saveVersion(randomUUID(),2,{...save,sourceChoice:'current_jd'});
    expect(fresh.versionId).not.toBe(version.versionId);
    expect(await call('SELECT flow_job_brief_approve(90001,90001,90001,$1,3,$2,$3) result',[randomUUID(),fresh.versionId,sourceHash('approve')])).toMatchObject({approvedVersionId:fresh.versionId});
  });
  it('C8 refuses a foreign hiring manager and client, but permits same-org assignment/clearing',async()=>{
    const foreign=(await runtime.query("INSERT INTO clients(organization_id,name,created_by) VALUES(90002,'Foreign fixture',90002) RETURNING id")).rows[0].id;
    const local=(await runtime.query("INSERT INTO clients(organization_id,name,created_by) VALUES(90001,'Local fixture',90001) RETURNING id")).rows[0].id;
    const edit=(revision:number,patch:unknown)=>saveVersion(randomUUID(),revision,{action:'edit_governed_job',currentJD:jd,sourceChoice:'original_prose',requesterKind:'recruiter',reasonCode:'role_scope_changed',patch});
    for(const patch of [{hiringManagerId:90002},{clientId:foreign}]) {
      await runtime.query('SAVEPOINT assignment');await expect(edit(0,patch)).rejects.toThrow('BRIEF_INVALID_ASSIGNMENT');await runtime.query('ROLLBACK TO SAVEPOINT assignment');
    }
    await edit(0,{hiringManagerId:90001,clientId:local});
    await edit(1,{hiringManagerId:null,clientId:null});
    await runtime.query("INSERT INTO users(id,username,password,role,email_verified) VALUES(90005,'hm@fixture.invalid','unusable','hiring_manager',true)");
    await runtime.query("INSERT INTO hiring_manager_invitations(email,name,token,invited_by,inviter_name,expires_at,status,accepted_at,organization_id,authority_scope,accepted_by_user_id,grant_version) VALUES('hm@fixture.invalid','Fixture HM',$1,90001,'Fixture',now()+interval '1 day','accepted',now(),90001,'organization',90005,2)",[randomUUID()]);
    await edit(2,{hiringManagerId:90005});
  });
  it('A1 lets admins moderate without reading or approving a brief',async()=>{
    const request=randomUUID();
    const command={action:'moderate',status:'approved'};
    const run=()=>call('SELECT flow_job_brief_save(90001,90001,90004,$1,NULL,$2) result',[request,command]);
    const result=await run();expect(result).toMatchObject({revision:'1',action:'moderate',approvedVersionId:null});
    expect(await run()).toEqual(result);
    expect(await call('SELECT flow_job_brief_read(90001,90001,90004) result')).toBeNull();
    expect(await call('SELECT flow_job_brief_history(90001,90001,90004,NULL,NULL,25) result')).toBeNull();
    expect((await read()).revision).toBe('1');
  });
  it('A1 preserves payload-bound replay for admin intents',async()=>{
    const request=randomUUID();
    await call('SELECT flow_job_brief_save(90001,90001,90004,$1,NULL,$2) result',[request,{action:'moderate',status:'approved'}]);
    await expect(call('SELECT flow_job_brief_save(90001,90001,90004,$1,NULL,$2) result',[request,{action:'moderate',status:'declined'}])).rejects.toThrow('BRIEF_REQUEST_CONFLICT');
  });
  it.each(['save_brief','edit_governed_job','publish','deactivate'])('A1 rejects null recruiter revision for %s',async(action)=>{
    await expect(call('SELECT flow_job_brief_save(90001,90001,90001,$1,NULL,$2) result',[randomUUID(),{action}])).rejects.toThrow('BRIEF_REVISION_REQUIRED');
  });
  it('A1 does not let admin publication bypass brief approval',async()=>{
    await expect(call('SELECT flow_job_brief_save(90001,90001,90004,$1,NULL,$2) result',[randomUUID(),{action:'publish'}])).rejects.toThrow('BRIEF_APPROVAL_REQUIRED');
  });
  it('A1 permits approved publication then closure without rewriting the approval',async()=>{
    const first=await saveVersion();
    await call('SELECT flow_job_brief_approve(90001,90001,90001,$1,1,$2,$3) result',[randomUUID(),first.versionId,sourceHash('approve')]);
    const published=await call('SELECT flow_job_brief_save(90001,90001,90004,$1,NULL,$2) result',[randomUUID(),{action:'publish'}]);
    expect(published).toMatchObject({revision:'3',approvedVersionId:first.versionId});
    const closed=await call('SELECT flow_job_brief_save(90001,90001,90004,$1,NULL,$2) result',[randomUUID(),{action:'deactivate',reason:'manual'}]);
    expect(closed).toMatchObject({revision:'4',approvedVersionId:first.versionId});
  });
  it('keeps the original approval on a cosmetic revision, invalidates on material change',async()=>{
    const first=await saveVersion();await call('SELECT flow_job_brief_approve(90001,90001,90001,$1,1,$2,$3) result',[randomUUID(),first.versionId,sourceHash('approve')]);
    const cosmetic=await saveVersion(randomUUID(),2,{...save,note:'Typo cleanup',payload:{...payload,criteria:[{...criterion,label:' Python  '}]}});
    expect(cosmetic.approvedVersionId).toBe(first.versionId);expect(cosmetic.versionId).not.toBe(first.versionId);
    const changed=await saveVersion(randomUUID(),3,{...save,payload:{...payload,criteria:[{...criterion,class:'preferred'}]}});
    expect(changed.approvedVersionId).toBeNull();
  });
  it('bounds keyset history',async()=>{await expect(call('SELECT flow_job_brief_history(90001,90001,90001,NULL,NULL,51) result')).rejects.toThrow('BRIEF_INVALID_PAGE');});
  it('never returns the lease on claim replay',async()=>{
    await saveVersion();const request=randomUUID();
    const args=[request,sourceHash(jd),sourceHash('draft')];
    const first=await call("SELECT flow_job_brief_draft_claim(90001,90001,90001,$1,1,$2,'synthetic-model',$3) result",args);
    expect(first.lease).toMatch(/^[a-f0-9-]{36}$/);
    const replay=await call("SELECT flow_job_brief_draft_claim(90001,90001,90001,$1,1,$2,'synthetic-model',$3) result",args);
    expect(replay.lease).toBeUndefined();expect(replay.state).toBe('dispatched');
  });
  it('settles an exact lease once and never writes a version from a model result',async()=>{
    await saveVersion();const request=randomUUID();
    const claim=await call("SELECT flow_job_brief_draft_claim(90001,90001,90001,$1,1,$2,'synthetic-model',$3) result",[request,sourceHash(jd),sourceHash('draft')]);
    const done=await call('SELECT flow_job_brief_draft_finish($1,$2,$3) result',[request,claim.lease,{state:'succeeded',result:payload,inputTokens:12,outputTokens:45}]);
    expect(done.state).toBe('succeeded');expect((await read()).revision).toBe('1');
    await expect(call('SELECT flow_job_brief_draft_finish($1,$2,$3) result',[request,claim.lease,{state:'succeeded',result:payload}])).rejects.toThrow('BRIEF_DRAFT_SETTLED');
  });
  it('closes late model proposals as stale after an edit',async()=>{
    await saveVersion();const request=randomUUID();
    const claim=await call("SELECT flow_job_brief_draft_claim(90001,90001,90001,$1,1,$2,'synthetic-model',$3) result",[request,sourceHash(jd),sourceHash('draft')]);
    await saveVersion(randomUUID(),1,{...save,note:'New edit'});
    const done=await call('SELECT flow_job_brief_draft_finish($1,$2,$3) result',[request,claim.lease,{state:'succeeded',result:payload}]);
    expect(done).toMatchObject({state:'stale',result:null,code:'BRIEF_DRAFT_STALE'});
  });
  it('does not reset the two-attempt ceiling by rotating request IDs',async()=>{
    await saveVersion();
    for(let n=0;n<2;n++) {
      const request=randomUUID();const claim=await call("SELECT flow_job_brief_draft_claim(90001,90001,90001,$1,1,$2,'synthetic-model',$3) result",[request,sourceHash(jd),sourceHash('draft')]);
      await call('SELECT flow_job_brief_draft_finish($1,$2,$3) result',[request,claim.lease,{state:'failed',code:'BRIEF_MODEL_FAILED'}]);
    }
    await expect(call("SELECT flow_job_brief_draft_claim(90001,90001,90001,$1,1,$2,'synthetic-model',$3) result",[randomUUID(),sourceHash(jd),sourceHash('draft')])).rejects.toThrow('BRIEF_DRAFT_LIMIT');
  });
  it('bounds the UTC daily allowance even across genuinely different JD sources',async()=>{
    for(let n=0;n<7;n++) {
      const currentJD=`Build Python services for product ${n}.`;
      await saveVersion(randomUUID(),n,{...save,currentJD,sourceChoice:'recruiter_edit',
        payload:{...payload,criteria:[{...criterion,provenance:{kind:'recruiter_edit'}}]}});
      const request=randomUUID();
      const pending=call("SELECT flow_job_brief_draft_claim(90001,90001,90001,$1,$2,$3,'synthetic-model',$4) result",
        [request,n+1,sourceHash(currentJD),sourceHash('draft')]);
      if(n===6) {await expect(pending).rejects.toThrow('BRIEF_DRAFT_LIMIT');break;}
      const claim=await pending;
      await call('SELECT flow_job_brief_draft_finish($1,$2,$3) result',
        [request,claim.lease,{state:'failed',code:'BRIEF_MODEL_FAILED'}]);
    }
  });
  it('readiness detects direct table-grant drift and routine-setting tampering',async()=>{
    const role=new URL(runtimeUrl).username;
    expect(await jobBriefPrivilegesReady(runtime,role,true)).toBe(true);
    try {
      await owner.query(`GRANT SELECT ON job_brief_versions TO "${role}"`);
      expect(await jobBriefPrivilegesReady(runtime,role,true)).toBe(false);
    } finally {await owner.query(`REVOKE SELECT ON job_brief_versions FROM "${role}"`);}
    try {
      await owner.query("ALTER FUNCTION flow_job_brief_read(integer,integer,integer) SET statement_timeout='6s'");
      expect(await jobBriefPrivilegesReady(runtime,role,true)).toBe(false);
    } finally {await owner.query("ALTER FUNCTION flow_job_brief_read(integer,integer,integer) SET statement_timeout='5s'");}
    expect(await jobBriefPrivilegesReady(runtime,role,true)).toBe(true);
  });
  it('immutable version and event triggers reject deletion even for the owner',async()=>{
    for(const table of ['job_brief_versions','job_brief_events'])await expect(owner.query(`DELETE FROM ${table} WHERE false`)).rejects.toThrow('BRIEF_EVIDENCE_IMMUTABLE');
  });
  it('a seat revocation that wins its lock denies the waiting brief read',async()=>{
    const pid=(await runtime.query('SELECT pg_backend_pid() pid')).rows[0].pid;
    await owner.query('BEGIN');await owner.query('UPDATE organization_members SET seat_assigned=false WHERE organization_id=90001 AND user_id=90001');
    const pending=read();
    try {
      for(let n=0;n<100;n++){
        if((await owner.query('SELECT cardinality(pg_blocking_pids($1))>0 blocked',[pid])).rows[0].blocked)break;
        if(n===99)throw Error('Read failed to lock membership');await new Promise(resolve=>setTimeout(resolve,10));
      }
      await owner.query('COMMIT');expect(await pending).toBeNull();
    } finally {
      await owner.query('ROLLBACK');
      // The rejected read still holds its SHARE locks until its transaction ends.
      await runtime.query('ROLLBACK');
      await owner.query('UPDATE organization_members SET seat_assigned=true WHERE organization_id=90001 AND user_id=90001');
    }
  });
  it('A1 rechecks an admin role revoked while the transition waits',async()=>{
    const pid=(await runtime.query('SELECT pg_backend_pid() pid')).rows[0].pid;
    await owner.query('BEGIN');
    await owner.query("UPDATE users SET role='candidate' WHERE id=90004");
    const result=call('SELECT flow_job_brief_save(90001,90001,90004,$1,NULL,$2) result',
      [randomUUID(),{action:'moderate',status:'approved'}]).then(value=>({value}),error=>({error}));
    try {
      for(let n=0;n<100;n++) {
        if((await owner.query('SELECT cardinality(pg_blocking_pids($1))>0 blocked',[pid])).rows[0].blocked)break;
        if(n===99)throw Error('Transition did not lock actor');
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      await owner.query('COMMIT');
      expect(await result).toMatchObject({error:{message:'BRIEF_REVISION_REQUIRED'}});
    } finally {
      await owner.query('ROLLBACK');await runtime.query('ROLLBACK');
      await owner.query("UPDATE users SET role='super_admin' WHERE id=90004");
    }
  });
});

describe.skipIf(!enabled)('publication-cycle real row-lock ordering',()=>{
  let owner:Client;let intake:Client;let pool:Pool;let jobId:number;
  beforeAll(async()=>{checkTarget(ownerUrl);owner=new Client({connectionString:ownerUrl});intake=new Client({connectionString:ownerUrl});pool=new Pool({connectionString:ownerUrl,max:2});await owner.connect();await intake.connect();});
  beforeEach(async()=>{
    const result=await owner.query(`INSERT INTO jobs(organization_id,posted_by,title,location,type,description,status,is_active,created_at)
      VALUES(90001,90001,'Synthetic lifecycle','Test','full-time','Test prose','approved',true,now()-interval '70 days') RETURNING id`);
    jobId=result.rows[0].id;
  });
  afterEach(async()=>{await intake.query('ROLLBACK');await owner.query('ROLLBACK');});
  afterAll(async()=>{await owner?.end();await intake?.end();await pool?.end();});
  const insert=(client:Client)=>client.query(`INSERT INTO applications(job_id,name,email,phone,resume_url,organization_id)
    VALUES($1,'Synthetic',$2,'','fixture:resume',90001) RETURNING id`,[jobId,`${randomUUID()}@fixture.invalid`]);
  const blocked=async(pid:number)=>{
    for(let n=0;n<100;n++) {
      const r=await owner.query('SELECT cardinality(pg_blocking_pids($1))>0 blocked',[pid]);if(r.rows[0].blocked)return;
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    throw Error('Expected real row-lock contention');
  };
  it('two actual INSERTs hold compatible SHARE locks, not an exclusive intake lock',async()=>{
    await owner.query('BEGIN');await intake.query('BEGIN');
    await insert(owner);await intake.query("SET LOCAL lock_timeout='200ms'");await insert(intake);
    expect((await intake.query('SELECT count(*)::integer n FROM applications WHERE job_id=$1',[jobId])).rows[0].n).toBe(1);
  });
  it('an application committed first prevents expiry after the locked re-read',async()=>{
    await intake.query('BEGIN');await insert(intake);
    let settled=false;const close=retireJobCycle(pool,jobId,'expired').finally(()=>{settled=true;});
    // A server-side observation, rather than a guessed sleep, establishes that
    // expiry is waiting on the real application trigger's lock.
    for(let n=0;n<100;n++) {
      const r=await owner.query("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND query='SELECT * FROM public.jobs WHERE id=$1 FOR UPDATE' AND wait_event_type='Lock'");
      if(r.rowCount)break;if(n===99)throw Error('Expiry did not contend');await new Promise(resolve=>setTimeout(resolve,10));
    }
    expect(settled).toBe(false);await intake.query('COMMIT');expect(await close).toBe(false);
    expect((await owner.query('SELECT is_active FROM jobs WHERE id=$1',[jobId])).rows[0].is_active).toBe(true);
  });
  it('expiry-first serialization does not fabricate an intake rejection',async()=>{
    await owner.query('BEGIN');await owner.query('SELECT id FROM jobs WHERE id=$1 FOR UPDATE',[jobId]);
    const pid=(await intake.query('SELECT pg_backend_pid() pid')).rows[0].pid;
    await intake.query('BEGIN');const write=insert(intake);await blocked(pid);
    await owner.query('UPDATE jobs SET is_active=false WHERE id=$1',[jobId]);await owner.query('COMMIT');
    await write;await intake.query('COMMIT');
    expect((await owner.query('SELECT is_active FROM jobs WHERE id=$1',[jobId])).rows[0].is_active).toBe(false);
  });
  it('an interview update committed first prevents expiry after the locked re-read',async()=>{
    const application=(await insert(owner)).rows[0].id;
    await owner.query("UPDATE applications SET applied_at=now()-interval '30 days' WHERE id=$1",[application]);
    await intake.query('BEGIN');
    await intake.query("UPDATE applications SET interview_date=now()+interval '1 day' WHERE id=$1",[application]);
    const close=retireJobCycle(pool,jobId,'expired');
    for(let n=0;n<100;n++) {
      const waiting=await owner.query("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND query='SELECT * FROM public.jobs WHERE id=$1 FOR UPDATE' AND wait_event_type='Lock'");
      if(waiting.rowCount)break;
      if(n===99)throw Error('Expiry did not contend with interview update');
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    await intake.query('COMMIT');expect(await close).toBe(false);
    expect((await owner.query('SELECT is_active FROM jobs WHERE id=$1',[jobId])).rows[0].is_active).toBe(true);
  });
  it('expiry-first serialization also fences a subsequent interview update',async()=>{
    const application=(await insert(owner)).rows[0].id;
    await owner.query("UPDATE applications SET applied_at=now()-interval '30 days' WHERE id=$1",[application]);
    await owner.query('BEGIN');await owner.query('SELECT id FROM jobs WHERE id=$1 FOR UPDATE',[jobId]);
    const pid=(await intake.query('SELECT pg_backend_pid() pid')).rows[0].pid;
    await intake.query('BEGIN');
    const write=intake.query("UPDATE applications SET interview_date=now()+interval '1 day' WHERE id=$1",[application]);
    await blocked(pid);await owner.query('UPDATE jobs SET is_active=false WHERE id=$1',[jobId]);
    await owner.query('COMMIT');await write;await intake.query('COMMIT');
    expect((await owner.query('SELECT is_active FROM jobs WHERE id=$1',[jobId])).rows[0].is_active).toBe(false);
  });
  it('records one honest system audit and repeat expiry is a no-op',async()=>{
    expect(await retireJobCycle(pool,jobId,'expired')).toBe(true);expect(await retireJobCycle(pool,jobId,'expired')).toBe(false);
    expect((await owner.query('SELECT actor_kind,performed_by FROM job_audit_log WHERE job_id=$1',[jobId])).rows).toEqual([{actor_kind:'system',performed_by:null}]);
  });
  it('a renewed cycle and future interview each prevent expiry',async()=>{
    await owner.query("UPDATE jobs SET reactivated_at=now()-interval '10 days' WHERE id=$1",[jobId]);
    expect(await retireJobCycle(pool,jobId,'expired')).toBe(false);
    await owner.query('UPDATE jobs SET reactivated_at=NULL WHERE id=$1',[jobId]);
    const app=(await insert(owner)).rows[0].id;
    await owner.query("UPDATE applications SET applied_at=now()-interval '30 days',interview_date=now()+interval '1 day' WHERE id=$1",[app]);
    expect(await retireJobCycle(pool,jobId,'expired')).toBe(false);
  });
  it.each(['decline_first','publish_first'])('A1 serializes moderation and publication: %s',async(order)=>{
    const command={...save,sourceChoice:'recruiter_edit'};
    const version=(await owner.query('SELECT flow_job_brief_save(90001,$1,90001,$2,0,$3) result',
      [jobId,randomUUID(),command])).rows[0].result;
    await owner.query('SELECT flow_job_brief_approve(90001,$1,90001,$2,1,$3,$4)',
      [jobId,randomUUID(),version.versionId,sourceHash('approve')]);
    await owner.query('UPDATE jobs SET is_active=false WHERE id=$1',[jobId]);
    const admin=new Client({connectionString:runtimeUrl});await admin.connect();
    try {
      const pid=(await admin.query('SELECT pg_backend_pid() pid')).rows[0].pid;
      await intake.query('BEGIN');
      const first=order==='decline_first'?{action:'moderate',status:'declined'}:{action:'publish'};
      const second=order==='decline_first'?{action:'publish'}:{action:'moderate',status:'declined'};
      await intake.query('SELECT flow_job_brief_save(90001,$1,90004,$2,NULL,$3)',[jobId,randomUUID(),first]);
      const pending=admin.query('SELECT flow_job_brief_save(90001,$1,90004,$2,NULL,$3)',
        [jobId,randomUUID(),second]).then(value=>({value}),error=>({error}));
      await blocked(pid);await intake.query('COMMIT');
      const outcome=await pending;
      if(order==='decline_first')expect(outcome).toMatchObject({error:{message:'BRIEF_APPROVAL_REQUIRED'}});
      else expect('value' in outcome).toBe(true);
      expect((await owner.query('SELECT status,is_active FROM jobs WHERE id=$1',[jobId])).rows[0])
        .toEqual({status:'declined',is_active:false});
    } finally {await intake.query('ROLLBACK');await admin.end();}
  });
  it.each(['edit_first','approve_first'])('serializes competing recruiter revisions: %s',async(order)=>{
    const command={...save,sourceChoice:'recruiter_edit'};
    const version=(await owner.query('SELECT flow_job_brief_save(90001,$1,90001,$2,0,$3) result',
      [jobId,randomUUID(),command])).rows[0].result;
    const peer=new Client({connectionString:runtimeUrl});await peer.connect();
    const edit=(client:Client)=>client.query('SELECT flow_job_brief_save(90001,$1,90001,$2,1,$3)',
      [jobId,randomUUID(),{...command,payload:{...payload,criteria:[{...criterion,class:'preferred'}]}}]);
    const approve=(client:Client)=>client.query('SELECT flow_job_brief_approve(90001,$1,90001,$2,1,$3,$4)',
      [jobId,randomUUID(),version.versionId,sourceHash('approve')]);
    try {
      const pid=(await peer.query('SELECT pg_backend_pid() pid')).rows[0].pid;
      await intake.query('BEGIN');await (order==='edit_first'?edit(intake):approve(intake));
      const pending=(order==='edit_first'?approve(peer):edit(peer)).then(value=>({value}),error=>({error}));
      await blocked(pid);await intake.query('COMMIT');
      expect(await pending).toMatchObject({error:{message:'BRIEF_REVISION_CONFLICT'}});
      const state=(await owner.query('SELECT approved_version_id FROM job_brief_state WHERE job_id=$1',[jobId])).rows[0];
      expect(state.approved_version_id).toBe(order==='approve_first'?version.versionId:null);
    } finally {await intake.query('ROLLBACK');await peer.end();}
  });
  it('approval winning first commits before seat revocation; later reads still refuse',async()=>{
    const version=(await owner.query('SELECT flow_job_brief_save(90001,$1,90001,$2,0,$3) result',
      [jobId,randomUUID(),{...save,sourceChoice:'recruiter_edit'}])).rows[0].result;
    const revoke=new Client({connectionString:ownerUrl});await revoke.connect();
    const reader=new Client({connectionString:runtimeUrl});await reader.connect();
    try {
      const pid=(await revoke.query('SELECT pg_backend_pid() pid')).rows[0].pid;
      await intake.query('BEGIN');
      await intake.query('SELECT flow_job_brief_approve(90001,$1,90001,$2,1,$3,$4)',
        [jobId,randomUUID(),version.versionId,sourceHash('approve')]);
      const pending=revoke.query('UPDATE organization_members SET seat_assigned=false WHERE organization_id=90001 AND user_id=90001');
      await blocked(pid);await intake.query('COMMIT');await pending;
      expect((await reader.query('SELECT flow_job_brief_read(90001,$1,90001) result',[jobId])).rows[0].result).toBeNull();
      expect((await owner.query('SELECT approved_version_id FROM job_brief_state WHERE job_id=$1',[jobId])).rows[0].approved_version_id).toBe(version.versionId);
    } finally {
      await intake.query('ROLLBACK');await reader.end();
      await revoke.query('UPDATE organization_members SET seat_assigned=true WHERE organization_id=90001 AND user_id=90001');await revoke.end();
    }
  });
});
