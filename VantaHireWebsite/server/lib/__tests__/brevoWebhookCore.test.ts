import { describe, expect, it } from 'vitest';

import {
  BREVO_WEBHOOK_PROCESSING_LEASE_MS,
  canClaimBrevoWebhookEvent,
  deriveBrevoEventId,
  isPersonTerminalHygieneEvent,
  normalizeBrevoHygieneEventType,
  normalizeBrevoMessageId,
  verifyBrevoBearerToken,
} from '../brevoWebhookCore';

describe('Brevo hygiene webhook contracts', () => {
  it('processes hygiene events and explicitly ignores opens and clicks', () => {
    expect(normalizeBrevoHygieneEventType('hardBounce')).toBe('hard_bounce');
    expect(normalizeBrevoHygieneEventType('invalid')).toBe('hard_bounce');
    expect(normalizeBrevoHygieneEventType('invalid_email')).toBe('hard_bounce');
    // 'blocked' is ambiguous in Brevo (unsubscribe, spam, bounce, or manual
    // listing). Mapping it to hard_bounce would escalate an org-scoped
    // unsubscribe into a platform-wide tombstone, so it must NOT suppress.
    expect(normalizeBrevoHygieneEventType('blocked')).toBeNull();
    expect(normalizeBrevoHygieneEventType('softBounce')).toBe('soft_bounce');
    expect(normalizeBrevoHygieneEventType('spam')).toBe('complaint');
    expect(normalizeBrevoHygieneEventType('unsubscribed')).toBe('unsubscribed');
    expect(normalizeBrevoHygieneEventType('opened')).toBeNull();
    expect(normalizeBrevoHygieneEventType('click')).toBeNull();
    expect(normalizeBrevoHygieneEventType('proxy_open')).toBeNull();
  });

  it('requires a configured 32-character bearer token and compares exactly', () => {
    const token = 'a-secure-test-token-that-is-longer-than-32';
    expect(verifyBrevoBearerToken(`Bearer ${token}`, token)).toBe(true);
    expect(verifyBrevoBearerToken('Bearer wrong-value', token)).toBe(false);
    expect(verifyBrevoBearerToken(undefined, token)).toBe(false);
    expect(() => verifyBrevoBearerToken('Bearer short', 'short'))
      .toThrow('at least 32 characters');
  });

  it('derives stable opaque event IDs without retaining the recipient', () => {
    const input = {
      eventType: 'hard_bounce' as const,
      messageId: '<MESSAGE@BREVO>',
      timestamp: 123,
      webhookId: 45,
      email: 'Candidate@Example.com',
      customHeader: 'delivery_id:5a5ee83e-bc78-4477-9a36-8427b4576c14',
    };
    const first = deriveBrevoEventId(input);
    const second = deriveBrevoEventId(input);

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain('candidate');
    expect(normalizeBrevoMessageId(input.messageId)).toBe('message@brevo');
  });

  it('reclaims failed and expired processing claims, but not active claims', () => {
    const now = new Date('2026-07-31T12:00:00Z');
    expect(canClaimBrevoWebhookEvent(
      'failed',
      new Date(now.getTime()),
      now,
    )).toBe(true);
    expect(canClaimBrevoWebhookEvent(
      'processing',
      new Date(now.getTime() - BREVO_WEBHOOK_PROCESSING_LEASE_MS - 1),
      now,
    )).toBe(true);
    expect(canClaimBrevoWebhookEvent(
      'processing',
      new Date(now.getTime() - BREVO_WEBHOOK_PROCESSING_LEASE_MS + 1),
      now,
    )).toBe(false);
    expect(canClaimBrevoWebhookEvent(
      'processed',
      new Date(0),
      now,
    )).toBe(false);
  });

  it('treats bad addresses separately from person-level stop signals', () => {
    expect(isPersonTerminalHygieneEvent('hard_bounce')).toBe(false);
    expect(isPersonTerminalHygieneEvent('soft_bounce')).toBe(false);
    expect(isPersonTerminalHygieneEvent('complaint')).toBe(true);
    expect(isPersonTerminalHygieneEvent('unsubscribed')).toBe(true);
  });
});
