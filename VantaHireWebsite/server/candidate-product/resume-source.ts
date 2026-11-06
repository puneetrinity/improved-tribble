import { createHash } from 'node:crypto';
import { z } from 'zod';
import { profileHash, profileRevision, profileUuid, scalarString } from '../../shared/candidate-profile';
import type { DispatchGrant, ObservedUsage, OcrGateRequest, OcrGateResult, PaidLimit, SourceRef } from './source-repository';
import {
  extractResumeForOrdinaryIngest,
  type ResumeIngestExtractionReasonCode,
  type ResumeIngestExtractionResult,
} from '../lib/resumeIngestExtraction';

// P2 resume extraction adapter. Wraps the shared Flow extractor around one
// immutable, owner-resolved source snapshot. PDFs are analysed per page by the
// shared reader; only pages with no native text are OCR'd, through the durable
// paid gate, and a profile suggestion requires a complete extraction
// (OCR_PAGE_SELECTION_AMENDMENT). It never fetches bytes, never writes profile
// facts and never retries OCR. Seam: contracts.mjs extractionInput/Output and the
// promoted D-1 types in ./source-repository (lock review D1-c).

export const RESUME_MAX_BYTES = 5 * 1024 * 1024;
export const RESUME_MAX_TEXT_BYTES = 512 * 1024;
export const RESUME_OCR_MAX_PAGES = 10;

type UUID = string;
export type { SourceRef, OcrGateRequest, OcrGateResult } from './source-repository';
type OcrLimit = Extract<PaidLimit, { kind: 'ocr' }>;
export type OcrDispatchGrant = DispatchGrant & { limit: OcrLimit };
export type OcrObservedUsage = Extract<ObservedUsage, { kind: 'ocr' }>;

// The shared reader's page plan, taken from its own signature so P2 never imports a provider client.
type PdfOcrPlan = NonNullable<Parameters<Parameters<typeof extractResumeForOrdinaryIngest>[1]['beforeOcr']>[0]>;

const policyVersion = z.string().min(1).max(80).refine(scalarString);
const mediaType = z.enum([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

export const resumeExtractionInputSchema = z.object({
  schemaVersion: z.literal(1),
  sourceId: profileUuid,
  sourceVersion: profileRevision,
  contentHash: profileHash,
  byteLength: z.number().int().min(1).max(RESUME_MAX_BYTES),
  mediaType,
  policyVersion,
}).strict();
export type ResumeExtractionInput = z.infer<typeof resumeExtractionInputSchema>;

export type ResumeUnavailableReason =
  | 'unsupported' | 'empty' | 'too_large' | 'privacy_changed' | 'source_changed'
  | 'budget_unavailable' | 'provider_uncertain' | 'provider_refused';

type Identity = Pick<ResumeExtractionInput, 'schemaVersion' | 'sourceId' | 'sourceVersion' | 'contentHash' | 'policyVersion'>;
export type ResumeExtractionOutput =
  | (Identity & { status: 'extracted'; text: string; textHash: string;
      method: 'native_text' | 'google_vision_ocr'; providerCalls: 0 | 1 })
  | (Identity & { status: 'unavailable'; reason: ResumeUnavailableReason });

/** What happened to the paid OCR slot. The processor MUST act on every
 * non-`not_requested` value: settle or hold a dispatched grant, or ask the
 * repository to releaseUnsent an unusable grant. The adapter never does it. */
export type ResumeOcrAttempt =
  | { state: 'not_requested' }
  | { state: 'refused' }
  | { state: 'invalid_grant'; reservationId: UUID | null }
  | { state: 'dispatched'; grant: OcrDispatchGrant; observedUsage: OcrObservedUsage;
      disposition: 'settle' | 'hold'; holdReason: 'provider_uncertain' | 'usage_unknown' | null };

export interface ResumeExtractionDependencies {
  /** Durable gate (P0): rechecks authority and completes reserve+beginDispatch
   * before granted:true. Called at most once per invocation. */
  beforeOcr: (request: OcrGateRequest) => Promise<OcrGateResult>;
  /** Contact values known to belong to the candidate (verified account email).
   * Scrubbed unconditionally in addition to pattern matches. */
  knownContacts?: readonly string[];
  extract?: (buffer: Buffer, options: { beforeOcr: (plan?: PdfOcrPlan) => Promise<void>; requireComplete: true }) => Promise<ResumeIngestExtractionResult>;
}

class OcrNotGranted extends Error {
  constructor(public readonly reason: ResumeUnavailableReason) { super('ocr_not_granted'); }
}

function sniffMatches(buffer: Buffer, type: ResumeExtractionInput['mediaType']): boolean {
  const head = buffer.subarray(0, 8).toString('hex');
  if (type === 'application/pdf') return buffer.subarray(0, Math.min(buffer.length, 1024)).includes(Buffer.from('%PDF-'));
  if (type === 'application/msword') return head.startsWith('d0cf11e0a1b11ae1');
  return head.startsWith('504b0304');
}

// Replace lone surrogates so the text is a valid scalar string.
function wellFormed(text: string): string {
  return text.replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '�');
}

const CONTACT_MARK = '[contact removed]';
// Every repeat is bounded so matching stays linear on 512 KiB inputs (no ReDoS).
const SEP = String.raw`\s{0,3}`;
const EMAIL = new RegExp(String.raw`[A-Za-z0-9._%+-]{1,64}(?:@|${SEP}[([]${SEP}at${SEP}[)\]]${SEP})`
  + String.raw`(?:[A-Za-z0-9-]{1,63}(?:\.|${SEP}[([]${SEP}dot${SEP}[)\]]${SEP})){1,8}[A-Za-z]{2,24}`, 'giu');
const LABELLED = /\b(?:phone|mobile|mob|cell|tel|telephone|whatsapp|contact(?:\s{1,3}(?:no|number))?|ph)\b\.?\s{0,3}(?:no\.?|number|#)?\s{0,3}[:\-–]?\s{0,3}\+?[\d(][\d\s().\-–/]{5,30}\d/giu;
const DIGIT_RUN = /\+?\(?\d[\d\s().\-–]{5,24}\d/gu;

function looksLikePhone(candidate: string, before: string, after: string): boolean {
  const digits = candidate.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return false;
  if (/[$€£₹%]/u.test(before.slice(-1)) || /^\s*(?:%|k\b|m\b|bn\b|million|billion|users|tps|ms\b)/iu.test(after)) return false;
  if (/^\s*(?:19|20)\d{2}\s*[-–]\s*(?:(?:19|20)\d{2}|present|current)/iu.test(candidate)) return false;
  // Two or more years separated only by spaces/dashes/slashes: date ranges, not phones.
  if (/^(?:\s*(?:19|20)\d{2}\s*[-–/]?)+$/u.test(candidate)) return false;
  if (/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/u.test(candidate.trim())) return false;
  return candidate.startsWith('+') || /[\s().\-–]/u.test(candidate) || digits.length >= 10;
}

/** Unconditional contact scrub for the AI/Memory copy (independent of
 * AI_STRIP_PII). Pattern matching cannot catch every obfuscation; it removes
 * known values, email forms and phone-shaped numbers, and keeps dates and metrics. */
// Identifiers and ISO dates are never contact data. They are set aside before
// scrubbing so digit runs inside UUIDs, SHA-256 hashes and ISO date-times are not
// mistaken for phone numbers (B1: corrupted IDs; B4: lost RC dates).
const PROTECTED = new RegExp([
  String.raw`(?<![0-9A-Za-z])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![0-9A-Za-z])`,
  String.raw`(?<![0-9A-Za-z])[0-9a-f]{64}(?![0-9A-Za-z])`,
  String.raw`(?<![0-9A-Za-z])(?:19|20)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])`
    + String.raw`(?:T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)?)?(?![0-9A-Za-z])`,
].join('|'), 'giu');
const HOLD_OPEN = '\uE000', HOLD_CLOSE = '\uE001';
const holdKey = (index: number): string => { let n = index, key = ''; do { key = String.fromCharCode(97 + (n % 26)) + key; n = Math.floor(n / 26); } while (n > 0); return key; };

export function scrubResumeContacts(text: string, knownContacts: readonly string[] = []): string {
  const held: string[] = [];
  const canHold = !text.includes(HOLD_OPEN) && !text.includes(HOLD_CLOSE);
  // Emails first, so an address can never hide behind a protected token.
  let out = text.replace(EMAIL, CONTACT_MARK);
  if (canHold) out = out.replace(PROTECTED, (m) => `${HOLD_OPEN}${holdKey(held.push(m) - 1)}${HOLD_CLOSE}`);
  for (const value of knownContacts) {
    const v = value.trim();
    if (v.length >= 3) out = out.split(new RegExp(v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu')).join(CONTACT_MARK);
  }
  out = out.replace(EMAIL, CONTACT_MARK);
  out = out.replace(LABELLED, (m) => {
    const label = /^[^\d+(]*/u.exec(m)?.[0] ?? '';
    return `${label}${CONTACT_MARK}`;
  });
  out = out.replace(DIGIT_RUN, (m, offset: number, whole: string) =>
    looksLikePhone(m, whole.slice(Math.max(0, offset - 2), offset), whole.slice(offset + m.length, offset + m.length + 12)) ? CONTACT_MARK : m);
  if (held.length) {
    const restore = new RegExp(`${HOLD_OPEN}([a-z]{1,8})${HOLD_CLOSE}`, 'gu');
    out = out.replace(restore, (m, key: string) => {
      let index = 0; for (const c of key) index = index * 26 + (c.charCodeAt(0) - 97);
      return held[index] ?? m;
    });
  }
  return out;
}

function failureReason(code: ResumeIngestExtractionReasonCode | undefined, ocrDispatched: boolean): ResumeUnavailableReason {
  switch (code) {
    case 'NATIVE_UNSUPPORTED_FOR_OCR': return 'unsupported';
    case 'NO_EXTRACTABLE_TEXT': return 'empty';
    case 'OCR_PAGE_COUNT_REFUSED': return 'unsupported';
    case 'OCR_PAGE_CEILING_REFUSED': return 'too_large';
    case 'OCR_DISABLED':
    case 'OCR_NOT_CONFIGURED': return 'budget_unavailable';
    case 'OCR_AUTH_REFUSED': return 'provider_refused';
    case 'OCR_TIMEOUT':
    case 'OCR_PROVIDER_REFUSED':
    case 'OCR_OUTPUT_REFUSED': return 'provider_uncertain';
    default: return ocrDispatched ? 'provider_uncertain' : 'unsupported';
  }
}

function sameGrant(grant: unknown, source: SourceRef, request: OcrGateRequest): grant is OcrDispatchGrant {
  const g = grant as OcrDispatchGrant | null;
  return !!g && profileUuid.safeParse(g.reservationId).success && profileUuid.safeParse(g.dispatchId).success
    && profileUuid.safeParse(g.operationKey).success && Number.isSafeInteger(g.consentRevision) && g.consentRevision > 0
    && g.source?.sourceId === source.sourceId && g.source?.sourceVersion === source.sourceVersion
    && g.source?.contentHash === source.contentHash && g.limit?.kind === 'ocr'
    && g.limit.pageCount === request.pageCount && g.limit.totalPageCount === request.totalPageCount
    && Array.isArray(g.limit.pageNumbers) && g.limit.pageNumbers.length === request.pageNumbers.length
    && g.limit.pageNumbers.every((p, i) => p === request.pageNumbers[i]) && g.limit.contentHash === source.contentHash;
}

/** The shared analyser's selected-page plan, re-proved against the exact bytes:
 * one-based, strictly increasing, within a <=10-page document. Never browser- or model-chosen. */
function gateRequestFromPlan(plan: unknown, source: SourceRef): OcrGateRequest {
  const p = plan as PdfOcrPlan | undefined;
  if (!p || typeof p !== 'object' || p.schemaVersion !== 1 || !Array.isArray(p.pageNumbers)) throw new OcrNotGranted('unsupported');
  if (p.contentHash !== source.contentHash) throw new OcrNotGranted('source_changed');
  if (!Number.isSafeInteger(p.totalPages) || p.totalPages < 1) throw new OcrNotGranted('unsupported');
  if (p.totalPages > RESUME_OCR_MAX_PAGES) throw new OcrNotGranted('too_large');
  const pages = [...p.pageNumbers];
  if (pages.length < 1 || pages.some((n, i) => !Number.isSafeInteger(n) || n < 1 || n > p.totalPages || (i > 0 && n <= pages[i - 1]!)))
    throw new OcrNotGranted('unsupported');
  return { source, pageCount: pages.length, totalPageCount: p.totalPages, pageNumbers: pages };
}

export async function extractResumeSource(
  rawInput: unknown,
  bytes: Buffer,
  dependencies: ResumeExtractionDependencies,
): Promise<{ output: ResumeExtractionOutput; ocr: ResumeOcrAttempt }> {
  const input = resumeExtractionInputSchema.parse(rawInput);
  const identity: Identity = {
    schemaVersion: 1, sourceId: input.sourceId, sourceVersion: input.sourceVersion,
    contentHash: input.contentHash, policyVersion: input.policyVersion,
  };
  const source: SourceRef = { sourceId: input.sourceId, sourceVersion: input.sourceVersion, contentHash: input.contentHash };
  const slot: { ocr: ResumeOcrAttempt } = { ocr: { state: 'not_requested' } };
  const gate: { request: OcrGateRequest | null } = { request: null };
  const done = (output: ResumeExtractionOutput) => ({ output, ocr: slot.ocr });
  const unavailable = (reason: ResumeUnavailableReason) => done({ ...identity, status: 'unavailable', reason });

  // The bytes must be exactly the selected immutable snapshot.
  if (!Buffer.isBuffer(bytes) || bytes.length !== input.byteLength
      || createHash('sha256').update(bytes).digest('hex') !== input.contentHash) return unavailable('source_changed');
  if (!sniffMatches(bytes, input.mediaType)) return unavailable('unsupported');

  let gateCalls = 0;
  const beforeOcr = async (plan?: PdfOcrPlan) => {
    if (++gateCalls > 1) throw new OcrNotGranted('provider_uncertain');
    const request = gateRequestFromPlan(plan, source);
    gate.request = request;
    let decision: OcrGateResult;
    try { decision = await dependencies.beforeOcr(request); }
    catch { slot.ocr = { state: 'invalid_grant', reservationId: null }; throw new OcrNotGranted('provider_uncertain'); }
    if (decision?.granted === false) {
      slot.ocr = { state: 'refused' };
      const allowed = ['budget_unavailable', 'privacy_changed', 'source_changed', 'provider_uncertain'] as const;
      throw new OcrNotGranted((allowed as readonly string[]).includes(decision.reason) ? decision.reason : 'provider_uncertain');
    }
    if (decision?.granted !== true || !sameGrant(decision.grant, source, request)) {
      const id = (decision as { grant?: { reservationId?: unknown } })?.grant?.reservationId;
      slot.ocr = { state: 'invalid_grant', reservationId: profileUuid.safeParse(id).success ? id as string : null };
      throw new OcrNotGranted('provider_uncertain');
    }
    slot.ocr = { state: 'dispatched', grant: decision.grant,
      observedUsage: { kind: 'ocr', pagesSubmitted: null, transportAttempts: null }, disposition: 'hold', holdReason: 'provider_uncertain' };
  };

  let result: ResumeIngestExtractionResult;
  try {
    result = await (dependencies.extract ?? extractResumeForOrdinaryIngest)(bytes, { beforeOcr, requireComplete: true });
  } catch (error) {
    if (error instanceof OcrNotGranted) return unavailable(error.reason);
    return unavailable(slot.ocr.state === 'dispatched' ? 'provider_uncertain' : 'unsupported');
  }

  if (slot.ocr.state === 'dispatched') {
    const attempts = Number.isSafeInteger(result.providerCalls) ? result.providerCalls : null;
    // A completed OCR reply (text, or empty/invalid text) is charged for every
    // reserved page. Any other outcome is uncertain: hold, never imply zero.
    const completed = result.success || result.reasonCode === 'NO_EXTRACTABLE_TEXT';
    slot.ocr = completed
      ? { ...slot.ocr, observedUsage: { kind: 'ocr', pagesSubmitted: gate.request!.pageCount, transportAttempts: attempts }, disposition: 'settle', holdReason: null }
      : { ...slot.ocr, observedUsage: { kind: 'ocr', pagesSubmitted: null, transportAttempts: attempts }, disposition: 'hold',
          holdReason: attempts === 0 ? 'usage_unknown' : 'provider_uncertain' };
  } else if (result.method === 'google_vision_ocr') {
    return unavailable('provider_uncertain');
  }

  if (!result.success) return unavailable(failureReason(result.reasonCode, slot.ocr.state === 'dispatched'));
  // A partly read résumé never becomes profile suggestions (user decision 30 Oct).
  if (result.partial) return unavailable(slot.ocr.state === 'dispatched' ? 'provider_uncertain' : 'unsupported');
  if (result.method !== 'native_text' && result.method !== 'google_vision_ocr') return unavailable('empty');

  const text = scrubResumeContacts(wellFormed(result.text), dependencies.knownContacts ?? []);
  if (text.trim().length === 0) return unavailable('empty');
  if (Buffer.byteLength(text, 'utf8') > RESUME_MAX_TEXT_BYTES) return unavailable('too_large');

  // providerCalls is the deprecated operation counter (native 0, OCR 1); billing
  // uses the grant's pageCount and observedUsage (lock S-1).
  return done({
    ...identity, status: 'extracted', text,
    textHash: createHash('sha256').update(text, 'utf8').digest('hex'),
    method: result.method, providerCalls: result.method === 'google_vision_ocr' ? 1 : 0,
  });
}
