import test from 'node:test';
import assert from 'node:assert/strict';
import {jobsReadiness,type JobsReadinessDependencies} from './readiness';

function fixture(){
 const owner={subjectId:'subject',bindingId:'binding',pendingCommands:[],hasMorePendingCommands:false};
 const person={displayName:'Example',currentLocation:{city:'City'},skills:['Python'],linkedinUrl:'https://linkedin.com/in/example'};
 const view={profileVersion:1,preferenceVersion:1,preferences:{},confirmedProfile:person,draft:person};
 let reads=0;
 const deps={owner:async()=>{reads++;return owner;},read:async()=>view} as unknown as JobsReadinessDependencies;
 return {owner,view,deps,reads:()=>reads};
}
const actor={userId:1,authVersion:3};

test('confirmed candidate is ready; public sourcing consent is not queried',async()=>{
 const f=fixture();const result=await jobsReadiness(actor,f.deps);
 assert.deepEqual(result,{subject:'subject',auth_generation:'3',eligible:true,reason:'ready'});
 assert.equal(f.reads(),2);
 assert.equal(Object.hasOwn(result,'profile'),false);
});
test('unconfirmed or missing LinkedIn/profile/preferences cannot pass',async()=>{
 for(const change of [()=>({profileVersion:0}),()=>({preferenceVersion:0}),()=>({preferences:null}),
   ()=>({confirmedProfile:null}),()=>({confirmedProfile:{...fixture().view.confirmedProfile,linkedinUrl:null}})]){
  const f=fixture();Object.assign(f.view,change());
  assert.equal((await jobsReadiness(actor,f.deps)).eligible,false);
 }
});
test('pending authority changes and changed LinkedIn require onboarding',async()=>{
 const f=fixture();f.owner.hasMorePendingCommands=true;
 assert.equal((await jobsReadiness(actor,f.deps)).eligible,false);
 f.owner.hasMorePendingCommands=false;
 f.view.draft={...f.view.draft,linkedinUrl:'https://linkedin.com/in/changed'};
 assert.equal((await jobsReadiness(actor,f.deps)).eligible,false);
});
test('identity changes across Memory read fail closed',async()=>{
 const f=fixture();let n=0;
 f.deps.owner=async()=>({...f.owner,bindingId:++n===1?'before':'after'});
 await assert.rejects(jobsReadiness(actor,f.deps),/authority_unavailable/);
});
test('account/privacy or Memory outage cannot produce a ready response',async()=>{
 for(const step of ['owner','read'] as const){
  const f=fixture();f.deps[step]=async()=>{throw Error('blocked');};
  await assert.rejects(jobsReadiness(actor,f.deps));
 }
});
