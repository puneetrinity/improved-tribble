import { createHash } from "node:crypto";
import { z } from "zod";

export const CONSENT_PURPOSE = "platform_professional_matching" as const;
export const CONSENT_COPY_VERSION = 1 as const;
export const CONSENT_COPY = "I allow Ealana to use the professional profile shown here, and the resume version I select, for matching me with opportunities across organizations. This is optional and separate from my applications. I can withdraw this permission later. Applications already submitted stay with those organizations. Independently sourced public professional information is controlled separately through Privacy & Data.";
export const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
export const CONSENT_COPY_SHA256 = sha256(CONSENT_COPY);
export const CONSENT_SAVED_COPY = "Permission saved; matching from this approved copy is not active yet.";
export const CONSENT_UNAVAILABLE_COPY = "Temporarily unavailable, try again";

const validScalars = (value: string): boolean => !/[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(value);
const text = (min: number, max: number) => z.string().refine(validScalars)
  .transform(value => value.normalize("NFC").trim())
  .refine(value => [...value].length >= min && [...value].length <= max);
export const uuidSchema = z.string().uuid().refine(value => value === value.toLowerCase());
export const digestSchema = z.string().regex(/^[0-9a-f]{64}$/);
const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const int4 = positive.max(2_147_483_647);
export const timestampSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);
const linkedin = text(1, 2048).refine(value => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["linkedin.com", "www.linkedin.com"].includes(url.hostname)
      && !url.username && !url.password && !url.port && !url.search && !url.hash
      && /^\/in\/[a-zA-Z0-9_%.-]+\/?$/.test(url.pathname);
  } catch { return false; }
}).transform(value => `https://www.linkedin.com${new URL(value).pathname.replace(/\/$/, "")}`);

export const consentProfileSchema = z.object({
  display_name: text(1, 200), headline: text(0, 300), location: text(0, 200),
  skills: z.array(text(1, 100)).max(100).refine(value => new Set(value).size === value.length),
  linkedin: linkedin.nullable(),
}).strict().refine(value => Buffer.byteLength(JSON.stringify(value), "utf8") <= 32 * 1024);
export type ConsentProfile = z.infer<typeof consentProfileSchema>;

export const consentResumeSchema = z.object({
  reference_id: uuidSchema, resume_version_id: uuidSchema, organization_id: int4,
  application_id: int4, job_id: int4, content_sha256: digestSchema,
  byte_count: int4.max(5 * 1024 * 1024),
  media_type: z.enum(["application/pdf", "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]),
  source_observed_at: timestampSchema,
}).strict();
export type ConsentResume = z.infer<typeof consentResumeSchema>;
export const consentSourceSchema = z.object({
  source_id: uuidSchema, source_version: positive,
  profile: consentProfileSchema, resume: consentResumeSchema.nullable(),
}).strict();
export type ConsentSource = z.infer<typeof consentSourceSchema>;

const requestBase = {
  request_id: uuidSchema, expected_version: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
};
export const grantRequestSchema = z.object({
  ...requestBase, purpose: z.literal(CONSENT_PURPOSE), copy_version: z.literal(CONSENT_COPY_VERSION),
  copy_sha256: z.literal(CONSENT_COPY_SHA256), profile: consentProfileSchema,
  resume_version_id: uuidSchema.nullable(),
}).strict();
export const withdrawRequestSchema = z.object(requestBase).strict();
export type GrantRequest = z.infer<typeof grantRequestSchema>;
export type WithdrawRequest = z.infer<typeof withdrawRequestSchema>;

const commandFields = {
  schema_version: z.literal(1), subject_id: uuidSchema, event_id: uuidSchema, version: positive,
  purpose: z.literal(CONSENT_PURPOSE), purpose_version: z.literal(1), copy_version: z.literal(1),
  copy_sha256: z.literal(CONSENT_COPY_SHA256), captured_at: timestampSchema,
};
export const consentCommandSchema = z.discriminatedUnion("action", [
  z.object({ ...commandFields, action: z.literal("grant"), source: consentSourceSchema }).strict(),
  z.object({ ...commandFields, action: z.literal("withdraw"), source: z.null() }).strict(),
]).refine(value => value.source === null || value.source.source_version === value.version);
export type ConsentCommand = z.infer<typeof consentCommandSchema>;

export function resumeArray(resume: ConsentResume | null): unknown[] | null {
  return resume === null ? null : [resume.reference_id, resume.resume_version_id, resume.organization_id,
    resume.application_id, resume.job_id, resume.content_sha256, resume.byte_count, resume.media_type,
    resume.source_observed_at];
}
export function sourceArray(source: ConsentSource | null): unknown[] | null {
  return source === null ? null : [source.source_id, source.source_version, source.profile.display_name,
    source.profile.headline, source.profile.location, source.profile.skills, source.profile.linkedin,
    resumeArray(source.resume)];
}
export function canonicalConsentBytes(command: ConsentCommand): string {
  const c = consentCommandSchema.parse(command);
  return JSON.stringify([1, c.subject_id, c.event_id, c.version, c.action, c.purpose,
    c.copy_version, c.copy_sha256, sourceArray(c.source), c.captured_at]);
}
export function consentIdentity(command: ConsentCommand) {
  const commandDigest = sha256(canonicalConsentBytes(command));
  return {
    commandDigest,
    idempotencyKey: sha256(["candidate-consent:v1", command.subject_id, command.version,
      command.event_id, commandDigest].join("\0")),
  };
}
export function requestDigest(action: "grant" | "withdraw", request: GrantRequest | WithdrawRequest): string {
  // Normalize/browser-bind only; generated source/event ids and capture time are deliberately excluded.
  if (action === "withdraw") return sha256(JSON.stringify([action, request.request_id, request.expected_version]));
  const r = grantRequestSchema.parse(request);
  return sha256(JSON.stringify([action, r.request_id, r.expected_version, r.purpose, r.copy_version,
    r.copy_sha256, r.profile.display_name, r.profile.headline, r.profile.location, r.profile.skills,
    r.profile.linkedin, r.resume_version_id]));
}

export const privacyProofSchema = z.array(z.object({
  identifier_type: z.enum(["email", "vantahire_application_id", "vantahire_resume_id"]),
  value: z.string().min(1).max(2048).refine(validScalars),
}).strict()).min(1).max(3);
export interface ConsentGrantProof {
  verified_email: string;
  privacy_subject: z.infer<typeof privacyProofSchema>;
}
export const consentReceiptSchema = z.object({
  subject_id: uuidSchema, event_id: uuidSchema, version: positive,
  idempotency_key: digestSchema, command_digest: digestSchema,
  outcome: z.enum(["granted", "withdrawn", "replayed", "superseded", "identity_review_required"]),
  effective_action: z.enum(["grant", "withdraw"]).nullable(),
  effective_version: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
}).strict();
export type ConsentReceipt = z.infer<typeof consentReceiptSchema>;

export const consentFailureCodes = ["network", "timeout", "remote_retry", "remote_denied", "remote_conflict",
  "invalid_response", "identity_mismatch", "account_changed", "source_missing", "privacy_review",
  "privacy_restricted", "internal_error", "retry_exhausted", "superseded", "identity_review_required"] as const;
export type ConsentFailureCode = typeof consentFailureCodes[number];
export class CandidateConsentError extends Error {
  constructor(public readonly code: string, public readonly status = 409) { super(code); }
}
