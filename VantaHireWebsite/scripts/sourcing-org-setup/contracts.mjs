import {createHash} from 'node:crypto';
import {z} from 'zod';

export const fail = code => { throw new Error(code); };
export const hash = value => createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
export function canonical(value) {
  if (Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if (value && typeof value === 'object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
const uuid=z.string().uuid(), digest=z.string().regex(/^[a-f0-9]{64}$/);
// Flow stores an opaque text identity, not a UUID (deployed IDs are 48 hex
// characters). Never trim, case-fold or infer it; DB equality remains exact.
const flowTarget=z.string().min(1).max(512).regex(/^[\x21-\x7e]+$/);
const id=z.number().int().positive().max(2147483647);
const text=z.string().min(1).max(200).regex(/^[^\x00-\x1f\x7f]+$/);
// Six fractional digits preserve PostgreSQL's billing anchor without JS Date truncation.
const instant=z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/).refine(v=>Number.isFinite(Date.parse(v)));
const origin=z.string().url().max(512).refine(v=>{const u=new URL(v);return !u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/'&&u.origin===v;});
export const requestSchema=z.object({
  version:z.literal(1), operationId:uuid, organizationId:id, subscriptionId:id,
  operator:text, reason:text, approvalEvidenceHash:digest,
  environment:z.enum(['development','staging','production']), flowTargetId:flowTarget, discoverTargetId:uuid,
  flowOrigin:origin, discoverOrigin:origin, memoryOrigin:origin,
  configEvidenceHash:digest, rcPolicyId:uuid, rcPolicyHash:digest,
  signedMemoryProbe:z.boolean().optional(),
  entitlement:z.discriminatedUnion('mode',[
    z.object({mode:z.literal('existing'),id:uuid}).strict(),
    z.object({mode:z.literal('grant'),id:uuid,anchor:instant,validFrom:instant,validUntil:instant,
      capacity:z.number().int().min(1).max(10000)}).strict(),
  ]),
}).strict();
export function parseRequest(value) {
  const p=requestSchema.safeParse(value);if(!p.success)fail('SETUP_INVALID_REQUEST');
  const r=p.data;
  for(const name of ['flowOrigin','discoverOrigin','memoryOrigin']){
    const u=new URL(r[name]);
    if(u.protocol!=='https:' && !(r.environment==='development'&&u.protocol==='http:'&&['127.0.0.1','[::1]'].includes(u.hostname)))fail('SETUP_TLS_REQUIRED');
  }
  if(r.entitlement.mode==='grant' && !(Date.parse(r.entitlement.anchor)<=Date.parse(r.entitlement.validFrom)&&Date.parse(r.entitlement.validFrom)<Date.parse(r.entitlement.validUntil)))fail('SETUP_GRANT_DATES');
  return r;
}
export const tenant=r=>'org_'+r.organizationId;
export const callback=r=>r.flowOrigin+'/api/webhooks/signal/callback';
export function assertSame(a,b,code='SETUP_STATE_CHANGED'){if(canonical(a)!==canonical(b))fail(code);}
export function policyHash(r){return hash({version:1,tenantId:tenant(r),organizationRef:String(r.organizationId),callbackUrl:callback(r)});}
export function verifyPlan(plan, approved, now=Date.now()) {
  if(!plan||Object.keys(plan).sort().join(',')!=='createdAt,expiresAt,request,snapshot,version'||plan.version!==1||!Number.isSafeInteger(plan.createdAt)||!Number.isSafeInteger(plan.expiresAt))fail('SETUP_INVALID_PLAN');
  parseRequest(plan.request);
  if(!/^[a-f0-9]{64}$/.test(approved??'')||hash(plan)!==approved)fail('SETUP_PLAN_HASH');
  if(plan.createdAt>now||plan.expiresAt!==plan.createdAt+900000||now>=plan.expiresAt)fail('SETUP_PLAN_EXPIRED');
}
