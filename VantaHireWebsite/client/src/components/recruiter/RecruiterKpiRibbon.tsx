import { type ReactNode, useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile";
import { useIsTouchDevice } from "@/hooks/use-touch-device";
import { cn } from "@/lib/utils";
import { ArrowDownRight, ArrowRight, ArrowUpRight, HelpCircle } from "lucide-react";

type KpiStatus = "healthy" | "needs_attention" | "at_risk";
type TrendDirection = "up" | "down" | "flat" | "neutral";

type KpiInsightCard = {
  id: string;
  label: string;
  status: KpiStatus;
  value: number | null;
  displayValue: string | null;
  trendDelta: number | null;
  trendDirection: TrendDirection;
  comparisonLabel: string | null;
  contextLine: string | null;
  unit?: string | null;
  insights: Record<string, unknown> | null;
};

export type RecruiterDashboardKpiResponse = {
  generatedAt: string;
  range: string;
  jobId: number | null;
  scope?: "job" | "all";
  comparisonLabel: string | null;
  cards: {
    pipelineHealth: KpiInsightCard;
    activeRoles: KpiInsightCard;
    todaysApplications: KpiInsightCard;
    firstReviewTime: KpiInsightCard;
    screenToInterview: KpiInsightCard;
  };
};

interface RecruiterKpiRibbonProps {
  data?: RecruiterDashboardKpiResponse | null | undefined;
  isLoading?: boolean;
  className?: string;
}

type DetailLine = {
  label: string;
  value: string;
  className?: string;
  linkLabel?: string;
  linkHref?: string;
};

type PipelineMainBlocker = {
  description?: string;
  stage?: string;
  count?: number;
  avgDaysStuck?: number | null;
} | null;

type PipelineQuickWin = {
  action?: string;
  estimatedImpactPoints?: number;
  ctaLabel?: string;
  ctaHref?: string;
} | null;

type PipelineStageHealthItem = {
  stage?: string;
  status?: string;
  issue?: string | null;
};

type PipelineConversionStage = {
  label?: string;
  rate?: number;
} | null;

const statusMap: Record<KpiStatus, { label: string; badge: string }> = {
  healthy: {
    label: "Healthy",
    badge: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100",
  },
  needs_attention: {
    label: "Needs attention",
    badge: "bg-amber-50 text-amber-700 ring-1 ring-amber-100",
  },
  at_risk: {
    label: "At risk",
    badge: "bg-rose-50 text-rose-700 ring-1 ring-rose-100",
  },
};

const pipelineStatusMap: Record<KpiStatus, { label: string; badge: string }> = {
  healthy: {
    label: "Healthy",
    badge: "bg-[#DCFCE7] text-[#16A34A]",
  },
  needs_attention: {
    label: "Needs Attention",
    badge: "bg-[#FEF3C7] text-[#D97706]",
  },
  at_risk: {
    label: "At Risk",
    badge: "bg-[#FEE2E2] text-[#DC2626]",
  },
};

const tooltipMap: Record<string, string> = {
  pipelineHealth: "AI score measuring how efficiently candidates move through your pipeline",
  activeRoles: "Total number of open job positions currently accepting applications",
  todaysApplications: "New candidate applications received today across all your active jobs",
  firstReviewTime: "Average time taken by you to first respond to a new candidate application",
  screenToInterview: "Percentage of screened candidates who successfully moved from Screening to Interview stage",
};

function fallbackText(value?: string | null) {
  return value && value.trim() ? value : "—";
}

function formatCount(value: unknown) {
  return typeof value === "number" && !Number.isNaN(value) ? String(value) : "—";
}

function formatFixed(value: unknown, digits = 1, suffix = "") {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  return `${value.toFixed(digits)}${suffix}`;
}

function formatPercent(value: unknown, digits = 1) {
  return formatFixed(value, digits, "%");
}

function stageLabelToSentence(label?: string | null) {
  if (!label) return "—";
  return label.replace(/\s*→\s*/g, " to ").replace(/\s*->\s*/g, " to ");
}

function formatTrend(card: KpiInsightCard) {
  if (card.trendDelta == null || Number.isNaN(card.trendDelta)) {
    return {
      icon: ArrowRight,
      className: "text-slate-400",
      text: "No change",
    };
  }

  if (card.trendDirection === "up") {
    return {
      icon: ArrowUpRight,
      className: "text-emerald-600",
      text: `${Math.abs(card.trendDelta).toFixed(1)}%`,
    };
  }

  if (card.trendDirection === "down") {
    return {
      icon: ArrowDownRight,
      className: "text-rose-600",
      text: `${Math.abs(card.trendDelta).toFixed(1)}%`,
    };
  }

  return {
    icon: ArrowRight,
    className: "text-slate-500",
    text: `${Math.abs(card.trendDelta).toFixed(1)}%`,
  };
}

function getPipelineHealthDetailLines(card: KpiInsightCard): DetailLine[] {
  if (!card.insights) return [];

  const insights = card.insights;
  const mainBlocker = (insights.mainBlocker ?? null) as { description?: string } | null;
  const quickWin = (insights.quickWin ?? null) as {
    action?: string;
    estimatedImpactPoints?: number;
    ctaLabel?: string;
    ctaHref?: string;
  } | null;
  const stageHealth = Array.isArray(insights.stageHealth)
    ? (insights.stageHealth as Array<{ stage?: string; status?: string; issue?: string | null }>)
    : [];
  const strongest = (insights.strongestConvertingStage ?? null) as { label?: string; rate?: number } | null;
  const weakest = (insights.weakestConvertingStage ?? null) as { label?: string; rate?: number } | null;

  const lines: DetailLine[] = [];

  if (mainBlocker?.description) {
    lines.push({
      label: "Main blocker",
      value: `⚠️ ${mainBlocker.description}`,
      className: "text-[#DC2626]",
    });
  }

  const criticalStages = stageHealth.filter((item) => item.status === "critical" && item.stage && item.issue);
  if (criticalStages.length > 0) {
    criticalStages.forEach((item) => {
      lines.push({
        label: "Stage issue",
        value: `📉 ${item.stage}: ${item.issue}`,
        className: "text-[#D97706]",
      });
    });
  } else {
    lines.push({
      label: "Stage issue",
      value: "✅ All stages converting normally",
      className: "text-[#16A34A]",
    });
  }

  if (strongest?.label && typeof strongest.rate === "number") {
    lines.push({
      label: "Conversion",
      value: `↑ Strongest: ${stageLabelToSentence(strongest.label)} at ${formatPercent(strongest.rate, 1)}`,
      className: "text-[#16A34A]",
    });
  }

  if (weakest?.label && typeof weakest.rate === "number") {
    lines.push({
      label: "Conversion",
      value: `↓ Weakest: ${stageLabelToSentence(weakest.label)} at ${formatPercent(weakest.rate, 1)}`,
      className: "text-[#DC2626]",
    });
  }

      if (quickWin?.action && typeof quickWin.estimatedImpactPoints === "number") {
        const quickWinLine: DetailLine = {
          label: "Quick win",
          value: `💡 ${quickWin.action} — could improve score by ${quickWin.estimatedImpactPoints} points`,
          className: "text-[#4B8EF0] font-semibold",
        };
        if (quickWin.ctaLabel && quickWin.ctaHref) {
          quickWinLine.linkLabel = quickWin.ctaLabel;
          quickWinLine.linkHref = quickWin.ctaHref;
        }
        lines.push(quickWinLine);
      }

  return lines;
}

function getPipelineHealthInsights(card: KpiInsightCard) {
  const insights = card.insights ?? {};

  const mainBlocker = (insights.mainBlocker ?? null) as PipelineMainBlocker;
  const quickWin = (insights.quickWin ?? null) as PipelineQuickWin;
  const stageHealth = Array.isArray(insights.stageHealth)
    ? (insights.stageHealth as PipelineStageHealthItem[])
    : [];
  const strongest = (insights.strongestConvertingStage ?? null) as PipelineConversionStage;
  const weakest = (insights.weakestConvertingStage ?? null) as PipelineConversionStage;

  return { mainBlocker, quickWin, stageHealth, strongest, weakest };
}

function PipelineStatusDot({ color }: { color: string }) {
  return <span className="mt-[4px] h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />;
}

function PipelineHoverSectionLabel({ children }: { children: string }) {
  return (
    <div
      className="font-mono text-[0.68rem] font-semibold uppercase leading-4"
      style={{ color: "#9CA3AF", letterSpacing: "0.07em" }}
    >
      {children}
    </div>
  );
}

function PipelineHoverTextLine({
  dotColor,
  children,
}: {
  dotColor: string;
  children: ReactNode;
}) {
  return (
    <div
      className="flex items-start gap-2 font-outfit text-sm leading-[1.45]"
      style={{ color: "#464555" }}
    >
      <PipelineStatusDot color={dotColor} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function PipelineHealthDetailSection({ card, expanded = false }: { card: KpiInsightCard; expanded?: boolean }) {
  const { mainBlocker, quickWin, stageHealth, strongest, weakest } = getPipelineHealthInsights(card);
  const criticalStages = stageHealth.filter((item) => item.status === "critical" && item.stage && item.issue);
  const sharedIssue = criticalStages[0]?.issue?.trim() ?? "";
  const criticalStageNames = criticalStages.map((item) => item.stage?.trim()).filter(Boolean) as string[];
  const blockerText =
    mainBlocker?.stage && typeof mainBlocker.count === "number" && typeof mainBlocker.avgDaysStuck === "number"
      ? `${mainBlocker.count} candidate${mainBlocker.count === 1 ? "" : "s"} stuck in ${mainBlocker.stage} for ${mainBlocker.avgDaysStuck}+ days`
      : mainBlocker?.description?.trim() ?? "";

  return (
    <div
      className={cn(
        "overflow-hidden transition-[max-height,opacity,transform,margin] duration-200 ease-out",
        expanded ? "mt-3.5 max-h-[272px] translate-y-0 opacity-100" : "max-h-0 translate-y-1 opacity-0",
      )}
    >
      <div
        className={cn(
          "pipeline-health-hover-scroll rounded-[12px] bg-white p-4",
          expanded ? "overflow-y-auto" : "overflow-y-hidden",
        )}
        style={{
          maxHeight: expanded ? "272px" : undefined,
          scrollbarWidth: expanded ? "thin" : "auto",
          scrollbarColor: expanded ? "transparent transparent" : undefined,
        }}
      >
        <style>
          {`
            .pipeline-health-hover-scroll::-webkit-scrollbar { width: 4px; }
            .pipeline-health-hover-scroll::-webkit-scrollbar-track { background: transparent; }
            .pipeline-health-hover-scroll::-webkit-scrollbar-thumb { background: transparent; border-radius: 999px; }
            .pipeline-health-hover-scroll:hover { scrollbar-color: #B8D5FF transparent; }
            .pipeline-health-hover-scroll:hover::-webkit-scrollbar-thumb { background: #B8D5FF; }
            .pipeline-health-hover-scroll:focus-within { scrollbar-color: #B8D5FF transparent; }
            .pipeline-health-hover-scroll:focus-within::-webkit-scrollbar-thumb { background: #B8D5FF; }
            .pipeline-health-hover-scroll::-webkit-scrollbar-thumb:hover { background: #4B8EF0; }
          `}
        </style>
        <div className={cn(expanded ? "" : "overflow-hidden")}>
          {blockerText ? (
            <section className="m-0">
              <PipelineHoverSectionLabel>MAIN BLOCKER</PipelineHoverSectionLabel>
              <div className="mt-1.5">
                <div
                  className="flex items-start gap-2 font-outfit text-sm leading-[1.45]"
                  style={{ color: "#191C1E" }}
                >
                  <PipelineStatusDot color="#DC2626" />
                  <div className="min-w-0">{blockerText}</div>
                </div>
              </div>
            </section>
          ) : null}

          <section className={blockerText ? "mt-3" : "m-0"}>
            <PipelineHoverSectionLabel>STAGE ISSUES</PipelineHoverSectionLabel>
            <div className="mt-1.5">
              {criticalStageNames.length > 0 && sharedIssue ? (
                <PipelineHoverTextLine dotColor="#DC2626">
                  {criticalStageNames.join(", ")}: {sharedIssue}
                </PipelineHoverTextLine>
              ) : (
                <PipelineHoverTextLine dotColor="#16A34A">
                  <span style={{ color: "#16A34A" }}>All stages converting normally</span>
                </PipelineHoverTextLine>
              )}
            </div>
          </section>

          {(strongest?.label && typeof strongest.rate === "number") || (weakest?.label && typeof weakest.rate === "number") ? (
            <section className="mt-3">
              <PipelineHoverSectionLabel>CONVERSION</PipelineHoverSectionLabel>
              <div className="mt-1.5 space-y-1.5">
                {strongest?.label && typeof strongest.rate === "number" ? (
                  <PipelineHoverTextLine dotColor="#16A34A">
                    Strongest: {stageLabelToSentence(strongest.label)} - {formatPercent(strongest.rate, 1)}
                  </PipelineHoverTextLine>
                ) : null}
                {weakest?.label && typeof weakest.rate === "number" ? (
                  <PipelineHoverTextLine dotColor="#DC2626">
                    Weakest: {stageLabelToSentence(weakest.label)} - {formatPercent(weakest.rate, 1)}
                  </PipelineHoverTextLine>
                ) : null}
              </div>
            </section>
          ) : null}

          {quickWin?.action && typeof quickWin.estimatedImpactPoints === "number" ? (
            <section className="mt-3">
              <PipelineHoverSectionLabel>QUICK WIN</PipelineHoverSectionLabel>
              <div className="mt-1.5">
                <div
                  className="font-outfit text-sm leading-[1.45]"
                  style={{ color: "#464555" }}
                >
                  {quickWin.action} - could improve score by {quickWin.estimatedImpactPoints} points
                </div>
                {quickWin.ctaLabel && quickWin.ctaHref ? (
                  <div className="mt-1.5">
                    <a
                      href={quickWin.ctaHref}
                      className="font-dm text-xs font-semibold hover:underline"
                      style={{ color: "#4B8EF0" }}
                    >
                      {quickWin.ctaLabel}
                    </a>
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function getDetailLines(card: KpiInsightCard): DetailLine[] {
  const insights = card.insights ?? {};

  switch (card.id) {
    case "pipelineHealth":
      return getPipelineHealthDetailLines(card);
    case "activeRoles": {
      const highest = (insights.highestDemandRole ?? null) as { jobTitle?: string; applications?: number } | null;
      const lowest = (insights.lowestCandidateVolumeRole ?? null) as { jobTitle?: string; activeCandidates?: number } | null;
      const closingSoon = (insights.closingSoonRole ?? null) as { jobTitle?: string; daysToClose?: number } | null;
      const hasMeaningfulRoleInsights =
        Boolean(highest?.jobTitle && typeof highest.applications === "number" && highest.applications > 0) ||
        Boolean(lowest?.jobTitle && typeof lowest.activeCandidates === "number" && lowest.activeCandidates > 0) ||
        Boolean(closingSoon?.jobTitle && typeof closingSoon.daysToClose === "number");

      if (!hasMeaningfulRoleInsights) {
        return [
          {
            label: "Role insights",
            value: "Not enough role activity to highlight detailed insights right now",
          },
        ];
      }

      return [
        {
          label: "Highest demand",
          value: highest?.jobTitle ? `${highest.jobTitle} with ${formatCount(highest.applications)} applications` : "—",
        },
        {
          label: "Needs sourcing",
          value: lowest?.jobTitle ? `${lowest.jobTitle} with ${formatCount(lowest.activeCandidates)} active candidates` : "—",
        },
        {
          label: "Closing soon",
          value:
            closingSoon?.jobTitle && typeof closingSoon.daysToClose === "number"
              ? `${closingSoon.jobTitle} closes in ${closingSoon.daysToClose} day${closingSoon.daysToClose === 1 ? "" : "s"}`
              : "—",
        },
      ];
    }
    case "todaysApplications": {
      const topJob = (insights.topJobToday ?? null) as { jobTitle?: string; applications?: number } | null;
      const newApplicationsToday = typeof insights.newApplicationsToday === "number" ? insights.newApplicationsToday : null;
      const topJobApplications = typeof topJob?.applications === "number" ? topJob.applications : null;
      const sevenDayAverage = typeof insights.sevenDayAverage === "number" ? insights.sevenDayAverage : null;

      if ((newApplicationsToday ?? 0) <= 0 && (topJobApplications ?? 0) <= 0) {
        return [
          {
            label: "Activity today",
            value: "No meaningful application activity to highlight today",
          },
        ];
      }

      return [
        {
          label: "Today",
          value:
            typeof newApplicationsToday === "number" && newApplicationsToday > 0
              ? `${newApplicationsToday} new application${newApplicationsToday === 1 ? "" : "s"} today`
              : "—",
        },
        {
          label: "Top role today",
          value:
            topJob?.jobTitle && (topJobApplications ?? 0) > 0
              ? `${topJob.jobTitle} received the most today (${topJobApplications})`
              : "Not enough activity today to identify a standout role",
        },
        {
          label: "7-day average",
          value:
            typeof sevenDayAverage === "number" && sevenDayAverage > 0
              ? `${sevenDayAverage.toFixed(1)} applications per day`
              : "—",
        },
      ];
    }
    case "firstReviewTime": {
      const progressionRate = typeof insights.progressionRate === "number" ? insights.progressionRate : null;
      const hasMeaningfulReviewInsights =
        typeof card.value === "number" || typeof insights.benchmark === "string" || (progressionRate ?? 0) > 0;

      if (!hasMeaningfulReviewInsights) {
        return [
          {
            label: "Review speed",
            value: "Not enough recent review activity to show deeper timing insights",
          },
        ];
      }

      return [
        {
          label: "Current average",
          value:
            typeof card.value === "number"
              ? `${card.value.toFixed(1)} hours to first review`
              : "—",
        },
        {
          label: "Healthy benchmark",
          value: typeof insights.benchmark === "string" ? insights.benchmark : "—",
        },
        {
          label: "Progression rate",
          value:
            typeof progressionRate === "number" && progressionRate > 0
              ? `${progressionRate.toFixed(1)}% candidate progression rate`
              : "—",
        },
      ];
    }
    case "screenToInterview": {
      const activeInterviewLoops = typeof insights.activeInterviewLoops === "number" ? insights.activeInterviewLoops : null;
      const interviewsScheduledToday =
        typeof insights.interviewsScheduledToday === "number" ? insights.interviewsScheduledToday : null;

      if ((card.value ?? 0) <= 0 && (activeInterviewLoops ?? 0) <= 0 && (interviewsScheduledToday ?? 0) <= 0) {
        return [
          {
            label: "Interview flow",
            value: "Not enough interview activity yet to show detailed conversion insights",
          },
        ];
      }

      return [
        {
          label: "Conversion rate",
          value:
            typeof card.value === "number" && card.value > 0
              ? `${card.value.toFixed(1)}% moved from screening to interview`
              : "—",
        },
        {
          label: "Interview loops",
          value:
            typeof activeInterviewLoops === "number" && activeInterviewLoops > 0
              ? `${activeInterviewLoops} candidates are currently in interview loops`
              : "—",
        },
        {
          label: "Scheduled today",
          value:
            typeof interviewsScheduledToday === "number" && interviewsScheduledToday > 0
              ? `${interviewsScheduledToday} interviews are scheduled today`
              : "—",
        },
      ];
    }
    default:
      return [];
  }
}

function DetailSection({ card, expanded = false }: { card: KpiInsightCard; expanded?: boolean }) {
  if (card.id === "pipelineHealth") {
    return <PipelineHealthDetailSection card={card} expanded={expanded} />;
  }

  const lines = getDetailLines(card);

  return (
    <div
      className={cn(
        "overflow-hidden transition-[max-height,opacity,transform,margin,padding] duration-200 ease-out",
        expanded
          ? "mt-3.5 max-h-64 translate-y-0 border-t border-slate-100 pt-3.5 opacity-100"
          : "max-h-0 translate-y-1 pt-0 opacity-0",
      )}
    >
      <div className="space-y-1.5">
        {lines.map((line, index) => (
          <div key={`${card.id}-${index}`} className={cn("flex items-start gap-2 text-sm leading-5 text-slate-600", line.className)}>
            <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-slate-300" />
            <div className="min-w-0">
              <span className="font-medium text-slate-700">{line.label}:</span>{" "}
              <span>{line.value}</span>
              {line.linkLabel && line.linkHref ? (
                <div className="mt-1.5">
                  <a href={line.linkHref} className="text-xs font-medium text-[#4B8EF0] hover:underline">
                    {line.linkLabel}
                  </a>
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function KpiCard({
  card,
  compact = false,
  expanded = false,
  isTouchDevice = false,
  isMobile = false,
  onOpen,
  onClose,
  onToggle,
}: {
  card: KpiInsightCard;
  compact?: boolean;
  expanded?: boolean;
  isTouchDevice?: boolean;
  isMobile?: boolean;
  onOpen: () => void;
  onClose: () => void;
  onToggle: () => void;
}) {
  const status = card.id === "pipelineHealth"
    ? pipelineStatusMap[card.status] ?? pipelineStatusMap.needs_attention
    : statusMap[card.status] ?? statusMap.needs_attention;
  const trend = formatTrend(card);
  const TrendIcon = trend.icon;
  const showStatus = !(card.id === "pipelineHealth" && fallbackText(card.displayValue) === "—");
  const showTrend = !(card.id === "pipelineHealth" && (card.trendDelta == null || Number.isNaN(card.trendDelta)));
  const trendText =
    card.id === "pipelineHealth"
      ? `${card.trendDirection === "down" ? "↓" : card.trendDirection === "up" ? "↑" : "→"} ${Math.abs(card.trendDelta ?? 0).toFixed(1)}% ${fallbackText(card.comparisonLabel)}`
      : trend.text;

  return (
    <Card
      className={cn(
        "rounded-xl border-0 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.05)] transition-[transform,box-shadow] duration-200 ease-out",
        expanded
          ? "shadow-[0_4px_12px_rgba(15,23,42,0.10)] -translate-y-0.5"
          : "hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(15,23,42,0.10)]",
      )}
      onMouseEnter={isTouchDevice ? undefined : onOpen}
      onMouseLeave={isTouchDevice ? undefined : onClose}
      onFocus={onOpen}
      onBlur={onClose}
      onClick={isTouchDevice ? onToggle : undefined}
    >
      <div
        className={cn(
          "flex flex-col p-4 md:p-[14px] xl:p-4",
          compact ? "min-h-[112px] md:min-h-[112px]" : "min-h-[136px] md:min-h-[136px]",
          isMobile && "min-h-0 h-auto",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <div className="kpi-label text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-400">
              {card.label}
            </div>
            {showStatus ? (
              <span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-semibold", status.badge)}>
                {status.label}
              </span>
            ) : null}
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="rounded-full text-slate-400 transition-colors hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-200"
                aria-label={`About ${card.label}`}
              >
                <HelpCircle className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs leading-relaxed">
              {tooltipMap[card.id] ?? card.label}
            </TooltipContent>
          </Tooltip>
        </div>

        <div className="mt-3.5 flex items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="kpi-value text-[24px] font-bold leading-none tracking-[-0.04em] text-slate-900 md:text-[28px] xl:text-[29px]">
              {fallbackText(card.displayValue)}
            </div>
            <div className="mt-1.5 text-[13px] font-medium text-slate-500">{fallbackText(card.contextLine)}</div>
          </div>
          {showTrend ? (
            <div className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", trend.className)}>
              <TrendIcon className="h-3.5 w-3.5" />
              <span>{trendText}</span>
            </div>
          ) : null}
        </div>

        <DetailSection card={card} expanded={expanded} />
      </div>
    </Card>
  );
}

function LoadingCard({ compact = false }: { compact?: boolean }) {
  return (
    <Card className="rounded-xl border-0 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
      <div className={cn("flex animate-pulse flex-col p-5", compact ? "min-h-[130px]" : "min-h-[160px]")}>
        <div className="h-3 w-24 rounded-full bg-slate-200" />
        <div className="mt-3 h-6 w-24 rounded-full bg-slate-100" />
        <div className="mt-8 h-9 w-28 rounded-md bg-slate-200" />
        <div className="mt-3 h-4 w-32 rounded-md bg-slate-100" />
      </div>
    </Card>
  );
}

export function RecruiterKpiRibbon({ data, isLoading, className }: RecruiterKpiRibbonProps) {
  const isMobile = useIsMobile();
  const isTouchDevice = useIsTouchDevice();
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const closeTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) {
        window.clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  const orderedCards = data
    ? [
        data.cards.pipelineHealth,
        data.cards.activeRoles,
        data.cards.todaysApplications,
        data.cards.firstReviewTime,
        data.cards.screenToInterview,
      ]
    : [];

  const topCards = orderedCards.slice(0, 3);
  const bottomCards = orderedCards.slice(3, 5);

  if (isLoading && !data) {
    return (
      <div className={cn("space-y-[14px]", className)}>
        <div className="grid gap-[14px] md:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <LoadingCard key={index} />
          ))}
        </div>
        <div className="flex justify-center">
          <div className="grid w-full gap-[14px] md:w-[calc(66.666%-9.5px)] md:grid-cols-2">
            {[0, 1].map((index) => (
              <LoadingCard key={index} compact />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const handleOpen = (cardId: string) => {
    if (closeTimeoutRef.current) {
      window.clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    setActiveCardId(cardId);
  };

  const handleClose = (cardId: string) => {
    if (isTouchDevice) return;
    if (closeTimeoutRef.current) {
      window.clearTimeout(closeTimeoutRef.current);
    }
    closeTimeoutRef.current = window.setTimeout(() => {
      setActiveCardId((current) => (current === cardId ? null : current));
    }, 80);
  };

  const handleToggle = (cardId: string) => {
    setActiveCardId((current) => (current === cardId ? null : cardId));
  };

  return (
    <TooltipProvider delayDuration={120}>
      <div className={cn("space-y-[14px]", className)}>
        <div className="grid grid-cols-1 items-start gap-[14px] md:grid-cols-3">
          {topCards.map((card) => (
            <div key={card.id} className="min-w-0">
              <KpiCard
                card={card}
                expanded={activeCardId === card.id}
                isMobile={isMobile}
                isTouchDevice={isTouchDevice}
                onOpen={() => handleOpen(card.id)}
                onClose={() => handleClose(card.id)}
                onToggle={() => handleToggle(card.id)}
              />
            </div>
          ))}
        </div>
        <div className="flex justify-center">
          <div className="grid w-full grid-cols-1 items-start gap-[14px] md:w-[calc(66.666%-9.5px)] md:grid-cols-2">
            {bottomCards.map((card) => (
              <div key={card.id} className="min-w-0">
                <KpiCard
                  card={card}
                  compact
                  expanded={activeCardId === card.id}
                  isMobile={isMobile}
                  isTouchDevice={isTouchDevice}
                  onOpen={() => handleOpen(card.id)}
                  onClose={() => handleClose(card.id)}
                  onToggle={() => handleToggle(card.id)}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
