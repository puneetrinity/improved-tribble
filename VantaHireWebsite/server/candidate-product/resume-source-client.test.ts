import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deliverResumeTransfer, ResumeTransferError, verifyStoredTransfer, type StoredTransfer } from './resume-source-client';
import { assembleResumeProposal, buildResumeTransfer, parseSemanticFacts, type ExtractedSource } from './resume-source-proposals';
import { canonicalProfileJson } from './profile-contracts';

const sha = (v: string) => createHash('sha256').update(v, 'utf8').digest('hex');
const seam = () => import('/home/ews/ealana-index/candidate-parallel-lock-20261030/contracts.mjs' as string);
const env = { ACTIVEKG_BASE_URL: 'https://memory.example/' } as NodeJS.ProcessEnv;
const TEXT = 'Priya Rao 🚀\nSkills: Go, PostgreSQL, Kafka';

function makeTransfer() {
  const text = TEXT;
  const source: ExtractedSource = { sourceId: '11111111-1111-4111-8111-111111111111', sourceVersion: 2,
    contentHash: 'a'.repeat(64), policyVersion: 'resume-v1', text, textHash: sha(text) };
  let n = 0;
  const parsed = parseSemanticFacts(JSON.stringify({ facts: [{ kind: 'skill', value: 'Kafka', evidence: [{ quote: 'Skills: Go, PostgreSQL, Kafka' }] }], notes: [] }),
    { source, newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` });
  const proposal = assembleResumeProposal(source, { proposalId: '22222222-2222-4222-8222-222222222222', originalDraftVersion: 1,
    originalProfileVersion: 1, originalPreferenceVersion: 0, originalPreferenceDraftRevision: 0, expiresAt: '2026-11-29T00:00:00.000Z' }, parsed);
  const built = buildResumeTransfer(source, proposal, { commandId: '33333333-3333-4333-8333-333333333333',
    subjectId: '44444444-4444-4444-8444-444444444444', bindingId: '55555555-5555-4555-8555-555555555555', consentRevision: 6 });
  return { built, stored: { canonical: built.canonical, sha256: built.commandHash } satisfies StoredTransfer };
}

function receiptFor(built: ReturnType<typeof makeTransfer>['built'], over: Record<string, unknown> = {}) {
  const t = built.transfer;
  return { schemaVersion: 1, commandId: t.commandId, subjectId: t.subjectId, bindingId: t.bindingId, commandHash: built.commandHash,
    sourceId: t.sourceId, sourceVersion: t.sourceVersion, proposalId: t.proposal.proposalId, proposalHash: t.proposal.proposalHash,
    outcome: 'stored', reason: null, canonicalProfileChanged: false, publicationActive: false, ...over };
}

const sign = vi.fn(async () => 'signed.token');
const respond = (status: number, body: unknown = '') => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
async function code(p: Promise<unknown>) {
  try { await p; } catch (e) { return e instanceof ResumeTransferError ? e.code : `other:${String(e)}`; }
  return 'resolved';
}
afterEach(() => { vi.useRealTimers(); sign.mockClear(); });

describe('signed resume transfer client', () => {
  it('POSTs the exact stored bytes with owner-write signing and returns a seam-valid receipt', async () => {
    const { built, stored } = makeTransfer();
    const fetchMock = vi.fn(async () => respond(200, receiptFor(built)));
    const result = await deliverResumeTransfer(stored, new AbortController().signal, { fetch: fetchMock as typeof fetch, sign, env });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://memory.example/candidate-profiles/sources/resume');
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', body: stored.canonical });
    expect(init.headers).toMatchObject({ authorization: 'Bearer signed.token', 'x-command-sha256': stored.sha256,
      'X-Candidate-Binding-ID': built.transfer.bindingId, 'X-Candidate-Command-ID': built.transfer.commandId });
    expect(sign).toHaveBeenCalledWith('activekg', expect.objectContaining({ tenantId: `candidate_${built.transfer.subjectId}`,
      scopes: 'candidate-profile:owner-write', requestId: built.transfer.commandId }));
    const { validateSourceReceipt } = await seam();
    expect(validateSourceReceipt(built.transfer, result.receipt)).toEqual(result.receipt);
    expect(result.document.canonical).toBe(canonicalProfileJson(result.receipt));
    expect(result.document.sha256).toBe(sha(result.document.canonical));
  });

  it('accepts a rejected replay receipt as a durable outcome', async () => {
    const { built, stored } = makeTransfer();
    const r = await deliverResumeTransfer(stored, new AbortController().signal,
      { fetch: (async () => respond(200, receiptFor(built, { outcome: 'rejected', reason: 'stale_edit' }))) as typeof fetch, sign, env });
    expect(r.receipt).toMatchObject({ outcome: 'rejected', reason: 'stale_edit' });
  });

  it.each([[409, 'command_conflict'], [422, 'invalid_request'], [401, 'identity_conflict'], [403, 'identity_conflict'],
    [451, 'candidate_privacy_restricted'], [503, 'memory_unavailable'], [500, 'delivery_outcome_unknown'], [404, 'delivery_outcome_unknown']])(
    'maps HTTP %i to %s', async (status, expected) => {
      const { stored } = makeTransfer();
      expect(await code(deliverResumeTransfer(stored, new AbortController().signal,
        { fetch: (async () => respond(status, '{}')) as typeof fetch, sign, env }))).toBe(expected);
    });

  it.each([
    ['a foreign proposal hash', (b: ReturnType<typeof makeTransfer>['built']) => receiptFor(b, { proposalHash: 'b'.repeat(64) }), 'identity_conflict'],
    ['a different command hash', (b: ReturnType<typeof makeTransfer>['built']) => receiptFor(b, { commandHash: 'c'.repeat(64) }), 'identity_conflict'],
    ['a claimed profile change', (b: ReturnType<typeof makeTransfer>['built']) => receiptFor(b, { canonicalProfileChanged: true }), 'delivery_outcome_unknown'],
    ['stored with a reason', (b: ReturnType<typeof makeTransfer>['built']) => receiptFor(b, { reason: 'stale_edit' }), 'delivery_outcome_unknown'],
    ['an extra field', (b: ReturnType<typeof makeTransfer>['built']) => receiptFor(b, { extra: 1 }), 'delivery_outcome_unknown'],
    ['malformed JSON', () => '{not json', 'delivery_outcome_unknown'],
    ['an oversized body', (b: ReturnType<typeof makeTransfer>['built']) => ({ ...receiptFor(b), pad: 'x'.repeat(9000) }), 'delivery_outcome_unknown'],
  ])('refuses a receipt with %s', async (_l, body, expected) => {
    const { built, stored } = makeTransfer();
    expect(await code(deliverResumeTransfer(stored, new AbortController().signal,
      { fetch: (async () => respond(200, body(built))) as typeof fetch, sign, env }))).toBe(expected);
  });

  it.each([
    ['a hash that does not match the bytes', (s: StoredTransfer) => ({ ...s, sha256: 'd'.repeat(64) })],
    ['non-canonical bytes', (s: StoredTransfer) => { const c = JSON.stringify(JSON.parse(s.canonical), null, 1); return { canonical: c, sha256: sha(c) }; }],
    ['edited text with a recomputed command hash', (s: StoredTransfer) => {
      const v = JSON.parse(s.canonical); v.text = `${v.text}!`; const c = canonicalProfileJson(v); return { canonical: c, sha256: sha(c) }; }],
    ['an edited proposal with a recomputed command hash', (s: StoredTransfer) => {
      const v = JSON.parse(s.canonical); v.proposal.reviewNotes = ['x']; const c = canonicalProfileJson(v); return { canonical: c, sha256: sha(c) }; }],
  ])('never sends a stored command with %s', async (_l, mutate) => {
    const { stored } = makeTransfer();
    const fetchMock = vi.fn();
    expect(await code(deliverResumeTransfer(mutate(stored), new AbortController().signal, { fetch: fetchMock as typeof fetch, sign, env }))).toBe('invalid_request');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sign).not.toHaveBeenCalled();
  });

  it('accepts its own stored command', () => {
    expect(verifyStoredTransfer(makeTransfer().stored).commandId).toBe('33333333-3333-4333-8333-333333333333');
  });

  it('refuses a plain-HTTP or path-bearing Memory origin without sending', async () => {
    const { stored } = makeTransfer();
    const fetchMock = vi.fn();
    for (const url of ['http://memory.example/', 'https://memory.example/api/']) {
      expect(await code(deliverResumeTransfer(stored, new AbortController().signal,
        { fetch: fetchMock as typeof fetch, sign, env: { ACTIVEKG_BASE_URL: url } as NodeJS.ProcessEnv }))).toBe('memory_unavailable');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a caller abort before sending is memory_unavailable and sends nothing', async () => {
    const { stored } = makeTransfer();
    const ctl = new AbortController(); ctl.abort();
    const fetchMock = vi.fn();
    expect(await code(deliverResumeTransfer(stored, ctl.signal, { fetch: fetchMock as typeof fetch, sign, env }))).toBe('memory_unavailable');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a network error after dispatch is an unknown outcome (never a provider failure)', async () => {
    const { stored } = makeTransfer();
    expect(await code(deliverResumeTransfer(stored, new AbortController().signal,
      { fetch: (async () => { throw new TypeError('socket hang up'); }) as typeof fetch, sign, env }))).toBe('delivery_outcome_unknown');
  });

  it('the 10-second deadline covers signing and the response', async () => {
    vi.useFakeTimers();
    const { stored } = makeTransfer();
    const hang = () => new Promise<never>(() => {});
    const slowSign = deliverResumeTransfer(stored, new AbortController().signal, { fetch: vi.fn() as typeof fetch, sign: hang as never, env });
    const slowFetch = deliverResumeTransfer(stored, new AbortController().signal, { fetch: hang as typeof fetch, sign, env });
    const a = code(slowSign), b = code(slowFetch);
    await vi.advanceTimersByTimeAsync(9_999);
    await vi.advanceTimersByTimeAsync(2);
    expect(await a).toBe('memory_unavailable');
    expect(await b).toBe('delivery_outcome_unknown');
  });

  it('makes exactly one attempt per call (the outbox owns retries)', async () => {
    const { stored } = makeTransfer();
    const fetchMock = vi.fn(async () => respond(503));
    await code(deliverResumeTransfer(stored, new AbortController().signal, { fetch: fetchMock as typeof fetch, sign, env }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
