import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearKeyCache } from "../../lib/services/jwt-signer";
import { deliverDecisionProjection, DecisionProjectionMemoryError } from "../memory-client";
import type { ClaimedDecisionProjection } from "../models";

const claim: ClaimedDecisionProjection = {
  envelope: {
    event_id: "11111111-1111-4111-8111-111111111111",
    delivery_sequence: 9,
    source_event_sequence: 7,
    organization_id: 41,
    payload_schema_version: 1,
    source_system: "flow",
    subject_type: "application",
    subject_id: 101,
    job_id: 51,
    action_code: "application_stage_moved",
    taxonomy_version: 1,
    rubric_id: null,
    rubric_version: null,
    rubric_approval_mode: null,
    jd_digest_version: 2,
    recommendation_action: "advance",
    reason_code: null,
    before_state: { stage_id: 1 },
    after_state: { stage_id: 2 },
    occurred_at: "2026-09-03T00:00:00.000Z",
  },
  leaseToken: "22222222-2222-4222-8222-222222222222",
  leaseGeneration: 1,
  attemptCount: 1,
};

describe("Memory decision-projection client", () => {
  beforeEach(() => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    process.env.VANTAHIRE_JWT_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    process.env.ACTIVEKG_BASE_URL = "https://memory.example.invalid";
    clearKeyCache();
  });
  afterEach(() => {
    delete process.env.VANTAHIRE_JWT_PRIVATE_KEY;
    delete process.env.ACTIVEKG_BASE_URL;
    clearKeyCache();
    vi.restoreAllMocks();
  });

  it("sends one exact tenant-scoped envelope and accepts a matching receipt", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.redirect).toBe("error");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual(claim.envelope);
      const token = String((init?.headers as Record<string, string>).authorization).replace("Bearer ", "");
      const payload = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString());
      expect(payload).toMatchObject({
        iss: "vantahire", sub: "vantahire-backend", aud: "activekg",
        tenant_id: "org_41", scopes: "decision-history:write",
        actor_type: "service", request_id: claim.envelope.event_id,
      });
      return new Response(JSON.stringify({
        event_id: claim.envelope.event_id,
        delivery_sequence: claim.envelope.delivery_sequence,
        status: "inserted",
      }), { status: 200 });
    });
    await expect(deliverDecisionProjection(claim, 5000, fetcher as typeof fetch))
      .resolves.toMatchObject({ status: "inserted" });
  });

  it.each([
    [408, "remote_408", true], [425, "remote_425", true], [429, "remote_429", true],
    [500, "remote_5xx", true], [400, "remote_400", false], [401, "remote_401", false],
    [403, "remote_403", false], [409, "payload_conflict", false], [422, "remote_422", false],
  ])("classifies HTTP %i without reading its body", async (status, code, retryable) => {
    const response = new Response("PRIVATE REMOTE BODY", { status });
    const text = vi.spyOn(response, "text");
    await expect(deliverDecisionProjection(claim, 5000, vi.fn(async () => response) as typeof fetch))
      .rejects.toMatchObject({ code, retryable });
    expect(text).not.toHaveBeenCalled();
  });

  it("rejects oversized, malformed, and mismatched success receipts", async () => {
    const cases = [
      new Response("x".repeat(65 * 1024), { status: 200 }),
      new Response("not-json", { status: 200 }),
      new Response(JSON.stringify({ event_id: claim.envelope.event_id, delivery_sequence: 10, status: "inserted" })),
    ];
    for (const response of cases) {
      await expect(deliverDecisionProjection(claim, 5000, vi.fn(async () => response) as typeof fetch))
        .rejects.toBeInstanceOf(DecisionProjectionMemoryError);
    }
  });

  it("maps timeout and network failures to safe retryable classes", async () => {
    const timeout = new DOMException("private", "TimeoutError");
    await expect(deliverDecisionProjection(claim, 100, vi.fn(async () => { throw timeout; }) as typeof fetch))
      .rejects.toMatchObject({ code: "timeout", retryable: true });
    await expect(deliverDecisionProjection(claim, 100, vi.fn(async () => { throw new Error("private"); }) as typeof fetch))
      .rejects.toMatchObject({ code: "network", retryable: true });
  });
});
