import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

// End to end inside Flow: Discover card → real sync summary → stored jsonb → browser response.
const executed=vi.hoisted(()=>[] as unknown[]);
vi.mock('../../db',async()=>{
  const {PgDialect}=await import('drizzle-orm/pg-core');
  const tx={execute:async (query:unknown)=>{executed.push(query);
    const text=new PgDialect().sqlToQuery(query as never).sql;
    return {rows:text.includes('flow_sourcing_deliver')?[{result:true}]:[{}]};}};
  return {db:{transaction:async (fn:(t:typeof tx)=>unknown)=>fn(tx),execute:tx.execute}};
});
vi.mock('../../candidate-privacy/config',()=>({loadCandidatePrivacyConfig:()=>({memoryTimeoutMs:1000})}));
vi.mock('../../candidate-privacy/memory-client',()=>({checkMemoryEligibilityBatch:async ({subjects}:{subjects:{requestRef:string}[]})=>
  new Map(subjects.map(s=>[s.requestRef,'allow']))}));
vi.mock('../../sourcing-authority/candidate-origin',async importOriginal=>({
  ...await importOriginal<typeof import('../../sourcing-authority/candidate-origin')>(),verifyPrivateDelivery:async()=>undefined}));

import { upsertSignalCandidates } from '../services/sourcing-sync';
import { flattenCandidateForUI, type SignalResultCandidateV3 } from '../services/signal-contracts';

const uuid=(n:number)=>`00000000-0000-4000-8000-00000000000${n}`;
const identity={candidateId:uuid(1),referenceId:uuid(2),applicationId:41,applicationJobId:7,resumeVersionId:uuid(3),
  sourceId:uuid(4),generationId:uuid(5),sourceHash:'a'.repeat(64)};
const card=(id:string,candidate:Record<string,unknown>)=>({candidate:{id,name:null,linkedinUrl:null,headline:null,location:null,company:null,...candidate},
  sourcingContext:{rank:1},sourceType:'pool',fitScore:null} as unknown as SignalResultCandidateV3);
const governed={protocolVersion:1,flowRunId:uuid(6),artifactHash:'b'.repeat(64),executionAttemptId:uuid(7),revision:1,orderedSignalIds:['app-1','pub-2']} as never;

async function syncAndRead(candidates:SignalResultCandidateV3[]) {
  executed.length=0;
  await upsertSignalCandidates(5,7,'req-1',candidates,undefined,{acquisitionGeneration:1,executionAttemptId:uuid(7)} as never,governed);
  const dialect=new PgDialect();
  const insert=executed.map(q=>dialect.sqlToQuery(q as never)).find(q=>q.sql.includes('INSERT INTO job_sourced_candidates'))!;
  const summaries=insert.params.filter((p):p is string=>typeof p==='string'&&p.includes('"cardSignals"')||typeof p==='string'&&p.includes('"sourcingContext"'))
    .map(p=>JSON.parse(p) as Record<string,unknown>);
  return summaries.map(summary=>flattenCandidateForUI({id:1,jobId:7,signalCandidateId:String((summary.candidate as {id:string}).id),fitScore:null,
    fitBreakdown:null,sourceType:'pool',state:'new',lastSyncedAt:null,createdAt:null,candidateSummary:JSON.parse(JSON.stringify(summary))}));
}
const applicant=(resumeLocation:unknown)=>card('app-1',{candidateOrigin:{version:1,kind:'organization_candidate',...identity},resumeLocation});

describe('résumé location survives sync and storage', () => {
  it('a valid Discover location reaches the browser for a previous applicant', async () => {
    const [ui]=await syncAndRead([applicant({version:1,provenance:'resume',city:'Bengaluru',country:'India'})]);
    expect(ui.resumeLocation).toEqual({city:'Bengaluru',country:'India'});
  });
  it('country only survives, and a missing or malformed location stays unknown', async () => {
    expect((await syncAndRead([applicant({version:1,provenance:'resume',city:null,country:'India'})]))[0].resumeLocation)
      .toEqual({city:null,country:'India'});
    expect((await syncAndRead([applicant(undefined)]))[0].resumeLocation).toBeNull();
    expect((await syncAndRead([applicant({version:1,provenance:'job',city:'Bengaluru',country:'India'})]))[0].resumeLocation).toBeNull();
  });
  it('a public card never stores or returns a résumé location', async () => {
    const [ui]=await syncAndRead([card('pub-2',{resumeLocation:{version:1,provenance:'resume',city:'Bengaluru',country:'India'}})]);
    expect(ui).not.toHaveProperty('resumeLocation');expect(JSON.stringify(ui)).not.toContain('Bengaluru');
  });
});
