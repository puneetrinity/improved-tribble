import { describe, expect, it } from "vitest";
import { candidateIndexMode, candidateIndexWebConfig, assertCandidateIndexWorkerConfig } from "../contracts";
import { candidateIndexCommandKey, type CandidateIndexIdentity } from "../contracts";

export const INDEX_KEY_VECTOR: CandidateIndexIdentity = {
  tenant: "org_17",
  referenceId: "11111111-1111-4111-8111-111111111111",
  resumeVersionId: "22222222-2222-4222-8222-222222222222",
  sourceVersion: 1,
  contentSha256: "a".repeat(64),
  contentKind: "pinned_text",
  payloadSha256: "b".repeat(64),
};

describe("candidate index cross-system identity", () => {
  it("keeps web disabled only on absence and refuses every AI-worker setting", () => {
    expect(candidateIndexMode({})).toBeNull();
    expect(() => assertCandidateIndexWorkerConfig({})).not.toThrow();
    for (const mode of ["", "false", "true", "dual", "private_primary", "unknown"]) {
      expect(() => assertCandidateIndexWorkerConfig({ FLOW_CANDIDATE_INDEX_MODE: mode }))
        .toThrow("CANDIDATE_INDEX_AI_FLAG_FORBIDDEN");
      if (!["dual", "private_primary"].includes(mode)) {
        expect(() => candidateIndexMode({ FLOW_CANDIDATE_INDEX_MODE: mode })).toThrow("CANDIDATE_INDEX_MODE_INVALID");
      } else expect(candidateIndexMode({ FLOW_CANDIDATE_INDEX_MODE: mode })).toBe(mode);
    }
  });
  it("requires credentials and a lease covering bounded download plus HTTP", () => {
    expect(() => candidateIndexWebConfig({ FLOW_CANDIDATE_INDEX_MODE: "dual" })).toThrow("CANDIDATE_INDEX_CREDENTIALS_MISSING");
    expect(() => candidateIndexWebConfig({ FLOW_CANDIDATE_INDEX_LEASE_MS: "32000" })).toThrow("CANDIDATE_INDEX_LEASE_TOO_SHORT");
    expect(() => candidateIndexWebConfig({ FLOW_CANDIDATE_INDEX_HTTP_TIMEOUT_MS: "10001" })).toThrow("CANDIDATE_INDEX_CONFIG_INVALID");
    expect(candidateIndexWebConfig({})).toMatchObject({ mode: null, leaseMs: 60000, timeoutMs: 10000 });
  });
  it("pins the literal UTF-8 JSON vector shared with Memory and PostgreSQL", () => {
    expect(candidateIndexCommandKey(INDEX_KEY_VECTOR))
      .toBe("77ed6de5ba676e0408944df3bf0fe9c7d9e7b5b9b964bb3a9c7c361153b397bf");
  });
  it.each([
    { tenant: "org_017" }, { tenant: "org_2147483648" }, { tenant: "public_provider" },
    { referenceId: "AAAAAAAA-1111-4111-8111-111111111111" },
    { sourceVersion: "1" }, { sourceVersion: 0 }, { sourceVersion: Number.MAX_SAFE_INTEGER + 1 },
    { contentSha256: "A".repeat(64) }, { contentKind: "url" }, { contentKind: "original_bytes" },
  ])("refuses ambiguous identity encoding %j", (change) => {
    expect(() => candidateIndexCommandKey({ ...INDEX_KEY_VECTOR, ...change } as CandidateIndexIdentity))
      .toThrow("CANDIDATE_INDEX_IDENTITY_REFUSED");
  });
  it("binds every identity member and never a storage locator", () => {
    const baseline = candidateIndexCommandKey(INDEX_KEY_VECTOR);
    for (const change of [
      { tenant: "org_18" }, { referenceId: "33333333-3333-4333-8333-333333333333" },
      { resumeVersionId: "33333333-3333-4333-8333-333333333333" }, { sourceVersion: 2 },
      { contentSha256: "c".repeat(64) }, { payloadSha256: "c".repeat(64) },
    ]) {
      expect(candidateIndexCommandKey({ ...INDEX_KEY_VECTOR, ...change })).not.toBe(baseline);
    }
  });
});
