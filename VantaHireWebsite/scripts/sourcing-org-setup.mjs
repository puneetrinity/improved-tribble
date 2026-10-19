// Operator-only. Never import into web/worker entrypoints.
import {pathToFileURL} from 'node:url';
import {parseRequest,fail,hash} from './sourcing-org-setup/contracts.mjs';
import {connectOwner,makeFlow} from './sourcing-org-setup/flow.mjs';
import {makeDiscover} from './sourcing-org-setup/discover.mjs';
import {preview,apply} from './sourcing-org-setup/plan.mjs';
import {configuration,probe} from './sourcing-org-setup/memory.mjs';
import {readJson,writeJson} from './sourcing-org-setup/receipt.mjs';

export async function main(args=process.argv.slice(2),env=process.env){
  const [mode,...rest]=args;
  if(!['plan','apply','resume'].includes(mode)||rest.length%2)fail('SETUP_USAGE');
  const opts={};for(let i=0;i<rest.length;i+=2){if(opts[rest[i]]!==undefined||!['--request','--plan','--output','--approve-sha256'].includes(rest[i]))fail('SETUP_USAGE');opts[rest[i]]=rest[i+1];}
  if(mode==='plan'?(Object.keys(opts).sort().join(',')!=='--output,--request'):(Object.keys(opts).sort().join(',')!=='--approve-sha256,--output,--plan'))fail('SETUP_USAGE');
  if(opts['--output']===opts['--request']||opts['--output']===opts['--plan'])fail('SETUP_OUTPUT_CONFLICT');
  const input=await readJson(opts[mode==='plan'?'--request':'--plan']);
  const r=parseRequest(mode==='plan'?input:input.request);
  configuration(r,env);
  let f,d;
  try{
    f=await connectOwner(env.ORG_SETUP_FLOW_OWNER_URL,env.ORG_SETUP_FLOW_CA_FILE,r.environment);
    d=await connectOwner(env.ORG_SETUP_DISCOVER_OWNER_URL,env.ORG_SETUP_DISCOVER_CA_FILE,r.environment);
    const io={flow:makeFlow(f),discover:makeDiscover(d),config:r=>configuration(r,env),probe:r=>probe(r,env)};
    if(mode==='plan'){
      const result=await preview(r,io);await writeJson(opts['--output'],result.plan);
      console.log(JSON.stringify({state:'preview',sha256:result.sha256,organizationId:r.organizationId,
        seats:result.plan.snapshot.flow.ent?.capacity??r.entitlement.capacity,runsPerSeat:5,
        existingUsage:result.plan.snapshot.flow.usage,expiresAt:result.plan.expiresAt,paidCalls:0,warnings:result.warnings}));
    }else{
      const result=await apply(input,opts['--approve-sha256'],io);await writeJson(opts['--output'],result);
      console.log(JSON.stringify(result));if(result.state!=='ready')process.exitCode=1;
    }
  }finally{await d?.end().catch(()=>{});await f?.end().catch(()=>{});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  main().catch(e=>{console.error(/^SETUP_[A-Z_]+$/.test(e?.message??'')?e.message:'SETUP_UNAVAILABLE');process.exitCode=1;});
}
