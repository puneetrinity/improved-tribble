import {transaction,identity} from './flow.mjs';
import {assertDiscoverCatalog} from './discover-catalog.mjs';
import {fail,tenant,callback,policyHash,hash,assertSame} from './contracts.mjs';

export async function readDiscover(db,r){
  await identity(db,'discover',r);
  await assertDiscoverCatalog(db);
  const registration=(await db.query('SELECT tenant_id,organization_ref,callback_url,policy_hash,allow_new FROM governed_sourcing_tenants WHERE tenant_id=$1',[tenant(r)])).rows[0]??null;
  const policy=(await db.query('SELECT id,policy_hash,rc_account_hash,rc_fetch_credits_max,rpm,enabled FROM rc_rate_policies WHERE id=$1',[r.rcPolicyId])).rows[0]??null;
  const mapping=(await db.query('SELECT tenant_id,policy_id,enabled FROM rc_org_policies WHERE tenant_id=$1',[tenant(r)])).rows[0]??null;
  const {rows}=await db.query(`SELECT
    (SELECT count(*) FROM job_sourcing_requests WHERE "tenantId"=$1 AND status IN ('queued','processing','running','pending'))+
    (SELECT count(*) FROM rc_sourcing_runs WHERE tenant_id=$1 AND (state NOT IN ('complete','partial','baseline_only','closed_unrecoverable')
      OR (resume_token IS NOT NULL AND resume_enqueued_at IS NULL AND closed_at IS NULL))) n`,[tenant(r)]);
  const routine=(await db.query("SELECT pg_get_functiondef('public.signal_rc_set_policy(jsonb)'::regprocedure) definition")).rows[0];
  return {registration,policy,mapping,pending:Number(rows[0].n),routine:hash(routine)};
}
export function validateDiscover(r,s){
  const p=s.policy;
  if(!p||p.id!==r.rcPolicyId||p.policy_hash!==r.rcPolicyHash||!p.enabled||!/^[a-f0-9]{64}$/.test(p.rc_account_hash??'')||!Number.isInteger(p.rpm)||p.rpm<1||p.rpm>500||!Number.isInteger(p.rc_fetch_credits_max)||p.rc_fetch_credits_max<1)fail('SETUP_RC_POLICY_REQUIRED');
  const x=s.registration;
  if(x&&(x.tenant_id!==tenant(r)||x.organization_ref!==String(r.organizationId)||x.callback_url!==callback(r)||!/^[a-f0-9]{64}$/.test(x.policy_hash)))fail('SETUP_DISCOVER_CONFLICT');
  if(s.mapping&&(s.mapping.tenant_id!==tenant(r)||s.mapping.policy_id!==r.rcPolicyId))fail('SETUP_RC_MAPPING_CONFLICT');
  if(s.pending)fail('SETUP_PENDING_WORK');
}
export function desiredDiscover(r,s){return {...s,registration:{tenant_id:tenant(r),organization_ref:String(r.organizationId),callback_url:callback(r),policy_hash:s.registration?.policy_hash??policyHash(r),allow_new:true},mapping:{tenant_id:tenant(r),policy_id:r.rcPolicyId,enabled:true}};}
export function discoverReady(r,s){validateDiscover(r,s);return s.registration?.allow_new===true&&s.mapping?.enabled===true;}
export function makeDiscover(db){return {
  read:r=>transaction(db,false,()=>readDiscover(db,r)),
  async prepare(r,before){return transaction(db,true,async()=>{
    await db.query('SELECT pg_advisory_xact_lock(582191,$1)',[r.organizationId]);
    await db.query('SELECT id FROM rc_rate_policies WHERE id=$1 FOR UPDATE',[r.rcPolicyId]);
    await db.query('SELECT tenant_id FROM governed_sourcing_tenants WHERE tenant_id=$1 FOR UPDATE',[tenant(r)]);
    const s=await readDiscover(db,r);assertSame(s,before);validateDiscover(r,s);
    if(discoverReady(r,s))return;
    if(!s.registration)await db.query(`INSERT INTO governed_sourcing_tenants(tenant_id,enabled_at,policy_hash,organization_ref,callback_url,allow_new)
      VALUES($1,clock_timestamp(),$2,$3,$4,false)`,[tenant(r),policyHash(r),String(r.organizationId),callback(r)]);
    if(!s.mapping?.enabled)await db.query('SELECT public.signal_rc_set_policy($1::jsonb)',[JSON.stringify({version:1,action:'organization',tenantId:tenant(r),policyId:r.rcPolicyId,enabled:true})]);
    await db.query('UPDATE governed_sourcing_tenants SET allow_new=true WHERE tenant_id=$1',[tenant(r)]);
    assertSame(await readDiscover(db,r),desiredDiscover(r,s));
  });},
};}
