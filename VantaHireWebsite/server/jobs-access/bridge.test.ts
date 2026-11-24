import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:https';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {issuerCall,authenticate} from './bridge';

test('real HTTPS bridge: client certificate, signed request, bounded reply and no redirects',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'jobs-bridge-test-'));
 const cert=join(directory,'cert.pem'),key=join(directory,'key.pem');
 const names=['JOBS_MCP_BRIDGE_URL','JOBS_MCP_BRIDGE_KEY','JOBS_MCP_BRIDGE_CERT_FILE','JOBS_MCP_BRIDGE_KEY_FILE','JOBS_MCP_BRIDGE_CA_FILE'] as const;
 const before=Object.fromEntries(names.map(k=>[k,process.env[k]]));
 let mode='ok',calls=0,origin='';const secret='s'.repeat(64);
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=127.0.0.1',
  '-addext','subjectAltName=IP:127.0.0.1','-keyout',key,'-out',cert],{stdio:'ignore'});
 const server=createServer({key:readFileSync(key),cert:readFileSync(cert),ca:readFileSync(cert),requestCert:true,rejectUnauthorized:true},async(req,res)=>{
  calls++;const parts:Buffer[]=[];for await(const chunk of req)parts.push(chunk);
  try{authenticate(secret,req.url!,req.headers['x-jobs-time'],Buffer.concat(parts).toString(),req.headers['x-jobs-signature'],origin,req.headers['x-jobs-nonce']);}
  catch{res.writeHead(400);res.end();return;}
  if(mode==='redirect'){res.writeHead(302,{Location:origin+'/elsewhere'});res.end();return;}
  res.writeHead(200,{'Content-Type':'application/json'});res.end(mode==='large'?'x'.repeat(8193):'{"accepted":true}');
 });
 try{
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address();assert.ok(address&&typeof address==='object');origin=`https://127.0.0.1:${address.port}`;
  Object.assign(process.env,{JOBS_MCP_BRIDGE_URL:origin,JOBS_MCP_BRIDGE_KEY:secret,JOBS_MCP_BRIDGE_CERT_FILE:cert,JOBS_MCP_BRIDGE_KEY_FILE:key,JOBS_MCP_BRIDGE_CA_FILE:cert});
  assert.deepEqual(await issuerCall('/internal/readiness-replay',{nonce:'a'.repeat(48)}),{accepted:true});
  mode='redirect';await assert.rejects(issuerCall('/internal/connections',{}));assert.equal(calls,2);
  mode='large';await assert.rejects(issuerCall('/internal/connections',{}));
  delete process.env.JOBS_MCP_BRIDGE_CERT_FILE;await assert.rejects(issuerCall('/internal/connections',{}),/mtls_required/);assert.equal(calls,3);
 }finally{
  server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));
  for(const name of names){if(before[name]===undefined)delete process.env[name];else process.env[name]=before[name];}
  rmSync(directory,{recursive:true,force:true});
 }
});
