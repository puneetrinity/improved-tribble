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
      'Promise.allSettled([Promise.resolve(indexStopped), foundationStopped])',
      "results.some(result => result.status === 'rejected') ? 1 : 0"],
  };
  for (const [file, anchors] of Object.entries(required)) {
    const text = source(file);
    for (const anchor of anchors) if (!text.includes(anchor)) errors.push(`${file}: missing ${anchor}`);
  }
  const migration = source('server/schema-migrations/0024_candidate_product_foundation.sql');
  if(source('server/worker.ts').includes('startFoundationProcessor')) errors.push('foundation must run in the deployed web entrypoint only');
  const entry=source('server/index.ts');
  if(entry.indexOf('startCandidatePrivacyProcessor();')>entry.indexOf('stopFoundationProcessor = startFoundationProcessor('))
    errors.push('foundation must start after privacy projection');
  const lock = JSON.parse(source('server/schema-migrations/checksums.lock'));
  if (createHash('sha256').update(migration).digest('hex') !== lock.migrations['0024']) errors.push('0024 checksum mismatch');
  const config = source('server/candidate-product/config.ts');
  if (!config.includes("=== 'true'") || !config.includes("NODE_ENV")) errors.push('dark/synthetic capture gates missing');
  return errors;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = checkCandidateProduct();
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  else console.log('candidate-product guard: OK');
}
