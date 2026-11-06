import {afterEach,describe,expect,it,vi} from 'vitest';
import {validateNetworkDelivery,readNetworkStatus} from './profile-client';
import {parseNetworkOrigin,parsePrivateOrigin,networkPublicationAuthority} from '../sourcing-authority/candidate-origin';
import {readSourcingCandidateOrigin,applicantContactBlocked} from '../../shared/sourcing-candidate-origin';
import {flattenCandidateForUI} from '../lib/services/signal-contracts';
const authority={subjectId:'11111111-1111-4111-8111-111111111111',publicationId:'22222222-2222-4222-8222-222222222222',
 profileVersion:1,preferenceVersion:1,consentRevision:1,contentHash:'a'.repeat(64)};
const env={NODE_ENV:'test',ACTIVEKG_BASE_URL:'https://memory.example',CANDIDATE_NETWORK_SOURCING_ENABLED:'true'};
const sign=vi.fn().mockResolvedValue('test-token');
afterEach(()=>vi.useRealTimers());
describe('native sourcing identity and delivery',()=>{
 it('separates service authority from browser display and keeps contact purchases closed',()=>{
  const candidateOrigin={version:1,kind:'candidate_network',...authority};
  expect(parseNetworkOrigin({candidateOrigin})).toEqual({identity:authority,display:{version:1,kind:'candidate_network'}});
  expect(parsePrivateOrigin({candidateOrigin})).toBeNull();
  expect(readSourcingCandidateOrigin({version:1,kind:'candidate_network'}).kind).toBe('candidate_network');
  expect(readSourcingCandidateOrigin(candidateOrigin).kind).toBe('invalid');
  expect(applicantContactBlocked({candidateSummary:{candidateOrigin:{version:1,kind:'candidate_network'}}})).toBe(true);
 });
 it('rejects incomplete and substituted identities',()=>{
  expect(()=>parseNetworkOrigin({candidateOrigin:{version:1,kind:'candidate_network'}})).toThrow();
  expect(networkPublicationAuthority.safeParse({...authority,consentRevision:0}).success).toBe(false);
 });
 it('accepts only exact current authority; withdrawal omission is not an outage',async()=>{
  const fetch=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({schemaVersion:1,publications:[authority]})))
   .mockResolvedValueOnce(new Response(JSON.stringify({schemaVersion:1,publications:[]})));
  expect(await validateNetworkDelivery(28,[authority],{fetch,sign,env})).toEqual(new Set([authority.publicationId]));
  expect(await validateNetworkDelivery(28,[authority],{fetch,sign,env})).toEqual(new Set());
  expect(fetch.mock.calls[0][1]).toMatchObject({redirect:'error'});
  expect(sign).toHaveBeenCalledWith('activekg',expect.objectContaining({tenantId:'org_28',scopes:'kg:read'}));
 });
 it.each([{publications:[{...authority,consentRevision:2}]},{publications:[authority,authority]},{publications:[{...authority,publicationId:'33333333-3333-4333-8333-333333333333'}]}])('refuses tampered receipts',async ({publications})=>{
  const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({schemaVersion:1,publications})));
  await expect(validateNetworkDelivery(28,[authority],{fetch,sign,env})).rejects.toThrow('identity_conflict');
  expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('stays off without the switch',async()=>{
  const fetch=vi.fn();await expect(validateNetworkDelivery(28,[authority],{fetch,sign,env:{...env,CANDIDATE_NETWORK_SOURCING_ENABLED:'false'}})).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
 });
 it('bounds a stalled signer without starting a late request',async()=>{
  vi.useFakeTimers();const fetch=vi.fn();const stalled=vi.fn(()=>new Promise<string>(()=>{}));
  const pending=validateNetworkDelivery(28,[authority],{fetch,sign:stalled,env});
  const checked=expect(pending).rejects.toThrow('memory_unavailable');
  await vi.advanceTimersByTimeAsync(5001);await checked;expect(fetch).not.toHaveBeenCalled();
 });
 it('reads actual owner publication status with the owner-only token',async()=>{
  const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({schemaVersion:1,publicationActive:true,blockedReason:null})));
  expect(await readNetworkStatus(authority.subjectId,authority.publicationId,{fetch,sign,env})).toEqual({schemaVersion:1,publicationActive:true,blockedReason:null});
  expect(sign).toHaveBeenCalledWith('activekg',expect.objectContaining({tenantId:`candidate_${authority.subjectId}`,scopes:'candidate-profile:owner-read'}));
 });
});

it.skipIf(process.env.P7_SIGNED_PROOF!=='1')('validates the real signed Memory publication and redacts the recruiter card',async()=>{
 const hit=JSON.parse(process.env.P7_HIT!);
 const a=networkPublicationAuthority.parse(Object.fromEntries(Object.keys(authority).map(key=>[key,hit[key]])));
 const allowed=await validateNetworkDelivery(28,[a]);
 const expected=process.env.P7_EXPECT_ACTIVE==='1';
 expect(allowed.has(a.publicationId)).toBe(expected);
 expect(await readNetworkStatus(a.subjectId,process.env.P7_BINDING!)).toMatchObject({schemaVersion:1,publicationActive:expected,blockedReason:expected?null:'consent_required'});
 const origin=parseNetworkOrigin({candidateOrigin:{version:1,kind:'candidate_network',...a}})!;
 const card=flattenCandidateForUI({id:1,jobId:1,signalCandidateId:'native-fixture',fitScore:null,fitBreakdown:null,
  sourceType:'pool',state:'new',lastSyncedAt:null,createdAt:null,
  candidateSummary:{...hit.facts,candidateOrigin:origin.display,networkPublication:a}});
 expect(JSON.stringify(card)).not.toContain(a.subjectId);
 expect(JSON.stringify(card)).not.toContain(a.publicationId);
 expect(JSON.stringify(card)).not.toContain('secret@example.test');
 expect(applicantContactBlocked({candidateSummary:{candidateOrigin:origin.display}})).toBe(true);
});
