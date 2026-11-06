/**
 * Where a sourced result came from. Reads the shared strict contract
 * (`shared/sourcing-candidate-origin.ts`). The server still enforces access;
 * these IDs are display links, never permission grants.
 *
 * Fail closed: only an ABSENT origin means the historical public profile. null,
 * malformed or unknown origins are 'invalid' and show no LinkedIn, contact or
 * outreach controls.
 */
import { readSourcingCandidateOrigin } from '@shared/sourcing-candidate-origin';

export type { SourcingCandidateOrigin } from '@shared/sourcing-candidate-origin';

export type ReadOrigin =
  | { kind: 'public_profile' }
  | { kind: 'organization_candidate'; applicationId: number; applicationJobId: number }
  /** spark network candidate: redacted card, no LinkedIn, contact or outreach controls. */
  | { kind: 'candidate_network' }
  | { kind: 'invalid' };

export function readCandidateOrigin(value: unknown): ReadOrigin {
  const origin = readSourcingCandidateOrigin(value);
  if (origin.kind === 'organization_candidate') {
    return { kind: 'organization_candidate', applicationId: origin.applicationId, applicationJobId: origin.applicationJobId };
  }
  return { kind: origin.kind };
}

/** Public profiles only: LinkedIn link, paid contact lookup and cold outreach. */
export const allowsPublicContact = (origin: ReadOrigin): boolean => origin.kind === 'public_profile';

const pickText = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * Display name. Public profiles use the profile name. Previous applicants use the name on their
 * application in this organisation, which the server reads and authorises; never a profile guess.
 * spark network candidates have no provider profile: their name is the server's redacted summary
 * hint (the candidate's confirmed, published name).
 */
export function candidateDisplayName(origin: ReadOrigin, profileName: unknown, summaryName: unknown): string {
  if (origin.kind === 'organization_candidate') return pickText(summaryName) ?? 'Previous applicant';
  if (origin.kind === 'candidate_network') return pickText(summaryName) ?? 'Unknown Candidate';
  return pickText(profileName) ?? 'Unknown Candidate';
}

/** Card/drawer location for non-applicants: provider profile location, or for spark network
 * candidates the server's location label (their published location). Applicants use their résumé location instead. */
export function candidateLocationText(origin: ReadOrigin, profileLocation: unknown, summaryLocation: unknown): string | null {
  return origin.kind === 'candidate_network' ? pickText(summaryLocation) : pickText(profileLocation);
}

export function applicationHref(origin: ReadOrigin): string | null {
  return origin.kind === 'organization_candidate'
    ? `/jobs/${origin.applicationJobId}/applications?applicationId=${origin.applicationId}`
    : null;
}
