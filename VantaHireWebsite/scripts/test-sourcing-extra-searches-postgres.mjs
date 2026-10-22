// Native Node/tsx operator test. Refuses anything except an empty local test DB.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {CONTROL_DDL} from '../server/schema-control/ledger.ts';
import {makePlan,readSnapshot,applyPlan,readCommand} from './sourcing-extra-searches.mjs';
const url=new URL(process.env.FLOW_EXTRA_TEST_URL??'');
assert.ok(['127.0.0.1','localhost'].includes(url.hostname)&&url.pathname.endsWith('_extra_test')&&url.username.endsWith('_test'),'DISPOSABLE_REQUIRED');
const db=new pg.Client({connectionString:url.toString()});await db.connect();let owned=false;
try{
 const role=(await db.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];assert.deepEqual(role,{rolsuper:false,rolbypassrls:false});
 assert.equal((await db.query("SELECT count(*)::int n FROM pg_class WHERE relnamespace='public'::regnamespace")).rows[0].n,0);
 assert.equal((await db.query("SELECT to_regnamespace('schema_control') n")).rows[0].n,null);owned=true;
 await db.query('BEGIN');
 for(const f of readdirSync('server/schema-migrations').filter(f=>/^\d{4}_.*\.sql$/.test(f)).sort())await db.query(readFileSync('server/schema-migrations/'+f,'utf8'));
 await db.query(CONTROL_DDL);
 await db.query("INSERT INTO schema_control.identity(system,environment,target_id) VALUES('flow','development','extra-operator-fixture')");
 await db.query("INSERT INTO users(id,username,password,role,email_verified) VALUES(99101,'extra@fixture.invalid','unusable','recruiter',true)");
 await db.query("INSERT INTO organizations(id,name,slug,is_active) VALUES(99101,'Extra fixture','extra-fixture',true)");
 await db.query("INSERT INTO organization_members(organization_id,user_id,role,seat_assigned) VALUES(99101,99101,'owner',true)");
 await db.query("INSERT INTO subscription_plans(id,name,display_name,price_per_seat_monthly,price_per_seat_annual,ai_credits_per_seat_monthly,features) VALUES(99101,'extra-fixture','Extra fixture',0,0,0,'{}')");
 await db.query("INSERT INTO organization_subscriptions(id,organization_id,plan_id,seats,paid_seats,billing_cycle,status,start_date,current_period_start,current_period_end) VALUES(99101,99101,99101,1,0,'monthly','trial','2026-01-01','2026-01-01','2030-01-01')");
 const entitlement=randomUUID();
 await db.query("INSERT INTO sourcing_entitlements(id,organization_id,subscription_id,anchor,valid_from,valid_until,capacity,origin,evidence_sha256) VALUES($1,99101,99101,'2026-01-01Z','2026-01-01Z','2030-01-01Z',1,'explicit_grant',$2)",[entitlement,'a'.repeat(64)]);
 await db.query('SELECT flow_sourcing_enable(99101,$1)',[entitlement]);await db.query('COMMIT');
 const r={commandId:randomUUID(),organizationId:99101,recipientUserId:99101,environment:'development',targetId:'extra-operator-fixture',body:{action:'issue',quantity:5,
  validFrom:new Date(Date.now()-1000).toISOString(),validUntil:new Date(Date.now()+86400000).toISOString(),operatorLabel:'self-declared fixture',reason:'operator test'}};
 const snapshot=await readSnapshot(db,r),plan=makePlan(r,snapshot);
 assert.equal(snapshot.state.eligible,true);assert.equal(snapshot.state.grants.length,0);
 assert.equal((await readCommand(db,r)).found,false);
 await assert.rejects(readSnapshot(db,{...r,targetId:'wrong'}),/TARGET_MISMATCH/);
 const result=await applyPlan(db,plan,plan.fingerprint);assert.equal(result.grantId,r.commandId);assert.equal(result.replayed,false);
 assert.equal((await readCommand(db,r)).grantId,result.grantId);
 await assert.rejects(readCommand(db,{...r,body:{...r.body,quantity:6}}),/COMMAND_CONFLICT/);
 assert.equal((await applyPlan(db,plan,plan.fingerprint)).replayed,true);
 const stale=makePlan({...r,commandId:randomUUID()},snapshot);await assert.rejects(applyPlan(db,stale,stale.fingerprint),/REVISION_CONFLICT/);
 const revoke={...r,commandId:randomUUID(),body:{action:'revoke',grantId:result.grantId,operatorLabel:'self-declared fixture',reason:'operator revoke test'}};
 const rp=makePlan(revoke,await readSnapshot(db,revoke));await applyPlan(db,rp,rp.fingerprint);
 const after=await readSnapshot(db,r);assert.equal(after.state.grants.length,1);assert.ok(after.state.grants[0].balance.revoked_at);
 assert.equal((await db.query('SELECT count(*)::int n FROM sourcing_extra_events')).rows[0].n,2);
 assert.equal((await db.query('SELECT count(*)::int n FROM sourcing_allowance_windows')).rows[0].n,0);
 // Lose only the COMMIT reply after the real commit, then use a new connection
 // for readback. No retry or new command is created by applyPlan itself.
 const lostRequest={...r,commandId:randomUUID()},lostPlan=makePlan(lostRequest,await readSnapshot(db,lostRequest));
 let loseReply=true;
 const transport={async query(sql,args){const result=await db.query(sql,args);if(sql==='COMMIT'&&loseReply){loseReply=false;throw Error('SIMULATED_COMMIT_REPLY_LOST');}return result;}};
 await assert.rejects(applyPlan(transport,lostPlan,lostPlan.fingerprint),/SIMULATED_COMMIT_REPLY_LOST/);
 const reader=new pg.Client({connectionString:url.toString()});await reader.connect();
 try{await reader.query('BEGIN READ ONLY');assert.equal((await readCommand(reader,lostRequest)).found,true);await reader.query('COMMIT');}finally{await reader.end();}
 assert.equal((await applyPlan(db,lostPlan,lostPlan.fingerprint)).replayed,true);
 assert.equal((await db.query('SELECT count(*)::int n FROM sourcing_extra_events')).rows[0].n,3);
 assert.equal((await db.query('SELECT count(*)::int n FROM sourcing_allowance_windows')).rows[0].n,0);
 console.log('extra-search operator postgres: PASS (identity, native loader, preview, issue, replay, stale plan, revoke, lost-COMMIT readback, unchanged usage)');
}finally{
 await db.query('ROLLBACK');
 if(owned)await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS schema_control CASCADE');
 await db.end();
}
