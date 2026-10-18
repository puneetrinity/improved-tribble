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

/**
 * Display name. Public profiles use the profile name. Previous applicants use the name on their
 * application in this organisation, which the server reads and authorises; never a profile guess.
 */
export function candidateDisplayName(origin: ReadOrigin, profileName: unknown, applicationName: unknown): string {
  const pick = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  if (origin.kind === 'organization_candidate') return pick(applicationName) ?? 'Previous applicant';
  return pick(profileName) ?? 'Unknown Candidate';
}

export function applicationHref(origin: ReadOrigin): string | null {
  return origin.kind === 'organization_candidate'
    ? `/jobs/${origin.applicationJobId}/applications?applicationId=${origin.applicationId}`
    : null;
}
