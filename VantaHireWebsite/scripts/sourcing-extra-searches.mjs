// Owner-only CLI. Invocation: node --import tsx scripts/sourcing-extra-searches.mjs
// plan request.json plan.json | apply plan.json --approve <fingerprint> | read request.json
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {z} from 'zod';
import {connectOwner,transaction} from './sourcing-org-setup/flow.mjs';

const body=z.discriminatedUnion('action',[
 z.object({action:z.literal('issue'),quantity:z.number().int().min(1).max(1000),validFrom:z.string().datetime({offset:true}),validUntil:z.string().datetime({offset:true}),operatorLabel:z.string().trim().min(1).max(160),reason:z.string().trim().min(1).max(500)}).strict(),
 z.object({action:z.literal('revoke'),grantId:z.string().uuid(),operatorLabel:z.string().trim().min(1).max(160),reason:z.string().trim().min(1).max(500)}).strict(),
]);
export const requestSchema=z.object({commandId:z.string().uuid(),organizationId:z.number().int().positive(),recipientUserId:z.number().int().positive(),environment:z.enum(['development','production']),targetId:z.string().regex(/^[!-~]{1,512}$/),body}).strict();
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export const fingerprint=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const fail=code=>{throw Error(code);};
export function approvePlan(plan,approval,now=Date.now()){
 const {fingerprint:claimed,...unsigned}=plan;
 if(claimed!==approval||fingerprint(unsigned)!==claimed)fail('EXTRA_APPROVAL_MISMATCH');
 requestSchema.parse(plan.request);
 if(plan.version!==1||!z.string().uuid().safeParse(plan.nonce).success||!Number.isSafeInteger(plan.createdAt)||!Number.isSafeInteger(plan.expiresAt)
  ||plan.createdAt>now||plan.expiresAt-plan.createdAt!==900000||now>=plan.expiresAt)fail('EXTRA_APPROVAL_EXPIRED');
 return plan;
}
export function makePlan(request,snapshot,now=Date.now()){
 request=requestSchema.parse(request);
 if(request.body.action==='issue'&&(Date.parse(request.body.validUntil)<=Math.max(now,Date.parse(request.body.validFrom))))fail('EXTRA_DATES_INVALID');
 const unsigned={version:1,request,snapshot,createdAt:now,expiresAt:now+900000,nonce:randomUUID(),
  notice:'Operator label is self-declared. Extras do not extend sourcing access or add seats. Existing reservations survive revocation.'};
 return {...unsigned,fingerprint:fingerprint(unsigned)};
}
export async function readSnapshot(db,r){
 const {SOURCING_CATALOG_SQL,SOURCING_CATALOG_SHA256}=await import('../server/sourcing-authority/catalog.ts');
 const identities=(await db.query('SELECT system,environment,target_id FROM schema_control.identity')).rows;
 if(identities.length!==1||identities[0].system!=='flow'||identities[0].environment!==r.environment||identities[0].target_id!==r.targetId)fail('EXTRA_TARGET_MISMATCH');
 const who=(await db.query("SELECT session_user AS database_user,session_user=pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid='public.sourcing_extra_grants'::regclass")).rows[0];
 if(!who?.owner)fail('EXTRA_OWNER_REQUIRED');
 if((await db.query(SOURCING_CATALOG_SQL)).rows[0]?.digest!==SOURCING_CATALOG_SHA256)fail('EXTRA_CATALOG_MISMATCH');
 const value=(await db.query("SELECT s AS state,encode(sha256(convert_to(s::text,'UTF8')),'hex') AS hash FROM (SELECT public.flow_sourcing_extra_snapshot($1,$2) s) x",[r.organizationId,r.recipientUserId])).rows[0];
 return {...value,databaseUser:who.database_user};
}
export async function applyPlan(db,plan,approval,now=Date.now()){
 approvePlan(plan,approval,now);
 const r=plan.request;
 return transaction(db,true,async()=>{
  const current=await readSnapshot(db,r);
  if(current.databaseUser!==plan.snapshot.databaseUser)fail('EXTRA_OWNER_CHANGED');
  // SQL serializes with admissions/revocation, rechecks the approved snapshot,
  // and returns the original receipt on exact replay before requiring that snapshot.
  return (await db.query('SELECT public.flow_sourcing_extra_manage($1,$2,$3,$4,$5) AS result',[
   r.organizationId,r.recipientUserId,r.commandId,r.body,plan.snapshot.hash])).rows[0].result;
 });
}
export async function readCommand(db,request){
 const r=requestSchema.parse(request);await readSnapshot(db,r);
 const row=(await db.query(`SELECT e.grant_id,e.kind,e.database_user,
   e.command_sha256=encode(sha256(convert_to(jsonb_build_array($1::integer,$2::integer,$4::jsonb)::text,'UTF8')),'hex') matches
   FROM sourcing_extra_events e JOIN sourcing_extra_grants g ON g.id=e.grant_id
   WHERE e.id=$3 AND e.organization_id=$1 AND g.recipient_user_id=$2`,[r.organizationId,r.recipientUserId,r.commandId,r.body])).rows[0];
 if(row&&!row.matches)fail('EXTRA_COMMAND_CONFLICT');
 return {commandId:r.commandId,found:!!row,...(row?{grantId:row.grant_id,action:row.kind,databaseUser:row.database_user}:{})};
}
async function main(){
 const [mode,input,output,approval]=process.argv.slice(2);
 if(mode==='plan'?!input||!output:mode==='apply'?!input||output!=='--approve'||!approval:mode==='read'?!input||!!output:true)fail('EXTRA_USAGE');
 const data=JSON.parse(readFileSync(input,'utf8'));
 const r=mode==='apply'?approvePlan(data,approval).request:requestSchema.parse(data);
 const db=await connectOwner(process.env.FLOW_EXTRA_OWNER_URL,process.env.FLOW_EXTRA_CA_FILE,r.environment);
 try{
  if(mode==='plan'){
   const snapshot=await transaction(db,false,()=>readSnapshot(db,r));
   if(r.body.action==='issue'&&!snapshot.state.eligible)fail('EXTRA_RECIPIENT_INELIGIBLE');
   const plan=makePlan(r,snapshot);writeFileSync(output,JSON.stringify(plan,null,2)+'\n',{mode:0o600,flag:'wx'});
   console.log(JSON.stringify({fingerprint:plan.fingerprint,organizationId:r.organizationId,recipientUserId:r.recipientUserId,
    eligible:snapshot.state.eligible,slots:snapshot.state.slots,
    existingGrants:snapshot.state.grants.map(g=>({id:g.id,quantity:g.quantity,expiresAt:g.valid_until,balance:g.balance})),
    entitlementExpiresAt:snapshot.state.entitlement?.valid_until??null,notice:plan.notice,terms:r.body,
    warning:r.body.action==='issue'&&Date.parse(r.body.validUntil)>Date.parse(snapshot.state.entitlement?.valid_until)
      ?`Extra searches do not extend access. Renew sourcing access before using them after ${snapshot.state.entitlement.valid_until}.`:null}));
  }else if(mode==='read')console.log(JSON.stringify(await transaction(db,false,()=>readCommand(db,r))));
  else console.log(JSON.stringify(await applyPlan(db,data,approval)));
 }finally{await db.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(()=>{console.error('EXTRA_COMMAND_REFUSED: inspect the approved input and database state; no automatic retry.');process.exitCode=1;});
