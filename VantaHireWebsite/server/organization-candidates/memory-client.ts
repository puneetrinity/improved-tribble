import { signServiceJwt } from "../lib/services/jwt-signer";
import {
  organizationCandidateIntakeSchema,
  organizationCandidateReceiptSchema,
  type ClaimedOrganizationCandidateIntent,
  type OrganizationCandidateFailureCode,
  type OrganizationCandidateIntake,
  type OrganizationCandidateReceipt,
} from "./contracts";

const MAX_RESPONSE_BYTES = 64 * 1024;

export class OrganizationCandidateMemoryError extends Error {
  constructor(
    public readonly code: OrganizationCandidateFailureCode,
    public readonly retryable: boolean,
  ) {
    super(`organization_candidate_memory_${code}`);
  }
}

function memoryBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.ACTIVEKG_BASE_URL?.trim();
  if (!value) throw new OrganizationCandidateMemoryError("network", true);
  const parsed = new URL(value);
  if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
    throw new OrganizationCandidateMemoryError("network", true);
  }
  if (parsed.username || parsed.password) {
    throw new OrganizationCandidateMemoryError("network", true);
  }
  return value.replace(/\/+$/, "");
}

function statusError(status: number): OrganizationCandidateMemoryError {
  if (status === 408) return new OrganizationCandidateMemoryError("remote_408", true);
  if (status === 425) return new OrganizationCandidateMemoryError("remote_425", true);
  if (status === 429) return new OrganizationCandidateMemoryError("remote_429", true);
  if (status >= 500) return new OrganizationCandidateMemoryError("remote_5xx", true);
  if (status === 400) return new OrganizationCandidateMemoryError("remote_400", false);
  if (status === 401) return new OrganizationCandidateMemoryError("remote_401", false);
  if (status === 403) return new OrganizationCandidateMemoryError("remote_403", false);
  if (status === 409) return new OrganizationCandidateMemoryError("remote_409", false);
  if (status === 422) return new OrganizationCandidateMemoryError("remote_422", false);
  if (status === 451) return new OrganizationCandidateMemoryError("privacy_restricted", false);
  return new OrganizationCandidateMemoryError("invalid_response", false);
}

export function buildOrganizationCandidateEnvelope(
  claim: ClaimedOrganizationCandidateIntent,
  application: { email: string; phone: string | null },
): OrganizationCandidateIntake {
  const privacySubject: OrganizationCandidateIntake["privacy_subject"] = [
    { identifier_type: "vantahire_application_id", value: String(claim.applicationId) },
    { identifier_type: "email", value: application.email.trim().toLowerCase() },
  ];
  if (application.phone?.trim()) {
    privacySubject.push({ identifier_type: "phone", value: application.phone.trim() });
  }
  if (claim.sourceResumeId !== null) {
    privacySubject.push({
      identifier_type: "vantahire_resume_id",
      value: String(claim.sourceResumeId),
    });
  }
  return organizationCandidateIntakeSchema.parse({
    schema_version: 1,
    reference_id: claim.referenceId,
    application_id: claim.applicationId,
    job_id: claim.jobId,
    resume_version_id: claim.resumeVersionId,
    resume_version: 1,
    origin: "candidate_applied",
    source_kind: claim.sourceKind,
    source_resume_id: claim.sourceResumeId,
    source_observed_at: claim.sourceObservedAt.toISOString(),
    content_sha256: claim.contentSha256,
    byte_count: claim.byteCount,
    media_type: claim.mediaType,
    extracted_text_sha256: claim.extractedTextSha256,
    captured_at: claim.capturedAt.toISOString(),
    idempotency_key: claim.idempotencyKey,
    privacy_subject: privacySubject,
  });
}

export async function deliverOrganizationCandidate(
  claim: ClaimedOrganizationCandidateIntent,
  application: { email: string; phone: string | null },
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<OrganizationCandidateReceipt> {
  const envelope = buildOrganizationCandidateEnvelope(claim, application);
  const token = await signServiceJwt("activekg", {
    tenantId: `org_${claim.organizationId}`,
    scopes: "organization-candidate:write",
    requestId: claim.outboxId,
  });
  let response: Response;
  try {
    response = await fetchImpl(`${memoryBaseUrl()}/organization-candidates/intake`, {
      method: "POST",
      redirect: "error",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(envelope),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof OrganizationCandidateMemoryError) throw error;
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new OrganizationCandidateMemoryError("timeout", true);
    }
    throw new OrganizationCandidateMemoryError("network", true);
  }
  if (!response.ok) throw statusError(response.status);
  const length = Number(response.headers.get("content-length") ?? 0);
  if (!Number.isFinite(length) || length > MAX_RESPONSE_BYTES) {
    throw new OrganizationCandidateMemoryError("invalid_response", false);
  }
  let raw: string;
  try {
    raw = await response.text();
  } catch {
    throw new OrganizationCandidateMemoryError("invalid_response", false);
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_RESPONSE_BYTES) {
    throw new OrganizationCandidateMemoryError("invalid_response", false);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new OrganizationCandidateMemoryError("invalid_response", false);
  }
  const receipt = organizationCandidateReceiptSchema.safeParse(parsed);
  if (!receipt.success
      || receipt.data.idempotency_key !== claim.idempotencyKey
      || receipt.data.reference_id !== claim.referenceId
      || receipt.data.resume_version_id !== claim.resumeVersionId) {
    throw new OrganizationCandidateMemoryError("identity_mismatch", false);
  }
  return receipt.data;
}
