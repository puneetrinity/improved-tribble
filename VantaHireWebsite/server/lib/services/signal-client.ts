/**
 * Signal v3 HTTP client.
 *
 * Wraps Signal API endpoints with JWT auth, typed request/response,
 * and structured error handling. Uses SIGNAL_BASE_URL env var.
 */

import { signServiceJwt } from './jwt-signer';
import {
  SIGNAL_SCOPES,
  signalRcProgressSchema,
  type SignalRcProgress,
  type SignalSourceRequest,
  type SignalSourceResponse,
  type SignalResultsResponse,
} from './signal-contracts';
import type { ContactResolutionResponse } from '../contactResolutionCore';

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
    timeoutMs?: number;
    redirect?: 'error' | 'follow' | 'manual';
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
    ...(opts.timeoutMs ? { signal: AbortSignal.timeout(opts.timeoutMs) } : {}),
    ...(opts.redirect ? { redirect: opts.redirect } : {}),
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

/** Read-only progress; deliberately never invokes result synchronization. */
export async function getRcProgress(
  tenantId: string, externalJobId: string, requestId: string,
): Promise<SignalRcProgress | null> {
  const params = new URLSearchParams({ requestId, progressOnly: '1' });
  const response = await signalFetch(
    `/api/v3/jobs/${encodeURIComponent(externalJobId)}/results?${params}`,
    { method: 'GET', tenantId, requestId, scopes: SIGNAL_SCOPES.RESULTS,
      timeoutMs: 10_000, redirect: 'error' },
  );
  if (response.status === 404) { await response.body?.cancel(); return null; }
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
    await response.body?.cancel();
    throw new SignalApiError('Sourcing status temporarily unavailable', response.status);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new SignalApiError('Sourcing status temporarily unavailable', 503);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 4096) throw new Error('Response too large');
      chunks.push(part.value);
    }
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some(key => key !== 'success' && key !== 'rcProgress')
      || (body as {success?: unknown}).success !== true) throw new Error('Invalid envelope');
    return signalRcProgressSchema.parse((body as {rcProgress?: unknown}).rcProgress);
  } catch {
    await reader.cancel().catch(() => undefined);
    throw new SignalApiError('Sourcing status temporarily unavailable', 503);
  } finally { reader.releaseLock(); }
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
export function normalizeContactResolutionResponse(
  body: any,
  httpStatus: number,
): ContactResolutionResponse {
  const emails = Array.isArray(body.emails)
    ? body.emails.filter((email: unknown): email is string => typeof email === 'string')
    : [];
  const responseState = body.state;
  const state = httpStatus === 202
    ? 'pending'
    : responseState === 'found'
      || responseState === 'suppressed'
      || responseState === 'not_found'
      || responseState === 'pending'
      ? responseState
      : emails.length > 0
        ? 'found'
        : 'not_found';

  return {
    success: typeof body.success === 'boolean' ? body.success : state !== 'pending',
    state,
    emails,
  };
}

function getContactResolutionTimeoutMs(): number {
  const parsed = Number.parseInt(
    process.env.CONTACT_RESOLUTION_SIGNAL_TIMEOUT_MS || '',
    10,
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 90_000;
}

export async function findContact(
  tenantId: string,
  externalCandidateId: string,
  externalJobId: string,
): Promise<ContactResolutionResponse> {
  const res = await signalFetch(
    `/api/v3/candidates/${encodeURIComponent(externalCandidateId)}/find-contact`,
    {
      method: 'POST',
      tenantId,
      scopes: SIGNAL_SCOPES.CONTACT,
      timeoutMs: getContactResolutionTimeoutMs(),
      body: {
        trigger: 'shortlist',
        jobId: externalJobId,
      },
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

  return normalizeContactResolutionResponse(body, res.status);
}

const GOVERNED_REMOTE_CODES=new Set([
  'GOVERNED_DISABLED','GOVERNED_TENANT_REQUIRED','GOVERNED_BODY_TOO_LARGE',
  'GOVERNED_INVALID_COMMAND','GOVERNED_UNAVAILABLE','GOVERNED_PREVIEW_UNAVAILABLE',
]);
const GOVERNED_FAILURES=new Set(['TIMEOUT','CONNECTION','REDIRECT','RESPONSE_TOO_LARGE','INVALID_JSON','INVALID_RESPONSE','UNAVAILABLE']);
/** Only closed diagnostics survive this boundary; never retain the original error or body. */
export class GovernedTransportError extends Error {
  readonly diagnostic:string;
  constructor(status:number|null,code:string) {
    const remote=Number.isInteger(status) && status!>=300 && status!<=599;
    const safe=remote
      ? GOVERNED_REMOTE_CODES.has(code)||['AUTH_INVALID_TOKEN','AUTH_INVALID_CLAIM'].includes(code)?code:'UNLISTED'
      : GOVERNED_FAILURES.has(code)?code:'UNAVAILABLE';
    const diagnostic=remote?`REMOTE_${status}:${safe}`:`TRANSPORT:${safe}`;
    super(diagnostic);this.name='GovernedTransportError';this.diagnostic=diagnostic;
  }
}
export function governedTransportDiagnostic(error:unknown):string {
  // Reconstruct even typed diagnostics so caller mutation cannot introduce arbitrary log text.
  if(error instanceof GovernedTransportError) {
    const match=/^REMOTE_(\d{3}):([A-Z_]+)$/.exec(error.diagnostic);
    return match?new GovernedTransportError(Number(match[1]),match[2]!).diagnostic:
      new GovernedTransportError(null,error.diagnostic.replace(/^TRANSPORT:/,'')).diagnostic;
  }
  return 'TRANSPORT:UNAVAILABLE';
}

/** Governed sourcing transport: fixed endpoints, bounded request/response and
 * no redirects. An uncertain response is replayed using the same durable ID. */
export async function governedSignalPost(input: {
  kind:'source'|'preview';tenantId:string;externalJobId:string;requestId:string;body:unknown;
}):Promise<unknown> {
  if(!/^vanta:jobs:[1-9][0-9]*$/.test(input.externalJobId))throw Error('SOURCING_INVALID_TARGET');
  const base=new URL(getBaseUrl());
  if(base.username || base.password || base.hash || base.search ||
    (process.env.NODE_ENV==='production' ? base.protocol!=='https:' : !['https:','http:'].includes(base.protocol)))throw Error('SOURCING_INVALID_TARGET');
  const encoded=JSON.stringify(input.body);
  if(Buffer.byteLength(encoded,'utf8')>131072)throw Error('SOURCING_BODY_TOO_LARGE');
  const token=await signServiceJwt('signal',{tenantId:input.tenantId,
    scopes:input.kind==='source'?'jobs:source':'jobs:preview',requestId:input.requestId});
  const deadline=AbortSignal.timeout(30000);
  let response:Response;
  try {response=await fetch(`${base.toString().replace(/\/+$/,'')}/api/v3/jobs/${encodeURIComponent(input.externalJobId)}/${input.kind}`,{
    method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
    body:encoded,signal:deadline,redirect:'manual',
  });}catch{throw new GovernedTransportError(null,deadline.aborted?'TIMEOUT':'CONNECTION');}
  if(response.status>=300 && response.status<400){await response.body?.cancel().catch(()=>undefined);throw new GovernedTransportError(null,'REDIRECT');}
  if(!response.body)throw new GovernedTransportError(response.ok?null:response.status,response.ok?'INVALID_RESPONSE':'UNLISTED');
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let bytes=0;
  try {
    while(true){const {done,value}=await reader.read();if(done)break;
      bytes+=value.byteLength;if(bytes>(response.ok?131072:4096))throw new GovernedTransportError(response.ok?null:response.status,response.ok?'RESPONSE_TOO_LARGE':'UNLISTED');chunks.push(value);}
    let body:unknown;
    try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}
    catch{throw new GovernedTransportError(response.ok?null:response.status,response.ok?'INVALID_JSON':'UNLISTED');}
    if(!response.ok){
      const code=body && typeof body==='object'?(body as {error?:unknown}).error:undefined;
      const safe=response.status===401 && code==='Invalid token'?'AUTH_INVALID_TOKEN':
        response.status===403 && code==='Invalid token claim'?'AUTH_INVALID_CLAIM':
        typeof code==='string' && GOVERNED_REMOTE_CODES.has(code)?code:'UNLISTED';
      throw new GovernedTransportError(response.status,safe);
    }
    return body;
  }catch(error){
    if(error instanceof GovernedTransportError)throw error;
    throw new GovernedTransportError(response.ok?null:response.status,deadline.aborted?'TIMEOUT':'CONNECTION');
  }finally{await reader.cancel().catch(()=>undefined);reader.releaseLock();}
}
