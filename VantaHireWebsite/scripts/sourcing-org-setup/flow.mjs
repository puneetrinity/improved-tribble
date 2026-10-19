import pg from 'pg';
import {readFileSync} from 'node:fs';
import {fail,tenant,assertSame,hash} from './contracts.mjs';

export async function connectOwner(url, caFile, environment) {
  if(!url)fail('SETUP_CONNECTION_REQUIRED');
  const u=new URL(url), local=['127.0.0.1','[::1]'].includes(u.hostname);
  // pg URL ssl options can silently override explicit verification; forbid them.
  if([...u.searchParams.keys()].some(k=>k.toLowerCase().startsWith('ssl')))fail('SETUP_TLS_OPTIONS_REFUSED');
  if(environment!=='development'&&!caFile)fail('SETUP_CA_REQUIRED');
  const client=new pg.Client({connectionString:url,ssl:caFile?{ca:readFileSync(caFile,'utf8'),rejectUnauthorized:true}:local&&environment==='development'?false:true,
    connectionTimeoutMillis:5000,query_timeout:7000,statement_timeout:5000,lock_timeout:1000,idle_in_transaction_session_timeout:10000});
  client.on('error',()=>{});
  try{await client.connect();return client;}catch{await client.end().catch(()=>{});fail('SETUP_CONNECTION_FAILED');}
}
export async function transaction(db,write,fn){
  await db.query(write?'BEGIN':'BEGIN READ ONLY');
  try{await db.query("SET LOCAL timezone='UTC'");const result=await fn();await db.query('COMMIT');return result;}
  catch(error){await db.query('ROLLBACK').catch(()=>{});throw error;}
}
export async function identity(db,system,r){
  const table=system==='flow'?'schema_control.identity':'signal_schema_control.target_identity';
  const target=system==='flow'?r.flowTargetId:r.discoverTargetId;
  const rows=(await db.query(`SELECT system,environment,target_id::text FROM ${table}`)).rows;
  if(rows.length!==1||rows[0].system!==system||rows[0].environment!==r.environment||rows[0].target_id!==target)fail('SETUP_TARGET_MISMATCH');
  const names=system==='flow'?['organizations','sourcing_entitlements','sourcing_org_state']:['governed_sourcing_tenants','rc_org_policies','rc_rate_policies'];
  const {rows:owners}=await db.query(`SELECT count(*)::int n,bool_and(pg_get_userbyid(c.relowner)=current_user) owned
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[])`,[names]);
  if(owners[0]?.n!==names.length||owners[0]?.owned!==true)fail('SETUP_OWNER_REQUIRED');
}
const date=col=>`to_char(${col} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
export async function readFlow(db,r){
  await identity(db,'flow',r);
  const org=(await db.query('SELECT id,is_active,signal_tenant_id FROM organizations WHERE id=$1',[r.organizationId])).rows[0];
  if(!org?.is_active||org.signal_tenant_id!==tenant(r))fail('SETUP_ORGANIZATION_MISMATCH');
  const sub=(await db.query(`SELECT id,organization_id,status,paid_seats,${date("start_date AT TIME ZONE 'UTC'")} anchor,
    ${date("current_period_end AT TIME ZONE 'UTC'")} period_end FROM organization_subscriptions WHERE id=$1 AND organization_id=$2`,[r.subscriptionId,r.organizationId])).rows[0];
  if(!sub)fail('SETUP_SUBSCRIPTION_REQUIRED');
  const ent=(await db.query(`SELECT id,organization_id,subscription_id,${date('anchor')} anchor,${date('valid_from')} valid_from,
    ${date('valid_until')} valid_until,capacity,origin,evidence_sha256,supersedes_id FROM sourcing_entitlements WHERE id=$1`,[r.entitlement.id])).rows[0]??null;
  const state=(await db.query(`SELECT enabled,revision::text revision,entitlement_id,capacity,high_water,${date('anchor')} anchor FROM sourcing_org_state WHERE organization_id=$1`,[r.organizationId])).rows[0]??null;
  const slots=(await db.query('SELECT slot_number,active,current_user_id FROM sourcing_seat_slots WHERE organization_id=$1 ORDER BY slot_number',[r.organizationId])).rows;
  const members=(await db.query(`SELECT m.user_id,m.seat_assigned,u.role AS user_role
    FROM organization_members m JOIN users u ON u.id=m.user_id
    WHERE m.organization_id=$1 ORDER BY m.user_id`,[r.organizationId])).rows;
  const usage=(await db.query(`SELECT slot_id,${date('starts_at')} starts_at,limit_count,reserved,captured FROM sourcing_allowance_windows WHERE organization_id=$1 ORDER BY slot_id,starts_at`,[r.organizationId])).rows;
  const pending=(await db.query(`SELECT
    (SELECT count(*) FROM sourcing_admissions WHERE organization_id=$1 AND state NOT IN ('delivered','cancelled_no_dispatch'))+
    (SELECT count(*) FROM sourcing_dispatch_outbox WHERE organization_id=$1 AND state IN ('pending','leased','needs_attention'))+
    (SELECT count(*) FROM sourcing_digest_requests WHERE organization_id=$1 AND state IN ('reserved','started'))+
    (SELECT count(*) FROM sourcing_count_previews WHERE organization_id=$1 AND state IN ('pending','leased')) AS n`,[r.organizationId])).rows[0].n;
  const routines=(await db.query(`SELECT pg_get_functiondef('public.flow_sourcing_enable(integer,uuid)'::regprocedure) a,
    pg_get_functiondef('public.flow_sourcing_reconcile(integer)'::regprocedure) b`)).rows[0];
  return {org,sub,ent,state,slots,members,usage,pending:Number(pending),routines:hash(routines)};
}
export function expectedEntitlement(r,s){
  if(r.entitlement.mode==='existing'){
    if(!s.ent)fail('SETUP_ENTITLEMENT_REQUIRED');return s.ent;
  }
  const e=r.entitlement;
  return {id:e.id,organization_id:r.organizationId,subscription_id:r.subscriptionId,anchor:e.anchor,valid_from:e.validFrom,
    valid_until:e.validUntil,capacity:e.capacity,origin:'explicit_grant',evidence_sha256:r.approvalEvidenceHash,supersedes_id:null};
}
export function validateFlow(r,s,now=Date.now()){
  const e=expectedEntitlement(r,s);
  if(s.ent)assertSame(s.ent,e,'SETUP_ENTITLEMENT_CONFLICT');
  if(e.organization_id!==r.organizationId||e.subscription_id!==r.subscriptionId||e.anchor!==s.sub.anchor||Date.parse(e.valid_from)>now||Date.parse(e.valid_until)<=now)fail('SETUP_ENTITLEMENT_INVALID');
  if(e.origin!=='explicit_grant'&&(e.origin!=='verified_paid'||s.sub.status!=='active'||s.sub.paid_seats<e.capacity||Date.parse(s.sub.period_end)<=now))fail('SETUP_ENTITLEMENT_INVALID');
  if(s.state?.entitlement_id&&s.state.entitlement_id!==e.id)fail('SETUP_SUPERSESSION_REQUIRES_PLAN');
  if(s.pending)fail('SETUP_PENDING_WORK');
  if(s.state?.enabled&&(s.state.capacity!==e.capacity||s.state.anchor!==e.anchor))fail('SETUP_ACTIVE_ORG_REQUIRES_MAINTENANCE');
  return e;
}
export function makeFlow(db){return {
  read:r=>transaction(db,false,()=>readFlow(db,r)),
  async lock(r){const x=(await db.query('SELECT pg_try_advisory_lock(582190,$1) ok',[r.organizationId])).rows[0];if(!x.ok)fail('SETUP_BUSY');},
  unlock:r=>db.query('SELECT pg_advisory_unlock(582190,$1)',[r.organizationId]),
  async enable(r,before){return transaction(db,true,async()=>{
    await db.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[r.organizationId]);
    await db.query('SELECT id FROM organization_subscriptions WHERE id=$1 FOR UPDATE',[r.subscriptionId]);
    await db.query('SELECT organization_id FROM sourcing_org_state WHERE organization_id=$1 FOR UPDATE',[r.organizationId]);
    const s=await readFlow(db,r);assertSame(s,before);const e=validateFlow(r,s);
    if(s.state?.enabled)return;
    if(!s.ent)await db.query(`INSERT INTO sourcing_entitlements(id,organization_id,subscription_id,anchor,valid_from,valid_until,capacity,origin,evidence_sha256)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[e.id,e.organization_id,e.subscription_id,e.anchor,e.valid_from,e.valid_until,e.capacity,e.origin,e.evidence_sha256]);
    await db.query('SELECT public.flow_sourcing_enable($1,$2)',[r.organizationId,e.id]);
    const after=await readFlow(db,r);assertSame(after.usage,s.usage,'SETUP_USAGE_CHANGED');
  });},
};}
