import type { Express, Request, Response, NextFunction } from 'express';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from './db';
import { requireRole, requireSeat } from './auth';
import { requireFeatureAccess, FEATURES } from './lib/featureGating';
import { getAiCreditExhaustionPayload, hasEnoughCredits, useCredits } from './lib/creditService';
import { calculateAiCost } from './lib/aiMatchingEngine';
import { aiAnalysisRateLimit } from './rateLimit';
import { getEmailService } from './simpleEmailService';
import { generateColdOutreachDraft, isAIEnabled } from './aiJobAnalyzer';
import {
  jobSourcedCandidates,
  organizations,
  sourcedCandidateOutreachLog,
  userAiUsage,
  type JobSourcedCandidate,
} from '@shared/schema';
import { flattenCandidateForUI } from './lib/services/signal-contracts';
import { resolveAccessibleSignalJobContext } from './signal.routes';
import type { CsrfMiddleware } from './types/routes';

const MAX_OUTREACH_BATCH_SIZE = 50;
const BASE_URL = (process.env.BASE_URL || 'http://localhost:5000').replace(/\/$/, '');

const draftSchema = z.object({
  candidateIds: z.array(z.number().int().positive()).min(1).max(MAX_OUTREACH_BATCH_SIZE),
  tone: z.enum(['friendly', 'formal']).default('friendly'),
  extraContext: z.string().max(2000).optional(),
});

const sendSchema = z.object({
  campaignId: z.string().min(1).max(255),
  messages: z.array(z.object({
    candidateId: z.number().int().positive(),
    subject: z.string().min(1).max(500),
    body: z.string().min(1),
    wasEdited: z.boolean(),
    aiDraftSubject: z.string().min(1).max(500),
    aiDraftBody: z.string().min(1),
  })).min(1).max(MAX_OUTREACH_BATCH_SIZE),
});

function recruiterDisplayName(user: Express.User): string {
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return fullName || user.username;
}

function getPublicJobUrl(job: { id: number; slug: string | null }): string {
  const identifier = job.slug ? encodeURI(job.slug) : String(job.id);
  return `${BASE_URL}/jobs/${identifier}`;
}

function buildColdOutreachFooter(input: {
  body: string;
  publicJobUrl: string;
  recruiterName: string;
  recruiterEmail: string;
  organizationName: string;
}): string {
  return [
    input.body.trim(),
    '--',
    `Apply here: ${input.publicJobUrl}`,
    '',
    input.recruiterName,
    input.organizationName,
    `Contact: ${input.recruiterEmail}`,
    '',
    'You are receiving this because we found your profile while sourcing for the role above.',
    `This is an automated, no-reply message. To get in touch, email ${input.recruiterEmail} directly.`,
  ].join('\n');
}

function getCandidateName(candidate: JobSourcedCandidate): string {
  const flattened = flattenCandidateForUI(candidate);
  const summary = candidate.candidateSummary as Record<string, unknown> | null;
  const rawCandidate = summary?.candidate && typeof summary.candidate === 'object'
    ? summary.candidate as Record<string, unknown>
    : null;
  return (rawCandidate?.name as string | undefined)
    || (candidate.candidateSummary as any)?.nameHint
    || flattened.crustdata?.basic_profile?.name
    || 'Candidate';
}

function buildCandidateDraftContext(candidate: JobSourcedCandidate) {
  const flattened = flattenCandidateForUI(candidate);
  const crust = flattened.crustdata;
  const currentRole = crust?.basic_profile?.current_title
    || crust?.experience?.employment_details?.current?.[0]?.title
    || null;
  const skills = Array.isArray(crust?.skills?.professional_network_skills)
    ? crust.skills.professional_network_skills.filter((skill: unknown): skill is string => typeof skill === 'string')
    : flattened.cardSignals?.skillsTopN ?? [];

  return {
    name: getCandidateName(candidate),
    headline: crust?.basic_profile?.headline || null,
    summary: flattened.aiSummary?.text || flattened.cardSignals?.summaryShort || null,
    currentRole,
    skills,
    location: crust?.basic_profile?.location?.full_location || flattened.snapshot?.location || null,
  };
}

export function registerColdOutreachRoutes(app: Express, csrfProtection: CsrfMiddleware): void {
  app.post(
    '/api/jobs/:id/cold-outreach/draft',
    aiAnalysisRateLimit,
    csrfProtection,
    requireRole(['recruiter', 'super_admin']),
    requireSeat(),
    requireFeatureAccess(FEATURES.AI_CONTENT),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        if (!isAIEnabled()) {
          res.status(503).json({ error: 'AI features are not enabled. Please configure GROQ_API_KEY.' });
          return;
        }

        const jobId = parseInt(req.params.id || '', 10);
        if (isNaN(jobId)) {
          res.status(400).json({ error: 'Invalid job ID' });
          return;
        }

        const parsed = draftSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
          return;
        }

        const { candidateIds, tone, extraContext } = parsed.data;
        const contextResult = await resolveAccessibleSignalJobContext(req.user!, jobId);
        if (!contextResult.ok) {
          res.status(contextResult.error === 'JOB_NOT_FOUND' ? 404 : 403).json({ error: contextResult.error });
          return;
        }

        const { job, organizationId } = contextResult.context;

        if (req.user!.role === 'recruiter') {
          const creditCheck = await hasEnoughCredits(req.user!.id, candidateIds.length);
          if (!creditCheck) {
            res.status(403).json(await getAiCreditExhaustionPayload(req.user!.id, candidateIds.length));
            return;
          }
        }

        const candidates = await db.query.jobSourcedCandidates.findMany({
          where: and(
            eq(jobSourcedCandidates.organizationId, organizationId),
            eq(jobSourcedCandidates.jobId, jobId),
            eq(jobSourcedCandidates.state, 'shortlisted'),
            inArray(jobSourcedCandidates.id, candidateIds),
          ),
        });

        if (candidates.length !== candidateIds.length) {
          res.status(400).json({ error: 'Some candidates are invalid or not shortlisted for this job' });
          return;
        }

        const candidatesMissingResolvedEmail = candidates.filter(
          (candidate) => candidate.emailResolveStatus !== 'resolved' || !candidate.foundEmail,
        );
        if (candidatesMissingResolvedEmail.length > 0) {
          res.status(400).json({ error: 'All selected candidates must have a resolved email before drafting outreach' });
          return;
        }

        const organization = await db.query.organizations.findFirst({
          where: eq(organizations.id, organizationId),
          columns: { id: true, name: true },
        });

        if (!organization) {
          res.status(404).json({ error: 'Organization not found' });
          return;
        }

        const recruiterName = recruiterDisplayName(req.user!);
        const recruiterEmail = req.user!.username;
        const publicJobUrl = getPublicJobUrl(job);
        const drafts = [];

        for (const candidate of candidates) {
          const startTime = Date.now();
          const draft = await generateColdOutreachDraft({
            job: {
              title: job.title,
              description: job.description,
              location: job.location,
              salaryMin: job.salaryMin,
              salaryMax: job.salaryMax,
              salaryPeriod: job.salaryPeriod,
              requirements: job.skills ?? [],
              companyName: organization.name,
              publicJobUrl,
            },
            candidate: buildCandidateDraftContext(candidate),
            recruiter: {
              name: recruiterName,
              email: recruiterEmail,
            },
            tone,
            extraContext,
          });

          const durationMs = Date.now() - startTime;
          await db.insert(userAiUsage).values({
            userId: req.user!.id,
            organizationId,
            kind: 'cold_outreach_draft',
            tokensIn: draft.tokensUsed.input,
            tokensOut: draft.tokensUsed.output,
            costUsd: calculateAiCost(draft.tokensUsed.input, draft.tokensUsed.output),
            metadata: {
              candidateId: candidate.id,
              jobId,
              tone,
              durationMs,
            },
          });

          drafts.push({
            candidateId: candidate.id,
            name: getCandidateName(candidate),
            email: candidate.foundEmail,
            subject: draft.subject,
            body: draft.body,
          });
        }

        if (req.user!.role === 'recruiter') {
          await useCredits(req.user!.id, candidateIds.length);
        }

        res.json(drafts);
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    '/api/jobs/:id/cold-outreach/send',
    csrfProtection,
    requireRole(['recruiter', 'super_admin']),
    requireSeat(),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const jobId = parseInt(req.params.id || '', 10);
        if (isNaN(jobId)) {
          res.status(400).json({ error: 'Invalid job ID' });
          return;
        }

        const parsed = sendSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: 'Validation error', details: parsed.error.flatten() });
          return;
        }

        const { campaignId, messages } = parsed.data;
        const contextResult = await resolveAccessibleSignalJobContext(req.user!, jobId);
        if (!contextResult.ok) {
          res.status(contextResult.error === 'JOB_NOT_FOUND' ? 404 : 403).json({ error: contextResult.error });
          return;
        }

        const { job, organizationId } = contextResult.context;
        const organization = await db.query.organizations.findFirst({
          where: eq(organizations.id, organizationId),
          columns: { id: true, name: true },
        });

        if (!organization) {
          res.status(404).json({ error: 'Organization not found' });
          return;
        }

        const candidates = await db.query.jobSourcedCandidates.findMany({
          where: and(
            eq(jobSourcedCandidates.organizationId, organizationId),
            eq(jobSourcedCandidates.jobId, jobId),
            eq(jobSourcedCandidates.state, 'shortlisted'),
            inArray(jobSourcedCandidates.id, messages.map((message) => message.candidateId)),
          ),
        });

        if (candidates.length !== messages.length) {
          res.status(400).json({ error: 'Some candidates are invalid or not shortlisted for this job' });
          return;
        }

        const candidateMap = new Map(candidates.map((candidate) => [candidate.id, candidate]));
        const recruiterName = recruiterDisplayName(req.user!);
        const recruiterEmail = req.user!.username;
        const publicJobUrl = getPublicJobUrl(job);
        const emailService = await getEmailService();
        const results = [];
        let sent = 0;
        let failed = 0;

        for (const message of messages) {
          const candidate = candidateMap.get(message.candidateId);
          if (!candidate || candidate.emailResolveStatus !== 'resolved' || !candidate.foundEmail) {
            res.status(400).json({ error: `Candidate ${message.candidateId} does not have a resolved email` });
            return;
          }

          const finalBody = buildColdOutreachFooter({
            body: message.body,
            publicJobUrl,
            recruiterName,
            recruiterEmail,
            organizationName: organization.name,
          });

          let status: 'sent' | 'failed' = 'sent';
          let errorMessage: string | null = null;

          try {
            if (!emailService || typeof emailService.sendEmail !== 'function') {
              throw new Error('Email service unavailable');
            }

            const sendResult = await emailService.sendEmail({
              to: candidate.foundEmail,
              subject: message.subject,
              text: finalBody,
            });

            if (!sendResult) {
              throw new Error('Email delivery failed');
            }
            sent += 1;
          } catch (error) {
            status = 'failed';
            errorMessage = error instanceof Error ? error.message : 'Unknown error';
            failed += 1;
          }

          await db.insert(sourcedCandidateOutreachLog).values({
            organizationId,
            jobId,
            sourcedCandidateId: candidate.id,
            campaignId,
            recipientEmail: candidate.foundEmail,
            recipientName: getCandidateName(candidate),
            subject: message.subject,
            body: finalBody,
            aiDraftBody: message.aiDraftBody,
            aiDraftSubject: message.aiDraftSubject,
            wasEdited: message.wasEdited,
            status,
            errorMessage,
            sentBy: req.user!.id,
          });

          await db
            .update(jobSourcedCandidates)
            .set({
              lastOutreachAt: new Date(),
              lastOutreachStatus: status,
              updatedAt: new Date(),
            })
            .where(eq(jobSourcedCandidates.id, candidate.id));

          results.push({
            candidateId: candidate.id,
            email: candidate.foundEmail,
            status,
            errorMessage,
          });
        }

        res.json({ sent, failed, results });
      } catch (error) {
        next(error);
      }
    },
  );

  app.get(
    '/api/jobs/:id/cold-outreach/history',
    requireRole(['recruiter', 'super_admin']),
    requireSeat(),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const jobId = parseInt(req.params.id || '', 10);
        if (isNaN(jobId)) {
          res.status(400).json({ error: 'Invalid job ID' });
          return;
        }

        const contextResult = await resolveAccessibleSignalJobContext(req.user!, jobId);
        if (!contextResult.ok) {
          res.status(contextResult.error === 'JOB_NOT_FOUND' ? 404 : 403).json({ error: contextResult.error });
          return;
        }

        const { organizationId } = contextResult.context;
        const logs = await db.query.sourcedCandidateOutreachLog.findMany({
          where: and(
            eq(sourcedCandidateOutreachLog.organizationId, organizationId),
            eq(sourcedCandidateOutreachLog.jobId, jobId),
          ),
          orderBy: [desc(sourcedCandidateOutreachLog.sentAt)],
        });

        const campaigns = logs.reduce<Array<{
          campaignId: string | null;
          sentAt: Date;
          sent: number;
          failed: number;
          messages: typeof logs;
        }>>((acc, log) => {
          const existing = acc.find((campaign) => campaign.campaignId === log.campaignId);
          if (existing) {
            existing.messages.push(log);
            if (log.status === 'sent') existing.sent += 1;
            else existing.failed += 1;
            return acc;
          }

          acc.push({
            campaignId: log.campaignId,
            sentAt: log.sentAt,
            sent: log.status === 'sent' ? 1 : 0,
            failed: log.status === 'failed' ? 1 : 0,
            messages: [log],
          });
          return acc;
        }, []);

        res.json({ campaigns });
      } catch (error) {
        next(error);
      }
    },
  );
}
