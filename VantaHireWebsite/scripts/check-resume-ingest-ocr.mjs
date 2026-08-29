#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkCandidatePrivacySurfaces } from './check-candidate-privacy-surfaces.mjs';
import { checkObjectAuthorization } from './check-object-authorization.mjs';

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(APP_ROOT, '..');
const SOURCE_SHA = '9301960a495d156689e07b43034a5512c05a3cc3';
const FROZEN_ON_DEMAND_BLOCKS = {
  application: '9c4f0e84b340e8573409978a1bfde1ff69a4b96422a7eab26aaf777678f8b193',
  aiSingle: 'f94a0a41154e8d6b87260452b0a92b7aeddb2e34fe132f73559372947106c02e',
  aiBulk: '1176d16f8977cb925edc8db8aab442af742971379a3bb7582cc9a1760b5f99a9',
};

const AUTHORED_FILES = new Set([
  '.github/workflows/ci.yml',
  'server/lib/googleVisionIngestOcrClient.ts',
  'server/lib/resumeIngestExtraction.ts',
  'server/applications.routes.ts',
  'server/ai.routes.ts',
  'scripts/check-resume-ingest-ocr.mjs',
  'server/lib/__tests__/googleVisionIngestOcrClient.test.ts',
  'server/lib/__tests__/resumeIngestExtraction.test.ts',
  'server/lib/__tests__/resumeIngestOcrGuard.test.ts',
  'server/candidate-privacy/surfaces.json',
  'server/object-authorization/surfaces.json',
]);

const FROZEN = {
  'server/lib/googleVisionOcrClient.ts': '4d39f6911ce8cfb0dfb392e5c9615d46602ee9d248b5ed73c91d1ce04df4506a',
  'server/lib/resumeImportExtraction.ts': 'b62bc1d0971eba48c5c3ff1a85a5b7c626525c6a391b430d5b29ef8d03a474ab',
  'server/lib/resumeExtractor.ts': '217ed1dd5b7c23fa6945d5602c55286cc5655ff8ba481f3b5dbf106fea44c0f2',
  'server/aiWorker.ts': '844c10cd2302675d66d2b7fefac777fdf17d9f5593992732f36d1e4dc3eb5c1e',
  'server/resume.routes.ts': '8a85106836a3bb681e66e1a25bf0dcedeb8181e00b4bbb669c1b8e85c446d26e',
  'server/bulkResumeImport.routes.ts': '7b0a7c07c42360c8d86ad950607335b7a2714318b7f685d7b502411d52abfa6e',
  'server/lib/resumeImportProcessor.ts': '1314be8df83e520c46c1eab5831d468f42659f3a4783a124e38c224381ad92e2',
  'scripts/check-candidate-privacy-surfaces.mjs': 'f19ccb484a63b20ba8867001733cffb43ea0520106ea18429cf938607749d784',
  'scripts/check-object-authorization.mjs': '9b47acacd8a31fa890a13c2f5baeee9d556d6183c75520f3f22f90edda4db663',
  'server/gcs-storage.ts': '5354cc3391894ae91fd2f6c5dca656a1aaf6a6eae175deee76782cf690360802',
  'shared/schema.ts': '33aff02818a423ae392b03c135414904cbe93e92b63e5b98f1869705a38cc066',
  'package.json': '7a1a5a01e4d408f0512708444f6de976dce24ccaa2a1370ddfe9eb34add49dbe',
  'package-lock.json': 'b985825f298cda976afa6f46792d4eab13ceaa19560efc48098168f187337539',
  'vitest.server.config.ts': 'aa3987856637cb68b917feee6f8e2bbed626fe3f9426032bd16254f91d5536fe',
  'server/schema-control/manifest.ts': '16e6b04b6a67467eb0319fe3c9a09fccbed9be55c65a0c866723467ea613bda2',
  'server/schema-migrations/0000_baseline.sql': '3fd883d6fb45d0c52acc69bff16949185948bb51e5d732f57247f542814aa129',
  'server/schema-migrations/0001_candidate_privacy_flow.sql': 'a050e6b3e72a61b1d73c9124ddcd10eb6309f804891412dec9e15288df8c77c8',
  'server/schema-migrations/0002_resume_access_attempts.sql': 'a8a838cff654c8da79820d45aac8fbfc0fec8a8411553dde9f3a1f05ba6d713c',
  'server/schema-migrations/checksums.lock': '5aeb99953c4daf959daa21eccde3785354a18708c74742278ef7e6408c058d04',
};

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function gitOutput(args) {
  try {
    return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
  } catch (error) {
    // Some hardened runners report EPERM after a successful nested git process.
    // Accept only the process' explicit zero status and captured stdout.
    if (error?.status === 0 && typeof error?.output?.[1] === 'string') return error.output[1];
    throw error;
  }
}

function count(source, needle) {
  return source.split(needle).length - 1;
}

function requireAnchor(problems, source, anchor, code) {
  if (!source.includes(anchor)) problems.push(code);
}

function sliceBetween(source, start, end) {
  const startAt = source.indexOf(start);
  const endAt = startAt < 0 ? -1 : source.indexOf(end, startAt + start.length);
  return startAt >= 0 && endAt > startAt ? source.slice(startAt, endAt) : '';
}

function matchingSlices(source, start, end) {
  const result = [];
  let offset = 0;
  while (offset < source.length) {
    const startAt = source.indexOf(start, offset);
    if (startAt < 0) break;
    const endAt = source.indexOf(end, startAt + start.length);
    if (endAt < 0) break;
    result.push(source.slice(startAt, endAt));
    offset = endAt + end.length;
  }
  return result;
}

export function collectAuthoredFiles(committedDiff, worktreeStatus) {
  const committed = committedDiff.split('\n').filter((line) => line.length > 0);
  const uncommitted = worktreeStatus.split('\n').filter((line) => line.length > 0)
    .map((line) => line.slice(3));
  return [...new Set([...committed, ...uncommitted])]
    .filter((file) => file !== 'VantaHireWebsite/node_modules')
    .map((file) => file.replace(/^VantaHireWebsite\//u, ''))
    .sort();
}

export function validateResumeIngestOcrSources(files) {
  const problems = [];
  for (const [file, expected] of Object.entries(FROZEN)) {
    if (files[file] !== undefined && sha256(files[file]) !== expected) {
      problems.push(`frozen file drifted: ${file}`);
    }
  }
  const client = files['server/lib/googleVisionIngestOcrClient.ts'] ?? '';
  const helper = files['server/lib/resumeIngestExtraction.ts'] ?? '';
  const applications = files['server/applications.routes.ts'] ?? '';
  const ai = files['server/ai.routes.ts'] ?? '';
  const ci = files['../.github/workflows/ci.yml'] ?? '';

  requireAnchor(
    problems,
    ci,
    'uses: actions/checkout@v4\n        with:\n          fetch-depth: 0',
    'CI checkout must fetch full history for the pinned-base guard.',
  );

  for (const anchor of [
    'INGEST_OCR_TOTAL_TIMEOUT_MS = 20_000',
    'INGEST_OCR_CALL_TIMEOUT_MS = 10_000',
    'INGEST_OCR_MAX_INPUT_BYTES = 5 * 1024 * 1024',
    'INGEST_OCR_MAX_RESPONSE_BYTES = 25 * 1024 * 1024',
    'INGEST_OCR_MAX_PAGES = 10',
    'INGEST_OCR_MAX_PAGES_PER_REQUEST = 5',
    "const VISION_ENDPOINT = 'https://vision.googleapis.com/v1/files:annotate'",
    "features: [{ type: 'DOCUMENT_TEXT_DETECTION' }]",
    "content: buffer.toString('base64')",
    "mimeType: 'application/pdf'",
    "redirect: 'error'",
    'signal: controller.signal',
    "response.headers.get('content-length')",
    'response.body.getReader()',
    'total > INGEST_OCR_MAX_RESPONSE_BYTES',
    'for (const pages of pageBatches(pageCount))',
  ]) requireAnchor(problems, client, anchor, `client anchor missing: ${anchor}`);

  for (const forbidden of [
    'files:asyncBatchAnnotate', 'gcsSource', 'gcsDestination', 'operationName', 'pollOperation',
    'getFiles(', 'deleteFiles(', '.upload(', '.delete(', '.copy(', 'getSignedUrl', 'response.text()',
    'response.arrayBuffer()', 'console.log(', 'console.warn(', 'console.error(',
  ]) {
    if (client.includes(forbidden)) problems.push(`ordinary-ingest client contains forbidden token: ${forbidden}`);
  }
  const networkSurface = client.replace(
    'https://www.googleapis.com/auth/cloud-platform',
    'GOOGLE_CLOUD_OAUTH_SCOPE',
  );
  if (/https?:\/\/(?!vision\.googleapis\.com)/u.test(networkSurface)) {
    problems.push('ordinary-ingest client adds a non-Vision origin.');
  }

  for (const anchor of [
    'export async function extractResumeForOrdinaryIngest',
    "value.replace(/\\u0000/gu, '')",
    'if (native.success && validateResumeText(nativeText))',
    'if (!isPdf(buffer))',
    'await options.beforeOcr()',
    'ocr = await dependencies.extractOcr(buffer)',
    'if (!validateResumeText(sanitized))',
    'text: stripPII(sanitized)',
    "reasonCode: 'NO_EXTRACTABLE_TEXT'",
  ]) requireAnchor(problems, helper, anchor, `shared-helper anchor missing: ${anchor}`);
  const nativeAt = helper.indexOf('await dependencies.extractNative(buffer)');
  const nativeValidAt = helper.indexOf('if (native.success && validateResumeText(nativeText))');
  const privacyAt = helper.indexOf('await options.beforeOcr()');
  const ocrAt = helper.indexOf('ocr = await dependencies.extractOcr(buffer)');
  if (nativeAt < 0 || nativeValidAt < nativeAt || privacyAt < nativeValidAt || ocrAt < privacyAt) {
    problems.push('native/privacy/OCR ordering drifted.');
  }
  if (/console\.(?:log|warn|error)|filename|gcsPath|locator|candidate/u.test(helper)) {
    problems.push('shared helper gained a raw identity/path/log surface.');
  }

  if (count(applications, 'await extractResumeForOrdinaryIngest(') !== 2) {
    problems.push('applications routes must contain exactly two ordinary-ingest helper calls.');
  }
  if (count(ai, 'await extractResumeForOrdinaryIngest(') !== 1) {
    problems.push('AI routes must contain exactly one ordinary-ingest helper call.');
  }
  const publicRoute = sliceBetween(
    applications,
    'app.post("/api/jobs/:id/apply"',
    '// Recruiter adds candidate on behalf',
  );
  const recruiterRoute = sliceBetween(
    applications,
    '// Recruiter adds candidate on behalf',
    '// ====== ATS: Bulk interview scheduling ======',
  );
  const candidateRoute = sliceBetween(ai, '* POST /api/ai/resume', '* GET /api/ai/resume');
  for (const [label, route] of [['public', publicRoute], ['recruiter', recruiterRoute]]) {
    requireAnchor(problems, route, 'beforeOcr: () => requireApplicationIngestAllowed', `${label} route lost pre-Vision privacy recheck.`);
    const extractionAt = route.indexOf('await extractResumeForOrdinaryIngest(');
    const persistenceAt = route.indexOf(label === 'public'
      ? 'const application = await db.transaction'
      : 'const application = await storage.createApplication');
    const postFenceAt = route.lastIndexOf('await requireApplicationIngestAllowed', persistenceAt);
    if (extractionAt < 0 || persistenceAt < 0 || postFenceAt < extractionAt || postFenceAt > persistenceAt) {
      problems.push(`${label} route lost the post-OCR/pre-persistence privacy fence.`);
    }
  }
  for (const anchor of [
    'beforeOcr: () => requireCandidatePrivacyAllowed',
    "code: 'RESUME_EXTRACTION_UNAVAILABLE'",
    'const gcsPath = await uploadToGCS',
    'extractedText: extractionResult.text',
  ]) requireAnchor(problems, candidateRoute, anchor, `candidate route anchor missing: ${anchor}`);
  const candidateExtractionAt = candidateRoute.indexOf('await extractResumeForOrdinaryIngest(');
  const candidateUploadAt = candidateRoute.indexOf('const gcsPath = await uploadToGCS');
  const candidateInsertAt = candidateRoute.indexOf('.insert(candidateResumes)');
  if (candidateExtractionAt < 0 || candidateUploadAt < candidateExtractionAt || candidateInsertAt < candidateUploadAt) {
    problems.push('candidate extraction/upload/insert ordering drifted.');
  }

  const currentApplicationOnDemand = sliceBetween(
    applications,
    "if (!resumeText && application.resumeUrl && application.resumeUrl.startsWith('gs://'))",
    '// Prefer resume text, fall back to cover letter only',
  );
  if (!currentApplicationOnDemand
      || sha256(currentApplicationOnDemand) !== FROZEN_ON_DEMAND_BLOCKS.application) {
    problems.push('application on-demand GCS/native fallback changed.');
  }
  const currentAiFallbacks = [
    ...matchingSlices(ai, 'if (!resumeText && application.resumeUrl)', '// Reserve only after'),
    ...matchingSlices(ai, 'if (!resumeText && app.resumeUrl)', '// Get or generate JD digest'),
  ];
  if (currentAiFallbacks.length !== 2
      || sha256(currentAiFallbacks[0] ?? '') !== FROZEN_ON_DEMAND_BLOCKS.aiSingle
      || sha256(currentAiFallbacks[1] ?? '') !== FROZEN_ON_DEMAND_BLOCKS.aiBulk) {
    problems.push('AI on-demand GCS/native fallbacks changed.');
  }
  return [...new Set(problems)].sort();
}

function walk(path, output = []) {
  if (!existsSync(path)) return output;
  for (const entry of readdirSync(path)) {
    if (['node_modules', 'dist', 'coverage'].includes(entry)) continue;
    const absolute = join(path, entry);
    const metadata = statSync(absolute);
    if (metadata.isDirectory()) walk(absolute, output);
    else output.push(absolute);
  }
  return output;
}

export function checkResumeIngestOcr(root = APP_ROOT) {
  const problems = [];
  try {
    gitOutput(['merge-base', '--is-ancestor', SOURCE_SHA, 'HEAD']);
  } catch (error) {
    if (error?.status === 1) problems.push('source head/tree pin drifted.');
    else problems.push('source head/tree pin could not be verified.');
  }
  try {
    const pinnedTree = gitOutput(['rev-parse', `${SOURCE_SHA}^{tree}`]).trim();
    if (pinnedTree !== 'b1674cdd942bdf13f6c486b1a42714a879016fd3') {
      problems.push('source head/tree pin drifted.');
    }
  } catch {
    problems.push('source head/tree pin could not be verified.');
  }
  for (const [file, expected] of Object.entries(FROZEN)) {
    const absolute = resolve(root, file);
    if (!existsSync(absolute) || sha256(readFileSync(absolute)) !== expected) {
      problems.push(`frozen file drifted: ${file}`);
    }
  }
  const files = Object.fromEntries([
    'server/lib/googleVisionIngestOcrClient.ts',
    'server/lib/resumeIngestExtraction.ts',
    'server/applications.routes.ts',
    'server/ai.routes.ts',
    '../.github/workflows/ci.yml',
  ].map((file) => [file, existsSync(join(root, file)) ? readFileSync(join(root, file), 'utf8') : '']));
  problems.push(...validateResumeIngestOcrSources(files));

  const productionCallers = [];
  for (const absolute of walk(join(root, 'server'))) {
    if (!absolute.endsWith('.ts') || absolute.includes('/__tests__/') || absolute.includes('/tests/')) continue;
    const file = relative(root, absolute).replaceAll('\\', '/');
    const source = readFileSync(absolute, 'utf8');
    if (source.includes('extractResumeForOrdinaryIngest')) productionCallers.push(file);
    if (source.includes('googleVisionIngestOcrClient') && file !== 'server/lib/resumeIngestExtraction.ts') {
      problems.push(`ordinary Vision client has an undeclared importer: ${file}`);
    }
  }
  if (JSON.stringify(productionCallers.sort()) !== JSON.stringify([
    'server/ai.routes.ts',
    'server/applications.routes.ts',
    'server/lib/resumeIngestExtraction.ts',
  ])) problems.push('ordinary-ingest helper caller census drifted.');

  problems.push(...checkCandidatePrivacySurfaces(root));
  problems.push(...checkObjectAuthorization(root));
  try {
    const committed = gitOutput(['diff', '--name-only', SOURCE_SHA, 'HEAD', '--']);
    const status = gitOutput(['status', '--porcelain=v1', '-uall']);
    const normalized = collectAuthoredFiles(committed, status);
    if (JSON.stringify(normalized) !== JSON.stringify([...AUTHORED_FILES].sort())) {
      problems.push(`eleven-file boundary drifted: ${normalized.join(',')}`);
    }
  } catch {
    problems.push('eleven-file boundary could not be verified.');
  }
  return [...new Set(problems)].sort();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = checkResumeIngestOcr();
  if (problems.length) {
    console.error('[resume-ingest OCR guard] FAILED:');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
  } else {
    console.log('[resume-ingest OCR guard] OK');
  }
}
