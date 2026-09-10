import { generateKeyPairSync, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearKeyCache } from "../../lib/services/jwt-signer";
import type { ClaimedOrganizationCandidateIntent } from "../contracts";
import {
  buildOrganizationCandidateEnvelope,
  deliverOrganizationCandidate,
  OrganizationCandidateMemoryError,
} from "../memory-client";

const claim: ClaimedOrganizationCandidateIntent = {
  outboxId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  referenceId: "11111111-1111-4111-8111-111111111111",
  resumeVersionId: "22222222-2222-4222-8222-222222222222",
  organizationId: 41,
  applicationId: 101,
  jobId: 51,
  idempotencyKey: "c".repeat(64),
  generation: 1,
  attempts: 1,
  sourceKind: "saved_resume",
  sourceResumeId: 9,
  sourceObservedAt: new Date("2026-09-09T00:00:00.000Z"),
  contentSha256: "a".repeat(64),
  byteCount: 1024,
  mediaType: "application/pdf",
  extractedTextSha256: "b".repeat(64),
  capturedAt: new Date("2026-09-09T00:00:00.000Z"),
};

describe("organization-candidate Memory client", () => {
  beforeEach(() => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    process.env.VANTAHIRE_JWT_PRIVATE_KEY = privateKey
      .export({ type: "pkcs8", format: "pem" }).toString();
    process.env.ACTIVEKG_BASE_URL = "https://memory.example.invalid";
    clearKeyCache();
  });

  afterEach(() => {
    delete process.env.VANTAHIRE_JWT_PRIVATE_KEY;
    delete process.env.ACTIVEKG_BASE_URL;
    clearKeyCache();
    vi.restoreAllMocks();
  });

  it("builds the exact private envelope without resume bytes, text, or locator", () => {
    const envelope = buildOrganizationCandidateEnvelope(claim, {
      email: " Candidate@Example.Invalid ", phone: "+1 555 000 0000",
    });
    expect(envelope.privacy_subject).toEqual([
      { identifier_type: "vantahire_application_id", value: "101" },
      { identifier_type: "email", value: "candidate@example.invalid" },
      { identifier_type: "phone", value: "+1 555 000 0000" },
      { identifier_type: "vantahire_resume_id", value: "9" },
    ]);
    expect(JSON.stringify(envelope)).not.toMatch(/locator|extracted_text[^_]|resume_bytes/i);
  });

  it("signs an exact tenant/service token and accepts only a matching receipt", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(init?.redirect).toBe("error");
      const token = String((init?.headers as Record<string, string>).authorization)
        .replace("Bearer ", "");
      const payload = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString());
      expect(payload).toMatchObject({
        iss: "vantahire", sub: "vantahire-backend", aud: "activekg",
        tenant_id: "org_41", scopes: "organization-candidate:write",
        actor_type: "service", request_id: claim.outboxId,
      });
      return new Response(JSON.stringify({
        delivery_status: "recorded", resolution: "created",
        idempotency_key: claim.idempotencyKey,
        reference_id: claim.referenceId,
        resume_version_id: claim.resumeVersionId,
        candidate_id: "33333333-3333-4333-8333-333333333333",
      }), { status: 200 });
    });
    await expect(deliverOrganizationCandidate(
      claim, { email: "candidate@example.invalid", phone: null }, 5_000,
      fetcher as typeof fetch,
    )).resolves.toMatchObject({ resolution: "created" });
  });

  it.each([
    [408, "remote_408", true], [425, "remote_425", true], [429, "remote_429", true],
    [500, "remote_5xx", true], [400, "remote_400", false], [401, "remote_401", false],
    [403, "remote_403", false], [409, "remote_409", false], [422, "remote_422", false],
    [451, "privacy_restricted", false],
  ])("classifies HTTP %i without consuming a private response body", async (status, code, retryable) => {
    const response = new Response("PRIVATE REMOTE BODY", { status });
    const text = vi.spyOn(response, "text");
    await expect(deliverOrganizationCandidate(
      claim, { email: "candidate@example.invalid", phone: null }, 5_000,
      vi.fn(async () => response) as typeof fetch,
    )).rejects.toMatchObject({ code, retryable });
    expect(text).not.toHaveBeenCalled();
  });

  it("refuses malformed, oversized and identity-mismatched successes", async () => {
    const base = {
      delivery_status: "recorded", resolution: "created",
      idempotency_key: claim.idempotencyKey,
      reference_id: claim.referenceId,
      resume_version_id: claim.resumeVersionId,
      candidate_id: "33333333-3333-4333-8333-333333333333",
    };
    const cases = [
      new Response("x".repeat(65 * 1024), { status: 200 }),
      new Response("not-json", { status: 200 }),
      new Response(JSON.stringify({ ...base, reference_id: randomUUID() }), { status: 200 }),
    ];
    for (const response of cases) {
      await expect(deliverOrganizationCandidate(
        claim, { email: "candidate@example.invalid", phone: null }, 5_000,
        vi.fn(async () => response) as typeof fetch,
      )).rejects.toBeInstanceOf(OrganizationCandidateMemoryError);
    }
  });
});
