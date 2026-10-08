import { generateKeyPairSync } from 'node:crypto';
import { afterEach,describe, expect, it, vi } from 'vitest';
import {SignJWT,importPKCS8} from 'jose';
vi.mock('../../candidate-privacy/decision',()=>({requireCandidatePrivacyAllowed:vi.fn()}));
vi.mock('../../lib/aiModelConfig',()=>({getGroqModel:()=> 'fixture-model'}));
import { admitSourcing, openQuote, sealQuote, quoteSourcing } from '../commands';
import {SourcingRepository} from '../repository';
import {closedDatabaseError} from '../../job-brief/repository';
import type {Pool} from 'pg';
import {verifySignalSourcingJwt,clearKeyCache} from '../../lib/services/jwt-signer';
import {callbackBindingMatches} from '../contracts';
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const scope={organizationId:1,jobId:2,actorId:3};
const id='10000000-0000-4000-8000-000000000001';
const quote=()=>({payerUserId:4,payerDisplayName:'Fixture recruiter',payerSlotId:id,remaining:5,windowStart:'2026-10-01T00:00:00.000Z',windowEnd:'2026-11-01T00:00:00.000Z',
  revision:1,briefVersionId:id,materialHash:'a'.repeat(64),artifactId:id,quotedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString()});
describe('authenticated sourcing quote',()=>{
  it('preserves PostgreSQL microseconds in the signed quote and response',async()=>{
    vi.stubEnv('VANTAHIRE_JWT_PRIVATE_KEY',privateKey.export({type:'pkcs8',format:'pem'}).toString());
    try{
      const q={...quote(),windowStart:'2026-10-01T00:00:00.123456+00:00',windowEnd:'2026-11-01T00:00:00.123456+00:00'};
      const repository={call:vi.fn().mockResolvedValue(q)} as unknown as SourcingRepository;
      const result=await quoteSourcing(repository,scope);
      expect(result.windowStart).toBe(q.windowStart);
      expect(openQuote(result.quoteToken,scope,privateKey).windowStart).toBe(q.windowStart);
      const body={requestId:id,expectedRevision:q.revision,briefVersionId:q.briefVersionId,materialHash:q.materialHash,
        artifactId:q.artifactId,expectedPayerSlotId:q.payerSlotId,expectedWindowStart:result.windowStart,quoteToken:result.quoteToken};
      await admitSourcing(repository,scope,body);
      expect(repository.call).toHaveBeenLastCalledWith('admit',[1,2,3,id,expect.objectContaining({expectedWindowStart:q.windowStart})]);
      await expect(admitSourcing(repository,scope,{...body,expectedWindowStart:new Date(q.windowStart).toISOString()})).rejects.toThrow('QUOTE_INVALID');
    }finally{vi.unstubAllEnvs();}
  });
  it('requires exact governed binding on callbacks without changing legacy envelopes',()=>{
    const binding={flowRunId:id,artifactHash:'a'.repeat(64)};
    expect(callbackBindingMatches(undefined,null)).toBe(true);
    expect(callbackBindingMatches(undefined,binding)).toBe(false);
    expect(callbackBindingMatches({protocolVersion:1,...binding},binding)).toBe(true);
    for(const patch of [{flowRunId:'20000000-0000-4000-8000-000000000002'},{artifactHash:'b'.repeat(64)},{protocolVersion:2},{extra:true}]){
      expect(callbackBindingMatches({protocolVersion:1,...binding,...patch},binding)).toBe(false);
    }
    expect(callbackBindingMatches({protocolVersion:1,...binding},null)).toBe(false);
  });
  it('binds actor, job, organization, payer and deadline',()=>{
    const q=quote(),token=sealQuote(scope,q,privateKey);
    expect(openQuote(token,scope,privateKey)).toEqual(q);
    for(const different of [{...scope,organizationId:2},{...scope,jobId:3},{...scope,actorId:4}]) {
      expect(()=>openQuote(token,different,privateKey)).toThrow('QUOTE_INVALID');
    }
    const [body,signature]=token.split('.');
    const changed=JSON.parse(Buffer.from(body!,'base64url').toString('utf8'));
    changed.quote.payerUserId=999;
    expect(()=>openQuote(Buffer.from(JSON.stringify(changed)).toString('base64url')+'.'+signature,scope,privateKey)).toThrow('QUOTE_INVALID');
  });
  it('rejects overlong lifetimes even with an otherwise valid signature',()=>{
    const q=quote();q.expiresAt=new Date(Date.now()+3600000).toISOString();
    expect(()=>openQuote(sealQuote(scope,q,privateKey),scope,privateKey)).toThrow('QUOTE_INVALID');
  });
  it('retains authentic expired quotes for SQL-only idempotent replay',()=>{
    const q=quote();q.quotedAt=new Date(Date.now()-120000).toISOString();q.expiresAt=new Date(Date.now()-60000).toISOString();
    expect(openQuote(sealQuote(scope,q,privateKey),scope,privateKey)).toEqual(q);
  });
});

describe('brief approval independent of paid sourcing allowance',()=>{
  it('returns a conflict for an outdated brief rather than service unavailable',()=>{
    expect(closedDatabaseError({code:'P0001',message:'BRIEF_UPDATED_APPROVAL_REQUIRED'})).toMatchObject({status:409});
  });
  it('rolls back an invalid SQL-produced ranking contract before committing a reservation',async()=>{
    const query=vi.fn(async(sql:string)=>({rows:sql.includes('flow_sourcing_admit')?[{result:{id,replayed:false,rankingContract:{invalid:true}}}]:[]}));
    const client={query,release:vi.fn()},pool={connect:vi.fn().mockResolvedValue(client)} as unknown as Pool;
    await expect(new SourcingRepository(pool).call('admit',[])).rejects.toMatchObject({code:'SOURCING_INVALID_COMMAND',status:409});
    expect(query).toHaveBeenCalledWith('ROLLBACK');expect(query).not.toHaveBeenCalledWith('COMMIT');
  });
  it.each([false,true])('commits approval with enabled=%s and schedules only when entitled',async enabled=>{
    const query=vi.fn(async(sql:string)=>({rows:sql.includes('flow_sourcing_org_state')?[{result:{enabled,latched:enabled}}]:
      sql.includes('flow_job_brief_approve')?[{result:{approved:true}}]:[]}));
    const client={query,release:vi.fn()},pool={connect:vi.fn().mockResolvedValue(client)} as unknown as Pool;
    const repo=new SourcingRepository(pool);
    expect(await repo.approveAndPrepare(scope,{requestId:id,expectedRevision:1,versionId:id},'a'.repeat(64),'fixture-model')).toEqual({approved:true});
    expect(query.mock.calls.some(([sql])=>sql.includes('flow_sourcing_digest_claim'))).toBe(enabled);
    expect(query).toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });
});

describe('machine grant credential isolation',()=>{
  afterEach(()=>{clearKeyCache();vi.unstubAllEnvs();});
  async function token(patch:Record<string,unknown>={}){
    vi.stubEnv('SIGNAL_JWT_PUBLIC_KEY',publicKey.export({type:'spki',format:'pem'}).toString());clearKeyCache();
    const now=Math.floor(Date.now()/1000),key=await importPKCS8(privateKey.export({type:'pkcs8',format:'pem'}).toString(),'RS256');
    return new SignJWT({iss:'signal',aud:'vantahire',sub:'sourcing',tenant_id:'fixture',request_id:id,execution_attempt_id:id,
      acquisition_generation:1,scopes:'sourcing:grant',iat:now,exp:now+300,jti:id,...patch}).setProtectedHeader({alg:'RS256',kid:'v1'}).sign(key);
  }
  it('accepts only the dedicated bound machine credential',async()=>{
    expect(await verifySignalSourcingJwt(await token())).toEqual({tenantId:'fixture',requestId:id,executionAttemptId:id,jti:id});
  });
  it('refuses callback scopes, unrelated audiences and missing execution identity',async()=>{
    for(const patch of [{scopes:'callbacks:write'},{scopes:'callbacks:write sourcing:grant'},{aud:'activekg'},{sub:'other'},
      {acquisition_generation:2},{execution_attempt_id:null},{tenant_id:null},{request_id:null},{jti:null},{exp:Math.floor(Date.now()/1000)+3600}]){
      await expect(verifySignalSourcingJwt(await token(patch))).rejects.toThrow();
    }
  });
});
