import type { Express, Request, Response, NextFunction } from "express";
import { inArray, sql } from "drizzle-orm";
import { clientFeedback } from "@shared/schema";
import { requireRole, requireSeat } from "./auth";
import { storage } from "./storage";
import { getUserOrganization } from "./lib/organizationService";
import { db } from "./db";

type DashboardActionSectionId =
  | "candidatesToReview"
  | "jobsLowOnPipeline"
  | "feedbackPending"
  | "finalStageCandidates";

type DashboardActionUrgency = "high" | "medium" | "low";

type DashboardActionItem = {
  id: string;
  type: string;
  title: string;
  subtitle: string;
  urgency: DashboardActionUrgency;
  ctaLabel: string;
  ctaHref: string;
  jobId?: number;
  applicationId?: number;
  badge?: string;
};

type DashboardActionSection = {
  id: DashboardActionSectionId;
  title: string;
  description: string;
  count: number;
  emptyMessage: string;
  viewAllHref: string;
  items: DashboardActionItem[];
};

const MAX_ITEMS_PER_SECTION = 4;
const LOW_PIPELINE_THRESHOLD = 3;
const LOW_PIPELINE_JOB_AGE_DAYS = 5;
const REVIEW_WAIT_DAYS = 2;
const FEEDBACK_WAIT_DAYS = 3;
const FINAL_STAGE_WAIT_DAYS = 2;
const RANGE_PRESETS = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
} as const;

const sectionOrder: DashboardActionSectionId[] = [
  "candidatesToReview",
  "feedbackPending",
  "finalStageCandidates",
  "jobsLowOnPipeline",
];

type InterviewStageRangePreset = keyof typeof RANGE_PRESETS;
type TodayInterviewStatus = "scheduled" | "upcoming" | "completed";
type DashboardKpiStatus = "healthy" | "needs_attention" | "at_risk";
type DashboardTrendDirection = "up" | "down" | "flat";

function daysBetween(dateLike?: string | Date | null): number | null {
  if (!dateLike) return null;
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24)));
}

function applicationHref(jobId: number, applicationId: number, stageId?: number | null): string {
  const params = new URLSearchParams();
  if (stageId != null) {
    params.set("stage", String(stageId));
  }
  params.set("applicationId", String(applicationId));
  const query = params.toString();
  return query ? `/jobs/${jobId}/applications?${query}` : `/jobs/${jobId}/applications`;
}

function isClosedApplication(status: string, stageNameLower = ""): boolean {
  return (
    status === "rejected" ||
    status === "hired" ||
    stageNameLower.includes("rejected") ||
    stageNameLower.includes("hired")
  );
}

function resolveRangePreset(value: unknown): InterviewStageRangePreset {
  if (typeof value === "string" && value in RANGE_PRESETS) {
    return value as InterviewStageRangePreset;
  }
  return "30d";
}

function clampDate(value?: string | Date | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isWithinWindow(value: string | Date | null | undefined, start: Date, end: Date): boolean {
  const date = clampDate(value);
  if (!date) return false;
  return date >= start && date <= end;
}

function roundRate(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function formatInterviewTime(value?: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function parseJobIdParam(value: unknown): number | null {
  if (typeof value !== "string" || value === "all") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function resolveInterviewDate(value: unknown): Date {
  const parsed = typeof value === "string" ? clampDate(value) : null;
  return parsed ?? new Date();
}

function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function endOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function startOfWeekMonday(date: Date): Date {
  const result = startOfDay(date);
  const day = result.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  result.setDate(result.getDate() + offset);
  return result;
}

function parseTimeToMinutes(value?: string | null): number | null {
  const normalized = formatInterviewTime(value);
  if (!normalized) return null;
  const parts = normalized.split(":");
  if (parts.length !== 2) return null;
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function resolveInterviewStatus(
  interviewDate: Date | null,
  interviewTime?: string | null,
  now = new Date(),
): TodayInterviewStatus {
  if (!interviewDate) return "scheduled";

  const interviewDay = startOfDay(interviewDate).getTime();
  const today = startOfDay(now).getTime();

  if (interviewDay > today) return "scheduled";
  if (interviewDay < today) return "completed";

  const scheduledMinutes = parseTimeToMinutes(interviewTime);
  if (scheduledMinutes == null) return "upcoming";

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  return scheduledMinutes > currentMinutes ? "upcoming" : "completed";
}

function firstRecruiterActionAt(
  app: {
    appliedAt: string | Date;
    lastViewedAt?: string | Date | null;
    downloadedAt?: string | Date | null;
    stageChangedAt?: string | Date | null;
  },
): Date | null {
  const appliedAtMs = new Date(app.appliedAt).getTime();
  const candidates = [app.lastViewedAt, app.downloadedAt, app.stageChangedAt]
    .filter((value): value is NonNullable<typeof value> => value != null)
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()) && value.getTime() >= appliedAtMs)
    .sort((a, b) => a.getTime() - b.getTime());

  return candidates[0] ?? null;
}

function averageFirstReviewDays(
  apps: Array<{
    appliedAt: string | Date;
    lastViewedAt?: string | Date | null;
    downloadedAt?: string | Date | null;
    stageChangedAt?: string | Date | null;
  }>,
): number | null {
  const durations = apps
    .map((app) => {
      const firstActionAt = firstRecruiterActionAt(app);
      if (!firstActionAt) return null;
      const delta =
        (firstActionAt.getTime() - new Date(app.appliedAt).getTime()) /
        (1000 * 60 * 60 * 24);
      return delta >= 0 ? delta : null;
    })
    .filter((value): value is number => value != null);

  if (durations.length === 0) return null;
  return Math.round((durations.reduce((sum, value) => sum + value, 0) / durations.length) * 10) / 10;
}

function averageFirstReviewHours(
  apps: Array<{
    appliedAt: string | Date;
    lastViewedAt?: string | Date | null;
    downloadedAt?: string | Date | null;
    stageChangedAt?: string | Date | null;
  }>,
): number | null {
  const days = averageFirstReviewDays(apps);
  return days == null ? null : Math.round(days * 24 * 10) / 10;
}

function formatDaysDisplay(days: number | null): string {
  return days == null ? "—" : `${days}d`;
}

function roundDelta(value: number | null): number | null {
  if (value == null || Number.isNaN(value)) return null;
  return Math.round(value * 10) / 10;
}

function percentDelta(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return roundDelta(((current - previous) / previous) * 100);
}

function deltaDirection(delta: number | null, invert = false): DashboardTrendDirection {
  if (delta == null) return "flat";
  const normalized = invert ? -delta : delta;
  if (normalized > 0) return "up";
  if (normalized < 0) return "down";
  return "flat";
}

function pipelineStatusForScore(score: number): DashboardKpiStatus {
  if (score >= 80) return "healthy";
  if (score >= 60) return "needs_attention";
  return "at_risk";
}

function pipelineContextForScore(score: number): string {
  if (score >= 80) return "Healthy";
  if (score >= 60) return "Needs attention";
  return "At risk";
}

function stageQueueHref(jobId: number | null, stageId: number): string {
  return jobId == null
    ? `/applications?stage=${stageId}`
    : `/jobs/${jobId}/applications?stage=${stageId}`;
}

async function getRecruiterDashboardContext(user: NonNullable<Request["user"]>) {
  const orgResult = await getUserOrganization(user.id);
  const organizationId =
    user.role === "super_admin" && !orgResult
      ? undefined
      : (orgResult?.organization.id ?? null);

  const [jobs, applications, stages] = await Promise.all([
    storage.getJobsByUser(user.id, organizationId),
    storage.getRecruiterApplications(user.id, organizationId),
    storage.getPipelineStages(organizationId, user.id),
  ]);

  return {
    orgResult,
    organizationId,
    jobs,
    applications,
    stages,
  };
}

export function registerRecruiterDashboardRoutes(app: Express): void {
  app.get(
    "/api/recruiter-dashboard/kpis",
    requireRole(["recruiter", "super_admin"]),
    requireSeat({ allowNoOrg: true }),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const user = req.user!;
        const rangePreset = resolveRangePreset(req.query.range);
        const rangeDays = RANGE_PRESETS[rangePreset];
        const selectedJobId = parseJobIdParam(req.query.jobId);
        const now = new Date();
        const currentEnd = now;
        const currentStart = addDays(new Date(now), -rangeDays);
        const previousEnd = new Date(currentStart.getTime() - 1);
        const previousStart = addDays(new Date(currentStart), -rangeDays);
        const todayStart = startOfDay(now);
        const todayEnd = endOfDay(now);

        const { orgResult, jobs, applications, stages } = await getRecruiterDashboardContext(user);
        const jobsInScope = jobs.filter((job) => selectedJobId == null || job.id === selectedJobId);
        const activeJobsInScope = jobsInScope.filter((job) => job.isActive);
        const jobIdsInScope = new Set(jobsInScope.map((job) => job.id));
        const scopedApplications = applications.filter((app) => jobIdsInScope.has(app.jobId));
        const currentApplications = scopedApplications;
        const currentRangeApplications = scopedApplications.filter((app) =>
          isWithinWindow(app.appliedAt, currentStart, currentEnd),
        );
        const previousRangeApplications = scopedApplications.filter((app) =>
          isWithinWindow(app.appliedAt, previousStart, previousEnd),
        );

        const stageMeta = new Map(
          stages.map((stage) => [
            stage.id,
            {
              id: stage.id,
              name: stage.name,
              nameLower: stage.name.toLowerCase(),
              order: stage.order,
            },
          ]),
        );
        const sortedStages = [...stages].sort((a, b) => (a.order - b.order) || (a.id - b.id));
        const stageById = new Map(sortedStages.map((stage) => [stage.id, stage]));

        const currentActivePipelineApplications = currentApplications.filter((app) => {
          const stageName = stageMeta.get(app.currentStage ?? -1)?.nameLower ?? "";
          return !isClosedApplication(app.status, stageName);
        });
        const previousActivePipelineApplications = previousRangeApplications.filter((app) => {
          const stageName = stageMeta.get(app.currentStage ?? -1)?.nameLower ?? "";
          return !isClosedApplication(app.status, stageName);
        });

        const computeJobHealth = (
          appsForRange: typeof scopedApplications,
          activeApps: typeof scopedApplications,
        ) => {
          const jobsNeedingAttention = activeJobsInScope.map((job) => {
            const jobApplications = activeApps.filter((app) => app.jobId === job.id);
            const rangeApplications = appsForRange.filter((app) => app.jobId === job.id);
            const activeCount = jobApplications.length;
            const staleCount = jobApplications.filter((app) => {
              const referenceTime = app.stageChangedAt ?? app.appliedAt;
              const waitDays =
                (Date.now() - new Date(referenceTime).getTime()) / (1000 * 60 * 60 * 24);
              return waitDays >= 5;
            }).length;

            let status: "green" | "amber" | "red" = "green";
            const reasons: string[] = [];

            if (activeCount === 0) {
              status = "red";
              reasons.push("No active candidates left");
            } else if (activeCount < 3) {
              status = "amber";
              reasons.push(`Only ${activeCount} active candidate${activeCount === 1 ? "" : "s"} left`);
            }

            if (staleCount >= 3) {
              status = "red";
              reasons.push(`${staleCount} candidates stalled in stage`);
            } else if (staleCount > 0 && status === "green") {
              status = "amber";
              reasons.push(`${staleCount} candidate${staleCount === 1 ? "" : "s"} need movement`);
            }

            if (rangeApplications.length === 0 && status !== "red") {
              status = "amber";
              reasons.push(`No new applicants in last ${rangeDays}d`);
            }

            return {
              jobId: job.id,
              jobTitle: job.title,
              status,
              reason: reasons[0] ?? "Healthy pipeline",
            };
          });

          if (!activeJobsInScope.length) {
            return { jobsNeedingAttention, score: 0 };
          }

          const weight = { green: 95, amber: 68, red: 38 } as const;
          const avg =
            jobsNeedingAttention.reduce((sum, job) => sum + (weight[job.status] ?? 70), 0) /
            jobsNeedingAttention.length;

          return {
            jobsNeedingAttention,
            score: Math.round(avg),
          };
        };

        const currentHealth = computeJobHealth(currentRangeApplications, currentActivePipelineApplications);
        const previousHealth = computeJobHealth(previousRangeApplications, previousActivePipelineApplications);
        const pipelineHealthDelta = roundDelta(currentHealth.score - previousHealth.score);

        const stuckCandidates = sortedStages
          .map((stage) => {
            const stuckApps = currentActivePipelineApplications.filter((app) => {
              if (app.currentStage !== stage.id) return false;
              const referenceTime = app.stageChangedAt ?? app.appliedAt;
              const waitDays =
                (Date.now() - new Date(referenceTime).getTime()) / (1000 * 60 * 60 * 24);
              return waitDays >= 5;
            });
            const count = stuckApps.length;
            const avgDaysStuck =
              count > 0
                ? Math.round(
                    (stuckApps.reduce((sum, app) => {
                      const referenceTime = app.stageChangedAt ?? app.appliedAt;
                      return sum + (Date.now() - new Date(referenceTime).getTime()) / (1000 * 60 * 60 * 24);
                    }, 0) / count) * 10,
                  ) / 10
                : null;
            return count > 0 ? { stage: stage.name, stageId: stage.id, count, avgDaysStuck } : null;
          })
          .filter((value): value is { stage: string; stageId: number; count: number; avgDaysStuck: number | null } => value !== null)
          .sort((a, b) => b.count - a.count)
          .slice(0, 3);

        const stageCounts = sortedStages.map((stage) => ({
          stage,
          count: currentRangeApplications.filter((app) => app.currentStage === stage.id).length,
        }));

        const stageRates = stageCounts
          .map((entry, index) => {
            if (index === 0) return null;
            const previous = stageCounts[index - 1];
            if (!previous || previous.count <= 0) return null;
            return {
              label: `${previous.stage.name} → ${entry.stage.name}`,
              fromStageId: previous.stage.id,
              toStageId: entry.stage.id,
              rate: roundRate(entry.count, previous.count),
            };
          })
          .filter((value): value is { label: string; fromStageId: number; toStageId: number; rate: number } => value !== null);

        const strongestConvertingStage = [...stageRates].sort((a, b) => b.rate - a.rate)[0] ?? null;
        const weakestConvertingStage = [...stageRates].sort((a, b) => a.rate - b.rate)[0] ?? null;
        const weakestStageMeta =
          weakestConvertingStage != null ? stageById.get(weakestConvertingStage.toStageId) ?? null : null;
        const weakestStageCount =
          weakestConvertingStage != null
            ? stageCounts.find((entry) => entry.stage.id === weakestConvertingStage.toStageId)?.count ?? 0
            : 0;
        const mainBlocker = stuckCandidates[0]
          ? {
              description: `${stuckCandidates[0].count} candidate${stuckCandidates[0].count === 1 ? "" : "s"} stuck in ${stuckCandidates[0].stage} for 5+ days`,
              stage: stuckCandidates[0].stage,
              stageId: stuckCandidates[0].stageId,
              count: stuckCandidates[0].count,
              avgDaysStuck: stuckCandidates[0].avgDaysStuck,
            }
          : weakestConvertingStage && weakestStageMeta
            ? {
                description: `${weakestConvertingStage.label} conversion is only ${weakestConvertingStage.rate}%`,
                stage: weakestStageMeta.name,
                stageId: weakestStageMeta.id,
                count: weakestStageCount,
                avgDaysStuck: null,
              }
            : null;
        const quickWin = mainBlocker
          ? {
              action:
                mainBlocker.avgDaysStuck != null
                  ? `Review stuck candidates in ${mainBlocker.stage}`
                  : `Improve progression into ${mainBlocker.stage}`,
              estimatedImpactPoints:
                mainBlocker.avgDaysStuck != null
                  ? Math.min(20, Math.max(8, Math.round(mainBlocker.count * 2.5)))
                  : Math.min(
                      20,
                      Math.max(8, Math.round(35 - (weakestConvertingStage?.rate ?? 0))),
                    ),
              ctaLabel: `Review ${mainBlocker.stage} Candidates`,
              ctaHref: stageQueueHref(selectedJobId, mainBlocker.stageId),
            }
          : null;
        const rateByToStageId = new Map(stageRates.map((rate) => [rate.toStageId, rate]));
        const stageHealth = sortedStages.map((stage) => {
          const stuck = stuckCandidates.find((item) => item.stageId === stage.id);
          const conversion = rateByToStageId.get(stage.id) ?? null;
          const hasBacklog = (stuck?.count ?? 0) > 0;
          const lowConversion = conversion != null && conversion.rate < 40;
          const criticalConversion = conversion != null && conversion.rate < 20;

          let status: "healthy" | "needs_attention" | "critical" = "healthy";
          let issue: string | null = null;

          if ((stuck?.count ?? 0) >= 3 || criticalConversion) {
            status = "critical";
          } else if (hasBacklog || lowConversion) {
            status = "needs_attention";
          }

          if ((stuck?.count ?? 0) >= 3 && criticalConversion) {
            issue = "Low progression and high candidate backlog";
          } else if ((stuck?.count ?? 0) >= 3) {
            issue = "High candidate backlog";
          } else if (criticalConversion) {
            issue = "Low progression from previous stage";
          } else if (hasBacklog && lowConversion) {
            issue = "Needs faster movement and stronger progression";
          } else if (hasBacklog) {
            issue = "Candidates need movement";
          } else if (lowConversion) {
            issue = "Progression is below target";
          }

          return {
            stage: stage.name,
            stageId: stage.id,
            status,
            issue,
          };
        });

        const activeRolesCount = activeJobsInScope.length;
        const rolesByDemand = jobsInScope.map((job) => ({
          jobId: job.id,
          jobTitle: job.title,
          applications: currentRangeApplications.filter((app) => app.jobId === job.id).length,
          activeCandidates: currentActivePipelineApplications.filter((app) => app.jobId === job.id).length,
          deadline: clampDate(job.deadline ?? job.expiresAt ?? null),
        }));

        const highestDemandRole = [...rolesByDemand]
          .sort((a, b) => b.applications - a.applications)[0] ?? null;
        const lowestCandidateVolumeRole = [...rolesByDemand]
          .filter((job) => activeJobsInScope.some((activeJob) => activeJob.id === job.jobId))
          .sort((a, b) => a.activeCandidates - b.activeCandidates)[0] ?? null;
        const closingSoonRole = [...rolesByDemand]
          .filter((job) => job.deadline && job.deadline.getTime() >= todayStart.getTime())
          .sort((a, b) => (a.deadline!.getTime() - b.deadline!.getTime()))[0];

        const todaysCount = currentApplications.filter((app) =>
          isWithinWindow(app.appliedAt, todayStart, todayEnd),
        ).length;
        const lastWeekStart = addDays(new Date(todayStart), -7);
        const lastWeekEnd = addDays(new Date(todayEnd), -7);
        const sameDayLastWeekCount = currentApplications.filter((app) =>
          isWithinWindow(app.appliedAt, lastWeekStart, lastWeekEnd),
        ).length;
        const todaysTrendDelta = percentDelta(todaysCount, sameDayLastWeekCount);
        const topJobToday = jobsInScope
          .map((job) => ({
            jobId: job.id,
            jobTitle: job.title,
            applications: currentApplications.filter((app) =>
              app.jobId === job.id && isWithinWindow(app.appliedAt, todayStart, todayEnd),
            ).length,
          }))
          .sort((a, b) => b.applications - a.applications)[0] ?? null;
        const sevenDayAverage =
          Math.round(
            (currentApplications.filter((app) =>
              isWithinWindow(app.appliedAt, addDays(new Date(todayStart), -6), todayEnd),
            ).length / 7) * 10,
          ) / 10;

        const currentFirstReviewDays = averageFirstReviewDays(currentRangeApplications);
        const previousFirstReviewDays = averageFirstReviewDays(previousRangeApplications);
        const firstReviewDelta =
          currentFirstReviewDays != null && previousFirstReviewDays != null
            ? roundDelta(currentFirstReviewDays - previousFirstReviewDays)
            : null;
        const progressionRate = roundRate(
          currentRangeApplications.filter((app) => app.status !== "submitted" || app.currentStage != null).length,
          currentRangeApplications.length,
        );

        const screeningStage = sortedStages.find((stage) => stage.name.toLowerCase().includes("screen"));
        const interviewStage = sortedStages.find((stage) => stage.name.toLowerCase().includes("interview"));
        const fallbackQuickWinStage = screeningStage ?? sortedStages[0] ?? null;
        const screeningOrder = screeningStage?.order ?? null;
        const interviewOrder = interviewStage?.order ?? null;

        const hasReachedStage = (
          app: (typeof scopedApplications)[number],
          thresholdOrder: number | null,
        ): boolean => {
          if (thresholdOrder == null || app.currentStage == null) return false;
          const stage = stageById.get(app.currentStage);
          if (!stage) return false;
          if (stage.name.toLowerCase().includes("rejected") || app.status === "rejected") return false;
          return (stage.order ?? -1) >= thresholdOrder;
        };

        const currentScreeningCount = currentRangeApplications.filter((app) =>
          hasReachedStage(app, screeningOrder),
        ).length;
        const currentInterviewCount = currentRangeApplications.filter((app) =>
          hasReachedStage(app, interviewOrder),
        ).length;
        const previousScreeningCount = previousRangeApplications.filter((app) =>
          hasReachedStage(app, screeningOrder),
        ).length;
        const previousInterviewCount = previousRangeApplications.filter((app) =>
          hasReachedStage(app, interviewOrder),
        ).length;
        const currentInterviewRate = roundRate(currentInterviewCount, currentScreeningCount);
        const previousInterviewRate = roundRate(previousInterviewCount, previousScreeningCount);
        const screenToInterviewDelta = roundDelta(currentInterviewRate - previousInterviewRate);

        const activeInterviewLoops = currentApplications.filter((app) => {
          const stageName = stageMeta.get(app.currentStage ?? -1)?.nameLower ?? "";
          return !isClosedApplication(app.status, stageName) && stageName.includes("interview");
        }).length;
        const interviewsScheduledToday = currentApplications.filter((app) =>
          isWithinWindow(app.interviewDate, todayStart, todayEnd),
        ).length;

        const pipelineStatus = pipelineStatusForScore(currentHealth.score);
        const firstReviewHours = averageFirstReviewHours(currentRangeApplications);
        const firstReviewStatus: DashboardKpiStatus =
          currentFirstReviewDays == null
            ? "needs_attention"
            : currentFirstReviewDays <= 1
              ? "healthy"
              : currentFirstReviewDays <= 3
                ? "needs_attention"
                : "at_risk";
        const screenToInterviewStatus: DashboardKpiStatus =
          currentInterviewRate >= 30 ? "healthy" : currentInterviewRate >= 15 ? "needs_attention" : "at_risk";
        const resolvedQuickWin =
          quickWin ??
          (fallbackQuickWinStage
            ? {
                action: `Review candidates in ${fallbackQuickWinStage.name}`,
                estimatedImpactPoints: 8,
                ctaLabel: `Review ${fallbackQuickWinStage.name} Candidates`,
                ctaHref: stageQueueHref(selectedJobId, fallbackQuickWinStage.id),
              }
            : null);

        res.json({
          generatedAt: new Date().toISOString(),
          range: rangePreset,
          jobId: selectedJobId,
          scope: selectedJobId == null ? "all" : "job",
          comparisonLabel: `vs previous ${rangeDays} days`,
          cards: {
            pipelineHealth: {
              id: "pipelineHealth",
              label: "Pipeline Health",
              status: pipelineStatus,
              value: currentHealth.score,
              displayValue: `${currentHealth.score}%`,
              trendDelta: pipelineHealthDelta,
              trendDirection: deltaDirection(pipelineHealthDelta),
              comparisonLabel: `vs previous ${rangeDays} days`,
              contextLine: pipelineContextForScore(currentHealth.score),
              insights: {
                stuckCandidates,
                mainBlocker,
                quickWin: resolvedQuickWin,
                stageHealth,
                strongestConvertingStage,
                weakestConvertingStage,
              },
            },
            activeRoles: {
              id: "activeRoles",
              label: "Active Roles",
              status: "healthy" as DashboardKpiStatus,
              value: activeRolesCount,
              displayValue: String(activeRolesCount),
              trendDelta: null,
              trendDirection: "flat" as DashboardTrendDirection,
              comparisonLabel: null,
              contextLine: selectedJobId == null ? "Open positions" : "Selected role",
              insights: {
                highestDemandRole,
                lowestCandidateVolumeRole,
                closingSoonRole: closingSoonRole
                  ? {
                      jobId: closingSoonRole.jobId,
                      jobTitle: closingSoonRole.jobTitle,
                      daysToClose: Math.max(
                        0,
                        Math.ceil((closingSoonRole.deadline!.getTime() - todayStart.getTime()) / (1000 * 60 * 60 * 24)),
                      ),
                    }
                  : null,
              },
            },
            todaysApplications: {
              id: "todaysApplications",
              label: "Today's Applications",
              status: todaysCount >= Math.max(1, sevenDayAverage) ? "healthy" : "needs_attention",
              value: todaysCount,
              displayValue: String(todaysCount),
              trendDelta: todaysTrendDelta,
              trendDirection: deltaDirection(todaysTrendDelta),
              comparisonLabel: "vs last week",
              contextLine:
                todaysTrendDelta == null
                  ? "Today pulse"
                  : `${todaysTrendDelta >= 0 ? "↑" : "↓"} ${Math.abs(todaysTrendDelta)}% vs last week`,
              insights: {
                newApplicationsToday: todaysCount,
                topJobToday,
                sevenDayAverage,
              },
            },
            firstReviewTime: {
              id: "firstReviewTime",
              label: "First Review Time",
              status: firstReviewStatus,
              value: firstReviewHours,
              displayValue: formatDaysDisplay(currentFirstReviewDays),
              unit: "hours",
              trendDelta: firstReviewDelta,
              trendDirection: deltaDirection(firstReviewDelta, true),
              comparisonLabel: `vs previous ${rangeDays} days`,
              contextLine: "Avg response time",
              insights: {
                benchmark: "< 24 hours is healthy",
                progressionRate,
                comparisonDelta: firstReviewDelta,
              },
            },
            screenToInterview: {
              id: "screenToInterview",
              label: "Screen → Interview",
              status: screenToInterviewStatus,
              value: currentInterviewRate,
              displayValue: `${currentInterviewRate}%`,
              trendDelta: screenToInterviewDelta,
              trendDirection: deltaDirection(screenToInterviewDelta),
              comparisonLabel: `vs previous ${rangeDays} days`,
              contextLine: "Conversion",
              insights: {
                activeInterviewLoops,
                interviewsScheduledToday,
                comparisonDelta: screenToInterviewDelta,
              },
            },
          },
        });
        return;
      } catch (error) {
        next(error);
      }
    },
  );

  app.get(
    "/api/recruiter-dashboard/actions",
    requireRole(["recruiter", "super_admin"]),
    requireSeat({ allowNoOrg: true }),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const user = req.user!;
        const rangePreset = resolveRangePreset(req.query.range);
        const rangeDays = RANGE_PRESETS[rangePreset];
        const rangeStart = addDays(new Date(), -rangeDays);
        const selectedJobId = parseJobIdParam(req.query.jobId);
        const { orgResult, jobs, applications, stages } = await getRecruiterDashboardContext(user);
        const jobsInScope = jobs.filter((job) => selectedJobId == null || job.id === selectedJobId);

        const jobMeta = new Map(
          jobsInScope.map((job) => [
            job.id,
            {
              title: job.title,
              isActive: job.isActive,
              hiringManagerAssigned: Boolean(job.hiringManager),
              clientAssigned: Boolean(job.clientName),
            },
          ]),
        );

        const stageMeta = new Map(
          stages.map((stage) => [
            stage.id,
            {
              id: stage.id,
              name: stage.name,
              nameLower: stage.name.toLowerCase(),
              order: stage.order,
            },
          ]),
        );

        const activeJobIds = new Set(
          jobsInScope.filter((job) => job.isActive).map((job) => job.id),
        );
        const recruiterScopedApplications = applications.filter((app) => activeJobIds.has(app.jobId));

        const clientFeedbackCounts: Record<number, number> = {};
        const clientFeedbackAppIds = recruiterScopedApplications
          .filter((app) => jobMeta.get(app.jobId)?.clientAssigned)
          .map((app) => app.id);

        if (clientFeedbackAppIds.length > 0) {
          const feedbackRows = await db
            .select({
              applicationId: clientFeedback.applicationId,
              count: sql<number>`count(*)::int`,
            })
            .from(clientFeedback)
            .where(inArray(clientFeedback.applicationId, clientFeedbackAppIds))
            .groupBy(clientFeedback.applicationId);

          for (const row of feedbackRows) {
            clientFeedbackCounts[row.applicationId] = row.count;
          }
        }

        const applicationListHref =
          selectedJobId == null ? "/applications" : `/jobs/${selectedJobId}/applications`;
        const sourcingListHref =
          selectedJobId == null ? "/my-jobs" : `/jobs/${selectedJobId}/sourcing`;

        const candidatesToReview = recruiterScopedApplications
          .filter((app) => {
            const currentStage = app.currentStage ? stageMeta.get(app.currentStage) : undefined;
            const isAppliedStage =
              currentStage?.nameLower === "applied" || app.currentStage == null;
            if (isClosedApplication(app.status, currentStage?.nameLower)) return false;
            if (!isWithinWindow(app.appliedAt, rangeStart, new Date())) return false;
            return app.status === "submitted" || (!app.lastViewedAt && isAppliedStage);
          })
          .sort((a, b) => {
            const waitDelta =
              (daysBetween(b.lastViewedAt ?? b.appliedAt) ?? 0) -
              (daysBetween(a.lastViewedAt ?? a.appliedAt) ?? 0);
            if (waitDelta !== 0) return waitDelta;
            const fitDelta = (b.aiFitScore ?? -1) - (a.aiFitScore ?? -1);
            if (fitDelta !== 0) return fitDelta;
            return new Date(a.appliedAt).getTime() - new Date(b.appliedAt).getTime();
          });

        const jobsLowOnPipeline = jobsInScope
          .filter((job) => job.isActive)
          .map((job) => {
            const activeCount = recruiterScopedApplications.filter((app) => {
              if (app.jobId !== job.id) return false;
              const stageName = stageMeta.get(app.currentStage ?? -1)?.nameLower ?? "";
              return !isClosedApplication(app.status, stageName);
            }).length;
            const jobAgeDays = daysBetween(job.createdAt) ?? 0;
            return { job, activeCount, jobAgeDays };
          })
          .filter(({ activeCount, jobAgeDays }) =>
            activeCount < LOW_PIPELINE_THRESHOLD && (jobAgeDays >= LOW_PIPELINE_JOB_AGE_DAYS || activeCount === 0),
          )
          .sort((a, b) => {
            if (a.activeCount !== b.activeCount) return a.activeCount - b.activeCount;
            return b.jobAgeDays - a.jobAgeDays;
          });

        const feedbackPending = recruiterScopedApplications
          .filter((app) => {
            const meta = jobMeta.get(app.jobId);
            if (!meta) return false;
            if (!meta.hiringManagerAssigned && !meta.clientAssigned) return false;

            const stage = app.currentStage ? stageMeta.get(app.currentStage) : undefined;
            const stageName = stage?.nameLower ?? "";
            if (isClosedApplication(app.status, stageName)) return false;
            const isDecisionStage =
              app.status === "shortlisted" ||
              stageName.includes("interview") ||
              stageName.includes("offer") ||
              stageName.includes("review") ||
              stageName.includes("final");
            if (!isDecisionStage) return false;

            const hmPending = meta.hiringManagerAssigned && (app.feedbackCount ?? 0) === 0;
            const clientPending = meta.clientAssigned && (clientFeedbackCounts[app.id] ?? 0) === 0;
            const anchor = clampDate(app.stageChangedAt ?? app.appliedAt);
            if (!anchor || anchor < rangeStart) return false;
            const waitDays = daysBetween(anchor) ?? 0;
            return (hmPending || clientPending) && waitDays >= FEEDBACK_WAIT_DAYS;
          })
          .sort((a, b) => {
            const aDays = daysBetween(a.stageChangedAt ?? a.appliedAt) ?? 0;
            const bDays = daysBetween(b.stageChangedAt ?? b.appliedAt) ?? 0;
            return bDays - aDays;
          });

        const finalStageCandidates = recruiterScopedApplications
          .filter((app) => {
            const stage = app.currentStage ? stageMeta.get(app.currentStage) : undefined;
            const stageName = stage?.nameLower ?? "";
            if (isClosedApplication(app.status, stageName)) return false;
            const interviewDone =
              Boolean(app.interviewDate) &&
              app.interviewDate !== null &&
              new Date(app.interviewDate).getTime() <= Date.now() &&
              stageName.includes("interview");
            const anchor = clampDate(app.stageChangedAt ?? app.interviewDate ?? app.updatedAt ?? app.appliedAt);
            if (!anchor || anchor < rangeStart) return false;
            const waitDays = daysBetween(anchor) ?? 0;
            return (
              stageName.includes("offer") ||
              stageName.includes("final") ||
              interviewDone ||
              (stageName.includes("interview") && waitDays >= FINAL_STAGE_WAIT_DAYS)
            );
          })
          .sort((a, b) => {
            const aDays = daysBetween(a.stageChangedAt ?? a.interviewDate ?? a.updatedAt ?? a.appliedAt) ?? 0;
            const bDays = daysBetween(b.stageChangedAt ?? b.interviewDate ?? b.updatedAt ?? b.appliedAt) ?? 0;
            return bDays - aDays;
          });

        const sectionsById: Record<DashboardActionSectionId, DashboardActionSection> = {
          candidatesToReview: {
            id: "candidatesToReview",
            title: "Candidates to Review",
            description: "Fresh applicants and unreviewed candidates on active jobs.",
            count: candidatesToReview.length,
            emptyMessage: "No candidates waiting for first review.",
            viewAllHref: selectedJobId == null ? "/applications?status=submitted" : applicationListHref,
            items: candidatesToReview.slice(0, MAX_ITEMS_PER_SECTION).map((app) => {
              const ageDays = daysBetween(app.appliedAt) ?? 0;
              return {
                id: `review-${app.id}`,
                type: "candidate_review",
                title: `Review ${app.name}`,
                subtitle: `${app.job.title} · Waiting ${ageDays}d`,
                urgency: ageDays >= REVIEW_WAIT_DAYS ? "high" : "medium",
                ctaLabel: "Open Candidate",
                ctaHref: applicationHref(app.jobId, app.id, app.currentStage),
                jobId: app.jobId,
                applicationId: app.id,
              };
            }),
          },
          jobsLowOnPipeline: {
            id: "jobsLowOnPipeline",
            title: "Jobs Low on Pipeline",
            description: "Active roles that need more candidate depth.",
            count: jobsLowOnPipeline.length,
            emptyMessage: "No active jobs are short on pipeline right now.",
            viewAllHref: sourcingListHref,
            items: jobsLowOnPipeline.slice(0, MAX_ITEMS_PER_SECTION).map(({ job, activeCount, jobAgeDays }) => ({
              id: `pipeline-${job.id}`,
              type: "job_low_pipeline",
              title: job.title,
              subtitle: `${activeCount} active candidate${activeCount === 1 ? "" : "s"} · Live for ${jobAgeDays}d`,
              urgency: activeCount === 0 ? "high" : "medium",
              ctaLabel: "Open Sourcing",
              ctaHref: `/jobs/${job.id}/sourcing`,
              jobId: job.id,
              ...(activeCount <= 1 ? { badge: "At risk" } : { badge: "Needs depth" }),
            })),
          },
          feedbackPending: {
            id: "feedbackPending",
            title: "Feedback Pending",
            description: "Hiring manager or client decisions blocking progress.",
            count: feedbackPending.length,
            emptyMessage: "No hiring manager or client feedback is pending.",
            viewAllHref: applicationListHref,
            items: feedbackPending.slice(0, MAX_ITEMS_PER_SECTION).map((app) => {
              const meta = jobMeta.get(app.jobId);
              const hmPending = meta?.hiringManagerAssigned && (app.feedbackCount ?? 0) === 0;
              const clientPending = meta?.clientAssigned && (clientFeedbackCounts[app.id] ?? 0) === 0;
              const owners = [hmPending ? "HM" : null, clientPending ? "Client" : null].filter(Boolean).join(" + ");
              const waitDays = daysBetween(app.stageChangedAt ?? app.appliedAt) ?? 0;
              return {
                id: `feedback-${app.id}`,
                type: "feedback_pending",
                title: `Chase feedback for ${app.name}`,
                subtitle: `${app.job.title} · ${owners || "Decision"} waiting ${waitDays}d`,
                urgency: waitDays >= 5 ? "high" : "medium",
                ctaLabel: "Open Candidate",
                ctaHref: applicationHref(app.jobId, app.id, app.currentStage),
                jobId: app.jobId,
                applicationId: app.id,
                ...(owners ? { badge: owners } : {}),
              };
            }),
          },
          finalStageCandidates: {
            id: "finalStageCandidates",
            title: "Final Stage Candidates",
            description: "Candidates near close: final interviews done, offers out, or ready for decision.",
            count: finalStageCandidates.length,
            emptyMessage: "No candidates are in the final stretch right now.",
            viewAllHref: applicationListHref,
            items: finalStageCandidates.map((app) => {
              const stage = app.currentStage ? stageMeta.get(app.currentStage) : undefined;
              const stageLabel = stage?.name ?? "Final stage";
              const waitDays = daysBetween(app.stageChangedAt ?? app.interviewDate ?? app.updatedAt ?? app.appliedAt) ?? 0;
              const interviewCompleted = app.interviewDate
                ? new Date(app.interviewDate).getTime() <= Date.now()
                : false;
              return {
                id: `final-${app.id}`,
                type: "final_stage_candidate",
                title: `${app.name} · ${app.job.title}`,
                subtitle: interviewCompleted
                  ? `${stageLabel} · Interview completed · Waiting ${waitDays}d`
                  : `${stageLabel} · Waiting ${waitDays}d`,
                urgency: stage?.nameLower.includes("offer") || waitDays >= FINAL_STAGE_WAIT_DAYS ? "high" : "medium",
                ctaLabel: "Open Candidate",
                ctaHref: applicationHref(app.jobId, app.id, app.currentStage),
                jobId: app.jobId,
                applicationId: app.id,
                badge: stageLabel,
              };
            }),
          },
        };

        res.json({
          generatedAt: new Date().toISOString(),
          viewer: {
            role: user.role,
            organizationId: orgResult?.organization.id ?? null,
            organizationRole: orgResult?.membership.role ?? null,
            dashboardScope: "recruiter",
          },
          range: rangePreset,
          jobId: selectedJobId,
          sections: sectionOrder.map((id) => sectionsById[id]),
        });
        return;
      } catch (error) {
        next(error);
      }
    },
  );

  app.get(
    "/api/recruiter-dashboard/interview-stage-details",
    requireRole(["recruiter", "super_admin"]),
    requireSeat({ allowNoOrg: true }),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const user = req.user!;
        const rangePreset = resolveRangePreset(req.query.range);
        const rangeDays = RANGE_PRESETS[rangePreset];
        const parsedJobId =
          typeof req.query.jobId === "string" && req.query.jobId !== "all"
            ? Number(req.query.jobId)
            : null;
        const jobId = parsedJobId && Number.isFinite(parsedJobId) && parsedJobId > 0 ? parsedJobId : null;

        const { orgResult, jobs, applications, stages } = await getRecruiterDashboardContext(user);

        const jobsInScope = jobs.filter((job) => {
          if (jobId != null) return job.id === jobId;
          return job.isActive;
        });
        const jobIdsInScope = new Set(jobsInScope.map((job) => job.id));
        const scopedApplications = applications.filter((app) => jobIdsInScope.has(app.jobId));

        const stageMeta = new Map(
          stages.map((stage) => [
            stage.id,
            {
              name: stage.name,
              nameLower: stage.name.toLowerCase(),
              order: stage.order,
            },
          ]),
        );
        const sortedStages = [...stages].sort((a, b) => (a.order - b.order) || (a.id - b.id));
        const screeningStage = sortedStages.find((stage) => stage.name.toLowerCase().includes("screen"));
        const interviewStage = sortedStages.find((stage) => stage.name.toLowerCase().includes("interview"));
        const screeningOrder = screeningStage?.order ?? null;
        const interviewOrder = interviewStage?.order ?? null;

        const now = new Date();
        const currentEnd = now;
        const currentStart = new Date(now);
        currentStart.setDate(currentStart.getDate() - rangeDays);
        const previousEnd = new Date(currentStart.getTime() - 1);
        const previousStart = new Date(currentStart);
        previousStart.setDate(previousStart.getDate() - rangeDays);

        const dayStart = new Date(now);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(now);
        dayEnd.setHours(23, 59, 59, 999);

        const activeInterviewApplications = scopedApplications.filter((app) => {
          const stage = app.currentStage ? stageMeta.get(app.currentStage) : undefined;
          const stageName = stage?.nameLower ?? "";
          if (isClosedApplication(app.status, stageName)) return false;
          return stageName.includes("interview");
        });

        const avgTimeInStageDays =
          activeInterviewApplications.length > 0
            ? Math.round(
                (activeInterviewApplications.reduce((sum, app) => {
                  const anchor =
                    daysBetween(app.stageChangedAt ?? app.interviewDate ?? app.updatedAt ?? app.appliedAt) ?? 0;
                  return sum + anchor;
                }, 0) /
                  activeInterviewApplications.length) *
                  10,
              ) / 10
            : null;

        const interviewsScheduledToday = scopedApplications.filter((app) =>
          isWithinWindow(app.interviewDate, dayStart, dayEnd),
        ).length;

        const hasReachedStage = (
          app: (typeof scopedApplications)[number],
          thresholdOrder: number | null,
        ): boolean => {
          if (thresholdOrder == null || app.currentStage == null) return false;
          const stage = stageMeta.get(app.currentStage);
          if (!stage) return false;
          if (stage.nameLower.includes("rejected") || app.status === "rejected") return false;
          return (stage.order ?? -1) >= thresholdOrder;
        };

        const currentPeriodApplications = scopedApplications.filter((app) =>
          isWithinWindow(app.appliedAt, currentStart, currentEnd),
        );
        const previousPeriodApplications = scopedApplications.filter((app) =>
          isWithinWindow(app.appliedAt, previousStart, previousEnd),
        );

        const currentScreeningCount = currentPeriodApplications.filter((app) =>
          hasReachedStage(app, screeningOrder),
        ).length;
        const currentInterviewCount = currentPeriodApplications.filter((app) =>
          hasReachedStage(app, interviewOrder),
        ).length;
        const previousScreeningCount = previousPeriodApplications.filter((app) =>
          hasReachedStage(app, screeningOrder),
        ).length;
        const previousInterviewCount = previousPeriodApplications.filter((app) =>
          hasReachedStage(app, interviewOrder),
        ).length;

        const currentRate = roundRate(currentInterviewCount, currentScreeningCount);
        const previousRate = roundRate(previousInterviewCount, previousScreeningCount);
        const delta = Math.round((currentRate - previousRate) * 10) / 10;

        res.json({
          generatedAt: new Date().toISOString(),
          viewer: {
            role: user.role,
            organizationId: orgResult?.organization.id ?? null,
            organizationRole: orgResult?.membership.role ?? null,
            dashboardScope: "recruiter",
          },
          range: rangePreset,
          periodLabel: `Last ${rangeDays} days`,
          comparisonLabel: `vs previous ${rangeDays} days`,
          jobId,
          activeInterviewLoops: activeInterviewApplications.length,
          avgTimeInStageDays,
          interviewsScheduledToday,
          screeningToInterview: {
            currentRate,
            previousRate,
            delta,
            direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
            screeningCount: currentScreeningCount,
            interviewCount: currentInterviewCount,
          },
        });
        return;
      } catch (error) {
        next(error);
      }
    },
  );

  app.get(
    "/api/recruiter-dashboard/todays-interviews",
    requireRole(["recruiter", "super_admin"]),
    requireSeat({ allowNoOrg: true }),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const user = req.user!;
        const jobId = parseJobIdParam(req.query.jobId);
        const selectedInterviewDate = resolveInterviewDate(req.query.interviewDate);

        const { orgResult, jobs, applications, stages } = await getRecruiterDashboardContext(user);
        const jobIdsInScope = new Set(
          jobs
            .filter((job) => (jobId != null ? job.id === jobId : true))
            .map((job) => job.id),
        );
        const stageMeta = new Map(
          stages.map((stage) => [
            stage.id,
            {
              name: stage.name,
              nameLower: stage.name.toLowerCase(),
            },
          ]),
        );

        const now = new Date();
        const dayStart = startOfDay(selectedInterviewDate);
        const dayEnd = endOfDay(selectedInterviewDate);
        const weekStart = startOfWeekMonday(selectedInterviewDate);
        const weekDays = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
        const weekCounts = new Map<string, number>(
          weekDays.map((date) => [startOfDay(date).toISOString().slice(0, 10), 0]),
        );

        const scopedApplications = applications
          .filter((app) => jobIdsInScope.has(app.jobId))
          .filter((app) => {
            const stage = app.currentStage ? stageMeta.get(app.currentStage) : undefined;
            const stageName = stage?.nameLower ?? "";
            return !isClosedApplication(app.status, stageName);
          });

        scopedApplications.forEach((app) => {
          const interviewDate = clampDate(app.interviewDate);
          if (!interviewDate) return;
          const key = startOfDay(interviewDate).toISOString().slice(0, 10);
          if (weekCounts.has(key)) {
            weekCounts.set(key, (weekCounts.get(key) ?? 0) + 1);
          }
        });

        const items = scopedApplications
          .filter((app) => isWithinWindow(app.interviewDate, dayStart, dayEnd))
          .map((app) => {
            const stage = app.currentStage ? stageMeta.get(app.currentStage) : undefined;
            const stageLabel = stage?.name ?? "Interview";
            const timeLabel = formatInterviewTime(app.interviewTime);
            const interviewDate = clampDate(app.interviewDate);
            return {
              id: `interview-${app.id}`,
              applicationId: app.id,
              jobId: app.jobId,
              candidateName: app.name,
              jobTitle: app.job.title,
              interviewDate: interviewDate?.toISOString() ?? null,
              interviewTime: timeLabel,
              stageLabel,
              aiFitLabel: app.aiFitLabel ?? null,
              status: resolveInterviewStatus(interviewDate, timeLabel, now),
              ctaLabel: "Open Candidate",
              ctaHref: applicationHref(app.jobId, app.id, app.currentStage),
            };
          })
          .sort((a, b) => {
            const aTime = a.interviewTime ?? "99:99";
            const bTime = b.interviewTime ?? "99:99";
            if (aTime !== bTime) return aTime.localeCompare(bTime);
            return a.candidateName.localeCompare(b.candidateName);
          });

        res.json({
          generatedAt: new Date().toISOString(),
          viewer: {
            role: user.role,
            organizationId: orgResult?.organization.id ?? null,
            organizationRole: orgResult?.membership.role ?? null,
            dashboardScope: "recruiter",
          },
          jobId,
          interviewDate: dayStart.toISOString().slice(0, 10),
          dateLabel: dayStart.toDateString() === startOfDay(now).toDateString() ? "Today" : dayStart.toLocaleDateString(),
          count: items.length,
          week: weekDays.map((date) => {
            const isoDate = startOfDay(date).toISOString().slice(0, 10);
            return {
              date: isoDate,
              dayLabel: date.toLocaleDateString(undefined, { weekday: "short" }),
              count: weekCounts.get(isoDate) ?? 0,
              isSelected: isoDate === dayStart.toISOString().slice(0, 10),
            };
          }),
          items,
        });
        return;
      } catch (error) {
        next(error);
      }
    },
  );
}
