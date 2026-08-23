/**
 * Outreach Campaign Scheduler
 *
 * Each successfully contacted candidate owns their follow-up clock:
 *   - Round 2: sent 3 days after that candidate's round 1
 *   - Round 3: sent 3 days after that candidate's round 2
 *
 * A cron that runs every hour picks up pending scheduled campaigns whose
 * scheduled_at <= now, filters out already-applied candidates, generates
 * AI drafts, sends via Brevo, and marks the schedule row as sent/cancelled.
 */

import { and, asc, eq, inArray, isNull, lt, lte, notInArray, or, sql } from 'drizzle-orm';
import { db } from '../db';
import {
  candidateOutreachSchedules,
  jobSourcedCandidates,
  sourcedCandidateOutreachCampaigns,
  organizations,
  jobs,
  users,
  type JobSourcedCandidate,
} from '@shared/schema';
import { getEmailService } from '../simpleEmailService';
import { generateColdOutreachDraft, isAIEnabled } from '../aiJobAnalyzer';
import { flattenCandidateForUI } from './services/signal-contracts';
import {
  isOutreachDeliveryUncertainError,
  sendTrackedOutreachEmail,
} from './outreachDelivery';
import { hasBlockingOutreachHygieneIntent } from './outreachConcurrency';
import {
  getSkippedOutreachDisposition,
  getNextCandidateOutreachSchedule,
  isJobOpenForOutreach,
  OUTREACH_MAX_ROUNDS,
} from './outreachSchedulerCore';
import {
  CandidatePrivacyRestrictedError,
  requireCandidatePrivacyAllowed,
} from '../candidate-privacy/decision';

const MAX_CAMPAIGN_ROUNDS = OUTREACH_MAX_ROUNDS;
const MAX_SCHEDULE_ATTEMPTS = 8;
const RETRY_DELAY_MS = 60 * 60 * 1000;
const SENDING_LEASE_MS = 60 * 60 * 1000;
const SCHEDULER_BATCH_SIZE = 50;
const MAX_SENDS_PER_TICK = 200;
const BASE_URL = (process.env.BASE_URL || 'http://localhost:5000').replace(/\/$/, '');
let schedulerTickRunning = false;

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

async function fireScheduledCandidate(
  scheduled: typeof candidateOutreachSchedules.$inferSelect,
): Promise<void> {
  const {
    jobId,
    organizationId,
    nextRound,
    triggeredBy,
    sourcedCandidateId,
    id: scheduledId,
  } = scheduled;
  const campaignRound = nextRound as 2 | 3;

  const cancel = async (reason: string) => {
    await db
      .update(candidateOutreachSchedules)
      .set({ status: 'cancelled', lastError: reason, updatedAt: new Date() })
      .where(and(
        eq(candidateOutreachSchedules.id, scheduledId),
        eq(candidateOutreachSchedules.status, 'sending'),
        eq(candidateOutreachSchedules.nextRound, campaignRound),
      ));
  };
  const retry = async (reason: string, consumeAttempt = true) => {
    const attempts = scheduled.attemptCount + (consumeAttempt ? 1 : 0);
    await db
      .update(candidateOutreachSchedules)
      .set({
        status: consumeAttempt && attempts >= MAX_SCHEDULE_ATTEMPTS
          ? 'cancelled'
          : 'pending',
        dueAt: new Date(Date.now() + RETRY_DELAY_MS),
        attemptCount: attempts,
        lastError: reason,
        updatedAt: new Date(),
      })
      .where(and(
        eq(candidateOutreachSchedules.id, scheduledId),
        eq(candidateOutreachSchedules.status, 'sending'),
        eq(candidateOutreachSchedules.nextRound, campaignRound),
      ));
  };

  const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
  if (!job) { await cancel('job_not_found'); return; }
  if (!isJobOpenForOutreach(job)) {
    await cancel('job_closed');
    return;
  }

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, organizationId),
    columns: { id: true, name: true, signalTenantId: true },
  });
  if (!org || !org.signalTenantId) { await cancel('organization_or_tenant_missing'); return; }

  const recruiter = await db.query.users.findFirst({
    where: eq(users.id, triggeredBy),
    columns: { id: true, username: true, firstName: true, lastName: true },
  });
  if (!recruiter) { await cancel('recruiter_not_found'); return; }

  const candidate: JobSourcedCandidate | undefined = await db.query.jobSourcedCandidates.findFirst({
    where: and(
      eq(jobSourcedCandidates.id, sourcedCandidateId),
      eq(jobSourcedCandidates.organizationId, organizationId),
      eq(jobSourcedCandidates.jobId, jobId),
      eq(jobSourcedCandidates.state, 'shortlisted'),
      eq(jobSourcedCandidates.outreachCount, campaignRound - 1),
    ),
  });
  if (!candidate || candidate.appliedAt) {
    await cancel(candidate?.appliedAt ? 'candidate_applied' : 'candidate_not_eligible');
    return;
  }

  try {
    await requireCandidatePrivacyAllowed(
      { type: 'job_sourced_candidate', id: candidate.id },
      { globalUse: true, newGlobalOperation: true },
    );
  } catch (error) {
    if (error instanceof CandidatePrivacyRestrictedError) {
      await cancel('candidate_privacy_restricted');
      return;
    }
    throw error;
  }

  const emailService = await getEmailService();
  if (!emailService || typeof emailService.sendEmailWithReceipt !== 'function') {
    await retry('email_service_unavailable');
    return;
  }

  try {
    // Scoped to THIS person. A platform-wide question here would let one
    // stuck complaint retry every scheduled campaign indefinitely.
    if (await hasBlockingOutreachHygieneIntent(candidate.signalCandidateId ?? null)) {
      await retry('hygiene_sync_pending', false);
      return;
    }
  } catch {
    // The final locked fence still runs before SMTP, but a failed early fence
    // read is not a reason to spend on a draft or consume the send retry budget.
    await retry('hygiene_fence_check_failed', false);
    return;
  }

  if (!isAIEnabled()) {
    await retry('ai_unavailable');
    return;
  }

  const recruiterName = [recruiter.firstName, recruiter.lastName].filter(Boolean).join(' ').trim() || recruiter.username;
  const recruiterEmail = recruiter.username;
  const publicJobUrl = getPublicJobUrl(job);
  const campaignMeta = getCampaignRoundMeta(campaignRound);
  const campaignId = `auto-${jobId}-${candidate.id}-round${campaignRound}-${Date.now()}`;

  await db.insert(sourcedCandidateOutreachCampaigns).values({
    organizationId,
    jobId,
    campaignId,
    round: campaignRound,
    status: 'sending',
    audienceCount: 1,
    launchedBy: triggeredBy,
    completedAt: null,
  });

  try {
    await requireCandidatePrivacyAllowed(
      { type: 'job_sourced_candidate', id: candidate.id },
      { globalUse: true, newGlobalOperation: true },
    );
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

    await requireCandidatePrivacyAllowed(
      { type: 'job_sourced_candidate', id: candidate.id },
      { globalUse: true, newGlobalOperation: true },
    );
    const delivery = await sendTrackedOutreachEmail({
      contact: {
        candidateId: candidate.id,
        organizationId,
        jobId,
        signalTenantId: org.signalTenantId,
        signalCandidateId: candidate.signalCandidateId ?? '',
        externalJobId: `vanta:jobs:${jobId}`,
        attempts: candidate.emailResolveAttempts ?? 0,
      },
      emailService,
      organizationId,
      jobId,
      sourcedCandidateId: candidate.id,
      campaignId,
      campaignRound,
      recipientName: getCandidateName(candidate),
      subject: draft.subject,
      bodyText: finalText,
      bodyHtml: finalHtml,
      applicationUrl: publicJobUrl,
      aiDraftBody: draft.body,
      aiDraftSubject: draft.subject,
      wasEdited: false,
      sentBy: triggeredBy,
    });
    if (delivery.status === 'skipped') {
      await db.update(sourcedCandidateOutreachCampaigns)
        .set({
          status: 'cancelled',
          failedCount: 1,
          completedAt: new Date(),
        })
        .where(eq(sourcedCandidateOutreachCampaigns.campaignId, campaignId));
      const disposition = getSkippedOutreachDisposition(delivery.reason);
      if (disposition.action === 'cancel') {
        await cancel(disposition.errorCode);
      } else {
        await retry(disposition.errorCode, disposition.consumeAttempt);
      }
      return;
    }

    await db.transaction(async (tx: any) => {
      await tx.update(jobSourcedCandidates)
        .set({
          outreachCount: campaignRound,
          lastOutreachRound: campaignRound,
          lastOutreachCampaignId: delivery.campaignId ?? campaignId,
          lastOutreachAt: delivery.sentAt,
          lastOutreachStatus: sql<string>`
            CASE
              WHEN ${jobSourcedCandidates.lastOutreachStatus}
                IN ('complaint', 'unsubscribed')
              THEN ${jobSourcedCandidates.lastOutreachStatus}
              ELSE 'sent'
            END
          `,
          updatedAt: new Date(),
        })
        .where(eq(jobSourcedCandidates.id, candidate.id));
      await tx.update(sourcedCandidateOutreachCampaigns)
        .set({
          status: 'completed',
          sentCount: delivery.replayed ? 0 : 1,
          failedCount: 0,
          completedAt: new Date(),
        })
        .where(eq(sourcedCandidateOutreachCampaigns.campaignId, campaignId));
      await tx.update(candidateOutreachSchedules)
        .set(campaignRound < MAX_CAMPAIGN_ROUNDS
          ? {
              nextRound: campaignRound + 1,
              dueAt: getNextCandidateOutreachSchedule(
                campaignRound,
                delivery.sentAt,
              )!.dueAt,
              status: 'pending',
              attemptCount: 0,
              lastError: null,
              updatedAt: new Date(),
            }
          : {
              status: 'completed',
              attemptCount: 0,
              lastError: null,
              updatedAt: new Date(),
            })
        .where(and(
          eq(candidateOutreachSchedules.id, scheduledId),
          eq(candidateOutreachSchedules.status, 'sending'),
          eq(candidateOutreachSchedules.nextRound, campaignRound),
        ));
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[OutreachScheduler] Failed candidate ${candidate.id}:`, errorMessage);
    await db.update(sourcedCandidateOutreachCampaigns)
      .set({ status: 'failed', failedCount: 1, completedAt: new Date() })
      .where(eq(sourcedCandidateOutreachCampaigns.campaignId, campaignId));
    const deliveryUncertain = isOutreachDeliveryUncertainError(err);
    await db.update(jobSourcedCandidates)
      .set({
        lastOutreachAt: new Date(),
        lastOutreachStatus: sql<string>`
          CASE
            WHEN ${jobSourcedCandidates.lastOutreachStatus}
              IN ('complaint', 'unsubscribed')
            THEN ${jobSourcedCandidates.lastOutreachStatus}
            ELSE ${deliveryUncertain ? 'delivery_uncertain' : 'failed'}
          END
        `,
        updatedAt: new Date(),
      })
      .where(eq(jobSourcedCandidates.id, candidate.id));
    if (deliveryUncertain) {
      await cancel('delivery_uncertain_operator_review');
    } else {
      await retry(errorMessage);
    }
  }
}

// ─── cron tick ────────────────────────────────────────────────────────────────

export async function repairOutreachStateFromSentLogs(): Promise<void> {
  await db.execute(sql`
    WITH round_state AS (
      SELECT
        sourced_candidate_id,
        CASE
          WHEN BOOL_OR(campaign_round = 1) THEN
            CASE
              WHEN BOOL_OR(campaign_round = 2) THEN
                CASE WHEN BOOL_OR(campaign_round = 3) THEN 3 ELSE 2 END
              ELSE 1
            END
          ELSE 0
        END AS completed_round
      FROM sourced_candidate_outreach_log
      WHERE status = 'sent'
        AND campaign_round BETWEEN 1 AND 3
      GROUP BY sourced_candidate_id
    ),
    latest_completed AS (
      SELECT DISTINCT ON (log.sourced_candidate_id)
        log.sourced_candidate_id,
        log.campaign_id,
        log.campaign_round,
        log.sent_at
      FROM sourced_candidate_outreach_log log
      JOIN round_state state
        ON state.sourced_candidate_id = log.sourced_candidate_id
       AND state.completed_round = log.campaign_round
      WHERE log.status = 'sent'
      ORDER BY log.sourced_candidate_id, log.sent_at DESC, log.id DESC
    )
    UPDATE job_sourced_candidates candidate
    SET
      outreach_count = latest.campaign_round,
      last_outreach_round = latest.campaign_round,
      last_outreach_campaign_id = latest.campaign_id,
      last_outreach_at = latest.sent_at,
      last_outreach_status = CASE
        WHEN candidate.last_outreach_status
          IN ('complaint', 'unsubscribed')
        THEN candidate.last_outreach_status
        ELSE 'sent'
      END,
      updated_at = NOW()
    FROM latest_completed latest
    WHERE candidate.id = latest.sourced_candidate_id
      AND candidate.outreach_count < latest.campaign_round
  `);

  await db.execute(sql`
    WITH aggregates AS (
      SELECT
        campaign_id,
        COUNT(*) AS logged_count,
        COUNT(*) FILTER (WHERE status = 'sent') AS sent_count,
        COUNT(*) FILTER (WHERE status = 'failed') AS failed_count,
        BOOL_OR(status = 'sending') AS has_in_flight
      FROM sourced_candidate_outreach_log
      WHERE campaign_id IS NOT NULL
      GROUP BY campaign_id
    )
    UPDATE sourced_candidate_outreach_campaigns campaign
    SET
      sent_count = aggregates.sent_count,
      failed_count = aggregates.failed_count,
      status = CASE
        WHEN aggregates.failed_count > 0 AND aggregates.sent_count > 0
          THEN 'completed_with_failures'
        WHEN aggregates.failed_count > 0 THEN 'failed'
        ELSE 'completed'
      END,
      completed_at = COALESCE(campaign.completed_at, NOW())
    FROM aggregates
    WHERE campaign.campaign_id = aggregates.campaign_id
      AND campaign.status IN ('sending', 'failed')
      AND aggregates.logged_count >= campaign.audience_count
      AND NOT aggregates.has_in_flight
  `);

  await db.execute(sql`
    WITH round_state AS (
      SELECT
        sourced_candidate_id,
        CASE
          WHEN BOOL_OR(campaign_round = 1) THEN
            CASE
              WHEN BOOL_OR(campaign_round = 2) THEN
                CASE WHEN BOOL_OR(campaign_round = 3) THEN 3 ELSE 2 END
              ELSE 1
            END
          ELSE 0
        END AS completed_round
      FROM sourced_candidate_outreach_log
      WHERE status = 'sent'
        AND campaign_round BETWEEN 1 AND 3
      GROUP BY sourced_candidate_id
    ),
    latest_completed AS (
      SELECT DISTINCT ON (log.sourced_candidate_id)
        log.sourced_candidate_id,
        log.campaign_round,
        log.sent_at
      FROM sourced_candidate_outreach_log log
      JOIN round_state state
        ON state.sourced_candidate_id = log.sourced_candidate_id
       AND state.completed_round = log.campaign_round
      WHERE log.status = 'sent'
      ORDER BY log.sourced_candidate_id, log.sent_at DESC, log.id DESC
    )
    UPDATE candidate_outreach_schedules schedule
    SET
      next_round = CASE
        WHEN latest.campaign_round < 3 THEN latest.campaign_round + 1
        ELSE schedule.next_round
      END,
      due_at = CASE
        WHEN latest.campaign_round < 3
        THEN latest.sent_at + INTERVAL '3 days'
        ELSE schedule.due_at
      END,
      status = CASE
        WHEN latest.campaign_round >= 3 THEN 'completed'
        ELSE 'pending'
      END,
      attempt_count = 0,
      last_error = 'repaired_from_sent_log',
      updated_at = NOW()
    FROM latest_completed latest
    JOIN job_sourced_candidates candidate
      ON candidate.id = latest.sourced_candidate_id
    WHERE schedule.sourced_candidate_id = latest.sourced_candidate_id
      AND schedule.next_round <= latest.campaign_round
      AND schedule.status IN ('pending', 'sending')
      AND candidate.state = 'shortlisted'
      AND candidate.applied_at IS NULL
      AND candidate.last_outreach_status IN ('sent', 'soft_bounce', 'hard_bounce')
  `);

  await db.execute(sql`
    INSERT INTO candidate_outreach_schedules (
      organization_id,
      job_id,
      sourced_candidate_id,
      next_round,
      due_at,
      status,
      triggered_by
    )
    SELECT
      candidate.organization_id,
      candidate.job_id,
      candidate.id,
      candidate.outreach_count + 1,
      candidate.last_outreach_at + INTERVAL '3 days',
      'pending',
      latest_log.sent_by
    FROM job_sourced_candidates candidate
    JOIN LATERAL (
      SELECT log.sent_by
      FROM sourced_candidate_outreach_log log
      WHERE log.sourced_candidate_id = candidate.id
        AND log.status = 'sent'
        AND log.campaign_round = candidate.outreach_count
      ORDER BY log.sent_at DESC, log.id DESC
      LIMIT 1
    ) latest_log ON TRUE
    WHERE candidate.state = 'shortlisted'
      AND candidate.applied_at IS NULL
      AND candidate.outreach_count BETWEEN 1 AND 2
      AND candidate.last_outreach_at IS NOT NULL
      AND candidate.last_outreach_status IN ('sent', 'soft_bounce', 'hard_bounce')
      AND NOT EXISTS (
        SELECT 1
        FROM candidate_outreach_schedules schedule
        WHERE schedule.sourced_candidate_id = candidate.id
      )
    ON CONFLICT (sourced_candidate_id) DO NOTHING
  `);
}

async function runSchedulerTick(): Promise<void> {
  if (schedulerTickRunning) return;
  schedulerTickRunning = true;
  try {
    await repairOutreachStateFromSentLogs();
    await db.update(candidateOutreachSchedules)
      .set({
        status: 'pending',
        dueAt: new Date(),
        lastError: 'recovered_stale_lease',
        updatedAt: new Date(),
      })
      .where(and(
        eq(candidateOutreachSchedules.status, 'sending'),
        lt(candidateOutreachSchedules.updatedAt, new Date(Date.now() - SENDING_LEASE_MS)),
      ));

    let processed = 0;
    while (processed < MAX_SENDS_PER_TICK) {
      const due = await db.query.candidateOutreachSchedules.findMany({
        where: and(
          eq(candidateOutreachSchedules.status, 'pending'),
          lte(candidateOutreachSchedules.dueAt, new Date()),
        ),
        orderBy: [
          asc(candidateOutreachSchedules.dueAt),
          asc(candidateOutreachSchedules.id),
        ],
        limit: Math.min(SCHEDULER_BATCH_SIZE, MAX_SENDS_PER_TICK - processed),
      });

      if (due.length === 0) break;
      console.log(`[OutreachScheduler] ${due.length} candidate follow-up(s) due`);

      for (const scheduled of due) {
        const claimed = await db.update(candidateOutreachSchedules)
          .set({ status: 'sending', updatedAt: new Date() })
          .where(and(
            eq(candidateOutreachSchedules.id, scheduled.id),
            eq(candidateOutreachSchedules.status, 'pending'),
          ))
          .returning({ id: candidateOutreachSchedules.id });
        if (claimed.length === 0) {
          continue;
        }

        processed += 1;
        await fireScheduledCandidate(scheduled).catch((err) => {
          console.error(`[OutreachScheduler] Uncaught error for scheduled id ${scheduled.id}:`, err);
        });
      }
    }
  } catch (err) {
    console.error('[OutreachScheduler] Tick error:', err);
  } finally {
    schedulerTickRunning = false;
  }
}

// ─── public API ───────────────────────────────────────────────────────────────

/**
 * Start each successful candidate's next round clock independently.
 */
export async function scheduleCandidateFollowUps(
  completedDeliveries: Array<{
    sourcedCandidateId: number;
    completedAt: Date;
  }>,
  jobId: number,
  organizationId: number,
  triggeredBy: number,
  completedRound: number,
): Promise<void> {
  if (completedRound >= MAX_CAMPAIGN_ROUNDS || completedDeliveries.length === 0) return;
  const completedAtByCandidate = new Map<number, Date>();
  for (const delivery of completedDeliveries) {
    completedAtByCandidate.set(delivery.sourcedCandidateId, delivery.completedAt);
  }
  const sourcedCandidateIds = [...completedAtByCandidate.keys()];
  const schedulableCandidates = await db.query.jobSourcedCandidates.findMany({
    where: and(
      inArray(jobSourcedCandidates.id, sourcedCandidateIds),
      eq(jobSourcedCandidates.organizationId, organizationId),
      eq(jobSourcedCandidates.jobId, jobId),
      isNull(jobSourcedCandidates.appliedAt),
      or(
        isNull(jobSourcedCandidates.lastOutreachStatus),
        notInArray(jobSourcedCandidates.lastOutreachStatus, [
          'complaint',
          'unsubscribed',
        ]),
      ),
    ),
    columns: { id: true },
  });
  if (schedulableCandidates.length === 0) return;
  const scheduleValues = schedulableCandidates.flatMap(
    ({ id: sourcedCandidateId }: { id: number }) => {
      const completedAt = completedAtByCandidate.get(sourcedCandidateId);
      if (!completedAt) return [];
      const next = getNextCandidateOutreachSchedule(completedRound, completedAt);
      return next
        ? [{
            organizationId,
            jobId,
            sourcedCandidateId,
            nextRound: next.nextRound,
            dueAt: next.dueAt,
            status: 'pending',
            triggeredBy,
          }]
        : [];
    },
  );
  if (scheduleValues.length === 0) return;

  await db
    .insert(candidateOutreachSchedules)
    .values(scheduleValues)
    .onConflictDoNothing({
      target: candidateOutreachSchedules.sourcedCandidateId,
    });

  // Close the race where a bounce, unsubscribe, or application lands between
  // the eligibility read and the schedule upsert.
  const terminalCandidates = await db.query.jobSourcedCandidates.findMany({
    where: and(
      inArray(
        jobSourcedCandidates.id,
        schedulableCandidates.map(({ id }: { id: number }) => id),
      ),
      or(
        inArray(jobSourcedCandidates.lastOutreachStatus, [
          'complaint',
          'unsubscribed',
          'delivery_uncertain',
        ]),
        sql`${jobSourcedCandidates.appliedAt} IS NOT NULL`,
      ),
    ),
    columns: {
      id: true,
      appliedAt: true,
      lastOutreachStatus: true,
    },
  });
  if (terminalCandidates.length > 0) {
    await db
      .update(candidateOutreachSchedules)
      .set({
        status: 'cancelled',
        lastError: 'candidate_became_ineligible',
        updatedAt: new Date(),
      })
      .where(inArray(
        candidateOutreachSchedules.sourcedCandidateId,
        terminalCandidates.map(({ id }: { id: number }) => id),
      ));
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
