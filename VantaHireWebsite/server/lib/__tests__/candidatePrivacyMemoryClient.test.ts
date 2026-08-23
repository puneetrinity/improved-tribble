import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/jwt-signer", () => ({
  signServiceJwt: vi.fn(async () => "synthetic-service-token"),
}));

import {
  CandidatePrivacyMemoryError,
  checkMemoryEligibility,
  checkMemoryEligibilityBatch,
  createMemoryDirective,
  readMemoryChanges,
  readMemorySnapshot,
} from "../../candidate-privacy/memory-client";
import { signServiceJwt } from "../services/jwt-signer";

const requestId = "00000000-0000-4000-8000-000000000001";
const directiveId = "00000000-0000-4000-8000-000000000002";
const now = "2026-08-23T00:00:00.000Z";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("candidate privacy Memory client", () => {
  beforeEach(() => {
    process.env.ACTIVEKG_BASE_URL = "https://memory.example.invalid/";
    vi.mocked(signServiceJwt).mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.ACTIVEKG_BASE_URL;
  });

  it("signs the exact write scope and validates the minimal directive response", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      request_id: requestId,
      directive_id: directiveId,
      action: "withdraw_global_matching",
      scope: "global_matching",
      state: "active_quarantine",
      version: 1,
      effective_at: now,
      decision: "block_global",
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await createMemoryDirective({
      requestId,
      action: "withdraw_global_matching",
      authorityType: "verified_candidate",
      evidenceRef: requestId,
      reasonCode: "candidate_global_opt_out",
      identifiers: [{ identifier_type: "email", value: "canary@example.invalid" }],
      timeoutMs: 500,
    });
    expect(result.directive_id).toBe(directiveId);
    expect(signServiceJwt).toHaveBeenCalledWith("activekg", {
      tenantId: "platform",
      scopes: "candidate-privacy:write",
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://memory.example.invalid/candidate-privacy/directives");
    expect((init as RequestInit).headers).toMatchObject({
      authorization: "Bearer synthetic-service-token",
      "content-type": "application/json",
    });
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      request_id: requestId,
      action: "withdraw_global_matching",
      authority_type: "verified_candidate",
      evidence_ref: requestId,
      reason_code: "candidate_global_opt_out",
      identifiers: [{ identifier_type: "email", value: "canary@example.invalid" }],
    });
  });

  it("classifies a disabled Memory intake without reading or logging its body", async () => {
    const text = vi.fn(async () => {
      throw new Error("provider-body-canary");
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 503,
      headers: new Headers(),
      text,
    })));

    await expect(createMemoryDirective({
      requestId,
      action: "request_erasure",
      authorityType: "privacy_operator",
      evidenceRef: directiveId,
      reasonCode: "verified_support_request",
      identifiers: [{ identifier_type: "phone", value: "+000000000" }],
      timeoutMs: 500,
    })).rejects.toMatchObject({ code: "intake_disabled", retryable: true });
    expect(text).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("rejects declared and streamed oversized responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(
      { count: 0, events: [] },
      200,
      { "content-length": String(256 * 1024 + 1) },
    )));
    await expect(readMemoryChanges({ afterCursor: 0, limit: 100, timeoutMs: 500 }))
      .rejects.toMatchObject({ code: "invalid_response", retryable: false });

    vi.stubGlobal("fetch", vi.fn(async () => new Response("x".repeat(256 * 1024 + 1))));
    await expect(readMemorySnapshot({ limit: 100, timeoutMs: 500 }))
      .rejects.toMatchObject({ code: "invalid_response", retryable: false });
  });

  it("requires exact eligibility cardinality and request references", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      results: [{ request_ref: requestId, decision: "allow" }],
      count: 1,
    })));
    await expect(checkMemoryEligibility({
      requestRef: requestId,
      identifiers: [{ identifier_type: "vantahire_application_id", value: "10" }],
      timeoutMs: 500,
    })).resolves.toBe("allow");

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      results: [{ request_ref: requestId, decision: "allow" }],
      count: 1,
    })));
    await expect(checkMemoryEligibilityBatch({
      subjects: [
        { requestRef: requestId, identifiers: [{ identifier_type: "email", value: "a@example.invalid" }] },
        { requestRef: directiveId, identifiers: [{ identifier_type: "email", value: "b@example.invalid" }] },
      ],
      timeoutMs: 500,
    })).rejects.toBeInstanceOf(CandidatePrivacyMemoryError);
  });

  it("rejects a shape-valid directive that changes Flow's authority", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      request_id: directiveId,
      directive_id: requestId,
      action: "request_erasure",
      scope: "active_profile",
      state: "active_quarantine",
      version: 1,
      effective_at: now,
      decision: "block_all",
    })));
    await expect(createMemoryDirective({
      requestId,
      action: "withdraw_global_matching",
      authorityType: "verified_candidate",
      evidenceRef: requestId,
      reasonCode: "candidate_global_opt_out",
      identifiers: [{ identifier_type: "email", value: "candidate@example.invalid" }],
      timeoutMs: 500,
    })).rejects.toMatchObject({ code: "invalid_response", retryable: false });
  });

  it("rejects mismatched page counts and unknown response fields", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ events: [], count: 1 })));
    await expect(readMemoryChanges({ afterCursor: 0, limit: 100, timeoutMs: 500 }))
      .rejects.toMatchObject({ code: "invalid_response" });

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      high_water_cursor: 0,
      directives: [],
      count: 0,
      unexpected: "must-fail-closed",
    })));
    await expect(readMemorySnapshot({ limit: 100, timeoutMs: 500 }))
      .rejects.toMatchObject({ code: "invalid_response" });
  });
});
