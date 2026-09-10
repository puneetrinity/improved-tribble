import { pool } from "../db";
import { CandidatePrivacyRestrictedError } from "../candidate-privacy/decision";
import { requireOrganizationCandidateApplicationAllowed } from "./application-intake";
import {
  type ClaimedOrganizationCandidateIntent,
  type OrganizationCandidateFailureCode,
  type OrganizationCandidateReceipt,
} from "./contracts";
import {
  deliverOrganizationCandidate,
  OrganizationCandidateMemoryError,
} from "./memory-client";

export interface OrganizationCandidateSyncConfig {
  enabled: boolean;
  pollMs: number;
  leaseMs: number;
  timeoutMs: number;
  batchSize: number;
  maxAttempts: number;
  shutdownWaitMs: number;
}

export class OrganizationCandidateConfigurationError extends Error {}

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
    throw new OrganizationCandidateConfigurationError(`${name} is outside its approved bounds.`);
  }
  return value;
}

export function assertOrganizationCandidateSyncRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): OrganizationCandidateSyncConfig {
  const rawEnabled = env.ORGANIZATION_CANDIDATE_SYNC_ENABLED;
  if (rawEnabled !== undefined && rawEnabled !== "true" && rawEnabled !== "false") {
    throw new OrganizationCandidateConfigurationError(
      "ORGANIZATION_CANDIDATE_SYNC_ENABLED must be true or false.",
    );
  }
  const config = {
    enabled: rawEnabled === "true",
    pollMs: boundedInt(env, "ORGANIZATION_CANDIDATE_SYNC_POLL_MS", 10_000, 1_000, 60_000),
    leaseMs: boundedInt(env, "ORGANIZATION_CANDIDATE_SYNC_LEASE_MS", 30_000, 7_001, 30_000),
    timeoutMs: boundedInt(env, "ORGANIZATION_CANDIDATE_SYNC_HTTP_TIMEOUT_MS", 5_000, 100, 5_000),
    batchSize: boundedInt(env, "ORGANIZATION_CANDIDATE_SYNC_BATCH_SIZE", 10, 1, 10),
    maxAttempts: boundedInt(env, "ORGANIZATION_CANDIDATE_SYNC_MAX_ATTEMPTS", 5, 5, 5),
    shutdownWaitMs: boundedInt(
      env, "ORGANIZATION_CANDIDATE_SYNC_SHUTDOWN_WAIT_MS", 5_000, 100, 10_000,
    ),
  };
  if (config.leaseMs <= config.timeoutMs + 2_000) {
    throw new OrganizationCandidateConfigurationError(
      "ORGANIZATION_CANDIDATE_SYNC_LEASE_MS must exceed HTTP timeout by two seconds.",
    );
  }
  if (config.enabled) {
    if (!env.ACTIVEKG_BASE_URL?.trim()
        || !env.VANTAHIRE_JWT_PRIVATE_KEY?.trim()
        || !env.VANTAHIRE_JWT_ACTIVE_KID?.trim()) {
      throw new OrganizationCandidateConfigurationError(
        "organization candidate Memory delivery credentials are unavailable.",
      );
    }
  }
  return config;
}

interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: any[] }>;
}

function positive(value: unknown): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error("organization_candidate_claim_invalid");
  }
  return number;
}

function rowToClaim(row: any, evidence: any): ClaimedOrganizationCandidateIntent {
  return {
    outboxId: String(row.outbox_id),
    referenceId: String(row.reference_id),
    resumeVersionId: String(row.resume_version_id),
    organizationId: positive(row.organization_id),
    applicationId: positive(row.application_id),
    jobId: positive(row.job_id),
    idempotencyKey: String(row.idempotency_key),
    generation: positive(row.generation),
    attempts: positive(row.attempts),
    sourceKind: evidence.source_kind,
    sourceResumeId: evidence.source_resume_id == null ? null : positive(evidence.source_resume_id),
    sourceObservedAt: new Date(evidence.source_observed_at),
    contentSha256: String(evidence.content_sha256),
    byteCount: positive(evidence.byte_count),
    mediaType: evidence.media_type,
    extractedTextSha256: evidence.extracted_text_sha256 == null
      ? null : String(evidence.extracted_text_sha256),
    capturedAt: new Date(evidence.captured_at),
  };
}

async function claimIntent(
  config: OrganizationCandidateSyncConfig,
  db: Queryable = pool,
): Promise<ClaimedOrganizationCandidateIntent | null> {
  const claimed = await db.query(
    "SELECT * FROM public.claim_organization_candidate_memory_intents($1,$2,$3)",
    [`flow-web-${process.pid}`, config.batchSize, config.leaseMs],
  );
  const row = claimed.rows[0];
  if (!row) return null;
  const evidence = await db.query(
    "SELECT source_kind,source_resume_id,source_observed_at,content_sha256,byte_count,"
      + "media_type,extracted_text_sha256,captured_at FROM application_resume_versions "
      + "WHERE resume_version_id=$1 AND reference_id=$2 AND organization_id=$3 "
      + "AND application_id=$4 AND job_id=$5",
    [row.resume_version_id, row.reference_id, row.organization_id, row.application_id, row.job_id],
  );
  if (!evidence.rows[0]) {
    await failIntent(rowToClaim(row, {
      source_kind: "direct_upload", source_resume_id: null,
      source_observed_at: new Date(), content_sha256: "0".repeat(64), byte_count: 1,
      media_type: "application/pdf", extracted_text_sha256: null, captured_at: new Date(),
    }), "source_missing", config, db);
    return null;
  }
  return rowToClaim(row, evidence.rows[0]);
}

async function applicationForClaim(claim: ClaimedOrganizationCandidateIntent, db: Queryable = pool) {
  const result = await db.query(
    "SELECT email,phone FROM applications WHERE id=$1 AND organization_id=$2 AND job_id=$3",
    [claim.applicationId, claim.organizationId, claim.jobId],
  );
  const row = result.rows[0];
  if (!row || typeof row.email !== "string") return null;
  return { email: row.email, phone: typeof row.phone === "string" ? row.phone : null };
}

async function acknowledgeIntent(
  claim: ClaimedOrganizationCandidateIntent,
  receipt: OrganizationCandidateReceipt,
  db: Queryable = pool,
): Promise<boolean> {
  const result = await db.query(
    "SELECT public.ack_organization_candidate_memory_intent($1,$2,$3) AS acknowledged",
    [claim.outboxId, claim.generation, receipt.candidate_id],
  );
  return result.rows[0]?.acknowledged === true;
}

async function failIntent(
  claim: ClaimedOrganizationCandidateIntent,
  code: OrganizationCandidateFailureCode,
  config: OrganizationCandidateSyncConfig,
  db: Queryable = pool,
): Promise<string | null> {
  const seconds = Math.min(3_600, 2 ** Math.max(0, claim.attempts - 1) * 5);
  const retryAt = new Date(Date.now() + seconds * 1_000);
  const result = await db.query(
    "SELECT public.fail_organization_candidate_memory_intent($1,$2,$3,$4) AS state",
    [claim.outboxId, claim.generation, code, retryAt],
  );
  return result.rows[0]?.state ?? null;
}

function safeFailure(error: unknown): OrganizationCandidateFailureCode {
  if (error instanceof OrganizationCandidateMemoryError) return error.code;
  if (error instanceof CandidatePrivacyRestrictedError) {
    return error.code === "candidate_privacy_restricted"
      ? "privacy_restricted" : "internal_error";
  }
  return "internal_error";
}

let timer: NodeJS.Timeout | null = null;
let inFlight: Promise<void> | null = null;

export async function runOrganizationCandidateProcessorOnce(
  config = assertOrganizationCandidateSyncRuntimeConfig(),
  db: Queryable = pool,
  deliver = deliverOrganizationCandidate,
): Promise<void> {
  if (!config.enabled) return;
  for (let index = 0; index < config.batchSize; index += 1) {
    const claim = await claimIntent({ ...config, batchSize: 1 }, db);
    if (!claim) break;
    try {
      const application = await applicationForClaim(claim, db);
      if (!application) {
        await failIntent(claim, "source_missing", config, db);
        continue;
      }
      await requireOrganizationCandidateApplicationAllowed({
        applicationId: claim.applicationId,
        email: application.email,
        phone: application.phone,
      });
      const receipt = await deliver(claim, application, config.timeoutMs);
      const acknowledged = await acknowledgeIntent(claim, receipt, db);
      if (!acknowledged) console.warn("[OrganizationCandidate] acknowledgement fenced");
    } catch (error) {
      const code = safeFailure(error);
      const state = await failIntent(claim, code, config, db);
      console.warn("[OrganizationCandidate] delivery failed", { state: state ?? "stale", code });
    }
  }
}

function tick(): void {
  if (inFlight) return;
  inFlight = runOrganizationCandidateProcessorOnce()
    .catch((error) => {
      console.error("[OrganizationCandidate] processor tick failed", {
        errorType: error instanceof Error ? error.constructor.name : "UnknownError",
      });
    })
    .finally(() => { inFlight = null; });
}

export function startOrganizationCandidateProcessor(): void {
  if (timer) return;
  const config = assertOrganizationCandidateSyncRuntimeConfig();
  if (!config.enabled) return;
  tick();
  timer = setInterval(tick, config.pollMs);
  timer.unref?.();
}

export async function stopOrganizationCandidateProcessor(): Promise<void> {
  if (timer) clearInterval(timer);
  timer = null;
  const active = inFlight;
  if (!active) return;
  const waitMs = assertOrganizationCandidateSyncRuntimeConfig().shutdownWaitMs;
  await Promise.race([active, new Promise<void>((resolve) => setTimeout(resolve, waitMs))]);
}
