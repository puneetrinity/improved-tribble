import { db } from "../db";
import {
  jobs,
  applications,
  organizationCreditBalances,
  organizationMembers,
  userAiUsage,
  users,
  pipelineStages,
  applicationStageHistory,
} from "@shared/schema";
import { eq, and, sql, count, desc, gte, isNotNull } from "drizzle-orm";
import { getOrganizationSubscription } from "./subscriptionService";
import { privacyAllowedSql } from "../candidate-privacy/decision";

const applicationPrivacyAllowed = (qualifiedId = "applications.id") => sql.raw(
  privacyAllowedSql('application', qualifiedId, { globalUse: false }),
);

// ===== Overview Stats =====

export interface OrgAnalyticsOverview {
  totalApplications: number;
  totalHires: number;
  conversionRate: number;
  avgTimeToFill: number | null;

  // Jobs
  totalJobs: number;
  activeJobs: number;
  jobsThisMonth: number;

  // Applications
  applicationsThisMonth: number;
  avgApplicationsPerJob: number;

  // Team
  totalMembers: number;
  seatsUsed: number;
  seatsTotal: number;

  // AI Credits
  creditsUsed: number;
  creditsAllocated: number;
  creditsRemaining: number;

  // Subscription
  planName: string;
  planDisplayName: string;
  billingCycle: string | null;
  renewalDate: Date | null;
}

export async function getOrgAnalyticsOverview(orgId: number): Promise<OrgAnalyticsOverview> {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  // Jobs stats
  const [jobStats] = await db
    .select({
      total: count(),
      active: sql<number>`COUNT(*) FILTER (WHERE ${jobs.isActive} = true)`,
      thisMonth: sql<number>`COUNT(*) FILTER (WHERE ${jobs.createdAt} >= ${startOfMonth})`,
    })
    .from(jobs)
    .where(eq(jobs.organizationId, orgId));

  // Applications stats
  const [appStats] = await db
    .select({
      total: count(),
      thisMonth: sql<number>`COUNT(*) FILTER (WHERE ${applications.appliedAt} >= ${startOfMonth})`,
      hired: sql<number>`COUNT(*) FILTER (WHERE ${applications.status} = 'hired')`,
    })
    .from(applications)
    .where(and(eq(applications.organizationId, orgId), applicationPrivacyAllowed()));

  // Average time to fill (for hired candidates in last 90 days)
  const [timeToFill] = await db
    .select({
      avgDays: sql<number>`AVG(EXTRACT(EPOCH FROM (${applications.updatedAt} - ${applications.appliedAt})) / 86400)`,
    })
    .from(applications)
    .where(
      and(
        eq(applications.organizationId, orgId),
        eq(applications.status, 'hired'),
        gte(applications.updatedAt, ninetyDaysAgo),
        applicationPrivacyAllowed(),
      )
    );

  // Team stats
  const [teamStats] = await db
    .select({
      total: count(),
      seated: sql<number>`COUNT(*) FILTER (WHERE ${organizationMembers.seatAssigned} = true)`,
    })
    .from(organizationMembers)
    .where(eq(organizationMembers.organizationId, orgId));

  // AI Credits
  const [creditStats] = await db
    .select({
      used: sql<number>`COALESCE(${organizationCreditBalances.recurringUsed} + ${organizationCreditBalances.purchasedUsed}, 0)`,
      allocated: sql<number>`COALESCE(${organizationCreditBalances.recurringAllocated} + ${organizationCreditBalances.purchasedCredits} + ${organizationCreditBalances.purchasedUsed}, 0)`,
    })
    .from(organizationCreditBalances)
    .where(eq(organizationCreditBalances.organizationId, orgId));

  // Subscription
  const subscription = await getOrganizationSubscription(orgId);

  const totalJobs = Number(jobStats?.total ?? 0);
  const totalApplications = Number(appStats?.total ?? 0);
  const totalHires = Number(appStats?.hired ?? 0);

  return {
    totalApplications,
    totalHires,
    conversionRate: totalApplications > 0 ? Math.round((totalHires / totalApplications) * 1000) / 10 : 0,
    avgTimeToFill: timeToFill?.avgDays ? Math.round(timeToFill.avgDays * 10) / 10 : null,
    totalJobs,
    activeJobs: Number(jobStats?.active ?? 0),
    jobsThisMonth: Number(jobStats?.thisMonth ?? 0),
    applicationsThisMonth: Number(appStats?.thisMonth ?? 0),
    avgApplicationsPerJob: totalJobs > 0 ? Math.round(totalApplications / totalJobs) : 0,
    totalMembers: Number(teamStats?.total ?? 0),
    seatsUsed: Number(teamStats?.seated ?? 0),
    seatsTotal: subscription?.seats ?? 1,
    creditsUsed: Number(creditStats?.used ?? 0),
    creditsAllocated: Number(creditStats?.allocated ?? 0),
    creditsRemaining: Number(creditStats?.allocated ?? 0) - Number(creditStats?.used ?? 0),
    planName: subscription?.plan.name ?? 'free',
    planDisplayName: subscription?.plan.displayName ?? 'Free',
    billingCycle: subscription?.billingCycle ?? null,
    renewalDate: subscription?.currentPeriodEnd ?? null,
  };
}

// ===== Time to Fill by Job =====

export interface TimeToFillByJob {
  jobId: number;
  jobTitle: string;
  postedAt: Date;
  hiredAt: Date | null;
  daysToFill: number | null;
  status: string;
  totalApplications: number;
}

export async function getTimeToFillByJob(orgId: number): Promise<TimeToFillByJob[]> {
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const jobsWithHires = await db
    .select({
      jobId: jobs.id,
      jobTitle: jobs.title,
      postedAt: jobs.createdAt,
      status: jobs.status,
      totalApplications: sql<number>`(SELECT COUNT(*) FROM applications WHERE applications.job_id = ${jobs.id} AND ${applicationPrivacyAllowed()})`,
      hiredAt: sql<Date | null>`(SELECT MIN(updated_at) FROM applications WHERE applications.job_id = ${jobs.id} AND applications.status = 'hired' AND ${applicationPrivacyAllowed()})`,
    })
    .from(jobs)
    .where(
      and(
        eq(jobs.organizationId, orgId),
        gte(jobs.createdAt, ninetyDaysAgo)
      )
    )
    .orderBy(desc(jobs.createdAt))
    .limit(20);

  return jobsWithHires.map((j: { jobId: number; jobTitle: string; postedAt: Date; hiredAt: Date | null; status: string; totalApplications: number }) => ({
    jobId: j.jobId,
    jobTitle: j.jobTitle,
    postedAt: j.postedAt,
    hiredAt: j.hiredAt,
    daysToFill: j.hiredAt
      ? Math.round((new Date(j.hiredAt).getTime() - new Date(j.postedAt).getTime()) / (1000 * 60 * 60 * 24) * 10) / 10
      : null,
    status: j.status,
    totalApplications: Number(j.totalApplications),
  }));
}

// ===== Time in Stage Breakdown =====

export interface StageBreakdown {
  stageName: string;
  stageId: number | null;
  avgDays: number;
  transitions: number;
}

export async function getTimeInStageBreakdown(orgId: number): Promise<StageBreakdown[]> {
  // Get custom pipeline stages or use defaults
  const customStages = await db
    .select()
    .from(pipelineStages)
    .where(eq(pipelineStages.organizationId, orgId))
    .orderBy(pipelineStages.order);

  const stageNames: { id: number; name: string }[] = customStages.length > 0
    ? customStages.map((s: { id: number; name: string }) => ({ id: s.id, name: s.name }))
    : [
        { id: 1, name: 'Applied' },
        { id: 2, name: 'Screening' },
        { id: 3, name: 'Interview' },
        { id: 4, name: 'Offer' },
        { id: 5, name: 'Hired' },
      ];

  // Get stage history data - simplified query without window functions in aggregates
  // First get transition counts per stage
  const stageHistory = await db
    .select({
      toStage: applicationStageHistory.toStage,
      count: count(),
    })
    .from(applicationStageHistory)
    .innerJoin(applications, eq(applicationStageHistory.applicationId, applications.id))
    .where(and(eq(applications.organizationId, orgId), applicationPrivacyAllowed()))
    .groupBy(applicationStageHistory.toStage);

  // Calculate average time in stage using a subquery approach
  const avgTimeResults = await db.execute(sql`
    WITH stage_times AS (
      SELECT
        ash.to_stage,
        EXTRACT(EPOCH FROM (ash.changed_at - LAG(ash.changed_at) OVER (
          PARTITION BY ash.application_id ORDER BY ash.changed_at
        ))) / 86400 as days_in_stage
      FROM application_stage_history ash
      INNER JOIN applications a ON ash.application_id = a.id
      WHERE a.organization_id = ${orgId}
        AND ${applicationPrivacyAllowed('a.id')}
    )
    SELECT to_stage, AVG(days_in_stage) as avg_days
    FROM stage_times
    WHERE days_in_stage IS NOT NULL AND days_in_stage > 0
    GROUP BY to_stage
  `);

  const avgTimeMap = new Map<number | null, number>();
  if (avgTimeResults.rows) {
    for (const row of avgTimeResults.rows as { to_stage: number | null; avg_days: string | null }[]) {
      avgTimeMap.set(row.to_stage, Number(row.avg_days ?? 0));
    }
  }

  const historyMap = new Map<number | null, { count: number; avgTime: number }>(
    stageHistory.map((h: { toStage: number | null; count: number }) => [
      h.toStage,
      { count: Number(h.count), avgTime: avgTimeMap.get(h.toStage) ?? 0 }
    ])
  );

  // Also count current_stage for applications without history
  const currentStageCounts = await db
    .select({
      stage: applications.currentStage,
      count: count(),
    })
    .from(applications)
    .where(and(eq(applications.organizationId, orgId), applicationPrivacyAllowed()))
    .groupBy(applications.currentStage);

  const currentMap = new Map<number | null, number>(
    currentStageCounts.map((c: { stage: number | null; count: number }) => [c.stage, Number(c.count)])
  );

  return stageNames.map((stage: { id: number; name: string }) => {
    const history = historyMap.get(stage.id);
    const currentCount = currentMap.get(stage.id) ?? 0;
    return {
      stageName: stage.name,
      stageId: stage.id,
      avgDays: Math.round((history?.avgTime ?? 0) * 10) / 10,
      transitions: (history?.count ?? 0) + currentCount,
    };
  });
}

// ===== Source Performance =====

export interface SourcePerformance {
  source: string;
  applications: number;
  shortlisted: number;
  hired: number;
  conversionRate: number;
}

export async function getSourcePerformance(orgId: number): Promise<SourcePerformance[]> {
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const sourceStats = await db
    .select({
      source: sql<string>`COALESCE(${applications.source}, 'public_apply')`,
      total: count(),
      shortlisted: sql<number>`COUNT(*) FILTER (WHERE ${applications.status} IN ('screening', 'interview', 'offer', 'hired'))`,
      hired: sql<number>`COUNT(*) FILTER (WHERE ${applications.status} = 'hired')`,
    })
    .from(applications)
    .where(
      and(
        eq(applications.organizationId, orgId),
        gte(applications.appliedAt, ninetyDaysAgo),
        applicationPrivacyAllowed(),
      )
    )
    .groupBy(sql`COALESCE(${applications.source}, 'public_apply')`)
    .orderBy(desc(count()));

  return sourceStats.map((s: { source: string; total: number; shortlisted: number; hired: number }) => ({
    source: s.source,
    applications: Number(s.total),
    shortlisted: Number(s.shortlisted),
    hired: Number(s.hired),
    conversionRate: Number(s.total) > 0 ? Math.round((Number(s.hired) / Number(s.total)) * 100) : 0,
  }));
}

// ===== Recruiter Performance =====

export interface RecruiterPerformance {
  recruiterId: number;
  recruiterName: string;
  jobsPosted: number;
  applicationsScreened: number;
  avgFirstActionDays: number;
}

export async function getRecruiterPerformance(orgId: number): Promise<RecruiterPerformance[]> {
  // Get recruiters with their stats
  const recruiterStats = await db
    .select({
      userId: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.username,
      jobsPosted: sql<number>`(SELECT COUNT(*) FROM jobs WHERE jobs.posted_by = ${users.id} AND jobs.organization_id = ${orgId})`,
      applicationsScreened: sql<number>`(
        SELECT COUNT(*) FROM application_stage_history ash
        INNER JOIN applications a ON ash.application_id = a.id
        WHERE ash.changed_by = ${users.id} AND a.organization_id = ${orgId}
          AND ${applicationPrivacyAllowed('a.id')}
      )`,
    })
    .from(users)
    .innerJoin(organizationMembers, eq(organizationMembers.userId, users.id))
    .where(eq(organizationMembers.organizationId, orgId));

  // Calculate avg first action time per recruiter
  const firstActionTimes = await db
    .select({
      changedBy: applicationStageHistory.changedBy,
      avgDays: sql<number>`AVG(
        EXTRACT(EPOCH FROM (${applicationStageHistory.changedAt} - ${applications.appliedAt})) / 86400
      )`,
    })
    .from(applicationStageHistory)
    .innerJoin(applications, eq(applicationStageHistory.applicationId, applications.id))
    .where(and(eq(applications.organizationId, orgId), applicationPrivacyAllowed()))
    .groupBy(applicationStageHistory.changedBy);

  const firstActionMap = new Map(firstActionTimes.map((f: { changedBy: number | null; avgDays: number | null }) => [f.changedBy, Number(f.avgDays ?? 0)]));

  return recruiterStats.map((r: { userId: number; firstName: string | null; lastName: string | null; email: string; jobsPosted: number; applicationsScreened: number }) => ({
    recruiterId: r.userId,
    recruiterName: [r.firstName, r.lastName].filter(Boolean).join(' ') || r.email,
    jobsPosted: Number(r.jobsPosted),
    applicationsScreened: Number(r.applicationsScreened),
    avgFirstActionDays: Math.round((Number(firstActionMap.get(r.userId) ?? 0)) * 10) / 10,
  }));
}

// ===== Hiring Manager Performance =====

export interface HiringManagerPerformance {
  managerId: number;
  managerName: string;
  jobsAssigned: number;
  feedbackGiven: number;
  avgFeedbackDays: number;
  pendingReviews: number;
}

export async function getHiringManagerPerformance(orgId: number): Promise<HiringManagerPerformance[]> {
  // Get hiring managers using raw SQL to avoid column ambiguity
  const result = await db.execute(sql`
    SELECT
      u.id as user_id,
      u.first_name,
      u.last_name,
      u.username as email,
      (SELECT COUNT(*) FROM jobs j WHERE j.hiring_manager_id = u.id AND j.organization_id = ${orgId}) as jobs_assigned,
      (SELECT COUNT(*) FROM application_feedback af
       INNER JOIN applications a ON af.application_id = a.id
       WHERE af.author_id = u.id AND a.organization_id = ${orgId}
         AND ${applicationPrivacyAllowed('a.id')}) as feedback_given
    FROM users u
    WHERE u.id IN (
      SELECT hiring_manager_id FROM jobs
      WHERE organization_id = ${orgId} AND hiring_manager_id IS NOT NULL
    )
  `);

  if (!result.rows || result.rows.length === 0) {
    return [];
  }

  return (result.rows as { user_id: number; first_name: string | null; last_name: string | null; email: string; jobs_assigned: string; feedback_given: string }[]).map(m => ({
    managerId: m.user_id,
    managerName: [m.first_name, m.last_name].filter(Boolean).join(' ') || m.email,
    jobsAssigned: Number(m.jobs_assigned),
    feedbackGiven: Number(m.feedback_given),
    avgFeedbackDays: 0, // Would need more detailed tracking
    pendingReviews: 0, // Would need to track pending reviews
  }));
}

// ===== Team Activity (for credits page) =====

export interface TeamMemberActivity {
  userId: number;
  name: string;
  email: string;
  role: string;
  lastActivityAt: Date | null;
  jobsPosted: number;
  applicationsProcessed: number;
  creditsUsed: number;
  creditsAllocated: number;
  seatAssigned: boolean;
}

export async function getTeamActivity(orgId: number): Promise<TeamMemberActivity[]> {
  const creditBalance = await db.query.organizationCreditBalances.findFirst({
    where: eq(organizationCreditBalances.organizationId, orgId),
  });
  const usageWindowStart = creditBalance?.periodStart ?? new Date(0);

  const members = await db
    .select({
      memberId: organizationMembers.id,
      userId: organizationMembers.userId,
      role: organizationMembers.role,
      lastActivityAt: organizationMembers.lastActivityAt,
      seatAssigned: organizationMembers.seatAssigned,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.username,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(organizationMembers.userId, users.id))
    .where(eq(organizationMembers.organizationId, orgId));

  const jobCounts = await db
    .select({
      postedBy: jobs.postedBy,
      count: count(),
    })
    .from(jobs)
    .where(eq(jobs.organizationId, orgId))
    .groupBy(jobs.postedBy);

  const jobCountMap = new Map(jobCounts.map((j: { postedBy: number; count: number }) => [j.postedBy, Number(j.count)]));

  const appCounts = await db
    .select({
      postedBy: jobs.postedBy,
      count: count(),
    })
    .from(applications)
    .innerJoin(jobs, eq(applications.jobId, jobs.id))
    .where(and(eq(jobs.organizationId, orgId), applicationPrivacyAllowed()))
    .groupBy(jobs.postedBy);

  const appCountMap = new Map(appCounts.map((a: { postedBy: number; count: number }) => [a.postedBy, Number(a.count)]));

  const creditUsage = await db
    .select({
      userId: userAiUsage.userId,
      used: count(),
    })
    .from(userAiUsage)
    .where(and(
      eq(userAiUsage.organizationId, orgId),
      gte(userAiUsage.computedAt, usageWindowStart),
    ))
    .groupBy(userAiUsage.userId);

  const creditUsageMap = new Map(creditUsage.map((row: typeof creditUsage[number]) => [row.userId, Number(row.used)]));

  return members.map((m: { userId: number; firstName: string | null; lastName: string | null; email: string; role: string; lastActivityAt: Date | null; seatAssigned: boolean }) => ({
    userId: m.userId,
    name: [m.firstName, m.lastName].filter(Boolean).join(' ') || m.email,
    email: m.email,
    role: m.role,
    lastActivityAt: m.lastActivityAt,
    jobsPosted: jobCountMap.get(m.userId) ?? 0,
    applicationsProcessed: appCountMap.get(m.userId) ?? 0,
    creditsUsed: creditUsageMap.get(m.userId) ?? 0,
    creditsAllocated: 0,
    seatAssigned: m.seatAssigned,
  }));
}

// ===== AI Credit Usage =====

export interface AiCreditUsage {
  totalUsed: number;
  totalAllocated: number;
  byMember: {
    userId: number;
    name: string;
    used: number;
    allocated: number;
  }[];
  byFeature: {
    feature: string;
    count: number;
    tokensIn: number;
    tokensOut: number;
  }[];
  recentUsage: {
    date: string;
    count: number;
  }[];
}

export async function getAiCreditUsage(orgId: number): Promise<AiCreditUsage> {
  const creditBalance = await db.query.organizationCreditBalances.findFirst({
    where: eq(organizationCreditBalances.organizationId, orgId),
  });
  const usageWindowStart = creditBalance?.periodStart ?? new Date(0);

  const [totals] = await db
    .select({
      used: sql<number>`COALESCE(${organizationCreditBalances.recurringUsed} + ${organizationCreditBalances.purchasedUsed}, 0)`,
      allocated: sql<number>`COALESCE(${organizationCreditBalances.recurringAllocated} + ${organizationCreditBalances.purchasedCredits} + ${organizationCreditBalances.purchasedUsed}, 0)`,
    })
    .from(organizationCreditBalances)
    .where(eq(organizationCreditBalances.organizationId, orgId));

  const byMemberRaw = await db
    .select({
      userId: userAiUsage.userId,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.username,
      used: count(),
    })
    .from(userAiUsage)
    .innerJoin(users, eq(userAiUsage.userId, users.id))
    .where(and(
      eq(userAiUsage.organizationId, orgId),
      gte(userAiUsage.computedAt, usageWindowStart),
    ))
    .groupBy(userAiUsage.userId, users.firstName, users.lastName, users.username);

  const byMember = byMemberRaw.map((m: { userId: number; firstName: string | null; lastName: string | null; email: string; used: number }) => ({
    userId: m.userId,
    name: [m.firstName, m.lastName].filter(Boolean).join(' ') || m.email,
    used: Number(m.used),
    allocated: 0,
  }));

  const byFeature = await db
    .select({
      feature: userAiUsage.kind,
      count: count(),
      tokensIn: sql<number>`COALESCE(SUM(${userAiUsage.tokensIn}), 0)`,
      tokensOut: sql<number>`COALESCE(SUM(${userAiUsage.tokensOut}), 0)`,
    })
    .from(userAiUsage)
    .where(eq(userAiUsage.organizationId, orgId))
    .groupBy(userAiUsage.kind);

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const recentUsage = await db
    .select({
      date: sql<string>`DATE(${userAiUsage.computedAt})`,
      count: count(),
    })
    .from(userAiUsage)
    .where(
      and(
        eq(userAiUsage.organizationId, orgId),
        gte(userAiUsage.computedAt, thirtyDaysAgo)
      )
    )
    .groupBy(sql`DATE(${userAiUsage.computedAt})`)
    .orderBy(sql`DATE(${userAiUsage.computedAt})`);

  return {
    totalUsed: Number(totals?.used ?? 0),
    totalAllocated: Number(totals?.allocated ?? 0),
    byMember,
    byFeature: byFeature.map((f: { feature: string; count: number; tokensIn: number; tokensOut: number }) => ({
      feature: f.feature,
      count: Number(f.count),
      tokensIn: Number(f.tokensIn),
      tokensOut: Number(f.tokensOut),
    })),
    recentUsage: recentUsage.map((r: { date: string; count: number }) => ({
      date: r.date,
      count: Number(r.count),
    })),
  };
}

// ===== Hiring Funnel =====

export interface HiringFunnelStats {
  stages: {
    name: string;
    count: number;
    percentage: number;
  }[];
  conversionRates: {
    fromStage: string;
    toStage: string;
    rate: number;
  }[];
  avgTimeToHire: number | null;
  totalHired: number;
  totalRejected: number;
}

export async function getHiringFunnel(orgId: number): Promise<HiringFunnelStats> {
  const stages = await db
    .select()
    .from(pipelineStages)
    .where(eq(pipelineStages.organizationId, orgId))
    .orderBy(pipelineStages.order);

  const stageNames: { id: number; name: string }[] = stages.length > 0
    ? stages.map((s: { id: number; name: string }) => ({ id: s.id, name: s.name }))
    : [
        { id: 1, name: 'Applied' },
        { id: 2, name: 'Screening' },
        { id: 3, name: 'Interview' },
        { id: 4, name: 'Offer' },
        { id: 5, name: 'Hired' },
      ];

  const stageCounts = await db
    .select({
      stage: applications.currentStage,
      count: count(),
    })
    .from(applications)
    .where(and(eq(applications.organizationId, orgId), applicationPrivacyAllowed()))
    .groupBy(applications.currentStage);

  const stageCountMap = new Map(stageCounts.map((s: { stage: number | null; count: number }) => [s.stage, Number(s.count)]));

  const [statusCounts] = await db
    .select({
      total: count(),
      hired: sql<number>`COUNT(*) FILTER (WHERE ${applications.status} = 'hired')`,
      rejected: sql<number>`COUNT(*) FILTER (WHERE ${applications.status} = 'rejected')`,
    })
    .from(applications)
    .where(and(eq(applications.organizationId, orgId), applicationPrivacyAllowed()));

  const total = Number(statusCounts?.total ?? 0);

  const stageStats = stageNames.map((stage: { id: number; name: string }) => {
    const stageCount = Number(stageCountMap.get(stage.id) ?? 0);
    return {
      name: stage.name,
      count: stageCount,
      percentage: total > 0 ? Math.round((stageCount / total) * 100) : 0,
    };
  });

  const conversionRates: { fromStage: string; toStage: string; rate: number }[] = [];
  for (let i = 0; i < stageStats.length - 1; i++) {
    const fromStage = stageStats[i];
    const toStage = stageStats[i + 1];
    if (fromStage && toStage) {
      const fromCount = fromStage.count;
      const toCount = toStage.count;
      conversionRates.push({
        fromStage: fromStage.name,
        toStage: toStage.name,
        rate: fromCount > 0 ? Math.round((toCount / fromCount) * 100) : 0,
      });
    }
  }

  return {
    stages: stageStats,
    conversionRates,
    avgTimeToHire: null,
    totalHired: Number(statusCounts?.hired ?? 0),
    totalRejected: Number(statusCounts?.rejected ?? 0),
  };
}
