import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {governedSignalPost} from '../lib/services/signal-client';
import {SourcingRepository} from './repository';
import {executeDigestPreparation,type DigestClaim} from './digest';
import {sourcingEnabled,hashSchema,idSchema} from './contracts';

const boundSchema=z.object({requestId:z.string().min(1).max(200),status:z.string(),flowRunId:idSchema,artifactHash:hashSchema,
  acquisitionGeneration:z.literal(1),executionAttemptId:idSchema,idempotent:z.boolean()}).strict();
const previewSchema=z.object({previewId:idSchema,state:z.enum(['pending','complete','unknown','unavailable']),
  count:z.number().int().nonnegative().safe().nullable(),countRelation:z.enum(['eq','gte','approximate']).nullable(),
  creditsUsed:z.number().min(0).max(0.03).nullable()}).strict();
type Preparation={input:{organizationId:number;jobId:number;actorId:number;requestId:string;model:string};claim:DigestClaim};
type Dispatch={admissionId:string;organizationId:number;tenantId:string;lease:string;command:Record<string,unknown>};
type Preview={id:string;lease:string;tenantId:string;externalJobId:string;command:unknown};

function callbackUrl():string {
  const raw=process.env.BASE_URL;
  if(!raw)throw Error('SOURCING_CALLBACK_CONFIGURATION');
  const url=new URL(raw);
  if(url.username||url.password||url.hash||url.search||
    (process.env.NODE_ENV==='production'?url.protocol!=='https:':!['https:','http:'].includes(url.protocol)))throw Error('SOURCING_CALLBACK_CONFIGURATION');
  return `${url.toString().replace(/\/+$/,'')}/api/webhooks/signal/callback`;
}
/** One bounded cycle, no overlapping work and no provider action before its
 * durable claim. Individual stages fail independently; no automatic source run
 * is created by this worker. It sends only already-admitted outbox work. */
export async function runSourcingAuthorityCycle(repository=new SourcingRepository(),
  transport=governedSignalPost, report:(code:string)=>void=()=>undefined) {
  if(!sourcingEnabled())return;
  try {
    const work=await repository.call<Preparation>('digestNext',[randomUUID()]);
    if(work)await executeDigestPreparation(repository,work.input,{claim:work.claim});
  }catch{report('SOURCING_PREPARATION_CYCLE_FAILED');}
  try {
    // Resolve configuration before taking a lease, not after a paid operation.
    const callback=callbackUrl();
    const dispatch=await repository.call<Dispatch>('dispatchClaim',[randomUUID()]);
    if(dispatch) {
      let result:unknown;
      try {
        const response=boundSchema.parse(await transport({kind:'source',tenantId:dispatch.tenantId,
          externalJobId:String(dispatch.command.externalJobId),requestId:dispatch.admissionId,body:{...dispatch.command,callbackUrl:callback}}));
        result={kind:'bound',requestId:response.requestId,flowRunId:response.flowRunId,artifactHash:response.artifactHash,
          acquisitionGeneration:response.acquisitionGeneration,executionAttemptId:response.executionAttemptId};
      }catch{result={kind:'retry',code:'SOURCING_BIND_UNCERTAIN'};}
      await repository.call('dispatchFinish',[dispatch.admissionId,dispatch.lease,result]);
    }
  }catch{report('SOURCING_DISPATCH_CYCLE_FAILED');}
  try {
    const preview=await repository.call<Preview>('previewClaim',[randomUUID()]);
    if(preview) {
      let result:unknown;
      try {
        const response=previewSchema.parse(await transport({kind:'preview',tenantId:preview.tenantId,
          externalJobId:preview.externalJobId,requestId:preview.id,body:preview.command}));
        if(response.previewId!==preview.id)throw Error('SOURCING_PREVIEW_BINDING');
        result=response.state==='complete'?{state:'complete',count:response.count,countRelation:response.countRelation,creditsUsed:response.creditsUsed}:{state:response.state};
      }catch{
        // Re-poll the same preview identity, never make a new purchase. SQL
        // bounds total polling time and ultimately records unknown.
        result={state:'pending'};
      }
      await repository.call('previewFinish',[preview.id,preview.lease,result]);
    }
  }catch{report('SOURCING_PREVIEW_CYCLE_FAILED');}
}

export function startSourcingAuthorityWorker(report:(code:string)=>void) {
  if(!sourcingEnabled())return ()=>undefined;
  let stopped=false,timer:ReturnType<typeof setTimeout>|undefined;
  const cycle=async()=>{
    try{await runSourcingAuthorityCycle(undefined,undefined,report);}
    catch{report('SOURCING_WORKER_CYCLE_FAILED');}
    finally{if(!stopped){timer=setTimeout(cycle,3000);timer.unref();}}
  };
  timer=setTimeout(cycle,0);timer.unref();
  return ()=>{stopped=true;if(timer)clearTimeout(timer);};
}
