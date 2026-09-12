import { pool } from "../db";
import { CandidatePrivacyRestrictedError, requireCandidatePrivacyAllowed } from "../candidate-privacy/decision";
import { CandidateConsentError, consentIdentity, sha256, type ConsentGrantProof } from "./contracts";
import { ConsentDeliveryError, consentMemoryOrigin, deliverConsent } from "./memory-client";
import { loadConsentCommand, ownedResume, type ConsentDb } from "./repository";

export interface ConsentDeliveryConfig {
  enabled: boolean; tickMs: number; batchSize: number; timeoutMs: number; leaseMs: number;
}
export function consentDeliveryConfig(env: NodeJS.ProcessEnv = process.env): ConsentDeliveryConfig {
  const number = (key: string, fallback: number, min: number, max: number): number => {
    const value = env[key] === undefined ? fallback : Number(env[key]);
    if (!Number.isInteger(value) || value < min || value > max) throw new Error("candidate_consent_config_invalid");
    return value;
  };
  const config = {
    enabled: (env.CANDIDATE_CONSENT_DELIVERY_ENABLED ?? "false").trim().toLowerCase() === "true",
    tickMs: number("CANDIDATE_CONSENT_TICK_MS", 2000, 1000, 60000),
    batchSize: number("CANDIDATE_CONSENT_BATCH_SIZE", 10, 1, 10),
    timeoutMs: number("CANDIDATE_CONSENT_HTTP_TIMEOUT_MS", 5000, 500, 30000),
    leaseMs: number("CANDIDATE_CONSENT_LEASE_MS", 30000, 1000, 300000),
  };
  if (config.leaseMs <= config.timeoutMs) throw new Error("candidate_consent_lease_must_exceed_timeout");
  if (config.enabled) {
    consentMemoryOrigin(env);
    if (!env.VANTAHIRE_JWT_PRIVATE_KEY?.trim() || !env.VANTAHIRE_JWT_ACTIVE_KID?.trim()) {
      throw new Error("candidate_consent_credentials_unavailable");
    }
  }
  return config;
}

export async function runConsentProcessorOnce(config: ConsentDeliveryConfig, eventId: string | null = null,
  db: ConsentDb = pool, deliver: typeof deliverConsent = deliverConsent): Promise<number> {
  if (!config.enabled) return 0;
  const claims = await db.query("SELECT * FROM public.flow_claim_candidate_consent_outbox($1,$2,$3,$4)",
    [`flow-consent-web-${process.pid}`, eventId ? 1 : config.batchSize, config.leaseMs, eventId]);
  // Different subjects run concurrently so the last claim does not wait through nine HTTP deadlines.
  await Promise.all(claims.rows.map(async row => {
    try {
      const loaded = await loadConsentCommand(row.event_id, db);
      const { command } = loaded;
      const identity = consentIdentity(command);
      if (identity.commandDigest !== row.command_sha256 || identity.idempotencyKey !== row.idempotency_key) {
        throw new ConsentDeliveryError("identity_mismatch", false);
      }
      let proof: ConsentGrantProof | null = null;
      if (command.action === "grant") {
        const account = (await db.query("SELECT username,role,email_verified,auth_version FROM public.users WHERE id=$1",
          [loaded.userId])).rows[0];
        if (!account || account.role !== "candidate" || account.email_verified !== true
          || account.auth_version !== loaded.authVersion
          || sha256(account.username.trim().toLowerCase()) !== loaded.emailDigest) {
          throw new ConsentDeliveryError("account_changed", false);
        }
        if (command.source.resume) {
          const current = await ownedResume(db, loaded.userId, command.source.resume.resume_version_id, false);
          if (JSON.stringify(current) !== JSON.stringify(command.source.resume)) throw new ConsentDeliveryError("source_missing", false);
        }
        await requireCandidatePrivacyAllowed({ type: "candidate_user", id: loaded.userId },
          { globalUse: true, newGlobalOperation: true });
        proof = { verified_email: account.username.trim().toLowerCase(), privacy_subject: [
          { identifier_type: "email", value: account.username.trim().toLowerCase() },
          ...(command.source.resume ? [{ identifier_type: "vantahire_application_id" as const,
            value: String(command.source.resume.application_id) }] : []),
        ] };
      }
      const receipt = await deliver(command, proof, config.timeoutMs);
      await db.query("SELECT public.flow_ack_candidate_consent_outbox($1,$2,$3)",
        [row.outbox_id, row.generation, JSON.stringify(receipt)]);
    } catch (error) {
      let failure = error instanceof ConsentDeliveryError ? error : new ConsentDeliveryError("internal_error", true);
      if (error instanceof CandidateConsentError) failure = new ConsentDeliveryError("source_missing", false);
      if (error instanceof CandidatePrivacyRestrictedError) {
        const restricted = error.code === "candidate_privacy_restricted";
        failure = new ConsentDeliveryError(restricted ? "privacy_restricted" : "privacy_review", !restricted);
      }
      const delay = Math.min(60, 2 ** Math.max(1, Number(row.attempts)));
      await db.query("SELECT public.flow_fail_candidate_consent_outbox($1,$2,$3,$4,$5)",
        [row.outbox_id, row.generation, failure.code, failure.retryable, new Date(Date.now() + delay * 1000)]);
    }
  }));
  return claims.rows.length;
}

export function startConsentProcessor(config: ConsentDeliveryConfig = consentDeliveryConfig()): () => void {
  if (!config.enabled) return () => {};
  let running = false;
  let stopped = false;
  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try { await runConsentProcessorOnce(config); }
    catch { console.warn("candidate_consent_delivery_tick_failed"); }
    finally { running = false; }
  };
  const timer = setInterval(() => { void tick(); }, config.tickMs);
  timer.unref();
  void tick();
  return () => { stopped = true; clearInterval(timer); };
}
