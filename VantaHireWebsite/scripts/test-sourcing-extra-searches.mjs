import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {makePlan,approvePlan,requestSchema,applyPlan} from './sourcing-extra-searches.mjs';
const now=Date.parse('2026-10-21T00:00:00Z');
const request=()=>({commandId:randomUUID(),organizationId:32,recipientUserId:9,environment:'development',targetId:'synthetic-only',
 body:{action:'issue',quantity:5,validFrom:new Date(now).toISOString(),validUntil:new Date(now+86400000).toISOString(),operatorLabel:'self-declared test operator',reason:'synthetic testing'}});
const snapshot={hash:'a'.repeat(64),databaseUser:'owner_test',state:{eligible:true}};
test('approval binds exact terms, identity and snapshot',()=>{
 const p=makePlan(request(),snapshot,now);assert.equal(approvePlan(p,p.fingerprint,now+1),p);
 for(const altered of [{...p,request:{...p.request,organizationId:33}},{...p,snapshot:{...snapshot,hash:'b'.repeat(64)}},{...p,nonce:randomUUID()}])
  assert.throws(()=>approvePlan(altered,p.fingerprint,now+1),/APPROVAL_MISMATCH/);
});
test('approval expires after fifteen minutes and never accepts future approvals',()=>{
 const p=makePlan(request(),snapshot,now);
 assert.throws(()=>approvePlan(p,p.fingerprint,now+900000),/APPROVAL_EXPIRED/);
 assert.throws(()=>approvePlan(p,p.fingerprint,now-1),/APPROVAL_EXPIRED/);
});
test('strict grant inputs reject seat edits, missing reasons and unlimited quantities',()=>{
 for(const patch of [{quantity:0},{quantity:1001},{quantity:1.5},{reason:''},{operatorLabel:''},{seats:2}])
  assert.equal(requestSchema.safeParse({...request(),body:{...request().body,...patch}}).success,false);
});
test('grant dates must be ordered and unexpired',()=>{
 assert.throws(()=>makePlan({...request(),body:{...request().body,validUntil:new Date(now).toISOString()}},snapshot,now),/DATES_INVALID/);
});
test('revocation requires an exact grant and does not accept new quantity terms',()=>{
 const r={...request(),body:{action:'revoke',grantId:randomUUID(),reason:'test revoke',operatorLabel:'self-declared'}};
 assert.equal(requestSchema.safeParse(r).success,true);
 assert.equal(requestSchema.safeParse({...r,body:{...r.body,quantity:5}}).success,false);
});
test('expired or modified approval makes no database calls',async()=>{
 const p=makePlan(request(),snapshot,now);let calls=0;const db={query(){calls++;throw Error('unexpected database access');}};
 await assert.rejects(applyPlan(db,p,p.fingerprint,now+900000),/APPROVAL_EXPIRED/);
 await assert.rejects(applyPlan(db,{...p,request:{...p.request,recipientUserId:10}},p.fingerprint,now),/APPROVAL_MISMATCH/);
 assert.equal(calls,0);
});
