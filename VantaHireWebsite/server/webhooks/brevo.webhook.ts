import type { Express, Request, Response } from 'express';
import { and, eq, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  candidateOutreachSchedules,
  jobSourcedCandidates,
  organizations,
  sourcedCandidateOutreachLog,
  webhookEvents,
} from '@shared/schema';
import { db } from '../db';
import { parseBrevoCorrelationHeader } from '../lib/outreachEmail';
import {
  suppressOrgEmail,
} from '../lib/outreachSuppression';
import {
  hashOutreachEmail,
  normalizeOutreachEmail,
} from '../lib/outreachComplianceCore';
import {
  BREVO_WEBHOOK_PROCESSING_LEASE_MS,
  deriveBrevoEventId,
  isPersonTerminalHygieneEvent,
  normalizeBrevoHygieneEventType,
  normalizeBrevoMessageId,
  verifyBrevoBearerToken,
  type BrevoHygieneEvent,
} from '../lib/brevoWebhookCore';
import { suppressContactEvidence } from '../lib/services/activekg-client';
import {
  lockCandidateOutreach,
  lockOutreachEmailHash,
} from '../lib/outreachConcurrency';

const WEBHOOK_PROVIDER = 'brevo';

const webhookEventSchema = z.object({
  event: z.string().min(1),
  email: z.string().email(),
  id: z.union([z.string(), z.number()]).optional(),
  ts_event: z.union([z.string(), z.number()]).optional(),
  'message-id': z.string().optional(),
  'X-Mailin-custom': z.string().optional(),
}).passthrough();

type BrevoWebhookEvent = z.infer<typeof webhookEventSchema>;
function verifyWebhookAuthorization(req: Request): boolean {
  const configured = process.env.BREVO_WEBHOOK_TOKEN?.trim() ?? '';
  return verifyBrevoBearerToken(req.headers.authorization, configured);
}

function deriveEventId(event: BrevoWebhookEvent, eventType: BrevoHygieneEvent): string {
  return deriveBrevoEventId({
    eventType,
    messageId: event['message-id'],
    timestamp: event.ts_event,
    webhookId: event.id,
    email: event.email,
    customHeader: event['X-Mailin-custom'],
  });
}

async function claimEvent(
  eventId: string,
  eventType: BrevoHygieneEvent,
): Promise<'claimed' | 'duplicate' | 'in_progress'> {
  const inserted = await db
    .insert(webhookEvents)
    .values({
      provider: WEBHOOK_PROVIDER,
      eventId,
      eventType,
      payload: {},
      processedAt: new Date(),
      status: 'processing',
    })
    .onConflictDoNothing({
      target: [webhookEvents.provider, webhookEvents.eventId],
    })
    .returning({ id: webhookEvents.id });
  if (inserted.length > 0) return 'claimed';

  const reclaimed = await db
    .update(webhookEvents)
    .set({
      status: 'processing',
      errorMessage: null,
      processedAt: new Date(),
    })
    .where(and(
      eq(webhookEvents.provider, WEBHOOK_PROVIDER),
      eq(webhookEvents.eventId, eventId),
      or(
        eq(webhookEvents.status, 'failed'),
        and(
          eq(webhookEvents.status, 'processing'),
          lt(
            webhookEvents.processedAt,
            new Date(Date.now() - BREVO_WEBHOOK_PROCESSING_LEASE_MS),
          ),
        ),
      ),
    ))
    .returning({ id: webhookEvents.id });
  if (reclaimed.length > 0) return 'claimed';

  const existing = await db.query.webhookEvents.findFirst({
    where: and(
      eq(webhookEvents.provider, WEBHOOK_PROVIDER),
      eq(webhookEvents.eventId, eventId),
    ),
    columns: { status: true },
  });
  return existing?.status === 'processing' ? 'in_progress' : 'duplicate';
}

async function finalizeEvent(
  eventId: string,
  status: 'processed' | 'skipped' | 'failed',
  errorMessage: string | null = null,
): Promise<void> {
  await db
    .update(webhookEvents)
    .set({ status, errorMessage, processedAt: new Date() })
    .where(and(
      eq(webhookEvents.provider, WEBHOOK_PROVIDER),
      eq(webhookEvents.eventId, eventId),
    ));
}

async function findOutreachLog(event: BrevoWebhookEvent) {
  const deliveryId = parseBrevoCorrelationHeader(event['X-Mailin-custom']);
  if (deliveryId) {
    const byDelivery = await db.query.sourcedCandidateOutreachLog.findFirst({
      where: eq(sourcedCandidateOutreachLog.deliveryId, deliveryId),
    });
    if (byDelivery) return byDelivery;
  }

  const messageId = normalizeBrevoMessageId(event['message-id']);
  if (!messageId) return null;
  return db.query.sourcedCandidateOutreachLog.findFirst({
    where: eq(sourcedCandidateOutreachLog.providerMessageId, messageId),
  });
}

async function processHygieneEvent(
  event: BrevoWebhookEvent,
  eventType: BrevoHygieneEvent,
  eventId: string,
): Promise<'processed' | 'skipped'> {
  const log = await findOutreachLog(event);
  if (!log) return 'skipped';
  if (hashOutreachEmail(log.recipientEmail) !== hashOutreachEmail(event.email)) {
    throw new Error('Brevo event recipient does not match the correlated delivery');
  }
  const sourcedCandidate = await db.query.jobSourcedCandidates.findFirst({
    where: eq(jobSourcedCandidates.id, log.sourcedCandidateId),
    columns: { signalCandidateId: true },
  });
  if (!sourcedCandidate) {
    throw new Error('Brevo event candidate no longer exists');
  }

  const now = new Date(
    typeof event.ts_event === 'number' || /^\d+$/.test(String(event.ts_event ?? ''))
      ? Number(event.ts_event) * 1000
      : Date.now(),
  );

  const organization = eventType === 'hard_bounce' || eventType === 'complaint'
    ? await db.query.organizations.findFirst({
      where: eq(organizations.id, log.organizationId),
      columns: { signalTenantId: true },
    })
    : null;
  if (
    (eventType === 'hard_bounce' || eventType === 'complaint')
    && !organization?.signalTenantId
  ) {
    throw new Error('Outreach organization has no Memory tenant');
  }

  // Platform-wide suppression is an EXTERNAL HTTP call. It runs BEFORE the
  // transaction opens: inside it, a slow or down Memory would pin both advisory
  // locks and a pooled connection for the life of the request. Suppressing first
  // is also the fail-safe order — if the local transaction then fails, Brevo
  // redelivers and the (provider-event-idempotent) suppress simply repeats.
  //
  // Any failure here FAILS THE EVENT so Brevo retries. A hard bounce or
  // complaint is platform-wide, so it is never downgraded to a local record:
  // Memory records the hash-keyed tombstone even when it holds no evidence for
  // the address, which is what makes the stop signal apply to every org.
  if (
    (eventType === 'hard_bounce' || eventType === 'complaint')
    && organization?.signalTenantId
  ) {
    await suppressContactEvidence(
      organization.signalTenantId,
      {
        email: normalizeOutreachEmail(event.email),
        reason: eventType,
        // Required by Memory whenever the calling tenant owns no evidence for
        // the address; always present here, and idempotent across redeliveries.
        providerEventId: eventId,
      },
      `brevo:${eventId}`,
    );
  }

  await db.transaction(async (tx: any) => {
    await lockCandidateOutreach(tx, log.sourcedCandidateId);
    await lockOutreachEmailHash(tx, hashOutreachEmail(event.email));
    const lockedLog = await tx.query.sourcedCandidateOutreachLog.findFirst({
      where: eq(sourcedCandidateOutreachLog.id, log.id),
    });
    if (!lockedLog) {
      throw new Error('Brevo event delivery disappeared while processing');
    }
    const observedSentAt = lockedLog.sentAt ?? now;
    const eventPrecedesRecordedDelivery = Boolean(
      lockedLog.deliveryEventAt
      && lockedLog.deliveryEventAt.getTime() > now.getTime(),
    );
    if (eventType === 'unsubscribed') {
      await suppressOrgEmail({
        organizationId: log.organizationId,
        emailHash: hashOutreachEmail(event.email),
        signalCandidateId: sourcedCandidate.signalCandidateId,
        sourceOutreachLogId: log.id,
        providerEventId: eventId,
      }, tx);
    }
    await tx
      .update(sourcedCandidateOutreachLog)
      .set({
        status: sql<string>`
          CASE
            WHEN ${sourcedCandidateOutreachLog.status} = 'sending' THEN 'sent'
            ELSE ${sourcedCandidateOutreachLog.status}
          END
        `,
        sentAt: sql<Date>`
          COALESCE(${sourcedCandidateOutreachLog.sentAt}, ${observedSentAt})
        `,
        deliveryStatus: sql<string>`
          CASE
            WHEN ${eventType} IN ('complaint', 'unsubscribed')
            THEN ${eventType}
            WHEN ${sourcedCandidateOutreachLog.deliveryStatus}
              IN ('complaint', 'unsubscribed')
            THEN ${sourcedCandidateOutreachLog.deliveryStatus}
            WHEN ${eventType} = 'hard_bounce'
            THEN 'hard_bounce'
            WHEN ${sourcedCandidateOutreachLog.deliveryStatus} = 'hard_bounce'
              AND ${eventType} = 'soft_bounce'
            THEN 'hard_bounce'
            WHEN ${sourcedCandidateOutreachLog.deliveryEventAt} IS NOT NULL
              AND ${sourcedCandidateOutreachLog.deliveryEventAt} > ${now}
            THEN ${sourcedCandidateOutreachLog.deliveryStatus}
            ELSE ${eventType}
          END
        `,
        deliveryEventAt: sql<Date>`
          CASE
            WHEN ${sourcedCandidateOutreachLog.deliveryEventAt} IS NOT NULL
              AND ${sourcedCandidateOutreachLog.deliveryEventAt} > ${now}
            THEN ${sourcedCandidateOutreachLog.deliveryEventAt}
            ELSE ${now}
          END
        `,
      })
      .where(eq(sourcedCandidateOutreachLog.id, log.id));
    await tx
      .update(jobSourcedCandidates)
      .set({
        outreachCount: sql<number>`
          GREATEST(
            ${jobSourcedCandidates.outreachCount},
            ${log.campaignRound ?? 0}
          )
        `,
        lastOutreachRound: sql<number | null>`
          CASE
            WHEN ${log.campaignRound ?? 0}
              >= COALESCE(${jobSourcedCandidates.lastOutreachRound}, 0)
            THEN ${log.campaignRound}
            ELSE ${jobSourcedCandidates.lastOutreachRound}
          END
        `,
        lastOutreachCampaignId: sql<string | null>`
          CASE
            WHEN ${log.campaignRound ?? 0}
              >= COALESCE(${jobSourcedCandidates.lastOutreachRound}, 0)
            THEN ${log.campaignId}
            ELSE ${jobSourcedCandidates.lastOutreachCampaignId}
          END
        `,
        lastOutreachAt: sql<Date | null>`
          CASE
            WHEN ${log.campaignRound ?? 0}
              >= COALESCE(${jobSourcedCandidates.lastOutreachRound}, 0)
            THEN ${observedSentAt}
            ELSE ${jobSourcedCandidates.lastOutreachAt}
          END
        `,
        lastOutreachStatus: sql<string>`
          CASE
            WHEN ${eventType} IN ('complaint', 'unsubscribed')
            THEN ${eventType}
            WHEN ${jobSourcedCandidates.lastOutreachStatus}
              IN ('complaint', 'unsubscribed')
            THEN ${jobSourcedCandidates.lastOutreachStatus}
            WHEN ${log.campaignRound ?? 0}
              < COALESCE(${jobSourcedCandidates.lastOutreachRound}, 0)
            THEN ${jobSourcedCandidates.lastOutreachStatus}
            WHEN ${eventType} = 'hard_bounce'
            THEN 'hard_bounce'
            WHEN ${jobSourcedCandidates.lastOutreachStatus} = 'hard_bounce'
              AND ${eventType} = 'soft_bounce'
            THEN 'hard_bounce'
            WHEN ${eventPrecedesRecordedDelivery}
            THEN ${jobSourcedCandidates.lastOutreachStatus}
            ELSE ${eventType}
          END
        `,
        updatedAt: new Date(),
      })
      .where(eq(jobSourcedCandidates.id, log.sourcedCandidateId));
    // Deliberately NOT cancelled on hard_bounce. Schedules are keyed per
    // candidate and carry no address, so cancelling here would end outreach to a
    // person who may still have another validated address — which the locked
    // policy forbids (hard bounce is address-terminal, not person-terminal).
    // The next round instead skips at the send guard, which cancels the schedule
    // then; the cost is one no-op scheduler pass, and it self-terminates.
    if (isPersonTerminalHygieneEvent(eventType)) {
      await tx
        .update(candidateOutreachSchedules)
        .set({
          status: 'cancelled',
          lastError: eventType,
          updatedAt: new Date(),
        })
        .where(eq(candidateOutreachSchedules.sourcedCandidateId, log.sourcedCandidateId));
    }
  });
  return 'processed';
}

export function registerBrevoWebhook(app: Express): void {
  app.post('/api/webhooks/brevo/events', async (req: Request, res: Response) => {
    try {
      if (!verifyWebhookAuthorization(req)) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
    } catch (error) {
      console.error('[BrevoWebhook] Configuration error:', (error as Error).message);
      res.status(503).json({ error: 'Webhook unavailable' });
      return;
    }

    const rawEvents = Array.isArray(req.body) ? req.body : [req.body];
    const events = z.array(webhookEventSchema).safeParse(rawEvents);
    if (!events.success) {
      res.status(400).json({ error: 'Invalid webhook event' });
      return;
    }

    let processed = 0;
    let skipped = 0;
    for (const event of events.data) {
      const eventType = normalizeBrevoHygieneEventType(event.event);
      if (!eventType) {
        skipped += 1;
        continue;
      }
      const eventId = deriveEventId(event, eventType);
      const claim = await claimEvent(eventId, eventType);
      if (claim === 'in_progress') {
        res.status(503).json({ error: 'Webhook event is still processing' });
        return;
      }
      if (claim === 'duplicate') {
        skipped += 1;
        continue;
      }
      try {
        const result = await processHygieneEvent(event, eventType, eventId);
        await finalizeEvent(eventId, result);
        result === 'processed' ? processed += 1 : skipped += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Webhook processing failed';
        await finalizeEvent(eventId, 'failed', message);
        console.error('[BrevoWebhook] Hygiene event failed:', {
          eventId,
          eventType,
          error: message,
        });
        res.status(503).json({ error: 'Webhook processing failed' });
        return;
      }
    }

    res.status(200).json({ processed, skipped });
  });
}
