import {describe,it,expect} from 'vitest';
import {Client} from 'pg';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {mkdtempSync,readdirSync,copyFileSync,readFileSync,writeFileSync} from 'node:fs';
import {runReleaseMigration,type MigrationClient} from '../schema-control/runner';
import {provisionRuntimeRole} from '../schema-control/runtimeRole';
import {assertSchemaReady,FLOW_CRITICAL_POSTCONDITIONS,foundationPrivilegesReady} from '../schema-control/readiness';
import {FOUNDATION_TABLES,FOUNDATION_FUNCTIONS,FOUNDATION_OWNER_FUNCTIONS} from './contracts';

const socket=process.env.CANDIDATE_FOUNDATION_TEST_SOCKET;
const port=Number(process.env.CANDIDATE_FOUNDATION_TEST_PORT);
describe.skipIf(!socket)('foundation actual Flow release and runtime authority',()=>{
 it.each(['fresh','upgrade'] as const)('migrates, provisions, replays and checks the full readiness contract: %s',async(mode)=>{
  if(!socket?.startsWith('/tmp/candidate-s1-') || !Number.isInteger(port) || port<1024 || process.env.NODE_ENV!=='test')
    throw Error('disposable_only');
  const suffix=randomUUID().replaceAll('-','').slice(0,10);
  const owner=`flow_schema_control_test_owner_${suffix}`,runtime=`flow_schema_control_test_runtime_${suffix}`;
  const database=`flow_schema_control_test_${suffix}`,target=`candidate-s1-${suffix}`;
  const admin=new Client({host:socket,port,user:'ews',database:'postgres'});await admin.connect();
  try{
    const state=(await admin.query('SELECT current_database() db,current_user actor,inet_server_addr() host')).rows[0];
    expect(state).toEqual({db:'postgres',actor:'ews',host:null});
    await admin.query(`CREATE ROLE ${owner} LOGIN NOSUPERUSER NOBYPASSRLS CREATEROLE`);
    await admin.query(`CREATE DATABASE ${database} OWNER ${owner} TEMPLATE template0 ENCODING 'UTF8'`);
  } finally {await admin.end();}
  const url=(role:string)=>`postgresql://${role}:synthetic-local-only@localhost:${port}/${database}?host=${encodeURIComponent(socket)}`;
  const connect=async(role:string):Promise<MigrationClient>=>{
    const client=new Client({host:socket,port,user:role,database,connectionTimeoutMillis:2000});await client.connect();
    return {query:(text,params)=>client.query(text,params as any),end:()=>client.end()};
  };
  const migrationsDir=resolve('server/schema-migrations');
  const creds={migrateUrl:url(owner),expectedTargetId:target,environment:'development' as const,allowFreshInitialization:true};
  if(mode==='upgrade'){
    const before=mkdtempSync('/tmp/candidate-s1-flow-before-');
    for(const file of readdirSync(migrationsDir))if(file!=='0024_candidate_product_foundation.sql')copyFileSync(resolve(migrationsDir,file),resolve(before,file));
    const lock=JSON.parse(readFileSync(resolve(before,'checksums.lock'),'utf8'));
    delete lock.migrations['0024'];writeFileSync(resolve(before,'checksums.lock'),JSON.stringify(lock));
    const previous=await runReleaseMigration({migrationsDir:before,creds,connect:()=>connect(owner)});
    expect(previous.applied).toHaveLength(24);
  }
  const first=await runReleaseMigration({migrationsDir,creds,connect:()=>connect(owner)});
  expect(first.applied).toHaveLength(mode==='fresh'?25:1);
  await provisionRuntimeRole({migrateUrl:url(owner),runtimeUrl:url(runtime),runtimeRole:runtime,
    expectedTargetId:target,connectMigration:()=>connect(owner),connectRuntime:()=>connect(runtime)});
  const replay=await runReleaseMigration({migrationsDir,creds,connect:()=>connect(owner)});
  expect(replay.applied).toEqual([]);
  const reader=await connect(runtime);
  try{
    expect(await assertSchemaReady({pg:reader,migrationsDir,expectedTargetId:target,environment:'development',
      criticalPostconditions:FLOW_CRITICAL_POSTCONDITIONS})).toMatchObject({version:'0024',applied:25});
    expect(await foundationPrivilegesReady(reader,runtime,true)).toBe(true);
    for(const table of FOUNDATION_TABLES){
      await expect(reader.query(`SELECT * FROM public.${table}`)).rejects.toThrow();
    }
    for(const signature of FOUNDATION_FUNCTIONS) expect((await reader.query("SELECT has_function_privilege(current_user,$1,'EXECUTE') ok",[signature])).rows[0].ok).toBe(true);
    for(const signature of FOUNDATION_OWNER_FUNCTIONS) expect((await reader.query("SELECT has_function_privilege(current_user,$1,'EXECUTE') ok",[signature])).rows[0].ok).toBe(false);
  }finally{await reader.end();}
  console.log('Retained Flow release fixture',database);
 },120000);
});
