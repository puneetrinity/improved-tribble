import { createHash, timingSafeEqual } from 'node:crypto';

import { hashOutreachEmail } from './outreachComplianceCore';

export type BrevoHygieneEvent =
  | 'hard_bounce'
  | 'soft_bounce'
  | 'complaint'
  | 'unsubscribed';

export const BREVO_WEBHOOK_PROCESSING_LEASE_MS = 5 * 60 * 1000;

export function isPersonTerminalHygieneEvent(
  eventType: BrevoHygieneEvent,
): boolean {
  return eventType === 'complaint' || eventType === 'unsubscribed';
}

export function canClaimBrevoWebhookEvent(
  status: string,
  processedAt: Date,
  now = new Date(),
): boolean {
  return status === 'failed'
    || (
      status === 'processing'
      && processedAt.getTime() < now.getTime() - BREVO_WEBHOOK_PROCESSING_LEASE_MS
    );
}

export function normalizeBrevoHygieneEventType(value: string): BrevoHygieneEvent | null {
  switch (value.replace(/[^a-z]/gi, '').toLowerCase()) {
    case 'hardbounce':
    case 'invalid':
    case 'invalidemail':
      return 'hard_bounce';
    // 'blocked' is DELIBERATELY not mapped. A Brevo contact is blocklisted for
    // several unrelated reasons — an unsubscribe, a spam report, a hard bounce,
    // or a manual/administrative listing — and the event does not say which.
    // Treating it as a hard bounce would promote an ORG-SCOPED preference (an
    // unsubscribe) into a PLATFORM-WIDE address tombstone affecting every other
    // org. Until the cause is disambiguated, the underlying cause event is what
    // carries the suppression; a bare 'blocked' is recorded and ignored here.
    // https://help.brevo.com/hc/en-us/articles/209458705
    case 'softbounce':
    case 'deferred':
      return 'soft_bounce';
    case 'spam':
    case 'complaint':
      return 'complaint';
    case 'unsubscribed':
    case 'unsubscribe':
      return 'unsubscribed';
    default:
      return null;
  }
}

export function normalizeBrevoMessageId(value: string | undefined): string | null {
  const normalized = value?.trim().replace(/^<|>$/g, '').toLowerCase() ?? '';
  return normalized || null;
}

export function verifyBrevoBearerToken(
  authorization: string | undefined,
  configuredToken: string,
): boolean {
  if (configuredToken.trim().length < 32) {
    throw new Error('BREVO_WEBHOOK_TOKEN must be at least 32 characters');
  }
  if (!authorization?.startsWith('Bearer ')) return false;
  const expected = Buffer.from(configuredToken.trim(), 'utf8');
  const received = Buffer.from(authorization.slice('Bearer '.length), 'utf8');
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function deriveBrevoEventId(input: {
  eventType: BrevoHygieneEvent;
  messageId?: string | undefined;
  timestamp?: string | number | undefined;
  webhookId?: string | number | undefined;
  email: string;
  customHeader?: string | undefined;
}): string {
  return createHash('sha256')
    .update([
      input.eventType,
      normalizeBrevoMessageId(input.messageId) ?? '',
      String(input.timestamp ?? ''),
      String(input.webhookId ?? ''),
      hashOutreachEmail(input.email),
      input.customHeader ?? '',
    ].join('|'))
    .digest('hex');
}
