import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  computeOrganizationCandidateIdempotencyKey,
  type OrganizationCandidateSourceKind,
} from "./contracts";
import {
  CandidatePrivacyRestrictedError,
  requireCandidatePrivacyAllowed,
} from "../candidate-privacy/decision";
import { loadCandidatePrivacyConfig } from "../candidate-privacy/config";
import { checkMemoryEligibility } from "../candidate-privacy/memory-client";

export const MAX_PRIVATE_RESUME_BYTES = 5 * 1024 * 1024;
export const MAX_PRIVATE_EXTRACTED_TEXT_BYTES = 2 * 1024 * 1024;

export type PrivateResumeMediaType =
  | "application/pdf"
  | "application/msword"
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export interface PinnedResumeEvidence {
  sourceKind: OrganizationCandidateSourceKind;
  sourceResumeId: number | null;
  sourceObservedAt: Date;
  gcsLocator: string;
  contentSha256: string;
  byteCount: number;
  mediaType: PrivateResumeMediaType;
  extractedText: string | null;
  extractedTextSha256: string | null;
  capturedAt: Date;
}

export async function requireOrganizationCandidateApplicationAllowed(input: {
  userId?: number;
  applicationId?: number;
  email: string;
  phone?: string | null;
}): Promise<void> {
  if (input.applicationId) {
    await requireCandidatePrivacyAllowed(
      { type: "application", id: input.applicationId },
      // The repository's historical newGlobalOperation flag enforces feed
      // freshness independently of globalUse; private intake must retain it.
      { globalUse: false, newGlobalOperation: true },
    );
    return;
  }
  if (input.userId) {
    await requireCandidatePrivacyAllowed(
      { type: "candidate_user", id: input.userId },
      { globalUse: false, newGlobalOperation: true },
    );
    return;
  }
  const identifiers: Array<{ identifier_type: "email" | "phone"; value: string }> = [
    { identifier_type: "email", value: input.email.trim().toLowerCase() },
  ];
  if (input.phone?.trim()) {
    identifiers.push({ identifier_type: "phone", value: input.phone.trim() });
  }
  let decision: "allow" | "block_global" | "block_all" | "review";
  try {
    const config = loadCandidatePrivacyConfig();
    decision = await checkMemoryEligibility({
      requestRef: randomUUID(),
      identifiers,
      timeoutMs: config.memoryTimeoutMs,
    });
  } catch {
    throw new CandidatePrivacyRestrictedError("candidate_privacy_unavailable");
  }
  if (decision === "review") {
    throw new CandidatePrivacyRestrictedError("candidate_privacy_review_required");
  }
  if (decision === "block_all") {
    throw new CandidatePrivacyRestrictedError("candidate_privacy_restricted");
  }
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function privateResumeMediaType(filename: string): PrivateResumeMediaType {
  const extension = filename.split(".").pop()?.trim().toLowerCase();
  if (extension === "pdf") return "application/pdf";
  if (extension === "doc") return "application/msword";
  if (extension === "docx") {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  throw new Error("PRIVATE_RESUME_MEDIA_TYPE_REFUSED");
}

export function pinPrivateResumeEvidence(input: {
  bytes: Buffer;
  filename: string;
  gcsLocator: string;
  sourceKind: OrganizationCandidateSourceKind;
  sourceResumeId: number | null;
  sourceObservedAt: Date;
  extractedText: string | null;
  capturedAt: Date;
}): PinnedResumeEvidence {
  if (input.bytes.length < 1 || input.bytes.length > MAX_PRIVATE_RESUME_BYTES) {
    throw new Error("PRIVATE_RESUME_SIZE_REFUSED");
  }
  if (!/^gs:\/\/[^/]+\/.{1,2000}$/.test(input.gcsLocator)) {
    throw new Error("PRIVATE_RESUME_LOCATOR_REFUSED");
  }
  const sourceShapeValid = input.sourceKind === "saved_resume"
    ? Number.isSafeInteger(input.sourceResumeId) && Number(input.sourceResumeId) > 0
    : input.sourceResumeId === null;
  if (!sourceShapeValid) throw new Error("PRIVATE_RESUME_SOURCE_REFUSED");
  const extractedBytes = input.extractedText === null
    ? 0
    : Buffer.byteLength(input.extractedText, "utf8");
  if (input.extractedText !== null
      && (extractedBytes < 1 || extractedBytes > MAX_PRIVATE_EXTRACTED_TEXT_BYTES)) {
    throw new Error("PRIVATE_RESUME_TEXT_REFUSED");
  }
  return {
    sourceKind: input.sourceKind,
    sourceResumeId: input.sourceResumeId,
    sourceObservedAt: input.sourceObservedAt,
    gcsLocator: input.gcsLocator,
    contentSha256: sha256(input.bytes),
    byteCount: input.bytes.length,
    mediaType: privateResumeMediaType(input.filename),
    extractedText: input.extractedText,
    extractedTextSha256: input.extractedText === null ? null : sha256(input.extractedText),
    capturedAt: input.capturedAt,
  };
}

export async function appendOrganizationCandidateApplicationEvidence(input: {
  executor: { execute(query: unknown): Promise<unknown> };
  organizationId: number;
  applicationId: number;
  jobId: number;
  evidence: PinnedResumeEvidence;
  expectedSavedResumeUpdatedAt: Date | null;
}): Promise<{ referenceId: string; resumeVersionId: string; outboxId: string }> {
  const referenceId = randomUUID();
  const resumeVersionId = randomUUID();
  const outboxId = randomUUID();
  const idempotencyKey = computeOrganizationCandidateIdempotencyKey({
    organizationId: input.organizationId,
    referenceId,
    applicationId: input.applicationId,
    jobId: input.jobId,
    resumeVersionId,
    resumeVersion: 1,
    origin: "candidate_applied",
  });
  const now = input.evidence.capturedAt;
  const result = await input.executor.execute(sql`
    WITH saved_resume_pin AS (
      SELECT id
      FROM candidate_resumes
      WHERE ${input.evidence.sourceKind} = 'direct_upload'
         OR (
           id = ${input.evidence.sourceResumeId}
           AND updated_at = ${input.expectedSavedResumeUpdatedAt}
           AND gcs_path = ${input.evidence.gcsLocator}
         )
      LIMIT 1
    ), reference_insert AS (
      INSERT INTO organization_candidate_references (
        reference_id,organization_id,application_id,job_id,origin_code,schema_version,created_at
      )
      SELECT ${referenceId}::uuid,${input.organizationId},${input.applicationId},${input.jobId},
             'candidate_applied',1,${now}
      WHERE ${input.evidence.sourceKind} = 'direct_upload' OR EXISTS (SELECT 1 FROM saved_resume_pin)
      RETURNING reference_id
    ), resume_insert AS (
      INSERT INTO application_resume_versions (
        resume_version_id,reference_id,organization_id,application_id,job_id,version,
        source_kind,source_resume_id,source_observed_at,gcs_locator,content_sha256,byte_count,
        media_type,extracted_text,extracted_text_sha256,captured_at,created_at
      )
      SELECT ${resumeVersionId}::uuid,reference_id,${input.organizationId},${input.applicationId},
             ${input.jobId},1,${input.evidence.sourceKind},${input.evidence.sourceResumeId},
             ${input.evidence.sourceObservedAt},${input.evidence.gcsLocator},
             ${input.evidence.contentSha256},${input.evidence.byteCount},${input.evidence.mediaType},
             ${input.evidence.extractedText},${input.evidence.extractedTextSha256},${now},${now}
      FROM reference_insert
      RETURNING resume_version_id,reference_id
    ), outbox_insert AS (
      INSERT INTO organization_candidate_memory_outbox (
        outbox_id,reference_id,resume_version_id,organization_id,application_id,job_id,
        idempotency_key,state,attempts,generation,next_attempt_at,created_at,updated_at
      )
      SELECT ${outboxId}::uuid,reference_id,resume_version_id,${input.organizationId},
             ${input.applicationId},${input.jobId},${idempotencyKey},'pending',0,0,${now},${now},${now}
      FROM resume_insert
      RETURNING 1 AS inserted
    )
    SELECT
      (SELECT count(*)::integer FROM reference_insert) AS references,
      (SELECT count(*)::integer FROM resume_insert) AS versions,
      (SELECT count(*)::integer FROM outbox_insert) AS intents
  `);
  const rows = (result as { rows?: Array<Record<string, unknown>> }).rows ?? [];
  const row = rows[0];
  if (!row || Number(row.references) !== 1 || Number(row.versions) !== 1
      || Number(row.intents) !== 1) {
    throw new Error("ORGANIZATION_CANDIDATE_EVIDENCE_NOT_WRITTEN");
  }
  return { referenceId, resumeVersionId, outboxId };
}
