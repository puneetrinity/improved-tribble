import { describe, expect, it } from "vitest";

import {
  computeOrganizationCandidateIdempotencyKey,
  organizationCandidateIntakeSchema,
  organizationCandidateReceiptSchema,
} from "../contracts";

const intake = {
  schema_version: 1,
  reference_id: "11111111-1111-4111-8111-111111111111",
  application_id: 101,
  job_id: 51,
  resume_version_id: "22222222-2222-4222-8222-222222222222",
  resume_version: 1,
  origin: "candidate_applied",
  source_kind: "direct_upload",
  source_resume_id: null,
  source_observed_at: "2026-09-09T00:00:00.000Z",
  content_sha256: "a".repeat(64),
  byte_count: 1024,
  media_type: "application/pdf",
  extracted_text_sha256: "b".repeat(64),
  captured_at: "2026-09-09T00:00:00.000Z",
  idempotency_key: "c".repeat(64),
  privacy_subject: [
    { identifier_type: "vantahire_application_id", value: "101" },
    { identifier_type: "email", value: "candidate@example.invalid" },
  ],
} as const;

describe("organization-candidate wire contracts", () => {
  it("pins the same canonical idempotency vector as Memory", () => {
    expect(computeOrganizationCandidateIdempotencyKey({
      organizationId: 42,
      referenceId: "11111111-1111-4111-8111-111111111111",
      applicationId: 42,
      jobId: 7,
      resumeVersionId: "22222222-2222-4222-8222-222222222222",
      resumeVersion: 1,
      origin: "candidate_applied",
    })).toBe("b058485eb5868da8e7c7cd41968b193387f1d42236b48c68cbbc9c4ee81382ee");
  });

  it("accepts the exact PII-minimized v1 evidence envelope", () => {
    expect(organizationCandidateIntakeSchema.parse(intake)).toEqual(intake);
    expect(organizationCandidateIntakeSchema.parse({
      ...intake,
      source_kind: "saved_resume",
      source_resume_id: 9,
    })).toMatchObject({ source_kind: "saved_resume", source_resume_id: 9 });
  });

  it("rejects unknown fields, inconsistent sources, and oversized evidence", () => {
    expect(organizationCandidateIntakeSchema.safeParse({ ...intake, raw_resume: "private" }).success)
      .toBe(false);
    expect(organizationCandidateIntakeSchema.safeParse({
      ...intake, source_kind: "saved_resume", source_resume_id: null,
    }).success).toBe(false);
    expect(organizationCandidateIntakeSchema.safeParse({
      ...intake, byte_count: 5 * 1024 * 1024 + 1,
    }).success).toBe(false);
  });

  it("accepts only exact created/replayed receipts", () => {
    const receipt = {
      delivery_status: "recorded",
      resolution: "created",
      idempotency_key: intake.idempotency_key,
      reference_id: intake.reference_id,
      resume_version_id: intake.resume_version_id,
      candidate_id: "33333333-3333-4333-8333-333333333333",
    };
    expect(organizationCandidateReceiptSchema.parse(receipt)).toEqual(receipt);
    expect(organizationCandidateReceiptSchema.safeParse({ ...receipt, profile: {} }).success)
      .toBe(false);
  });
});
