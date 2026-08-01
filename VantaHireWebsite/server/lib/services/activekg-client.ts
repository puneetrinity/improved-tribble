/**
 * Active Graph KG HTTP client.
 *
 * Wraps Active Graph API endpoints with RS256 JWT auth (scoped per endpoint),
 * typed request/response, and structured error handling.
 *
 * Uses ACTIVEKG_BASE_URL env var and signServiceJwt('activekg', ...) for auth.
 * Each endpoint gets the minimum scope it needs:
 *   /nodes, /edges, /nodes/batch, /upload -> kg:write
 *   /search -> search:read
 *   /ask -> ask:read
 */

import { signServiceJwt } from './jwt-signer';

// =====================================================
// Scopes required by Active Graph endpoints
// =====================================================

export const ACTIVEKG_SCOPES = {
  SEARCH: 'search:read',
  ASK: 'ask:read',
  WRITE: 'kg:write',
  KG_READ: 'kg:read',
  CONTACT_WRITE: 'contact:write',
  CONTACT_SUPPRESS: 'contact:suppress',
} as const;

// =====================================================
// Request / Response types
// =====================================================

export interface ActiveKGSearchRequest {
  query: string;
  top_k?: number;
  use_hybrid?: boolean;
  classes?: string[];
  tenant_id?: string;
  metadata_filters?: Record<string, unknown>;
  use_reranker?: boolean;
}

export interface ActiveKGSearchResult {
  id: string;
  classes: string[];
  props: Record<string, unknown>;
  similarity: number;
  vector_similarity?: number;
  metadata?: Record<string, unknown>;
}

export interface ActiveKGSearchResponse {
  results: ActiveKGSearchResult[];
  count: number;
  query: string;
  search_mode?: string;
  score_type?: string;
  mode?: string;
}

export interface ActiveKGAskRequest {
  question: string;
  max_results?: number;
  tenant_id?: string;
}

export interface ActiveKGAskResponse {
  answer: string;
  confidence: number;
  citations: Array<{
    node_id: string;
    text: string;
    similarity: number;
  }>;
  metadata?: Record<string, unknown>;
}

export interface ActiveKGNodeCreateRequest {
  classes: string[];
  props: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  tenant_id?: string;
  extract?: boolean;
  extract_before_embed?: boolean;
}

export interface ActiveKGNodeCreateResponse {
  id: string;
  status?: string;
  external_id?: string;
}

export interface ActiveKGEdgeCreateRequest {
  src: string;
  dst: string;
  rel: string;
  props?: Record<string, unknown>;
  tenant_id?: string;
}

export interface ActiveKGEdgeCreateResponse {
  id: string;
  src: string;
  dst: string;
  rel: string;
}

export interface ActiveKGNodeByExternalIdResponse {
  id: string;
  external_id: string;
  classes: string[];
  props: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

// =====================================================
// Error class (with retryable flag for processor)
// =====================================================

export class ActiveKGClientError extends Error {
  public readonly retryable: boolean;

  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ActiveKGClientError';
    // 5xx and 429 are retryable; 4xx (except 429) are not
    this.retryable = statusCode >= 500 || statusCode === 429;
  }
}

// Keep backwards-compat alias
export { ActiveKGClientError as ActiveKGApiError };

// =====================================================
// Internal fetch helper
// =====================================================

function getBaseUrl(): string {
  const url = process.env.ACTIVEKG_BASE_URL;
  if (!url) {
    throw new Error('ACTIVEKG_BASE_URL environment variable is not set');
  }
  return url.replace(/\/+$/, '');
}

async function activekgFetch(
  path: string,
  opts: {
    method: 'GET' | 'POST';
    tenantId: string;
    scopes: string;
    requestId?: string | undefined;
    body?: unknown | undefined;
    query?: Record<string, string> | undefined;
    timeoutMs?: number | undefined;
  },
): Promise<Response> {
  const token = await signServiceJwt('activekg', {
    tenantId: opts.tenantId,
    scopes: opts.scopes,
    ...(opts.requestId != null ? { requestId: opts.requestId } : {}),
  });

  let url = `${getBaseUrl()}${path}`;
  if (opts.query) {
    const params = new URLSearchParams(opts.query);
    url += `?${params.toString()}`;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };
  if (opts.requestId) {
    headers['X-Request-ID'] = opts.requestId;
  }

  const res = await fetch(url, {
    method: opts.method,
    headers,
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
    // Node's fetch has no default timeout; an unbounded call here would pin the
    // caller (and, for outreach hygiene, a pooled DB connection) indefinitely.
    ...(opts.timeoutMs != null ? { signal: AbortSignal.timeout(opts.timeoutMs) } : {}),
  });

  return res;
}

// =====================================================
// Public API
// =====================================================

/**
 * POST /search — search:read
 */
export async function search(
  tenantId: string,
  request: ActiveKGSearchRequest,
  requestId?: string,
): Promise<ActiveKGSearchResponse> {
  const res = await activekgFetch('/search', {
    method: 'POST',
    tenantId,
    scopes: ACTIVEKG_SCOPES.SEARCH,
    requestId,
    body: request,
  });

  const body: any = await res.json();

  if (!res.ok) {
    throw new ActiveKGClientError(
      body.detail || `ActiveKG /search returned ${res.status}`,
      res.status,
      body,
    );
  }

  return body as ActiveKGSearchResponse;
}

/**
 * POST /ask — ask:read
 */
export async function ask(
  tenantId: string,
  request: ActiveKGAskRequest,
  requestId?: string,
): Promise<ActiveKGAskResponse> {
  const res = await activekgFetch('/ask', {
    method: 'POST',
    tenantId,
    scopes: ACTIVEKG_SCOPES.ASK,
    requestId,
    body: request,
  });

  const body: any = await res.json();

  if (!res.ok) {
    throw new ActiveKGClientError(
      body.detail || `ActiveKG /ask returned ${res.status}`,
      res.status,
      body,
    );
  }

  return body as ActiveKGAskResponse;
}

/**
 * POST /nodes — kg:write
 */
export async function createNode(
  tenantId: string,
  request: ActiveKGNodeCreateRequest,
  requestId?: string,
): Promise<ActiveKGNodeCreateResponse> {
  const res = await activekgFetch('/nodes', {
    method: 'POST',
    tenantId,
    scopes: ACTIVEKG_SCOPES.WRITE,
    requestId,
    body: request,
  });

  const body: any = await res.json();

  if (!res.ok) {
    throw new ActiveKGClientError(
      body.detail || `ActiveKG /nodes returned ${res.status}`,
      res.status,
      body,
    );
  }

  return body as ActiveKGNodeCreateResponse;
}

/**
 * POST /edges — kg:write
 */
export async function createEdge(
  tenantId: string,
  request: ActiveKGEdgeCreateRequest,
  requestId?: string,
): Promise<ActiveKGEdgeCreateResponse> {
  const res = await activekgFetch('/edges', {
    method: 'POST',
    tenantId,
    scopes: ACTIVEKG_SCOPES.WRITE,
    requestId,
    body: request,
  });

  const body: any = await res.json();

  if (!res.ok) {
    throw new ActiveKGClientError(
      body.detail || `ActiveKG /edges returned ${res.status}`,
      res.status,
      body,
    );
  }

  return body as ActiveKGEdgeCreateResponse;
}

/**
 * GET /nodes/by-external-id — kg:write (read via write scope)
 *
 * Returns null if the node does not exist (404).
 */
export async function getNodeByExternalId(
  tenantId: string,
  externalId: string,
  requestId?: string,
): Promise<ActiveKGNodeByExternalIdResponse | null> {
  const res = await activekgFetch('/nodes/by-external-id', {
    method: 'GET',
    tenantId,
    scopes: ACTIVEKG_SCOPES.WRITE,
    requestId,
    query: { external_id: externalId },
  });

  if (res.status === 404) {
    return null;
  }

  const body: any = await res.json();

  if (!res.ok) {
    throw new ActiveKGClientError(
      body.detail || `ActiveKG /nodes/by-external-id returned ${res.status}`,
      res.status,
      body,
    );
  }

  return body as ActiveKGNodeByExternalIdResponse;
}

// =====================================================
// Global Memory: feedback event forward-sync
// =====================================================

export interface FeedbackEventPayload {
  tenant_id: string;
  job_id: string;
  recruiter_id?: string | null;
  global_candidate_id?: string | null;
  signal_candidate_id?: string | null;
  action: string;
  rank_at_time?: number | null;
  fit_score_at_time?: number | null;
  source_type_at_time?: string | null;
  match_tier_at_time?: string | null;
  location_match_at_time?: string | null;
  role_family?: string | null;
  location_country_code?: string | null;
  seniority_band?: string | null;
  event_id: string;
}

export interface FeedbackIngestResponse {
  inserted: number;
  skipped: number;
}

/**
 * POST /global-candidates/feedback-events — kg:write
 *
 * Forward-syncs recruiter feedback events to ActiveKG's read-optimized replica.
 * Non-blocking: caller should catch errors and log, never fail the parent operation.
 */
export async function ingestFeedbackEvents(
  tenantId: string,
  events: FeedbackEventPayload[],
  requestId?: string,
): Promise<FeedbackIngestResponse> {
  const res = await activekgFetch('/feedback-events/ingest', {
    method: 'POST',
    tenantId,
    scopes: ACTIVEKG_SCOPES.WRITE,
    requestId,
    body: { events },
  });

  const body: any = await res.json();

  if (!res.ok) {
    throw new ActiveKGClientError(
      body.detail || `ActiveKG /feedback-events/ingest returned ${res.status}`,
      res.status,
      body,
    );
  }

  return body as FeedbackIngestResponse;
}


// =====================================================
// Resume refs (Stage-5B): which sourced candidates have a
// resume this tenant may see? Returns Flow application
// pointers keyed by lowercase linkedin slug.
// =====================================================

export interface ActiveKGResumeRef {
  application_id: string | number;
  org_id: string | number | null;
  resume_node_id: string | null;
  source_type: string;
}

export async function getResumeRefs(
  tenantId: string,
  linkedinIds: string[],
  requestId?: string,
): Promise<Record<string, ActiveKGResumeRef>> {
  if (linkedinIds.length === 0) return {};
  const res = await activekgFetch('/global-candidates/resume-refs', {
    method: 'POST',
    tenantId,
    scopes: ACTIVEKG_SCOPES.KG_READ,
    requestId,
    body: { linkedin_ids: linkedinIds },
  });
  if (!res.ok) {
    // 503 = global memory disabled; treat as "no resumes known", never fail the page.
    return {};
  }
  const body: any = await res.json().catch(() => null);
  return (body && body.refs) || {};
}

export type ContactSuppressionReason = 'hard_bounce' | 'complaint';

export interface ContactSuppressionResponse {
  suppressed: true;
  reason: ContactSuppressionReason;
  evidence: 'present' | 'absent';
  scope: 'address' | 'person';
  global_candidate_id: string | null;
  idempotent: boolean;
}

/**
 * Hygiene suppression is called by the durable Brevo outbox processor, outside
 * the transaction that records the local send fence.
 */
export const CONTACT_SUPPRESSION_TIMEOUT_MS = 5000;

export async function suppressContactEvidence(
  tenantId: string,
  input: {
    emailHash: string;
    reason: ContactSuppressionReason;
    providerEventId: string;
    signalCandidateId: string;
  },
  requestId?: string,
): Promise<ContactSuppressionResponse> {
  const res = await activekgFetch('/contact-evidence/suppress', {
    method: 'POST',
    tenantId,
    scopes: ACTIVEKG_SCOPES.CONTACT_SUPPRESS,
    requestId,
    timeoutMs: CONTACT_SUPPRESSION_TIMEOUT_MS,
    body: {
      email_hash: input.emailHash,
      reason: input.reason,
      provider_event_id: input.providerEventId,
      signal_candidate_id: input.signalCandidateId,
    },
  });
  const body: any = await res.json().catch(() => null);
  if (res.ok) {
    if (
      !body
      || body.suppressed !== true
      || body.reason !== input.reason
      || (body.evidence !== 'present' && body.evidence !== 'absent')
      || (body.scope !== 'address' && body.scope !== 'person')
      || (
        body.global_candidate_id !== null
        && typeof body.global_candidate_id !== 'string'
      )
      || typeof body.idempotent !== 'boolean'
    ) {
      throw new ActiveKGClientError(
        'ActiveKG returned an invalid contact suppression acknowledgement',
        502,
        body,
      );
    }
    return body as ContactSuppressionResponse;
  }

  throw new ActiveKGClientError(
    body?.detail || `ActiveKG /contact-evidence/suppress returned ${res.status}`,
    res.status,
    body,
  );
}
