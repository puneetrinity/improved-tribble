import { createHash } from 'node:crypto';
import { z } from 'zod';
import { profileHash, profileRevision, profileUuid } from '../../shared/candidate-profile';
import type { FoundationDb } from './repository';
import { resumeSourceRetryRequestSchema, resumeSourceRetryStatusSchema } from '../../shared/candidate-spark-v3';
import { assertSourceSettledReservation, sourceScrubContextSchema, type PaidDependencies, type ReserveResult as P0ReserveResult, type SourceRepository } from './source-repository';

// Runtime validators for the promoted D-1 types in ./source-repository (P0-owned).
// Every routine result is re-validated here; a malformed row is never trusted as
// authority. A compile-time check below keeps these schemas assignable to D-1.

const id = profileUuid, hash = profileHash, rev = profileRevision;
const positive = z.number().int().positive().safe();
const strict = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict();

export const refusalSchema = z.enum(['budget_unavailable', 'privacy_changed', 'source_changed',
  'consent_changed', 'lease_lost', 'outcome_unknown', 'idempotency_conflict']);
export const sourceRefSchema = strict({ sourceId: id, sourceVersion: rev, contentHash: hash });
export const actorSchema = strict({ userId: positive, subjectId: id, bindingId: id });
export const leaseSchema = strict({ commandId: id, claimToken: id, generation: positive });
export const canonicalDocumentSchema = strict({ canonical: z.string().min(1), sha256: hash })
  .refine(d => createHash('sha256').update(d.canonical, 'utf8').digest('hex') === d.sha256, 'canonical_hash_mismatch');
export const paidLimitSchema = z.discriminatedUnion('kind', [
  strict({ kind: z.literal('ocr'), pageCount: z.number().int().min(1).max(10), totalPageCount: z.number().int().min(1).max(10),
    pageNumbers: z.array(z.number().int().min(1).max(10)).min(1).max(10), contentHash: hash }),
  strict({ kind: z.literal('semantic_model'), model: z.string().min(1).max(200), inputTokens: positive,
    maxOutputTokens: positive, textHash: hash }),
]).superRefine((l, ctx) => {
  if (l.kind === 'ocr' && !(l.pageCount === l.pageNumbers.length
    && l.pageNumbers.every((p, n) => p <= l.totalPageCount && (n === 0 || p > l.pageNumbers[n - 1]!))))
    ctx.addIssue({ code: 'custom', message: 'invalid_page_plan' });
});
const nullableCount = z.number().int().min(0).safe().nullable();
export const observedUsageSchema = z.discriminatedUnion('kind', [
  strict({ kind: z.literal('ocr'), pagesSubmitted: nullableCount, transportAttempts: nullableCount }),
  strict({ kind: z.literal('semantic_model'), inputTokens: nullableCount, outputTokens: nullableCount }),
]);
export const paidReceiptSchema = strict({ reservationId: id, dispatchId: id, operationKey: id,
  state: z.enum(['settled', 'held']), observedUsage: observedUsageSchema,
  reason: z.enum(['completed', 'provider_uncertain', 'usage_unknown', 'budget_breach', 'privacy_changed']) })
  .refine(r => (r.state === 'settled') === (r.reason === 'completed'), 'receipt_state_reason');
export const reservationSchema = strict({ reservationId: id, operationKey: id, limit: paidLimitSchema });
export const dispatchGrantSchema = strict({ reservationId: id, dispatchId: id, operationKey: id, source: sourceRefSchema,
  consentRevision: positive, limit: paidLimitSchema });
const settledResult = strict({ state: z.literal('settled'), receipt: paidReceiptSchema, result: canonicalDocumentSchema });
const refusedResult = strict({ state: z.literal('refused'), reason: refusalSchema });
// A settled reservation may carry reuseFor: P0's proof that an explicit retry may
// reuse its ancestor's completed OCR (RETRY-ADAPTER-1). It is checked below by
// P0's own assertSourceSettledReservation, never trusted on shape alone.
const reserveSettledResult = strict({ state: z.literal('settled'), receipt: paidReceiptSchema, result: canonicalDocumentSchema,
  reuseFor: canonicalDocumentSchema.optional() });
export const reserveResultSchema = z.discriminatedUnion('state', [
  strict({ state: z.literal('reserved'), reservation: reservationSchema }), reserveSettledResult, refusedResult]);
export const dispatchResultSchema = z.discriminatedUnion('state', [
  strict({ state: z.literal('dispatch'), grant: dispatchGrantSchema }), settledResult, refusedResult]);
export const releaseResultSchema = strict({ state: z.enum(['released', 'held', 'lease_lost']) });

export const snapshotSchema = strict({ schemaVersion: z.literal(1), sourceId: id, sourceVersion: rev, contentHash: hash });
export const sourceStatusSchema = strict({ commandId: id, sourceId: id, sourceVersion: rev,
  state: z.enum(['queued', 'extracting', 'building', 'transferring', 'review_ready', 'unavailable', 'held']),
  reason: z.union([refusalSchema, z.enum(['unsupported', 'empty', 'too_large', 'provider_refused'])]).nullable(),
  proposalId: id.nullable() })
  .refine(s => (s.state === 'review_ready') === (s.proposalId !== null), 'status_proposal');
export const ownedSourceSchema = strict({ source: sourceRefSchema, byteLength: z.number().int().min(1).max(5 * 1024 * 1024),
  mediaType: z.enum(['application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document']),
  policyVersion: z.string().min(1).max(80), objectHandle: id });
/** Internal-only current verified account email, for the local scrubber alone. Never
 * persisted, sent to AI/Memory, logged or returned to a browser (SCRUB_CONTEXT_ADDENDUM).
 * The P0 validator is the single definition. */
export const scrubContextSchema = sourceScrubContextSchema;
export const sourceClaimSchema = strict({ lease: leaseSchema, actor: actorSchema, source: ownedSourceSchema,
  consentRevision: positive, scrubContext: scrubContextSchema, originalDraftVersion: rev, originalProfileVersion: rev,
  originalPreferenceVersion: rev, originalPreferenceDraftRevision: rev });

export type Refusal = z.infer<typeof refusalSchema>;
export type SourceRef = z.infer<typeof sourceRefSchema>;
export type Actor = z.infer<typeof actorSchema>;
export type Lease = z.infer<typeof leaseSchema>;
export type CanonicalDocument = z.infer<typeof canonicalDocumentSchema>;
export type PaidLimit = z.infer<typeof paidLimitSchema>;
export type ObservedUsage = z.infer<typeof observedUsageSchema>;
export type PaidReceipt = z.infer<typeof paidReceiptSchema>;
export type DispatchGrant = z.infer<typeof dispatchGrantSchema>;
export type ReserveResult = z.infer<typeof reserveResultSchema>;
export type DispatchResult = z.infer<typeof dispatchResultSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export type SourceStatus = z.infer<typeof sourceStatusSchema>;
export type OwnedSource = z.infer<typeof ownedSourceSchema>;
export type SourceClaim = z.infer<typeof sourceClaimSchema>;
export type FailReason = Exclude<SourceStatus['reason'], null>;

export const snapshotRequestSchema = strict({ schemaVersion: z.literal(1), idempotencyKey: id, resumeId: positive });
export const queueRequestSchema = strict({ schemaVersion: z.literal(1), idempotencyKey: id, sourceId: id, sourceVersion: rev });
export const reserveRequestSchema = strict({ schemaVersion: z.literal(1), lease: leaseSchema, source: sourceRefSchema,
  consentRevision: positive, operationKey: id, limit: paidLimitSchema });
export const dispatchRequestSchema = strict({ lease: leaseSchema, reservationId: id });
export const settleRequestSchema = strict({ lease: leaseSchema, grant: dispatchGrantSchema, observedUsage: observedUsageSchema,
  result: canonicalDocumentSchema })
  .refine(r => r.grant.limit.kind === r.observedUsage.kind, 'usage_kind');
export const holdRequestSchema = strict({ lease: leaseSchema, grant: dispatchGrantSchema, observedUsage: observedUsageSchema,
  reason: z.enum(['provider_uncertain', 'usage_unknown', 'budget_breach', 'privacy_changed']) })
  .refine(r => r.grant.limit.kind === r.observedUsage.kind, 'usage_kind');
const failReasonSchema = z.union([refusalSchema, z.enum(['unsupported', 'empty', 'too_large', 'provider_refused'])]);

export class ResumeSourceRepositoryError extends Error {
  constructor(public readonly code: string, public readonly status: number) { super(code); }
}
// SQLSTATE and the routine's exact safe marker must both match (same convention as the
// existing foundation/profile repositories). Anything else is authority_unavailable/503
// and a raw database message is never exposed.
const knownErrors: Readonly<Record<string, readonly [string, number]>> = {
  not_found: ['P0002', 404], idempotency_conflict: ['23505', 409], invalid_request: ['22023', 422],
  source_changed: ['40001', 409], consent_changed: ['42501', 409], lease_lost: ['40001', 409],
  privacy_changed: ['42501', 451], candidate_privacy_restricted: ['42501', 451],
};

/** Parameterised calls to the 14 frozen P0 routines (p2-dependencies `sql`). P2 issues
 * no DDL and no table writes. Actor is trusted server/session context, never browser input. */
export function resumeSourceRepository(db: FoundationDb, privacy: (userId: number) => Promise<void>) {
  async function call<T>(fn: string, args: unknown[], schema: z.ZodType<T>, nullable = false): Promise<T | null> {
    const placeholders = args.map((_, i) => `$${i + 1}`).join(',');
    let row: unknown;
    try {
      const result = await db.query(`SELECT public.${fn}(${placeholders}) AS result`, args);
      if (result.rows.length !== 1) throw Error('invalid_result');
      row = result.rows[0]!.result;
    } catch (error) {
      const e = error as { code?: unknown; message?: unknown };
      const found = typeof e.message === 'string' ? knownErrors[e.message] : undefined;
      if (found && found[0] === e.code) throw new ResumeSourceRepositoryError(e.message as string, found[1]);
      throw new ResumeSourceRepositoryError('authority_unavailable', 503);
    }
    if (row === null && nullable) return null;
    const parsed = schema.safeParse(row);
    if (!parsed.success) throw new ResumeSourceRepositoryError('authority_unavailable', 503);
    return parsed.data;
  }
  const json = (value: unknown) => JSON.stringify(value);
  const one = async <T>(fn: string, args: unknown[], schema: z.ZodType<T>) => (await call(fn, args, schema)) as T;
  async function owner(actor: Actor) { const a = actorSchema.parse(actor); await privacy(a.userId); return a; }
  const parseOr422 = <T>(schema: z.ZodType<T>, value: unknown): T => {
    const r = schema.safeParse(value); if (!r.success) throw new ResumeSourceRepositoryError('invalid_request', 422); return r.data;
  };
  const sameLease = (a: Lease, b: Lease) => a.commandId === b.commandId && a.claimToken === b.claimToken && a.generation === b.generation;
  const sameRef = (a: SourceRef, b: SourceRef) => a.sourceId === b.sourceId && a.sourceVersion === b.sourceVersion && a.contentHash === b.contentHash;

  return {
    async snapshot(actor: Actor, request: unknown): Promise<Snapshot> {
      const a = await owner(actor); const r = parseOr422(snapshotRequestSchema, request);
      return one('flow_candidate_source_snapshot', [a.userId, json(r)], snapshotSchema);
    },
    async resolve(actor: Actor, source: SourceRef): Promise<OwnedSource> {
      const a = await owner(actor); const s = parseOr422(sourceRefSchema, source);
      const owned = await one('flow_candidate_source_resolve', [a.userId, json(s)], ownedSourceSchema);
      if (!sameRef(owned.source, s)) throw new ResumeSourceRepositoryError('authority_unavailable', 503);
      return owned;
    },
    async enqueue(actor: Actor, request: unknown): Promise<SourceStatus> {
      const a = await owner(actor); const r = parseOr422(queueRequestSchema, request);
      const status = await one('flow_candidate_source_enqueue', [a.userId, json(r)], sourceStatusSchema);
      if (status.sourceId !== r.sourceId || status.sourceVersion !== r.sourceVersion) throw new ResumeSourceRepositoryError('authority_unavailable', 503);
      return status;
    },
    async status(actor: Actor, commandId: string): Promise<SourceStatus> {
      const a = await owner(actor); const c = parseOr422(id, commandId);
      const status = await one('flow_candidate_source_status', [a.userId, c], sourceStatusSchema);
      if (status.commandId !== c) throw new ResumeSourceRepositoryError('authority_unavailable', 503);
      return status;
    },
    async claim(workerId: string): Promise<SourceClaim | null> {
      return call('flow_candidate_source_claim', [id.parse(workerId)], sourceClaimSchema, true);
    },
    async prepare(lease: Lease): Promise<SourceClaim | null> {
      const l = leaseSchema.parse(lease);
      const claim = await call('flow_candidate_source_prepare', [json(l)], sourceClaimSchema, true);
      if (claim === null) return null;
      if (!sameLease(claim.lease, l)) throw new ResumeSourceRepositoryError('authority_unavailable', 503);
      await privacy(claim.actor.userId);
      return claim;
    },
    async persistTransfer(lease: Lease, transfer: CanonicalDocument): Promise<SourceStatus> {
      return one('flow_candidate_source_transfer_store', [json(leaseSchema.parse(lease)), json(canonicalDocumentSchema.parse(transfer))], sourceStatusSchema);
    },
    async settleTransfer(lease: Lease, receipt: CanonicalDocument): Promise<SourceStatus> {
      return one('flow_candidate_source_transfer_finish', [json(leaseSchema.parse(lease)), json(canonicalDocumentSchema.parse(receipt))], sourceStatusSchema);
    },
    async fail(lease: Lease, reason: FailReason): Promise<SourceStatus> {
      return one('flow_candidate_source_fail', [json(leaseSchema.parse(lease)), failReasonSchema.parse(reason)], sourceStatusSchema);
    },
    // PaidDependencies. A reservation/dispatch whose response does not echo the request's
    // identity is a lost/malformed grant: never treated as usable and never auto-released.
    async reserve(request: unknown): Promise<P0ReserveResult> {
      const r = reserveRequestSchema.parse(request);
      const result = await one('flow_candidate_source_paid_reserve', [json(r)], reserveResultSchema);
      if (result.state === 'reserved' && (result.reservation.operationKey !== r.operationKey
        || json(result.reservation.limit) !== json(r.limit))) throw new ResumeSourceRepositoryError('outcome_unknown', 503);
      if (result.state === 'settled') {
        // Same key: the original receipt, no reuse proof allowed. Different key: only an
        // ancestor's completed OCR with an exact current-request proof. Anything else
        // (including semantic reuse) is a malformed grant.
        const settled: Extract<P0ReserveResult, { state: 'settled' }> = result.reuseFor === undefined
          ? { state: 'settled', receipt: result.receipt, result: result.result }
          : { state: 'settled', receipt: result.receipt, result: result.result, reuseFor: result.reuseFor };
        try { assertSourceSettledReservation(r as never, settled); }
        catch { throw new ResumeSourceRepositoryError('outcome_unknown', 503); }
        return settled;
      }
      return result;
    },
    async beginDispatch(request: unknown): Promise<DispatchResult> {
      const r = dispatchRequestSchema.parse(request);
      const result = await one('flow_candidate_source_paid_dispatch', [json(r)], dispatchResultSchema);
      if (result.state === 'dispatch' && result.grant.reservationId !== r.reservationId)
        throw new ResumeSourceRepositoryError('outcome_unknown', 503);
      return result;
    },
    async settle(request: unknown): Promise<PaidReceipt> {
      const r = settleRequestSchema.parse(request);
      const receipt = await one('flow_candidate_source_paid_settle', [json(r)], paidReceiptSchema);
      if (receipt.dispatchId !== r.grant.dispatchId || receipt.reservationId !== r.grant.reservationId) throw new ResumeSourceRepositoryError('outcome_unknown', 503);
      return receipt;
    },
    async hold(request: unknown): Promise<PaidReceipt> {
      const r = holdRequestSchema.parse(request);
      const receipt = await one('flow_candidate_source_paid_hold', [json(r)], paidReceiptSchema);
      if (receipt.dispatchId !== r.grant.dispatchId || receipt.reservationId !== r.grant.reservationId) throw new ResumeSourceRepositoryError('outcome_unknown', 503);
      return receipt;
    },
    async releaseUnsent(request: unknown): Promise<{ state: 'released' | 'held' | 'lease_lost' }> {
      return one('flow_candidate_source_paid_release_unsent', [json(dispatchRequestSchema.parse(request))], releaseResultSchema);
    },
    // Explicit candidate "Try again" (user decision: no automatic retry, 3 attempts per
    // résumé file). One successor per idempotency key; the database enforces the cap.
    async retry(actor: Actor, request: unknown): Promise<SourceStatus> {
      const a = await owner(actor); const r = parseOr422(resumeSourceRetryRequestSchema, request);
      const status = await one('flow_candidate_source_retry', [a.userId, json(r)], sourceStatusSchema);
      if (status.commandId === r.retryOfCommandId) throw new ResumeSourceRepositoryError('authority_unavailable', 503);
      return status;
    },
    async retryStatus(actor: Actor, commandId: string): Promise<z.infer<typeof resumeSourceRetryStatusSchema>> {
      const a = await owner(actor); const c = parseOr422(id, commandId);
      const status = await one('flow_candidate_source_retry_status', [a.userId, c], resumeSourceRetryStatusSchema);
      if (status.commandId !== c) throw new ResumeSourceRepositoryError('authority_unavailable', 503);
      return status;
    },
  };
}
// Compile-time proof that the runtime validators conform to the promoted D-1 interfaces.
type _Conforms = [ReturnType<typeof resumeSourceRepository> extends SourceRepository & PaidDependencies ? true : never];
const _conforms: _Conforms = [true];
void _conforms;
export type ResumeSourceRepository = ReturnType<typeof resumeSourceRepository>;
