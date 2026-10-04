import { describe, expect, it } from 'vitest';
import {
  normalizeAdjacentBuckets,
  normalizeAdjacentLocations,
  workerDigestSource,
} from '../jdDigest';
import { JDDigestResponseSchema } from '../aiResponseSchemas';

describe('JD digest relaxation adjacency', () => {
  it('worker follows persisted canonical state without the web flag',()=>{
    expect(workerDigestSource({currentJD:'Approved canonical prose',originalJD:'Old source',description:'Old JSON'})).toBe('Approved canonical prose');
    expect(workerDigestSource({currentJD:null,originalJD:'Old source',description:'Fallback'})).toBe('Old source');
    expect(()=>workerDigestSource({currentJD:'{"private":true}',originalJD:'Old source',description:'Fallback'})).toThrow('BRIEF_SOURCE_REQUIRED');
  });
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
