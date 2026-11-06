// Candidate S2 backend; runtime registration remains gated until migration and grants are integrated.
import {parseConsentProjection} from './spark-contracts';
import {parseProfileJson} from './profile-contracts';
import type {signServiceJwt} from '../lib/services/jwt-signer';

export class ConsentTransportError extends Error {
 constructor(public readonly code:string,public readonly dispatched:boolean){super(code);}
}
export interface ConsentReceipt {eventId:string;version:number;effectiveVersion:number;outcome:'onboarding_granted'|'withdrawn'|'superseded'}
export async function sendConsentV2(raw:string, expectedHash:string, deps:{
 origin:string; sign:typeof signServiceJwt; fetch?:typeof fetch; timeoutMs?:number; localTest?:boolean;
}):Promise<ConsentReceipt>{
 const command=parseConsentProjection(raw);
 if(command.hash!==expectedHash)throw new ConsentTransportError('command_mismatch',false);
 const url=new URL(deps.origin);
 if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||
   (url.protocol!=='https:'&&!(deps.localTest&&url.protocol==='http:'&&url.hostname==='127.0.0.1')))
  throw new ConsentTransportError('invalid_origin',false);
 const ms=deps.timeoutMs??10000;
 if(!Number.isInteger(ms)||ms<1||ms>10000)throw new ConsentTransportError('invalid_timeout',false);
 const controller=new AbortController();let dispatched=false;
 let timer:ReturnType<typeof setTimeout>;
 const expired=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{
  controller.abort();reject(new ConsentTransportError(dispatched?'outcome_unknown':'unavailable',dispatched));
 },ms);});
 const bounded=<T>(promise:Promise<T>)=>Promise.race([promise,expired]);
 try{
  const c=command.value;
  const token=await bounded(deps.sign('activekg',{tenantId:`candidate_${c.subjectId}`,
   scopes:'candidate-consent:write',actorType:'service',requestId:c.eventId,lifetimeSeconds:60}));
  if(controller.signal.aborted)throw new ConsentTransportError('unavailable',false);
  dispatched=true;
  const response=await bounded((deps.fetch??fetch)(`${url.origin}/candidate-consent/v2/events`,{
   method:'POST',redirect:'error',signal:controller.signal,
   headers:{authorization:`Bearer ${token}`,'content-type':'application/json','x-command-sha256':command.hash},
   body:command.canonical,
  }));
  if(response.status!==200&&response.status!==201){
   void response.body?.cancel().catch(()=>{});
   throw new ConsentTransportError(response.status===451?'privacy_restricted':
    [401,403,404,409].includes(response.status)?'remote_rejected':'outcome_unknown',true);
  }
  const reader=response.body?.getReader();
  if(!reader)throw new ConsentTransportError('invalid_receipt',true);
  const chunks:Uint8Array[]=[];let bytes=0;
  try{
   for(;;){const part=await bounded(reader.read());if(part.done)break;
    bytes+=part.value.byteLength;if(bytes>8192)throw new ConsentTransportError('invalid_receipt',true);
    chunks.push(part.value);
   }
  }finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
  let receipt:ConsentReceipt;
  try{
   receipt=parseProfileJson(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))) as ConsentReceipt;
   if(!receipt||Object.keys(receipt).sort().join(',')!=='effectiveVersion,eventId,outcome,version'||
    receipt.eventId!==c.eventId||receipt.version!==c.version||!Number.isSafeInteger(receipt.effectiveVersion)||
    (receipt.outcome==='superseded'?receipt.effectiveVersion<c.version:
     receipt.effectiveVersion!==c.version||receipt.outcome!==(c.action==='grant'?'onboarding_granted':'withdrawn')))
    throw Error();
  }catch{throw new ConsentTransportError('invalid_receipt',true);}
  return receipt;
 }catch(error){
  if(error instanceof ConsentTransportError)throw error;
  throw new ConsentTransportError(dispatched?'outcome_unknown':'unavailable',dispatched);
 }finally{clearTimeout(timer!);controller.abort();}
}
