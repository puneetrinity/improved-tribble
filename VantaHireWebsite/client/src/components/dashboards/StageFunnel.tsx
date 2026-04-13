import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useIsMobile } from "@/hooks/use-mobile";
import { useIsTouchDevice } from "@/hooks/use-touch-device";
import { DASHBOARD_EYEBROW, DASHBOARD_PANEL, DASHBOARD_PANEL_SOFT, DASHBOARD_TITLE } from "@/lib/dashboard-theme";
import { recruiterDashboardCopy } from "@/lib/internal-copy";
import { cn } from "@/lib/utils";

type StageSegment = {
  name: string;
  count: number;
  percentage?: number;
  stageId?: number;
};

type InterviewStageDetails = {
  activeInterviewLoops: number;
  avgTimeInStageDays: number | null;
  interviewsScheduledToday: number | null;
  screeningToInterview: {
    currentRate: number | null;
    delta: number | null;
    direction: "up" | "down" | "flat" | "neutral";
    screeningCount?: number | null;
    interviewCount?: number | null;
  };
  periodLabel: string | null;
  comparisonLabel: string | null;
};

type DashboardApplication = {
  currentStage?: number | null;
  status: string;
  appliedAt: string | Date;
  stageChangedAt?: string | Date | null;
  interviewDate?: string | Date | null;
  updatedAt?: string | Date | null;
};

type DashboardPipelineStage = {
  id: number;
  name: string;
  order: number;
};

interface StageFunnelProps {
  title: string;
  description?: string;
  data: StageSegment[];
  isLoading?: boolean;
  onStageClick?: (stage: StageSegment) => void;
  rangePreset?: string;
  selectedJobId?: number | "all";
  applications?: DashboardApplication[];
  pipelineStages?: DashboardPipelineStage[];
}

const STAGE_COLORS = ["#C4B5FD", "#A78BFA", "#8B5CF6", "#7C3AED", "#4D41DF"];
const CONTENT_FADE_MS = 250;

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatPercent(value: number): string {
  return `${value % 1 === 0 ? value.toFixed(0) : value.toFixed(1)}%`;
}

function formatNullablePercent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "\u2014";
  return formatPercent(value);
}

function formatStageDays(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "\u2014";
  return `${value % 1 === 0 ? value.toFixed(0) : value.toFixed(1)} Days`;
}

function formatScheduledToday(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "\u2014";
  return `${value} Today`;
}

function normalizeStageKey(label: string): string {
  return label.trim().toLowerCase();
}

function normalizeInterviewDetails(payload: unknown): InterviewStageDetails {
  const source = (payload ?? {}) as Record<string, unknown>;
  const screening =
    typeof source.screeningToInterview === "object" && source.screeningToInterview !== null
      ? (source.screeningToInterview as Record<string, unknown>)
      : {};

  return {
    activeInterviewLoops: typeof source.activeInterviewLoops === "number" ? source.activeInterviewLoops : 0,
    avgTimeInStageDays: typeof source.avgTimeInStageDays === "number" ? source.avgTimeInStageDays : null,
    interviewsScheduledToday: typeof source.interviewsScheduledToday === "number" ? source.interviewsScheduledToday : null,
    screeningToInterview: {
      currentRate: typeof screening.currentRate === "number" ? screening.currentRate : null,
      delta: typeof screening.delta === "number" ? screening.delta : null,
      direction:
        screening.direction === "up" || screening.direction === "down" || screening.direction === "neutral" || screening.direction === "flat"
          ? screening.direction
          : "neutral",
      screeningCount: typeof screening.screeningCount === "number" ? screening.screeningCount : null,
      interviewCount: typeof screening.interviewCount === "number" ? screening.interviewCount : null,
    },
    periodLabel: typeof source.periodLabel === "string" ? source.periodLabel : null,
    comparisonLabel: typeof source.comparisonLabel === "string" ? source.comparisonLabel : null,
  };
}

function getStageStatCards(
  hoveredStage: StageSegment | null,
  details: InterviewStageDetails | undefined,
  stageCandidateCount: number | null,
  avgTimeInStageDays: number | null,
  stageInterviewsScheduledToday: number,
): Array<{ label: string; value: string }> {
  if (!hoveredStage) {
    return [
      {
        label: recruiterDashboardCopy.funnel.avgTimeInStage,
        value: formatStageDays(avgTimeInStageDays),
      },
      {
        label: recruiterDashboardCopy.funnel.interviewsToday,
        value: formatScheduledToday(details?.interviewsScheduledToday),
      },
    ];
  }

  const stageName = normalizeStageKey(hoveredStage.name);
  if (stageName.includes("interview")) {
    return [
      {
        label: recruiterDashboardCopy.funnel.candidatesInStage,
        value: formatCompactNumber(stageCandidateCount ?? hoveredStage.count),
      },
      {
        label: recruiterDashboardCopy.funnel.interviewsToday,
        value: formatScheduledToday(stageInterviewsScheduledToday),
      },
    ];
  }

  return [
    {
      label: recruiterDashboardCopy.funnel.candidatesInStage,
      value: formatCompactNumber(stageCandidateCount ?? hoveredStage.count),
    },
    {
      label: recruiterDashboardCopy.funnel.avgTimeInStage,
      value: formatStageDays(avgTimeInStageDays),
    },
  ];
}

function buildSummary(
  details: InterviewStageDetails | undefined,
  hoveredStage: StageSegment | null,
  stageCandidateCount: number | null,
  avgTimeInStageDays: number | null,
): {
  prefix: string;
  deltaText: string;
  suffix: string;
  deltaClassName: string;
} {
  const delta = details?.screeningToInterview?.delta ?? null;
  const direction = details?.screeningToInterview?.direction ?? "neutral";
  const currentRate = details?.screeningToInterview?.currentRate ?? null;
  const periodLabel = details?.periodLabel ?? "\u2014";
  const comparisonLabel = details?.comparisonLabel ?? "\u2014";
  const subjectCount = hoveredStage != null
    ? formatCompactNumber(stageCandidateCount ?? hoveredStage.count)
    : formatCompactNumber(details?.activeInterviewLoops ?? 0);

  if (hoveredStage) {
    const stageTiming =
      avgTimeInStageDays != null ? ` Average time in this stage is ${formatStageDays(avgTimeInStageDays)}.` : "";
    const prefix =
      `In ${periodLabel}, ${subjectCount} candidates are currently in ${hoveredStage.name}.${stageTiming} ` +
      `Recruiter-wide screening to interview conversion is ${formatNullablePercent(currentRate)} and has `;

    if (direction === "up" && (delta ?? 0) > 0) {
      return {
        prefix: prefix.replace("has ", "increased by "),
        deltaText: formatPercent(Math.abs(delta ?? 0)),
        suffix: ` ${comparisonLabel}.`,
        deltaClassName: "text-[#16A34A]",
      };
    }

    if (direction === "down" && Math.abs(delta ?? 0) > 0) {
      return {
        prefix: prefix.replace("has ", "decreased by "),
        deltaText: formatPercent(Math.abs(delta ?? 0)),
        suffix: ` ${comparisonLabel}.`,
        deltaClassName: "text-[#DC2626]",
      };
    }

    return {
      prefix: prefix.replace("has ", "held at "),
      deltaText: formatNullablePercent(currentRate),
      suffix: ` ${comparisonLabel}.`,
      deltaClassName: "text-[#6B7280]",
    };
  }

  const prefix = `In ${periodLabel}, ${subjectCount} candidates are in active interview loops. Recruiter-wide screening to interview conversion is ${formatNullablePercent(currentRate)} and has `;

  if (direction === "up" && (delta ?? 0) > 0) {
    return {
      prefix: prefix.replace("has ", "has increased by "),
      deltaText: formatPercent(Math.abs(delta ?? 0)),
      suffix: ` ${comparisonLabel}.`,
      deltaClassName: "text-[#16A34A]",
    };
  }

  if (direction === "down" && Math.abs(delta ?? 0) > 0) {
    return {
      prefix: prefix.replace("has ", "has decreased by "),
      deltaText: formatPercent(Math.abs(delta ?? 0)),
      suffix: ` ${comparisonLabel}.`,
      deltaClassName: "text-[#DC2626]",
    };
  }

  return {
    prefix: prefix.replace("has ", "remained steady at "),
    deltaText: formatNullablePercent(currentRate),
    suffix: ` ${comparisonLabel}.`,
    deltaClassName: "text-[#6B7280]",
  };
}

export function StageFunnel({
  title,
  data,
  isLoading,
  onStageClick,
  rangePreset = "30d",
  selectedJobId = "all",
  applications = [],
  pipelineStages = [],
}: StageFunnelProps) {
  const isMobile = useIsMobile();
  const isTouchDevice = useIsTouchDevice();
  const [hoveredStageIndex, setHoveredStageIndex] = useState<number | null>(null);
  const [contentVisible, setContentVisible] = useState(true);
  const [connectorPath, setConnectorPath] = useState<string>("");
  const [showConnector, setShowConnector] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const detailPanelRef = useRef<HTMLDivElement | null>(null);
  const stageRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const hoverLeaveTimeoutRef = useRef<number | null>(null);

  const hoveredStage = hoveredStageIndex != null ? data[hoveredStageIndex] ?? null : null;
  const maxCount = useMemo(() => Math.max(...data.map((stage) => stage.count), 1), [data]);
  const totalCount = useMemo(() => data.reduce((sum, stage) => sum + stage.count, 0), [data]);
  const stageMetaById = useMemo(
    () =>
      new Map(
        pipelineStages.map((stage) => [
          stage.id,
          { name: stage.name, nameLower: stage.name.toLowerCase(), order: stage.order },
        ]),
      ),
    [pipelineStages],
  );

  const stageDerivedMetrics = useMemo(() => {
    const normalizedHovered = hoveredStage ? normalizeStageKey(hoveredStage.name) : null;
    const stageApplications = normalizedHovered
      ? applications.filter((application) => {
          const stage = application.currentStage != null ? stageMetaById.get(application.currentStage) : null;
          return normalizeStageKey(stage?.name ?? "unassigned") === normalizedHovered;
        })
      : [];

    const avgTimeInStageDays =
      stageApplications.length > 0
        ? Math.round(
            (stageApplications.reduce((sum, application) => {
              const anchor = application.stageChangedAt ?? application.appliedAt;
              const date = new Date(anchor);
              if (Number.isNaN(date.getTime())) return sum;
              return sum + (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
            }, 0) /
              stageApplications.length) *
              10,
          ) / 10
        : null;

    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(now);
    dayEnd.setHours(23, 59, 59, 999);

    const interviewsScheduledToday = stageApplications.filter((application) => {
      if (!application.interviewDate) return false;
      const interviewDate = new Date(application.interviewDate);
      return !Number.isNaN(interviewDate.getTime()) && interviewDate >= dayStart && interviewDate <= dayEnd;
    }).length;

    return {
      stageCandidateCount: hoveredStage ? stageApplications.length : null,
      avgTimeInStageDays,
      interviewsScheduledToday,
    };
  }, [applications, hoveredStage, stageMetaById]);

  const detailsQuery = useQuery<InterviewStageDetails>({
    queryKey: [
      "/api/recruiter-dashboard/interview-stage-details",
      rangePreset,
      selectedJobId,
    ],
    queryFn: async () => {
      const params = new URLSearchParams({
        range: rangePreset,
        jobId: selectedJobId === "all" ? "all" : String(selectedJobId),
      });
      const response = await fetch(`/api/recruiter-dashboard/interview-stage-details?${params.toString()}`, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Failed to fetch interview stage details");
      }
      const payload = await response.json();
      return normalizeInterviewDetails(payload);
    },
    staleTime: 0,
    refetchOnMount: "always",
    placeholderData: (previousData) => previousData,
  });

  useEffect(() => {
    return () => {
      if (hoverLeaveTimeoutRef.current != null) {
        window.clearTimeout(hoverLeaveTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!data.length) return;
    if (isTouchDevice && hoveredStageIndex == null) {
      setHoveredStageIndex(0);
    }
  }, [data.length, hoveredStageIndex, isTouchDevice]);

  useEffect(() => {
    setContentVisible(false);
    const timer = window.setTimeout(() => setContentVisible(true), 70);
    return () => window.clearTimeout(timer);
  }, [hoveredStage?.name, detailsQuery.dataUpdatedAt]);

  useLayoutEffect(() => {
    const updateConnector = () => {
      const container = containerRef.current;
      const panel = detailPanelRef.current;
      const stageEl = hoveredStageIndex != null ? stageRefs.current[hoveredStageIndex] : null;

      if (!container || !panel || !stageEl || window.innerWidth < 1024 || isMobile) {
        setShowConnector(false);
        setConnectorPath("");
        return;
      }

      const containerRect = container.getBoundingClientRect();
      const stageRect = stageEl.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();

      const startX = stageRect.right - containerRect.left + 12;
      const startY = stageRect.top - containerRect.top + stageRect.height / 2;
      const endX = panelRect.left - containerRect.left - 18;
      const endY = panelRect.top - containerRect.top + Math.min(200, panelRect.height / 2);
      const deltaX = Math.max(60, (endX - startX) * 0.45);

      setConnectorPath(
        `M ${startX} ${startY} C ${startX + deltaX} ${startY}, ${endX - deltaX} ${endY}, ${endX} ${endY}`,
      );
      setShowConnector(true);
    };

    updateConnector();
    window.addEventListener("resize", updateConnector);
    return () => window.removeEventListener("resize", updateConnector);
  }, [hoveredStageIndex, data.length, isMobile]);

  const details = detailsQuery.data;
  const effectiveAvgTimeInStageDays =
    hoveredStage != null && stageDerivedMetrics.avgTimeInStageDays != null
      ? stageDerivedMetrics.avgTimeInStageDays
      : details?.avgTimeInStageDays ?? null;
  const summary = buildSummary(
    details,
    hoveredStage,
    stageDerivedMetrics.stageCandidateCount,
    effectiveAvgTimeInStageDays,
  );
  const statCards = useMemo(
    () =>
      getStageStatCards(
        hoveredStage,
        details,
        stageDerivedMetrics.stageCandidateCount,
        effectiveAvgTimeInStageDays,
        stageDerivedMetrics.interviewsScheduledToday,
      ),
    [
      details,
      effectiveAvgTimeInStageDays,
      hoveredStage,
      stageDerivedMetrics.interviewsScheduledToday,
      stageDerivedMetrics.stageCandidateCount,
    ],
  );

  const openStageHover = (index: number) => {
    if (hoverLeaveTimeoutRef.current != null) {
      window.clearTimeout(hoverLeaveTimeoutRef.current);
      hoverLeaveTimeoutRef.current = null;
    }
    setHoveredStageIndex(index);
  };

  const closeStageHover = (index: number) => {
    if (isTouchDevice) return;
    if (hoverLeaveTimeoutRef.current != null) {
      window.clearTimeout(hoverLeaveTimeoutRef.current);
    }
    hoverLeaveTimeoutRef.current = window.setTimeout(() => {
      setHoveredStageIndex((current) => (current === index ? null : current));
      hoverLeaveTimeoutRef.current = null;
    }, 120);
  };

  return (
    <Card className={cn(DASHBOARD_PANEL, "rounded-[28px] bg-white/95")}>
      <CardHeader className="pb-2">
        <p className={cn(DASHBOARD_EYEBROW, "mb-3")}>{recruiterDashboardCopy.funnel.eyebrow}</p>
        <CardTitle className={cn(DASHBOARD_TITLE, "text-[22px] leading-tight")}>
          {title}
        </CardTitle>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#6B7280]">
          {recruiterDashboardCopy.funnel.description}
        </p>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0 sm:px-6 sm:pb-6 lg:px-6 lg:pb-6 xl:px-8 xl:pb-8">
        {isLoading ? (
          <div className="h-[420px] rounded-[24px] bg-[#F5F7FA] animate-pulse" />
        ) : data.length === 0 ? (
          <div className="flex h-[320px] items-center justify-center rounded-[24px] bg-[#F5F7FA] text-sm text-muted-foreground">
            {recruiterDashboardCopy.funnel.noData}
          </div>
        ) : (
          <div ref={containerRef} className="relative">
            <div className="grid items-center gap-5 md:gap-6 xl:grid-cols-[minmax(0,55%)_minmax(0,45%)] xl:items-center xl:gap-8">
              <div className="min-w-0 self-center">
                <div className="space-y-3 md:space-y-3.5">
                  {data.map((stage, index) => {
                    const ratio = Math.max(stage.count / maxCount, 0);
                    const fillWidth = `${Math.max(ratio * 100, stage.count > 0 ? 10 : 0)}%`;
                    const percentage = stage.percentage ?? (totalCount > 0 ? (stage.count / totalCount) * 100 : 0);
                    const isHovered = hoveredStageIndex === index;
                    const isRejected = normalizeStageKey(stage.name).includes("reject");
                    const fillColor = isRejected ? "#A8A1B8" : "#6D4CFF";

                    return (
                      <div
                        key={`${stage.name}-${stage.stageId ?? index}`}
                        className={cn(
                          "grid grid-cols-[minmax(84px,120px)_minmax(0,1fr)_72px] items-center gap-3 rounded-2xl px-2 py-1.5 transition-colors duration-200 md:grid-cols-[minmax(104px,136px)_minmax(0,1fr)_84px] md:gap-4 xl:grid-cols-[minmax(120px,150px)_minmax(0,1fr)_96px] xl:gap-5",
                          isHovered && "bg-[#F3F0FF]",
                        )}
                      >
                        <div className="min-w-0 text-right">
                          <span
                            className="block truncate font-satoshi text-sm font-[600] tracking-[-0.01em] text-[#221B3A]"
                          >
                            {stage.name}
                          </span>
                        </div>

                        <div className="flex-1">
                          <div className="flex">
                            <button
                              ref={(node) => {
                                stageRefs.current[index] = node;
                              }}
                              type="button"
                              onClick={() => {
                                if (isMobile || isTouchDevice) {
                                  setHoveredStageIndex(index);
                                  return;
                                }
                                onStageClick?.(stage);
                              }}
                              onMouseEnter={isTouchDevice ? undefined : () => openStageHover(index)}
                              onMouseLeave={isTouchDevice ? undefined : () => closeStageHover(index)}
                              onFocus={() => openStageHover(index)}
                              onBlur={() => closeStageHover(index)}
                              className="group relative flex h-[16px] w-full items-center justify-start overflow-hidden rounded-full bg-transparent text-left outline-none transition duration-300 ease-out focus-visible:ring-2 focus-visible:ring-[#4D41DF] focus-visible:ring-offset-2 md:h-[18px]"
                              style={{
                                filter: isHovered ? "brightness(1.08)" : "none",
                              }}
                              aria-label={`${stage.name}: ${stage.count} candidates`}
                            >
                              <div className="absolute inset-0 rounded-full bg-[#F1F3F7]" />
                              <div
                                className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-300 ease-out"
                                style={{
                                  width: fillWidth,
                                  background: fillColor,
                                }}
                              />
                            </button>
                          </div>
                        </div>

                        <div className="w-[72px] shrink-0 text-right md:w-[84px] xl:w-[96px]">
                          <div
                            className="font-satoshi text-[15px] font-[700] leading-none text-[#111827] md:text-[16px] xl:text-[17px]"
                          >
                            {formatCompactNumber(stage.count)}
                          </div>
                          <div
                            className="mt-1 font-dm text-xs leading-none text-[#6B7280]"
                          >
                            {formatPercent(percentage)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {isMobile ? (
                  <p className="pt-3 text-xs font-medium text-[#7B8191]">
                    Tap a stage to see details
                  </p>
                ) : null}
              </div>

              <div
                ref={detailPanelRef}
                className={cn(DASHBOARD_PANEL_SOFT, "relative min-h-[360px] p-4 shadow-[0_10px_30px_rgba(77,65,223,0.08)] md:p-4 xl:min-h-[372px] xl:p-6")}
              >
                <div
                  className={cn(
                    "flex min-h-full flex-col transition-opacity ease-out",
                    contentVisible ? "opacity-100" : "opacity-0",
                  )}
                  style={{ transitionDuration: `${CONTENT_FADE_MS}ms` }}
                >
                  <div
                    className="inline-flex font-mono rounded-full px-4 py-2 text-[0.68rem] font-[700] uppercase tracking-[0.08em] text-white shadow-[0_10px_24px_rgba(77,65,223,0.18)]"
                    style={{
                      background: "linear-gradient(90deg, #4D41DF 0%, #675DF9 100%)",
                    }}
                  >
                    {recruiterDashboardCopy.funnel.detailsBadge}
                  </div>

                  <h3
                    className="mt-9 min-h-[60px] font-satoshi text-[24px] font-[700] leading-tight text-[#191C1E]"
                  >
                    {hoveredStage ? `${hoveredStage.name} ${recruiterDashboardCopy.funnel.snapshotSuffix}` : recruiterDashboardCopy.funnel.overviewTitle}
                  </h3>

                  <p
                    className="mt-6 min-h-[92px] max-w-[30rem] font-outfit text-sm leading-[1.6] text-[#464555]"
                  >
                    {summary.prefix}
                    <span className={summary.deltaClassName}>{summary.deltaText}</span>
                    {summary.suffix}
                  </p>

                  <div className="mt-8 grid gap-4 sm:grid-cols-2">
                    {statCards.map((stat) => (
                      <div key={stat.label} className="rounded-[12px] bg-white p-4">
                        <div
                          className="font-mono text-[0.68rem] font-[600] uppercase tracking-[0.08em] text-[#6B7280]"
                        >
                          {stat.label}
                        </div>
                        <div
                          className="mt-2 font-satoshi text-2xl font-[700] leading-tight text-[#111827]"
                        >
                          {stat.value}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-[#768094] shadow-[0_4px_12px_rgba(15,23,42,0.04)]">
                      {hoveredStage ? recruiterDashboardCopy.funnel.stageSnapshot : recruiterDashboardCopy.funnel.recruiterWideView}
                    </span>
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-[#768094] shadow-[0_4px_12px_rgba(15,23,42,0.04)]">
                      {details?.periodLabel ?? "Current period"}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <svg
              className={cn(
                "pointer-events-none absolute inset-0 hidden overflow-visible lg:block",
                showConnector ? "opacity-100" : "opacity-0",
              )}
              width="100%"
              height="100%"
              aria-hidden="true"
            >
              <defs>
                <marker
                  id="stage-funnel-arrowhead"
                  markerWidth="8"
                  markerHeight="8"
                  refX="6"
                  refY="3"
                  orient="auto"
                >
                  <path d="M 0 0 L 6 3 L 0 6 z" fill="rgba(77,65,223,0.35)" />
                </marker>
              </defs>
              {connectorPath ? (
                <path
                  d={connectorPath}
                  fill="none"
                  stroke="rgba(77,65,223,0.35)"
                  strokeWidth="1.5"
                  strokeDasharray="6 6"
                  strokeLinecap="round"
                  markerEnd="url(#stage-funnel-arrowhead)"
                  className="transition-opacity duration-300 ease-out"
                />
              ) : null}
            </svg>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
