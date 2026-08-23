export interface CandidatePrivacyConfig {
  intakeEnabled: boolean;
  memoryTimeoutMs: number;
  pollMs: number;
  staleMs: number;
  leaseMs: number;
  pageSize: number;
}

export class CandidatePrivacyConfigurationError extends Error {}

function booleanEnv(env: NodeJS.ProcessEnv, name: string, fallback = false): boolean {
  const value = env[name];
  if (value === undefined || value === "") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new CandidatePrivacyConfigurationError(`${name} must be true or false.`);
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
    throw new CandidatePrivacyConfigurationError(`${name} is outside its approved bounds.`);
  }
  return value;
}

export function loadCandidatePrivacyConfig(
  env: NodeJS.ProcessEnv = process.env,
): CandidatePrivacyConfig {
  return {
    intakeEnabled: booleanEnv(env, "FLOW_CANDIDATE_PRIVACY_INTAKE_ENABLED", false),
    memoryTimeoutMs: boundedInt(env, "FLOW_CANDIDATE_PRIVACY_HTTP_TIMEOUT_MS", 5_000, 1, 10_000),
    pollMs: boundedInt(env, "FLOW_CANDIDATE_PRIVACY_POLL_MS", 30_000, 5_000, 60_000),
    staleMs: boundedInt(env, "FLOW_CANDIDATE_PRIVACY_STALE_MS", 120_000, 60_000, 300_000),
    leaseMs: boundedInt(env, "FLOW_CANDIDATE_PRIVACY_LEASE_MS", 60_000, 1_000, 120_000),
    pageSize: boundedInt(env, "FLOW_CANDIDATE_PRIVACY_PAGE_SIZE", 100, 1, 500),
  };
}

export function assertCandidatePrivacyRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): CandidatePrivacyConfig {
  return loadCandidatePrivacyConfig(env);
}
