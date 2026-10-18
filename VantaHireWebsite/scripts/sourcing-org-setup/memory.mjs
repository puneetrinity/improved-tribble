import {randomUUID,createPrivateKey,createPublicKey,sign} from 'node:crypto';
import {readFileSync} from 'node:fs';
import https from 'node:https';
import http from 'node:http';
import {hash,fail,tenant,assertSame} from './contracts.mjs';

export function configuration(r,env){
  // Exported, reviewed service configuration evidence, not an automatic flag change.
  let c;try{c=JSON.parse(readFileSync(env.ORG_SETUP_CONFIG_FILE,'utf8'));}catch{fail('SETUP_CONFIG_REQUIRED');}
  if(hash(c)!==r.configEvidenceHash)fail('SETUP_CONFIG_CHANGED');
  if(c.version!==1||c.flowTargetId!==r.flowTargetId||c.discoverTargetId!==r.discoverTargetId||c.flowOrigin!==r.flowOrigin||c.discoverOrigin!==r.discoverOrigin||c.memoryOrigin!==r.memoryOrigin||c.environment!==r.environment)fail('SETUP_CONFIG_MISMATCH');
  if(!Number.isSafeInteger(c.observedAt)||c.observedAt>Date.now()||Date.now()-c.observedAt>900000)fail('SETUP_CONFIG_EXPIRED');
  const expected=['flowWebSourcing','flowWorkerSourcing','discoverWebGoverned','discoverWorkerGoverned','discoverRc','memoryRc','memoryIndexApi'];
  if(expected.some(k=>c.flags?.[k]!==true))fail('SETUP_FLAGS_REQUIRED');
  if(r.signedMemoryProbe===true&&!/^[a-f0-9]{64}$/.test(c.signalPublicKeyHash??''))fail('SETUP_SIGNER_REQUIRED');
  return c;
}
function token(r,requestId,key){
  const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url'),now=Math.floor(Date.now()/1000);
  const input=enc({alg:'RS256',typ:'JWT'})+'.'+enc({iss:'signal',aud:'activekg',sub:'signal-service',actor_type:'service',tenant_id:tenant(r),scopes:['organization-candidate-sourcing:read'],request_id:requestId,iat:now,exp:now+60,jti:randomUUID()});
  return input+'.'+sign('RSA-SHA256',Buffer.from(input),key).toString('base64url');
}
export function boundedRequest(url,options={}){
  return new Promise((resolve,reject)=>{
    const u=new URL(url),transport=u.protocol==='https:'?https:http;
    const req=transport.request(u,{method:options.body?'POST':'GET',headers:options.headers,
      ca:options.ca,rejectUnauthorized:true},res=>{
      let bytes=0;const chunks=[];
      res.on('data',b=>{bytes+=b.length;if(bytes>8192){req.destroy();reject(Error('SETUP_PROBE_TOO_LARGE'));}else chunks.push(b);});
      res.on('end',()=>{clearTimeout(timer);resolve({status:res.statusCode,body:Buffer.concat(chunks).toString('utf8')});});
      res.on('error',()=>{clearTimeout(timer);reject(Error('SETUP_PROBE_FAILED'));});
    });
    const timer=setTimeout(()=>req.destroy(Error('SETUP_PROBE_TIMEOUT')),5000);
    req.on('error',()=>{clearTimeout(timer);reject(Error('SETUP_PROBE_FAILED'));});
    req.end(options.body);
  });
}
export async function probe(r,env,request=boundedRequest){
  const c=configuration(r,env);
  const ca=env.ORG_SETUP_HTTP_CA_FILE?readFileSync(env.ORG_SETUP_HTTP_CA_FILE):undefined;
  // Memory /readyz is control-plane authenticated. Setup needs only public
  // liveness by default; do not require or distribute its control-plane secret.
  for(const url of [r.flowOrigin+'/readyz',r.discoverOrigin+'/api/health',r.memoryOrigin+'/health']){
    if((await request(url,{ca})).status!==200)fail('SETUP_SERVICE_UNAVAILABLE');
  }
  if(r.signedMemoryProbe!==true)return true;
  // Optional operator probe: key supplied in process memory by the deployment
  // runner, never read from an on-disk private-key file or command argument.
  let key;try{key=createPrivateKey(env.ORG_SETUP_SIGNAL_PRIVATE_KEY);}catch{fail('SETUP_SIGNER_REQUIRED');}
  if(key.asymmetricKeyType!=='rsa'||(key.asymmetricKeyDetails?.modulusLength??0)<2048)fail('SETUP_SIGNER_REQUIRED');
  const der=createPublicKey(key).export({format:'der',type:'spki'});
  // Hash bytes, not the textual PEM representation.
  const {createHash}=await import('node:crypto');
  if(createHash('sha256').update(der).digest('hex')!==c.signalPublicKeyHash)fail('SETUP_SIGNER_MISMATCH');
  const requestId=randomUUID(),publicId=randomUUID();
  const response=await request(r.memoryOrigin+'/organization-candidates/sourcing/public-applicants',{
    ca,body:JSON.stringify({version:1,requestId,publicIds:[publicId]}),
    headers:{'content-type':'application/json',authorization:'Bearer '+token(r,requestId,key)},
  });
  if(response.status!==200)fail('SETUP_MEMORY_AUTH_FAILED');
  let result;try{result=JSON.parse(response.body);}catch{fail('SETUP_MEMORY_AUTH_FAILED');}
  if(result?.version!==1||result.requestId!==requestId||!Array.isArray(result.results)||result.results.length!==1||result.results[0].publicId!==publicId||typeof result.results[0].isApplicant!=='boolean')fail('SETUP_MEMORY_AUTH_FAILED');
  // Never return or log the token or membership response.
  return true;
}
