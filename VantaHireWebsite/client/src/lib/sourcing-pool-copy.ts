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
