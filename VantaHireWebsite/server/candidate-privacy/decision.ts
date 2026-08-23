import {
  privacyDecisionForAnchor,
  type SubjectAnchor,
} from "./repository";
import type { FlowPrivacyDecision } from "./models";
import { randomUUID } from "node:crypto";
import { loadCandidatePrivacyConfig } from "./config";
import { checkMemoryEligibility } from "./memory-client";
import type { PrivacyIdentifier } from "./models";

export class CandidatePrivacyRestrictedError extends Error {
  constructor(
    public readonly code:
      | "candidate_privacy_restricted"
      | "candidate_privacy_unavailable"
      | "candidate_privacy_review_required",
  ) {
    super(code);
  }
}

export async function candidatePrivacyDecision(
  anchor: SubjectAnchor,
  options: { globalUse: boolean; newGlobalOperation?: boolean },
): Promise<FlowPrivacyDecision> {
  return privacyDecisionForAnchor(anchor, options);
}

export async function requireCandidatePrivacyAllowed(
  anchor: SubjectAnchor,
  options: { globalUse: boolean; newGlobalOperation?: boolean },
): Promise<void> {
  const decision = await candidatePrivacyDecision(anchor, options);
  if (decision === "review") {
    throw new CandidatePrivacyRestrictedError("candidate_privacy_review_required");
  }
  if (decision === "block_all" || (options.globalUse && decision === "block_global")) {
    throw new CandidatePrivacyRestrictedError("candidate_privacy_restricted");
  }
}

export async function requireNewCandidateIdentityAllowed(
  identifiers: PrivacyIdentifier[],
): Promise<void> {
  const config = loadCandidatePrivacyConfig();
  let decision: "allow" | "block_global" | "block_all" | "review";
  try {
    decision = await checkMemoryEligibility({
      requestRef: randomUUID(),
      identifiers,
      timeoutMs: config.memoryTimeoutMs,
    });
  } catch {
    throw new CandidatePrivacyRestrictedError("candidate_privacy_unavailable");
  }
  if (decision === "review") {
    throw new CandidatePrivacyRestrictedError("candidate_privacy_review_required");
  }
  if (decision !== "allow") {
    throw new CandidatePrivacyRestrictedError("candidate_privacy_restricted");
  }
}

/**
 * SQL fragment used by candidate readers. It must be placed in WHERE before
 * ORDER BY/LIMIT. `$requestAlias` and `$linkColumn` are static source-owned
 * identifiers, never request input.
 */
export function privacyAllowedSql(
  subjectType: SubjectAnchor["type"],
  qualifiedId: string,
  options: { globalUse: boolean },
): string {
  const columns: Record<SubjectAnchor["type"], string> = {
    candidate_user: "candidate_user_id",
    application: "application_id",
    candidate_resume: "candidate_resume_id",
    talent_pool: "talent_pool_id",
    job_sourced_candidate: "job_sourced_candidate_id",
  };
  const blocked = options.globalUse
    ? "('block_global','block_all','review')"
    : "('block_all','review')";
  return `NOT EXISTS (
    SELECT 1
      FROM candidate_privacy_subject_links privacy_link
      JOIN candidate_privacy_requests privacy_request
        ON privacy_request.request_id=privacy_link.request_id
      LEFT JOIN candidate_privacy_remote_projection privacy_remote
        ON privacy_remote.request_id=privacy_request.request_id
     WHERE privacy_link.subject_type='${subjectType}'
       AND privacy_link.${columns[subjectType]}=${qualifiedId}
       AND privacy_request.state IN ('accepted_local','delivery_pending','memory_active','needs_review')
       AND COALESCE(
         privacy_remote.decision,
         CASE
           WHEN privacy_request.state='needs_review' THEN 'review'
           WHEN privacy_request.action='request_erasure' THEN 'block_all'
           ELSE 'block_global'
         END
       ) IN ${blocked}
  )`;
}
