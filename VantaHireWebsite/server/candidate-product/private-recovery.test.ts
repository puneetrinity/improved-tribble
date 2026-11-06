import {test} from 'vitest';
import assert from 'node:assert/strict';
import {databaseConfig,identity,validateRuntime} from '../../scripts/spark-private-recovery';

const env:NodeJS.ProcessEnv={FLOW_RECOVERY_DATABASE_URL:'postgresql://owner:secret@proxy.example:1234/flow',
 FLOW_RECOVERY_HOST:'proxy.example',FLOW_RECOVERY_CA_PEM:'-----BEGIN CERTIFICATE-----\nfixture',
 FLOW_RECOVERY_TLS_SERVERNAME:'db.example',ACTIVEKG_MIGRATE_DSN:'postgresql://owner:secret@memory.railway.internal/db',
 SPARK_MEMORY_PRIVATE_HOST:'memory.railway.internal'};
test('public connection pins CA and servername; no connectionString overrides',()=>{
 const c=databaseConfig(env,'FLOW');assert.equal(c.ssl&&c.ssl.rejectUnauthorized,true);
 assert.equal(c.ssl&&c.ssl.servername,'db.example');assert.equal('connectionString' in c,false);
 assert.ok(c.ssl);
 assert.equal(c.ssl.checkServerIdentity('proxy.example',{subjectaltname:'DNS:db.example'} as any),undefined);
 assert.ok(c.ssl.checkServerIdentity('proxy.example',{subjectaltname:'DNS:wrong.example'} as any) instanceof Error);
});
test('Memory exclusively uses the exact internal host',()=>{
 assert.equal(databaseConfig(env,'MEMORY').ssl,false);
 for(const value of ['postgres://x:y@public.example/db','postgres://x:y@other.railway.internal/db',
  'postgres://x:y@memory.railway.internal/db?host=public.example','postgres://x:y@memory.railway.internal/db?sslmode=require'])
  assert.throws(()=>databaseConfig({...env,ACTIVEKG_MIGRATE_DSN:value},'MEMORY'));
});
test('public endpoints reject TLS overrides and missing pins',()=>{
 for(const q of ['sslmode=disable','sslmode=require','sslcert=/tmp/a','host=evil'])
  assert.throws(()=>databaseConfig({...env,FLOW_RECOVERY_DATABASE_URL:env.FLOW_RECOVERY_DATABASE_URL+'?'+q},'FLOW'));
 assert.throws(()=>databaseConfig({...env,FLOW_RECOVERY_CA_PEM:''},'FLOW'));
 assert.throws(()=>databaseConfig({...env,FLOW_RECOVERY_HOST:'other'},'FLOW'));
});
test('refuses outside Railway or unarmed launch before connecting',()=>{
 assert.throws(()=>validateRuntime({}));assert.throws(()=>validateRuntime({...env,SPARK_PRIVATE_JOB_APPLY:'recovery'}));
});
test('valid one-shot config and dangerous inherited settings',()=>{
 const id='12345678-1234-1234-1234-123456789abc';
 const good={SPARK_PRIVATE_JOB_APPLY:'recovery',RAILWAY_PROJECT_ID:'5042caf8-8879-40ab-bb52-aa9f8af8e508',
  RAILWAY_ENVIRONMENT_ID:'c3b75445-d0de-49fa-a533-b4b9a20b5f5d',RAILWAY_DEPLOYMENT_ID:'deployment',
  SPARK_PRIVATE_JOB_SERVICE_ID:id,RAILWAY_SERVICE_ID:id,CANDIDATE_NETWORK_RECOVERY_EPOCH:'release-epoch-20261106',
  SPARK_RECOVERY_RUN_ID:id,SPARK_RECOVERY_RESTORED:'none',ACTIVEKG_BASE_URL:'https://memory.example',
  FLOW_SCHEMA_TARGET_ID:id,ACTIVEKG_SCHEMA_TARGET_ID:id,SIGNAL_SCHEMA_TARGET_ID:id};
 validateRuntime(good);
 for(const [key,value] of Object.entries({NODE_TLS_REJECT_UNAUTHORIZED:'0',PGHOSTADDR:'1.2.3.4',NODE_OPTIONS:'--inspect',
  ACTIVEKG_MIGRATION_APPLY:'1',SPARK_RECOVERY_RESTORED:'invalid',ACTIVEKG_BASE_URL:'http://memory.example',FLOW_SCHEMA_TARGET_ID:''}))
  assert.throws(()=>validateRuntime({...good,[key]:value}));
});
test('three actual identity layouts checked; mismatch refuses',async()=>{
 const kinds=['FLOW','MEMORY','DISCOVER'] as const;
 const products=['flow','memory','discover'];const tables=['schema_control.identity','activekg_schema_control.target_identity','signal_schema_control.target_identity'];
 for(const [i,k] of kinds.entries()){
  await identity({query:async(q:string)=>{assert.ok(q.includes(tables[i]!));return {rows:[{product:products[i],environment:'production',target_id:'expected'}]};}} as any,k,'expected');
  await assert.rejects(identity({query:async()=>({rows:[{product:products[i],environment:'production',target_id:'wrong'}]})} as any,k,'expected'));
 }
});
