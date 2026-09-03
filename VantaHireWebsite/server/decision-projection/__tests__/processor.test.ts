import { describe, expect, it, vi } from "vitest";

vi.mock("../repository", () => ({
  acknowledgeDecisionProjection: vi.fn(),
  claimDecisionProjection: vi.fn(),
  failDecisionProjection: vi.fn(),
}));

import { DecisionProjectionMemoryError } from "../memory-client";
import type { ClaimedDecisionProjection } from "../models";
import { runDecisionProjectionProcessorOnce } from "../processor";

function claimed(sequence: number, organizationId = sequence): ClaimedDecisionProjection {
  return {
    envelope: {
      event_id: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
      delivery_sequence: sequence,
      source_event_sequence: sequence,
      organization_id: organizationId,
      payload_schema_version: 1,
      source_system: "flow",
      subject_type: "application",
      subject_id: sequence,
      job_id: sequence,
      action_code: "application_stage_moved",
      taxonomy_version: 1,
      rubric_id: null,
      rubric_version: null,
      rubric_approval_mode: null,
      jd_digest_version: null,
      recommendation_action: null,
      reason_code: null,
      before_state: { stage_id: null },
      after_state: { stage_id: 1 },
      occurred_at: "2026-09-03T00:00:00.000Z",
    },
    leaseToken: `10000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    leaseGeneration: 1,
    attemptCount: 1,
  };
}

const config = {
  enabled: true, pollMs: 1000, leaseMs: 30_000, timeoutMs: 5000,
  batchSize: 10, concurrency: 4, maxAttempts: 5, shutdownWaitMs: 100,
};

describe("decision-projection processor", () => {
  it("is inert while disabled", async () => {
    const claim = vi.fn();
    await runDecisionProjectionProcessorOnce({ ...config, enabled: false }, {
      claim, deliver: vi.fn(), acknowledge: vi.fn(), fail: vi.fn(),
    });
    expect(claim).not.toHaveBeenCalled();
  });

  it("claims a bounded batch and acknowledges matching receipts", async () => {
    const queue = [claimed(1), claimed(2), null];
    const acknowledge = vi.fn(async () => true);
    await runDecisionProjectionProcessorOnce(config, {
      claim: vi.fn(async () => queue.shift() ?? null),
      deliver: vi.fn(async (item) => ({
        event_id: item.envelope.event_id,
        delivery_sequence: item.envelope.delivery_sequence,
        status: "inserted" as const,
      })),
      acknowledge,
      fail: vi.fn(),
    });
    expect(acknowledge).toHaveBeenCalledTimes(2);
  });

  it("records only classified failures and preserves the lease fence inputs", async () => {
    const item = claimed(3);
    const fail = vi.fn(async () => "terminal" as const);
    await runDecisionProjectionProcessorOnce(config, {
      claim: vi.fn().mockResolvedValueOnce(item).mockResolvedValueOnce(null),
      deliver: vi.fn(async () => { throw new DecisionProjectionMemoryError("payload_conflict", false); }),
      acknowledge: vi.fn(),
      fail,
    });
    expect(fail).toHaveBeenCalledWith(item, "payload_conflict", false, 5);
  });

  it("never exceeds the locked batch even when claims remain available", async () => {
    let next = 1;
    const claim = vi.fn(async () => claimed(next++));
    await runDecisionProjectionProcessorOnce({ ...config, batchSize: 3 }, {
      claim,
      deliver: vi.fn(async (item) => ({ event_id: item.envelope.event_id,
        delivery_sequence: item.envelope.delivery_sequence, status: "replayed" as const })),
      acknowledge: vi.fn(async () => true),
      fail: vi.fn(),
    });
    expect(claim).toHaveBeenCalledTimes(3);
  });
});
