import { and, eq, or, sql } from 'drizzle-orm';

import { outreachOrgSuppressions } from '@shared/schema';
import { db } from '../db';
import { hashOutreachEmail } from './outreachComplianceCore';

/**
 * This table is ORG-SCOPED and holds unsubscribes only. Hard bounce and
 * complaint are platform-wide obligations recorded in Memory's hash-keyed
 * tombstone table; writing them here instead would narrow a platform-wide stop
 * signal to a single org.
 */

export {
  createOutreachUnsubscribeToken,
  hashOutreachEmail,
  normalizeOutreachEmail,
  verifyOutreachUnsubscribeToken,
} from './outreachComplianceCore';

export async function isOrgEmailSuppressed(
  organizationId: number,
  email: string,
): Promise<boolean> {
  return isOrgContactSuppressed(organizationId, email);
}

export async function isOrgContactSuppressed(
  organizationId: number,
  email: string,
  signalCandidateId?: string | null,
): Promise<boolean> {
  const row = await db.query.outreachOrgSuppressions.findFirst({
    where: and(
      eq(outreachOrgSuppressions.organizationId, organizationId),
      signalCandidateId
        ? or(
            eq(outreachOrgSuppressions.emailHash, hashOutreachEmail(email)),
            eq(outreachOrgSuppressions.signalCandidateId, signalCandidateId),
          )
        : eq(outreachOrgSuppressions.emailHash, hashOutreachEmail(email)),
    ),
    columns: { id: true },
  });
  return Boolean(row);
}

export async function suppressOrgEmail(input: {
  organizationId: number;
  emailHash: string;
  signalCandidateId?: string | null;
  sourceOutreachLogId?: number | null;
  providerEventId?: string | null;
}, executor: any = db): Promise<void> {
  await executor
    .insert(outreachOrgSuppressions)
    .values({
      organizationId: input.organizationId,
      emailHash: input.emailHash,
      signalCandidateId: input.signalCandidateId ?? null,
      reason: 'unsubscribe',
      sourceOutreachLogId: input.sourceOutreachLogId ?? null,
      providerEventId: input.providerEventId ?? null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        outreachOrgSuppressions.organizationId,
        outreachOrgSuppressions.emailHash,
      ],
      // An upsert must never WEAKEN an existing suppression: a later write that
      // carries no candidate id must not clear a person binding already recorded.
      set: {
        signalCandidateId: input.signalCandidateId
          ? input.signalCandidateId
          : sql<string | null>`${outreachOrgSuppressions.signalCandidateId}`,
        sourceOutreachLogId: input.sourceOutreachLogId
          ? input.sourceOutreachLogId
          : sql<number | null>`${outreachOrgSuppressions.sourceOutreachLogId}`,
        providerEventId: input.providerEventId
          ? input.providerEventId
          : sql<string | null>`${outreachOrgSuppressions.providerEventId}`,
        updatedAt: new Date(),
      },
    });
}
