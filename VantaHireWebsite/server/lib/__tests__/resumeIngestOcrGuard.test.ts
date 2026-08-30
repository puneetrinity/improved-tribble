import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checkResumeIngestOcr,
  collectAuthoredFiles,
  composeSharedGuardProblems,
  validatePinnedOcrHistory,
  validateResumeIngestOcrSources,
} from '../../../scripts/check-resume-ingest-ocr.mjs';

const root = resolve('.');
const read = (file: string) => readFileSync(resolve(root, file), 'utf8');

const files: Record<string, string> = {
  'server/lib/googleVisionIngestOcrClient.ts': read('server/lib/googleVisionIngestOcrClient.ts'),
  'server/lib/resumeIngestExtraction.ts': read('server/lib/resumeIngestExtraction.ts'),
  'server/applications.routes.ts': read('server/applications.routes.ts'),
  'server/ai.routes.ts': read('server/ai.routes.ts'),
  'server/lib/googleVisionOcrClient.ts': read('server/lib/googleVisionOcrClient.ts'),
  'server/lib/resumeImportExtraction.ts': read('server/lib/resumeImportExtraction.ts'),
  'server/bulkResumeImport.routes.ts': read('server/bulkResumeImport.routes.ts'),
  'server/lib/resumeImportProcessor.ts': read('server/lib/resumeImportProcessor.ts'),
  '../.github/workflows/ci.yml': read('../.github/workflows/ci.yml'),
};
const mutations: Array<[string, string, string, string]> = [
  ['async Vision', 'server/lib/googleVisionIngestOcrClient.ts', 'files:annotate', 'files:asyncBatchAnnotate'],
  ['GCS source', 'server/lib/googleVisionIngestOcrClient.ts', "content: buffer.toString('base64')", "gcsSource: { uri: 'gs://unsafe' }"],
  ['total timeout', 'server/lib/googleVisionIngestOcrClient.ts', 'INGEST_OCR_TOTAL_TIMEOUT_MS = 20_000', 'INGEST_OCR_TOTAL_TIMEOUT_MS = 120_000'],
  ['call timeout', 'server/lib/googleVisionIngestOcrClient.ts', 'INGEST_OCR_CALL_TIMEOUT_MS = 10_000', 'INGEST_OCR_CALL_TIMEOUT_MS = 60_000'],
  ['page ceiling', 'server/lib/googleVisionIngestOcrClient.ts', 'INGEST_OCR_MAX_PAGES = 10', 'INGEST_OCR_MAX_PAGES = 20'],
  ['request page ceiling', 'server/lib/googleVisionIngestOcrClient.ts', 'INGEST_OCR_MAX_PAGES_PER_REQUEST = 5', 'INGEST_OCR_MAX_PAGES_PER_REQUEST = 10'],
  ['response ceiling', 'server/lib/googleVisionIngestOcrClient.ts', 'INGEST_OCR_MAX_RESPONSE_BYTES = 25 * 1024 * 1024', 'INGEST_OCR_MAX_RESPONSE_BYTES = 250 * 1024 * 1024'],
  ['abort signal', 'server/lib/googleVisionIngestOcrClient.ts', 'signal: controller.signal', 'signal: undefined'],
  ['redirect refusal', 'server/lib/googleVisionIngestOcrClient.ts', "redirect: 'error'", "redirect: 'follow'"],
  ['unbounded body', 'server/lib/googleVisionIngestOcrClient.ts', 'response.body.getReader()', 'response.arrayBuffer()'],
  ['raw provider log', 'server/lib/googleVisionIngestOcrClient.ts', 'let providerCalls = 0;', "console.error('provider body'); let providerCalls = 0;"],
  ['native validation', 'server/lib/resumeIngestExtraction.ts', 'if (native.success && validateResumeText(nativeText))', 'if (false)'],
  ['native-before-OCR', 'server/lib/resumeIngestExtraction.ts', 'const native = await dependencies.extractNative(buffer);', 'const native = { success: false, text: "" };'],
  ['PDF-only OCR', 'server/lib/resumeIngestExtraction.ts', 'if (!isPdf(buffer))', 'if (false)'],
  ['NUL sanitizer', 'server/lib/resumeIngestExtraction.ts', "value.replace(/\\u0000/gu, '')", 'value'],
  ['pre-OCR privacy callback', 'server/lib/resumeIngestExtraction.ts', 'await options.beforeOcr()', 'void options.beforeOcr'],
  ['public writer call', 'server/applications.routes.ts', 'await extractResumeForOrdinaryIngest(req.file.buffer', 'await Promise.resolve(req.file.buffer'],
  ['candidate writer call', 'server/ai.routes.ts', 'await extractResumeForOrdinaryIngest(file.buffer', 'await Promise.resolve(file.buffer'],
  ['candidate 503', 'server/ai.routes.ts', "code: 'RESUME_EXTRACTION_UNAVAILABLE'", "code: 'INVALID_RESUME'"],
  ['candidate upload ordering', 'server/ai.routes.ts', '// Extract text before upload.', 'const gcsPath = await uploadToGCS(file.buffer, file.originalname); // Extract text before upload.'],
  ['application on-demand reader', 'server/applications.routes.ts', 'const buffer = await downloadFromGCS(application.resumeUrl);', 'const buffer = Buffer.alloc(0);'],
  ['AI on-demand reader', 'server/ai.routes.ts', 'const buffer = await downloadFromGCS(application.resumeUrl);', 'const buffer = Buffer.alloc(0);'],
  ['legacy bulk client', 'server/lib/googleVisionOcrClient.ts', 'files:asyncBatchAnnotate', 'files:annotate'],
  ['legacy bulk helper', 'server/lib/resumeImportExtraction.ts', 'extractTextWithGoogleVisionOcr', 'extractTextWithGoogleVisionIngestOcr'],
  ['shallow CI checkout', '../.github/workflows/ci.yml', 'fetch-depth: 0', 'fetch-depth: 1'],
];

const authoredFiles = [
  '.github/workflows/ci.yml',
  'scripts/check-resume-ingest-ocr.mjs',
  'server/ai.routes.ts',
  'server/applications.routes.ts',
  'server/candidate-privacy/surfaces.json',
  'server/lib/__tests__/googleVisionIngestOcrClient.test.ts',
  'server/lib/__tests__/resumeIngestExtraction.test.ts',
  'server/lib/__tests__/resumeIngestOcrGuard.test.ts',
  'server/lib/googleVisionIngestOcrClient.ts',
  'server/lib/resumeIngestExtraction.ts',
  'server/object-authorization/surfaces.json',
];

const pinnedHistory = {
  sourceIsAncestorOfMerge: true,
  mergeIsAncestorOfHead: true,
  sourceTree: 'b1674cdd942bdf13f6c486b1a42714a879016fd3',
  mergeTree: '2657e7c19c2de792f14fff87142e8b7bf9c2c1eb',
  committedDiff: authoredFiles.map((file) => (
    file.startsWith('.github/') ? file : `VantaHireWebsite/${file}`
  )).join('\n'),
};

describe('ordinary-ingest OCR source guard', () => {
  for (const [label, file, from, to] of mutations) {
    it(`rejects ${label} mutation`, () => {
      const changed = { ...files, [file]: files[file].replace(from, to) };
      expect(changed[file]).not.toBe(files[file]);
      expect(validateResumeIngestOcrSources(changed)).not.toEqual([]);
    });
  }

  it('accepts the authored source contract', () => {
    expect(validateResumeIngestOcrSources(files)).toEqual([]);
  });

  it('derives the exact boundary from a committed tree', () => {
    const committed = authoredFiles.map((file) => (
      file.startsWith('.github/') ? file : `VantaHireWebsite/${file}`
    )).join('\n');
    expect(collectAuthoredFiles(committed, '')).toEqual(authoredFiles);
  });

  it('derives the exact boundary from an uncommitted worktree', () => {
    const status = authoredFiles.map((file, index) => {
      const repoFile = file.startsWith('.github/') ? file : `VantaHireWebsite/${file}`;
      return `${index < 2 ? '??' : ' M'} ${repoFile}`;
    }).join('\n');
    expect(collectAuthoredFiles('', status)).toEqual(authoredFiles);
  });

  it('unions committed and uncommitted changes without hiding extras', () => {
    const committed = 'VantaHireWebsite/server/applications.routes.ts';
    const status = [
      ' M VantaHireWebsite/server/applications.routes.ts',
      '?? VantaHireWebsite/server/undeclared.ts',
    ].join('\n');
    expect(collectAuthoredFiles(committed, status)).toEqual([
      'server/applications.routes.ts',
      'server/undeclared.ts',
    ]);
  });

  it('accepts the immutable shipped OCR range independently of later packages', () => {
    expect(validatePinnedOcrHistory(pinnedHistory)).toEqual([]);
  });

  it.each([
    ['source ancestry', { sourceIsAncestorOfMerge: false }, 'OCR source-to-merge ancestry pin drifted.'],
    ['merge ancestry', { mergeIsAncestorOfHead: false }, 'OCR merge is not an ancestor of HEAD.'],
    ['source tree', { sourceTree: '0'.repeat(40) }, 'OCR source tree pin drifted.'],
    ['merge tree', { mergeTree: '0'.repeat(40) }, 'OCR merge tree pin drifted.'],
  ])('fails closed on %s drift', (_label, mutation, expected) => {
    expect(validatePinnedOcrHistory({ ...pinnedHistory, ...mutation })).toContain(expected);
  });

  it('rejects missing or extra files in the immutable OCR range', () => {
    const missing = pinnedHistory.committedDiff.split('\n').slice(1).join('\n');
    const extra = `${pinnedHistory.committedDiff}\nVantaHireWebsite/server/undeclared.ts`;
    expect(validatePinnedOcrHistory({ ...pinnedHistory, committedDiff: missing }))
      .toEqual([expect.stringContaining('eleven-file OCR boundary drifted:')]);
    expect(validatePinnedOcrHistory({ ...pinnedHistory, committedDiff: extra }))
      .toEqual([expect.stringContaining('eleven-file OCR boundary drifted:')]);
  });

  it('propagates current shared-governance failures without freezing their implementations', () => {
    expect(composeSharedGuardProblems(
      ['candidate-privacy-current-failure'],
      ['object-authorization-current-failure'],
    )).toEqual(['candidate-privacy-current-failure', 'object-authorization-current-failure']);
  });

  it('accepts a later separately-governed package without inflating the shipped OCR boundary', () => {
    expect(checkResumeIngestOcr(root)).toEqual([]);
  });
});
