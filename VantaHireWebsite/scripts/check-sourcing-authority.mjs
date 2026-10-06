import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const hash=value=>createHash('sha256').update(value).digest('hex');
export const frozenSourcingFiles={
  'server/storage.ts':'0aed7b614c05ce5e5e6e387bab39118c0ea4a89c1fe0d768fcce8c32adc81c81',
  'server/lib/contactResolutionProcessor.ts':'3386ad52f9acac6be1abc8a81b6232d2aaed9b1ec663090a1b3e45016353c49b',
  // 5B-A4 permits only the relational privacy alias correction; all other
  // outreach bytes remain protected by this full-file fingerprint.
  'server/coldOutreach.routes.ts':'f9c4bc1295cbfd077ae24e80b8c24428c2e6d9d0f87a31c7560d54875de4fa8a',
  'server/schema-migrations/0014_job_brief_authority.sql':'d21873a2c9e12a01cc95798ca3bc2a7a01864ca9f498feb846829cc55f5e49a2',
  'package-lock.json':'b985825f298cda976afa6f46792d4eab13ceaa19560efc48098168f187337539',
  'server/candidate-index/search.ts':'eab5ded0878a5ea9125cc3d732b987c3b05576ffc774410a4f304cb4b6b55146',
};
export const sourcingAuthorityTokens={
  'server/schema-migrations/0015_governed_sourcing.sql':[
    'CREATE UNIQUE INDEX src_adm_job_uq ON public.sourcing_admissions(organization_id,job_id)',"WHERE state<>'cancelled_no_dispatch'",'src_acct_terminal_uq',
    'src_win_balance_ck CHECK (reserved>=0 AND captured>=0 AND reserved+captured<=limit_count)',
    'SOURCING_PAYER_CHANGED','SOURCING_REVISION_CONFLICT','SOURCING_CONVERTED',
    'FOR UPDATE NOWAIT','FORCE ROW LEVEL SECURITY','sourcing_members_changed',
    'sourcing_subscription_changed','flow_sourcing_immutable','FROM PUBLIC',
    'src_item_cand_fk','src_dec_cand_fk','src_dec_clear_ck',
  ],
  'server/sourcing-authority/commands.ts':['quoteDomain','sealQuote','openQuote','requireCandidatePrivacyAllowed','validateProviderGrant'],
  'server/sourcing-authority/routes.ts':['requireAuth,csrf','verifySignalSourcingJwt','SOURCING_BODY_TOO_LARGE'],
  'server/sourcing-authority/digest.ts':['maxRetries: 0','timeout: 30_000','AbortSignal.timeout(35_000)'],
  'server/sourcing-authority/worker.ts':['if(!sourcingEnabled())return','dispatchClaim','previewClaim','SOURCING_BIND_UNCERTAIN'],
  'server/schema-control/runtimeRole.ts':['SOURCING_TABLES','SOURCING_FUNCTIONS','SOURCING_PRIVATE_FUNCTIONS','sourcingPrivilegesReady'],
  'server/schema-control/readiness.ts':['sourcingPrivilegesReady'],
  'server/lib/services/sourcing-sync.ts':['sourcingDeliverySchema.parse','flow_sourcing_deliver','SOURCING_DELIVERY_BINDING_MISMATCH'],
  'server/webhooks/signal.webhook.ts':['callbackBindingMatches','Sourcing binding mismatch'],
  'server/job-brief/routes.ts':["app.post('/api/jobs/:id/brief/approve',available,requireAuth,csrf",'sourcingEnabled()?approveSourcingBrief'],
  'server/signal.routes.ts':['if(sourcingEnabled() || authority.latched)',"if(!sourcingEnabled() || !authority.enabled)throw new SourcingError('SOURCING_DISABLED',503)",
    'const admitted=await admitSourcing','if(!scopedCandidate)throw','const decision=await decideSourcing'],
};
export function checkSourcingAuthority(read=path=>readFileSync(resolve(root,path),'utf8')){
  for(const [path,pin] of Object.entries(frozenSourcingFiles))if(hash(read(path))!==pin)throw Error('sourcing_frozen:'+path);
  for(const [path,tokens] of Object.entries(sourcingAuthorityTokens)){
    const source=read(path);for(const token of tokens)if(!source.includes(token))throw Error('sourcing_authority:'+path+':'+token);
  }
  const sql=read('server/schema-migrations/0015_governed_sourcing.sql');
  if((sql.match(/CREATE TABLE public\.sourcing_/g)||[]).length!==15)throw Error('sourcing_table_inventory');
  if((sql.match(/CREATE FUNCTION public\.flow_sourcing_/g)||[]).length!==25)throw Error('sourcing_routine_inventory');
  const lock=JSON.parse(read('server/schema-migrations/checksums.lock'));
  if(!JSON.stringify(lock).includes(hash(sql)))throw Error('sourcing_migration_hash');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const pg=process.argv.includes('--pg'),tests=process.argv.includes('--test'),client=process.argv.includes('--client'),processProof=process.argv.includes('--process');
  if(pg||tests||client||processProof){
    const {startVitest}=await import('vitest/node');
    const v=await startVitest('test',[],{root,config:false,environment:'node',watch:false,
      include:[processProof?'test/integration/governed-sourcing-process.test.ts':client?'client/src/lib/sourcing-authority.test.ts':pg?'server/sourcing-authority/__tests__/*.pg.test.ts':'server/sourcing-authority/__tests__/*.test.ts'],
      exclude:pg?[]:['**/*.pg.test.ts'],fileParallelism:false,maxWorkers:1,minWorkers:1,testTimeout:30000,hookTimeout:120000});
    if(!v)process.exitCode=1;else await v.close();
  }else{checkSourcingAuthority();console.log('sourcing-authority-guard: OK');}
}
