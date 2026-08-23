/**
 * Analytics Helper
 *
 * Computes hiring metrics for founder-level reporting:
 * - Time-to-fill: Average time from application to hire
 * - Time-in-stage: Average time spent in each pipeline stage
 * - Stage conversion rates
 */

import { db } from '../db';
import { applications, applicationStageHistory, pipelineStages, jobs } from '@shared/schema';
import { eq, and, gte, lte, sql, desc } from 'drizzle-orm';
import { privacyAllowedSql } from '../candidate-privacy/decision';

const applicationPrivacyAllowed = () => sql.raw(
  privacyAllowedSql('application', 'applications.id', { globalUse: false }),
);

export interface TimeToFillMetric {
  jobId: number;
  jobTitle: string;
  averageDays: number;
  hiredCount: number;
  oldestHireDate: Date | null;
  newestHireDate: Date | null;
}

export interface TimeInStageMetric {
  stageId: number;
  stageName: string;
  stageOrder: number;
  averageDays: number;
  transitionCount: number;
  minDays: number;
  maxDays: number;
}

export interface HiringMetrics {
  timeToFill: {
    overall: number | null; // Average days across all jobs
    byJob: TimeToFillMetric[];
  };
  timeInStage: TimeInStageMetric[];
  totalApplications: number;
  totalHires: number;
  conversionRate: number; // % of applications that result in hire
}

/**
 * Get the ID of the "Hired" stage
 * Looks for a stage named "Hired" (case-insensitive)
 */
async function getHiredStageId(): Promise<number | null> {
  // First try to find a stage explicitly named "Hired"
  const hiredStage = await db
    .select()
    .from(pipelineStages)
    .where(sql`LOWER(${pipelineStages.name}) = 'hired'`)
    .limit(1);

  if (hiredStage.length > 0) {
    return hiredStage[0].id;
  }

  // Fallback: look for stage containing "hired" in name
  const stages = await db
    .select()
    .from(pipelineStages)
    .where(sql`LOWER(${pipelineStages.name}) LIKE '%hired%'`)
    .limit(1);

  return stages.length > 0 ? stages[0].id : null;
}

/**
 * Calculate time-to-fill metrics
 *
 * For each job, calculates the average time from application submission
 * to reaching the "Hired" stage
 *
 * @param organizationId - Required organization ID for data isolation
 * @param startDate - Optional start date filter
 * @param endDate - Optional end date filter
 * @param jobId - Optional filter by specific job
 */
export async function calculateTimeToFill(
  organizationId: number,
  startDate?: Date,
  endDate?: Date,
  jobId?: number
): Promise<TimeToFillMetric[]> {
  const hiredStageId = await getHiredStageId();

  if (!hiredStageId) {
    return [];
  }

  // Build query conditions
  const conditions = [
    eq(applicationStageHistory.toStage, hiredStageId),
    applicationPrivacyAllowed(),
  ];

  if (startDate) {
    conditions.push(gte(applicationStageHistory.changedAt, startDate));
  }

  if (endDate) {
    conditions.push(lte(applicationStageHistory.changedAt, endDate));
  }

  // Query to get all applications that reached "Hired" stage
  // Filter by organization to ensure data isolation (0 = no filter for super_admin)
  const orgConditions = organizationId > 0
    ? [...conditions, eq(jobs.organizationId, organizationId)]
    : conditions;

  const hiredApplications = await db
    .select({
      applicationId: applicationStageHistory.applicationId,
      hiredAt: applicationStageHistory.changedAt,
      jobId: applications.jobId,
      jobTitle: jobs.title,
      appliedAt: applications.appliedAt,
    })
    .from(applicationStageHistory)
    .innerJoin(applications, eq(applicationStageHistory.applicationId, applications.id))
    .innerJoin(jobs, eq(applications.jobId, jobs.id))
    .where(and(...orgConditions));

  // Filter by jobId if specified
  const filteredApplications = jobId
    ? hiredApplications.filter((app: typeof hiredApplications[0]) => app.jobId === jobId)
    : hiredApplications;

  // Group by job and calculate metrics
  const jobMetrics = new Map<number, {
    jobTitle: string;
    totalDays: number;
    count: number;
    oldestHire: Date | null;
    newestHire: Date | null;
  }>();

  for (const app of filteredApplications) {
    const daysToFill = Math.round(
      (new Date(app.hiredAt).getTime() - new Date(app.appliedAt).getTime()) / (1000 * 60 * 60 * 24)
    );

    if (!jobMetrics.has(app.jobId)) {
      jobMetrics.set(app.jobId, {
        jobTitle: app.jobTitle,
        totalDays: 0,
        count: 0,
        oldestHire: null,
        newestHire: null,
      });
    }

    const metrics = jobMetrics.get(app.jobId)!;
    metrics.totalDays += daysToFill;
    metrics.count += 1;

    // Track date range
    const hiredDate = new Date(app.hiredAt);
    if (!metrics.oldestHire || hiredDate < metrics.oldestHire) {
      metrics.oldestHire = hiredDate;
    }
    if (!metrics.newestHire || hiredDate > metrics.newestHire) {
      metrics.newestHire = hiredDate;
    }
  }

  // Convert to array format
  return Array.from(jobMetrics.entries()).map(([jobId, metrics]) => ({
    jobId,
    jobTitle: metrics.jobTitle,
    averageDays: Math.round(metrics.totalDays / metrics.count),
    hiredCount: metrics.count,
    oldestHireDate: metrics.oldestHire,
    newestHireDate: metrics.newestHire,
  }));
}

/**
 * Calculate time-in-stage metrics
 *
 * For each pipeline stage, calculates the average time applications spend in that stage
 *
 * @param organizationId - Required organization ID for data isolation
 * @param startDate - Optional start date filter
 * @param endDate - Optional end date filter
 * @param jobId - Optional filter by specific job
 */
export async function calculateTimeInStage(
  organizationId: number,
  startDate?: Date,
  endDate?: Date,
  jobId?: number
): Promise<TimeInStageMetric[]> {
  // Get all stages
  const stages = await db
    .select()
    .from(pipelineStages)
    .orderBy(pipelineStages.order);

  // Get all stage history entries
  // Filter by organization to ensure data isolation (0 = no filter for super_admin)
  const historyConditions = [applicationPrivacyAllowed()];
  if (organizationId > 0) {
    historyConditions.push(eq(jobs.organizationId, organizationId));
  }

  const historyEntries = await db
    .select({
      applicationId: applicationStageHistory.applicationId,
      fromStage: applicationStageHistory.fromStage,
      toStage: applicationStageHistory.toStage,
      changedAt: applicationStageHistory.changedAt,
      jobId: applications.jobId,
    })
    .from(applicationStageHistory)
    .innerJoin(applications, eq(applicationStageHistory.applicationId, applications.id))
    .innerJoin(jobs, eq(applications.jobId, jobs.id))
    .where(and(...historyConditions))
    .orderBy(applicationStageHistory.applicationId, applicationStageHistory.changedAt);

  // Filter by date range and jobId if specified
  let filteredHistory = historyEntries;
  if (startDate) {
    filteredHistory = filteredHistory.filter((h: typeof historyEntries[0]) => new Date(h.changedAt) >= startDate);
  }
  if (endDate) {
    filteredHistory = filteredHistory.filter((h: typeof historyEntries[0]) => new Date(h.changedAt) <= endDate);
  }
  if (jobId) {
    filteredHistory = filteredHistory.filter((h: typeof historyEntries[0]) => h.jobId === jobId);
  }

  // Calculate time spent in each stage
  const stageMetrics = new Map<number, {
    totalDays: number;
    count: number;
    minDays: number;
    maxDays: number;
  }>();

  // Group by application to calculate time between stage transitions
  const appHistory = new Map<number, typeof filteredHistory>();
  for (const entry of filteredHistory) {
    if (!appHistory.has(entry.applicationId)) {
      appHistory.set(entry.applicationId, []);
    }
    appHistory.get(entry.applicationId)!.push(entry);
  }

  // For each application, calculate time in each stage
  for (const [appId, history] of appHistory.entries()) {
    // Sort by changedAt
    history.sort((a: typeof filteredHistory[0], b: typeof filteredHistory[0]) => new Date(a.changedAt).getTime() - new Date(b.changedAt).getTime());

    for (let i = 0; i < history.length - 1; i++) {
      const currentStageId = history[i].toStage;
      const nextChangeTime = new Date(history[i + 1].changedAt);
      const currentChangeTime = new Date(history[i].changedAt);

      const daysInStage = Math.round(
        (nextChangeTime.getTime() - currentChangeTime.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (!stageMetrics.has(currentStageId)) {
        stageMetrics.set(currentStageId, {
          totalDays: 0,
          count: 0,
          minDays: Infinity,
          maxDays: -Infinity,
        });
      }

      const metrics = stageMetrics.get(currentStageId)!;
      metrics.totalDays += daysInStage;
      metrics.count += 1;
      metrics.minDays = Math.min(metrics.minDays, daysInStage);
      metrics.maxDays = Math.max(metrics.maxDays, daysInStage);
    }
  }

  // Convert to array format with stage names
  return stages.map((stage: typeof stages[0]) => {
    const metrics = stageMetrics.get(stage.id);

    if (!metrics || metrics.count === 0) {
      return {
        stageId: stage.id,
        stageName: stage.name,
        stageOrder: stage.order,
        averageDays: 0,
        transitionCount: 0,
        minDays: 0,
        maxDays: 0,
      };
    }

    return {
      stageId: stage.id,
      stageName: stage.name,
      stageOrder: stage.order,
      averageDays: Math.round(metrics.totalDays / metrics.count * 10) / 10, // Round to 1 decimal
      transitionCount: metrics.count,
      minDays: metrics.minDays === Infinity ? 0 : metrics.minDays,
      maxDays: metrics.maxDays === -Infinity ? 0 : metrics.maxDays,
    };
  });
}

/**
 * Get comprehensive hiring metrics
 *
 * @param organizationId - Required organization ID for data isolation
 * @param startDate - Optional start date filter
 * @param endDate - Optional end date filter
 * @param jobId - Optional filter by specific job
 */
export async function getHiringMetrics(
  organizationId: number,
  startDate?: Date,
  endDate?: Date,
  jobId?: number
): Promise<HiringMetrics> {
  // Calculate time-to-fill metrics
  const timeToFillByJob = await calculateTimeToFill(organizationId, startDate, endDate, jobId);

  // Calculate overall time-to-fill
  const totalHires = timeToFillByJob.reduce((sum, job) => sum + job.hiredCount, 0);
  const totalDays = timeToFillByJob.reduce((sum, job) => sum + (job.averageDays * job.hiredCount), 0);
  const overallTimeToFill = totalHires > 0 ? Math.round(totalDays / totalHires) : null;

  // Calculate time-in-stage metrics
  const timeInStage = await calculateTimeInStage(organizationId, startDate, endDate, jobId);

  // Get total application count
  // Build conditions array to combine all filters (0 = no org filter for super_admin)
  const countConditions: ReturnType<typeof eq>[] = [applicationPrivacyAllowed()];
  if (organizationId > 0) {
    countConditions.push(eq(jobs.organizationId, organizationId));
  }
  if (startDate) {
    countConditions.push(gte(applications.appliedAt, startDate));
  }
  if (endDate) {
    countConditions.push(lte(applications.appliedAt, endDate));
  }
  if (jobId) {
    countConditions.push(eq(applications.jobId, jobId));
  }

  let countQuery = db
    .select({ count: sql<number>`count(*)::int` })
    .from(applications)
    .innerJoin(jobs, eq(applications.jobId, jobs.id));

  if (countConditions.length > 0) {
    countQuery = countQuery.where(and(...countConditions)) as typeof countQuery;
  }

  const [{ count: totalApplications }] = await countQuery;

  // Calculate conversion rate
  const conversionRate = totalApplications > 0
    ? Math.round((totalHires / totalApplications) * 1000) / 10 // Round to 1 decimal
    : 0;

  return {
    timeToFill: {
      overall: overallTimeToFill,
      byJob: timeToFillByJob,
    },
    timeInStage,
    totalApplications,
    totalHires,
    conversionRate,
  };
}
