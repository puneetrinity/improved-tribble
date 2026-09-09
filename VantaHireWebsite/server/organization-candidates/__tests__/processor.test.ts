import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db", () => ({ pool: { query: vi.fn() } }));
vi.mock("../application-intake", () => ({
  requireOrganizationCandidateApplicationAllowed: vi.fn(async () => undefined),
}));

import { requireOrganizationCandidateApplicationAllowed } from "../application-intake";
import { OrganizationCandidateMemoryError } from "../memory-client";
import {
  assertOrganizationCandidateSyncRuntimeConfig,
  runOrganizationCandidateProcessorOnce,
} from "../processor";

const config = {
  enabled: true, pollMs: 1_000, leaseMs: 30_000, timeoutMs: 5_000,
  batchSize: 1, maxAttempts: 5, shutdownWaitMs: 100,
};

const outbox = {
  outbox_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  reference_id: "11111111-1111-4111-8111-111111111111",
  resume_version_id: "22222222-2222-4222-8222-222222222222",
  organization_id: 41, application_id: 101, job_id: 51,
  idempotency_key: "c".repeat(64), generation: 1, attempts: 1,
};
const evidence = {
  source_kind: "direct_upload", source_resume_id: null,
  source_observed_at: new Date("2026-09-09T00:00:00.000Z"),
  content_sha256: "a".repeat(64), byte_count: 1024,
  media_type: "application/pdf", extracted_text_sha256: "b".repeat(64),
  captured_at: new Date("2026-09-09T00:00:00.000Z"),
};

function database(rows: unknown[][]) {
  return { query: vi.fn(async () => ({ rows: rows.shift() ?? [] })) };
}

describe("organization-candidate delivery processor", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is inert while disabled and validates lease/credential bounds", async () => {
    const db = database([]);
    await runOrganizationCandidateProcessorOnce({ ...config, enabled: false }, db, vi.fn());
    expect(db.query).not.toHaveBeenCalled();
    expect(() => assertOrganizationCandidateSyncRuntimeConfig({
      ORGANIZATION_CANDIDATE_SYNC_ENABLED: "true",
      ACTIVEKG_BASE_URL: "https://memory.invalid",
      VANTAHIRE_JWT_PRIVATE_KEY: "key", VANTAHIRE_JWT_ACTIVE_KID: "kid",
      ORGANIZATION_CANDIDATE_SYNC_LEASE_MS: "7000",
      ORGANIZATION_CANDIDATE_SYNC_HTTP_TIMEOUT_MS: "5000",
    } as NodeJS.ProcessEnv)).toThrow(/approved bounds/);
  });

  it("claims, rechecks privacy, delivers, and acknowledges through fenced routines", async () => {
    const db = database([[outbox], [evidence], [{ email: "candidate@example.invalid", phone: null }],
      [{ acknowledged: true }]]);
    const deliver = vi.fn(async () => ({
      delivery_status: "recorded" as const, resolution: "created" as const,
      idempotency_key: outbox.idempotency_key, reference_id: outbox.reference_id,
      resume_version_id: outbox.resume_version_id,
      candidate_id: "33333333-3333-4333-8333-333333333333",
    }));
    await runOrganizationCandidateProcessorOnce(config, db, deliver);
    expect(requireOrganizationCandidateApplicationAllowed).toHaveBeenCalledWith({
      applicationId: 101, email: "candidate@example.invalid", phone: null,
    });
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls.at(-1)?.[0]).toContain("ack_organization_candidate_memory_intent");
  });

  it("records a bounded classified failure without acknowledging", async () => {
    const db = database([[outbox], [evidence], [{ email: "candidate@example.invalid", phone: null }],
      [{ state: "retry_wait" }]]);
    await runOrganizationCandidateProcessorOnce(config, db, vi.fn(async () => {
      throw new OrganizationCandidateMemoryError("remote_429", true);
    }));
    expect(db.query.mock.calls.at(-1)?.[0]).toContain("fail_organization_candidate_memory_intent");
    expect(db.query.mock.calls.at(-1)?.[1]?.[2]).toBe("remote_429");
  });

  it("makes missing source evidence terminal without a network call", async () => {
    const db = database([[outbox], [], [{ state: "terminal" }]]);
    const deliver = vi.fn();
    await runOrganizationCandidateProcessorOnce(config, db, deliver);
    expect(deliver).not.toHaveBeenCalled();
    expect(db.query.mock.calls.at(-1)?.[1]?.[2]).toBe("source_missing");
  });
});
