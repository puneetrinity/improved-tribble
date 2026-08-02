import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createOutreachApplicationToken,
  createOutreachUnsubscribeToken,
  hashOutreachEmail,
  verifyOutreachApplicationToken,
  verifyOutreachUnsubscribeToken,
} from '../outreachComplianceCore';
import {
  appendOutreachComplianceFooter,
  buildBrevoCorrelationHeader,
  buildOutreachApplicationUrl,
  buildOutreachUnsubscribeUrl,
  parseBrevoCorrelationHeader,
} from '../outreachEmail';

const SECRET = 'test-only-unsubscribe-secret-that-is-long-enough';

describe('outreach compliance primitives', () => {
  beforeEach(() => {
    process.env.OUTREACH_UNSUBSCRIBE_SECRET = SECRET;
    process.env.BASE_URL = 'https://ealana.example';
  });

  afterEach(() => {
    delete process.env.OUTREACH_UNSUBSCRIBE_SECRET;
    delete process.env.BASE_URL;
  });

  it('normalizes email identity and signs an org-scoped unsubscribe claim', () => {
    const token = createOutreachUnsubscribeToken({
      organizationId: 9,
      sourcedCandidateId: 41,
      campaignId: 'campaign-1',
      campaignRound: 2,
      email: ' Candidate@Example.COM ',
    });
    const claims = verifyOutreachUnsubscribeToken(token);

    expect(claims).toMatchObject({
      organizationId: 9,
      sourcedCandidateId: 41,
      campaignId: 'campaign-1',
      campaignRound: 2,
      emailHash: hashOutreachEmail('candidate@example.com'),
    });
    expect(claims.emailHash).not.toContain('candidate');
  });

  it('rejects a tampered org or signature', () => {
    const token = createOutreachUnsubscribeToken({
      organizationId: 9,
      sourcedCandidateId: 41,
      campaignId: 'campaign-1',
      campaignRound: 1,
      email: 'candidate@example.com',
    });
    const [payload, signature] = token.split('.');
    const decoded = JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8'));
    decoded.organizationId = 10;
    const tamperedPayload = Buffer.from(JSON.stringify(decoded)).toString('base64url');

    expect(() => verifyOutreachUnsubscribeToken(`${tamperedPayload}.${signature}`))
      .toThrow('Invalid unsubscribe token');
  });

  it('adds working unsubscribe URLs to HTML and text without exposing the address', () => {
    const url = buildOutreachUnsubscribeUrl({
      organizationId: 9,
      sourcedCandidateId: 41,
      campaignId: 'campaign-1',
      campaignRound: 1,
      email: 'candidate@example.com',
    });
    const content = appendOutreachComplianceFooter('<p>Hello</p>', 'Hello', url);

    expect(url).toMatch(/^https:\/\/ealana\.example\/api\/outreach\/unsubscribe\?token=/);
    expect(content.html).toContain('Unsubscribe');
    expect(content.text).toContain(url);
    expect(`${content.html}${content.text}${url}`).not.toContain('candidate@example.com');
  });

  it('round-trips the opaque Brevo delivery correlation header', () => {
    const deliveryId = '5a5ee83e-bc78-4477-9a36-8427b4576c14';
    const header = buildBrevoCorrelationHeader(deliveryId);
    expect(parseBrevoCorrelationHeader(header)).toBe(deliveryId);
    expect(parseBrevoCorrelationHeader(`source:flow|${header}|round:2`)).toBe(deliveryId);
    expect(parseBrevoCorrelationHeader('source:flow')).toBeNull();
  });

  it('signs an opaque apply attribution without exposing candidate data', () => {
    const token = createOutreachApplicationToken({
      organizationId: 9,
      jobId: 17,
      sourcedCandidateId: 41,
      campaignId: 'campaign-1',
      campaignRound: 2,
    });
    expect(verifyOutreachApplicationToken(token)).toMatchObject({
      organizationId: 9,
      jobId: 17,
      sourcedCandidateId: 41,
      campaignId: 'campaign-1',
      campaignRound: 2,
    });

    const url = buildOutreachApplicationUrl({
      publicJobUrl: 'https://ealana.example/jobs/backend-engineer',
      organizationId: 9,
      jobId: 17,
      sourcedCandidateId: 41,
      campaignId: 'campaign-1',
      campaignRound: 2,
    });
    expect(url).toContain('?outreach=');
    expect(url).not.toContain('candidate@example.com');
  });

  it('expires an apply attribution token, but never an unsubscribe token', () => {
    const DAY_MS = 24 * 60 * 60 * 1000;
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      const applicationToken = createOutreachApplicationToken({
        organizationId: 9,
        jobId: 17,
        sourcedCandidateId: 41,
        campaignId: 'campaign-1',
        campaignRound: 2,
      });
      const unsubscribeToken = createOutreachUnsubscribeToken({
        organizationId: 9,
        sourcedCandidateId: 41,
        campaignId: 'campaign-1',
        campaignRound: 2,
        email: 'candidate@example.com',
      });

      // Inside the window both still verify.
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z').getTime() + 29 * DAY_MS);
      expect(verifyOutreachApplicationToken(applicationToken)).toMatchObject({
        campaignId: 'campaign-1',
      });

      // One day past the bound the attribution token is refused...
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z').getTime() + 31 * DAY_MS);
      expect(() => verifyOutreachApplicationToken(applicationToken)).toThrow(
        'Invalid outreach application token',
      );

      // ...but the opt-out link must keep working, years later. A recipient who
      // finds an old email has to be able to stop the outreach.
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z').getTime() + 900 * DAY_MS);
      expect(verifyOutreachUnsubscribeToken(unsubscribeToken)).toMatchObject({
        organizationId: 9,
        emailHash: hashOutreachEmail('candidate@example.com'),
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
