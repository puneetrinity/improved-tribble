import {LOOKUP_DEADLINE_MS,LOOKUP_RESPONSE_BYTES,LookupError,lookupOperationSchema,parseLookupResponse,type LookupResult} from './source-contracts';
import {parseLookupTransfer,validateSourceReceipt} from './spark-contracts';
import {parseProfileJson} from './profile-contracts';
import {foundationMemoryOrigin} from './memory-client';
import {signServiceJwt} from '../lib/services/jwt-signer';

export class LookupDeliveryError extends Error {
 constructor(public readonly retryable:boolean,public readonly status:number){super('lookup_delivery_refused');}
}

/** Exact persisted professional-lookup transfer. No provider access or retries.
 * Signature, request and response share one 10-second deadline. */
export async function deliverLookupTransfer(stored:{canonical:string;sha256:string},
 deps:{fetch?:typeof fetch;sign?:typeof signServiceJwt;env?:NodeJS.ProcessEnv}={}){
 const t=parseLookupTransfer(stored.canonical);
 if(t.canonical!==stored.canonical||t.hash!==stored.sha256)throw Error('lookup_document_changed');
 const origin=foundationMemoryOrigin(deps.env),controller=new AbortController();
 let timer:ReturnType<typeof setTimeout>|undefined;
 const run=async()=>{
  const token=await(deps.sign??signServiceJwt)('activekg',{tenantId:`candidate_${t.value.subjectId}`,scopes:'candidate-profile:owner-write',
   actorType:'service',requestId:t.value.commandId,lifetimeSeconds:60});
  if(controller.signal.aborted)throw Error('delivery_outcome_unknown');
  const response=await(deps.fetch??fetch)(`${origin}/candidate-profiles/sources/lookup`,{method:'POST',redirect:'error',signal:controller.signal,
   headers:{authorization:`Bearer ${token}`,'content-type':'application/json','x-command-sha256':t.hash,
    'x-candidate-binding-id':t.value.bindingId,'x-candidate-command-id':t.value.commandId},body:stored.canonical});
  if(controller.signal.aborted||response.status!==200){void response.body?.cancel().catch(()=>{});
   if(controller.signal.aborted)throw Error('delivery_outcome_unknown');
   throw new LookupDeliveryError(response.status>=500||response.status===408||response.status===429,response.status);}
  const reader=response.body?.getReader();if(!reader)throw Error('delivery_outcome_unknown');
  const chunks:Uint8Array[]=[];let bytes=0;
  const cancel=()=>{void reader.cancel().catch(()=>{});};controller.signal.addEventListener('abort',cancel,{once:true});
  try{for(;;){if(controller.signal.aborted)throw Error('delivery_outcome_unknown');const {done,value}=await reader.read();if(done)break;
   bytes+=value.byteLength;if(bytes>8192){cancel();throw Error('delivery_outcome_unknown');}chunks.push(value);}}
  finally{controller.signal.removeEventListener('abort',cancel);reader.releaseLock();}
  const receipt=parseProfileJson(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)),8192);
  return validateSourceReceipt(t.value,receipt,'professional_lookup');
 };
 try{return await Promise.race([run(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('delivery_outcome_unknown'));},10000);})]);}
 finally{if(timer)clearTimeout(timer);controller.abort();}
}

/** Internal one-shot transport. No route/startup registration. The durable
 * provider journal must commit dispatch BEFORE calling this adapter. An error
 * with dispatched=true is NOT evidence of no charge, including 429 and 5xx.
 * No live endpoint, second fetch, redirects, or automatic network retry. */
export async function lookupProfessionalProfile(input:unknown,deps:{apiKey:string;fetch?:typeof fetch;signal?:AbortSignal}):Promise<LookupResult>{
 const parsed=lookupOperationSchema.safeParse(input);
 if(!parsed.success)throw new LookupError('invalid_request',false);
 if(!deps.apiKey||deps.apiKey.length>8192||/[\s\0]/.test(deps.apiKey))throw new LookupError('invalid_configuration',false);
 if(deps.signal?.aborted)throw new LookupError('deadline',false);
 const controller=new AbortController();let dispatched=false,reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
 let rejectDeadline!:(e:LookupError)=>void;
 const deadline=new Promise<never>((_,reject)=>{rejectDeadline=reject;});
 const abort=()=>{controller.abort();rejectDeadline(new LookupError('deadline',dispatched));};
 const deadlineAt=Date.now()+LOOKUP_DEADLINE_MS;
 const timer=setTimeout(abort,LOOKUP_DEADLINE_MS);
 deps.signal?.addEventListener('abort',abort,{once:true});
 const bounded=<T>(p:Promise<T>)=>Promise.race([p,deadline]);
 try{
  const op=parsed.data;
  dispatched=true;
  const response=await bounded((deps.fetch??fetch)(`https://api.reversecontact.com/v2/${op.kind==='email'?'enrich':'fetch'}/persons`,{
   method:'POST',redirect:'error',signal:controller.signal,headers:{Authorization:`Bearer ${deps.apiKey}`,'Content-Type':'application/json'},
   body:JSON.stringify(op.kind==='email'?{email:op.email}:{url:op.url}),
  }).then(response=>{if(controller.signal.aborted)void response.body?.cancel().catch(()=>{});return response;}));
  if(controller.signal.aborted){void response.body?.cancel().catch(()=>{});throw new LookupError('deadline',true);}
  if(response.status!==200&&response.status!==404){void response.body?.cancel().catch(()=>{});throw new LookupError('outcome_unknown',true);}
  const length=response.headers.get('content-length');
  if(length!==null&&(!/^\d+$/.test(length)||Number(length)>LOOKUP_RESPONSE_BYTES)){
   void response.body?.cancel().catch(()=>{});throw new LookupError('invalid_response',true);
  }
  reader=response.body?.getReader();if(!reader)throw new LookupError('invalid_response',true);
  const chunks:Uint8Array[]=[];let bytes=0;
  for(;;){const chunk=await bounded(reader.read());if(chunk.done)break;
   bytes+=chunk.value.byteLength;if(bytes>LOOKUP_RESPONSE_BYTES)throw new LookupError('invalid_response',true);chunks.push(chunk.value);}
  if(Date.now()>=deadlineAt)throw new LookupError('deadline',true);
  const result=parseLookupResponse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)),response.status,op);
  if(Date.now()>=deadlineAt)throw new LookupError('deadline',true);
  return result;
 }catch(e){if(e instanceof LookupError)throw e;throw new LookupError('outcome_unknown',dispatched);}
 finally{clearTimeout(timer);deps.signal?.removeEventListener('abort',abort);controller.abort();
  if(reader){void reader.cancel().catch(()=>{});reader.releaseLock();}}
}
