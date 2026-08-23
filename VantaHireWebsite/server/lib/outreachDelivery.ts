import { randomUUID } from 'node:crypto';
import { and, eq, or, sql } from 'drizzle-orm';

import {
  jobs,
  jobSourcedCandidates,
  outreachDeliveryCorrelations,
  outreachOrgSuppressions,
  sourcedCandidateOutreachLog,
} from '@shared/schema';
import { db } from '../db';
import type { EmailService } from '../simpleEmailService';
import type { ContactRevalidationInput } from './contactResolutionCore';
import { deliverWithRevalidatedContact } from './contactSendGuard';
import { revalidateCandidateContact } from './contactResolutionProcessor';
import {
  appendOutreachComplianceFooter,
  buildBrevoCorrelationHeader,
  buildOutreachApplicationUrl,
  buildOutreachDeliveryKey,
  buildOutreachUnsubscribeUrl,
} from './outreachEmail';
import { isJobOpenForOutreach } from './outreachSchedulerCore';
import {
  hashOutreachEmail,
  isOrgContactSuppressed,
} from './outreachSuppression';
import { withOutreachDispatchFence } from './outreachConcurrency';
import {
  CandidatePrivacyRestrictedError,
  requireCandidatePrivacyAllowed,
} from '../candidate-privacy/decision';

const OUTREACH_DELIVERY_UNCERTAIN = 'OUTREACH_DELIVERY_UNCERTAIN';

function normalizeProviderMessageId(value: string | null): string | null {
  const normalized = value?.trim().replace(/^<|>$/g, '').toLowerCase() ?? '';
  return normalized || null;
}

async function ensureDeliveryCorrelation(input: {
  deliveryId: string;
  providerMessageId: string | null;
  organizationId: number;
  sourcedCandidateId: number;
  signalTenantId: string;
  signalCandidateId: string;
  emailHash: string;
  sourceOutreachLogId: number;
}): Promise<void> {
  if (!input.signalTenantId.trim() || !input.signalCandidateId.trim()) {
    throw new Error('Outreach delivery is missing its durable Memory identity');
  }
  await db.insert(outreachDeliveryCorrelations).values({
    provider: 'brevo',
    ...input,
  }).onConflictDoNothing({
    target: [
      outreachDeliveryCorrelations.provider,
      outreachDeliveryCorrelations.deliveryId,
    ],
  });
  const existing = await db.query.outreachDeliveryCorrelations.findFirst({
    where: and(
      eq(outreachDeliveryCorrelations.provider, 'brevo'),
      eq(outreachDeliveryCorrelations.deliveryId, input.deliveryId),
    ),
  });
  if (
    !existing
    || existing.organizationId !== input.organizationId
    || existing.sourcedCandidateId !== input.sourcedCandidateId
    || existing.signalTenantId !== input.signalTenantId
    || existing.signalCandidateId !== input.signalCandidateId
    || existing.emailHash !== input.emailHash
  ) {
    throw new Error('Outreach delivery correlation identity mismatch');
  }
}

export class OutreachDeliveryUncertainError extends Error {
  readonly code = OUTREACH_DELIVERY_UNCERTAIN;

  constructor() {
    super('A prior delivery attempt has an uncertain provider outcome');
    this.name = 'OutreachDeliveryUncertainError';
  }
}

export function isOutreachDeliveryUncertainError(
  error: unknown,
): error is OutreachDeliveryUncertainError {
  return (
    error instanceof OutreachDeliveryUncertainError
    || (
      typeof error === 'object'
      && error !== null
      && 'code' in error
      && error.code === OUTREACH_DELIVERY_UNCERTAIN
    )
  );
}

export type OutreachDeliveryResult =
  | {
      status: 'sent';
      email: string;
      outreachLogId: number;
      providerMessageId: string | null;
      campaignId: string | null;
      sentAt: Date;
      replayed: boolean;
    }
  | {
      status: 'skipped';
      reason:
        | 'contact_unavailable'
        | 'hygiene_sync_pending'
        | 'org_suppressed'
        | 'platform_suppressed'
        | 'candidate_ineligible';
    };

export async function sendTrackedOutreachEmail(input: {
  contact: ContactRevalidationInput;
  emailService: EmailService;
  organizationId: number;
  jobId: number;
  sourcedCandidateId: number;
  campaignId: string;
  campaignRound: 1 | 2 | 3;
  recipientName: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  applicationUrl: string;
  aiDraftBody: string | null;
  aiDraftSubject: string | null;
  wasEdited: boolean;
  sentBy: number;
}): Promise<OutreachDeliveryResult> {
  try {
    await requireCandidatePrivacyAllowed(
      { type: 'job_sourced_candidate', id: input.sourcedCandidateId },
      { globalUse: true, newGlobalOperation: true },
    );
  } catch (error) {
    if (error instanceof CandidatePrivacyRestrictedError) {
      return { status: 'skipped', reason: 'candidate_ineligible' };
    }
    throw error;
  }
  const delivery = await deliverWithRevalidatedContact(input.contact, {
    revalidate: revalidateCandidateContact,
    isSuppressed: (email) => isOrgContactSuppressed(
      input.organizationId,
      email,
      input.contact.signalCandidateId,
    ),
    deliver: async (email) => {
      const fenced = await withOutreachDispatchFence(
        input.jobId,
        input.sourcedCandidateId,
        hashOutreachEmail(email),
        input.contact.signalCandidateId ?? null,
        async () => {
        try {
          await requireCandidatePrivacyAllowed(
            { type: 'job_sourced_candidate', id: input.sourcedCandidateId },
            { globalUse: true, newGlobalOperation: true },
          );
        } catch (error) {
          if (error instanceof CandidatePrivacyRestrictedError) {
            return {
              candidateIneligible: true as const,
              orgSuppressed: false as const,
              platformSuppressed: false as const,
              contactUnavailable: false as const,
            };
          }
          throw error;
        }
        const currentContact = await revalidateCandidateContact(input.contact);
        const currentEmail = currentContact.persisted && currentContact.state === 'found'
          ? currentContact.emails[0] ?? null
          : null;
        if (!currentEmail) {
          return {
            candidateIneligible: false as const,
            orgSuppressed: false as const,
            platformSuppressed: currentContact.state === 'suppressed',
            contactUnavailable: currentContact.state !== 'suppressed',
          };
        }
        if (hashOutreachEmail(currentEmail) !== hashOutreachEmail(email)) {
          return {
            candidateIneligible: false as const,
            orgSuppressed: false as const,
            platformSuppressed: false as const,
            contactUnavailable: true as const,
          };
        }

        const targetJob = await db.query.jobs.findFirst({
          where: eq(jobs.id, input.jobId),
        });
        const eligible = await db.query.jobSourcedCandidates.findFirst({
          where: and(
            eq(jobSourcedCandidates.id, input.sourcedCandidateId),
            eq(jobSourcedCandidates.organizationId, input.organizationId),
            eq(jobSourcedCandidates.jobId, input.jobId),
            eq(jobSourcedCandidates.state, 'shortlisted'),
            sql`${jobSourcedCandidates.appliedAt} IS NULL`,
          ),
          columns: { id: true, lastOutreachStatus: true },
        });
        if (
          !eligible
          || !targetJob
          || !isJobOpenForOutreach(targetJob)
          || eligible.lastOutreachStatus === 'complaint'
          || eligible.lastOutreachStatus === 'unsubscribed'
          || eligible.lastOutreachStatus === 'delivery_uncertain'
        ) {
          return {
            candidateIneligible: true as const,
            orgSuppressed: false as const,
            platformSuppressed: false as const,
            contactUnavailable: false as const,
          };
        }

        const orgSuppression = await db.query.outreachOrgSuppressions.findFirst({
          where: and(
            eq(outreachOrgSuppressions.organizationId, input.organizationId),
            input.contact.signalCandidateId
              ? or(
                  eq(outreachOrgSuppressions.emailHash, hashOutreachEmail(email)),
                  eq(
                    outreachOrgSuppressions.signalCandidateId,
                    input.contact.signalCandidateId,
                  ),
                )
              : eq(outreachOrgSuppressions.emailHash, hashOutreachEmail(email)),
          ),
          columns: { id: true },
        });
        if (orgSuppression) {
          return {
            candidateIneligible: false as const,
            orgSuppressed: true as const,
            platformSuppressed: false as const,
            contactUnavailable: false as const,
          };
        }

        const deliveryId = randomUUID();
        const unsubscribeUrl = buildOutreachUnsubscribeUrl({
          organizationId: input.organizationId,
          sourcedCandidateId: input.sourcedCandidateId,
          campaignId: input.campaignId,
          campaignRound: input.campaignRound,
          email,
        });
        const applicationUrl = buildOutreachApplicationUrl({
          publicJobUrl: input.applicationUrl,
          organizationId: input.organizationId,
          jobId: input.jobId,
          sourcedCandidateId: input.sourcedCandidateId,
          campaignId: input.campaignId,
          campaignRound: input.campaignRound,
        });
        const content = appendOutreachComplianceFooter(
          input.bodyHtml.replaceAll(input.applicationUrl, applicationUrl),
          input.bodyText.replaceAll(input.applicationUrl, applicationUrl),
          unsubscribeUrl,
        );
        const deliveryKey = buildOutreachDeliveryKey(
          input.sourcedCandidateId,
          input.campaignRound,
        );
        const insertValues = {
          organizationId: input.organizationId,
          jobId: input.jobId,
          sourcedCandidateId: input.sourcedCandidateId,
          campaignId: input.campaignId,
          campaignRound: input.campaignRound,
          recipientEmail: email,
          recipientName: input.recipientName,
          subject: input.subject,
          body: content.text,
          bodyHtml: content.html,
          aiDraftBody: input.aiDraftBody,
          aiDraftSubject: input.aiDraftSubject,
          wasEdited: input.wasEdited,
          status: 'sending',
          deliveryKey,
          deliveryId,
          deliveryStatus: 'sending',
          errorMessage: null,
          sentBy: input.sentBy,
        };
        let [log] = await db
          .insert(sourcedCandidateOutreachLog)
          .values(insertValues)
          .onConflictDoNothing({
            target: sourcedCandidateOutreachLog.deliveryKey,
          })
          .returning({
            id: sourcedCandidateOutreachLog.id,
            recipientEmail: sourcedCandidateOutreachLog.recipientEmail,
            status: sourcedCandidateOutreachLog.status,
            deliveryId: sourcedCandidateOutreachLog.deliveryId,
            providerMessageId: sourcedCandidateOutreachLog.providerMessageId,
            campaignId: sourcedCandidateOutreachLog.campaignId,
            sentAt: sourcedCandidateOutreachLog.sentAt,
          });

        if (!log) {
          const existing = await db.query.sourcedCandidateOutreachLog.findFirst({
            where: eq(sourcedCandidateOutreachLog.deliveryKey, deliveryKey),
            columns: {
              id: true,
              recipientEmail: true,
              status: true,
              deliveryId: true,
              providerMessageId: true,
              campaignId: true,
              sentAt: true,
            },
          });
          if (!existing) {
            throw new Error('Outreach delivery log was not created');
          }
          if (existing.status === 'sent') {
            return {
              candidateIneligible: false as const,
              orgSuppressed: false as const,
              platformSuppressed: false as const,
              contactUnavailable: false as const,
              outreachLogId: existing.id,
              providerMessageId: existing.providerMessageId,
              recipientEmail: existing.recipientEmail,
              campaignId: existing.campaignId,
              sentAt: existing.sentAt,
              replayed: true,
            };
          }
          if (existing.status === 'sending') {
            throw new OutreachDeliveryUncertainError();
          }

          [log] = await db
            .update(sourcedCandidateOutreachLog)
            .set({
              ...insertValues,
              // A definitively failed provider attempt gets a fresh correlation.
              // Reusing the old id would make a later callback ambiguous when a
              // retry selected a different validated address.
              deliveryId,
            })
            .where(and(
              eq(sourcedCandidateOutreachLog.id, existing.id),
              eq(sourcedCandidateOutreachLog.status, 'failed'),
            ))
            .returning({
              id: sourcedCandidateOutreachLog.id,
              recipientEmail: sourcedCandidateOutreachLog.recipientEmail,
              status: sourcedCandidateOutreachLog.status,
              deliveryId: sourcedCandidateOutreachLog.deliveryId,
              providerMessageId: sourcedCandidateOutreachLog.providerMessageId,
              campaignId: sourcedCandidateOutreachLog.campaignId,
              sentAt: sourcedCandidateOutreachLog.sentAt,
            });
          if (!log) {
            throw new OutreachDeliveryUncertainError();
          }
        }

        if (!log.deliveryId) {
          throw new Error('Outreach delivery correlation was not created');
        }

        await ensureDeliveryCorrelation({
          deliveryId: log.deliveryId,
          providerMessageId: log.providerMessageId,
          organizationId: input.organizationId,
          sourcedCandidateId: input.sourcedCandidateId,
          signalTenantId: input.contact.signalTenantId,
          signalCandidateId: input.contact.signalCandidateId,
          emailHash: hashOutreachEmail(email),
          sourceOutreachLogId: log.id,
        });

        let receipt;
        try {
          await requireCandidatePrivacyAllowed(
            { type: 'job_sourced_candidate', id: input.sourcedCandidateId },
            { globalUse: true, newGlobalOperation: true },
          );
          receipt = await input.emailService.sendEmailWithReceipt({
            to: email,
            subject: input.subject,
            text: content.text,
            html: content.html,
            headers: {
              'X-Mailin-custom': buildBrevoCorrelationHeader(log.deliveryId),
            },
          });
        } catch {
          await db
            .update(sourcedCandidateOutreachLog)
            .set({
              deliveryStatus: 'uncertain',
              errorMessage: 'Provider outcome is uncertain; automatic retry blocked',
            })
            .where(eq(sourcedCandidateOutreachLog.id, log.id));
          throw new OutreachDeliveryUncertainError();
        }
        if (!receipt.sent) {
          if (receipt.uncertain) {
            await db
              .update(sourcedCandidateOutreachLog)
              .set({
                deliveryStatus: 'uncertain',
                errorMessage: 'Provider outcome is uncertain; automatic retry blocked',
              })
              .where(eq(sourcedCandidateOutreachLog.id, log.id));
            throw new OutreachDeliveryUncertainError();
          }
          await db
            .update(sourcedCandidateOutreachLog)
            .set({
              status: 'failed',
              deliveryStatus: 'failed',
              errorMessage: 'Email delivery failed',
            })
            .where(eq(sourcedCandidateOutreachLog.id, log.id));
          throw new Error('Email delivery failed');
        }

        const providerMessageId = normalizeProviderMessageId(receipt.messageId);
        const sentAt = new Date();
        await db
          .update(outreachDeliveryCorrelations)
          .set({ providerMessageId, updatedAt: sentAt })
          .where(and(
            eq(outreachDeliveryCorrelations.provider, 'brevo'),
            eq(outreachDeliveryCorrelations.deliveryId, log.deliveryId),
          ));
        await db
          .update(sourcedCandidateOutreachLog)
          .set({
            status: 'sent',
            deliveryStatus: sql<string>`
              CASE
                WHEN ${sourcedCandidateOutreachLog.deliveryStatus}
                  IN ('hard_bounce', 'complaint', 'unsubscribed')
                THEN ${sourcedCandidateOutreachLog.deliveryStatus}
                ELSE 'accepted'
              END
            `,
            providerMessageId,
            sentAt,
            errorMessage: null,
          })
          .where(eq(sourcedCandidateOutreachLog.id, log.id));
        return {
          candidateIneligible: false as const,
          orgSuppressed: false as const,
          platformSuppressed: false as const,
          contactUnavailable: false as const,
          outreachLogId: log.id,
          providerMessageId,
          recipientEmail: log.recipientEmail,
          campaignId: input.campaignId,
          sentAt,
          replayed: false,
        };
        },
      );
      if (fenced.status === 'blocked') {
        return {
          candidateIneligible: false as const,
          orgSuppressed: false as const,
          platformSuppressed: fenced.reason === 'hard_bounce',
          contactUnavailable: false as const,
          hygieneSyncPending: fenced.reason === 'hygiene_sync_pending',
        };
      }
      return fenced.value;
    },
  });

  if (delivery.status === 'skipped') {
    return { status: 'skipped', reason: delivery.skipReason };
  }
  if (delivery.value.candidateIneligible) {
    return { status: 'skipped', reason: 'candidate_ineligible' };
  }
  if (
    'hygieneSyncPending' in delivery.value
    && delivery.value.hygieneSyncPending
  ) {
    return { status: 'skipped', reason: 'hygiene_sync_pending' };
  }
  if (delivery.value.platformSuppressed) {
    return { status: 'skipped', reason: 'platform_suppressed' };
  }
  if (delivery.value.contactUnavailable) {
    return { status: 'skipped', reason: 'contact_unavailable' };
  }
  if (delivery.value.orgSuppressed) {
    return { status: 'skipped', reason: 'org_suppressed' };
  }
  if (!('outreachLogId' in delivery.value)) {
    return { status: 'skipped', reason: 'contact_unavailable' };
  }
  return {
    status: 'sent',
    email: delivery.value.recipientEmail,
    outreachLogId: delivery.value.outreachLogId,
    providerMessageId: delivery.value.providerMessageId,
    campaignId: delivery.value.campaignId,
    sentAt: delivery.value.sentAt,
    replayed: delivery.value.replayed === true,
  };
}
