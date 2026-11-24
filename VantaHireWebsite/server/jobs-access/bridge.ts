import {createHmac,timingSafeEqual} from 'node:crypto';
export function signature(key:string,path:string,stamp:string,body:string){
 if(Buffer.byteLength(key)<32)throw Error('bridge_key_required');
 return createHmac('sha256',key).update(stamp+'\n'+path+'\n'+body).digest('hex');
}
export function authenticate(key:string,path:string,stamp:unknown,body:string,mac:unknown,now=Date.now()){
 if(typeof stamp!=='string'||!/^\d{13}$/.test(stamp)||Math.abs(now-Number(stamp))>30000||typeof mac!=='string'||!/^[0-9a-f]{64}$/.test(mac))throw Error('invalid_bridge');
 if(!timingSafeEqual(Buffer.from(mac,'hex'),Buffer.from(signature(key,path,stamp,body),'hex')))throw Error('invalid_bridge');
}
export async function issuerCall(path:string,value:unknown){
 const base=process.env.JOBS_MCP_ISSUER_URL,key=process.env.JOBS_MCP_BRIDGE_KEY;
 if(!base||!key)throw Error('issuer_unavailable');
 const root=new URL(base),url=new URL(path,root);
 if(root.protocol!=='https:'||root.username||root.password||root.pathname!=='/'||root.search||root.hash||url.origin!==root.origin)throw Error('invalid_issuer');
 const body=JSON.stringify(value),stamp=String(Date.now());if(Buffer.byteLength(body)>8192)throw Error('invalid_request');
 const r=await fetch(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(1000),
  headers:{'content-type':'application/json','x-jobs-time':stamp,'x-jobs-signature':signature(key,path,stamp,body)},body});
 if(!r.ok||!r.body)throw Error('issuer_unavailable');
 const reader=r.body.getReader();let size=0;const parts:Buffer[]=[];
 try{for(;;){const x=await reader.read();if(x.done)break;size+=x.value.length;if(size>8192)throw Error('invalid_response');parts.push(Buffer.from(x.value));}}
 finally{await reader.cancel();}
 return JSON.parse(Buffer.concat(parts).toString('utf8')) as Record<string,unknown>;
}
