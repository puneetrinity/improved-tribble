import { z } from "zod";

const positiveSafeInteger = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const stageStateSchema = z.object({ stage_id: z.number().int().positive().nullable() }).strict();

export const decisionProjectionEnvelopeSchema = z.object({
  event_id: z.string().uuid(),
  delivery_sequence: positiveSafeInteger,
  source_event_sequence: positiveSafeInteger,
  organization_id: z.number().int().positive(),
  payload_schema_version: z.literal(1),
  source_system: z.literal("flow"),
  subject_type: z.literal("application"),
  subject_id: z.number().int().positive(),
  job_id: z.number().int().positive(),
  action_code: z.literal("application_stage_moved"),
  taxonomy_version: z.number().int().positive(),
  rubric_id: z.string().uuid().nullable(),
  rubric_version: z.number().int().positive().nullable(),
  rubric_approval_mode: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/).nullable(),
  jd_digest_version: z.number().int().positive().nullable(),
  recommendation_action: z.enum(["advance", "hold", "reject"]).nullable(),
  reason_code: z.string().regex(/^[a-z0-9][a-z0-9_]{0,79}$/).nullable(),
  before_state: stageStateSchema,
  after_state: z.object({ stage_id: z.number().int().positive() }).strict(),
  occurred_at: z.string().datetime({ offset: true }),
}).strict().superRefine((value, ctx) => {
  const rubricValues = [value.rubric_id, value.rubric_version, value.rubric_approval_mode];
  const populated = rubricValues.filter((entry) => entry !== null).length;
  if (populated !== 0 && populated !== rubricValues.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "rubric reference must be complete" });
  }
  if (value.before_state.stage_id === value.after_state.stage_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "state must change" });
  }
});

export const decisionProjectionReceiptSchema = z.object({
  event_id: z.string().uuid(),
  delivery_sequence: positiveSafeInteger,
  status: z.enum(["inserted", "replayed"]),
}).strict();

export const safeDeliveryErrorCodes = [
  "timeout", "network", "remote_408", "remote_425", "remote_429", "remote_5xx",
  "remote_400", "remote_401", "remote_403", "payload_conflict", "remote_422",
  "invalid_response", "internal_error",
] as const;

export type SafeDeliveryErrorCode = (typeof safeDeliveryErrorCodes)[number];
export type DecisionProjectionEnvelope = z.infer<typeof decisionProjectionEnvelopeSchema>;
export type DecisionProjectionReceipt = z.infer<typeof decisionProjectionReceiptSchema>;

export interface ClaimedDecisionProjection {
  envelope: DecisionProjectionEnvelope;
  leaseToken: string;
  leaseGeneration: number;
  attemptCount: number;
}
