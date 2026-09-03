import { loadDecisionProjectionDeliveryConfig, type DecisionProjectionDeliveryConfig } from "./config";
import { deliverDecisionProjection, DecisionProjectionMemoryError } from "./memory-client";
import type { ClaimedDecisionProjection, DecisionProjectionReceipt, SafeDeliveryErrorCode } from "./models";
import {
  acknowledgeDecisionProjection,
  claimDecisionProjection,
  failDecisionProjection,
} from "./repository";

export interface DecisionProjectionProcessorDependencies {
  claim(leaseMs: number, maxAttempts: number): Promise<ClaimedDecisionProjection | null>;
  deliver(claim: ClaimedDecisionProjection, timeoutMs: number): Promise<DecisionProjectionReceipt>;
  acknowledge(claim: ClaimedDecisionProjection, receipt: DecisionProjectionReceipt): Promise<boolean>;
  fail(
    claim: ClaimedDecisionProjection,
    errorCode: SafeDeliveryErrorCode,
    retryable: boolean,
    maxAttempts: number,
  ): Promise<"retry" | "terminal" | null>;
}

const defaultDependencies: DecisionProjectionProcessorDependencies = {
  claim: claimDecisionProjection,
  deliver: deliverDecisionProjection,
  acknowledge: acknowledgeDecisionProjection,
  fail: failDecisionProjection,
};

let timer: NodeJS.Timeout | null = null;
let inFlight: Promise<void> | null = null;

function safeFailure(error: unknown): { code: SafeDeliveryErrorCode; retryable: boolean } {
  if (error instanceof DecisionProjectionMemoryError) {
    return { code: error.code, retryable: error.retryable };
  }
  return { code: "internal_error", retryable: true };
}

async function processClaim(
  claim: ClaimedDecisionProjection,
  config: DecisionProjectionDeliveryConfig,
  dependencies: DecisionProjectionProcessorDependencies,
): Promise<void> {
  try {
    const receipt = await dependencies.deliver(claim, config.timeoutMs);
    const acknowledged = await dependencies.acknowledge(claim, receipt);
    if (!acknowledged) {
      console.warn("[DecisionProjection] acknowledgement fenced", { state: "stale" });
    }
  } catch (error) {
    const failure = safeFailure(error);
    const state = await dependencies.fail(
      claim, failure.code, failure.retryable, config.maxAttempts,
    );
    console.warn("[DecisionProjection] delivery failed", {
      state: state ?? "stale",
      errorCode: failure.code,
    });
  }
}

export async function runDecisionProjectionProcessorOnce(
  config = loadDecisionProjectionDeliveryConfig(),
  dependencies: DecisionProjectionProcessorDependencies = defaultDependencies,
): Promise<void> {
  if (!config.enabled) return;
  const claims: ClaimedDecisionProjection[] = [];
  for (let index = 0; index < config.batchSize; index += 1) {
    const claim = await dependencies.claim(config.leaseMs, config.maxAttempts);
    if (!claim) break;
    claims.push(claim);
  }
  for (let index = 0; index < claims.length; index += config.concurrency) {
    await Promise.all(
      claims.slice(index, index + config.concurrency)
        .map((claim) => processClaim(claim, config, dependencies)),
    );
  }
  if (claims.length) {
    console.info("[DecisionProjection] tick complete", { claimed: claims.length });
  }
}

function tick(): void {
  if (inFlight) return;
  inFlight = runDecisionProjectionProcessorOnce()
    .catch((error) => {
      console.error("[DecisionProjection] processor tick failed", {
        errorType: error instanceof Error ? error.constructor.name : "UnknownError",
      });
    })
    .finally(() => { inFlight = null; });
}

export function startDecisionProjectionProcessor(): void {
  if (timer) return;
  const config = loadDecisionProjectionDeliveryConfig();
  if (!config.enabled) return;
  tick();
  timer = setInterval(tick, config.pollMs);
  timer.unref?.();
}

export async function stopDecisionProjectionProcessor(): Promise<void> {
  if (timer) clearInterval(timer);
  timer = null;
  const active = inFlight;
  if (!active) return;
  const waitMs = loadDecisionProjectionDeliveryConfig().shutdownWaitMs;
  await Promise.race([
    active,
    new Promise<void>((resolve) => setTimeout(resolve, waitMs)),
  ]);
}
