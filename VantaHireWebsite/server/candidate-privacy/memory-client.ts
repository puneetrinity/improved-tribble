import { signServiceJwt } from "../lib/services/jwt-signer";
import {
  memoryChangesSchema,
  memoryDirectiveResponseSchema,
  memoryEligibilitySchema,
  memorySnapshotSchema,
  decisionForRemote,
  type MemoryDirectiveResponse,
  type PrivacyAction,
  type PrivacyAuthority,
  type PrivacyIdentifier,
  type PrivacyReason,
} from "./models";

export class CandidatePrivacyMemoryError extends Error {
  constructor(
    public readonly code: "unavailable" | "conflict" | "intake_disabled" | "invalid_response",
    public readonly retryable: boolean,
  ) {
    super(`candidate_privacy_memory_${code}`);
  }
}

function baseUrl(): string {
  const value = process.env.ACTIVEKG_BASE_URL;
  if (!value) throw new CandidatePrivacyMemoryError("unavailable", true);
  return value.replace(/\/+$/, "");
}

async function boundedFetch(
  path: string,
  init: RequestInit,
  scope: "candidate-privacy:read" | "candidate-privacy:write",
  timeoutMs: number,
): Promise<unknown> {
  const token = await signServiceJwt("activekg", {
    tenantId: "platform",
    scopes: scope,
  });
  let response: Response;
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new CandidatePrivacyMemoryError("unavailable", true);
  }
  if (!response.ok) {
    // Never retain or log Memory's body. Status is sufficient for retry policy.
    if (response.status === 409) throw new CandidatePrivacyMemoryError("conflict", false);
    if (response.status === 503) {
      throw new CandidatePrivacyMemoryError("intake_disabled", true);
    }
    throw new CandidatePrivacyMemoryError("unavailable", response.status === 429 || response.status >= 500);
  }
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > 256 * 1024) throw new CandidatePrivacyMemoryError("invalid_response", false);
  try {
    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > 256 * 1024) {
      throw new CandidatePrivacyMemoryError("invalid_response", false);
    }
    return JSON.parse(body);
  } catch {
    throw new CandidatePrivacyMemoryError("invalid_response", false);
  }
}

export async function createMemoryDirective(input: {
  requestId: string;
  action: PrivacyAction;
  authorityType: PrivacyAuthority;
  evidenceRef: string;
  reasonCode: PrivacyReason;
  identifiers: PrivacyIdentifier[];
  timeoutMs: number;
}): Promise<MemoryDirectiveResponse> {
  const parsed = memoryDirectiveResponseSchema.safeParse(await boundedFetch(
    "/candidate-privacy/directives",
    {
      method: "POST",
      body: JSON.stringify({
        request_id: input.requestId,
        action: input.action,
        authority_type: input.authorityType,
        evidence_ref: input.evidenceRef,
        reason_code: input.reasonCode,
        identifiers: input.identifiers,
      }),
    },
    "candidate-privacy:write",
    input.timeoutMs,
  ));
  const expectedScope = input.action === "request_erasure" ? "active_profile" : "global_matching";
  if (!parsed.success
    || parsed.data.request_id !== input.requestId
    || parsed.data.action !== input.action
    || parsed.data.scope !== expectedScope
    || parsed.data.decision !== decisionForRemote(parsed.data.state, parsed.data.action)) {
    throw new CandidatePrivacyMemoryError("invalid_response", false);
  }
  return parsed.data;
}

export async function readMemoryChanges(input: {
  afterCursor: number;
  limit: number;
  timeoutMs: number;
}) {
  const query = new URLSearchParams({
    after_cursor: String(input.afterCursor),
    limit: String(input.limit),
  });
  const parsed = memoryChangesSchema.safeParse(await boundedFetch(
    `/candidate-privacy/changes?${query.toString()}`,
    { method: "GET" },
    "candidate-privacy:read",
    input.timeoutMs,
  ));
  if (!parsed.success || parsed.data.count !== parsed.data.events.length) {
    throw new CandidatePrivacyMemoryError("invalid_response", false);
  }
  return parsed.data;
}

export async function checkMemoryEligibility(input: {
  requestRef: string;
  identifiers: PrivacyIdentifier[];
  timeoutMs: number;
}) {
  const parsed = memoryEligibilitySchema.safeParse(await boundedFetch(
    "/candidate-privacy/eligibility/batch",
    {
      method: "POST",
      body: JSON.stringify({
        subjects: [{ request_ref: input.requestRef, identifiers: input.identifiers }],
      }),
    },
    "candidate-privacy:read",
    input.timeoutMs,
  ));
  if (!parsed.success || parsed.data.results[0]?.request_ref !== input.requestRef) {
    throw new CandidatePrivacyMemoryError("invalid_response", false);
  }
  return parsed.data.results[0].decision;
}

export async function checkMemoryEligibilityBatch(input: {
  subjects: Array<{ requestRef: string; identifiers: PrivacyIdentifier[] }>;
  timeoutMs: number;
}): Promise<Map<string, "allow" | "block_global" | "block_all" | "review">> {
  if (input.subjects.length < 1 || input.subjects.length > 200) {
    throw new CandidatePrivacyMemoryError("invalid_response", false);
  }
  const parsed = memoryEligibilitySchema.safeParse(await boundedFetch(
    "/candidate-privacy/eligibility/batch",
    {
      method: "POST",
      body: JSON.stringify({
        subjects: input.subjects.map((subject) => ({
          request_ref: subject.requestRef,
          identifiers: subject.identifiers,
        })),
      }),
    },
    "candidate-privacy:read",
    input.timeoutMs,
  ));
  if (!parsed.success || parsed.data.count !== input.subjects.length) {
    throw new CandidatePrivacyMemoryError("invalid_response", false);
  }
  const decisions = new Map(parsed.data.results.map((result) => [result.request_ref, result.decision]));
  if (decisions.size !== input.subjects.length
    || input.subjects.some((subject) => !decisions.has(subject.requestRef))) {
    throw new CandidatePrivacyMemoryError("invalid_response", false);
  }
  return decisions;
}

export async function readMemorySnapshot(input: {
  afterDirectiveId?: string;
  highWaterCursor?: number;
  limit: number;
  timeoutMs: number;
}) {
  const query = new URLSearchParams({ limit: String(input.limit) });
  if (input.afterDirectiveId) query.set("after_directive_id", input.afterDirectiveId);
  if (input.highWaterCursor !== undefined) query.set("high_water_cursor", String(input.highWaterCursor));
  const parsed = memorySnapshotSchema.safeParse(await boundedFetch(
    `/candidate-privacy/snapshot?${query.toString()}`,
    { method: "GET" },
    "candidate-privacy:read",
    input.timeoutMs,
  ));
  if (!parsed.success || parsed.data.count !== parsed.data.directives.length) {
    throw new CandidatePrivacyMemoryError("invalid_response", false);
  }
  return parsed.data;
}
