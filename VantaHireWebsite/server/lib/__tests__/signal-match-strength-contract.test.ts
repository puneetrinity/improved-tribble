import { describe, expect, it } from 'vitest';

import {
  fitBadgePresentation,
  fitDescription,
} from '../../../client/src/lib/sourcing-labels';
import { flattenCandidateForUI } from '../services/signal-contracts';

function rowWithCandidateSummary(candidateSummary: unknown) {
  return {
    id: 1,
    jobId: 2,
    signalCandidateId: 'signal-1',
    fitScore: 76,
    fitBreakdown: null,
    sourceType: 'discovered',
    state: 'new',
    candidateSummary,
    lastSyncedAt: null,
    createdAt: null,
  };
}

describe('flattenCandidateForUI match strength', () => {
  it('propagates a persisted Signal match strength', () => {
    const candidate = flattenCandidateForUI(
      rowWithCandidateSummary({
        sourcingContext: { rank: 1, matchStrength: 'possible' },
      }),
    );

    expect(candidate.matchStrength).toBe('possible');
  });

  it.each([
    {},
    { sourcingContext: { matchStrength: 'excellent' } },
    { sourcingContext: null },
  ])('returns null for an absent or invalid historical label', (candidateSummary) => {
    const candidate = flattenCandidateForUI(
      rowWithCandidateSummary(candidateSummary),
    );

    expect(candidate.matchStrength).toBeNull();
  });
});

describe('fitDescription', () => {
  it.each([
    ['strong', 'Strong match'],
    ['good', 'Good match'],
    ['possible', 'Possible match'],
  ] as const)('uses the persisted Signal %s label', (matchStrength, expected) => {
    expect(fitDescription(90, matchStrength)).toBe(expected);
  });

  it('does not infer strong for historical rows without Signal evidence', () => {
    expect(fitDescription(90, null)).toBe('Good match');
  });

  it('preserves lower score detail for historical rows', () => {
    expect(fitDescription(55)).toBe('Moderate match');
    expect(fitDescription(40)).toBe('Weak match');
  });

  it.each([
    ['strong', 'bg-emerald-50'],
    ['good', 'bg-amber-50'],
    ['possible', 'bg-slate-50'],
  ] as const)('uses the persisted %s label for its color', (matchStrength, color) => {
    expect(fitBadgePresentation(90, matchStrength).className).toContain(color);
  });

  it('keeps a historical high score visually below strong', () => {
    const presentation = fitBadgePresentation(90, null);

    expect(presentation.label).toBe('Good match');
    expect(presentation.className).toContain('bg-amber-50');
    expect(presentation.className).not.toContain('emerald');
  });
});
