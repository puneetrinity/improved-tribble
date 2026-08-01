import { describe, expect, it } from 'vitest';

import {
  getSkippedOutreachDisposition,
  getNextCandidateOutreachSchedule,
  isJobOpenForOutreach,
} from '../outreachSchedulerCore';

describe('candidate-owned outreach schedules', () => {
  it('starts round two from each candidate own successful first contact', () => {
    const earlyCandidateSentAt = new Date('2026-07-01T10:00:00Z');
    const lateCandidateSentAt = new Date('2026-07-10T10:00:00Z');

    const early = getNextCandidateOutreachSchedule(1, earlyCandidateSentAt);
    const late = getNextCandidateOutreachSchedule(1, lateCandidateSentAt);

    expect(early).toEqual({
      nextRound: 2,
      dueAt: new Date('2026-07-04T10:00:00Z'),
    });
    expect(late).toEqual({
      nextRound: 2,
      dueAt: new Date('2026-07-13T10:00:00Z'),
    });
  });

  it('chains round three from that candidate round two and then stops', () => {
    expect(getNextCandidateOutreachSchedule(
      2,
      new Date('2026-07-13T10:00:00Z'),
    )).toEqual({
      nextRound: 3,
      dueAt: new Date('2026-07-16T10:00:00Z'),
    });
    expect(getNextCandidateOutreachSchedule(3)).toBeNull();
  });

  it('never sends outreach for inactive, unapproved, or expired jobs', () => {
    const now = new Date('2026-07-31T12:00:00Z');
    const open = {
      isActive: true,
      status: 'approved',
      deadline: '2026-08-15',
      expiresAt: new Date('2026-08-15T12:00:00Z'),
    };

    expect(isJobOpenForOutreach(open, now)).toBe(true);
    expect(isJobOpenForOutreach({ ...open, isActive: false }, now)).toBe(false);
    expect(isJobOpenForOutreach({ ...open, status: 'pending' }, now)).toBe(false);
    expect(isJobOpenForOutreach({ ...open, deadline: '2026-07-31' }, now)).toBe(true);
    expect(isJobOpenForOutreach({ ...open, deadline: '2026-07-30' }, now)).toBe(false);
    expect(isJobOpenForOutreach({
      ...open,
      expiresAt: new Date('2026-07-30T12:00:00Z'),
    }, now)).toBe(false);
  });

  it('retries a pending compliance sync without exhausting the campaign', () => {
    expect(getSkippedOutreachDisposition('hygiene_sync_pending')).toEqual({
      action: 'retry',
      errorCode: 'hygiene_sync_pending',
      consumeAttempt: false,
    });
    expect(getSkippedOutreachDisposition('contact_unavailable')).toEqual({
      action: 'retry',
      errorCode: 'contact_unavailable',
      consumeAttempt: true,
    });
    expect(getSkippedOutreachDisposition('platform_suppressed')).toEqual({
      action: 'cancel',
      errorCode: 'platform_suppressed',
    });
  });
});
