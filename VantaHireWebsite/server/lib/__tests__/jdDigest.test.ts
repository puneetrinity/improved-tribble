import { describe, expect, it } from 'vitest';
import {
  normalizeAdjacentBuckets,
  normalizeAdjacentLocations,
} from '../jdDigest';
import { JDDigestResponseSchema } from '../aiResponseSchemas';

describe('JD digest relaxation adjacency', () => {
  it('keeps later title buckets distinct from the exact title query and each other', () => {
    expect(normalizeAdjacentBuckets([
      ['Backend Engineer', 'Platform Engineer', 'backend engineer'],
      ['platform engineer', 'Site Reliability Engineer'],
    ], ['backend engineer', 'backend developer'])).toEqual([
      ['platform engineer'],
      ['site reliability engineer'],
    ]);
  });

  it('drops blank and duplicate adjacent locations while retaining their country', () => {
    expect(normalizeAdjacentLocations([
      { metro: 'Pune', country: 'India' },
      { metro: 'pune', country: 'india' },
      { metro: 'Hyderabad', country: 'India' },
      { metro: '', country: 'India' },
    ])).toEqual([
      { metro: 'Pune', country: 'India' },
      { metro: 'Hyderabad', country: 'India' },
    ]);
  });

  it('retains valid v3 adjacency and isolates malformed optional adjacency', () => {
    expect(JDDigestResponseSchema.parse({
      adjacentBuckets: [['platform engineer']],
      adjacentLocations: [{ metro: 'Pune', country: 'India' }],
    })).toMatchObject({
      adjacentBuckets: [['platform engineer']],
      adjacentLocations: [{ metro: 'Pune', country: 'India' }],
    });

    expect(JDDigestResponseSchema.parse({
      topSkills: ['typescript'],
      adjacentBuckets: 'not-an-array',
      adjacentLocations: 'not-an-array',
    })).toMatchObject({
      topSkills: ['typescript'],
      adjacentBuckets: [],
      adjacentLocations: [],
    });
  });
});
