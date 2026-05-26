import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { AlertCircle, ArrowRight, Loader2, RefreshCcw, Zap } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { recruiterDashboardCopy } from "@/lib/internal-copy";
import { apiRequest } from "@/lib/queryClient";
import { DASHBOARD_EYEBROW, DASHBOARD_PANEL, DASHBOARD_PANEL_MUTED, DASHBOARD_TITLE } from "@/lib/dashboard-theme";
import { cn } from "@/lib/utils";

type RawSectionKey =
  | "candidates_to_review"
  | "final_stage"
  | "feedback_pending"
  | "low_pipeline"
  | "candidatesToReview"
  | "finalStageCandidates"
  | "feedbackPending"
  | "jobsLowOnPipeline";

type ActionUrgency = "high" | "medium" | "low";

type ActionItem = {
  id?: string;
  title: string;
  subtitle: string;
  badge?: string;
  urgency: ActionUrgency;
  ctaLabel: string;
  ctaHref: string;
};

type RawActionSection = {
  key?: RawSectionKey;
  id?: RawSectionKey;
  label?: string;
  title?: string;
  count: number;
  emptyMessage: string;
  items: ActionItem[];
};

type RawActionsResponse = {
  sections: RawActionSection[];
  totalCount?: number;
  updatedAt?: string;
  generatedAt?: string;
};

type AIActionsPanelProps = {
  range: string;
  jobId: number | "all";
};

type TabKey =
  | "candidates_to_review"
  | "final_stage"
  | "feedback_pending"
  | "low_pipeline";

type NormalizedSection = {
  key: TabKey;
  label: string;
  count: number;
  emptyMessage: string;
  items: ActionItem[];
};

const TAB_ORDER: Array<{ key: TabKey; label: string; aliases: RawSectionKey[] }> = [
  {
    key: "candidates_to_review",
    label: recruiterDashboardCopy.actionsPanel.sections.candidatesToReview,
    aliases: ["candidates_to_review", "candidatesToReview"],
  },
  {
    key: "final_stage",
    label: recruiterDashboardCopy.actionsPanel.sections.finalStage,
    aliases: ["final_stage", "finalStageCandidates"],
  },
  {
    key: "feedback_pending",
    label: recruiterDashboardCopy.actionsPanel.sections.feedbackPending,
    aliases: ["feedback_pending", "feedbackPending"],
  },
  {
    key: "low_pipeline",
    label: recruiterDashboardCopy.actionsPanel.sections.lowPipeline,
    aliases: ["low_pipeline", "jobsLowOnPipeline"],
  },
];

const FIT_BADGE_STYLES: Record<string, string> = {
  strong: "bg-[#DCFCE7] text-[#16A34A]",
  good: "bg-[#DBEAFE] text-[#2563EB]",
  "at risk": "bg-[#FEF3C7] text-[#D97706]",
  "needs depth": "bg-[#F3F4F6] text-[#6B7280]",
};

const URGENCY_BADGE_STYLES: Record<ActionUrgency, { container: string; label: string }> = {
  high: {
    container: "bg-[#FEE2E2] text-[#DC2626]",
    label: recruiterDashboardCopy.actionsPanel.urgency.high,
  },
  medium: {
    container: "bg-[#FEF3C7] text-[#D97706]",
    label: recruiterDashboardCopy.actionsPanel.urgency.medium,
  },
  low: {
    container: "bg-[#F3F4F6] text-[#6B7280]",
    label: recruiterDashboardCopy.actionsPanel.urgency.low,
  },
};

function normalizeUpdatedAt(raw?: string): string | null {
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return raw;
  }

  return parsed.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function normalizeSections(rawSections: RawActionSection[] | undefined): NormalizedSection[] {
  const sections = rawSections ?? [];

  return TAB_ORDER.map(({ key, label, aliases }) => {
    const matched = sections.find((section) => {
      const rawKey = section.key ?? section.id;
      return rawKey != null && aliases.includes(rawKey);
    });

    return {
      key,
      label: matched?.label ?? matched?.title ?? label,
      count: matched?.count ?? 0,
      emptyMessage: matched?.emptyMessage ?? `No ${label.toLowerCase()}`,
      items: matched?.items ?? [],
    };
  });
}

export function AIActionsPanel({ range, jobId }: AIActionsPanelProps) {
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState<TabKey>("candidates_to_review");
  const isMobile = useIsMobile();

  const { data, isLoading, error, refetch, isFetching } = useQuery<RawActionsResponse>({
    queryKey: ["/api/recruiter-dashboard/actions", range, jobId],
    queryFn: async () => {
      const params = new URLSearchParams({
        range,
        jobId: jobId === "all" ? "all" : String(jobId),
      });
      const response = await apiRequest("GET", `/api/recruiter-dashboard/actions?${params.toString()}`);
      return response.json();
    },
    placeholderData: (previousData) => previousData,
  });

  const sections = useMemo(() => normalizeSections(data?.sections), [data?.sections]);
  const totalCount = data?.totalCount ?? sections.reduce((sum, section) => sum + section.count, 0);
  const updatedLabel = useMemo(
    () => normalizeUpdatedAt(data?.updatedAt ?? data?.generatedAt),
    [data?.generatedAt, data?.updatedAt],
  );
  const activeSection = sections.find((section) => section.key === activeTab) ?? sections[0];

  return (
    <section
      className={cn(
        DASHBOARD_PANEL,
        "actions-panel flex h-[492px] min-h-[492px] max-h-[492px] w-full flex-col rounded-[26px] bg-white/95",
      )}
      data-testid="ai-actions-panel"
    >
      <div className="flex items-center justify-between gap-4 px-4 pb-5 pt-6 sm:px-6 md:px-6 xl:px-8 xl:pt-7">
        <div className="flex items-center gap-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-[16px] bg-[linear-gradient(135deg,#4B8EF0_0%,#34D17A_100%)] shadow-[0_12px_24px_rgba(75,142,240,0.22)]">
            <Zap className="h-[22px] w-[22px] fill-white text-white" />
          </div>
          <div className="space-y-2">
            <p className={DASHBOARD_EYEBROW}>{recruiterDashboardCopy.actionsPanel.eyebrow}</p>
            <div className="flex items-center gap-3">
              <h2 className={cn(DASHBOARD_TITLE, "text-[20px] leading-none")}>{recruiterDashboardCopy.actionsPanel.title}</h2>
              <span className="inline-flex items-center rounded-[20px] bg-[#EEF5FF] px-2 py-1 font-inter text-xs font-semibold leading-none text-[#4B8EF0]">
                {totalCount}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 font-inter text-xs font-normal leading-none text-[#9CA3AF]">
          {isFetching && !isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-[#B8D5FF]" /> : null}
          <span>{updatedLabel ? `Updated ${updatedLabel}` : recruiterDashboardCopy.actionsPanel.updatedFallback}</span>
        </div>
      </div>

      <div
        className="overflow-x-auto overflow-y-hidden px-4 scroll-smooth [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden sm:px-6 xl:px-8"
      >
        <div className="flex min-w-max flex-nowrap gap-x-7 border-b border-[#191C1E]/6">
          {sections.map((section) => {
            const isActive = section.key === activeTab;

            return (
              <button
                key={section.key}
                type="button"
                onClick={() => setActiveTab(section.key)}
                className={cn(
                  "nav-label relative -mb-px border-b-2 pb-5 font-inter text-sm font-medium leading-none transition-colors",
                  isActive
                    ? "border-[#4B8EF0] text-[#4B8EF0]"
                    : "border-transparent text-[#9CA3AF] hover:text-[#6B7280]",
                )}
              >
                {section.label} ({section.count})
              </button>
            );
          })}
        </div>
      </div>

      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col bg-[#FFFFFF] px-4 pt-6 transition-opacity sm:px-6 md:pt-6 xl:px-8 xl:pt-8",
          isFetching && !isLoading && "opacity-70",
        )}
      >
        {isLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="font-inter text-sm text-[#9CA3AF]">{recruiterDashboardCopy.actionsPanel.loading}</p>
          </div>
        ) : error || !activeSection ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <AlertCircle className="h-5 w-5 text-[#9CA3AF]" />
            <p className="font-inter text-sm text-[#9CA3AF]">{recruiterDashboardCopy.actionsPanel.unavailable}</p>
          </div>
        ) : activeSection.items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <Zap className="h-5 w-5 text-[#9CA3AF]" />
            <p className="font-inter text-sm text-[#9CA3AF]">{activeSection.emptyMessage}</p>
          </div>
        ) : (
          <div className="actions-list flex-1 space-y-3 overflow-y-auto pr-1 transition-[overflow] duration-150 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-[4px] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#B8D5FF] [&::-webkit-scrollbar-thumb:hover]:bg-[#4B8EF0] [&::-webkit-scrollbar-track]:bg-transparent md:overflow-y-hidden md:hover:[scrollbar-color:#B8D5FF_transparent] md:[.actions-panel:hover_&]:overflow-y-auto">
            {activeSection.items.map((item, index) => {
              const fitKey = item.badge?.trim().toLowerCase() ?? "";
              const fitBadgeClass = FIT_BADGE_STYLES[fitKey] ?? "bg-[#F3F4F6] text-[#6B7280]";
              const urgencyStyle = URGENCY_BADGE_STYLES[item.urgency] ?? URGENCY_BADGE_STYLES.low;
              const cardKey = item.id ?? `${item.title}-${item.ctaHref}-${index}`;

              return (
                <article
                  key={cardKey}
                  onClick={() => {
                    if (isMobile) {
                      setLocation(item.ctaHref);
                    }
                  }}
                  className={cn(DASHBOARD_PANEL_MUTED, "cursor-pointer p-4 transition-colors hover:bg-[#F3F4F8]")}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate font-manrope text-[15px] font-semibold leading-[1.25] text-[#191C1E]">
                        {item.title}
                      </h3>
                      <p className="mt-1 truncate font-inter text-sm font-normal leading-[1.35] text-[#464555]">
                        {item.subtitle}
                      </p>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setLocation(item.ctaHref);
                        }}
                        className="mt-5 inline-flex items-center gap-2 rounded-[12px] bg-[#FFFFFF] px-5 py-3 font-inter text-[0.875rem] font-medium leading-none text-[#4B8EF0] shadow-[0_2px_8px_rgba(75,142,240,0.08)] transition-colors hover:bg-[#EEF5FF]"
                      >
                        <span>{item.ctaLabel}</span>
                        <ArrowRight className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-2">
                      {item.badge ? (
                        <span
                          className={cn(
                            "inline-flex rounded-[6px] px-2 py-1 font-inter text-[0.65rem] font-bold uppercase tracking-[0.08em]",
                            fitBadgeClass,
                          )}
                        >
                          {item.badge}
                        </span>
                      ) : null}
                      <span
                        className={cn(
                          "inline-flex rounded-[6px] px-2 py-1 font-inter text-[0.7rem] font-medium leading-none",
                          urgencyStyle.container,
                        )}
                      >
                        {urgencyStyle.label} {recruiterDashboardCopy.actionsPanel.urgency.suffix}
                      </span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => {
          void refetch();
        }}
        className="flex items-center justify-center gap-2 border-t border-[#191C1E]/15 bg-[#FFFFFF] px-6 py-5 font-inter text-[0.68rem] font-medium uppercase tracking-[0.08em] text-[#9CA3AF] transition-colors hover:text-[#6B7280]"
      >
        <RefreshCcw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
        <span>{recruiterDashboardCopy.actionsPanel.syncLabel}</span>
      </button>
    </section>
  );
}
