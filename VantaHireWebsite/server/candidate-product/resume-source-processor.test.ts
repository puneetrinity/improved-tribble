import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { derivedId, groqSemanticModel, processResumeSource, SEMANTIC_DISPATCH_MS, startResumeSourceWorker,
  type ResumeProcessorDependencies } from './resume-source-processor';
import { ResumeTransferError, verifyStoredTransfer, type StoredTransfer } from './resume-source-client';
import { canonicalProfileJson } from './profile-contracts';
import { ResumeSourceRepositoryError, sourceClaimSchema, type CanonicalDocument, type SourceClaim } from './resume-source-repository';
import { scrubResumeContacts } from './resume-source';
import type { extractResumeSource, ResumeExtractionOutput } from './resume-source';

const sha = (v: string) => createHash('sha256').update(v, 'utf8').digest('hex');
const doc = (v: unknown): CanonicalDocument => { const c = canonicalProfileJson(v); return { canonical: c, sha256: sha(c) }; };
const TEXT = 'Priya Rao\nSkills: Go, PostgreSQL, Kafka\nAcme Payments — Engineer, 2019 – Present';
const CMD = '33333333-3333-4333-8333-333333333333';
const EMAIL = 'priya.rao@example.com';
const seenContacts: Array<readonly string[] | undefined> = [];
const lease = { commandId: CMD, claimToken: '66666666-6666-4666-8666-666666666666', generation: 1 };
const owned = (mediaType: SourceClaim['source']['mediaType'] = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') => ({
  source: { sourceId: '11111111-1111-4111-8111-111111111111', sourceVersion: 2, contentHash: 'a'.repeat(64) },
  byteLength: 10, mediaType, policyVersion: 'resume-v1', objectHandle: '77777777-7777-4777-8777-777777777777' });
const claimFor = (mediaType?: SourceClaim['source']['mediaType']): SourceClaim => ({ lease,
  actor: { userId: 9, subjectId: '44444444-4444-4444-8444-444444444444', bindingId: '55555555-5555-4555-8555-555555555555' },
  source: owned(mediaType), consentRevision: 6, scrubContext: { verifiedAccountEmail: EMAIL }, originalDraftVersion: 4, originalProfileVersion: 1,
  originalPreferenceVersion: 0, originalPreferenceDraftRevision: 3 });
const extracted = (text = TEXT, method: 'native_text' | 'google_vision_ocr' = 'native_text'): ResumeExtractionOutput => ({
  schemaVersion: 1, ...owned().source, policyVersion: 'resume-v1', status: 'extracted', text, textHash: sha(text),
  method, providerCalls: method === 'native_text' ? 0 : 1 });
const status = (state: string, proposalId: string | null = null) => ({ commandId: CMD, sourceId: owned().source.sourceId,
  sourceVersion: 2, state, reason: null, proposalId }) as never;
const MODEL_JSON = JSON.stringify({ facts: [{ kind: 'skill', value: 'Kafka', evidence: [{ quote: 'Skills: Go, PostgreSQL, Kafka' }] }], notes: [] });
const semGrant = (limit: unknown) => ({ reservationId: 'aaaaaaaa-0000-4000-8000-000000000001', dispatchId: 'bbbbbbbb-0000-4000-8000-000000000001',
  operationKey: derivedId(CMD, 'semantic'), source: owned().source, consentRevision: 6, limit });
const ocrGrant = { reservationId: 'aaaaaaaa-0000-4000-8000-000000000002', dispatchId: 'bbbbbbbb-0000-4000-8000-000000000002',
  operationKey: derivedId(CMD, 'ocr'), source: owned().source, consentRevision: 6,
  limit: { kind: 'ocr', pageCount: 2, totalPageCount: 3, pageNumbers: [1, 3], contentHash: 'a'.repeat(64) } };
const receipt = { reservationId: semGrant(null).reservationId, dispatchId: semGrant(null).dispatchId, operationKey: derivedId(CMD, 'semantic'),
  state: 'settled', observedUsage: { kind: 'semantic_model', inputTokens: 1, outputTokens: 1 }, reason: 'completed' };

/** Fake extractor that exercises the real gate closure for PDFs. */
function fakeExtract(kind: 'native' | 'scanned', ocr: 'settle' | 'hold' = 'settle'): typeof extractResumeSource {
  return (async (_input: unknown, _bytes: Buffer, deps: Parameters<typeof extractResumeSource>[2]) => {
    seenContacts.push(deps.knownContacts);
    if (kind === 'native') return { output: extracted(scrubResumeContacts(`${TEXT}\nWrite to ${EMAIL} or priya.rao (at) example (dot) com`, deps.knownContacts)), ocr: { state: 'not_requested' } };
    const gate = await deps.beforeOcr({ source: owned().source, pageCount: 2, totalPageCount: 3, pageNumbers: [1, 3] });
    if (!gate.granted) return { output: { ...extracted(), status: 'unavailable', reason: gate.reason } as never, ocr: { state: 'refused' } };
    return ocr === 'settle'
      ? { output: extracted(TEXT, 'google_vision_ocr'), ocr: { state: 'dispatched', grant: gate.grant,
          observedUsage: { kind: 'ocr', pagesSubmitted: 2, transportAttempts: 1 }, disposition: 'settle', holdReason: null } }
      : { output: { ...extracted(), status: 'unavailable', reason: 'provider_uncertain' } as never, ocr: { state: 'dispatched', grant: gate.grant,
          observedUsage: { kind: 'ocr', pagesSubmitted: null, transportAttempts: 1 }, disposition: 'hold', holdReason: 'provider_uncertain' } };
  }) as unknown as typeof extractResumeSource;
}

function harness(over: { mediaType?: SourceClaim['source']['mediaType'] } = {}) {
  let n = 0;
  const persisted: StoredTransfer[] = [];
  const repo = {
    prepare: vi.fn(async () => claimFor(over.mediaType) as SourceClaim | null),
    reserve: vi.fn(async (r: { operationKey: string; limit: { kind: string } }) => r.limit.kind === 'ocr'
      ? { state: 'reserved', reservation: { reservationId: ocrGrant.reservationId, operationKey: r.operationKey, limit: r.limit } }
      : { state: 'reserved', reservation: { reservationId: semGrant(null).reservationId, operationKey: r.operationKey, limit: r.limit } }) as ReturnType<typeof vi.fn>,
    beginDispatch: vi.fn(async (r: { reservationId: string }) => r.reservationId === ocrGrant.reservationId
      ? { state: 'dispatch', grant: ocrGrant } : { state: 'dispatch', grant: semGrant(lastSemLimit) }) as ReturnType<typeof vi.fn>,
    settle: vi.fn(async () => receipt) as ReturnType<typeof vi.fn>,
    hold: vi.fn(async () => ({ ...receipt, state: 'held', reason: 'provider_uncertain' })) as ReturnType<typeof vi.fn>,
    releaseUnsent: vi.fn(async () => ({ state: 'released' })) as ReturnType<typeof vi.fn>,
    persistTransfer: vi.fn(async (_l: unknown, t: StoredTransfer) => { persisted.push(t); return status('transferring'); }),
    settleTransfer: vi.fn(async () => status('review_ready', derivedId(CMD, 'proposal'))) as ReturnType<typeof vi.fn>,
    fail: vi.fn(async (_l: unknown, reason: string) => ({ ...status('unavailable'), reason })) as ReturnType<typeof vi.fn>,
  };
  let lastSemLimit: unknown = null;
  repo.reserve.mockImplementation(async (r: { operationKey: string; limit: { kind: string } }) => {
    if (r.limit.kind !== 'ocr') lastSemLimit = r.limit;
    return { state: 'reserved', reservation: { reservationId: r.limit.kind === 'ocr' ? ocrGrant.reservationId : semGrant(null).reservationId,
      operationKey: r.operationKey, limit: r.limit } };
  });
  const model = vi.fn(async () => ({ content: MODEL_JSON, usage: { inputTokens: 100, outputTokens: 50 } }));
  const deliver = vi.fn(async (stored: StoredTransfer) => {
    const t = verifyStoredTransfer(stored);
    const r = { schemaVersion: 1, commandId: t.commandId, subjectId: t.subjectId, bindingId: t.bindingId, commandHash: stored.sha256,
      sourceId: t.sourceId, sourceVersion: t.sourceVersion, proposalId: t.proposal.proposalId, proposalHash: t.proposal.proposalHash,
      outcome: 'stored', reason: null, canonicalProfileChanged: false, publicationActive: false };
    return { receipt: r, document: doc(r) };
  }) as ReturnType<typeof vi.fn>;
  const deps: ResumeProcessorDependencies = { repo: repo as never, reader: { read: vi.fn(async () => new Uint8Array(10)) },
    model, modelName: 'openai/gpt-oss-120b', deliver: deliver as never, extract: fakeExtract('native'),
    now: () => new Date('2026-10-30T00:00:00.000Z'), newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` };
  return { repo, model, deliver, deps, persisted };
}

afterEach(() => { vi.useRealTimers(); });

describe('resume source processor', () => {
  it('runs native text -> model -> settle -> persist -> deliver -> settleTransfer, with no OCR slot', async () => {
    const h = harness();
    const r = await processResumeSource(lease, h.deps);
    expect(r.result).toBe('review_ready');
    expect(h.repo.reserve).toHaveBeenCalledTimes(1);
    expect(h.repo.reserve.mock.calls[0]![0]).toMatchObject({ operationKey: derivedId(CMD, 'semantic'), consentRevision: 6,
      limit: { kind: 'semantic_model', model: 'openai/gpt-oss-120b' } });
    expect(h.model).toHaveBeenCalledTimes(1);
    const settled = h.repo.settle.mock.calls[0]![0];
    expect(settled.observedUsage).toEqual({ kind: 'semantic_model', inputTokens: 100, outputTokens: 50 });
    expect(JSON.parse(settled.result.canonical).proposalId).toBe(derivedId(CMD, 'proposal'));
    const t = verifyStoredTransfer(h.persisted[0]!);
    expect(t).toMatchObject({ commandId: CMD, subjectId: claimFor().actor.subjectId, consentRevision: 6 });
    expect(t.text.startsWith(TEXT)).toBe(true);
    expect(h.repo.reserve.mock.calls[0]![0].limit.textHash).toBe(sha(t.text));
    expect(h.deliver.mock.calls[0]![0]).toEqual(h.persisted[0]);
    expect(h.repo.settleTransfer).toHaveBeenCalledTimes(1);
    expect(h.repo.fail).not.toHaveBeenCalled();
  });

  it('retries a lost transfer without calling the model again and resends byte-identical bytes', async () => {
    const h = harness();
    h.deliver.mockRejectedValueOnce(new ResumeTransferError('delivery_outcome_unknown'));
    expect((await processResumeSource(lease, h.deps)).result).toBe('retry');
    expect(h.repo.fail).not.toHaveBeenCalled();
    const stored = h.repo.settle.mock.calls[0]![0].result as CanonicalDocument;
    h.repo.reserve.mockResolvedValueOnce({ state: 'settled', receipt, result: stored });
    expect((await processResumeSource(lease, h.deps)).result).toBe('review_ready');
    expect(h.model).toHaveBeenCalledTimes(1);
    expect(h.repo.beginDispatch).toHaveBeenCalledTimes(1);
    expect(h.persisted[1]).toEqual(h.persisted[0]);
  });

  it('a scanned PDF reserves exactly its pages, settles OCR with the extraction, then runs the model', async () => {
    const h = harness({ mediaType: 'application/pdf' });
    h.deps.extract = fakeExtract('scanned');
    expect((await processResumeSource(lease, h.deps)).result).toBe('review_ready');
    expect(h.repo.reserve.mock.calls[0]![0]).toMatchObject({ operationKey: derivedId(CMD, 'ocr'),
      limit: { kind: 'ocr', pageCount: 2, totalPageCount: 3, pageNumbers: [1, 3], contentHash: 'a'.repeat(64) } });
    const ocrSettle = h.repo.settle.mock.calls[0]![0];
    expect(ocrSettle.grant).toEqual(ocrGrant);
    expect(JSON.parse(ocrSettle.result.canonical)).toMatchObject({ status: 'extracted', method: 'google_vision_ocr', textHash: sha(TEXT) });
    expect(h.repo.settle).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['budget_breach', 'budget_unavailable'], ['privacy_changed', 'privacy_changed'], ['usage_unknown', 'outcome_unknown'],
  ] as const)('a held OCR settlement (%s) stops before any model reservation, call or transfer (P2-V3)', async (reason, failed) => {
    const h = harness({ mediaType: 'application/pdf' });
    h.deps.extract = fakeExtract('scanned');
    h.repo.settle.mockResolvedValueOnce({ ...receipt, state: 'held', reason, observedUsage: { kind: 'ocr', pagesSubmitted: 2, transportAttempts: 1 } });
    expect((await processResumeSource(lease, h.deps)).result).toBe('held');
    expect(h.repo.reserve).toHaveBeenCalledTimes(1);
    expect(h.repo.reserve.mock.calls[0]![0].limit.kind).toBe('ocr');
    expect(h.model).not.toHaveBeenCalled();
    expect(h.repo.persistTransfer).not.toHaveBeenCalled();
    expect(h.deliver).not.toHaveBeenCalled();
    expect(h.repo.releaseUnsent).not.toHaveBeenCalled();
    expect(h.repo.fail).toHaveBeenCalledWith(lease, failed);
  });

  it('reuses an already-settled OCR result instead of calling OCR again', async () => {
    const h = harness({ mediaType: 'application/pdf' });
    h.deps.extract = fakeExtract('scanned');
    h.repo.reserve.mockResolvedValueOnce({ state: 'settled', receipt, result: doc(extracted(TEXT, 'google_vision_ocr')) });
    expect((await processResumeSource(lease, h.deps)).result).toBe('review_ready');
    expect(h.repo.beginDispatch).toHaveBeenCalledTimes(1); // semantic only
    expect(verifyStoredTransfer(h.persisted[0]!).text).toBe(TEXT);
  });

  it('re-cleans a reused OCR text with the current account email and never reuses stale cleaning', async () => {
    const h = harness({ mediaType: 'application/pdf' });
    h.deps.extract = fakeExtract('scanned');
    const staleText = `${TEXT}\nReach me at priya.new@example.org`;
    h.repo.reserve.mockResolvedValueOnce({ state: 'settled', receipt, result: doc(extracted(staleText, 'google_vision_ocr')) });
    h.repo.reserve.mockResolvedValueOnce({ state: 'refused', reason: 'idempotency_conflict' });
    expect((await processResumeSource(lease, h.deps)).result).toBe('unavailable');
    const semantic = h.repo.reserve.mock.calls[1]![0];
    expect(semantic.limit.kind).toBe('semantic_model');
    expect(semantic.limit.textHash).not.toBe(sha(staleText));
    expect(semantic.limit.textHash).toBe(sha(scrubResumeContacts(staleText, [EMAIL])));
    expect(h.repo.fail).toHaveBeenCalledWith(lease, 'idempotency_conflict');
    expect(h.model).not.toHaveBeenCalled();
    expect(h.repo.beginDispatch).not.toHaveBeenCalled();
  });

  it('refuses a settled OCR result for a different source', async () => {
    const h = harness({ mediaType: 'application/pdf' });
    h.deps.extract = fakeExtract('scanned');
    h.repo.reserve.mockResolvedValueOnce({ state: 'settled', receipt, result: doc({ ...extracted(), contentHash: 'f'.repeat(64) }) });
    expect((await processResumeSource(lease, h.deps)).result).toBe('unavailable');
    expect(h.repo.fail).toHaveBeenCalledWith(lease, 'source_changed');
    expect(h.model).not.toHaveBeenCalled();
  });

  it('holds an uncertain OCR call and stops before the model', async () => {
    const h = harness({ mediaType: 'application/pdf' });
    h.deps.extract = fakeExtract('scanned', 'hold');
    expect((await processResumeSource(lease, h.deps)).result).toBe('held');
    expect(h.repo.hold.mock.calls[0]![0]).toMatchObject({ reason: 'provider_uncertain', observedUsage: { pagesSubmitted: null } });
    expect(h.repo.releaseUnsent).not.toHaveBeenCalled();
    expect(h.repo.fail).toHaveBeenCalledWith(lease, 'outcome_unknown');
    expect(h.model).not.toHaveBeenCalled();
  });

  it('an OCR dispatch refusal releases the unsent slot and records the precise refusal', async () => {
    const h = harness({ mediaType: 'application/pdf' });
    h.deps.extract = fakeExtract('scanned');
    h.repo.beginDispatch.mockResolvedValueOnce({ state: 'refused', reason: 'consent_changed' });
    expect((await processResumeSource(lease, h.deps)).result).toBe('unavailable');
    expect(h.repo.releaseUnsent).toHaveBeenCalledWith({ lease, reservationId: ocrGrant.reservationId });
    expect(h.repo.fail).toHaveBeenCalledWith(lease, 'consent_changed');
  });

  it('a semantic dispatch refusal releases the slot and never calls the model', async () => {
    const h = harness();
    h.repo.beginDispatch.mockResolvedValueOnce({ state: 'refused', reason: 'budget_unavailable' });
    expect((await processResumeSource(lease, h.deps)).result).toBe('unavailable');
    expect(h.repo.releaseUnsent).toHaveBeenCalledTimes(1);
    expect(h.repo.fail).toHaveBeenCalledWith(lease, 'budget_unavailable');
    expect(h.model).not.toHaveBeenCalled();
  });

  it('a model error after dispatch holds the slot with unknown usage, never releases it', async () => {
    const h = harness();
    h.model.mockRejectedValueOnce(new Error('503'));
    expect((await processResumeSource(lease, h.deps)).result).toBe('held');
    expect(h.repo.hold.mock.calls[0]![0]).toMatchObject({ reason: 'provider_uncertain',
      observedUsage: { kind: 'semantic_model', inputTokens: null, outputTokens: null } });
    expect(h.repo.releaseUnsent).not.toHaveBeenCalled();
    expect(h.repo.persistTransfer).not.toHaveBeenCalled();
  });

  it('reported usage above the reservation is a budget breach hold', async () => {
    const h = harness();
    h.model.mockResolvedValueOnce({ content: MODEL_JSON, usage: { inputTokens: 100, outputTokens: 999_999 } });
    expect((await processResumeSource(lease, h.deps)).result).toBe('held');
    expect(h.repo.hold.mock.calls[0]![0]).toMatchObject({ reason: 'budget_breach' });
    expect(h.repo.fail).toHaveBeenCalledWith(lease, 'budget_unavailable');
  });

  it('the 20-second dispatch deadline aborts the model call and holds', async () => {
    vi.useFakeTimers();
    const h = harness();
    let aborted = false;
    h.model.mockImplementationOnce(async ({ signal }: { signal: AbortSignal }) =>
      new Promise((_, reject) => signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); })));
    const p = processResumeSource(lease, h.deps);
    await vi.advanceTimersByTimeAsync(SEMANTIC_DISPATCH_MS + 1);
    expect((await p).result).toBe('held');
    expect(aborted).toBe(true);
  });

  it('unusable model output still settles (the call happened) as an empty proposal with a note', async () => {
    const h = harness();
    h.model.mockResolvedValueOnce({ content: 'not json', usage: { inputTokens: 10, outputTokens: 2 } });
    expect((await processResumeSource(lease, h.deps)).result).toBe('review_ready');
    const proposal = verifyStoredTransfer(h.persisted[0]!).proposal as unknown as { facts: unknown[]; reviewNotes: string[] };
    expect(proposal.facts).toEqual([]);
    expect(proposal.reviewNotes[0]).toMatch(/could not read/);
  });

  it('a lost repository response before dispatch is a retry and releases nothing', async () => {
    const h = harness();
    h.repo.reserve.mockRejectedValueOnce(new ResumeSourceRepositoryError('authority_unavailable', 503));
    expect((await processResumeSource(lease, h.deps)).result).toBe('retry');
    expect(h.repo.releaseUnsent).not.toHaveBeenCalled();
    expect(h.repo.fail).not.toHaveBeenCalled();
  });

  it('a lost lease stops the worker cleanly', async () => {
    const h = harness();
    h.repo.prepare.mockResolvedValueOnce(null);
    expect((await processResumeSource(lease, h.deps)).result).toBe('lease_lost');
    expect(h.deps.reader.read).not.toHaveBeenCalled();
    h.repo.settle.mockRejectedValueOnce(new ResumeSourceRepositoryError('lease_lost', 409));
    expect((await processResumeSource(lease, h.deps)).result).toBe('lease_lost');
  });

  it('terminal transfer refusals record a reason; retryable ones do not', async () => {
    const h = harness();
    h.deliver.mockRejectedValueOnce(new ResumeTransferError('candidate_privacy_restricted'));
    expect((await processResumeSource(lease, h.deps)).result).toBe('unavailable');
    expect(h.repo.fail).toHaveBeenCalledWith(lease, 'privacy_changed');
    h.deliver.mockRejectedValueOnce(new ResumeTransferError('memory_unavailable'));
    h.repo.fail.mockClear();
    expect((await processResumeSource(lease, h.deps)).result).toBe('retry');
    expect(h.repo.fail).not.toHaveBeenCalled();
  });

  it('derived identifiers are stable per command and valid UUIDs', () => {
    expect(derivedId(CMD, 'semantic')).toBe(derivedId(CMD, 'semantic'));
    expect(derivedId(CMD, 'semantic')).not.toBe(derivedId(CMD, 'ocr'));
    expect(derivedId(CMD, 'proposal')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('scrubs with the fresh verified account email and never lets it reach the model, transfer, results or failures', async () => {
    seenContacts.length = 0;
    const h = harness();
    const r = await processResumeSource(lease, h.deps);
    expect(r.result).toBe('review_ready');
    expect(seenContacts).toEqual([[EMAIL]]);
    const everything = JSON.stringify([h.model.mock.calls, h.persisted, h.repo.settle.mock.calls, h.repo.reserve.mock.calls,
      h.repo.persistTransfer.mock.calls, h.repo.settleTransfer.mock.calls, h.repo.fail.mock.calls, h.deliver.mock.calls, r]);
    expect(everything).not.toContain(EMAIL);
    expect(everything).not.toMatch(/priya\.rao \(at\)/);
  });

  it.each([
    ['missing', (c: SourceClaim) => { const { scrubContext: _drop, ...rest } = c; return rest as SourceClaim; }],
    ['malformed', (c: SourceClaim) => ({ ...c, scrubContext: { verifiedAccountEmail: 'not-an-email' } })],
    ['multi-line', (c: SourceClaim) => ({ ...c, scrubContext: { verifiedAccountEmail: `${EMAIL}\nx@y.z` } })],
  ])('a %s scrub context refuses before reading bytes or any paid call', async (_l, mutate) => {
    const h = harness();
    h.repo.prepare.mockResolvedValueOnce(mutate(claimFor()));
    expect((await processResumeSource(lease, h.deps)).result).toBe('retry');
    expect(h.deps.reader.read).not.toHaveBeenCalled();
    expect(h.repo.reserve).not.toHaveBeenCalled();
    expect(h.model).not.toHaveBeenCalled();
  });

  it('the repository schema makes the scrub context mandatory and exact', () => {
    expect(sourceClaimSchema.safeParse(claimFor()).success).toBe(true);
    const { scrubContext: _drop, ...missing } = claimFor();
    expect(sourceClaimSchema.safeParse(missing).success).toBe(false);
    expect(sourceClaimSchema.safeParse({ ...claimFor(), scrubContext: { verifiedAccountEmail: EMAIL, extra: 1 } }).success).toBe(false);
  });

  it('a changed account email that alters the scrubbed text refuses reuse instead of buying the model again', async () => {
    const h = harness();
    h.deliver.mockRejectedValueOnce(new ResumeTransferError('delivery_outcome_unknown'));
    await processResumeSource(lease, h.deps);
    const stored = h.repo.settle.mock.calls[0]![0].result as CanonicalDocument;
    h.repo.prepare.mockResolvedValueOnce({ ...claimFor(), scrubContext: { verifiedAccountEmail: 'new@example.org' } });
    h.deps.extract = (async () => ({ output: extracted(`${TEXT}\nchanged`), ocr: { state: 'not_requested' } })) as never;
    void stored;
    // P0 binds the reservation fingerprint (incl. limit.textHash): changed text is a conflict, not a reuse.
    h.repo.reserve.mockResolvedValueOnce({ state: 'refused', reason: 'idempotency_conflict' });
    expect((await processResumeSource(lease, h.deps)).result).toBe('unavailable');
    expect(h.repo.reserve.mock.calls.at(-1)![0].limit.textHash).toBe(sha(`${TEXT}\nchanged`));
    expect(h.repo.fail).toHaveBeenCalledWith(lease, 'idempotency_conflict');
    expect(h.model).toHaveBeenCalledTimes(1);
  });

  it('the Groq adapter disables SDK retries and passes the abort signal', async () => {
    const create = vi.fn(async () => ({ choices: [{ message: { content: '{}' } }], usage: { prompt_tokens: 7, completion_tokens: 3 } }));
    const signal = new AbortController().signal;
    const r = await groqSemanticModel({ chat: { completions: { create } } })({ model: 'm', messages: [], maxOutputTokens: 6000, signal });
    expect(create.mock.calls[0]![1]).toMatchObject({ signal, maxRetries: 0 });
    expect(create.mock.calls[0]![0]).toMatchObject({ max_tokens: 6000, response_format: { type: 'json_object' } });
    expect(r.usage).toEqual({ inputTokens: 7, outputTokens: 3 });
  });

  it('the worker never runs more than two claims at once', async () => {
    let active = 0, peak = 0, served = 0;
    const worker = startResumeSourceWorker({ workerId: '88888888-8888-4888-8888-888888888888', concurrency: 5,
      claim: async () => (served++ < 6 ? claimFor() : null), sleep: () => new Promise(r => setTimeout(r, 1)),
      process: async () => { active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 5)); active--; return { result: 'retry' }; } });
    await new Promise(r => setTimeout(r, 60));
    await worker.stop();
    expect(peak).toBe(2);
  });
});

// RETRY-ADAPTER-1: the strict reserve adapter accepts P0's ancestor-OCR reuse proof
// only when it exactly matches the current request; nothing else is reusable.
import { resumeSourceRepository } from './resume-source-repository';
import { sourcePaidRequestIdentity } from './source-repository';
describe('reserve reuse proof (RETRY-ADAPTER-1)', () => {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const source = { sourceId: id(1), sourceVersion: 1, contentHash: 'c'.repeat(64) };
  const lease = { commandId: id(2), claimToken: id(3), generation: 1 };
  const ocrLimit = { kind: 'ocr' as const, pageCount: 1, totalPageCount: 2, pageNumbers: [2], contentHash: 'c'.repeat(64) };
  const semLimit = { kind: 'semantic_model' as const, model: 'm', inputTokens: 10, maxOutputTokens: 20, textHash: 'd'.repeat(64) };
  const request = (limit: typeof ocrLimit | typeof semLimit, operationKey = id(4)) =>
    ({ schemaVersion: 1 as const, lease, source, consentRevision: 1, operationKey, limit });
  const doc = (v: unknown) => { const canonical = canonicalProfileJson(v); return { canonical, sha256: createHash('sha256').update(canonical).digest('hex') }; };
  const receipt = (kind: 'ocr' | 'semantic_model', operationKey: string) => ({ reservationId: id(5), dispatchId: id(6), operationKey, state: 'settled', reason: 'completed',
    observedUsage: kind === 'ocr' ? { kind, pagesSubmitted: 1, transportAttempts: 1 } : { kind, inputTokens: 10, outputTokens: 5 } });
  const repoReturning = (result: unknown) => resumeSourceRepository({ query: async () => ({ rows: [{ result }] }) } as never, async () => {});

  it('accepts the original receipt for the same key, without a proof', async () => {
    const r = request(ocrLimit);
    await expect(repoReturning({ state: 'settled', receipt: receipt('ocr', r.operationKey), result: doc({ a: 1 }) }).reserve(r)).resolves.toMatchObject({ state: 'settled' });
  });
  it('accepts an ancestor OCR receipt (different key) only with an exact proof of the current request', async () => {
    const r = request(ocrLimit);
    const out = await repoReturning({ state: 'settled', receipt: receipt('ocr', id(9)), result: doc({ a: 1 }), reuseFor: sourcePaidRequestIdentity(r) }).reserve(r);
    expect(out).toMatchObject({ state: 'settled', reuseFor: sourcePaidRequestIdentity(r) });
  });
  it.each([
    ['no proof', (r: ReturnType<typeof request>) => ({ state: 'settled', receipt: receipt('ocr', id(9)), result: doc({ a: 1 }) })],
    ['a tampered proof', (r: ReturnType<typeof request>) => ({ state: 'settled', receipt: receipt('ocr', id(9)), result: doc({ a: 1 }),
      reuseFor: sourcePaidRequestIdentity({ ...r, consentRevision: 2 }) })],
    ['a proof on the same key', (r: ReturnType<typeof request>) => ({ state: 'settled', receipt: receipt('ocr', r.operationKey), result: doc({ a: 1 }), reuseFor: sourcePaidRequestIdentity(r) })],
  ])('refuses an OCR receipt with %s as outcome_unknown', async (_l, make) => {
    const r = request(ocrLimit);
    await expect(repoReturning(make(r)).reserve(r)).rejects.toMatchObject({ code: 'outcome_unknown' });
  });
  it('never reuses an AI result under a different key, even with a proof', async () => {
    const r = request(semLimit);
    await expect(repoReturning({ state: 'settled', receipt: receipt('semantic_model', id(9)), result: doc({ a: 1 }), reuseFor: sourcePaidRequestIdentity(r) }).reserve(r))
      .rejects.toMatchObject({ code: 'outcome_unknown' });
  });
});
