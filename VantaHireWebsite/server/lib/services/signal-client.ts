/**
 * Signal v3 HTTP client.
 *
 * Wraps Signal API endpoints with JWT auth, typed request/response,
 * and structured error handling. Uses SIGNAL_BASE_URL env var.
 */

import { signServiceJwt } from './jwt-signer';
import {
  SIGNAL_SCOPES,
  type SignalSourceRequest,
  type SignalSourceResponse,
  type SignalResultsResponse,
} from './signal-contracts';

function getBaseUrl(): string {
  const url = process.env.SIGNAL_BASE_URL;
  if (!url) {
    throw new Error('SIGNAL_BASE_URL environment variable is not set');
  }
  return url.replace(/\/+$/, '');
}

export class SignalApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'SignalApiError';
  }
}

async function signalFetch(
  path: string,
  opts: {
    method: 'GET' | 'POST';
    tenantId: string;
    scopes: string;
    requestId?: string;
    body?: unknown;
  },
): Promise<Response> {
  const token = await signServiceJwt('signal', {
    tenantId: opts.tenantId,
    scopes: opts.scopes,
    ...(opts.requestId != null ? { requestId: opts.requestId } : {}),
  });

  const url = `${getBaseUrl()}${path}`;
  const res = await fetch(url, {
    method: opts.method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  });

  return res;
}

/**
 * Safely parse a Signal response as JSON.
 * If Signal returns a non-JSON body (e.g. HTML error page during startup/crash),
 * this throws a SignalApiError instead of crashing with "Unexpected end of JSON input".
 */
async function safeJson(res: Response): Promise<any> {
  const text = await res.text();
  if (!text || !text.trim()) {
    throw new SignalApiError(
      `Signal returned empty response (status ${res.status}) — it may still be starting up`,
      res.status,
    );
  }
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new SignalApiError(
      `Signal returned non-JSON response (status ${res.status}): ${text.substring(0, 200)}`,
      res.status,
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new SignalApiError(
      `Signal returned malformed JSON (status ${res.status}): ${text.substring(0, 200)}`,
      res.status,
    );
  }
}

/**
 * POST /api/v3/jobs/{externalJobId}/source
 *
 * Submits a sourcing request to Signal. Returns the requestId for tracking.
 * Signal may return idempotent=true if a matching active request already exists.
 */
export async function sourceJob(
  tenantId: string,
  externalJobId: string,
  request: SignalSourceRequest,
): Promise<SignalSourceResponse> {
  const res = await signalFetch(
    `/api/v3/jobs/${encodeURIComponent(externalJobId)}/source`,
    {
      method: 'POST',
      tenantId,
      scopes: SIGNAL_SCOPES.SOURCE,
      body: request,
    },
  );

  const body: any = await safeJson(res);

  if (!res.ok) {
    throw new SignalApiError(
      body.error || `Signal /source returned ${res.status}`,
      res.status,
      body,
    );
  }

  return body as SignalSourceResponse;
}

/**
 * GET /api/v3/jobs/{externalJobId}/results?requestId=...
 *
 * Fetches sourcing results from Signal. Called after callback notification
 * or for polling status.
 */
export async function getResults(
  tenantId: string,
  externalJobId: string,
  requestId: string,
  includeSummary: boolean = true,
): Promise<SignalResultsResponse> {
  const params = new URLSearchParams({ requestId });
  if (includeSummary) {
    params.append('includeSummary', 'true');
  }
  const res = await signalFetch(
    `/api/v3/jobs/${encodeURIComponent(externalJobId)}/results?${params}`,
    {
      method: 'GET',
      tenantId,
      scopes: SIGNAL_SCOPES.RESULTS,
      requestId,
    },
  );

  const body: any = await safeJson(res);

  if (!res.ok) {
    throw new SignalApiError(
      body.error || `Signal /results returned ${res.status}`,
      res.status,
      body,
    );
  }

  return body as SignalResultsResponse;
}

/**
 * POST /api/v3/jobs/{externalJobId}/enrich-batch
 */
export async function enrichBatch(
  tenantId: string,
  externalJobId: string,
  candidateIds: number[],
): Promise<{ enrichedCount: number }> {
  const res = await signalFetch(
    `/api/v3/jobs/${encodeURIComponent(externalJobId)}/enrich-batch`,
    {
      method: 'POST',
      tenantId,
      scopes: SIGNAL_SCOPES.SOURCE,
      body: { candidateIds },
    },
  );

  const body: any = await safeJson(res);

  if (!res.ok) {
    throw new SignalApiError(
      body.error || `Signal /enrich-batch returned ${res.status}`,
      res.status,
      body,
    );
  }

  return body;
}

/**
 * POST /api/v3/candidates/{externalCandidateId}/find-contact
 */
export async function findContact(
  tenantId: string,
  externalCandidateId: string,
): Promise<{ emails: string[], success: boolean }> {
  const res = await signalFetch(
    `/api/v3/candidates/${encodeURIComponent(externalCandidateId)}/find-contact`,
    {
      method: 'POST',
      tenantId,
      scopes: SIGNAL_SCOPES.SOURCE,
    },
  );

  const body: any = await safeJson(res);

  if (!res.ok) {
    throw new SignalApiError(
      body.error || `Signal /find-contact returned ${res.status}`,
      res.status,
      body,
    );
  }

  return body;
}
