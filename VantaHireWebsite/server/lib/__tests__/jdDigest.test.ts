import { describe, expect, it } from 'vitest';
import {
  normalizeAdjacentBuckets,
  normalizeAdjacentLocations,
  workerDigestSource,
  persistWorkerDigest,
  type JDDigest,
} from '../jdDigest';
import { JDDigestResponseSchema } from '../aiResponseSchemas';

describe('JD digest relaxation adjacency', () => {
  it('stamps only the compared canonical source hash in the same cache write',async()=>{
    const calls:Array<{text:string;params:unknown[]}>=[];
    const pg={query:async(text:string,params:unknown[])=>{calls.push({text,params});return {rows:[{id:1}]};}};
    for(const currentJDHash of ['a'.repeat(64),null]) {
      expect(await persistWorkerDigest(pg,{id:1,title:'Engineer',location:'Bengaluru',currentJDHash},{version:3} as JDDigest)).toBe(true);
      expect(calls.at(-1)?.text).toContain('jd_digest_source_hash=$4');
      expect(calls.at(-1)?.text).toContain('current_jd_hash IS NOT DISTINCT FROM $4');
      expect(calls.at(-1)?.params[3]).toBe(currentJDHash);
    }
  });
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
