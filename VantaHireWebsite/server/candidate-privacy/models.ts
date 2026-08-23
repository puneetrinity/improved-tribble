import { z } from "zod";

export const privacyActions = ["withdraw_global_matching", "request_erasure"] as const;
export type PrivacyAction = (typeof privacyActions)[number];

export const privacyAuthorities = ["verified_candidate", "privacy_operator"] as const;
export type PrivacyAuthority = (typeof privacyAuthorities)[number];

export const privacyReasons = [
  "candidate_global_opt_out",
  "candidate_erasure_request",
  "verified_support_request",
] as const;
export type PrivacyReason = (typeof privacyReasons)[number];

export const localPrivacyStates = [
  "accepted_local",
  "delivery_pending",
  "memory_active",
  "needs_review",
  "released",
  "superseded",
] as const;
export type LocalPrivacyState = (typeof localPrivacyStates)[number];

export const remotePrivacyStates = [
  "requested",
  "verified",
  "active_quarantine",
  "needs_review",
  "released",
  "superseded",
] as const;
export type RemotePrivacyState = (typeof remotePrivacyStates)[number];

export const privacyDecisions = ["allow", "block_global", "block_all", "review"] as const;
export type RemotePrivacyDecision = (typeof privacyDecisions)[number];
export type FlowPrivacyDecision =
  | "allow_existing_org_workflow"
  | "block_global"
  | "block_all"
  | "review";

export const candidateRequestSchema = z.object({
  requestId: z.string().uuid(),
  action: z.enum(privacyActions),
}).strict();

export const operatorSubjectTypes = [
  "candidate_user",
  "application",
  "candidate_resume",
  "talent_pool",
  "job_sourced_candidate",
] as const;

export const operatorRequestSchema = z.object({
  requestId: z.string().uuid(),
  action: z.enum(privacyActions),
  subjectType: z.enum(operatorSubjectTypes),
  subjectId: z.number().int().positive(),
  evidenceRef: z.string().uuid(),
  authorityType: z.literal("privacy_operator"),
  reasonCode: z.literal("verified_support_request"),
}).strict();

export const reauthSchema = z.object({ password: z.string().min(1).max(1024) }).strict();

export interface MinimalPrivacyRequest {
  requestId: string;
  action: PrivacyAction;
  state: LocalPrivacyState;
  effectiveAt: string;
  deliveryStatus: "pending" | "leased" | "retry" | "delivered" | "terminal";
  directiveId: string | null;
  remoteState: RemotePrivacyState | null;
  decision: RemotePrivacyDecision | null;
}

export interface PrivacyIdentifier {
  identifier_type:
    | "email"
    | "phone"
    | "signal_candidate_id"
    | "vantahire_application_id"
    | "vantahire_resume_id";
  value: string;
}

export interface MemoryDirectiveResponse {
  request_id: string;
  directive_id: string;
  action: PrivacyAction;
  scope: "global_matching" | "active_profile";
  state: RemotePrivacyState;
  version: number;
  effective_at: string;
  decision: RemotePrivacyDecision;
}

export interface MemoryChange {
  cursor: number;
  event_id: string;
  directive_id: string;
  action: PrivacyAction;
  scope: "global_matching" | "active_profile";
  state: RemotePrivacyState;
  version: number;
  effective_at: string;
}

export interface MemorySnapshotDirective {
  directive_id: string;
  action: PrivacyAction;
  scope: "global_matching" | "active_profile";
  state: RemotePrivacyState;
  version: number;
  effective_at: string;
}

export const memoryDirectiveResponseSchema = z.object({
  request_id: z.string().uuid(),
  directive_id: z.string().uuid(),
  action: z.enum(privacyActions),
  scope: z.enum(["global_matching", "active_profile"]),
  state: z.enum(remotePrivacyStates),
  version: z.number().int().positive(),
  effective_at: z.string().datetime({ offset: true }),
  decision: z.enum(privacyDecisions),
}).strict();

export const memoryChangesSchema = z.object({
  events: z.array(z.object({
    cursor: z.number().int().nonnegative(),
    event_id: z.string().uuid(),
    directive_id: z.string().uuid(),
    action: z.enum(privacyActions),
    scope: z.enum(["global_matching", "active_profile"]),
    state: z.enum(remotePrivacyStates),
    version: z.number().int().positive(),
    effective_at: z.string().datetime({ offset: true }),
  }).strict()).max(500),
  count: z.number().int().nonnegative().max(500),
}).strict();

export const memorySnapshotSchema = z.object({
  high_water_cursor: z.number().int().nonnegative(),
  directives: z.array(z.object({
    directive_id: z.string().uuid(),
    action: z.enum(privacyActions),
    scope: z.enum(["global_matching", "active_profile"]),
    state: z.enum(remotePrivacyStates),
    version: z.number().int().positive(),
    effective_at: z.string().datetime({ offset: true }),
  }).strict()).max(500),
  count: z.number().int().nonnegative().max(500),
}).strict();

export const memoryEligibilitySchema = z.object({
  results: z.array(z.object({
    request_ref: z.string().uuid(),
    decision: z.enum(privacyDecisions),
  }).strict()).min(1).max(200),
  count: z.number().int().positive().max(200),
}).strict();

export function decisionForRemote(
  state: RemotePrivacyState,
  action: PrivacyAction,
): RemotePrivacyDecision {
  if (state === "needs_review") return "review";
  if (state === "active_quarantine") {
    return action === "request_erasure" ? "block_all" : "block_global";
  }
  return "allow";
}
