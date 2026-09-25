import { z } from "zod";

const id = z.number().int().min(1).max(2_147_483_647);
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const decimalPattern = /^(0|[1-9][0-9]{0,18})$/;
export const historyDecimal = z.string().refine(value => decimalPattern.test(value)
  && BigInt(value) <= 9_223_372_036_854_775_807n);
const positiveDecimal = historyDecimal.refine(value => value !== "0");
export const historyWatermark = z.object({
  count: historyDecimal, event_id: uuid.nullable(), sequence: positiveDecimal.nullable(),
}).strict().refine(value => value.count === "0"
  ? value.event_id === null && value.sequence === null
  : value.event_id !== null && value.sequence !== null);
export const historyRequest = z.object({
  schema_version: z.literal(1), organization_id: id, application_id: id, job_id: id,
  reference_id: uuid, expected: historyWatermark,
}).strict();
export type HistoryRequest = z.infer<typeof historyRequest>;
export const historyAuthority = z.enum([
  "eligible", "awaiting_binding", "binding_conflict", "privacy_restricted", "temporarily_unavailable",
]);
export const historyFreshness = z.enum([
  "caught_up_to_observed_capture", "awaiting_delivery", "awaiting_binding", "projection_pending",
  "capture_gap", "temporarily_unavailable", "no_captured_stage_events", "history_changed_retry",
]);
const observation = z.object({
  event_id: uuid, sequence: positiveDecimal, occurred_at: z.string().datetime({ offset: true }),
}).strict();
export const historySummary = z.object({
  observed_stage_move_count: positiveDecimal, first: observation, latest: observation,
  latest_observed_stage_id: id, taxonomy_version: id,
  rubric_id: uuid.nullable(), rubric_version: id.nullable(),
  rubric_approval_mode: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/).nullable(),
  jd_digest_version: id.nullable(), recommendation_action: z.enum(["advance", "hold", "reject"]).nullable(),
  reason_code: z.string().regex(/^[a-z0-9][a-z0-9_]{0,79}$/).nullable(),
}).strict().refine(value => [value.rubric_id, value.rubric_version, value.rubric_approval_mode]
  .filter(item => item !== null).length % 3 === 0)
  .refine(value => decimalPattern.test(value.first.sequence) && decimalPattern.test(value.latest.sequence)
    && BigInt(value.first.sequence) <= BigInt(value.latest.sequence));
export const historyResponse = z.object({
  schema_version: z.literal(1),
  binding: z.object({ namespace: z.literal("organization_private"), organization_id: id,
    application_id: id, job_id: id, reference_id: uuid }).strict(),
  coverage: z.object({ event_types: z.tuple([z.literal("application_stage_moved")]),
    identity_basis: z.literal("organization_application_reference"), historical_complete: z.literal(false) }).strict(),
  freshness: z.object({ expected: historyWatermark, projected: historyWatermark,
    unresolved_count: historyDecimal, status: historyFreshness }).strict(),
  authority_status: historyAuthority, summary: historySummary.nullable(),
}).strict().superRefine((value, ctx) => {
  const fail = () => ctx.addIssue({ code: "custom", message: "history_contract_invalid" });
  const { projected, expected, status, unresolved_count } = value.freshness;
  if (value.authority_status !== "eligible" && value.summary !== null) fail();
  if (value.summary !== null && (value.summary.observed_stage_move_count !== projected.count
    || value.summary.latest.event_id !== projected.event_id
    || value.summary.latest.sequence !== projected.sequence)) fail();
  if (status === "caught_up_to_observed_capture" && (value.authority_status !== "eligible"
    || expected.count === "0" || JSON.stringify(projected) !== JSON.stringify(expected)
    || unresolved_count !== "0" || value.summary === null)) fail();
  if (status === "no_captured_stage_events" && (expected.count !== "0"
    || projected.count !== "0" || unresolved_count !== "0" || value.summary !== null
    || value.authority_status !== "eligible")) fail();
});
export type HistoryResponse = z.infer<typeof historyResponse>;
export const historyContext = z.union([
  z.object({ status: z.enum(["outside_private_history_scope", "awaiting_binding", "binding_conflict"]) }).strict(),
  z.object({ status: z.literal("bound"), organization_id: id, application_id: id, job_id: id,
    reference_id: uuid, candidate_id: uuid, captured: historyWatermark,
    delivery_sequence: positiveDecimal.nullable(),
    delivery_status: z.enum(["no_capture", "acknowledged", "awaiting_delivery"]), capture_gap: z.boolean(),
  }).strict().refine(value => value.captured.count === "0"
    ? value.delivery_sequence === null && value.delivery_status === "no_capture"
    : value.delivery_sequence !== null && value.delivery_status !== "no_capture"),
]);
export type HistoryContext = z.infer<typeof historyContext>;

/** Equality is about source identity, not an elapsed-time estimate. */
export function sameHistoryContext(a: HistoryContext, b: HistoryContext): boolean {
  return JSON.stringify(historyContext.parse(a)) === JSON.stringify(historyContext.parse(b));
}

export function validateHistoryResponse(value: unknown, request: HistoryRequest): HistoryResponse {
  const result = historyResponse.parse(value);
  const b = result.binding;
  if (b.organization_id !== request.organization_id || b.application_id !== request.application_id
    || b.job_id !== request.job_id || b.reference_id !== request.reference_id
    || JSON.stringify(result.freshness.expected) !== JSON.stringify(request.expected)) {
    throw new Error("history_response_mismatch");
  }
  return result;
}
