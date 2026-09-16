/** Private generation search. The caller retains Flow's auth, privacy and hydration gates. */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { pool } from "../db";
import { signServiceJwt } from "../lib/services/jwt-signer";

const id = z.number().int().positive().max(2_147_483_647);
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const timestamp = z.string().datetime({ offset: true });
const hitSchema = z.object({
  application_id: id, job_id: id, reference_id: uuid.nullable(), resume_version_id: uuid.nullable(),
  generation_id: uuid.nullable(), generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
  source_observed_at: timestamp.nullable(), state: z.enum(["legacy", "ready", "updating", "refresh_failed"]),
  cosine_score: z.number().finite().min(-1).max(1).nullable(), ranking_score: z.number().finite(),
  matched_chunks: z.number().int().min(1).max(100),
  // Python's bounded serializer counts code points, not UTF-16 code units.
  highlights: z.array(z.string().refine(value => Array.from(value).length <= 240)).max(3),
}).strict().superRefine((hit, ctx) => {
  const tuple = [hit.reference_id, hit.resume_version_id, hit.generation_id,
    hit.generation, hit.source_observed_at];
  if (hit.state === "legacy" ? tuple.some(value => value !== null) : tuple.some(value => value === null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "candidate_index_hit_tuple_invalid" });
  }
});
const count = z.number().int().min(0).max(1000);
export const candidateIndexSearchResponseSchema = z.object({
  results: z.array(hitSchema).max(100),
  score_type: z.enum(["rrf_fused", "cross_encoder"]), display_score_type: z.literal("cosine"),
  reranker: z.enum(["not_requested", "not_needed", "applied", "fallback"]), saturated: z.boolean(),
  processing: z.object({
    counts: z.object({ ready: count, updating: count, refresh_failed: count,
      pending: count, needs_review: count, failed: count }).strict(),
    bounded: z.boolean(), limit: z.literal(1000),
  }).strict(), retrieval_limit: z.literal(100),
}).strict().superRefine((result, ctx) => {
  if (new Set(result.results.map(hit => hit.application_id)).size !== result.results.length
    || (result.score_type === "cross_encoder") !== (result.reranker === "applied")
    || Object.values(result.processing.counts).reduce((sum, n) => sum + n, 0) > 1000) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "candidate_index_search_shape_invalid" });
  }
  for (let i = 1; i < result.results.length; i++) {
    const a = result.results[i - 1]!, b = result.results[i]!;
    if (a.ranking_score < b.ranking_score
      || (a.ranking_score === b.ranking_score && a.application_id > b.application_id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "candidate_index_search_order_invalid" });
    }
  }
});
export type CandidateIndexSearchHit = z.infer<typeof hitSchema>;
export type CandidateIndexSearchResponse = z.infer<typeof candidateIndexSearchResponseSchema>;
type SearchCode = "candidate_index_search_unavailable" | "candidate_index_filter_unsupported"
  | "candidate_index_filter_conflict" | "candidate_index_query_too_long";
export class CandidateIndexSearchError extends Error {
  constructor(public readonly code: SearchCode) { super(code); }
}
const unavailable = () => new CandidateIndexSearchError("candidate_index_search_unavailable");

/** This is a closed adapter contract, NOT a claim that arbitrary legacy keys have parity. */
export function candidateIndexSearchFilters(organizationId: number, supplied?: Record<string, unknown>) {
  if (!id.safeParse(organizationId).success) throw unavailable();
  const metadata: Record<string, unknown> = { ...supplied, source: "vantahire", org_id: organizationId };
  if (Object.keys(metadata).some(key => !["source", "org_id", "job_id"].includes(key))) {
    throw new CandidateIndexSearchError("candidate_index_filter_unsupported");
  }
  if (Object.hasOwn(metadata, "job_id")) {
    const value = metadata.job_id;
    if ((typeof value !== "string" && typeof value !== "number")
      || !/^[1-9][0-9]{0,9}$/.test(String(value)) || !id.safeParse(Number(value)).success) {
      throw new CandidateIndexSearchError("candidate_index_filter_conflict");
    }
    metadata.job_id = Number(value);
  }
  return metadata;
}

const MAX_SEARCH_RESPONSE_BYTES = 512 * 1024;
async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const length = response.headers.get("content-length");
  if (!response.body || response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json"
    || (length !== null && (!/^[0-9]{1,9}$/.test(length) || Number(length) > MAX_SEARCH_RESPONSE_BYTES))) {
    void response.body?.cancel().catch(() => undefined);
    throw unavailable();
  }
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_SEARCH_RESPONSE_BYTES) throw unavailable();
      chunks.push(value);
    }
    signal.throwIfAborted();
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } finally {
    cancel();
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

/** No retry or legacy fallback after an enabled private read fails. Never return raw receiver errors. */
export async function searchCandidateIndex(input: {
  organizationId: number; query: string; useHybrid: boolean; useReranker: boolean;
  metadataFilters?: Record<string, unknown>; signal?: AbortSignal; fetchImpl?: typeof fetch;
}): Promise<CandidateIndexSearchResponse> {
  const metadata = candidateIndexSearchFilters(input.organizationId, input.metadataFilters);
  if (typeof input.query !== "string" || !input.query.trim() || input.query.length > 2000
    || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(input.query)
    || typeof input.useHybrid !== "boolean" || typeof input.useReranker !== "boolean") throw unavailable();
  const controller = new AbortController();
  const signal = input.signal ? AbortSignal.any([input.signal, controller.signal]) : controller.signal;
  const timer = setTimeout(() => controller.abort(), 10_000);
  let rejectDeadline = () => {};
  const deadline = new Promise<never>((_, reject) => {
    rejectDeadline = () => reject(unavailable());
    if (signal.aborted) rejectDeadline();
    else signal.addEventListener("abort", rejectDeadline, { once: true });
  });
  try {
    const attempt = async () => {
      signal.throwIfAborted();
      const base = new URL(process.env.ACTIVEKG_BASE_URL ?? "");
      const loopback = process.env.NODE_ENV !== "production" && base.protocol === "http:"
        && ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname);
      if ((!loopback && base.protocol !== "https:") || base.username || base.password
        || base.search || base.hash || base.pathname !== "/") throw unavailable();
      const token = await signServiceJwt("activekg", { tenantId: `org_${input.organizationId}`,
        scopes: "organization-candidate-index:read", requestId: randomUUID() });
      signal.throwIfAborted();
      const response = await (input.fetchImpl ?? fetch)(`${base.origin}/organization-candidates/search`, {
        method: "POST", redirect: "error", signal,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ query: input.query, top_k: 100,
          use_hybrid: input.useHybrid, use_reranker: input.useReranker, metadata_filters: metadata }),
      });
      if (response.status !== 200 && response.status !== 422) {
        void response.body?.cancel().catch(() => undefined);
        throw unavailable();
      }
      const body = await boundedJson(response, signal);
      if (response.status === 422) {
        const code = (body as any)?.detail;
        if (["candidate_index_filter_unsupported", "candidate_index_filter_conflict",
          "candidate_index_query_too_long"].includes(code)) throw new CandidateIndexSearchError(code);
        throw unavailable();
      }
      const result = candidateIndexSearchResponseSchema.safeParse(body);
      if (!result.success || (metadata.job_id !== undefined
        && result.data.results.some(hit => hit.job_id !== metadata.job_id))
        || (!input.useReranker && result.data.reranker !== "not_requested")
        || (input.useReranker && result.data.reranker === "not_requested")) throw unavailable();
      return result.data;
    };
    return await Promise.race([attempt(), deadline]);
  } catch (error) {
    if (error instanceof CandidateIndexSearchError) throw error;
    throw unavailable();
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", rejectDeadline);
    controller.abort();
  }
}

/** Match managed hits against live tenant/job ownership and the immutable, acknowledged 4B tuple.
 * Existing Flow privacy hydration MUST still run before the caller-visible limit.
 * Never SELECT the insert-only index outbox or use a managed marker as read authority.
 */
export async function verifyCandidateIndexHitTuples(organizationId: number, hits: CandidateIndexSearchHit[]) {
  if (!id.safeParse(organizationId).success || hits.length > 100) throw unavailable();
  const managed = hits.filter(hit => hit.state !== "legacy");
  if (managed.length === 0) return new Set<number>();
  // Authenticated Memory publication already binds its immutable 4B receipt;
  // Flow's claim also required the exact terminal acknowledgement. Hydration
  // rechecks current Flow ownership and the immutable resume tuple, never reads
  // either insert-only outbox or treats an identity-only hit as source authority.
  const { rows } = await pool.query(
    "SELECT r.application_id,r.job_id,r.reference_id,r.resume_version_id "
    + "FROM public.application_resume_versions r "
    + "JOIN public.applications a ON a.id=r.application_id AND a.organization_id=r.organization_id AND a.job_id=r.job_id "
    + "JOIN public.jobs j ON j.id=a.job_id AND j.organization_id=r.organization_id "
    + "WHERE r.organization_id=$1 AND r.resume_version_id=ANY($2::uuid[])",
    [organizationId, managed.map(hit => hit.resume_version_id)]);
  return new Set<number>(managed.filter(hit => rows.some((row: Record<string, unknown>) => row.application_id === hit.application_id
    && row.job_id === hit.job_id && row.reference_id === hit.reference_id
    && row.resume_version_id === hit.resume_version_id)).map(hit => hit.application_id));
}
