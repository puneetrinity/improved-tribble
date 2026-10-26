import { describe, expect, it } from 'vitest';
import { flattenCandidateForUI } from '../services/signal-contracts';
import { readResumeLocation, resumeLocationText } from '../../../shared/resume-location';

const applicantOrigin={version:1,kind:'organization_candidate',applicationId:12,applicationJobId:3};
const row=(candidateSummary:unknown)=>flattenCandidateForUI({id:1,jobId:2,signalCandidateId:'candidate-1',fitScore:0,
  fitBreakdown:{},sourceType:'pool',state:'new',lastSyncedAt:null,createdAt:null,candidateSummary});
const located={version:1,provenance:'resume',city:'Bengaluru',country:'India'};

describe('previous-applicant résumé location', () => {
  it('passes a valid résumé location through for previous applicants only', () => {
    expect(row({candidateOrigin:applicantOrigin,resumeLocation:located}).resumeLocation).toEqual({city:'Bengaluru',country:'India'});
    expect(row({candidateOrigin:applicantOrigin,resumeLocation:{...located,city:null}}).resumeLocation).toEqual({city:null,country:'India'});
  });
  it('treats a missing or malformed location as unknown, never guessed', () => {
    expect(row({candidateOrigin:applicantOrigin}).resumeLocation).toBeNull();
    for(const bad of [{...located,provenance:'job'},{...located,version:2},{...located,city:''},{...located,extra:'x'},'Bengaluru',null])
      expect(row({candidateOrigin:applicantOrigin,resumeLocation:bad}).resumeLocation).toBeNull();
  });
  it('never attaches a résumé location to a public profile, even if one was stored', () => {
    const publicCard=row({resumeLocation:located,candidate:{resumeLocation:located}});
    expect(publicCard).not.toHaveProperty('resumeLocation');
    expect(JSON.stringify(publicCard)).not.toContain('Bengaluru');
  });
  it('does not leak the raw stored field through the summary of an applicant card', () => {
    const card=row({candidateOrigin:applicantOrigin,resumeLocation:{...located,city:'Mumbai',note:'raw'},candidate:{resumeLocation:located}});
    expect(card.resumeLocation).toBeNull();expect(JSON.stringify(card)).not.toMatch(/Mumbai|raw/);
  });
  it('formats city and country, country alone, and unknown', () => {
    expect(resumeLocationText({city:'Pune',country:'India'})).toBe('Pune, India');
    expect(resumeLocationText({city:null,country:'India'})).toBe('India');
    expect(resumeLocationText({city:null,country:null})).toBeNull();
    expect(resumeLocationText(null)).toBeNull();
    expect(readResumeLocation(located)).toEqual({city:'Bengaluru',country:'India'});
  });
});
