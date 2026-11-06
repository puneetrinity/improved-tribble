import { createHash, randomUUID } from 'node:crypto';
import { getGroqClient } from '../lib/groqClient';
import { getGroqModel } from '../lib/aiModelConfig';
import { canonicalProfileJson } from './profile-contracts';
import { deliverResumeTransfer, ResumeTransferError, type ResumeTransferCode } from './resume-source-client';
import {
  extractResumeSource, scrubResumeContacts, type OcrDispatchGrant, type OcrGateRequest, type OcrGateResult, type ResumeExtractionOutput,
  type ResumeUnavailableReason,
} from './resume-source';
import {
  assembleResumeProposal, buildResumeTransfer, buildSemanticRequest, parseSemanticFacts,
  type ExtractedSource, type ResumeProposal,
} from './resume-source-proposals';
import {
  ResumeSourceRepositoryError, scrubContextSchema, type CanonicalDocument, type DispatchGrant, type FailReason, type Lease,
  type OwnedSource, type Actor, type PaidReceipt, type Refusal, type ResumeSourceRepository, type SourceClaim, type SourceStatus,
} from './resume-source-repository';

// P2 worker. One claimed source command runs: read bytes -> extract (native, OCR
// only through the paid gate) -> semantic model through the paid gate -> verified
// proposal -> exact resumeTransfer -> signed delivery -> settle. Paid results are
// settled atomically with usage (D-1), so a retry reuses them via reserve/dispatch
// `settled` and never calls OCR or the model again. Transfer failures never rerun
// extraction-provider work or the model. All retries come from the durable lease.

export const SEMANTIC_DISPATCH_MS = 20_000;
export const PROPOSAL_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const RESUME_WORKER_CONCURRENCY = 2;
const INVALID_OUTPUT_NOTE = 'We could not read suggestions from this résumé. Please fill in your profile yourself.';

export interface SemanticModelRequest {
  model: string; messages: Array<{ role: 'system' | 'user'; content: string }>; maxOutputTokens: number; signal: AbortSignal;
}
export interface SemanticModelResponse { content: string; usage: { inputTokens: number | null; outputTokens: number | null } | null }
export type SemanticModel = (request: SemanticModelRequest) => Promise<SemanticModelResponse>;

type GroqLike = { chat: { completions: { create: (body: Record<string, unknown>, options: Record<string, unknown>) => Promise<{
  choices?: Array<{ message?: { content?: string | null } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } | null }> } } };

/** One provider call, no SDK retries (each retry would be unreserved spend). */
export function groqSemanticModel(client: GroqLike = getGroqClient() as unknown as GroqLike): SemanticModel {
  return async ({ model, messages, maxOutputTokens, signal }) => {
    const res = await client.chat.completions.create(
      { model, messages, max_tokens: maxOutputTokens, temperature: 0, response_format: { type: 'json_object' } },
      { signal, maxRetries: 0, timeout: SEMANTIC_DISPATCH_MS });
    const content = res.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('model_empty_response');
    const count = (v: unknown) => (Number.isSafeInteger(v) && (v as number) >= 0 ? v as number : null);
    return { content, usage: res.usage ? { inputTokens: count(res.usage.prompt_tokens), outputTokens: count(res.usage.completion_tokens) } : null };
  };
}

export interface ResumeProcessorDependencies {
  repo: Pick<ResumeSourceRepository, 'prepare' | 'persistTransfer' | 'settleTransfer' | 'fail'
    | 'reserve' | 'beginDispatch' | 'settle' | 'hold' | 'releaseUnsent'>;
  reader: { read(actor: Actor, source: OwnedSource): Promise<Uint8Array>;
    saveLibraryText?(actor: Actor, source: OwnedSource, text: string): Promise<boolean> };
  model?: SemanticModel;
  modelName?: string;
  deliver?: typeof deliverResumeTransfer;
  extract?: typeof extractResumeSource;
  now?: () => Date;
  newId?: () => string;
  signal?: AbortSignal;
}
export type ResumeProcessResult =
  | { result: 'review_ready' | 'unavailable' | 'held'; status: SourceStatus }
  | { result: 'retry' | 'lease_lost' };

const sha = (v: string) => createHash('sha256').update(v, 'utf8').digest('hex');
const doc = (value: unknown): CanonicalDocument => { const canonical = canonicalProfileJson(value); return { canonical, sha256: sha(canonical) }; };
/** Stable per-command identifiers so every retry names the same paid slot/proposal. */
export function derivedId(commandId: string, purpose: string): string {
  const h = sha(`ealana:p2:${purpose}:${commandId}`);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16]!, 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

class Retry extends Error { constructor(public readonly leaseLost: boolean) { super('retry'); } }
const asRetry = (error: unknown) => new Retry(error instanceof ResumeSourceRepositoryError && error.code === 'lease_lost');

const heldReason = (reason: PaidReceipt['reason']): FailReason =>
  reason === 'privacy_changed' ? 'privacy_changed' : reason === 'budget_breach' ? 'budget_unavailable' : 'outcome_unknown';

function failReason(reason: ResumeUnavailableReason, refusal: Refusal | null): FailReason {
  if (refusal) return refusal;
  return reason === 'provider_uncertain' ? 'outcome_unknown' : reason;
}
function gateReason(r: Refusal): Extract<OcrGateResult, { granted: false }>['reason'] {
  return r === 'budget_unavailable' || r === 'privacy_changed' || r === 'source_changed' ? r
    : r === 'consent_changed' ? 'privacy_changed' : 'provider_uncertain';
}
const transferFail: Record<Exclude<ResumeTransferCode, 'memory_unavailable' | 'delivery_outcome_unknown'>, FailReason> = {
  candidate_privacy_restricted: 'privacy_changed', command_conflict: 'idempotency_conflict',
  identity_conflict: 'idempotency_conflict', invalid_request: 'outcome_unknown',
};

/** A settled OCR result must be the exact extraction of this source. */
function storedExtraction(result: CanonicalDocument, source: OwnedSource): ResumeExtractionOutput {
  const v = JSON.parse(result.canonical) as ResumeExtractionOutput;
  if (canonicalProfileJson(v) !== result.canonical || v.sourceId !== source.source.sourceId || v.sourceVersion !== source.source.sourceVersion
    || v.contentHash !== source.source.contentHash || v.policyVersion !== source.policyVersion) throw new Error('stored_extraction_mismatch');
  if (v.status === 'extracted' && (typeof v.text !== 'string' || sha(v.text) !== v.textHash)) throw new Error('stored_extraction_mismatch');
  return v;
}
/** A settled semantic result must be a self-consistent proposal whose every quote is in this text. */
function storedProposal(result: CanonicalDocument, src: ExtractedSource, proposalId: string): ResumeProposal {
  const p = JSON.parse(result.canonical) as ResumeProposal;
  const { proposalHash, ...body } = p;
  if (canonicalProfileJson(p) !== result.canonical || sha(canonicalProfileJson(body)) !== proposalHash || p.proposalId !== proposalId
    || p.sourceKind !== 'resume' || p.sourceId !== src.sourceId || p.sourceVersion !== src.sourceVersion) throw new Error('stored_proposal_mismatch');
  for (const fact of p.facts) for (const e of fact.evidence) {
    const m = /^text:(\d+):(\d+)$/.exec(e.locator);
    if (!m || e.contentHash !== src.contentHash || src.text.slice(Number(m[1]), Number(m[1]) + Number(m[2])) !== e.quote) throw new Error('stored_proposal_mismatch');
  }
  return p;
}

export async function processResumeSource(input: Lease, deps: ResumeProcessorDependencies): Promise<ResumeProcessResult> {
  const { repo } = deps;
  try {
    let claim: SourceClaim | null;
    try { claim = await repo.prepare(input); } catch (e) { throw asRetry(e); }
    if (!claim) return { result: 'lease_lost' };
    // Fresh on every prepare; missing/malformed context refuses before any read or paid call.
    if (!scrubContextSchema.safeParse(claim.scrubContext).success) throw new Retry(false);
    const knownContacts = [claim.scrubContext.verifiedAccountEmail];
    const lease = claim.lease;
    const fail = async (reason: FailReason) => {
      try { return await repo.fail(lease, reason); } catch (e) { throw asRetry(e); }
    };

    let bytes: Uint8Array;
    try { bytes = await deps.reader.read(claim.actor, claim.source); } catch { throw new Retry(false); }

    // ---- extraction with the paid OCR gate
    let ocrSettled: CanonicalDocument | null = null;
    let gateRefusal: Refusal | null = null;
    let gateError: unknown = null;
    const owned = claim.source;
    const beforeOcr = async ({ source, pageCount, totalPageCount, pageNumbers }: OcrGateRequest): Promise<OcrGateResult> => {
      try {
        // Reserve exactly the selected image-only pages, never the whole document.
        const reserved = await repo.reserve({ schemaVersion: 1, lease, source, consentRevision: claim!.consentRevision,
          operationKey: derivedId(lease.commandId, 'ocr'),
          limit: { kind: 'ocr', pageCount, totalPageCount, pageNumbers: [...pageNumbers], contentHash: source.contentHash } });
        if (reserved.state === 'settled') { ocrSettled = reserved.result; return { granted: false, reason: 'provider_uncertain' }; }
        if (reserved.state === 'refused') { gateRefusal = reserved.reason; return { granted: false, reason: gateReason(reserved.reason) }; }
        const dispatch = await repo.beginDispatch({ lease, reservationId: reserved.reservation.reservationId });
        if (dispatch.state === 'settled') { ocrSettled = dispatch.result; return { granted: false, reason: 'provider_uncertain' }; }
        if (dispatch.state === 'refused') {
          gateRefusal = dispatch.reason;
          await repo.releaseUnsent({ lease, reservationId: reserved.reservation.reservationId });
          return { granted: false, reason: gateReason(dispatch.reason) };
        }
        return { granted: true, grant: dispatch.grant as OcrDispatchGrant };
      } catch (e) { gateError = e; return { granted: false, reason: 'provider_uncertain' }; }
    };
    const { output, ocr } = await (deps.extract ?? extractResumeSource)({ schemaVersion: 1, ...owned.source,
      byteLength: owned.byteLength, mediaType: owned.mediaType, policyVersion: owned.policyVersion }, Buffer.from(bytes), { beforeOcr, knownContacts });

    let ocrReceipt: PaidReceipt | null = null;
    try {
      if (ocr.state === 'dispatched') {
        if (ocr.disposition === 'settle') ocrReceipt = await repo.settle({ lease, grant: ocr.grant, observedUsage: ocr.observedUsage, result: doc(output) });
        else await repo.hold({ lease, grant: ocr.grant, observedUsage: ocr.observedUsage, reason: ocr.holdReason ?? 'provider_uncertain' });
      } else if (ocr.state === 'invalid_grant' && ocr.reservationId) {
        // The repository releases only a truly undispatched slot; anything else stays held.
        await repo.releaseUnsent({ lease, reservationId: ocr.reservationId });
      }
    } catch (e) { throw asRetry(e); }
    if (gateError) throw asRetry(gateError);
    // The database may answer a settlement with 'held' (privacy, budget or usage).
    // That OCR text is not a completed extraction: stop before any model reservation (P2-V3).
    if (ocrReceipt && ocrReceipt.state === 'held') return { result: 'held', status: await fail(heldReason(ocrReceipt.reason)) };

    let extraction = output;
    if (ocrSettled) {
      try { extraction = storedExtraction(ocrSettled, owned); } catch { return { result: 'unavailable', status: await fail('source_changed') }; }
      // The stored OCR text was cleaned with the account email current at that time.
      // Re-clean with the CURRENT email; if that changes the text, its new hash makes
      // the old semantic reservation a conflict (SQL refuses), so nothing is reused
      // with stale cleaning and nothing is bought again.
      if (extraction.status === 'extracted') {
        const text = scrubResumeContacts(extraction.text, knownContacts);
        if (text !== extraction.text) extraction = { ...extraction, text, textHash: sha(text) };
      }
    }
    if (extraction.status !== 'extracted') {
      const reason = failReason(extraction.reason, gateRefusal);
      const status = await fail(reason);
      return { result: ocr.state === 'dispatched' && ocr.disposition === 'hold' ? 'held' : 'unavailable', status };
    }
    // B3: the library row waiting on this Spark read reuses this one complete,
    // budgeted extraction. Best effort: a failure never stops the Spark read.
    if (deps.reader.saveLibraryText) {
      try { await deps.reader.saveLibraryText(claim.actor, owned, extraction.text); } catch { /* retried on the next read */ }
    }
    const src: ExtractedSource = { sourceId: extraction.sourceId, sourceVersion: extraction.sourceVersion,
      contentHash: extraction.contentHash, policyVersion: extraction.policyVersion, text: extraction.text, textHash: extraction.textHash };

    // ---- semantic model through the paid gate
    const proposalId = derivedId(lease.commandId, 'proposal');
    const request = buildSemanticRequest(src, deps.modelName ?? getGroqModel());
    let proposal: ResumeProposal;
    const reuse = async (result: CanonicalDocument) => {
      try { return storedProposal(result, src, proposalId); } catch { return null; }
    };
    let reserved, dispatch;
    try {
      reserved = await repo.reserve({ schemaVersion: 1, lease, source: owned.source, consentRevision: claim.consentRevision,
        operationKey: derivedId(lease.commandId, 'semantic'), limit: request.limit });
    } catch (e) { throw asRetry(e); }
    if (reserved.state === 'refused') return { result: 'unavailable', status: await fail(reserved.reason) };
    if (reserved.state === 'settled') {
      const p = await reuse(reserved.result);
      if (!p) return { result: 'unavailable', status: await fail('source_changed') };
      proposal = p;
    } else {
      try { dispatch = await repo.beginDispatch({ lease, reservationId: reserved.reservation.reservationId }); } catch (e) { throw asRetry(e); }
      if (dispatch.state === 'refused') {
        try { await repo.releaseUnsent({ lease, reservationId: reserved.reservation.reservationId }); } catch (e) { throw asRetry(e); }
        return { result: 'unavailable', status: await fail(dispatch.reason) };
      }
      if (dispatch.state === 'settled') {
        const p = await reuse(dispatch.result);
        if (!p) return { result: 'unavailable', status: await fail('source_changed') };
        proposal = p;
      } else {
        const outcome = await callModel(dispatch.grant, request, deps);
        if (outcome.kind === 'hold') {
          try { await repo.hold({ lease, grant: dispatch.grant, observedUsage: outcome.usage, reason: outcome.reason }); } catch (e) { throw asRetry(e); }
          return { result: 'held', status: await fail(outcome.reason === 'budget_breach' ? 'budget_unavailable' : 'outcome_unknown') };
        }
        let parsed;
        try { parsed = parseSemanticFacts(outcome.content, { source: src, newId: deps.newId ?? randomUUID }); }
        catch { parsed = { facts: [], reviewNotes: [INVALID_OUTPUT_NOTE], dropped: 0 }; }
        proposal = assembleResumeProposal(src, {
          proposalId, originalDraftVersion: claim.originalDraftVersion, originalProfileVersion: claim.originalProfileVersion,
          originalPreferenceVersion: claim.originalPreferenceVersion, originalPreferenceDraftRevision: claim.originalPreferenceDraftRevision,
          expiresAt: new Date((deps.now ?? (() => new Date()))().getTime() + PROPOSAL_TTL_MS).toISOString(),
        }, parsed);
        let receipt;
        try { receipt = await repo.settle({ lease, grant: dispatch.grant, observedUsage: outcome.usage, result: doc(proposal) }); }
        catch (e) { throw asRetry(e); }
        if (receipt.state === 'held') return { result: 'held', status: await fail(heldReason(receipt.reason)) };
      }
    }

    // ---- exact transfer, persisted before any send; identical bytes on every retry
    const built = buildResumeTransfer(src, proposal, { commandId: lease.commandId, subjectId: claim.actor.subjectId,
      bindingId: claim.actor.bindingId, consentRevision: claim.consentRevision });
    const stored = { canonical: built.canonical, sha256: built.commandHash };
    try { await repo.persistTransfer(lease, stored); } catch (e) { throw asRetry(e); }
    let delivered;
    try { delivered = await (deps.deliver ?? deliverResumeTransfer)(stored, deps.signal ?? new AbortController().signal); }
    catch (e) {
      if (e instanceof ResumeTransferError && e.code in transferFail)
        return { result: 'unavailable', status: await fail(transferFail[e.code as keyof typeof transferFail]) };
      throw new Retry(false);
    }
    let status: SourceStatus;
    try { status = await repo.settleTransfer(lease, delivered.document); } catch (e) { throw asRetry(e); }
    return { result: delivered.receipt.outcome === 'stored' ? 'review_ready' : 'unavailable', status };
  } catch (error) {
    if (error instanceof Retry) return { result: error.leaseLost ? 'lease_lost' : 'retry' };
    return { result: 'retry' };
  }
}

type ModelOutcome =
  | { kind: 'ok'; content: string; usage: { kind: 'semantic_model'; inputTokens: number | null; outputTokens: number | null } }
  | { kind: 'hold'; reason: 'provider_uncertain' | 'budget_breach'; usage: { kind: 'semantic_model'; inputTokens: number | null; outputTokens: number | null } };

async function callModel(grant: DispatchGrant, request: ReturnType<typeof buildSemanticRequest>, deps: ResumeProcessorDependencies): Promise<ModelOutcome> {
  const unknown = { kind: 'semantic_model' as const, inputTokens: null, outputTokens: null };
  if (grant.limit.kind !== 'semantic_model') return { kind: 'hold', reason: 'provider_uncertain', usage: unknown };
  const limit = grant.limit;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const res = await Promise.race([
      (deps.model ?? groqSemanticModel())({ model: limit.model, messages: request.messages, maxOutputTokens: limit.maxOutputTokens, signal: controller.signal }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('model_deadline')); }, SEMANTIC_DISPATCH_MS); }),
    ]);
    const usage = { kind: 'semantic_model' as const, inputTokens: res.usage?.inputTokens ?? null, outputTokens: res.usage?.outputTokens ?? null };
    if ((usage.inputTokens ?? 0) > limit.inputTokens || (usage.outputTokens ?? 0) > limit.maxOutputTokens) return { kind: 'hold', reason: 'budget_breach', usage };
    return { kind: 'ok', content: res.content, usage };
  } catch { return { kind: 'hold', reason: 'provider_uncertain', usage: unknown }; }
  finally { if (timer) clearTimeout(timer); controller.abort(); }
}

/** Bounded claim loop (lock: concurrency 2; lease/claim limits are P0's). */
export function startResumeSourceWorker(options: {
  workerId: string; claim: (workerId: string) => Promise<SourceClaim | null>; process: (lease: Lease) => Promise<ResumeProcessResult>;
  concurrency?: number; idleMs?: number; sleep?: (ms: number) => Promise<void>;
}) {
  const concurrency = Math.min(Math.max(options.concurrency ?? RESUME_WORKER_CONCURRENCY, 1), RESUME_WORKER_CONCURRENCY);
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
  let stopped = false;
  const lane = async () => {
    while (!stopped) {
      let claim: SourceClaim | null = null;
      try { claim = await options.claim(options.workerId); } catch { claim = null; }
      if (!claim) { await sleep(options.idleMs ?? 5_000); continue; }
      try { await options.process(claim.lease); } catch { /* lease expiry recovers it */ }
    }
  };
  const lanes = Array.from({ length: concurrency }, lane);
  return { async stop() { stopped = true; await Promise.allSettled(lanes); } };
}
