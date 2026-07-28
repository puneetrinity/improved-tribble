import { describe, expect, it } from 'vitest';
import { selectDisplayCandidateEmails } from '../../../shared/contactResolution';
import { flattenCandidateForUI } from '../services/signal-contracts';

describe('candidate contact display policy', () => {
  it('hides every stored email after platform suppression', () => {
    expect(selectDisplayCandidateEmails({
      candidateState: 'shortlisted',
      status: 'suppressed',
      foundEmails: ['resolved@example.com'],
      foundEmail: 'primary@example.com',
    })).toEqual([]);
  });

  it('prefers resolved evidence over a legacy profile email', () => {
    expect(selectDisplayCandidateEmails({
      candidateState: 'shortlisted',
      status: 'resolved',
      foundEmails: ['selected@example.com'],
      foundEmail: 'primary@example.com',
    })).toEqual(['selected@example.com']);
  });

  it('never treats an unqualified profile blob as resolved contact evidence', () => {
    expect(selectDisplayCandidateEmails({
      candidateState: 'shortlisted',
      status: null,
      foundEmails: null,
      foundEmail: null,
    })).toEqual([]);
  });

  it.each(['pending', 'not_found', 'failed'] as const)(
    'does not display stale stored email fields while status is %s',
    (status) => {
      expect(selectDisplayCandidateEmails({
        candidateState: 'shortlisted',
        status,
        foundEmails: ['stale@example.com'],
        foundEmail: 'stale-primary@example.com',
      })).toEqual([]);
    },
  );

  it.each(['pending', 'suppressed', 'not_found', 'failed', null] as const)(
    'does not send stale stored email fields to the browser while status is %s',
    (status) => {
      const flattened = flattenCandidateForUI({
        id: 1,
        jobId: 2,
        signalCandidateId: 'candidate-1',
        fitScore: 70,
        fitBreakdown: {},
        sourceType: 'pool',
        state: 'shortlisted',
        foundEmail: 'stale-primary@example.com',
        foundEmails: ['stale@example.com'],
        emailResolvedAt: new Date('2026-07-25T10:00:00.000Z'),
        emailResolveStatus: status,
        candidateSummary: {},
        lastSyncedAt: null,
        createdAt: null,
      });

      expect(flattened.foundEmail).toBeNull();
      expect(flattened.foundEmails).toEqual([]);
      expect(flattened.cardSignals?.email ?? null).toBeNull();
      expect(JSON.stringify(flattened)).not.toContain('stale');
    },
  );

  it('sends selected contact evidence after resolution', () => {
    const flattened = flattenCandidateForUI({
      id: 1,
      jobId: 2,
      signalCandidateId: 'candidate-1',
      fitScore: 70,
      fitBreakdown: {},
      sourceType: 'pool',
      state: 'shortlisted',
      foundEmail: 'primary@example.com',
      foundEmails: ['primary@example.com', 'alternate@example.com'],
      emailResolvedAt: new Date('2026-07-25T10:00:00.000Z'),
      emailResolveStatus: 'resolved',
      candidateSummary: {},
      lastSyncedAt: null,
      createdAt: null,
    });

    expect(flattened.foundEmail).toBe('primary@example.com');
    expect(flattened.foundEmails).toEqual([
      'primary@example.com',
      'alternate@example.com',
    ]);
  });

  it.each(['new', 'hidden', 'converted'] as const)(
    'redacts resolved contact metadata while candidate state is %s',
    (state) => {
      const flattened = flattenCandidateForUI({
        id: 1,
        jobId: 2,
        signalCandidateId: 'candidate-1',
        fitScore: 70,
        fitBreakdown: {},
        sourceType: 'pool',
        state,
        foundEmail: 'resolved@example.com',
        foundEmails: ['resolved@example.com', 'alternate@example.com'],
        emailResolvedAt: new Date('2026-07-25T10:00:00.000Z'),
        emailResolveStatus: 'resolved',
        candidateSummary: {
          cardSignals: {
            email: 'legacy@example.com',
            emailAvailable: true,
          },
        },
        lastSyncedAt: null,
        createdAt: null,
      });

      expect(flattened.foundEmail).toBeNull();
      expect(flattened.foundEmails).toEqual([]);
      expect(flattened.emailResolvedAt).toBeNull();
      expect(flattened.emailResolveStatus).toBeNull();
      expect(flattened.cardSignals?.email).toBeNull();
      expect(flattened.cardSignals?.emailAvailable).toBe(false);
      expect(JSON.stringify(flattened)).not.toContain('@example.com');
      expect(selectDisplayCandidateEmails({
        candidateState: state,
        status: 'resolved',
        foundEmails: ['resolved@example.com'],
        foundEmail: 'resolved@example.com',
      })).toEqual([]);
    },
  );

  it('redacts legacy phone evidence before an unshortlisted candidate reaches the browser', () => {
    const flattened = flattenCandidateForUI({
      id: 1,
      jobId: 2,
      signalCandidateId: 'candidate-1',
      fitScore: 70,
      fitBreakdown: {},
      sourceType: 'pool',
      state: 'new',
      emailResolveStatus: null,
      candidateSummary: {
        cardSignals: {
          phone: '+1-415-555-0123',
          phoneAvailable: true,
        },
        candidate: {
          searchMeta: {
            crustdata: {
              basic_profile: {
                summary: 'Call 9876543210',
              },
            },
          },
        },
      },
      lastSyncedAt: null,
      createdAt: null,
    });

    expect(flattened.cardSignals?.phone).toBeNull();
    expect(flattened.cardSignals?.phoneAvailable).toBe(false);
    const serialized = JSON.stringify(flattened);
    expect(serialized).not.toContain('+1-415-555-0123');
    expect(serialized).not.toContain('9876543210');
  });

  it('redacts stale email evidence before a suppressed candidate reaches the browser', () => {
    const flattened = flattenCandidateForUI({
      id: 1,
      jobId: 2,
      signalCandidateId: 'candidate-1',
      fitScore: 70,
      fitBreakdown: {},
      sourceType: 'pool',
      state: 'shortlisted',
      foundEmail: 'resolved@example.com',
      foundEmails: ['resolved@example.com'],
      emailResolvedAt: new Date('2026-07-25T10:00:00.000Z'),
      emailResolveStatus: 'suppressed',
      candidateSummary: {
        cardSignals: {
          email: 'card@example.com',
          emailAvailable: true,
        },
        candidate: {
          searchMeta: {
            crustdata: {
              emails: ['legacy@example.com'],
              contact_info: {
                personal_emails: [{ email: 'provider@example.com' }],
              },
            },
          },
        },
        summary: 'Reach the candidate at prose@example.com',
      },
      lastSyncedAt: null,
      createdAt: null,
    });

    expect(flattened.foundEmail).toBeNull();
    expect(flattened.foundEmails).toEqual([]);
    expect(flattened.cardSignals?.email).toBeNull();
    expect(flattened.cardSignals?.emailAvailable).toBe(false);
    const serialized = JSON.stringify(flattened);
    expect(serialized).not.toContain('resolved@example.com');
    expect(serialized).not.toContain('legacy@example.com');
    expect(serialized).not.toContain('provider@example.com');
    expect(serialized).not.toContain('prose@example.com');
  });
});
