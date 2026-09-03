export interface DecisionProjectionDeliveryConfig {
  enabled: boolean;
  pollMs: number;
  leaseMs: number;
  timeoutMs: number;
  batchSize: number;
  concurrency: number;
  maxAttempts: number;
  shutdownWaitMs: number;
}

export class DecisionProjectionConfigurationError extends Error {}

function booleanEnv(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new DecisionProjectionConfigurationError(`${name} must be true or false.`);
}

function boundedInt(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = env[name];
  const value = raw === undefined || raw === "" ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new DecisionProjectionConfigurationError(`${name} is outside its approved bounds.`);
  }
  return value;
}

export function loadDecisionProjectionDeliveryConfig(
  env: NodeJS.ProcessEnv = process.env,
): DecisionProjectionDeliveryConfig {
  return {
    enabled: booleanEnv(env, "DECISION_PROJECTION_DELIVERY_ENABLED", false),
    pollMs: boundedInt(env, "DECISION_PROJECTION_DELIVERY_POLL_MS", 10_000, 1_000, 60_000),
    leaseMs: boundedInt(env, "DECISION_PROJECTION_DELIVERY_LEASE_MS", 30_000, 1_000, 30_000),
    timeoutMs: boundedInt(env, "DECISION_PROJECTION_DELIVERY_HTTP_TIMEOUT_MS", 5_000, 100, 5_000),
    batchSize: boundedInt(env, "DECISION_PROJECTION_DELIVERY_BATCH_SIZE", 10, 1, 10),
    concurrency: boundedInt(env, "DECISION_PROJECTION_DELIVERY_CONCURRENCY", 4, 1, 4),
    maxAttempts: boundedInt(env, "DECISION_PROJECTION_DELIVERY_MAX_ATTEMPTS", 5, 1, 20),
    shutdownWaitMs: boundedInt(env, "DECISION_PROJECTION_DELIVERY_SHUTDOWN_WAIT_MS", 5_000, 100, 10_000),
  };
}

export function assertDecisionProjectionDeliveryRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): DecisionProjectionDeliveryConfig {
  return loadDecisionProjectionDeliveryConfig(env);
}
