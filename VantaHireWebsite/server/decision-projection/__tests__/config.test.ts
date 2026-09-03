import { describe, expect, it } from "vitest";

import {
  DecisionProjectionConfigurationError,
  loadDecisionProjectionDeliveryConfig,
} from "../config";

describe("decision-projection delivery config", () => {
  it("defaults dark with bounded production-safe values", () => {
    expect(loadDecisionProjectionDeliveryConfig({} as NodeJS.ProcessEnv)).toEqual({
      enabled: false,
      pollMs: 10_000,
      leaseMs: 30_000,
      timeoutMs: 5_000,
      batchSize: 10,
      concurrency: 4,
      maxAttempts: 5,
      shutdownWaitMs: 5_000,
    });
  });

  it("accepts only exact booleans and bounded integers", () => {
    expect(loadDecisionProjectionDeliveryConfig({
      DECISION_PROJECTION_DELIVERY_ENABLED: "true",
      DECISION_PROJECTION_DELIVERY_POLL_MS: "1000",
      DECISION_PROJECTION_DELIVERY_LEASE_MS: "1000",
      DECISION_PROJECTION_DELIVERY_HTTP_TIMEOUT_MS: "100",
      DECISION_PROJECTION_DELIVERY_BATCH_SIZE: "1",
      DECISION_PROJECTION_DELIVERY_CONCURRENCY: "1",
      DECISION_PROJECTION_DELIVERY_MAX_ATTEMPTS: "20",
      DECISION_PROJECTION_DELIVERY_SHUTDOWN_WAIT_MS: "100",
    } as NodeJS.ProcessEnv)).toMatchObject({ enabled: true, batchSize: 1, maxAttempts: 20 });
    for (const value of ["TRUE", "1", "yes"]) {
      expect(() => loadDecisionProjectionDeliveryConfig({
        DECISION_PROJECTION_DELIVERY_ENABLED: value,
      } as NodeJS.ProcessEnv)).toThrow(DecisionProjectionConfigurationError);
    }
  });

  it.each([
    ["DECISION_PROJECTION_DELIVERY_POLL_MS", "999"],
    ["DECISION_PROJECTION_DELIVERY_LEASE_MS", "30001"],
    ["DECISION_PROJECTION_DELIVERY_HTTP_TIMEOUT_MS", "5001"],
    ["DECISION_PROJECTION_DELIVERY_BATCH_SIZE", "11"],
    ["DECISION_PROJECTION_DELIVERY_CONCURRENCY", "5"],
    ["DECISION_PROJECTION_DELIVERY_MAX_ATTEMPTS", "0"],
    ["DECISION_PROJECTION_DELIVERY_SHUTDOWN_WAIT_MS", "10001"],
  ])("rejects %s outside its lock", (name, value) => {
    expect(() => loadDecisionProjectionDeliveryConfig({ [name]: value } as NodeJS.ProcessEnv))
      .toThrow(DecisionProjectionConfigurationError);
  });
});
