import { pool } from "../db";
import {
  decisionProjectionEnvelopeSchema,
  type ClaimedDecisionProjection,
  type DecisionProjectionReceipt,
  type SafeDeliveryErrorCode,
} from "./models";

interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}

function safeNumber(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error("decision_projection_row_invalid");
  return parsed;
}

export function rowToClaim(row: any): ClaimedDecisionProjection {
  const envelope = decisionProjectionEnvelopeSchema.parse({
    event_id: String(row.event_id),
    delivery_sequence: safeNumber(row.delivery_sequence),
    source_event_sequence: safeNumber(row.source_event_sequence),
    organization_id: Number(row.organization_id),
    payload_schema_version: Number(row.payload_schema_version),
    source_system: row.source_system,
    subject_type: row.subject_type,
    subject_id: Number(row.subject_id),
    job_id: Number(row.job_id),
    action_code: row.action_code,
    taxonomy_version: Number(row.taxonomy_version),
    rubric_id: row.rubric_id == null ? null : String(row.rubric_id),
    rubric_version: row.rubric_version == null ? null : Number(row.rubric_version),
    rubric_approval_mode: row.rubric_approval_mode ?? null,
    jd_digest_version: row.jd_digest_version == null ? null : Number(row.jd_digest_version),
    recommendation_action: row.recommendation_action ?? null,
    reason_code: row.reason_code ?? null,
    before_state: row.before_state,
    after_state: row.after_state,
    occurred_at: new Date(row.occurred_at).toISOString(),
  });
  return {
    envelope,
    leaseToken: String(row.lease_token),
    leaseGeneration: safeNumber(row.lease_generation),
    attemptCount: safeNumber(row.attempt_count),
  };
}

export async function claimDecisionProjection(
  leaseMs: number,
  maxAttempts: number,
  db: Queryable = pool,
): Promise<ClaimedDecisionProjection | null> {
  const result = await db.query(
    "SELECT * FROM public.claim_decision_projection_delivery($1,$2)",
    [leaseMs, maxAttempts],
  );
  return result.rows[0] ? rowToClaim(result.rows[0]) : null;
}

export async function acknowledgeDecisionProjection(
  claim: ClaimedDecisionProjection,
  receipt: DecisionProjectionReceipt,
  db: Queryable = pool,
): Promise<boolean> {
  const result = await db.query(
    "SELECT outcome FROM public.ack_decision_projection_delivery($1,$2,$3,$4,$5)",
    [claim.envelope.event_id, claim.leaseToken, claim.leaseGeneration,
      claim.envelope.delivery_sequence, receipt.status],
  );
  return result.rows[0]?.outcome === "acknowledged";
}

export async function failDecisionProjection(
  claim: ClaimedDecisionProjection,
  errorCode: SafeDeliveryErrorCode,
  retryable: boolean,
  maxAttempts: number,
  db: Queryable = pool,
): Promise<"retry" | "terminal" | null> {
  const result = await db.query(
    "SELECT outcome,resulting_state FROM public.fail_decision_projection_delivery($1,$2,$3,$4,$5,$6)",
    [claim.envelope.event_id, claim.leaseToken, claim.leaseGeneration,
      errorCode, retryable, maxAttempts],
  );
  const state = result.rows[0]?.resulting_state;
  return state === "retry" || state === "terminal" ? state : null;
}
