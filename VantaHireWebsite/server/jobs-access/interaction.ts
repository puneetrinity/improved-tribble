import {randomBytes} from 'node:crypto';
import type {Express,RequestHandler} from 'express';
import {jobsReadiness,type JobsReadinessDependencies} from './readiness';
import {authenticate,issuerCall} from './bridge';

type Account={id:number;authVersion:number;role:string;emailVerified:boolean|null};
const validId=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
const escaped=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function registerJobsInteraction(app:Express,verified:RequestHandler,csrf:RequestHandler,deps:JobsReadinessDependencies,
 enabled:()=>boolean,account:(id:number)=>Promise<Account|undefined>,call=issuerCall){
 const starts=new Map<string,{until:number;count:number}>();
 const guard:RequestHandler=(_req,res,next)=>{res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
  if(!enabled()){res.status(404).json({code:'not_found'});return;}next();};
 app.post('/api/internal/jobs-readiness',guard,async(req,res)=>{
  try{
   const key=process.env.JOBS_MCP_BRIDGE_KEY;if(!key)throw Error('disabled');const raw=(req as typeof req & {rawBody?:string}).rawBody;
   const origin=process.env.JOBS_MCP_WEBSITE_URL,nonce=req.headers['x-jobs-nonce'];
   if(!origin||typeof raw!=='string'||Buffer.byteLength(raw)>8192)throw Error('invalid_request');authenticate(key,req.path,req.headers['x-jobs-time'],raw,req.headers['x-jobs-signature'],origin,nonce);
   const claimed=await call('/internal/readiness-replay',{nonce});if(claimed.accepted!==true)throw Error('replay');
   const a=req.body;if(!a||Object.keys(a).some(k=>!['userId','authVersion','subject'].includes(k))||!Number.isSafeInteger(a.userId)||a.userId<1||!Number.isSafeInteger(a.authVersion))throw Error('invalid_actor');
   const u=await account(a.userId);if(!u||u.role!=='candidate'||u.emailVerified!==true||u.authVersion!==a.authVersion)throw Error('account_restricted');
   res.json(await jobsReadiness(a,deps));
  }catch{res.status(503).json({code:'authority_unavailable'});}
 });
 app.get('/api/candidate/jobs-connect/start',guard,async(req,res)=>{
  try{
   const now=Date.now(),ip=req.ip;
   for(const [key,value] of starts)if(value.until<=now)starts.delete(key);
   if(!ip||ip.length>64||(!starts.has(ip)&&starts.size>=10000)||((starts.get(ip)?.count??0)>=30)){
    res.setHeader('Retry-After','60');res.status(429).send('Too many connection attempts. Try again in a minute.');return;
   }
   const rate=starts.get(ip)??{until:now+60000,count:0};rate.count++;starts.set(ip,rate);
   const uid=req.query.interaction;if(!validId(uid)||Object.keys(req.query).length!==1)throw Error('invalid_request');
   const info=await call('/internal/describe',{interaction:uid});if(typeof info.client_name!=='string'||info.client_name.length>200)throw Error('invalid_client');
   const nonce=randomBytes(24).toString('base64url');
   res.setHeader('Content-Security-Policy',`default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`);
   res.type('html').send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Connect Ealana jobs</title>
<style>body{margin:0;background:#f8fafc;color:#172033;font:16px/1.6 system-ui,sans-serif}main{box-sizing:border-box;max-width:42rem;margin:5vh auto;padding:clamp(1.25rem,5vw,3rem);background:white;border:1px solid #dce2ea;border-radius:16px}h1{font-size:clamp(1.5rem,5vw,2rem);line-height:1.25}a{color:#245fc2;text-underline-offset:3px}button{font:inherit;min-height:44px;padding:10px 18px;margin:4px 8px 4px 0;border:1px solid #b8c2d1;border-radius:8px;background:white;cursor:pointer}#approve{background:#245fc2;color:white;border-color:#245fc2}button:disabled{opacity:.55;cursor:not-allowed}a:focus-visible,button:focus-visible{outline:3px solid #729fe9;outline-offset:3px}#status{padding:12px;background:#f1f5f9;border-radius:8px}</style>
<main><p><strong>ealana</strong> · Jobs connection</p><h1>Connect ${escaped(info.client_name)} to Ealana jobs</h1><p>This assistant can search and read public jobs. It cannot read your candidate profile or apply for you. Access is free.</p>
<p>Your searches and returned job details go to your assistant provider under its own privacy policy. Disconnecting does not delete its conversation history.</p>
<p><a href="/candidate-auth#signin" target="_blank" rel="noopener">Sign in or create an account</a> · <a href="/candidate-setup" target="_blank" rel="noopener">Finish onboarding</a>. Return to this tab afterwards.</p>
<p id="status" role="status" aria-live="polite">Check your account before connecting.</p><button id="check">Check account</button> <button id="approve" disabled>Allow read-only jobs access</button>
<script nonce="${nonce}">
const uid=${JSON.stringify(uid)};const status=document.getElementById('status'),approve=document.getElementById('approve');
async function post(action){const c=await fetch('/api/csrf-token',{cache:'no-store'});if(!c.ok)throw Error();const {token}=await c.json();const r=await fetch('/api/candidate/jobs-connect/'+action,{method:'POST',headers:{'Content-Type':'application/json','x-csrf-token':token},body:JSON.stringify({interaction:uid})});if(!r.ok)throw Error();return r.json();}
document.getElementById('check').onclick=async()=>{approve.disabled=true;try{const r=await post('context');status.textContent='Signed in as '+r.account+'. '+(r.eligible?'Ready to connect.':'Complete onboarding, then check again.');approve.disabled=!r.eligible;}catch{status.textContent='Sign in, finish onboarding and check again. If this request expired, restart from your assistant.';}};
approve.onclick=async()=>{approve.disabled=true;try{const r=await post('approve');window.location.assign(r.resume);}catch{status.textContent='Connection could not complete. Restart from your assistant.';}};
</script></main></html>`);
  }catch{res.status(400).send('Connection unavailable or expired. Restart from your assistant.');}
 });
 for(const action of ['context','approve','connections','disconnect'] as const){
  app.post('/api/candidate/jobs-connect/'+action,guard,verified,csrf,async(req,res)=>{
   try{
    const actor={userId:req.user!.id,authVersion:req.user!.authVersion};const b=req.body;
    const expected=action==='connections'?[]:[action==='disconnect'?'grant_id':'interaction'];
    if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).length!==expected.length||expected.some(k=>!validId(b[k])))throw Error('invalid_request');
    const ready=(action==='context'||action==='approve')?await jobsReadiness(actor,deps):null;
    if(action==='approve'&&!ready?.eligible){res.status(409).json({code:'onboarding_required'});return;}
    const value=await call('/internal/'+action,{...b,actor});
    if(action==='context'){res.json({...value,eligible:ready!.eligible,account:req.user!.username});return;}
    if(action==='approve'){
     const base=process.env.JOBS_MCP_ISSUER_URL;if(!base||typeof value.resume!=='string')throw Error('invalid_response');
     const u=new URL(value.resume),root=new URL(base);if(u.origin!==root.origin||u.protocol!=='https:'||u.pathname!=='/jobs/finish/'+b.interaction||u.search||u.hash||u.username||u.password)throw Error('invalid_response');
    }
    res.json(value);
   }catch{res.status(503).json({code:'connection_unavailable'});}
  });
 }
}
