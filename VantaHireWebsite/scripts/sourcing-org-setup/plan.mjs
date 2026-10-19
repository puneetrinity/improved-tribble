import {parseRequest,hash,assertSame,verifyPlan,fail} from './contracts.mjs';
import {validateFlow,expectedEntitlement} from './flow.mjs';
import {validateDiscover,discoverReady,desiredDiscover} from './discover.mjs';

export function setupWarnings(flow){
  return flow.members.some(m=>m.seat_assigned===true&&m.user_role==='recruiter')?[]:[
    'No recruiter has a seat in this organisation. Assign a seat to a recruiter before they can search for candidates.',
  ];
}

export async function preview(request,io,now=Date.now()){
  const r=parseRequest(request);
  await io.config(r); // configuration attestation only; no signing or HTTP in preview
  const snapshot={flow:await io.flow.read(r),discover:await io.discover.read(r)};
  validateFlow(r,snapshot.flow,now);validateDiscover(r,snapshot.discover);
  if(snapshot.flow.state?.enabled&&!discoverReady(r,snapshot.discover))fail('SETUP_ACTIVE_ORG_REQUIRES_MAINTENANCE');
  const plan={version:1,createdAt:now,expiresAt:now+900000,request:r,snapshot};
  return {plan,sha256:hash(plan),warnings:setupWarnings(snapshot.flow)};
}
function readyFlow(r,current,original){
  const e=expectedEntitlement(r,original);
  if(!current.state?.enabled)return false;
  // The existing enable routine inserts revision 0 or increments an existing
  // row once. A stop always increments it, even when already disabled.
  const prior=original.state;
  if(prior&&!/^(0|[1-9][0-9]*)$/.test(prior.revision??''))fail('SETUP_PLAN_REVISION_REQUIRED');
  const expectedRevision=prior?(BigInt(prior.revision)+(prior.enabled?0n:1n)).toString():'0';
  if(current.state.revision!==expectedRevision)fail('SETUP_STATE_CHANGED');
  for(const key of ['org','sub','members','routines','usage'])assertSame(current[key],original[key]);
  assertSame(current.ent,e,'SETUP_ENTITLEMENT_CONFLICT');
  if(current.state.entitlement_id!==e.id||current.state.anchor!==e.anchor||current.state.capacity!==e.capacity)fail('SETUP_ACTIVE_ORG_REQUIRES_MAINTENANCE');
  return true;
}
export async function apply(plan,approved,io,now=Date.now()){
  verifyPlan(plan,approved,now);
  const r=plan.request;await io.config(r);
  await io.flow.lock(r);
  let phase='preflight';
  try{
    const f=await io.flow.read(r),d=await io.discover.read(r);
    validateFlow(r,f,now);validateDiscover(r,d);
    const finalD=desiredDiscover(r,plan.snapshot.discover);
    // Accept precisely the original or completed state: receipts never authorize drift.
    const prepared=hash(d)===hash(finalD);
    if(!prepared)assertSame(d,plan.snapshot.discover);
    const enabled=readyFlow(r,f,plan.snapshot.flow);
    if(!enabled)assertSame(f,plan.snapshot.flow);
    if(enabled&&!prepared)fail('SETUP_ACTIVE_ORG_REQUIRES_MAINTENANCE');
    await io.probe(r);
    if(enabled)return {version:1,operationId:r.operationId,planHash:approved,state:'ready',replayed:true};
    verifyPlan(plan,approved);
    phase='discover_commit';
    if(!prepared)await io.discover.prepare(r,d);
    assertSame(await io.discover.read(r),finalD);
    assertSame(await io.flow.read(r),f);
    await io.probe(r);
    verifyPlan(plan,approved);
    phase='flow_commit';
    await io.flow.enable(r,f);
    phase='readback';
    const after=await io.flow.read(r);
    if(!readyFlow(r,after,plan.snapshot.flow))fail('SETUP_READBACK_FAILED');
    assertSame(await io.discover.read(r),finalD);
    return {version:1,operationId:r.operationId,planHash:approved,state:'ready',replayed:false};
  }catch(error){
    // A commit response can be lost. Do not retry a write or claim rollback.
    const code=/^SETUP_[A-Z_]+$/.test(error?.message??'')?error.message:'SETUP_UNAVAILABLE';
    return {version:1,operationId:r.operationId,planHash:approved,state:phase==='preflight'?'refused':'verify_before_resume',phase,code};
  }finally{await io.flow.unlock(r).catch(()=>{});}
}
