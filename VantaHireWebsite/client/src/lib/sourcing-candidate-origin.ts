/**
 * Where a sourced result came from. UI-side reading of the PROPOSED contract
 * (Codex, 2026-10-16); replace with the shared validator once
 * `shared/sourcing-candidate-origin.ts` lands. The server still enforces access;
 * these IDs are display links, never permission grants.
 *
 * Fail closed: only an ABSENT origin means the historical public profile. null,
 * malformed or unknown origins are 'invalid' and show no LinkedIn, contact or
 * outreach controls.
 */
export type SourcingCandidateOrigin =
  | { version: 1; kind: 'public_profile' }
  | { version: 1; kind: 'organization_candidate'; applicationId: number; applicationJobId: number };

export type ReadOrigin =
  | { kind: 'public_profile' }
  | { kind: 'organization_candidate'; applicationId: number; applicationJobId: number }
  | { kind: 'invalid' };

const positiveInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;

export function readCandidateOrigin(value: unknown): ReadOrigin {
  if (value === undefined) return { kind: 'public_profile' };
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { kind: 'invalid' };
  const v = value as Record<string, unknown>;
  if (v.version !== 1) return { kind: 'invalid' };
  if (v.kind === 'public_profile' && Object.keys(v).length === 2) return { kind: 'public_profile' };
  if (v.kind === 'organization_candidate' && Object.keys(v).length === 4
    && positiveInt(v.applicationId) && positiveInt(v.applicationJobId)) {
    return { kind: 'organization_candidate', applicationId: v.applicationId, applicationJobId: v.applicationJobId };
  }
  return { kind: 'invalid' };
}

/** Public profiles only: LinkedIn link, paid contact lookup and cold outreach. */
export const allowsPublicContact = (origin: ReadOrigin): boolean => origin.kind === 'public_profile';

export function applicationHref(origin: ReadOrigin): string | null {
  return origin.kind === 'organization_candidate'
    ? `/jobs/${origin.applicationJobId}/applications?applicationId=${origin.applicationId}`
    : null;
}
