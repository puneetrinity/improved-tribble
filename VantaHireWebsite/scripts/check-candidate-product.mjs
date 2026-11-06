#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function checkCandidateProduct(root = fileURLToPath(new URL('..', import.meta.url))) {
  const errors = [];
  const source = file => readFileSync(resolve(root, file), 'utf8');
  const required = {
    'server/candidate-product/routes.ts': ['foundationEnabled()', 'requireVerifiedCandidate', 'parseStrictJson', 'csrf', 'requireCandidatePrivacyAllowed'],
    'server/candidate-product/processor.ts': ['deps.privacy(lease.userId)', 'flow_candidate_foundation_finish_delivery', 'lease.leaseToken', 'lease.leaseGeneration', 'if (!enabled()) return false', 'if(expired || remaining<=0 || !enabled())'],
    'server/candidate-product/memory-client.ts': ["redirect: 'error'", 'lifetimeSeconds: 60', 'receipt.bindingId !== command.value.bindingId', 'receipt.wireSha256 !== expectedHash', 'size > 4096'],
    'server/candidate-product/guest-intent.ts': ['foundationIntentCaptureEnabled()', 'executor.transaction', "return 'not_recorded'"],
    'server/index.ts': ["pathname === '/api/candidate/product'", "pathname?.startsWith('/api/candidate/product/')",
      'stopFoundationProcessor = startFoundationProcessor({db:pool, privacy:userId => requireCandidatePrivacyAllowed(',
      "{type:'candidate_user',id:userId},{globalUse:true,newGlobalOperation:true})",
      'const foundationStopped = stopFoundationProcessor?.();',
      'Promise.allSettled([Promise.resolve(indexStopped), foundationStopped, profileStopped, consentV2Stopped])',
      'if(consentV2DeliveryEnabled())', 'stopConsentV2Processor=startConsentV2Worker(',
      'const consentV2Stopped = stopConsentV2Processor?.();',
      'deliver:(raw,hash)=>sendConsentV2(raw,hash,{origin,sign:signServiceJwt})',
      "try{await requireCandidatePrivacyAllowed({type:'candidate_user',id:userId},{globalUse:true,newGlobalOperation:true});return 'allowed';}",
      "results.some(result => result.status === 'rejected') ? 1 : 0"],
  };
  for (const [file, anchors] of Object.entries(required)) {
    const text = source(file);
    for (const anchor of anchors) if (!text.includes(anchor)) errors.push(`${file}: missing ${anchor}`);
  }
  const migration = source('server/schema-migrations/0025_candidate_product_foundation.sql');
  if(source('server/worker.ts').includes('startFoundationProcessor')) errors.push('foundation must run in the deployed web entrypoint only');
  const entry=source('server/index.ts');
  if(entry.indexOf('startCandidatePrivacyProcessor();')>entry.indexOf('stopFoundationProcessor = startFoundationProcessor('))
    errors.push('foundation must start after privacy projection');
  const lock = JSON.parse(source('server/schema-migrations/checksums.lock'));
  if (createHash('sha256').update(migration).digest('hex') !== lock.migrations['0025']) errors.push('0025 checksum mismatch');
  const config = source('server/candidate-product/config.ts');
  for(const anchor of ['stopProfileProcessor=startProfileProcessor(', 'stopProfileExpiryProcessor=startProfileExpiryProcessor({enabled:sparkEnabled,',
    'const profileStopped = Promise.all([stopProfileProcessor?.(),stopProfileExpiryProcessor?.(),stopResumeSourceProcessor?.(),stopLookupProcessor?.(),stopBudgetAlerts?.()]);',
    'stopBudgetAlerts=startBudgetAlerts(pool,sparkEnabled);',
    'if(lookupSourceEnabled()){','stopLookupProcessor=startLookupQueue','runLookupAttempt(work.attemptId',
    'runLookupDelivery(work.attemptId','lookupProfessionalProfile(operation,{apiKey})',
    'if(resumeSourceEnabled()){','const modelName=getGroqModel();','workerId:randomUUID()',
    'resumeSourceEnabled()?sources.claim(workerId):Promise.resolve(null)',
    'stopResumeSourceProcessor=()=>worker.stop();'])
    if(!entry.includes(anchor))errors.push(`S2 entrypoint missing ${anchor}`);
  for(const anchor of ['profiles.authority','profiles.finish','profiles.claim','profiles.redactDue','profiles.claimExpiry','profiles.prepareExpiry','profiles.settleExpiry','recover:recoverProfileExpiry'])
    if(!entry.includes(anchor))errors.push(`S2 worker dependency missing ${anchor}`);
  if(!source('server/candidate-product/profile-processor.ts').includes('if(deps.enabled())tick();'))errors.push('S2 must not poll while disabled');
  if(entry.indexOf('startCandidatePrivacyProcessor();')>entry.indexOf('if(resumeSourceEnabled()){'))errors.push('resume source worker must start after privacy');
  if(entry.indexOf('startCandidatePrivacyProcessor();')>entry.indexOf('if(lookupSourceEnabled()){'))errors.push('lookup worker must start after privacy');
  if(!config.includes("process.env.CANDIDATE_RESUME_SOURCE_ENABLED === 'true'"))errors.push('resume source default-off gate missing');
  if(!source('server/routes.ts').includes('registerCandidateResumeRoutes(app, doubleCsrfProtection);'))errors.push('resume route factory not mounted');
  if (!config.includes("=== 'true'") || !config.includes("NODE_ENV")) errors.push('dark/synthetic capture gates missing');
  return errors;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = checkCandidateProduct();
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  else console.log('candidate-product guard: OK');
}
