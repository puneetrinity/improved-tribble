import { z } from 'zod';
import { createHash } from 'node:crypto';
import { canonicalProfileJson } from './profile-contracts';
import type { FoundationDb } from './repository';
import type {readCandidateResumeBlob} from '../gcs-storage';
import type {readSparkProfile} from './profile-client';
import type {extractResumeSource} from './resume-source';
import {lookupRequestSchema,lookupStatusSchema} from '../../shared/candidate-spark-v3';
import {lookupOperationSchema,lookupResultSchema,type LookupResult} from './source-contracts';
import type {LookupDispatch} from './source-processor';
import {parseLookupTransfer,validateSourceReceipt} from './spark-contracts';
export {resumeSourceRetryRequestSchema as sourceRetryRequestSchema,resumeSourceRetryStatusSchema as sourceRetryStatusSchema} from '../../shared/candidate-spark-v3';

/** D-1 service-only interfaces promoted from the reviewed design contract.
 * Declarations, scrub-context validation and SQL names: not an implemented SQL repository.
 * P0 implements durable repositories; P2 injects these into its Flow modules.
 * UUID/hash/string numbers must also pass runtime validators at every boundary.
 */
export type UUID = string;
export type SHA256 = string;
export interface SourceRef { sourceId: UUID; sourceVersion: number; contentHash: SHA256 }
export interface Actor { userId: number; subjectId: UUID; bindingId: UUID }
export interface Lease { commandId: UUID; claimToken: UUID; generation: number }
export interface CanonicalDocument { canonical: string; sha256: SHA256 }
export type Refusal = 'budget_unavailable' | 'privacy_changed' | 'source_changed' |
  'consent_changed' | 'lease_lost' | 'outcome_unknown' | 'idempotency_conflict';
export type PaidLimit =
  | { kind: 'ocr'; pageCount: number; totalPageCount: number; pageNumbers: readonly number[]; contentHash: SHA256 }
  | { kind: 'semantic_model'; model: string; inputTokens: number; maxOutputTokens: number; textHash: SHA256 };
export interface ReserveRequest {
  schemaVersion: 1; lease: Lease; source: SourceRef; consentRevision: number;
  operationKey: UUID; limit: PaidLimit;
}
const sourceUuid = z.string().uuid();
const sourceHash = z.string().regex(/^[a-f0-9]{64}$/);
const positiveInteger = z.number().int().positive().safe();
const paidReserveSchema = z.object({
  schemaVersion: z.literal(1),
  lease: z.object({commandId: sourceUuid, claimToken: sourceUuid, generation: positiveInteger}).strict(),
  source: z.object({sourceId: sourceUuid, sourceVersion: positiveInteger, contentHash: sourceHash}).strict(),
  consentRevision: positiveInteger,
  operationKey: sourceUuid,
  limit: z.discriminatedUnion('kind', [
    z.object({kind: z.literal('ocr'), pageCount: positiveInteger.max(10), totalPageCount:positiveInteger.max(10),
      pageNumbers:z.array(positiveInteger.max(10)).min(1).max(10),contentHash: sourceHash}).strict(),
    z.object({kind: z.literal('semantic_model'), model: z.string().min(1).max(200),
      inputTokens: positiveInteger, maxOutputTokens: positiveInteger, textHash: sourceHash}).strict(),
  ]),
}).strict();

/** Immutable purchase identity, not worker ownership. A recovery lease is allowed
 * to change; the database must separately validate its current token/generation.
 * Never include raw account contacts or source text in this identity or errors.
 * SQL must independently enforce these same fields before returning any cached
 * paid result; this helper alone is not the durable authority. */
export function sourcePaidRequestIdentity(input: unknown): CanonicalDocument {
  const parsed = paidReserveSchema.safeParse(input);
  if (!parsed.success) throw new Error('invalid_request');
  const request = parsed.data;
  if (request.limit.kind === 'ocr' && request.limit.contentHash !== request.source.contentHash)
    throw new Error('source_changed');
  const limit=request.limit;
  if(limit.kind==='ocr'&&(limit.pageCount!==limit.pageNumbers.length
    ||limit.pageNumbers.some((p,i)=>p>limit.totalPageCount||(i>0&&p<=limit.pageNumbers[i-1]!))))
    throw new Error('invalid_request');
  const canonical = canonicalProfileJson({schemaVersion: request.schemaVersion,
    commandId: request.lease.commandId, source: request.source,
    consentRevision: request.consentRevision, operationKey: request.operationKey, limit: request.limit});
  return {canonical, sha256: createHash('sha256').update(canonical, 'utf8').digest('hex')};
}

/** Check before returning an old reservation or result, including a settled one. */
export function assertSourcePaidReplay(stored: unknown, incoming: unknown): void {
  if (sourcePaidRequestIdentity(stored).canonical !== sourcePaidRequestIdentity(incoming).canonical)
    throw new Error('idempotency_conflict');
}
export interface Reservation { reservationId: UUID; operationKey: UUID; limit: PaidLimit }
export type ReserveResult =
  | { state: 'reserved'; reservation: Reservation }
  | { state: 'settled'; receipt: PaidReceipt; result: CanonicalDocument; reuseFor?: CanonicalDocument }
  | { state: 'refused'; reason: Refusal };
/** Validate a settled reserve response AFTER the adapter's strict response schema.
 * The old purchase receipt is immutable. Only SQL's ancestry-checked OCR reuse
 * may bind it to a different attempt. This is not permission to dispatch again.
 */
export function assertSourceSettledReservation(request: ReserveRequest,
  response: Extract<ReserveResult, {state:'settled'}>): void {
  const expected=sourcePaidRequestIdentity(request);
  if(response.receipt.state!=='settled'||response.receipt.reason!=='completed')
    throw new Error('outcome_unknown');
  const proof=response.reuseFor;
  if(proof && (proof.canonical!==expected.canonical||proof.sha256!==expected.sha256))
    throw new Error('outcome_unknown');
  if(response.receipt.operationKey===request.operationKey){
    if(proof)throw new Error('outcome_unknown');
    return;
  }
  if(request.limit.kind!=='ocr'||response.receipt.observedUsage.kind!=='ocr'||!proof)
    throw new Error('outcome_unknown');
}
export interface DispatchRequest { lease: Lease; reservationId: UUID }
export interface DispatchGrant {
  reservationId: UUID; dispatchId: UUID; operationKey: UUID; source: SourceRef;
  consentRevision: number; limit: PaidLimit;
}
export type DispatchResult =
  | { state: 'dispatch'; grant: DispatchGrant }
  | { state: 'settled'; receipt: PaidReceipt; result: CanonicalDocument }
  | { state: 'refused'; reason: Refusal };
/** OCR's old HTTP counter includes token acquisition and is NOT usage evidence.
 * A completed operation charges conservatively all reserved pages. On uncertainty,
 * pagesSubmitted=null retains the whole reservation, never implies zero pages.
 */
export type ObservedUsage =
  | { kind: 'ocr'; pagesSubmitted: number | null; transportAttempts: number | null }
  | { kind: 'semantic_model'; inputTokens: number | null; outputTokens: number | null };
export interface PaidReceipt {
  reservationId: UUID; dispatchId: UUID; operationKey: UUID;
  state: 'settled' | 'held'; observedUsage: ObservedUsage;
  reason: 'completed' | 'provider_uncertain' | 'usage_unknown' | 'budget_breach' | 'privacy_changed';
}
export interface SettleRequest {
  lease: Lease; grant: DispatchGrant; observedUsage: ObservedUsage;
  /** Validated extractionOutput or semantic sourceProposal; atomic with usage.
   * OCR text here is a temporary private Flow payload, not a Memory publication.
   */
  result: CanonicalDocument;
}
export interface HoldRequest {
  lease: Lease; grant: DispatchGrant; observedUsage: ObservedUsage;
  reason: 'provider_uncertain' | 'usage_unknown' | 'budget_breach' | 'privacy_changed';
}
export interface PaidDependencies {
  reserve(request: ReserveRequest): Promise<ReserveResult>;
  beginDispatch(request: DispatchRequest): Promise<DispatchResult>;
  settle(request: SettleRequest): Promise<PaidReceipt>;
  hold(request: HoldRequest): Promise<PaidReceipt>;
  /** Only an undispatched reserved slot can release. A dispatched/unknown slot
   * never releases automatically, including malformed/lost grant responses. */
  releaseUnsent(request: DispatchRequest): Promise<{ state: 'released' | 'held' | 'lease_lost' }>;
}
export interface OcrGateRequest { source: SourceRef; pageCount: number; totalPageCount:number; pageNumbers:readonly number[] }
export type OcrGateResult =
  | { granted: true; grant: DispatchGrant & { limit: Extract<PaidLimit, {kind: 'ocr'}> } }
  | { granted: false; reason: 'budget_unavailable' | 'privacy_changed' | 'source_changed' | 'provider_uncertain' };
/** beforeOcr closure captures server-owned lease/consent. Count pages locally on
 * the exact immutable PDF before reserve+beginDispatch. <=10 pages, no paid call
 * if unknown/invalid. Callback at most once per extraction invocation. */
export interface OcrDependencies {
  countPages(bytes: Uint8Array, timeoutMs: number): Promise<number>;
  beforeOcr(request: OcrGateRequest): Promise<OcrGateResult>;
  paid: PaidDependencies;
}
export interface SnapshotRequest { schemaVersion: 1; idempotencyKey: UUID; resumeId: number }
export interface Snapshot {
  schemaVersion: 1; sourceId: UUID; sourceVersion: number; contentHash: SHA256;
}
export interface QueueRequest { schemaVersion: 1; idempotencyKey: UUID; sourceId: UUID; sourceVersion: number }
/** Explicit processing retry for the failed stage only, not delivery retry. Resume remains optional. */
export interface SourceRetryRequest {schemaVersion:1;idempotencyKey:UUID;retryOfCommandId:UUID}
export interface SourceStatus {
  commandId: UUID; sourceId: UUID; sourceVersion: number;
  state: 'queued' | 'extracting' | 'building' | 'transferring' | 'review_ready' | 'unavailable' | 'held';
  reason: Refusal | 'unsupported' | 'empty' | 'too_large' | 'provider_refused' | null;
  proposalId: UUID | null;
}
export interface OwnedSource {
  source: SourceRef; byteLength: number;
  mediaType: 'application/pdf' | 'application/msword' | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  policyVersion: string;
  /** Opaque internal handle, not a browser URL/path or service-signed URL. */
  objectHandle: UUID;
}
export interface SourceClaim {
  lease: Lease; actor: Actor; source: OwnedSource; consentRevision: number;
  /** Ephemeral, internal prepare/claim output only. Resolve from the CURRENT
   * verified Flow account; never persist in commands, paid results or transfers.
   * P2 passes this only to extractResumeSource.knownContacts, not model input. */
  scrubContext: SourceScrubContext;
  originalDraftVersion: number; originalProfileVersion: number;
  originalPreferenceVersion: number; originalPreferenceDraftRevision: number;
}
export const sourceScrubContextSchema = z.object({
  verifiedAccountEmail: z.string().min(3).max(320).email().refine(v => !/[\r\n\u0000]/.test(v)),
}).strict();
export type SourceScrubContext = z.infer<typeof sourceScrubContextSchema>;
/** Fail closed: an unavailable/unverified account is not permission to fall
 * back to pattern-only scrubbing. This helper never fetches or logs contacts. */
export function verifiedSourceScrubContext(email: unknown, verified: unknown): SourceScrubContext {
  if (verified !== true) throw new Error('privacy_changed');
  const result = sourceScrubContextSchema.safeParse({ verifiedAccountEmail: email });
  if (!result.success) throw new Error('privacy_changed');
  return result.data;
}
export interface SourceRepository {
  snapshot(actor: Actor, request: SnapshotRequest): Promise<Snapshot>;
  resolve(actor: Actor, source: SourceRef): Promise<OwnedSource>;
  enqueue(actor: Actor, request: QueueRequest): Promise<SourceStatus>;
  status(actor: Actor, commandId: UUID): Promise<SourceStatus>;
  claim(workerId: UUID): Promise<SourceClaim | null>;
  prepare(lease: Lease): Promise<SourceClaim | null>;
  /** Exact validated resumeTransfer (contracts.mjs); persists outbox and semantic
   * result identity atomically. Never regenerates command/proposal IDs on retry. */
  persistTransfer(lease: Lease, transfer: CanonicalDocument): Promise<SourceStatus>;
  settleTransfer(lease: Lease, receipt: CanonicalDocument): Promise<SourceStatus>;
  fail(lease: Lease, reason: Exclude<SourceStatus['reason'], null>): Promise<SourceStatus>;
}
export interface SourceObjectReader {
  /** Rechecks owned immutable generation/hash and reference before returning bytes. */
  read(actor: Actor, source: OwnedSource): Promise<Uint8Array>;
  /** B3: give the library row for this exact file the complete text Spark read,
   * only when that row is still waiting for it. Never overwrites existing text. */
  saveLibraryText?(actor: Actor, source: OwnedSource, text: string): Promise<boolean>;
}
/** P0 composition around Claude's snapshot repository, never an alternative
 * profile store or uploader. All object authority is checked before/after I/O. */
export function sourceObjectDependencies(db:FoundationDb,privacy:(userId:number)=>Promise<void>,
  deps:{readBlob?:typeof readCandidateResumeBlob;readProfile?:typeof readSparkProfile}={}){
  const readBlob=deps.readBlob??(async(...args:Parameters<typeof readCandidateResumeBlob>)=>(await import('../gcs-storage')).readCandidateResumeBlob(...args));
  const readProfile=deps.readProfile??(async(...args:Parameters<typeof readSparkProfile>)=>(await import('./profile-client')).readSparkProfile(...args));
  const actorSchema=z.object({userId:positiveInteger,subjectId:sourceUuid,bindingId:sourceUuid}).strict();
  const snapshotRequest=z.object({schemaVersion:z.literal(1),idempotencyKey:sourceUuid,resumeId:positiveInteger}).strict();
  const locator=z.object({resumeId:positiveInteger,gcsPath:z.string().min(1),subjectId:sourceUuid,bindingId:sourceUuid}).strict();
  const ref=z.object({sourceId:sourceUuid,sourceVersion:positiveInteger,contentHash:sourceHash}).strict();
  const owned=z.object({source:ref,byteLength:positiveInteger.max(5*1024*1024),mediaType:z.enum(['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document']),policyVersion:z.string().min(1).max(80),objectHandle:sourceUuid}).strict();
  const object=z.object({subjectId:sourceUuid,bindingId:sourceUuid,gcsPath:z.string().min(1),generation:z.string().regex(/^[0-9]+$/),contentHash:sourceHash,byteLength:positiveInteger,source:owned}).strict();
  const snapshot=z.object({schemaVersion:z.literal(1),sourceId:sourceUuid,sourceVersion:positiveInteger,contentHash:sourceHash}).strict();
  async function call<T>(name:string,args:unknown[],schema:z.ZodType<T>):Promise<T>{
    try{
      const result=await db.query(`SELECT public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args);
      if(result.rows.length!==1)throw Error('source_unavailable');
      return schema.parse(result.rows[0]!.result);
    }catch{throw Error('source_unavailable');}
  }
  const bound=(actor:Actor,identity:{subjectId:string;bindingId:string})=>{
    if(actor.subjectId!==identity.subjectId||actor.bindingId!==identity.bindingId)throw Error('source_changed');
  };
  return {
    async snapshot(actor:Actor,request:SnapshotRequest):Promise<Snapshot>{
      actorSchema.parse(actor);snapshotRequest.parse(request);await privacy(actor.userId);
      const location=await call('flow_candidate_source_locator',[actor.userId,request.resumeId],locator);bound(actor,location);
      const blob=await readBlob(location.gcsPath);
      const profile=await readProfile(actor.subjectId,actor.bindingId);
      await privacy(actor.userId);
      await call('flow_candidate_source_register_object',[actor.userId,JSON.stringify({resumeId:request.resumeId,gcsPath:location.gcsPath,
        generation:blob.generation,contentHash:blob.contentHash,byteLength:blob.byteLength,mediaType:blob.mediaType,policyVersion:'resume-source-v1',
        subjectId:actor.subjectId,bindingId:actor.bindingId,originalVersions:{originalDraftVersion:profile.draftVersion,originalProfileVersion:profile.profileVersion,
          originalPreferenceVersion:profile.preferenceVersion,originalPreferenceDraftRevision:profile.preferenceDraft?.preferenceDraftRevision??0}})],snapshot);
      const result=await call('flow_candidate_source_snapshot',[actor.userId,JSON.stringify(request)],snapshot);
      await privacy(actor.userId);return result;
    },
    async read(actor:Actor,source:OwnedSource):Promise<Uint8Array>{
      actorSchema.parse(actor);owned.parse(source);await privacy(actor.userId);
      const located=await call('flow_candidate_source_object_read',[actor.userId,source.objectHandle],object);bound(actor,located);
      if(canonicalProfileJson(located.source)!==canonicalProfileJson(source))throw Error('source_changed');
      const blob=await readBlob(located.gcsPath,{generation:located.generation,byteLength:located.byteLength,contentHash:located.contentHash});
      if(blob.mediaType!==source.mediaType)throw Error('source_changed');
      await privacy(actor.userId);
      const final=await call('flow_candidate_source_object_read',[actor.userId,source.objectHandle],object);bound(actor,final);
      if(canonicalProfileJson(final)!==canonicalProfileJson(located))throw Error('source_changed');
      return blob.bytes;
    },
    async saveLibraryText(actor:Actor,source:OwnedSource,text:string):Promise<boolean>{
      actorSchema.parse(actor);owned.parse(source);
      if(typeof text!=='string'||!text.trim()||Buffer.byteLength(text,'utf8')>512*1024)return false;
      await privacy(actor.userId);
      const located=await call('flow_candidate_source_object_read',[actor.userId,source.objectHandle],object);bound(actor,located);
      if(canonicalProfileJson(located.source)!==canonicalProfileJson(source))throw Error('source_changed');
      const saved=await db.query(`WITH saved AS (UPDATE candidate_resumes SET extracted_text=$3,updated_at=now()
        WHERE user_id=$1 AND gcs_path=$2 AND (extracted_text IS NULL OR extracted_text='') RETURNING 1) SELECT count(*)::int AS result FROM saved`,
        [actor.userId,located.gcsPath,text.replace(/\u0000/gu,'')]);
      return Number(saved.rows[0]?.result??0)>0;
    },
  };
}
/** All statements parameterized. P0 creates routines in the combined uncommitted
 * migration and supplies permissions. P2 never issues DDL or table writes.
 * Actor is trusted session/server context, not parsed from browser input.
 * JSON inputs have exactly the corresponding interface fields (no wrappers).
 */
export const sql = {
  snapshot: 'public.flow_candidate_source_snapshot(bigint,jsonb)',
  resolve: 'public.flow_candidate_source_resolve(bigint,jsonb)',
  enqueue: 'public.flow_candidate_source_enqueue(bigint,jsonb)',
  status: 'public.flow_candidate_source_status(bigint,uuid)',
  claim: 'public.flow_candidate_source_claim(uuid)',
  prepare: 'public.flow_candidate_source_prepare(jsonb)',
  persistTransfer: 'public.flow_candidate_source_transfer_store(jsonb,jsonb)',
  settleTransfer: 'public.flow_candidate_source_transfer_finish(jsonb,jsonb)',
  fail: 'public.flow_candidate_source_fail(jsonb,text)',
  reserve: 'public.flow_candidate_source_paid_reserve(jsonb)',
  beginDispatch: 'public.flow_candidate_source_paid_dispatch(jsonb)',
  settle: 'public.flow_candidate_source_paid_settle(jsonb)',
  hold: 'public.flow_candidate_source_paid_hold(jsonb)',
  releaseUnsent: 'public.flow_candidate_source_paid_release_unsent(jsonb)',
} as const;
/** P0 integration wrapper: successful native reading is reusable across explicit
 * AI retries. OCR reuse stays in the paid journal, after successful settlement. */
export function withCachedResumeExtraction(db:FoundationDb,lease:Lease,extract?:typeof extractResumeSource):typeof extractResumeSource {
 return async(rawInput,bytes,deps)=>{
  const module=await import('./resume-source');
  const input=module.resumeExtractionInputSchema.parse(rawInput);
  if(bytes.length!==input.byteLength||createHash('sha256').update(bytes).digest('hex')!==input.contentHash)throw Error('source_cache_changed');
  const call=async(document:CanonicalDocument|null)=>{
   const result=await db.query('SELECT public.flow_candidate_source_extraction_cache($1,$2) AS result',[JSON.stringify(lease),document===null?null:JSON.stringify(document)]);
   if(result.rows.length!==1)throw Error('source_cache_unavailable');return result.rows[0]!.result;
  };
  const cached=await call(null);
  if(cached!==null){
   const document=z.object({canonical:z.string().min(1).max(2097152),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(cached);
   if(createHash('sha256').update(document.canonical).digest('hex')!==document.sha256)throw Error('source_cache_changed');
   const v=z.object({schemaVersion:z.literal(1),sourceId:z.literal(input.sourceId),sourceVersion:z.literal(input.sourceVersion),
    contentHash:z.literal(input.contentHash),policyVersion:z.literal(input.policyVersion),status:z.literal('extracted'),
    text:z.string().min(1),textHash:z.string().regex(/^[a-f0-9]{64}$/),method:z.literal('native_text'),providerCalls:z.literal(0)}).strict().parse(JSON.parse(document.canonical));
   if(canonicalProfileJson(v)!==document.canonical||Buffer.byteLength(v.text)>524288||createHash('sha256').update(v.text).digest('hex')!==v.textHash)throw Error('source_cache_changed');
   return {output:v,ocr:{state:'not_requested'}};
  }
  const result=await(extract??module.extractResumeSource)(input,bytes,deps);
  if(result.output.status==='extracted'&&result.output.method==='native_text'&&result.ocr.state==='not_requested'){
   const canonical=canonicalProfileJson(result.output),document={canonical,sha256:createHash('sha256').update(canonical).digest('hex')};
   if(canonicalProfileJson(await call(document))!==canonicalProfileJson(document))throw Error('source_cache_changed');
  }
  return result;
 };
}
export const SOURCE_TABLES = ['candidate_source_objects','candidate_source_requests','candidate_source_jobs',
  'candidate_source_global_policy','candidate_source_global_audit','candidate_source_ocr_prices','candidate_source_ocr_spend','candidate_source_budget_alerts',
  'candidate_source_ai_policy','candidate_source_ai_prices','candidate_source_ai_spend','candidate_source_ai_policy_audit',
  'candidate_source_interpretations','candidate_source_interpretation_budgets','candidate_source_interpretation_reviews','candidate_source_erasures',
  'candidate_source_budget_windows','candidate_source_paid_operations','candidate_source_budget_clocks',
  'candidate_source_lookup_budgets','candidate_source_lookups','candidate_source_lookup_requests'] as const;
// Exact entrypoints the app calls (résumé reading, RC lookup, AI help). The
// provisioner grants only these and readiness refuses any other grant. No source
// tables, budget table, trigger, validator or internal helper is granted here.
// Résumé reading (B2): the web routes and the background worker call exactly these.
export const RESUME_SOURCE_RUNTIME_FUNCTIONS = [
 'flow_candidate_source_library_status(bigint)',
 ...Object.values(sql).map(s=>s.replace(/^public\./,'')),
 'flow_candidate_source_locator(bigint,integer)','flow_candidate_source_register_object(bigint,jsonb)',
 'flow_candidate_source_object_read(bigint,uuid)','flow_candidate_source_retry(bigint,jsonb)',
 'flow_candidate_source_retry_status(bigint,uuid)','flow_candidate_source_extraction_cache(jsonb,jsonb)',
] as const;
export const SOURCE_RUNTIME_FUNCTIONS = [
 'flow_candidate_source_budget_alert_claim()','flow_candidate_source_budget_alert_finish(uuid,uuid,boolean)',
 ...RESUME_SOURCE_RUNTIME_FUNCTIONS,
 'flow_candidate_source_redact_due()',
 'flow_candidate_source_interpretation_ack(integer,uuid)',
 'flow_candidate_source_proposal_context(integer,integer,uuid)',
 'flow_candidate_source_interpretation_reserve(integer,integer,bigint,uuid,text,text,text,bigint,bigint)',
 'flow_candidate_source_interpretation_dispatch(uuid,text)',
 'flow_candidate_source_interpretation_hold(uuid,text)',
 'flow_candidate_source_interpretation_settle(uuid,text,jsonb,bigint,bigint)',
 'flow_candidate_source_lookup_status(bigint,integer,uuid)','flow_candidate_source_lookup_admit(bigint,integer,jsonb)',
 'flow_candidate_source_lookup_dispatch(bigint,integer,uuid)','flow_candidate_source_lookup_finish(bigint,uuid,uuid,jsonb)',
 'flow_candidate_source_lookup_hold(bigint,uuid,uuid,bigint)','flow_candidate_source_lookup_cancel_unsent(bigint,uuid,uuid)',
 'flow_candidate_source_lookup_delivery_read(bigint,integer,uuid)','flow_candidate_source_lookup_delivery_store(bigint,integer,uuid,jsonb)',
 'flow_candidate_source_lookup_delivery_finish(bigint,uuid,jsonb)','flow_candidate_source_lookup_claim()',
 'flow_candidate_source_lookup_work_prepare(uuid,uuid,bigint)','flow_candidate_source_lookup_work_finish(uuid,uuid,bigint,text)',
] as const;
export const SOURCE_OWNER_FUNCTIONS = [...Object.values(sql).map(s=>s.replace(/^public\./,'')),
  'flow_candidate_source_global_configure(jsonb,text)','flow_candidate_source_budget_emit(text,integer,text,text,numeric,numeric)',
  'flow_candidate_source_budget_windows_sync(text)',
  'flow_candidate_source_ocr_admit(uuid,integer,bigint)','flow_candidate_source_budget_observe()',
  'flow_candidate_source_budget_alert_claim()','flow_candidate_source_budget_alert_finish(uuid,uuid,boolean)',
  'flow_candidate_source_ai_admit(uuid,integer,text,text,bigint,bigint)',
  'flow_candidate_source_ai_settle(uuid,bigint,bigint)',
  'flow_candidate_source_ai_price_immutable()',
  'flow_candidate_source_ai_configure(bigint,bigint,bigint,bigint,bigint,boolean,uuid)',
  'flow_candidate_source_interpretation_blocked()',
  'flow_candidate_source_interpretation_review(uuid,numeric,numeric,uuid)',
  'flow_candidate_source_payload_fence()',
  'flow_candidate_source_redact_due()',
  'flow_candidate_source_interpretation_ack(integer,uuid)',
  'flow_candidate_source_proposal_context(integer,integer,uuid)',
  'flow_candidate_source_erasure_prepare(uuid)',
  'flow_candidate_source_erasure_finish(uuid,uuid,uuid)',
  'flow_candidate_source_interpretation_authorized(integer,integer,bigint)',
  'flow_candidate_source_interpretation_reserve(integer,integer,bigint,uuid,text,text,text,bigint,bigint)',
  'flow_candidate_source_interpretation_dispatch(uuid,text)',
  'flow_candidate_source_interpretation_hold(uuid,text)',
  'flow_candidate_source_interpretation_settle(uuid,text,jsonb,bigint,bigint)',
  'flow_candidate_source_budget_now(text)',
  'flow_candidate_source_locator(bigint,integer)','flow_candidate_source_register_object(bigint,jsonb)','flow_candidate_source_object_read(bigint,uuid)',
  'flow_candidate_source_retry(bigint,jsonb)','flow_candidate_source_retry_status(bigint,uuid)',
  'flow_candidate_source_extraction_cache(jsonb,jsonb)',
  'flow_candidate_source_lookup_status(bigint,integer,uuid)','flow_candidate_source_lookup_admit(bigint,integer,jsonb)',
  'flow_candidate_source_lookup_dispatch(bigint,integer,uuid)','flow_candidate_source_lookup_finish(bigint,uuid,uuid,jsonb)',
  'flow_candidate_source_lookup_hold(bigint,uuid,uuid,bigint)','flow_candidate_source_lookup_person_valid(jsonb,text)',
  'flow_candidate_source_lookup_cancel_unsent(bigint,uuid,uuid)','flow_candidate_source_lookup_settlement_value(uuid)',
  'flow_candidate_source_lookup_delivery_read(bigint,integer,uuid)','flow_candidate_source_lookup_delivery_store(bigint,integer,uuid,jsonb)',
  'flow_candidate_source_lookup_delivery_finish(bigint,uuid,jsonb)',
  'flow_candidate_source_lookup_claim()','flow_candidate_source_lookup_work_prepare(uuid,uuid,bigint)',
  'flow_candidate_source_lookup_work_finish(uuid,uuid,bigint,text)','flow_candidate_source_lookup_rejection()',
  'flow_candidate_source_shape(jsonb,text[])','flow_candidate_source_uint(jsonb,boolean)',
  'flow_candidate_source_status_value(uuid)','flow_candidate_source_owned_value(uuid)',
  'flow_candidate_source_library_status(bigint)','flow_candidate_source_library_remove()',
  'flow_candidate_source_owner(bigint)','flow_candidate_source_paid_identity(jsonb)',
  'flow_candidate_source_paid_record(jsonb,boolean)','flow_candidate_source_document(jsonb)'] as const;
// All SQL returns jsonb matching the return interface; null claim/prepare uses
// SQL NULL. bigint is trusted actor.userId. DB resolves/checks subject+binding;
// caller cannot supply another binding via a JSON argument. Workers fenced by
// lease token+generation and current consent/privacy. Snapshot/queue same key
// exact body returns original receipt; changed body is idempotency_conflict.

/** Owner-bound RC repository. Each query is an autocommitted durable routine;
 * the caller must not wrap beginDispatch + HTTP in a transaction. No provider
 * dispatch is mounted until proposal delivery/recovery and activation gates pass.
 */
export function lookupRepository(db:FoundationDb,privacy:(userId:number)=>Promise<void>,actor:{userId:number;authVersion:number}){
 const a=z.object({userId:positiveInteger.max(2147483647),authVersion:z.number().int().min(0).max(2147483647)}).strict().parse(actor);
 const dispatchSchema=z.object({attemptId:sourceUuid,dispatchId:sourceUuid,subjectId:sourceUuid,bindingId:sourceUuid,
  consentRevision:positiveInteger,operation:lookupOperationSchema}).strict();
 const document=z.object({canonical:z.string().min(1).max(2097152),sha256:sourceHash}).strict();
 const prepared=z.object({attemptId:sourceUuid,subjectId:sourceUuid,bindingId:sourceUuid,consentRevision:positiveInteger,
  expiresAt:z.string().datetime(),result:document,transfer:document.nullable()}).strict();
 const verify=(d:CanonicalDocument)=>{
  if(createHash('sha256').update(d.canonical).digest('hex')!==d.sha256)throw Error('lookup_document_changed');
  const p=JSON.parse(d.canonical);if(canonicalProfileJson(p)!==d.canonical)throw Error('lookup_document_changed');return p;
 };
 async function call<T>(name:string,args:unknown[],schema:z.ZodType<T>):Promise<T>{
  const out=await db.query(`SELECT public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args);
  if(out.rows.length!==1)throw Error('lookup_unavailable');return schema.parse(out.rows[0]!.result);
 }
 return {
  async prepareDelivery(attemptId:string){
   sourceUuid.parse(attemptId);await privacy(a.userId);
   const p=await call('flow_candidate_source_lookup_delivery_read',[a.userId,a.authVersion,attemptId],prepared.nullable());
   if(!p)return null;if(p.attemptId!==attemptId)throw Error('lookup_document_changed');
   const result=lookupResultSchema.parse(verify(p.result));
   if(p.transfer){verify(p.transfer);const t=parseLookupTransfer(p.transfer.canonical);
    if(t.value.commandId!==attemptId||t.value.sourceId!==attemptId||t.value.subjectId!==p.subjectId||t.value.bindingId!==p.bindingId)throw Error('lookup_document_changed');}
   await privacy(a.userId);return {...p,result};
  },
  async storeDelivery(attemptId:string,d:CanonicalDocument){
   sourceUuid.parse(attemptId);document.parse(d);verify(d);parseLookupTransfer(d.canonical);await privacy(a.userId);
   const stored=await call('flow_candidate_source_lookup_delivery_store',[a.userId,a.authVersion,attemptId,JSON.stringify(d)],document);
   if(canonicalProfileJson(stored)!==canonicalProfileJson(d))throw Error('lookup_document_changed');return stored;
  },
  async finishDelivery(attemptId:string,stored:CanonicalDocument,receipt:unknown){
   sourceUuid.parse(attemptId);verify(stored);const t=parseLookupTransfer(stored.canonical);
   if(t.value.commandId!==attemptId)throw Error('lookup_document_changed');
   const value=validateSourceReceipt(t.value,receipt,'professional_lookup'),canonical=canonicalProfileJson(value);
   return call('flow_candidate_source_lookup_delivery_finish',[a.userId,attemptId,JSON.stringify({canonical,sha256:createHash('sha256').update(canonical).digest('hex')})],lookupStatusSchema);
  },
  async admit(raw:string){
   const {parseProfileJson}=await import('./profile-contracts');
   const request=lookupRequestSchema.parse(parseProfileJson(raw,4096));await privacy(a.userId);
   return call('flow_candidate_source_lookup_admit',[a.userId,a.authVersion,JSON.stringify(request)],lookupStatusSchema);
  },
  async status(attemptId:string){sourceUuid.parse(attemptId);await privacy(a.userId);
   const status=await call('flow_candidate_source_lookup_status',[a.userId,a.authVersion,attemptId],lookupStatusSchema);
   if(status.attemptId!==attemptId)throw Error('lookup_unavailable');await privacy(a.userId);return status;
  },
  async beginDispatch(attemptId:string):Promise<LookupDispatch|null>{
   sourceUuid.parse(attemptId);await privacy(a.userId);
   return call('flow_candidate_source_lookup_dispatch',[a.userId,a.authVersion,attemptId],dispatchSchema.nullable());
  },
  async settle(grant:LookupDispatch,result:LookupResult){
   const g=dispatchSchema.parse(grant),v=lookupResultSchema.parse(result);await privacy(a.userId);
   const canonical=canonicalProfileJson(v);
   if(Buffer.byteLength(canonical)>2097152)throw Error('lookup_unavailable');
   const status=await call('flow_candidate_source_lookup_finish',[a.userId,g.attemptId,g.dispatchId,
    JSON.stringify({canonical,sha256:createHash('sha256').update(canonical).digest('hex')})],lookupStatusSchema);
   if(status.attemptId!==g.attemptId)throw Error('lookup_unavailable');
  },
  async hold(grant:LookupDispatch,_reason:string,observed:number|null){
   const g=dispatchSchema.parse(grant);z.number().int().nonnegative().safe().nullable().parse(observed);
   await call('flow_candidate_source_lookup_hold',[a.userId,g.attemptId,g.dispatchId,observed],z.literal(true));
  },
  async refuseUnsent(attemptId:string){sourceUuid.parse(attemptId);
   await call('flow_candidate_source_lookup_hold',[a.userId,attemptId,null,null],z.literal(true));
  },
  async cancelUnsent(grant:LookupDispatch){const g=dispatchSchema.parse(grant);
   await call('flow_candidate_source_lookup_cancel_unsent',[a.userId,g.attemptId,g.dispatchId],z.literal(true));
  },
 };
}

export const lookupWorkSchema=z.object({attemptId:sourceUuid,userId:positiveInteger.max(2147483647),
 authVersion:z.number().int().nonnegative(),token:sourceUuid,generation:positiveInteger,attempts:positiveInteger.max(12),
 stage:z.enum(['queued','transferring'])}).strict();
export type LookupWork=z.infer<typeof lookupWorkSchema>;
export type LookupWorkFailure='temporary'|'delivery_refused'|'privacy_restricted'|'consent_changed'|null;
export function lookupQueueRepository(db:FoundationDb){
 return {
  async claim(){const r=await db.query('SELECT public.flow_candidate_source_lookup_claim() result',[]);
   if(r.rows.length!==1)throw Error('lookup_unavailable');return lookupWorkSchema.nullable().parse(r.rows[0]!.result);},
  async prepare(work:LookupWork){const w=lookupWorkSchema.parse(work);
   const r=await db.query('SELECT public.flow_candidate_source_lookup_work_prepare($1,$2,$3) result',[w.attemptId,w.token,w.generation]);
   return z.boolean().parse(r.rows[0]?.result);},
  async finish(work:LookupWork,failure:LookupWorkFailure){const w=lookupWorkSchema.parse(work);
   const r=await db.query('SELECT public.flow_candidate_source_lookup_work_finish($1,$2,$3,$4) result',[w.attemptId,w.token,w.generation,failure]);
   return z.boolean().parse(r.rows[0]?.result);},
 };
}
