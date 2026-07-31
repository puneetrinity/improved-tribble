import type { Express, Request, Response } from 'express';
import { and, desc, eq } from 'drizzle-orm';

import {
  candidateOutreachSchedules,
  jobSourcedCandidates,
  sourcedCandidateOutreachLog,
} from '@shared/schema';
import { db } from './db';
import {
  suppressOrgEmail,
  verifyOutreachUnsubscribeToken,
} from './lib/outreachSuppression';
import {
  lockCandidateOutreach,
  lockOutreachEmailHash,
} from './lib/outreachConcurrency';

const CONFIRMATION_PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Outreach stopped | ealana</title>
  </head>
  <body style="margin:0;background:#f8fafc;color:#0f172a;font-family:Arial,Helvetica,sans-serif;">
    <main style="max-width:560px;margin:15vh auto;padding:32px;">
      <h1 style="font-size:24px;margin:0 0 12px;">Outreach stopped</h1>
      <p style="font-size:16px;line-height:1.6;margin:0;">
        This hiring team will not send you more outreach through ealana.
      </p>
    </main>
  </body>
</html>`;

function buildConfirmationPrompt(token: string): string {
  const action = `/api/outreach/unsubscribe?token=${encodeURIComponent(token)}`;
  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <title>Stop outreach | ealana</title>
    </head>
    <body style="margin:0;background:#f8fafc;color:#0f172a;font-family:Arial,Helvetica,sans-serif;">
      <main style="max-width:560px;margin:15vh auto;padding:32px;">
        <h1 style="font-size:24px;margin:0 0 12px;">Stop outreach from this hiring team?</h1>
        <p style="font-size:16px;line-height:1.6;margin:0 0 24px;">
          Confirm to stop future outreach from this team through ealana.
        </p>
        <form method="post" action="${action}">
          <button type="submit" style="border:0;background:#0f172a;color:#fff;padding:12px 18px;font-size:15px;cursor:pointer;">
            Stop outreach
          </button>
        </form>
      </main>
    </body>
  </html>`;
}

function readClaims(token: string) {
  try {
    return verifyOutreachUnsubscribeToken(token);
  } catch {
    return null;
  }
}

export function registerOutreachComplianceRoutes(app: Express): void {
  app.get('/api/outreach/unsubscribe', async (req: Request, res: Response) => {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    const claims = readClaims(token);
    if (!claims) {
      res.status(400).type('text/plain').send('This unsubscribe link is invalid.');
      return;
    }

    const candidate = await db.query.jobSourcedCandidates.findFirst({
      where: and(
        eq(jobSourcedCandidates.id, claims.sourcedCandidateId),
        eq(jobSourcedCandidates.organizationId, claims.organizationId),
      ),
      columns: { id: true, signalCandidateId: true },
    });
    if (!candidate) {
      res.status(400).type('text/plain').send('This unsubscribe link is invalid.');
      return;
    }

    res.status(200).type('html').send(buildConfirmationPrompt(token));
  });

  app.post('/api/outreach/unsubscribe', async (req: Request, res: Response) => {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    const claims = readClaims(token);
    if (!claims) {
      res.status(400).type('text/plain').send('This unsubscribe link is invalid.');
      return;
    }

    const candidate = await db.query.jobSourcedCandidates.findFirst({
      where: and(
        eq(jobSourcedCandidates.id, claims.sourcedCandidateId),
        eq(jobSourcedCandidates.organizationId, claims.organizationId),
      ),
      columns: { id: true, signalCandidateId: true },
    });
    if (!candidate) {
      res.status(400).type('text/plain').send('This unsubscribe link is invalid.');
      return;
    }

    const log = await db.query.sourcedCandidateOutreachLog.findFirst({
      where: and(
        eq(sourcedCandidateOutreachLog.organizationId, claims.organizationId),
        eq(sourcedCandidateOutreachLog.sourcedCandidateId, claims.sourcedCandidateId),
        eq(sourcedCandidateOutreachLog.campaignId, claims.campaignId),
        eq(sourcedCandidateOutreachLog.campaignRound, claims.campaignRound),
        eq(sourcedCandidateOutreachLog.status, 'sent'),
      ),
      columns: { id: true },
      orderBy: [desc(sourcedCandidateOutreachLog.sentAt)],
    });

    await db.transaction(async (tx: any) => {
      await lockCandidateOutreach(tx, claims.sourcedCandidateId);
      await lockOutreachEmailHash(tx, claims.emailHash);
      await suppressOrgEmail({
        organizationId: claims.organizationId,
        emailHash: claims.emailHash,
        signalCandidateId: candidate.signalCandidateId,
        sourceOutreachLogId: log?.id ?? null,
      }, tx);
      if (log) {
        await tx
          .update(sourcedCandidateOutreachLog)
          .set({
            deliveryStatus: 'unsubscribed',
            deliveryEventAt: new Date(),
          })
          .where(eq(sourcedCandidateOutreachLog.id, log.id));
      }
      await tx
        .update(jobSourcedCandidates)
        .set({
          lastOutreachStatus: 'unsubscribed',
          updatedAt: new Date(),
        })
        .where(eq(jobSourcedCandidates.id, claims.sourcedCandidateId));
      await tx
        .update(candidateOutreachSchedules)
        .set({
          status: 'cancelled',
          lastError: 'org_unsubscribed',
          updatedAt: new Date(),
        })
        .where(eq(candidateOutreachSchedules.sourcedCandidateId, claims.sourcedCandidateId));
    });

    res.status(200).type('html').send(CONFIRMATION_PAGE);
  });
}
