import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const hash=value=>createHash('sha256').update(value).digest('hex');
export const frozenSourcingFiles={
  'server/storage.ts':'b361556678de9f1626cf6cbd7657b56eebc8da367dd100673f926ec7564f3908',
  'server/lib/contactResolutionProcessor.ts':'8e0b9fc20c88deb4b9929dd61edd6b93287c90fba900d5b3931af7b32e643264',
  // 5B-A4 permits only the relational privacy alias correction; all other
  // outreach bytes remain protected by this full-file fingerprint.
  'server/coldOutreach.routes.ts':'4e77eb2aaec06e9ee4a1d51812bc89fadb10673d53d0074c1ac7815ed1f105e6',
  'server/schema-migrations/0014_job_brief_authority.sql':'d21873a2c9e12a01cc95798ca3bc2a7a01864ca9f498feb846829cc55f5e49a2',
  'package-lock.json':'b985825f298cda976afa6f46792d4eab13ceaa19560efc48098168f187337539',
  'server/candidate-index/search.ts':'eab5ded0878a5ea9125cc3d732b987c3b05576ffc774410a4f304cb4b6b55146',
};
export const sourcingAuthorityTokens={
  'server/sourcing-authority/candidate-origin.ts':['candidateEligibilityIdentity.parse','readPrivateDecisions','SOURCING_PRIVATE_CHANGED'],
  'server/lib/contactResolutionProcessor.ts':['canResolveSourcedContact','flow_sourcing_contact_allowed'],
  'server/lib/outreachDelivery.ts':['canContactSourcedCandidate','Applicant is not eligible for cold outreach'],
  'server/schema-migrations/0016_rubric_ranking.sql':[
    'SOURCING_RANKING_IMMUTABLE','SOURCING_UPDATED_BRIEF_REQUIRED','SOURCING_RANKING_CONFLICT',
    "COLLATE \"C\"",'FOR NO KEY UPDATE','ranking_contract','ranking_revision','ranking_sha256',
    "p_command->>'revision'<>'1'","IF action NOT IN ('schedule','retry')",'SOURCING_DIGEST_UNAUTHORIZED','SOURCING_DIGEST_RATE_LIMITED',
  ],
  'server/sourcing-authority/ranking-contract.ts':['rubric-range-v1','rubric-taxonomy-v3','rubric-evidence-v1','rubric-local-match-v3',
    "briefPayloadSchema.refine(v=>v.schemaVersion>=2",'rubric-approved-skills-v1','rubric-taxonomy-v4','rubric-local-match-v4',
    'rankingProjection','rankingHash(body)!==contractHash','rankedCandidateSchema'],
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
  if(lock.migrations?.['0016']!==hash(read('server/schema-migrations/0016_rubric_ranking.sql')))
    throw Error('ranking_migration_hash');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const pg=process.argv.includes('--pg'),tests=process.argv.includes('--test'),client=process.argv.includes('--client'),processProof=process.argv.includes('--process');
  if(pg||tests||client||processProof){
    const {startVitest}=await import('vitest/node');
    const v=await startVitest('test',[],{root,config:false,environment:'node',watch:false,
      include:[processProof?'test/integration/governed-sourcing-process.test.ts':client?'client/src/lib/sourcing-authority.test.ts':pg?'server/sourcing-authority/__tests__/*.pg.test.ts':'server/sourcing-authority/__tests__/*.test.ts',...(!processProof&&!client&&!pg?['test/integration/rc-skills-progress.test.ts']:[])],
      exclude:pg?[]:['**/*.pg.test.ts'],fileParallelism:false,maxWorkers:1,minWorkers:1,testTimeout:30000,hookTimeout:120000});
    if(!v)process.exitCode=1;else await v.close();
  }else{checkSourcingAuthority();console.log('sourcing-authority-guard: OK');}
}
