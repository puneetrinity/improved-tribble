import { createHash } from "node:crypto";
import { z } from "zod";

export const organizationCandidateSourceKinds = ["direct_upload", "saved_resume"] as const;
export type OrganizationCandidateSourceKind = typeof organizationCandidateSourceKinds[number];

export function computeOrganizationCandidateIdempotencyKey(input: {
  organizationId: number;
  referenceId: string;
  applicationId: number;
  jobId: number;
  resumeVersionId: string;
  resumeVersion: 1;
  origin: "candidate_applied";
}): string {
  return createHash("sha256").update([
    "v1",
    `org_${input.organizationId}`,
    input.referenceId,
    input.applicationId,
    input.jobId,
    input.resumeVersionId,
    input.resumeVersion,
    input.origin,
  ].join("\0")).digest("hex");
}

export const organizationCandidateIntakeSchema = z.object({
  schema_version: z.literal(1),
  reference_id: z.string().uuid(),
  application_id: z.number().int().positive(),
  job_id: z.number().int().positive(),
  resume_version_id: z.string().uuid(),
  resume_version: z.literal(1),
  origin: z.literal("candidate_applied"),
  source_kind: z.enum(organizationCandidateSourceKinds),
  source_resume_id: z.number().int().positive().nullable(),
  source_observed_at: z.string().datetime({ offset: true }),
  content_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  byte_count: z.number().int().min(1).max(5 * 1024 * 1024),
  media_type: z.enum([
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ]),
  extracted_text_sha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  captured_at: z.string().datetime({ offset: true }),
  idempotency_key: z.string().regex(/^[0-9a-f]{64}$/),
  privacy_subject: z.array(z.object({
    identifier_type: z.enum([
      "email", "phone", "vantahire_application_id", "vantahire_resume_id",
    ]),
    value: z.string().min(1).max(2048),
  }).strict()).min(1).max(4),
}).strict().superRefine((value, context) => {
  const saved = value.source_kind === "saved_resume";
  if (saved !== (value.source_resume_id !== null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "invalid source shape" });
  }
});

export type OrganizationCandidateIntake = z.infer<typeof organizationCandidateIntakeSchema>;

export const organizationCandidateReceiptSchema = z.object({
  delivery_status: z.enum(["recorded", "replayed"]),
  resolution: z.enum(["created", "replayed"]),
  idempotency_key: z.string().regex(/^[0-9a-f]{64}$/),
  reference_id: z.string().uuid(),
  resume_version_id: z.string().uuid(),
  candidate_id: z.string().uuid(),
}).strict();

export type OrganizationCandidateReceipt = z.infer<typeof organizationCandidateReceiptSchema>;

export interface ClaimedOrganizationCandidateIntent {
  outboxId: string;
  referenceId: string;
  resumeVersionId: string;
  organizationId: number;
  applicationId: number;
  jobId: number;
  idempotencyKey: string;
  generation: number;
  attempts: number;
  sourceKind: OrganizationCandidateSourceKind;
  sourceResumeId: number | null;
  sourceObservedAt: Date;
  contentSha256: string;
  byteCount: number;
  mediaType: "application/pdf" | "application/msword" |
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  extractedTextSha256: string | null;
  capturedAt: Date;
}

export type OrganizationCandidateFailureCode =
  | "network" | "timeout" | "remote_408" | "remote_425" | "remote_429" | "remote_5xx"
  | "remote_400" | "remote_401" | "remote_403" | "remote_409" | "remote_422"
  | "invalid_response" | "identity_mismatch" | "source_missing"
  | "privacy_restricted" | "internal_error";
