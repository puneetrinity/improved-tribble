import type { SourcingPreview } from './sourcing-authority';

/** Plain wording for the talent pool card. The estimate never promises what the search will return. */
export function poolCardCopy(p: SourcingPreview | undefined): { counted: boolean; headline: string; note: string } {
  const counted = p?.state === 'complete';
  if (!counted) {
    return { counted, headline: "We haven't estimated how many people match yet", note: 'The estimate is separate from your search results.' };
  }
  return {
    counted,
    headline: `${p!.countRelation === 'gte' ? 'At least' : 'About'} ${p!.count?.toLocaleString()} people match your search`,
    note: `Experience and skill requirements narrow the final results.${p!.stale ? ' This count is more than a day old.' : ''}`,
  };
}

/**
 * The readiness line under the talent pool card. Returns null when the search is ready.
 * While the search status or the criteria are still loading it says so, instead of
 * guessing that the criteria still need approval.
 */
export function poolPreparationMessage(input: {
  preview: SourcingPreview | undefined;
  previewError: boolean;
  briefLoaded: boolean;
  briefError: boolean;
  briefApproved: boolean;
  unsupported: string[];
}): string | null {
  const { preview: p, previewError, briefLoaded, briefError, briefApproved, unsupported } = input;
  if (p?.artifactId) return null;
  if (previewError) return "We couldn't confirm the search status. Please check again.";
  if (p?.preparationCode === 'QUERY_MAPPING_UNSUPPORTED') return `Some requirements can't be used to search yet${unsupported.length ? `: ${unsupported.join(', ')}` : ''}. Edit them to continue.`;
  if (p?.preparationCode === 'SOURCING_DIGEST_UNAUTHORIZED') return "We couldn't prepare this search. Please contact support.";
  if (p?.preparationCode === 'SOURCING_DIGEST_RATE_LIMITED') return 'Preparing searches is busy right now. Try again in a few minutes.';
  if (p?.preparation === 'failed') return "We couldn't prepare this search.";
  if (p?.preparation === 'unknown') return "This search's preparation needs a check by our team before you continue.";
  if (p?.preparation === 'reserved' || p?.preparation === 'started') return 'Getting your search ready. Find candidates turns on as soon as it is ready.';
  if (!p) return 'Checking your search status…';
  // Approval status is unknown when the criteria could not be loaded: never guess it.
  if (briefError) return "We couldn't load the hiring criteria. Please refresh the page.";
  if (!briefLoaded) return 'Checking your search status…';
  return briefApproved ? "Your search isn't ready yet." : 'Approve the hiring criteria to get this search ready.';
}
