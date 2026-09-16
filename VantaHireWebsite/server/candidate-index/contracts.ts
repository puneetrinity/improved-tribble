import { createHash } from "node:crypto";

export const CANDIDATE_INDEX_TABLES = ["candidate_index_outbox", "candidate_index_delivery_state"] as const;
export const CANDIDATE_INDEX_FUNCTIONS = [
  "public.flow_claim_candidate_index_delivery(integer,integer)",
  "public.flow_ack_candidate_index_delivery(uuid,uuid,bigint,text,uuid,uuid,text,uuid,text)",
  "public.flow_fail_candidate_index_delivery(uuid,uuid,bigint,text,integer)",
  "public.flow_candidate_index_managed_application(integer,integer)",
  "public.flow_capture_candidate_index_catchup(integer,uuid,uuid)",
] as const;
export const CANDIDATE_INDEX_TRIGGER_FUNCTION = "public.flow_candidate_index_evidence_guard()";
export type CandidateIndexMode = "dual" | "private_primary";

export function candidateIndexMode(env: NodeJS.ProcessEnv = process.env): CandidateIndexMode | null {
  const value = env.FLOW_CANDIDATE_INDEX_MODE;
  if (value === undefined) return null;
  if (value !== "dual" && value !== "private_primary") throw new Error("CANDIDATE_INDEX_MODE_INVALID");
  return value;
}

export function assertCandidateIndexWorkerConfig(env: NodeJS.ProcessEnv = process.env): void {
  if (Object.prototype.hasOwnProperty.call(env, "FLOW_CANDIDATE_INDEX_MODE")) {
    throw new Error("CANDIDATE_INDEX_AI_FLAG_FORBIDDEN");
  }
}

export function candidateIndexWebConfig(env: NodeJS.ProcessEnv = process.env) {
  const mode = candidateIndexMode(env);
  function integer(name: string, fallback: number, max: number): number {
    const value = env[name];
    if (value === undefined) return fallback;
    if (!/^[1-9][0-9]{0,8}$/.test(value) || Number(value) > max) throw new Error("CANDIDATE_INDEX_CONFIG_INVALID");
    return Number(value);
  }
  const timeoutMs = integer("FLOW_CANDIDATE_INDEX_HTTP_TIMEOUT_MS", 10_000, 10_000);
  const leaseMs = integer("FLOW_CANDIDATE_INDEX_LEASE_MS", 60_000, 300_000);
  const pollMs = integer("FLOW_CANDIDATE_INDEX_POLL_MS", 1_000, 60_000);
  const claimLimit = integer("FLOW_CANDIDATE_INDEX_CLAIM_LIMIT", 8, 8);
  if (leaseMs <= timeoutMs + 20_000 + 2_000) throw new Error("CANDIDATE_INDEX_LEASE_TOO_SHORT");
  if (mode && (!env.ACTIVEKG_BASE_URL?.trim() || !env.VANTAHIRE_JWT_PRIVATE_KEY?.trim()
    || !env.VANTAHIRE_JWT_ACTIVE_KID?.trim())) throw new Error("CANDIDATE_INDEX_CREDENTIALS_MISSING");
  return { mode, timeoutMs, leaseMs, pollMs, claimLimit };
}
export const CANDIDATE_INDEX_LIMITS = Object.freeze({
  originalBytes: 5 * 1024 * 1024,
  textBytes: 2 * 1024 * 1024,
  requestBytes: 8 * 1024 * 1024,
  httpTimeoutMs: 10_000,
  leaseMs: 60_000,
  maxAttempts: 8,
  claimLimit: 8,
});

export type CandidateIndexContentKind = "pinned_text" | "original_bytes";
export interface CandidateIndexIdentity {
  tenant: string;
  referenceId: string;
  resumeVersionId: string;
  sourceVersion: number;
  contentSha256: string;
  contentKind: CandidateIndexContentKind;
  payloadSha256: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DIGEST = /^[0-9a-f]{64}$/;

/** Deliberately no whitespace, case, number or UUID coercion across the wire. */
export function candidateIndexCommandKey(input: CandidateIndexIdentity): string {
  if (!/^org_[1-9][0-9]{0,9}$/.test(input.tenant)
      || Number(input.tenant.slice(4)) > 2_147_483_647
      || !UUID.test(input.referenceId) || !UUID.test(input.resumeVersionId)
      || !Number.isSafeInteger(input.sourceVersion) || input.sourceVersion < 1
      || !DIGEST.test(input.contentSha256) || !DIGEST.test(input.payloadSha256)
      || !["pinned_text", "original_bytes"].includes(input.contentKind)
      || (input.contentKind === "original_bytes" && input.contentSha256 !== input.payloadSha256)) {
    throw new Error("CANDIDATE_INDEX_IDENTITY_REFUSED");
  }
  return createHash("sha256").update(JSON.stringify([
    "candidate-index:v1", input.tenant, input.referenceId, input.resumeVersionId,
    input.sourceVersion, input.contentSha256, input.contentKind, input.payloadSha256,
  ]), "utf8").digest("hex");
}
