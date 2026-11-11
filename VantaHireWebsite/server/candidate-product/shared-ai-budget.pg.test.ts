import {beforeAll,afterAll,beforeEach,describe,it,expect} from 'vitest';
import {Client} from 'pg';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {mkdtempSync,readdirSync,copyFileSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {runReleaseMigration} from '../schema-control/runner';
import {SOURCE_CATALOG_SQL} from '../schema-control/readiness';
import {applyGlobalBudgets,type GlobalBudgets} from './budget-config';

const adminUrl=process.env.S2_FLOW_TEST_ADMIN_URL;
describe.skipIf(!adminUrl)('shared AI monetary allowance (real PostgreSQL)',()=>{
 let db:Client,database:string,owner:string,port:string;
 const connection=async()=>{const c=new Client({host:'127.0.0.1',port:Number(port),user:owner,database});await c.connect();return c;};
 beforeAll(async()=>{
  const u=new URL(adminUrl!);
  if(process.env.S2_PROTOTYPE_DISPOSABLE!=='1'||u.hostname!=='127.0.0.1'||u.pathname!=='/postgres')throw Error('disposable_only');
  port=u.port;const suffix=randomUUID().replaceAll('-','').slice(0,10);
  owner=`flow_schema_control_test_owner_${suffix}`;database=`flow_schema_control_test_${suffix}`;
  const admin=new Client({connectionString:adminUrl});await admin.connect();
  try{await admin.query(`CREATE ROLE ${owner} LOGIN NOSUPERUSER NOBYPASSRLS CREATEROLE`);await admin.query(`CREATE DATABASE ${database} OWNER ${owner} TEMPLATE template0 ENCODING 'UTF8'`);}finally{await admin.end();}
  const input={migrationsDir:resolve('server/schema-migrations'),creds:{migrateUrl:`postgresql://${owner}@127.0.0.1:${port}/${database}`,expectedTargetId:'shared-ai-'+suffix,environment:'development' as const,allowFreshInitialization:true},
   connect:async()=>{const c=await connection();return {query:(s:string,p?:readonly unknown[])=>c.query(s,p as any),end:()=>c.end()};}};
  const prior=mkdtempSync(resolve(tmpdir(),'spark-budget-upgrade-'));
  for(const file of readdirSync(input.migrationsDir))if(!file.startsWith('0029_')&&!file.startsWith('0030_')&&!file.startsWith('0031_'))copyFileSync(resolve(input.migrationsDir,file),resolve(prior,file));
  const priorLock=JSON.parse(readFileSync(resolve(prior,'checksums.lock'),'utf8'));delete priorLock.migrations['0029'];
  delete priorLock.migrations['0030'];
  delete priorLock.migrations['0031'];
  writeFileSync(resolve(prior,'checksums.lock'),JSON.stringify(priorLock));
  expect((await runReleaseMigration({...input,migrationsDir:prior})).applied).toHaveLength(29);
  expect((await runReleaseMigration(input)).applied).toEqual(['0029','0030','0031']);
  expect((await runReleaseMigration(input)).applied).toEqual([]);
  db=await connection();console.log('SHARED_AI_FIXTURE',database,'SOURCE_DIGEST',(await db.query(SOURCE_CATALOG_SQL,[owner,[]])).rows[0].digest);
 },60000);
 afterAll(async()=>{await db?.end();});
 beforeEach(async()=>{
  await db.query('DELETE FROM candidate_source_ai_spend');
  await db.query('DELETE FROM candidate_source_ocr_spend');
  await db.query('DELETE FROM candidate_source_budget_alerts');
  await db.query('DELETE FROM candidate_source_global_audit');
  await db.query('DELETE FROM candidate_source_lookup_budgets');
  await db.query('DELETE FROM candidate_source_budget_windows');
  await db.query('UPDATE candidate_source_global_policy SET configured=false,ocr_day_micro=2000000,ocr_month_micro=20000000');
  await db.query('DELETE FROM candidate_source_ai_policy_audit');
  await db.query("UPDATE candidate_source_ai_policy SET enabled=true,candidate_day_micro=250,candidate_month_micro=2000,global_day_micro=1000,global_month_micro=10000,candidate_day_calls=10");
  if(!(await db.query('SELECT 1 FROM candidate_source_ai_prices')).rowCount)
   await db.query("INSERT INTO candidate_source_ai_prices VALUES('test-v1','synthetic',1000000,2000000,'2020-01-01','2099-01-01','synthetic test rate, not a live price')");
 });
 const admit=async(feature='help',user=1,input=50,output=25,id=randomUUID(),c=db)=>(await c.query('SELECT flow_candidate_source_ai_admit($1,$2,$3,$4,$5,$6) ok',[id,user,feature,'synthetic',input,output])).rows[0].ok;
 const config=(changes:Partial<GlobalBudgets>={}):GlobalBudgets=>({aiDayMicro:'1000',aiMonthMicro:'10000',ocrDayMicro:'12000',ocrMonthMicro:'120000',rcDayCredits:'150',rcMonthCredits:'3000',...changes});
 const ocr=async(user=1,pages=4,id=randomUUID(),c=db)=>(await c.query('SELECT flow_candidate_source_ocr_admit($1,$2,$3) ok',[id,user,pages])).rows[0].ok;
 const ocrPrice=()=>db.query("INSERT INTO candidate_source_ocr_prices VALUES('ocr-test',1500,'2020-01-01','2099-01-01','Synthetic rate') ON CONFLICT DO NOTHING");
 it('all global cap increases/decreases preserve ledger rows and RC window identities',async()=>{
  await applyGlobalBudgets(db,config());await db.query("SELECT flow_candidate_source_budget_windows_sync('lookup')");
  const windows=(await db.query('SELECT window_id FROM candidate_source_lookup_budgets ORDER BY period')).rows;
  await admit();await ocrPrice();expect(await ocr()).toBe(true);
  await applyGlobalBudgets(db,config({aiDayMicro:'50',ocrDayMicro:'3000',rcDayCredits:'100'}));
  expect(await admit('help',2)).toBe(false);expect(await ocr(2,1)).toBe(false);
  await applyGlobalBudgets(db,config({aiDayMicro:'2000',ocrDayMicro:'18000',rcDayCredits:'200'}));
  expect(await admit('help',2)).toBe(true);expect(await ocr(2)).toBe(true);
  expect((await db.query('SELECT sum(charged_micro) n FROM candidate_source_ai_spend')).rows[0].n).toBe('200');
  expect((await db.query('SELECT sum(charged_micro) n FROM candidate_source_ocr_spend')).rows[0].n).toBe('12000');
  expect((await db.query('SELECT window_id FROM candidate_source_lookup_budgets ORDER BY period')).rows).toEqual(windows);
  expect((await db.query("SELECT credit_limit FROM candidate_source_lookup_budgets WHERE period='day'")).rows[0].credit_limit).toBe('200');
 });
 it('OCR refuses unknown prices; caps are atomic and unknown charges cannot be repurchased',async()=>{
  // A non-overlapping fixture future clock checks an expired rate without editing it.
  await db.query("INSERT INTO candidate_source_budget_clocks VALUES('ocr','2100-01-01') ON CONFLICT(kind) DO UPDATE SET observed_at=excluded.observed_at");
  expect(await ocr()).toBe(false);await db.query("DELETE FROM candidate_source_budget_clocks WHERE kind='ocr'");
  await ocrPrice();await applyGlobalBudgets(db,config({ocrDayMicro:'6000'}));
  const id=randomUUID(),c=await connection();try{
   const results=await Promise.all([ocr(1,4,id),ocr(2,4,randomUUID(),c)]);expect(results.sort()).toEqual([false,true]);
  }finally{await c.end();}
  expect(await ocr(3,1)).toBe(false);expect((await db.query('SELECT sum(charged_micro) n FROM candidate_source_ocr_spend')).rows[0].n).toBe('6000');
 });
 it('OCR daily page-attempt limit spans distinct calls and never refunds failures',async()=>{
  await ocrPrice();await applyGlobalBudgets(db,config({ocrDayMicro:'100000',ocrMonthMicro:'1000000'}));
  for(let n=0;n<3;n++)expect(await ocr(1,10)).toBe(true);expect(await ocr(1,1)).toBe(false);expect(await ocr(2,1)).toBe(true);
 });
 it('warnings are durable, deduplicated and lease fenced',async()=>{
  await db.query('UPDATE candidate_source_ai_policy SET candidate_day_micro=1000,global_day_micro=100');
  expect(await admit()).toBe(true);
  expect((await db.query("SELECT count(*) n FROM candidate_source_budget_alerts WHERE metric='global_daily_usd'")).rows[0].n).toBe('1');
  await db.query("UPDATE candidate_source_ai_spend SET charged_micro=charged_micro");
  expect((await db.query("SELECT count(*) n FROM candidate_source_budget_alerts WHERE metric='global_daily_usd'")).rows[0].n).toBe('1');
  const a=(await db.query('SELECT flow_candidate_source_budget_alert_claim() a')).rows[0].a;expect(a).not.toHaveProperty('user_id');
  expect((await db.query('SELECT flow_candidate_source_budget_alert_finish($1,$2,true) ok',[a.id,randomUUID()])).rows[0].ok).toBe(false);
  expect((await db.query('SELECT flow_candidate_source_budget_alert_finish($1,$2,true) ok',[a.id,a.token])).rows[0].ok).toBe(true);
  expect((await db.query('SELECT flow_candidate_source_budget_alert_claim() a')).rows[0].a).toBeNull();
 });
 it('AI overrun generates a shutdown alert and cap updates cannot re-enable it',async()=>{
  const id=randomUUID();await admit('help',1,50,25,id);await db.query('SELECT flow_candidate_source_ai_settle($1,51,25)',[id]);
  expect((await db.query("SELECT count(*) n FROM candidate_source_budget_alerts WHERE metric='shutdown_review_required'")).rows[0].n).toBe('1');
  expect((await db.query("SELECT count(*) n FROM candidate_source_budget_alerts WHERE metric='shutdown_overrun'")).rows[0].n).toBe('1');
  await applyGlobalBudgets(db,config());expect(await admit()).toBe(false);
 });
 it('combines resume and help spend and raising ONE policy preserves prior spend',async()=>{
  expect(await admit('help')).toBe(true);expect(await admit('resume')).toBe(true);expect(await admit('help')).toBe(false);
  await db.query('SELECT flow_candidate_source_ai_configure(400,2000,1000,10000,10,true,$1)',[randomUUID()]);
  expect(await admit('resume')).toBe(true);expect((await db.query('SELECT sum(charged_micro) n FROM candidate_source_ai_spend')).rows[0].n).toBe('300');
 });
 it('counts calls across features even when actual usage is zero',async()=>{
  await db.query('UPDATE candidate_source_ai_policy SET candidate_day_calls=1');
  const id=randomUUID();expect(await admit('resume',1,1,1,id)).toBe(true);
  await db.query('SELECT flow_candidate_source_ai_settle($1,0,0)',[id]);expect(await admit('help')).toBe(false);
 });
 it('serializes concurrent cross-feature admissions at the shared cap',async()=>{
  await db.query('UPDATE candidate_source_ai_policy SET candidate_day_micro=100');
  const c=await connection();try{const result=await Promise.all([admit('help'),admit('resume',1,50,25,randomUUID(),c)]);expect(result.sort()).toEqual([false,true]);}finally{await c.end();}
 });
 it('enforces global and monthly limits across candidates and features',async()=>{
  await db.query('UPDATE candidate_source_ai_policy SET global_month_micro=100');
  expect(await admit('help',1)).toBe(true);expect(await admit('resume',2)).toBe(false);
 });
 it('holds unknown charges; duplicate dispatch does not purchase again',async()=>{
  const id=randomUUID();expect(await admit('help',1,50,25,id)).toBe(true);
  await db.query('SELECT flow_candidate_source_ai_settle($1,NULL,NULL)',[id]);
  expect(await admit('help',1,50,25,id)).toBe(false);
  expect((await db.query('SELECT charged_micro,settled FROM candidate_source_ai_spend')).rows[0]).toEqual({charged_micro:'100',settled:false});
 });
 it('settles at the original separate input/output rates; replays cannot refund twice',async()=>{
  const id=randomUUID();await admit('resume',1,50,25,id);
  await db.query('SELECT flow_candidate_source_ai_settle($1,10,5)',[id]);
  await db.query('SELECT flow_candidate_source_ai_settle($1,10,5)',[id]);
  expect((await db.query('SELECT charged_micro FROM candidate_source_ai_spend')).rows[0].charged_micro).toBe('20');
  await expect(db.query('SELECT flow_candidate_source_ai_settle($1,0,0)',[id])).rejects.toMatchObject({code:'23505'});
  // Same monetary amount is not proof of the same provider usage.
  await expect(db.query('SELECT flow_candidate_source_ai_settle($1,12,4)',[id])).rejects.toMatchObject({code:'23505'});
 });
 it('uses UTC days while retaining previous-day spend in the same month',async()=>{
  await db.query("INSERT INTO candidate_source_budget_clocks VALUES('semantic_model','2090-06-15T12:00:00Z') ON CONFLICT(kind) DO UPDATE SET observed_at=excluded.observed_at");
  try{
   await db.query('UPDATE candidate_source_ai_policy SET candidate_day_micro=100,candidate_month_micro=200');
   expect(await admit()).toBe(true);expect(await admit('resume')).toBe(false);
   await db.query("UPDATE candidate_source_budget_clocks SET observed_at='2090-06-16T00:00:00Z' WHERE kind='semantic_model'");
   expect(await admit('resume')).toBe(true);
   await db.query("UPDATE candidate_source_budget_clocks SET observed_at='2090-06-17T00:00:00Z' WHERE kind='semantic_model'");
   expect(await admit()).toBe(false);
   await db.query("UPDATE candidate_source_budget_clocks SET observed_at='2090-07-01T00:00:00Z' WHERE kind='semantic_model'");
   expect(await admit()).toBe(true);
  }finally{await db.query("DELETE FROM candidate_source_budget_clocks WHERE kind='semantic_model'");}
 });
 it('rounds fractional microdollars upward and pins the price version',async()=>{
  await db.query("INSERT INTO candidate_source_ai_prices VALUES('fraction-v1','fraction',1,2,'2020-01-01','2099-01-01','synthetic fractional rate')");
  const id=randomUUID();
  expect((await db.query("SELECT flow_candidate_source_ai_admit($1,1,'resume','fraction',1,1) ok",[id])).rows[0].ok).toBe(true);
  expect((await db.query('SELECT charged_micro,price_version FROM candidate_source_ai_spend WHERE reservation_id=$1',[id])).rows[0]).toEqual({charged_micro:'1',price_version:'fraction-v1'});
 });
 it('audits one increase exactly once without replaying an older policy over a newer one',async()=>{
  const id=randomUUID(),sql='SELECT flow_candidate_source_ai_configure(400,2000,1000,10000,10,true,$1)';
  await db.query(sql,[id]);await db.query(sql,[id]);
  expect((await db.query('SELECT count(*) n FROM candidate_source_ai_policy_audit')).rows[0].n).toBe('1');
  await db.query('SELECT flow_candidate_source_ai_configure(500,2000,1000,10000,10,true,$1)',[randomUUID()]);
  await db.query(sql,[id]);expect((await db.query('SELECT candidate_day_micro n FROM candidate_source_ai_policy')).rows[0].n).toBe('500');
 });
 it('unknown/disabled price policy refuses dispatch',async()=>{
  await db.query('UPDATE candidate_source_ai_policy SET enabled=false');expect(await admit()).toBe(false);
  await db.query('UPDATE candidate_source_ai_policy SET enabled=true');
  expect((await db.query("SELECT flow_candidate_source_ai_admit($1,1,'resume','unknown',1,1) ok",[randomUUID()])).rows[0].ok).toBe(false);
 });
 it('overrun keeps the charge and stops both features',async()=>{
  const id=randomUUID();await admit('help',1,50,25,id);await db.query('SELECT flow_candidate_source_ai_settle($1,51,25)',[id]);
  expect(await admit('resume')).toBe(false);expect((await db.query('SELECT charged_micro FROM candidate_source_ai_spend')).rows[0].charged_micro).toBe('101');
 });
 it('price versions cannot be edited',async()=>{
  await expect(db.query('UPDATE candidate_source_ai_prices SET input_micro_per_million=1')).rejects.toMatchObject({code:'55000'});
 });
 it('both real dispatch routines call the SAME admission function',async()=>{
  for(const sig of ['flow_candidate_source_interpretation_dispatch(uuid,text)','flow_candidate_source_paid_dispatch(jsonb)']){
   expect((await db.query('SELECT pg_get_functiondef($1::regprocedure) src',[sig])).rows[0].src).toContain('flow_candidate_source_ai_admit');
  }
  expect((await db.query("SELECT has_function_privilege('public','flow_candidate_source_ai_admit(uuid,integer,text,text,bigint,bigint)','EXECUTE') ok")).rows[0].ok).toBe(false);
 });
});
