/**
 * Outreach Campaign Scheduler
 *
 * When a recruiter manually fires Campaign Round 1, we auto-schedule:
 *   - Round 2: sent 3 days later
 *   - Round 3: sent 6 days later
 *
 * A cron that runs every hour picks up pending scheduled campaigns whose
 * scheduled_at <= now, filters out already-applied candidates, generates
 * AI drafts, sends via Brevo, and marks the schedule row as sent/cancelled.
 */

import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import { db } from '../db';
import {
  scheduledOutreachCampaigns,
  jobSourcedCandidates,
  sourcedCandidateOutreachCampaigns,
  sourcedCandidateOutreachLog,
  organizations,
  jobs,
  users,
  type JobSourcedCandidate,
} from '@shared/schema';
import { getEmailService } from '../simpleEmailService';
import { generateColdOutreachDraft, isAIEnabled } from '../aiJobAnalyzer';
import { flattenCandidateForUI } from './services/signal-contracts';
import { revalidateCandidateContact } from './contactResolutionProcessor';
import { deliverWithRevalidatedContact } from './contactSendGuard';

const DAYS_BETWEEN_ROUNDS = 3;
const MAX_CAMPAIGN_ROUNDS = 3;
const BASE_URL = (process.env.BASE_URL || 'http://localhost:5000').replace(/\/$/, '');

// ─── helpers (mirrors coldOutreach.routes.ts) ─────────────────────────────────

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"').replace(/\n{3,}/g, '\n\n').trim();
}

function normalizeHtmlBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return '<p></p>';
  if (/<[a-z][\s\S]*>/i.test(trimmed)) return trimmed;
  return trimmed
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br />')}</p>`)
    .join('');
}

function buildOutreachHtml(body: string, publicJobUrl: string, recruiterName: string, recruiterEmail: string, orgName: string): string {
  const normalizedBody = normalizeHtmlBody(body);
  return `
    <div style="background:#f8fafc;padding:24px 0;">
      <div style="max-width:680px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;padding:32px;font-family:Arial,Helvetica,sans-serif;color:#0f172a;line-height:1.65;">
        ${normalizedBody}
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;" />
        <p style="margin:0 0 12px;color:#0f172a;font-size:14px;">
          <strong>${escapeHtml(recruiterName)}</strong><br />${escapeHtml(orgName)}<br />
          <a href="mailto:${escapeHtml(recruiterEmail)}" style="color:#2563eb;text-decoration:none;">${escapeHtml(recruiterEmail)}</a>
        </p>
        <p style="margin:0 0 12px;font-size:14px;">Apply here: <a href="${escapeHtml(publicJobUrl)}" style="color:#2563eb;text-decoration:none;">${escapeHtml(publicJobUrl)}</a></p>
        <p style="margin:0;color:#64748b;font-size:12px;">You are receiving this outreach because your profile was sourced for this role. Reply directly if you are interested.</p>
      </div>
    </div>
  `.trim();
}

function buildOutreachText(body: string, publicJobUrl: string, recruiterName: string, recruiterEmail: string, orgName: string): string {
  return `${stripHtml(normalizeHtmlBody(body))}\n\n--\n${recruiterName}\n${orgName}\nContact: ${recruiterEmail}\nApply here: ${publicJobUrl}\n\nYou are receiving this outreach because your profile was sourced for this role.`;
}

function getCandidateName(candidate: JobSourcedCandidate): string {
  const flattened = flattenCandidateForUI(candidate);
  const summary = candidate.candidateSummary as Record<string, unknown> | null;
  const rawCandidate = summary?.candidate && typeof summary.candidate === 'object'
    ? summary.candidate as Record<string, unknown> : null;
  return (rawCandidate?.name as string | undefined)
    || (candidate.candidateSummary as any)?.nameHint
    || flattened.crustdata?.basic_profile?.name
    || 'Candidate';
}

function buildCandidateDraftContext(candidate: JobSourcedCandidate) {
  const flattened = flattenCandidateForUI(candidate);
  const crust = flattened.crustdata;
  const currentRole = crust?.basic_profile?.current_title
    || crust?.experience?.employment_details?.current?.[0]?.title || null;
  const skills = Array.isArray(crust?.skills?.professional_network_skills)
    ? crust.skills.professional_network_skills.filter((s: unknown): s is string => typeof s === 'string')
    : flattened.cardSignals?.skillsTopN ?? [];
  return {
    name: getCandidateName(candidate),
    headline: crust?.basic_profile?.headline || null,
    summary: flattened.aiSummary?.text || flattened.cardSignals?.summaryShort || null,
    currentRole, skills,
    location: crust?.basic_profile?.location?.full_location || flattened.snapshot?.location || null,
  };
}

function getCampaignRoundMeta(round: number) {
  switch (round) {
    case 2: return {
      label: 'Second campaign',
      aiPrompt: 'Write a second-touch follow-up email. Mention this is an exciting opportunity and add more energy while staying professional.',
    };
    case 3: default: return {
      label: 'Final campaign',
      aiPrompt: 'Write a third and final follow-up email. Mention that the hiring timeline is close, this is the last outreach for the role, and keep it polished and professional.',
    };
  }
}

function getPublicJobUrl(job: { id: number; slug: string | null }): string {
  const identifier = job.slug ? encodeURI(job.slug) : String(job.id);
  return `${BASE_URL}/jobs/${identifier}`;
}

// ─── core send logic ──────────────────────────────────────────────────────────

async function fireScheduledCampaign(scheduled: typeof scheduledOutreachCampaigns.$inferSelect): Promise<void> {
  const { jobId, organizationId, round, triggeredBy, id: scheduledId } = scheduled;
  const campaignRound = round as 1 | 2 | 3;

  const markStatus = async (status: 'sent' | 'cancelled' | 'failed', extra: Partial<typeof scheduledOutreachCampaigns.$inferSelect> = {}) => {
    await db.update(scheduledOutreachCampaigns)
      .set({ status, sentAt: new Date(), ...extra } as any)
      .where(eq(scheduledOutreachCampaigns.id, scheduledId));
  };

  // Fetch job
  const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
  if (!job) { await markStatus('cancelled'); return; }

  // Fetch organization
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, organizationId),
    columns: { id: true, name: true, signalTenantId: true },
  });
  if (!org || !org.signalTenantId) { await markStatus('cancelled'); return; }

  // Fetch recruiter (the one who originally started campaign 1)
  const recruiter = await db.query.users.findFirst({
    where: eq(users.id, triggeredBy),
    columns: { id: true, username: true, firstName: true, lastName: true },
  });
  if (!recruiter) { await markStatus('cancelled'); return; }

  // Fetch eligible candidates: shortlisted, not applied, has resolved email, ready for this round
  const candidates: JobSourcedCandidate[] = await db.query.jobSourcedCandidates.findMany({
    where: and(
      eq(jobSourcedCandidates.organizationId, organizationId),
      eq(jobSourcedCandidates.jobId, jobId),
      eq(jobSourcedCandidates.state, 'shortlisted'),
      eq(jobSourcedCandidates.emailResolveStatus, 'resolved'),
      sql`${jobSourcedCandidates.foundEmail} IS NOT NULL`,
      sql`${jobSourcedCandidates.appliedAt} IS NULL`,
      eq(jobSourcedCandidates.outreachCount, campaignRound - 1),
    ),
  });

  if (candidates.length === 0) {
    console.log(`[OutreachScheduler] No eligible candidates for job ${jobId} round ${round} — cancelling`);
    await markStatus('cancelled');
    return;
  }

  const emailService = await getEmailService();
  if (!emailService || typeof emailService.sendEmail !== 'function') {
    console.error('[OutreachScheduler] Email service unavailable');
    await markStatus('failed');
    return;
  }

  if (!isAIEnabled()) {
    console.error('[OutreachScheduler] AI not enabled, cannot generate drafts');
    await markStatus('failed');
    return;
  }

  const recruiterName = [recruiter.firstName, recruiter.lastName].filter(Boolean).join(' ').trim() || recruiter.username;
  const recruiterEmail = recruiter.username;
  const publicJobUrl = getPublicJobUrl(job);
  const campaignMeta = getCampaignRoundMeta(campaignRound);
  const campaignId = `auto-${jobId}-round${campaignRound}-${Date.now()}`;

  // Create campaign record
  await db.insert(sourcedCandidateOutreachCampaigns).values({
    organizationId,
    jobId,
    campaignId,
    round: campaignRound,
    status: 'sending',
    audienceCount: candidates.length,
    launchedBy: triggeredBy,
    completedAt: null,
  });

  let sent = 0;
  let failed = 0;

  for (const candidate of candidates) {
    let recipientEmail: string | null = null;
    try {
      // Generate AI draft
      const draft = await generateColdOutreachDraft({
        job: {
          title: job.title,
          description: job.description,
          location: job.location,
          salaryMin: job.salaryMin,
          salaryMax: job.salaryMax,
          salaryPeriod: job.salaryPeriod,
          requirements: job.skills ?? [],
          companyName: org.name,
          publicJobUrl,
        },
        recruiter: { name: recruiterName, email: recruiterEmail },
        candidate: buildCandidateDraftContext(candidate),
        campaignRound,
        roundPrompt: campaignMeta.aiPrompt,
      });

      const normalizedBody = normalizeHtmlBody(draft.body);
      const finalHtml = buildOutreachHtml(normalizedBody, publicJobUrl, recruiterName, recruiterEmail, org.name);
      const finalText = buildOutreachText(normalizedBody, publicJobUrl, recruiterName, recruiterEmail, org.name);

      const delivery = await deliverWithRevalidatedContact({
        candidateId: candidate.id,
        organizationId,
        jobId,
        signalTenantId: org.signalTenantId,
        signalCandidateId: candidate.signalCandidateId ?? '',
        externalJobId: `vanta:jobs:${jobId}`,
        attempts: candidate.emailResolveAttempts ?? 0,
      }, {
        revalidate: revalidateCandidateContact,
        deliver: async (email) => {
          recipientEmail = email;
          const sendResult = await emailService.sendEmail({
            to: email,
            subject: draft.subject,
            text: finalText,
            html: finalHtml,
          });
          if (!sendResult) {
            throw new Error('Email delivery failed');
          }
          return sendResult;
        },
      });
      if (delivery.status === 'skipped') {
        failed++;
        continue;
      }

      // Log success
      await db.insert(sourcedCandidateOutreachLog).values({
        organizationId,
        jobId,
        sourcedCandidateId: candidate.id,
        campaignId,
        campaignRound,
        recipientEmail,
        recipientName: getCandidateName(candidate),
        subject: draft.subject,
        body: finalText,
        bodyHtml: finalHtml,
        aiDraftBody: draft.body,
        aiDraftSubject: draft.subject,
        wasEdited: false,
        status: 'sent',
        errorMessage: null,
        sentBy: triggeredBy,
      });

      // Update candidate outreach count
      await db.update(jobSourcedCandidates)
        .set({
          outreachCount: campaignRound,
          lastOutreachRound: campaignRound,
          lastOutreachCampaignId: campaignId,
          lastOutreachAt: new Date(),
          lastOutreachStatus: 'sent',
          updatedAt: new Date(),
        })
        .where(eq(jobSourcedCandidates.id, candidate.id));

      sent++;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[OutreachScheduler] Failed to send to candidate ${candidate.id}:`, errorMessage);

      if (recipientEmail) {
        await db.insert(sourcedCandidateOutreachLog).values({
          organizationId,
          jobId,
          sourcedCandidateId: candidate.id,
          campaignId,
          campaignRound,
          recipientEmail,
          recipientName: getCandidateName(candidate),
          subject: `Auto campaign round ${campaignRound}`,
          body: '',
          bodyHtml: null,
          aiDraftBody: null,
          aiDraftSubject: null,
          wasEdited: false,
          status: 'failed',
          errorMessage,
          sentBy: triggeredBy,
        });
      }

      await db.update(jobSourcedCandidates)
        .set({ lastOutreachAt: new Date(), lastOutreachStatus: 'failed', updatedAt: new Date() })
        .where(eq(jobSourcedCandidates.id, candidate.id));

      failed++;
    }
  }

  // Finalize campaign record
  await db.update(sourcedCandidateOutreachCampaigns)
    .set({
      status: failed > 0 ? (sent > 0 ? 'completed_with_failures' : 'failed') : 'completed',
      sentCount: sent,
      failedCount: failed,
      completedAt: new Date(),
    })
    .where(eq(sourcedCandidateOutreachCampaigns.campaignId, campaignId));

  // Mark scheduled row as sent
  await markStatus('sent', { resultCampaignId: campaignId, sentCount: sent, failedCount: failed } as any);

  console.log(`[OutreachScheduler] Job ${jobId} round ${campaignRound} done — sent: ${sent}, failed: ${failed}`);
}

// ─── cron tick ────────────────────────────────────────────────────────────────

async function runSchedulerTick(): Promise<void> {
  try {
    const due = await db.query.scheduledOutreachCampaigns.findMany({
      where: and(
        eq(scheduledOutreachCampaigns.status, 'pending'),
        lte(scheduledOutreachCampaigns.scheduledAt, new Date()),
      ),
    });

    if (due.length === 0) return;

    console.log(`[OutreachScheduler] ${due.length} scheduled campaign(s) due`);

    for (const scheduled of due) {
      // Mark in-progress immediately to avoid duplicate processing on overlap
      const claimed = await db.update(scheduledOutreachCampaigns)
        .set({ status: 'sending' } as any)
        .where(and(
          eq(scheduledOutreachCampaigns.id, scheduled.id),
          eq(scheduledOutreachCampaigns.status, 'pending'),
        ))
        .returning({ id: scheduledOutreachCampaigns.id });
      if (claimed.length === 0) {
        continue;
      }

      await fireScheduledCampaign(scheduled).catch((err) => {
        console.error(`[OutreachScheduler] Uncaught error for scheduled id ${scheduled.id}:`, err);
      });
    }
  } catch (err) {
    console.error('[OutreachScheduler] Tick error:', err);
  }
}

// ─── public API ───────────────────────────────────────────────────────────────

/**
 * Call this after Campaign Round 1 is successfully sent.
 * Schedules rounds 2 and 3 (or only 3 if round 2 was just sent).
 */
export async function scheduleFollowUpCampaigns(
  jobId: number,
  organizationId: number,
  triggeredBy: number,
  completedRound: number,
): Promise<void> {
  const now = new Date();
  const roundsToSchedule = [2, 3].filter((r) => r > completedRound && r <= MAX_CAMPAIGN_ROUNDS);

  for (const round of roundsToSchedule) {
    const daysOffset = (round - completedRound) * DAYS_BETWEEN_ROUNDS;
    const scheduledAt = new Date(now.getTime() + daysOffset * 24 * 60 * 60 * 1000);

    try {
      await db
        .insert(scheduledOutreachCampaigns)
        .values({ jobId, organizationId, round, scheduledAt, status: 'pending', triggeredBy })
        .onConflictDoNothing(); // UNIQUE (job_id, round) — don't overwrite if already scheduled

      console.log(`[OutreachScheduler] Scheduled round ${round} for job ${jobId} at ${scheduledAt.toISOString()}`);
    } catch (err) {
      console.error(`[OutreachScheduler] Failed to schedule round ${round} for job ${jobId}:`, err);
    }
  }
}

/**
 * Start the background scheduler. Call once on server boot.
 * Checks every hour for due campaigns.
 */
export function startOutreachScheduler(): void {
  console.log('[OutreachScheduler] Started — checking every hour');
  // Run immediately on boot to catch anything missed while server was down
  runSchedulerTick();
  setInterval(runSchedulerTick, 60 * 60 * 1000); // every 1 hour
}
