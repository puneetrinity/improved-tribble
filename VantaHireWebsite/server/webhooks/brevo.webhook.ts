import type { Express, Request, Response } from 'express';
import { and, eq, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  candidateOutreachSchedules,
  jobSourcedCandidates,
  organizations,
  outreachDeliveryCorrelations,
  outreachHygieneIntents,
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
import {
  lockCandidateOutreach,
  lockOutreachEmailHash,
} from '../lib/outreachConcurrency';
import { wakeOutreachHygieneProcessor } from '../lib/outreachHygieneProcessor';

const WEBHOOK_PROVIDER = 'brevo';
const LEGACY_CORRELATION_COLUMNS = {
  id: true,
  deliveryId: true,
  providerMessageId: true,
  organizationId: true,
  sourcedCandidateId: true,
  recipientEmail: true,
} as const;

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

async function findLegacyOutreachLog(event: BrevoWebhookEvent) {
  const deliveryId = parseBrevoCorrelationHeader(event['X-Mailin-custom']);
  if (deliveryId) {
    const byDelivery = await db.query.sourcedCandidateOutreachLog.findFirst({
      where: eq(sourcedCandidateOutreachLog.deliveryId, deliveryId),
      columns: LEGACY_CORRELATION_COLUMNS,
    });
    if (byDelivery) return byDelivery;
  }

  const messageId = normalizeBrevoMessageId(event['message-id']);
  if (!messageId) return null;
  return db.query.sourcedCandidateOutreachLog.findFirst({
    where: eq(sourcedCandidateOutreachLog.providerMessageId, messageId),
    columns: LEGACY_CORRELATION_COLUMNS,
  });
}

async function findDeliveryCorrelation(event: BrevoWebhookEvent) {
  const deliveryId = parseBrevoCorrelationHeader(event['X-Mailin-custom']);
  if (deliveryId) {
    const byDelivery = await db.query.outreachDeliveryCorrelations.findFirst({
      where: and(
        eq(outreachDeliveryCorrelations.provider, WEBHOOK_PROVIDER),
        eq(outreachDeliveryCorrelations.deliveryId, deliveryId),
      ),
    });
    if (byDelivery) return byDelivery;
  }

  const messageId = normalizeBrevoMessageId(event['message-id']);
  if (messageId) {
    const byMessage = await db.query.outreachDeliveryCorrelations.findFirst({
      where: and(
        eq(outreachDeliveryCorrelations.provider, WEBHOOK_PROVIDER),
        eq(outreachDeliveryCorrelations.providerMessageId, messageId),
      ),
    });
    if (byMessage) return byMessage;
  }

  // Transition guard for a delivery created by the old process after migration
  // backfill but before the new process became active. Materialize its durable
  // hash-only correlation while all lifecycle parents still exist.
  const log = await findLegacyOutreachLog(event);
  if (!log) return null;
  const durableDeliveryId = log.deliveryId?.trim() || `legacy-log:${log.id}`;
  const [candidate, organization] = await Promise.all([
    db.query.jobSourcedCandidates.findFirst({
      where: eq(jobSourcedCandidates.id, log.sourcedCandidateId),
      columns: { signalCandidateId: true },
    }),
    db.query.organizations.findFirst({
      where: eq(organizations.id, log.organizationId),
      columns: { signalTenantId: true },
    }),
  ]);
  if (!candidate?.signalCandidateId?.trim() || !organization?.signalTenantId?.trim()) {
    throw new Error('Outreach delivery is missing durable Memory identity');
  }
  await db.insert(outreachDeliveryCorrelations).values({
    provider: WEBHOOK_PROVIDER,
    deliveryId: durableDeliveryId,
    providerMessageId: normalizeBrevoMessageId(log.providerMessageId ?? undefined),
    organizationId: log.organizationId,
    sourcedCandidateId: log.sourcedCandidateId,
    signalTenantId: organization.signalTenantId,
    signalCandidateId: candidate.signalCandidateId,
    emailHash: hashOutreachEmail(log.recipientEmail),
    sourceOutreachLogId: log.id,
  }).onConflictDoNothing({
    target: [
      outreachDeliveryCorrelations.provider,
      outreachDeliveryCorrelations.deliveryId,
    ],
  });
  return db.query.outreachDeliveryCorrelations.findFirst({
    where: and(
      eq(outreachDeliveryCorrelations.provider, WEBHOOK_PROVIDER),
      eq(outreachDeliveryCorrelations.deliveryId, durableDeliveryId),
    ),
  });
}

export async function processHygieneEvent(
  event: BrevoWebhookEvent,
  eventType: BrevoHygieneEvent,
  eventId: string,
): Promise<'processed' | 'skipped'> {
  const correlation = await findDeliveryCorrelation(event);
  if (!correlation) {
    // A valid Ealana delivery header proves this event belongs to outreach. A
    // missing retained row is a recoverable data-integrity incident, not an
    // ignorable provider event: return 503 so Brevo retries while it is repaired.
    if (parseBrevoCorrelationHeader(event['X-Mailin-custom'])) {
      throw new Error('Outreach delivery correlation is missing');
    }
    return 'skipped';
  }
  if (correlation.emailHash !== hashOutreachEmail(event.email)) {
    throw new Error('Brevo event recipient does not match the correlated delivery');
  }
  const now = new Date(
    typeof event.ts_event === 'number' || /^\d+$/.test(String(event.ts_event ?? ''))
      ? Number(event.ts_event) * 1000
      : Date.now(),
  );

  await db.transaction(async (tx: any) => {
    await lockCandidateOutreach(tx, correlation.sourcedCandidateId);
    await lockOutreachEmailHash(tx, correlation.emailHash);
    const lockedLog = correlation.sourceOutreachLogId == null
      ? null
      : await tx.query.sourcedCandidateOutreachLog.findFirst({
        where: and(
          eq(sourcedCandidateOutreachLog.id, correlation.sourceOutreachLogId),
          eq(sourcedCandidateOutreachLog.deliveryId, correlation.deliveryId),
        ),
        columns: {
          id: true,
          campaignId: true,
          campaignRound: true,
          deliveryId: true,
          deliveryEventAt: true,
          sentAt: true,
        },
      });
    const sourcedCandidate = await tx.query.jobSourcedCandidates.findFirst({
      where: eq(jobSourcedCandidates.id, correlation.sourcedCandidateId),
      columns: { signalCandidateId: true },
    });
    const organization = await tx.query.organizations.findFirst({
      where: eq(organizations.id, correlation.organizationId),
      columns: { id: true },
    });

    // The durable hash-only intent is committed under the same locks checked
    // by every send. Memory synchronization deliberately happens after commit:
    // a slow/down Memory can never hold the send locks, and the local fence
    // remains fail-closed until the processor receives a valid acknowledgement.
    if (
      (eventType === 'hard_bounce' || eventType === 'complaint')
    ) {
      await tx
        .insert(outreachHygieneIntents)
        .values({
          provider: WEBHOOK_PROVIDER,
          providerEventId: eventId,
          organizationId: correlation.organizationId,
          sourcedCandidateId: correlation.sourcedCandidateId,
          signalTenantId: correlation.signalTenantId,
          signalCandidateId: correlation.signalCandidateId,
          sourceOutreachLogId: lockedLog?.id ?? correlation.sourceOutreachLogId,
          emailHash: correlation.emailHash,
          reason: eventType,
          status: 'pending',
          nextAttemptAt: new Date(),
        })
        .onConflictDoNothing({
          target: [
            outreachHygieneIntents.provider,
            outreachHygieneIntents.providerEventId,
          ],
        });
    }
    const observedSentAt = lockedLog?.sentAt ?? now;
    const eventPrecedesRecordedDelivery = Boolean(
      lockedLog?.deliveryEventAt
      && lockedLog.deliveryEventAt.getTime() > now.getTime(),
    );
    if (eventType === 'unsubscribed' && organization) {
      await suppressOrgEmail({
        organizationId: correlation.organizationId,
        emailHash: correlation.emailHash,
        signalCandidateId: correlation.signalCandidateId,
        sourceOutreachLogId: lockedLog?.id ?? null,
        providerEventId: eventId,
      }, tx);
    }
    if (lockedLog) await tx
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
      .where(eq(sourcedCandidateOutreachLog.id, lockedLog.id));
    if (sourcedCandidate && lockedLog) await tx
      .update(jobSourcedCandidates)
      .set({
        outreachCount: sql<number>`
          GREATEST(
            ${jobSourcedCandidates.outreachCount},
            ${lockedLog.campaignRound ?? 0}
          )
        `,
        lastOutreachRound: sql<number | null>`
          CASE
            WHEN ${lockedLog.campaignRound ?? 0}
              >= COALESCE(${jobSourcedCandidates.lastOutreachRound}, 0)
            THEN ${lockedLog.campaignRound}
            ELSE ${jobSourcedCandidates.lastOutreachRound}
          END
        `,
        lastOutreachCampaignId: sql<string | null>`
          CASE
            WHEN ${lockedLog.campaignRound ?? 0}
              >= COALESCE(${jobSourcedCandidates.lastOutreachRound}, 0)
            THEN ${lockedLog.campaignId}
            ELSE ${jobSourcedCandidates.lastOutreachCampaignId}
          END
        `,
        lastOutreachAt: sql<Date | null>`
          CASE
            WHEN ${lockedLog.campaignRound ?? 0}
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
            WHEN ${lockedLog.campaignRound ?? 0}
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
      .where(eq(jobSourcedCandidates.id, correlation.sourcedCandidateId));
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
          .where(eq(candidateOutreachSchedules.sourcedCandidateId, correlation.sourcedCandidateId));
    }
  });
  if (eventType === 'hard_bounce' || eventType === 'complaint') {
    wakeOutreachHygieneProcessor();
  }
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
