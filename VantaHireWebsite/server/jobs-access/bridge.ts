import {createHmac,timingSafeEqual,randomBytes} from 'node:crypto';
import {request} from 'node:https';
import {readFileSync} from 'node:fs';
export function signature(key:string,path:string,stamp:string,body:string,audience:string,nonce:string){
 if(Buffer.byteLength(key)<32)throw Error('bridge_key_required');
 if(!/^https:\/\/[^/]+$/.test(audience)||!/^[a-f0-9]{48}$/.test(nonce))throw Error('invalid_bridge_target');
 return createHmac('sha256',key).update(['POST',audience,path,stamp,nonce,body].join('\n')).digest('hex');
}
export function authenticate(key:string,path:string,stamp:unknown,body:string,mac:unknown,audience:string,nonce:unknown,now=Date.now()){
 if(typeof stamp!=='string'||!/^\d{13}$/.test(stamp)||Math.abs(now-Number(stamp))>30000||typeof mac!=='string'||!/^[0-9a-f]{64}$/.test(mac))throw Error('invalid_bridge');
 if(typeof nonce!=='string'||!timingSafeEqual(Buffer.from(mac,'hex'),Buffer.from(signature(key,path,stamp,body,audience,nonce),'hex')))throw Error('invalid_bridge');
}
export async function issuerCall(path:string,value:unknown){
 const base=process.env.JOBS_MCP_BRIDGE_URL,key=process.env.JOBS_MCP_BRIDGE_KEY;
 if(!base||!key)throw Error('issuer_unavailable');
 const root=new URL(base),url=new URL(path,root);
 if(root.protocol!=='https:'||root.username||root.password||root.pathname!=='/'||root.search||root.hash||url.origin!==root.origin)throw Error('invalid_issuer');
 const body=JSON.stringify(value),stamp=String(Date.now()),nonce=randomBytes(24).toString('hex');if(Buffer.byteLength(body)>8192)throw Error('invalid_request');
 const cert=process.env.JOBS_MCP_BRIDGE_CERT_FILE,privateKey=process.env.JOBS_MCP_BRIDGE_KEY_FILE,ca=process.env.JOBS_MCP_BRIDGE_CA_FILE;
 if(!cert||!privateKey||!ca)throw Error('bridge_mtls_required');
 return new Promise<Record<string,unknown>>((resolve,reject)=>{
  const r=request(url,{method:'POST',cert:readFileSync(cert),key:readFileSync(privateKey),ca:readFileSync(ca),rejectUnauthorized:true,
   signal:AbortSignal.timeout(1000),headers:{'content-type':'application/json','content-length':Buffer.byteLength(body),
    'x-jobs-time':stamp,'x-jobs-nonce':nonce,'x-jobs-signature':signature(key,path,stamp,body,root.origin,nonce)}},response=>{
   if(response.statusCode!==200){response.destroy();reject(Error('issuer_unavailable'));return;}
   let size=0;const parts:Buffer[]=[];
   response.on('data',(part:Buffer)=>{size+=part.length;if(size>8192){response.destroy();reject(Error('invalid_response'));}else parts.push(part);});
   response.on('error',()=>reject(Error('issuer_unavailable')));
   response.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(parts).toString('utf8')));}catch{reject(Error('invalid_response'));}});
  });r.on('error',()=>reject(Error('issuer_unavailable')));r.end(body);
 });
}
