import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { extractResumeForOrdinaryIngest } from '../lib/resumeIngestExtraction';
import { extractResumeSource, RESUME_MAX_BYTES, scrubResumeContacts, type OcrGateResult } from './resume-source';

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const RESUME = 'Senior backend engineer with eight years building payment systems in Go and PostgreSQL at Acme.';
const pdf = (body = 'synthetic') => Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from(body)]);
const docx = () => Buffer.concat([Buffer.from('504b0304', 'hex'), Buffer.from('word/document.xml synthetic')]);
const doc = () => Buffer.concat([Buffer.from('d0cf11e0a1b11ae1', 'hex'), Buffer.from('synthetic word 97')]);
const U = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;

function inputFor(bytes: Buffer, mediaType = 'application/pdf', extra: Record<string, unknown> = {}) {
  return { schemaVersion: 1, sourceId: U(1), sourceVersion: 3,
    contentHash: sha(bytes), byteLength: bytes.length, mediaType, policyVersion: 'resume-v1', ...extra };
}
function grantFor(bytes: Buffer, pageNumbers: number[], totalPageCount = pageNumbers.length, override: Record<string, unknown> = {}) {
  return { granted: true as const, grant: { reservationId: U(2), dispatchId: U(3), operationKey: U(4),
    source: { sourceId: U(1), sourceVersion: 3, contentHash: sha(bytes) }, consentRevision: 7,
    limit: { kind: 'ocr' as const, pageCount: pageNumbers.length, totalPageCount, pageNumbers, contentHash: sha(bytes) }, ...override } };
}
const planFor = (bytes: Buffer, pageNumbers: number[], totalPages = pageNumbers.length, contentHash = sha(bytes)) =>
  ({ schemaVersion: 1 as const, contentHash, totalPages, pageNumbers });

type OcrFake = { success: boolean; text?: string; providerCalls?: number; reasonCode?: string } | Error;
// PDFs go through the shared per-page analyser (faked here); `native.text === ''`
// means every page is image-only. DOC/DOCX still use the native extractor.
function harness(bytes: Buffer, options: { native?: { success: boolean; text?: string } | Error; ocr?: OcrFake;
  decision?: unknown; pages?: number | Error; pdfPages?: string[]; knownContacts?: string[] } = {}) {
  const extractNative = vi.fn(async () => {
    if (options.native instanceof Error) throw options.native;
    return { success: options.native?.success ?? true, text: options.native?.text ?? RESUME };
  });
  const extractOcr = vi.fn(async (_b: Buffer, plan?: { pageNumbers: readonly number[] }) => {
    if (options.ocr instanceof Error) throw options.ocr;
    const text = options.ocr?.text ?? RESUME;
    return { success: options.ocr?.success ?? true, text, providerCalls: options.ocr?.providerCalls ?? 2,
      reasonCode: options.ocr?.reasonCode as never, pageTexts: (plan?.pageNumbers ?? []).map(pageNumber => ({ pageNumber, text })) };
  });
  const pages = options.pages ?? 2;
  const native = options.native instanceof Error ? null : options.native;
  const analysePdf = vi.fn(async () => {
    if (pages instanceof Error || Number.isNaN(pages) || pages === 0) throw new Error('OCR_PAGE_COUNT_REFUSED');
    if (options.pdfPages) return options.pdfPages;
    return native?.text === '' ? Array.from({ length: pages }, () => '') : [native?.text ?? RESUME];
  });
  const firstGrantPages = () => options.pdfPages
    ? options.pdfPages.flatMap((t, i) => (t.trim() ? [] : [i + 1]))
    : Array.from({ length: typeof pages === 'number' && pages > 0 ? pages : 1 }, (_, i) => i + 1);
  const beforeOcr = vi.fn(async (): Promise<OcrGateResult> => {
    if (options.decision instanceof Error) throw options.decision;
    return (options.decision ?? grantFor(bytes, firstGrantPages(), options.pdfPages?.length)) as OcrGateResult;
  });
  const extract = vi.fn((buffer: Buffer, opts: Parameters<typeof extractResumeForOrdinaryIngest>[1]) =>
    extractResumeForOrdinaryIngest(buffer, opts, { extractNative, extractOcr, analysePdf } as never));
  return { deps: { beforeOcr, extract, knownContacts: options.knownContacts }, extractNative, extractOcr, beforeOcr, analysePdf, extract };
}

// Frozen seam validator from the package lock; proves output conformance.
const seam = () => import('./lock-seam-contracts.mjs' as string);

describe('P2 resume extraction adapter', () => {
  it('returns native text with no OCR, an exact text hash and a seam-valid result', async () => {
    const bytes = pdf(); const h = harness(bytes);
    const input = inputFor(bytes);
    const { output, ocr } = await extractResumeSource(input, bytes, h.deps);
    expect(output).toMatchObject({ status: 'extracted', method: 'native_text', providerCalls: 0, text: RESUME, textHash: sha(RESUME) });
    expect(ocr).toEqual({ state: 'not_requested' });
    expect(h.beforeOcr).not.toHaveBeenCalled();
    expect(h.extractOcr).not.toHaveBeenCalled();
    expect(h.extract.mock.calls[0]![1]).toMatchObject({ requireComplete: true });
    expect((await seam()).validateExtractionResult(input, output).status).toBe('extracted');
  });

  it('analyses pages locally, then OCRs once after a durable grant, and settles every selected page', async () => {
    const bytes = pdf(); const h = harness(bytes, { native: { success: true, text: '' }, pages: 3 });
    const input = inputFor(bytes);
    const { output, ocr } = await extractResumeSource(input, bytes, h.deps);
    expect(output).toMatchObject({ status: 'extracted', method: 'google_vision_ocr', providerCalls: 1 });
    expect(h.beforeOcr).toHaveBeenCalledWith({ source: { sourceId: U(1), sourceVersion: 3, contentHash: sha(bytes) },
      pageCount: 3, totalPageCount: 3, pageNumbers: [1, 2, 3] });
    expect(h.extractOcr).toHaveBeenCalledTimes(1);
    expect(h.analysePdf.mock.invocationCallOrder[0]).toBeLessThan(h.beforeOcr.mock.invocationCallOrder[0]);
    expect(h.beforeOcr.mock.invocationCallOrder[0]).toBeLessThan(h.extractOcr.mock.invocationCallOrder[0]);
    expect(ocr).toMatchObject({ state: 'dispatched', disposition: 'settle', holdReason: null,
      observedUsage: { kind: 'ocr', pagesSubmitted: 3, transportAttempts: 2 } });
    expect((await seam()).validateExtractionResult(input, output).status).toBe('extracted');
  });

  it.each([
    [{ granted: false, reason: 'budget_unavailable' }, 'budget_unavailable', 'refused'],
    [{ granted: false, reason: 'privacy_changed' }, 'privacy_changed', 'refused'],
    [{ granted: false, reason: 'source_changed' }, 'source_changed', 'refused'],
    [{ granted: false, reason: 'provider_uncertain' }, 'provider_uncertain', 'refused'],
    [new Error('journal down'), 'provider_uncertain', 'invalid_grant'],
    [{ granted: true }, 'provider_uncertain', 'invalid_grant'],
    [{ granted: 'yes' }, 'provider_uncertain', 'invalid_grant'],
  ] as const)('never calls OCR without a valid durable grant (%j)', async (decision, reason, state) => {
    const bytes = pdf(); const h = harness(bytes, { native: { success: true, text: '' }, decision });
    const { output, ocr } = await extractResumeSource(inputFor(bytes), bytes, h.deps);
    expect(output).toMatchObject({ status: 'unavailable', reason });
    expect(ocr.state).toBe(state);
    expect(h.extractOcr).not.toHaveBeenCalled();
  });

  it.each([
    ['page count', { limit: { kind: 'ocr', pageCount: 9, totalPageCount: 9, pageNumbers: [1, 2, 3, 4, 5, 6, 7, 8, 9], contentHash: 'x' } }],
    ['selected pages', { limit: { kind: 'ocr', pageCount: 2, totalPageCount: 3, pageNumbers: [1, 3], contentHash: sha(pdf()) } }],
    ['total page count', { limit: { kind: 'ocr', pageCount: 2, totalPageCount: 5, pageNumbers: [1, 2], contentHash: sha(pdf()) } }],
    ['source', { source: { sourceId: U(5), sourceVersion: 3, contentHash: 'x' } }],
    ['consent', { consentRevision: 0 }],
  ])('rejects a grant whose %s does not match and reports it for releaseUnsent', async (_label, override) => {
    const bytes = pdf(); const h = harness(bytes, { native: { success: true, text: '' }, decision: grantFor(pdf(), [1, 2], 2, override) });
    const { output, ocr } = await extractResumeSource(inputFor(bytes), bytes, h.deps);
    expect(output).toMatchObject({ status: 'unavailable', reason: 'provider_uncertain' });
    expect(ocr).toEqual({ state: 'invalid_grant', reservationId: U(2) });
    expect(h.extractOcr).not.toHaveBeenCalled();
  });

  it.each([
    [0, 'unsupported'], [11, 'too_large'], [Number.NaN, 'unsupported'], [new Error('corrupt'), 'unsupported'],
  ] as const)('never asks for a grant when the local page analysis gives %s', async (pages, reason) => {
    const bytes = pdf(); const h = harness(bytes, { native: { success: true, text: '' }, pages: pages as never });
    const { output, ocr } = await extractResumeSource(inputFor(bytes), bytes, h.deps);
    expect(output).toMatchObject({ status: 'unavailable', reason });
    expect(ocr).toEqual({ state: 'not_requested' });
    expect(h.beforeOcr).not.toHaveBeenCalled();
    expect(h.extractOcr).not.toHaveBeenCalled();
  });

  it.each([
    [{ success: false, providerCalls: 3, reasonCode: 'OCR_TIMEOUT' }, 'provider_uncertain', 'hold', 'provider_uncertain'],
    [{ success: false, providerCalls: 2, reasonCode: 'OCR_PROVIDER_REFUSED' }, 'provider_uncertain', 'hold', 'provider_uncertain'],
    [{ success: false, providerCalls: 2, reasonCode: 'OCR_OUTPUT_REFUSED' }, 'provider_uncertain', 'hold', 'provider_uncertain'],
    [new Error('socket reset'), 'provider_uncertain', 'hold', 'usage_unknown'],
    [{ success: false, providerCalls: 1, reasonCode: 'OCR_AUTH_REFUSED' }, 'provider_refused', 'hold', 'provider_uncertain'],
    [{ success: false, providerCalls: 0, reasonCode: 'OCR_NOT_CONFIGURED' }, 'budget_unavailable', 'hold', 'usage_unknown'],
    [{ success: true, text: 'too short' }, 'empty', 'settle', null],
  ] as const)('maps OCR outcome %j, never retries, and never records zero usage on doubt', async (fake, reason, disposition, holdReason) => {
    const bytes = pdf(); const h = harness(bytes, { native: { success: true, text: '' }, ocr: fake as never });
    const { output, ocr } = await extractResumeSource(inputFor(bytes), bytes, h.deps);
    expect(output).toMatchObject({ status: 'unavailable', reason });
    expect(ocr).toMatchObject({ state: 'dispatched', disposition, holdReason });
    if (disposition === 'hold') expect(ocr.state === 'dispatched' && ocr.observedUsage.pagesSubmitted).toBeNull();
    expect(h.extractOcr).toHaveBeenCalledTimes(1);
    expect(h.beforeOcr).toHaveBeenCalledTimes(1);
  });

  it('allows the paid gate at most once even if an extractor asks twice', async () => {
    const bytes = pdf(); const h = harness(bytes);
    const greedy = vi.fn(async (_b: Buffer, opts: { beforeOcr: (plan?: unknown) => Promise<void> }) => {
      await opts.beforeOcr(planFor(bytes, [1, 2])); await opts.beforeOcr(planFor(bytes, [1, 2]));
      return { success: true, text: RESUME, method: 'google_vision_ocr' as const, providerCalls: 2 };
    });
    const { output } = await extractResumeSource(inputFor(bytes), bytes, { ...h.deps, extract: greedy });
    expect(output).toMatchObject({ status: 'unavailable', reason: 'provider_uncertain' });
    expect(h.beforeOcr).toHaveBeenCalledTimes(1);
  });

  it('rejects a grant for different pages of the same document (same count and total)', async () => {
    const bytes = pdf();
    const h = harness(bytes, { pdfPages: ['', '', 'Page three has plenty of real native text in it.'], decision: grantFor(bytes, [1, 3], 3) });
    const { output, ocr } = await extractResumeSource(inputFor(bytes), bytes, h.deps);
    expect(h.beforeOcr).toHaveBeenCalledWith(expect.objectContaining({ pageNumbers: [1, 2], totalPageCount: 3 }));
    expect(output).toMatchObject({ status: 'unavailable', reason: 'provider_uncertain' });
    expect(ocr).toEqual({ state: 'invalid_grant', reservationId: U(2) });
    expect(h.extractOcr).not.toHaveBeenCalled();
  });

  it('OCRs only the image-only pages of a mixed PDF and merges them in page order', async () => {
    const P1 = 'Page one: Senior backend engineer, eight years of Go and PostgreSQL at Acme Payments.';
    const P3 = 'Page three: Education, IIT Madras B.Tech Computer Science 2012 to 2016.';
    const bytes = pdf(); const h = harness(bytes, { pdfPages: [P1, '', P3, ''], ocr: { success: true, text: 'OCR page' } });
    const { output, ocr } = await extractResumeSource(inputFor(bytes), bytes, h.deps);
    expect(h.beforeOcr).toHaveBeenCalledWith(expect.objectContaining({ pageCount: 2, totalPageCount: 4, pageNumbers: [2, 4] }));
    expect(output).toMatchObject({ status: 'extracted', method: 'google_vision_ocr', text: `${P1}\n\nOCR page\n\n${P3}\n\nOCR page` });
    expect(ocr).toMatchObject({ disposition: 'settle', observedUsage: { pagesSubmitted: 2 } });
  });

  it('reads an all-text PDF longer than 10 pages in full with no paid gate', async () => {
    const bytes = pdf(); const pages = Array.from({ length: 12 }, (_, i) => `Page ${i + 1} of a long CV with real text content.`);
    const h = harness(bytes, { pdfPages: pages });
    const { output } = await extractResumeSource(inputFor(bytes), bytes, h.deps);
    expect(output).toMatchObject({ status: 'extracted', method: 'native_text', text: pages.join('\n\n') });
    expect(h.beforeOcr).not.toHaveBeenCalled();
  });

  it.each([
    ['no plan', undefined, 'unsupported'],
    ['a plan for other bytes', 'otherHash', 'source_changed'],
    ['duplicate pages', [2, 2], 'unsupported'],
    ['unordered pages', [3, 1], 'unsupported'],
    ['a page past the end', [3], 'unsupported'],
    ['more than 10 pages', 'eleven', 'too_large'],
  ] as const)('refuses %s before any grant request', async (_label, shape, reason) => {
    const bytes = pdf(); const h = harness(bytes);
    const plan = shape === undefined ? undefined : shape === 'otherHash' ? planFor(bytes, [1], 2, sha('other'))
      : shape === 'eleven' ? planFor(bytes, [1], 11) : planFor(bytes, [...shape], 2);
    const tampering = vi.fn(async (_b: Buffer, opts: { beforeOcr: (plan?: unknown) => Promise<void> }) => {
      await opts.beforeOcr(plan); return { success: true, text: RESUME, method: 'google_vision_ocr' as const, providerCalls: 1 };
    });
    const { output, ocr } = await extractResumeSource(inputFor(bytes), bytes, { ...h.deps, extract: tampering });
    expect(output).toMatchObject({ status: 'unavailable', reason });
    expect(ocr).toEqual({ state: 'not_requested' });
    expect(h.beforeOcr).not.toHaveBeenCalled();
  });

  it('never turns a partly read résumé into an extraction', async () => {
    const bytes = pdf(); const h = harness(bytes);
    const partial = vi.fn(async () => ({ success: true, text: RESUME, method: 'native_text' as const, providerCalls: 0, partial: true }));
    const { output } = await extractResumeSource(inputFor(bytes), bytes, { ...h.deps, extract: partial });
    expect(output).toMatchObject({ status: 'unavailable', reason: 'unsupported' });
  });

  it('keeps OCR failure on a mixed PDF complete-or-nothing (no native-only text)', async () => {
    const bytes = pdf(); const h = harness(bytes, { pdfPages: ['Page one text that would pass the native threshold on its own easily.', ''],
      ocr: { success: false, providerCalls: 1, reasonCode: 'OCR_TIMEOUT' } });
    const { output, ocr } = await extractResumeSource(inputFor(bytes), bytes, h.deps);
    expect(output).toMatchObject({ status: 'unavailable', reason: 'provider_uncertain' });
    expect(ocr).toMatchObject({ disposition: 'hold', observedUsage: { pagesSubmitted: null } });
  });

  it('refuses bytes that are not the selected snapshot before any extraction', async () => {
    const bytes = pdf();
    for (const [input, body] of [
      [inputFor(bytes, 'application/pdf', { byteLength: bytes.length + 1 }), bytes],
      [inputFor(bytes, 'application/pdf', { contentHash: sha('other') }), bytes],
      [inputFor(bytes), pdf('changed')],
    ] as const) {
      const h = harness(bytes);
      await expect(extractResumeSource(input, body, h.deps)).resolves.toMatchObject({ output: { status: 'unavailable', reason: 'source_changed' } });
      expect(h.extract).not.toHaveBeenCalled();
    }
  });

  it('refuses a declared type that does not match the bytes', async () => {
    const bytes = pdf(); const h = harness(bytes);
    await expect(extractResumeSource(inputFor(bytes, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), bytes, h.deps))
      .resolves.toMatchObject({ output: { status: 'unavailable', reason: 'unsupported' } });
    expect(h.extract).not.toHaveBeenCalled();
  });

  it('keeps DOC/DOCX native-only: no page count, grant or OCR for Word files', async () => {
    const d = docx(); const okDocx = harness(d);
    await expect(extractResumeSource(inputFor(d, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), d, okDocx.deps))
      .resolves.toMatchObject({ output: { status: 'extracted', method: 'native_text' } });
    const w = doc(); const blank = harness(w, { native: { success: true, text: '' } });
    await expect(extractResumeSource(inputFor(w, 'application/msword'), w, blank.deps)).resolves.toMatchObject({ output: { status: 'unavailable', reason: 'empty' } });
    expect(blank.analysePdf).not.toHaveBeenCalled();
    expect(blank.beforeOcr).not.toHaveBeenCalled();
    expect(blank.extractOcr).not.toHaveBeenCalled();
  });

  it('rejects malformed input and the 5 MiB limit at the schema', async () => {
    const bytes = pdf(); const h = harness(bytes);
    await expect(extractResumeSource({ ...inputFor(bytes), url: 'https://x' }, bytes, h.deps)).rejects.toThrow();
    await expect(extractResumeSource(inputFor(bytes, 'application/pdf', { byteLength: RESUME_MAX_BYTES + 1 }), bytes, h.deps)).rejects.toThrow();
    await expect(extractResumeSource(inputFor(bytes, 'text/plain'), bytes, h.deps)).rejects.toThrow();
    expect(h.extract).not.toHaveBeenCalled();
  });

  it('refuses extracted text over 512 KiB', async () => {
    const bytes = pdf(); const h = harness(bytes, { native: { success: true, text: 'a'.repeat(512 * 1024 + 1) } });
    await expect(extractResumeSource(inputFor(bytes), bytes, h.deps)).resolves.toMatchObject({ output: { status: 'unavailable', reason: 'too_large' } });
  });

  it('preserves non-BMP text exactly and repairs lone surrogates before hashing', async () => {
    const accented = `${RESUME} Worked with café teams 🚀 in 東京.`;
    const bytes = pdf();
    const exact = await extractResumeSource(inputFor(bytes), bytes, harness(bytes, { native: { success: true, text: accented } }).deps);
    expect(exact.output).toMatchObject({ status: 'extracted', text: accented, textHash: sha(accented) });
    const repaired = await extractResumeSource(inputFor(bytes), bytes, harness(bytes, { native: { success: true, text: `${RESUME} \ud83d tail` } }).deps);
    expect(repaired.output).toMatchObject({ status: 'extracted', text: `${RESUME} � tail` });
    expect((await seam()).validateExtractionResult(inputFor(bytes), repaired.output).status).toBe('extracted');
  });

  it('scrubs contacts from the returned text whatever AI_STRIP_PII says, and hashes the scrubbed text', async () => {
    const withContacts = `${RESUME}\nPriya Rao | priya.rao@example.com | Mobile: +91 98765 43210\nPersonal: priya[at]mail[dot]com`;
    const bytes = pdf(); const h = harness(bytes, { native: { success: true, text: withContacts }, knownContacts: ['Priya.Rao@Example.com'] });
    const { output } = await extractResumeSource(inputFor(bytes), bytes, h.deps);
    expect(output.status).toBe('extracted');
    if (output.status !== 'extracted') return;
    expect(output.text).not.toMatch(/priya\.rao@|98765|43210|priya\[at\]/i);
    expect(output.text).toContain('Priya Rao');
    expect(output.textHash).toBe(sha(output.text));
  });
});

describe('contact scrub', () => {
  it.each([
    ['plain email', 'Reach me at jane.doe+jobs@acme.co.uk today', 'jane.doe'],
    ['obfuscated email', 'jane (at) acme (dot) io', 'acme (dot)'],
    ['labelled Indian mobile', 'Phone: +91-98765-43210', '98765'],
    ['US number', 'Call (415) 555-0134 anytime', '555-0134'],
    ['UK number', 'Tel 020 7946 0958', '7946'],
    ['bare 10-digit', 'contact 9876543210 now', '9876543210'],
    ['whatsapp label', 'WhatsApp: 98765 43210', '43210'],
  ])('removes %s', (_label, text, gone) => {
    expect(scrubResumeContacts(text)).not.toContain(gone);
  });

  it.each([
    ['date range', 'Software Engineer, 2018 - 2023'],
    ['to present', 'Lead, 2019–present'],
    ['month range', 'Jan 2020 - Mar 2022'],
    ['metric', 'Scaled to 10,000,000 users and 99.95% uptime'],
    ['money', 'Grew revenue by $12,500,000 in 2021'],
    ['years list', 'Awards 2019 2020 2021 2022'],
    ['date', 'Joined 12/03/2019'],
    ['numeric id', 'Employee of the year 2021, team of 12'],
  ])('keeps %s intact', (_label, text) => {
    expect(scrubResumeContacts(text)).toBe(text);
  });

  it.each([
    ['uuid with a 10-digit run (B1)', 'source 1f3a9c2e-5b7d-4e1a-9c3b-d0796635825b'],
    ['all-digit uuid segment', 'id 12345678-1234-4123-8123-123456789012'],
    ['sha-256 hash (B1)', 'hash 0796635825013579246801357924680135792468013579246801357924680a'],
    ['ISO date-time (B4)', '{"start":"2021-06-01T00:00:00.000Z","end":null}'],
    ['ISO date with offset', 'from 2016-01-01T00:00:00+05:30'],
    ['ISO date', 'Started 2019-07-15'],
    ['canonical JSON with ids', '{"evidence":[{"contentHash":"0796635825013579246801357924680135792468013579246801357924680a","sourceId":"1f3a9c2e-5b7d-4e1a-9c3b-d0796635825b"}]}'],
  ])('keeps %s intact', (_label, text) => {
    expect(scrubResumeContacts(text)).toBe(text);
  });

  it.each([
    ['phone next to a uuid', 'id 1f3a9c2e-5b7d-4e1a-9c3b-d0796635825b call 9876543210', '9876543210'],
    ['phone after an ISO date', 'Joined 2021-06-01, Phone: +91-98765-43210', '98765'],
    ['email whose local part is a uuid', '1f3a9c2e-5b7d-4e1a-9c3b-d0796635825b@acme.io', '@acme.io'],
    ['phone shaped like a date but invalid', 'call 2021-13-45 9876', '2021-13-45'],
  ])('still removes %s', (_label, text, gone) => {
    expect(scrubResumeContacts(text)).not.toContain(gone);
  });

  it('never alters random correction evidence ids (B1 was ~47% of sets)', () => {
    for (let i = 0; i < 5000; i += 1) {
      const evidence = JSON.stringify({ factId: randomUUID(), sourceId: randomUUID(), contentHash: randomBytes(32).toString('hex'),
        start: `20${String(10 + (i % 15))}-0${1 + (i % 9)}-01T00:00:00.000Z` });
      expect(scrubResumeContacts(evidence)).toBe(evidence);
    }
  });

  it('protects identifiers from known-contact replacement and leaves placeholder-like text alone', () => {
    const id = '1f3a9c2e-5b7d-4e1a-9c3b-d0796635825b';
    expect(scrubResumeContacts(`${id} and 0796635825`, ['0796635825'])).toBe(`${id} and [contact removed]`);
    expect(scrubResumeContacts('\uE000a\uE001 call 9876543210')).toBe('\uE000a\uE001 call [contact removed]');
  });

  it('removes a known verified email case-insensitively even when it is not email-shaped in context', () => {
    expect(scrubResumeContacts('ID: candidate42_mailbox', ['CANDIDATE42_MAILBOX'])).toBe('ID: [contact removed]');
  });
});
