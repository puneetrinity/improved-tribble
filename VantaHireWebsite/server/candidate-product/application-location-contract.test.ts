import {describe,it,expect} from 'vitest';
import {candidateLocationSchema} from '../../shared/application-location';
describe('candidate-confirmed application location contract',()=>{
 const value={version:2,provenance:'candidate_confirmed',city:'Bengaluru',countryCode:'IN',confirmedAt:'2026-11-03T12:00:00.000Z'};
 it('accepts the independent server-stamped envelope',()=>expect(candidateLocationSchema.parse(value)).toEqual(value));
 it.each([
  {...value,version:1},{...value,provenance:'resume'},{...value,city:''},
  {...value,city:'  '},{...value,city:'a'.repeat(201)},{...value,countryCode:'ZZ'},
  {...value,confirmedAt:'2026-02-30T12:00:00.000Z'},
  {...value,confirmedAt:'yesterday'},{...value,extra:true},{...value,city:'\0'},
  {...value,city:'\u0001'.repeat(199)+'a'},
 ])('rejects malformed or inferred facts %#',v=>expect(candidateLocationSchema.safeParse(v).success).toBe(false));
 it('counts Unicode characters, not UTF-16 code units',()=>expect(candidateLocationSchema.safeParse({...value,city:'🏙'.repeat(200)}).success).toBe(true));
});
