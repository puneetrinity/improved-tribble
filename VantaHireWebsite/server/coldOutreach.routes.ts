import type { Express, NextFunction, Request, Response } from 'express';
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
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
  outreachOrgSuppressions,
  candidateOutreachSchedules,
  sourcedCandidateOutreachCampaigns,
  sourcedCandidateOutreachLog,
  userAiUsage,
  type SourcedCandidateOutreachCampaign,
  type SourcedCandidateOutreachLog,
  type JobSourcedCandidate,
  type OutreachOrgSuppression,
  type CandidateOutreachSchedule,
} from '@shared/schema';
import { flattenCandidateForUI } from './lib/services/signal-contracts';
import { resolveAccessibleSignalJobContext } from './signal.routes';
import type { CsrfMiddleware } from './types/routes';
import { scheduleCandidateFollowUps } from './lib/outreachScheduler';
import { isJobOpenForOutreach } from './lib/outreachSchedulerCore';
import {
  isOutreachDeliveryUncertainError,
  sendTrackedOutreachEmail,
} from './lib/outreachDelivery';
import { hashOutreachEmail } from './lib/outreachSuppression';
import { revalidateCandidateContact } from './lib/contactResolutionProcessor';

const MAX_OUTREACH_BATCH_SIZE = 50;
const MAX_CAMPAIGN_ROUNDS = 3;
const BASE_URL = (process.env.BASE_URL || 'http://localhost:5000').replace(/\/$/, '');

const draftSchema = z.object({
  candidateIds: z.array(z.number().int().positive()).min(1).max(MAX_OUTREACH_BATCH_SIZE),
  campaignRound: z.number().int().min(1).max(MAX_CAMPAIGN_ROUNDS),
  extraContext: z.string().max(2000).optional(),
});

const sendSchema = z.object({
  campaignId: z.string().min(1).max(255),
  campaignRound: z.number().int().min(1).max(MAX_CAMPAIGN_ROUNDS),
  extraContext: z.string().max(2000).optional(),
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeHtmlBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return '<p></p>';
  if (/<[a-z][\s\S]*>/i.test(trimmed)) {
    return trimmed;
  }

  return trimmed
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br />')}</p>`)
    .join('');
}

function buildOutreachFooter(input: {
  publicJobUrl: string;
  recruiterName: string;
  recruiterEmail: string;
  organizationName: string;
}): { html: string; text: string } {
  return {
    html: `
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;" />
      <p style="margin:0 0 12px;color:#0f172a;font-size:14px;">
        <strong>${escapeHtml(input.recruiterName)}</strong><br />
        ${escapeHtml(input.organizationName)}<br />
        <a href="mailto:${escapeHtml(input.recruiterEmail)}" style="color:#2563eb;text-decoration:none;">${escapeHtml(input.recruiterEmail)}</a>
      </p>
      <p style="margin:0 0 12px;font-size:14px;">
        Apply here:
        <a href="${escapeHtml(input.publicJobUrl)}" style="color:#2563eb;text-decoration:none;">${escapeHtml(input.publicJobUrl)}</a>
      </p>
      <p style="margin:0;color:#64748b;font-size:12px;line-height:1.5;">
        You are receiving this outreach because your profile was sourced for this role.
        Reply directly to this email if you are interested.
      </p>
    `,
    text: [
      '',
      '--',
      input.recruiterName,
      input.organizationName,
      `Contact: ${input.recruiterEmail}`,
      `Apply here: ${input.publicJobUrl}`,
      '',
      'You are receiving this outreach because your profile was sourced for this role.',
      'Reply directly to this email if you are interested.',
    ].join('\n'),
  };
}

function buildCampaignEmailHtml(input: {
  body: string;
  publicJobUrl: string;
  recruiterName: string;
  recruiterEmail: string;
  organizationName: string;
}): string {
  const footer = buildOutreachFooter(input);
  const normalizedBody = normalizeHtmlBody(input.body);
  return `
    <div style="background:#f8fafc;padding:24px 0;">
      <div style="max-width:680px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;padding:32px;font-family:Arial,Helvetica,sans-serif;color:#0f172a;line-height:1.65;">
        ${normalizedBody}
        ${footer.html}
      </div>
    </div>
  `.trim();
}

function buildCampaignEmailText(input: {
  body: string;
  publicJobUrl: string;
  recruiterName: string;
  recruiterEmail: string;
  organizationName: string;
}): string {
  const footer = buildOutreachFooter(input);
  return `${stripHtml(normalizeHtmlBody(input.body))}\n${footer.text}`.trim();
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

function getCampaignRoundMeta(campaignRound: number) {
  switch (campaignRound) {
    case 1:
      return {
        label: 'First campaign',
        summary: 'Introductory outreach with a simple and professional tone.',
        aiPrompt: 'Write a first-touch cold outreach email. Keep it warm, simple, and professional.',
      };
    case 2:
      return {
        label: 'Second campaign',
        summary: 'Follow-up outreach that emphasizes this is an exciting opportunity.',
        aiPrompt: 'Write a second-touch follow-up email. Mention this is an exciting opportunity and add more energy while staying professional.',
      };
    case 3:
    default:
      return {
        label: 'Final campaign',
        summary: 'Final follow-up that mentions the deadline is getting close and this is the last outreach for the role.',
        aiPrompt: 'Write a third and final follow-up email. Mention that the hiring timeline is close, this is the last outreach for the role, and keep it polished and professional.',
      };
  }
}

async function getSuccessfulOutreachCountMap(
  jobId: number,
  organizationId: number,
): Promise<Map<number, number>> {
  const sentLogs: SourcedCandidateOutreachLog[] = await db.query.sourcedCandidateOutreachLog.findMany({
    where: and(
      eq(sourcedCandidateOutreachLog.organizationId, organizationId),
      eq(sourcedCandidateOutreachLog.jobId, jobId),
      eq(sourcedCandidateOutreachLog.status, 'sent'),
    ),
  });

  const roundsByCandidate = new Map<number, Set<number>>();
  for (const log of sentLogs) {
    if (
      !Number.isInteger(log.campaignRound)
      || (log.campaignRound ?? 0) < 1
      || (log.campaignRound ?? 0) > MAX_CAMPAIGN_ROUNDS
    ) {
      continue;
    }
    const rounds = roundsByCandidate.get(log.sourcedCandidateId) ?? new Set<number>();
    rounds.add(log.campaignRound!);
    roundsByCandidate.set(log.sourcedCandidateId, rounds);
  }
  const countMap = new Map<number, number>();
  for (const [candidateId, rounds] of roundsByCandidate) {
    let contiguousRounds = 0;
    while (rounds.has(contiguousRounds + 1)) contiguousRounds += 1;
    countMap.set(candidateId, contiguousRounds);
  }
  return countMap;
}

async function getCampaignState(jobId: number, organizationId: number) {
  const campaigns: SourcedCandidateOutreachCampaign[] = await db.query.sourcedCandidateOutreachCampaigns.findMany({
    where: and(
      eq(sourcedCandidateOutreachCampaigns.organizationId, organizationId),
      eq(sourcedCandidateOutreachCampaigns.jobId, jobId),
    ),
    orderBy: [desc(sourcedCandidateOutreachCampaigns.round), desc(sourcedCandidateOutreachCampaigns.launchedAt)],
  });

  const rawEligibleCandidates: JobSourcedCandidate[] = await db.query.jobSourcedCandidates.findMany({
    where: and(
      eq(jobSourcedCandidates.organizationId, organizationId),
      eq(jobSourcedCandidates.jobId, jobId),
      eq(jobSourcedCandidates.state, 'shortlisted'),
    ),
  });
  const eligibleCandidates = rawEligibleCandidates;
  const suppressionRows: Array<Pick<
    OutreachOrgSuppression,
    'emailHash' | 'signalCandidateId'
  >> = await db.query.outreachOrgSuppressions.findMany({
    where: eq(outreachOrgSuppressions.organizationId, organizationId),
    columns: { emailHash: true, signalCandidateId: true },
  });
  const suppressedEmailHashes = new Set(
    suppressionRows.map((row) => row.emailHash),
  );
  const suppressedCandidateIds = new Set(
    suppressionRows
      .map((row) => row.signalCandidateId)
      .filter((candidateId): candidateId is string => Boolean(candidateId)),
  );

  const sentCountMap = await getSuccessfulOutreachCountMap(jobId, organizationId);
  const effectiveOutreachCount = (candidateId: number, fallbackCount: number | null | undefined) =>
    sentCountMap.get(candidateId) ?? fallbackCount ?? 0;

  const eligibleByRound: Record<1 | 2 | 3, { count: number; candidateIds: number[] }> = {
    1: { count: 0, candidateIds: [] },
    2: { count: 0, candidateIds: [] },
    3: { count: 0, candidateIds: [] },
  };

  await Promise.all(eligibleCandidates.map(async (candidate) => {
    if (
      candidate.emailResolveStatus === 'suppressed'
      || candidate.appliedAt
      || candidate.lastOutreachStatus === 'hard_bounce'
      || candidate.lastOutreachStatus === 'complaint'
      || candidate.lastOutreachStatus === 'unsubscribed'
      || candidate.lastOutreachStatus === 'delivery_uncertain'
      || suppressedCandidateIds.has(candidate.signalCandidateId)
      || (
        candidate.foundEmail
        && suppressedEmailHashes.has(hashOutreachEmail(candidate.foundEmail))
      )
    ) {
      return;
    }
    const effectiveCount = effectiveOutreachCount(candidate.id, candidate.outreachCount);
    if ((candidate.outreachCount ?? 0) < effectiveCount) {
      await db
        .update(jobSourcedCandidates)
        .set({
          outreachCount: effectiveCount,
          updatedAt: new Date(),
        })
        .where(and(
          eq(jobSourcedCandidates.id, candidate.id),
          lt(jobSourcedCandidates.outreachCount, effectiveCount),
        ));
    }

    if (effectiveCount >= 0 && effectiveCount < MAX_CAMPAIGN_ROUNDS) {
      const nextRound = (effectiveCount + 1) as 1 | 2 | 3;
      eligibleByRound[nextRound].candidateIds.push(candidate.id);
      eligibleByRound[nextRound].count += 1;
    }
  }));

  const nextAvailableRound = eligibleByRound[1].count > 0 ? 1 : null;

  return {
    campaigns,
    nextAvailableRound,
    canStartAnyCampaign: nextAvailableRound !== null,
    eligibleByRound,
  };
}

async function getEffectiveOutreachCountMapForCandidates(
  jobId: number,
  organizationId: number,
  candidates: JobSourcedCandidate[],
) {
  const sentCountMap = await getSuccessfulOutreachCountMap(jobId, organizationId);
  return new Map<number, number>(
    candidates.map((candidate) => [candidate.id, sentCountMap.get(candidate.id) ?? candidate.outreachCount ?? 0]),
  );
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

        const { candidateIds, extraContext } = parsed.data;
        const campaignRound = parsed.data.campaignRound as 1 | 2 | 3;
        if (campaignRound !== 1) {
          res.status(400).json({ error: 'Follow-up rounds are sent automatically after 3 days' });
          return;
        }
        const contextResult = await resolveAccessibleSignalJobContext(req.user!, jobId);
        if (!contextResult.ok) {
          res.status(contextResult.error === 'JOB_NOT_FOUND' ? 404 : 403).json({ error: contextResult.error });
          return;
        }

        const { job, organizationId, signalTenantId } = contextResult.context;
        if (!isJobOpenForOutreach(job)) {
          res.status(400).json({ error: 'Outreach is unavailable for a closed job' });
          return;
        }
        if (!signalTenantId) {
          res.status(500).json({ error: 'Signal tenant is not configured' });
          return;
        }
        const campaignState = await getCampaignState(jobId, organizationId);
        if (campaignState.eligibleByRound[campaignRound].count === 0) {
          res.status(400).json({ error: `No shortlisted candidates are ready for campaign round ${campaignRound}` });
          return;
        }

        if (req.user!.role === 'recruiter') {
          const creditCheck = await hasEnoughCredits(req.user!.id, candidateIds.length);
          if (!creditCheck) {
            res.status(403).json(await getAiCreditExhaustionPayload(req.user!.id, candidateIds.length));
            return;
          }
        }

        const rawCandidates: JobSourcedCandidate[] = await db.query.jobSourcedCandidates.findMany({
          where: and(
            eq(jobSourcedCandidates.organizationId, organizationId),
            eq(jobSourcedCandidates.jobId, jobId),
            eq(jobSourcedCandidates.state, 'shortlisted'),
            inArray(jobSourcedCandidates.id, candidateIds),
          ),
        });
        const candidates = rawCandidates;

        if (candidates.length !== candidateIds.length) {
          res.status(400).json({ error: 'Some candidates are invalid or not shortlisted for this job' });
          return;
        }
        const eligibleCandidateIds = new Set(
          campaignState.eligibleByRound[campaignRound].candidateIds,
        );
        if (!candidateIds.every((candidateId) => eligibleCandidateIds.has(candidateId))) {
          res.status(400).json({
            error: `Some candidates are not eligible for campaign round ${campaignRound}`,
          });
          return;
        }

        const effectiveCountMap = await getEffectiveOutreachCountMapForCandidates(jobId, organizationId, candidates);
        // Only block on outreach-count mismatch — email resolution is no longer required
        // at draft time; unresolved candidates will be handled at send time.
        const blockedCandidates = candidates.filter(
          (candidate) =>
            (effectiveCountMap.get(candidate.id) ?? 0) !== campaignRound - 1,
        );
        if (blockedCandidates.length > 0) {
          res.status(400).json({ error: `All selected candidates must be ready for campaign round ${campaignRound}` });
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
        const campaignMeta = getCampaignRoundMeta(campaignRound);
        const drafts: Array<{
          candidateId: number;
          name: string;
          email: string | null;
          subject: string;
          body: string;
        }> = [];
        const draftInputBase = {
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
          recruiter: {
            name: recruiterName,
            email: recruiterEmail,
          },
          campaignRound,
          roundPrompt: campaignMeta.aiPrompt,
        } as const;

        for (const candidate of candidates) {
          const contact = await revalidateCandidateContact({
            candidateId: candidate.id,
            organizationId,
            jobId,
            signalTenantId,
            signalCandidateId: candidate.signalCandidateId ?? '',
            externalJobId: `vanta:jobs:${jobId}`,
            attempts: candidate.emailResolveAttempts ?? 0,
          });
          const startTime = Date.now();
          const draftPayload = {
            ...draftInputBase,
            candidate: buildCandidateDraftContext(candidate),
          } as Parameters<typeof generateColdOutreachDraft>[0];
          if (extraContext) {
            draftPayload.extraContext = extraContext;
          }
          const draft = await generateColdOutreachDraft(draftPayload);

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
              campaignRound,
              durationMs,
            },
          });

          drafts.push({
            candidateId: candidate.id,
            name: getCandidateName(candidate),
            email: contact.persisted && contact.state === 'found'
              ? contact.emails[0] ?? null
              : null,
            subject: draft.subject,
            body: normalizeHtmlBody(draft.body),
          });
        }

        if (req.user!.role === 'recruiter') {
          await useCredits(req.user!.id, candidateIds.length);
        }

        res.json({
          campaignRound,
          campaignLabel: campaignMeta.label,
          campaignSummary: campaignMeta.summary,
          drafts,
        });
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

        const { campaignId, extraContext, messages } = parsed.data;
        const campaignRound = parsed.data.campaignRound as 1 | 2 | 3;
        if (campaignRound !== 1) {
          res.status(400).json({ error: 'Follow-up rounds are sent automatically after 3 days' });
          return;
        }
        const contextResult = await resolveAccessibleSignalJobContext(req.user!, jobId);
        if (!contextResult.ok) {
          res.status(contextResult.error === 'JOB_NOT_FOUND' ? 404 : 403).json({ error: contextResult.error });
          return;
        }

        const { job, organizationId, signalTenantId } = contextResult.context;
        if (!isJobOpenForOutreach(job)) {
          res.status(400).json({ error: 'Outreach is unavailable for a closed job' });
          return;
        }
        if (!signalTenantId) {
          res.status(500).json({ error: 'Signal tenant is not configured' });
          return;
        }
        const campaignState = await getCampaignState(jobId, organizationId);
        if (campaignState.eligibleByRound[campaignRound].count === 0) {
          res.status(400).json({ error: `No shortlisted candidates are ready for campaign round ${campaignRound}` });
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

        const rawCandidates: JobSourcedCandidate[] = await db.query.jobSourcedCandidates.findMany({
          where: and(
            eq(jobSourcedCandidates.organizationId, organizationId),
            eq(jobSourcedCandidates.jobId, jobId),
            eq(jobSourcedCandidates.state, 'shortlisted'),
            inArray(jobSourcedCandidates.id, messages.map((message) => message.candidateId)),
          ),
        });
        const candidates = rawCandidates;

        if (candidates.length !== messages.length) {
          res.status(400).json({ error: 'Some candidates are invalid or not shortlisted for this job' });
          return;
        }
        const eligibleCandidateIds = new Set(
          campaignState.eligibleByRound[campaignRound].candidateIds,
        );
        if (!messages.every((message) => eligibleCandidateIds.has(message.candidateId))) {
          res.status(400).json({
            error: `Some candidates are not eligible for campaign round ${campaignRound}`,
          });
          return;
        }

        const effectiveCountMap = await getEffectiveOutreachCountMapForCandidates(jobId, organizationId, candidates);
        // Only block on outreach-count mismatch — email resolution is handled below.
        const blockedCandidates = candidates.filter(
          (candidate) =>
            (effectiveCountMap.get(candidate.id) ?? 0) !== campaignRound - 1,
        );
        if (blockedCandidates.length > 0) {
          res.status(400).json({ error: `All selected candidates must be ready for campaign round ${campaignRound}` });
          return;
        }

        const candidateMap = new Map(candidates.map((candidate) => [candidate.id, candidate]));
        const recruiterName = recruiterDisplayName(req.user!);
        const recruiterEmail = req.user!.username;
        const publicJobUrl = getPublicJobUrl(job);
        const emailService = await getEmailService();

        if (!emailService || typeof emailService.sendEmailWithReceipt !== 'function') {
          res.status(503).json({ error: 'Email service unavailable' });
          return;
        }

        const persistedCampaignId = campaignId;

        await db.insert(sourcedCandidateOutreachCampaigns).values({
          organizationId,
          jobId,
          campaignId: persistedCampaignId,
          round: campaignRound,
          status: 'sending',
          audienceCount: messages.length,
          subjectTemplate: messages[0]?.subject ?? null,
          htmlBodyTemplate: messages[0]?.body ?? null,
          extraContext: extraContext ?? null,
          launchedBy: req.user!.id,
          completedAt: null,
        });

        const results: Array<{
          candidateId: number;
          email: string;
          status: 'sent' | 'failed' | 'skipped';
          errorMessage: string | null;
        }> = [];
        let sent = 0;
        let failed = 0;
        let skipped = 0;
        const successfullyDeliveredCandidates: Array<{
          sourcedCandidateId: number;
          completedAt: Date;
        }> = [];

        for (const message of messages) {
          const candidate = candidateMap.get(message.candidateId);
          if (!candidate) continue;

          const effectiveCount = effectiveCountMap.get(candidate.id) ?? candidate.outreachCount ?? 0;
          if (effectiveCount !== campaignRound - 1) continue;

          const finalHtml = buildCampaignEmailHtml({
            body: message.body,
            publicJobUrl,
            recruiterName,
            recruiterEmail,
            organizationName: organization.name,
          });
          const finalText = buildCampaignEmailText({
            body: message.body,
            publicJobUrl,
            recruiterName,
            recruiterEmail,
            organizationName: organization.name,
          });

          let status: 'sent' | 'failed' = 'sent';
          let errorMessage: string | null = null;
          let recipientEmail: string | null = null;
          let deliveryCampaignId = persistedCampaignId;
          let deliverySentAt = new Date();
          let replayed = false;

          try {
            const delivery = await sendTrackedOutreachEmail({
              contact: {
                candidateId: candidate.id,
                organizationId,
                jobId,
                signalTenantId,
                signalCandidateId: candidate.signalCandidateId ?? '',
                externalJobId: `vanta:jobs:${jobId}`,
                attempts: candidate.emailResolveAttempts ?? 0,
              },
              emailService,
              organizationId,
              jobId,
              sourcedCandidateId: candidate.id,
              campaignId: persistedCampaignId,
              campaignRound,
              recipientName: getCandidateName(candidate),
              subject: message.subject,
              bodyText: finalText,
              bodyHtml: finalHtml,
              applicationUrl: publicJobUrl,
              aiDraftBody: message.aiDraftBody,
              aiDraftSubject: message.aiDraftSubject,
              wasEdited: message.wasEdited,
              sentBy: req.user!.id,
            });
            if (delivery.status === 'skipped') {
              results.push({
                candidateId: candidate.id,
                email: '',
                status: 'skipped',
                errorMessage: delivery.reason === 'org_suppressed'
                  ? 'Candidate unsubscribed from this organization'
                  : delivery.reason === 'platform_suppressed'
                    ? 'Email is suppressed platform-wide'
                  : delivery.reason === 'candidate_ineligible'
                    ? 'Candidate applied or is no longer shortlisted'
                    : 'Email unavailable or suppressed',
              });
              skipped += 1;
              continue;
            }
            recipientEmail = delivery.email;
            deliveryCampaignId = delivery.campaignId ?? persistedCampaignId;
            deliverySentAt = delivery.sentAt;
            replayed = delivery.replayed;
            successfullyDeliveredCandidates.push({
              sourcedCandidateId: candidate.id,
              completedAt: delivery.sentAt,
            });
            replayed ? skipped += 1 : sent += 1;
          } catch (error) {
            status = 'failed';
            errorMessage = error instanceof Error ? error.message : 'Unknown error';
            failed += 1;
            if (isOutreachDeliveryUncertainError(error)) {
              await db
                .update(jobSourcedCandidates)
                .set({
                  lastOutreachAt: new Date(),
                  lastOutreachStatus: 'delivery_uncertain',
                  updatedAt: new Date(),
                })
                .where(eq(jobSourcedCandidates.id, candidate.id));
              errorMessage = 'Provider outcome is uncertain; automatic retry blocked';
            }
          }

          if (!recipientEmail) {
            results.push({
              candidateId: candidate.id,
              email: '',
              status: 'failed',
              errorMessage: errorMessage ?? 'Contact revalidation failed',
            });
            continue;
          }

          await db
            .update(jobSourcedCandidates)
            .set({
              ...(status === 'sent'
                ? {
                    outreachCount: Math.min(effectiveCount + 1, MAX_CAMPAIGN_ROUNDS),
                    lastOutreachRound: campaignRound,
                    lastOutreachCampaignId: deliveryCampaignId,
                  }
                : {}),
              lastOutreachAt: deliverySentAt,
              lastOutreachStatus: sql<string>`
                CASE
                  WHEN ${jobSourcedCandidates.lastOutreachStatus}
                    IN ('complaint', 'unsubscribed')
                  THEN ${jobSourcedCandidates.lastOutreachStatus}
                  ELSE ${status}
                END
              `,
              updatedAt: new Date(),
            })
            .where(eq(jobSourcedCandidates.id, candidate.id));

          results.push({
            candidateId: candidate.id,
            email: recipientEmail,
            status: replayed ? 'skipped' : status,
            errorMessage: replayed ? 'Round already delivered' : errorMessage,
          });
        }

        const finalStatus = failed > 0 ? (sent > 0 ? 'completed_with_failures' : 'failed') : 'completed';

        await db
          .update(sourcedCandidateOutreachCampaigns)
          .set({
            status: finalStatus,
            sentCount: sent,
            failedCount: failed,
            completedAt: new Date(),
          })
          .where(eq(sourcedCandidateOutreachCampaigns.campaignId, persistedCampaignId));

        // Auto-schedule follow-up rounds after round 1 or 2 completes with at least some sends
        if (successfullyDeliveredCandidates.length > 0 && campaignRound < MAX_CAMPAIGN_ROUNDS) {
          await scheduleCandidateFollowUps(
            successfullyDeliveredCandidates,
            jobId,
            organizationId,
            req.user!.id,
            campaignRound,
          );
        }

        res.json({
          sent,
          failed,
          skipped,
          campaign: {
            campaignId: persistedCampaignId,
            campaignRound,
            audienceCount: messages.length,
          },
          results,
        });
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
        const campaignState = await getCampaignState(jobId, organizationId);
        const logs: SourcedCandidateOutreachLog[] = await db.query.sourcedCandidateOutreachLog.findMany({
          where: and(
            eq(sourcedCandidateOutreachLog.organizationId, organizationId),
            eq(sourcedCandidateOutreachLog.jobId, jobId),
          ),
          orderBy: [desc(sourcedCandidateOutreachLog.sentAt)],
        });
        const convertedCandidates: JobSourcedCandidate[] = await db.query.jobSourcedCandidates.findMany({
          where: and(
            eq(jobSourcedCandidates.organizationId, organizationId),
            eq(jobSourcedCandidates.jobId, jobId),
          ),
        });
        const schedules: CandidateOutreachSchedule[] = await db.query.candidateOutreachSchedules.findMany({
          where: and(
            eq(candidateOutreachSchedules.organizationId, organizationId),
            eq(candidateOutreachSchedules.jobId, jobId),
          ),
        });

        const messagesByCampaign = new Map<string, typeof logs>();
        for (const log of logs) {
          const key = log.campaignId ?? `no-campaign-${log.id}`;
          const existing = messagesByCampaign.get(key) ?? [];
          existing.push(log);
          messagesByCampaign.set(key, existing);
        }
        const appliedByCampaign = new Map<string, number>();
        for (const candidate of convertedCandidates) {
          if (!candidate.appliedFromCampaignId) continue;
          appliedByCampaign.set(
            candidate.appliedFromCampaignId,
            (appliedByCampaign.get(candidate.appliedFromCampaignId) ?? 0) + 1,
          );
        }
        const sentByRound = new Map<number, Set<number>>();
        const contacted = new Set<number>();
        const bounced = new Set<number>();
        const complained = new Set<number>();
        const unsubscribed = new Set<number>();
        for (const log of logs) {
          if (log.status === 'sent') {
            contacted.add(log.sourcedCandidateId);
            if (log.campaignRound) {
              const roundSet = sentByRound.get(log.campaignRound) ?? new Set<number>();
              roundSet.add(log.sourcedCandidateId);
              sentByRound.set(log.campaignRound, roundSet);
            }
          }
          if (log.deliveryStatus === 'hard_bounce' || log.deliveryStatus === 'soft_bounce') {
            bounced.add(log.sourcedCandidateId);
          }
          if (log.deliveryStatus === 'unsubscribed') {
            unsubscribed.add(log.sourcedCandidateId);
          }
          if (log.deliveryStatus === 'complaint') {
            complained.add(log.sourcedCandidateId);
          }
        }
        for (const candidate of convertedCandidates) {
          if (candidate.lastOutreachStatus === 'unsubscribed') {
            unsubscribed.add(candidate.id);
          }
        }
        const shortlistCohort = convertedCandidates.filter((candidate) =>
          candidate.state === 'shortlisted'
          || (candidate.outreachCount ?? 0) > 0
          || candidate.appliedAfterRound !== null,
        );
        const scheduleByCandidate = new Map(
          schedules.map((schedule: CandidateOutreachSchedule) => [schedule.sourcedCandidateId, schedule]),
        );
        const funnel = [
          { stage: 'Shortlisted', count: shortlistCohort.length },
          { stage: 'Contacted', count: contacted.size },
          { stage: 'Round 1', count: sentByRound.get(1)?.size ?? 0 },
          { stage: 'Round 2', count: sentByRound.get(2)?.size ?? 0 },
          { stage: 'Round 3', count: sentByRound.get(3)?.size ?? 0 },
          { stage: 'Bounced', count: bounced.size },
          { stage: 'Complaints', count: complained.size },
          { stage: 'Unsubscribed', count: unsubscribed.size },
          {
            stage: 'Applied',
            count: convertedCandidates.filter((candidate) => Boolean(candidate.appliedAt)).length,
          },
        ];

        res.json({
          nextAvailableRound: campaignState.nextAvailableRound,
          canStartAnyCampaign: campaignState.canStartAnyCampaign,
          eligibleByRound: campaignState.eligibleByRound,
          maxCampaigns: MAX_CAMPAIGN_ROUNDS,
          funnel,
          candidateStates: shortlistCohort.map((candidate) => {
            const schedule = scheduleByCandidate.get(candidate.id);
            return {
              candidateId: candidate.id,
              name: getCandidateName(candidate),
              outreachCount: candidate.outreachCount ?? 0,
              lastRound: candidate.lastOutreachRound,
              lastStatus: candidate.lastOutreachStatus,
              nextRound: schedule?.status === 'pending' ? schedule.nextRound : null,
              nextDueAt: schedule?.status === 'pending'
                ? schedule.dueAt.toISOString()
                : null,
              appliedAt: candidate.appliedAt?.toISOString() ?? null,
            };
          }),
          campaigns: campaignState.campaigns
            .sort((a, b) => b.round - a.round || b.launchedAt.getTime() - a.launchedAt.getTime())
            .map((campaign) => ({
              campaignId: campaign.campaignId,
              campaignRound: campaign.round,
              status: campaign.status,
              launchedAt: campaign.launchedAt.toISOString(),
              completedAt: campaign.completedAt?.toISOString() ?? null,
              audienceCount: campaign.audienceCount,
              sent: campaign.sentCount,
              failed: campaign.failedCount,
              applied: appliedByCampaign.get(campaign.campaignId) ?? 0,
              subjectTemplate: campaign.subjectTemplate,
              messages: (messagesByCampaign.get(campaign.campaignId) ?? []).map((log) => ({
                id: log.id,
                sourcedCandidateId: log.sourcedCandidateId,
                recipientEmail: log.recipientEmail,
                recipientName: log.recipientName,
                subject: log.subject,
                status: log.status as 'sending' | 'sent' | 'failed',
                deliveryStatus: log.deliveryStatus,
                errorMessage: log.errorMessage,
                sentAt: log.sentAt.toISOString(),
              })),
            })),
        });
      } catch (error) {
        next(error);
      }
    },
  );
}
