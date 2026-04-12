import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import Layout from "@/components/Layout";
import { Skeleton } from "@/components/ui/skeleton";

type AnalyticsOverview = {
  totalApplications: number;
  totalHires: number;
  conversionRate: number;
  avgTimeToFill: number | null;
};

type TimeToFillJob = {
  jobId: number;
  jobTitle: string;
  daysToFill: number | null;
  totalApplications: number;
};

type StageBreakdown = {
  stageId: number | null;
  stageName: string;
  avgDays: number;
  transitions: number;
};

type SourcePerformance = {
  source: string;
  applications: number;
  shortlisted: number;
  hired: number;
  conversionRate: number;
};

type RecruiterPerformance = {
  recruiterId: number;
  recruiterName: string;
  jobsPosted: number;
  applicationsScreened: number;
  avgFirstActionDays: number;
};

type HiringManagerPerformance = {
  managerId: number;
  managerName: string;
  jobsAssigned: number;
  feedbackGiven: number;
  avgFeedbackDays: number;
};

type HeaderStat = {
  label: string;
  value: string;
  color: string;
  subtitle?: string;
};

async function fetchWithAuth<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    throw new Error("Failed to fetch analytics");
  }
  return res.json();
}

const SURFACE_CLASS_NAME =
  "rounded-none border border-[#E4E7EF] bg-white shadow-[0_2px_8px_rgba(0,0,0,0.05)]";

function percent(value: number, max: number) {
  if (max <= 0 || value <= 0) return "0%";
  return `${Math.min((value / max) * 100, 100)}%`;
}

function formatCount(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  return `${value}`;
}

function formatDayValue(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value) || value <= 0) return "—";
  return `${Math.round(value * 10) / 10}d`;
}

function formatPercentValue(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  return `${Math.round(value * 10) / 10}%`;
}

function formatDurationPill(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value) || value <= 0) return "N/A";
  if (value < 1) return `${Math.max(1, Math.round(value * 24))}H`;

  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}D` : `${rounded.toFixed(1)}D`;
}

function timeTone(value: number | null | undefined): "green" | "amber" | "red" {
  if (typeof value !== "number" || Number.isNaN(value) || value <= 0) return "amber";
  if (value <= 1) return "green";
  if (value <= 3) return "amber";
  return "red";
}

function timePillStyles(tone: "green" | "amber" | "red") {
  if (tone === "green") {
    return { backgroundColor: "#ECFDF5", borderColor: "#A7F3D0", color: "#10B981" };
  }
  if (tone === "red") {
    return { backgroundColor: "#FEF2F2", borderColor: "#FECACA", color: "#EF4444" };
  }
  return { backgroundColor: "#FFFBEB", borderColor: "#FDE68A", color: "#F59E0B" };
}

function rankColor(rank: number) {
  return rank === 1 ? "#5B4FE8" : "#9CA3AF";
}

function initialsFromName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "U";
  const second = parts[1]?.[0] ?? "";
  return `${first}${second}`.toUpperCase();
}

function avatarColorFromName(name: string) {
  const palette = ["#5B4FE8", "#3B82F6", "#10B981", "#8B5CF6", "#EC4899", "#F59E0B"];
  const hash = Array.from(name).reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return palette[hash % palette.length] ?? "#5B4FE8";
}

function stageColor(stageName: string) {
  const normalized = stageName.toLowerCase();
  if (normalized.includes("applied")) return "#3B82F6";
  if (normalized.includes("screen")) return "#F59E0B";
  if (normalized.includes("technical")) return "#8B5CF6";
  if (normalized.includes("final")) return "#9CA3AF";
  return "#8B5CF6";
}

function sourceDisplayName(source: string) {
  return source === "public_apply" ? "Company Website" : source;
}

function HeaderSkeleton() {
  return (
    <section className={`${SURFACE_CLASS_NAME} flex flex-col gap-6 p-5 md:flex-row md:items-center md:justify-between md:px-6`}>
      <div className="flex-1 space-y-3">
        <Skeleton className="h-3 w-36 rounded-none" />
        <Skeleton className="h-8 w-72 rounded-none" />
      </div>
      <div className="grid grid-cols-2 gap-4 md:flex md:gap-5">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="min-w-[120px] space-y-2">
            <Skeleton className="h-3 w-20 rounded-none" />
            <Skeleton className="h-8 w-16 rounded-none" />
            {index === 3 ? <Skeleton className="h-3 w-20 rounded-none" /> : null}
          </div>
        ))}
      </div>
    </section>
  );
}

export default function OrgAnalyticsPage() {
  const overviewQuery = useQuery<AnalyticsOverview>({
    queryKey: ["/api/organizations/analytics"],
    queryFn: () => fetchWithAuth("/api/organizations/analytics"),
  });

  const timeToFillQuery = useQuery<TimeToFillJob[]>({
    queryKey: ["/api/organizations/analytics/time-to-fill"],
    queryFn: () => fetchWithAuth("/api/organizations/analytics/time-to-fill"),
  });

  const stageBreakdownQuery = useQuery<StageBreakdown[]>({
    queryKey: ["/api/organizations/analytics/stage-breakdown"],
    queryFn: () => fetchWithAuth("/api/organizations/analytics/stage-breakdown"),
  });

  const sourcesQuery = useQuery<SourcePerformance[]>({
    queryKey: ["/api/organizations/analytics/sources"],
    queryFn: () => fetchWithAuth("/api/organizations/analytics/sources"),
  });

  const recruitersQuery = useQuery<RecruiterPerformance[]>({
    queryKey: ["/api/organizations/analytics/recruiters"],
    queryFn: () => fetchWithAuth("/api/organizations/analytics/recruiters"),
  });

  const hiringManagersQuery = useQuery<HiringManagerPerformance[]>({
    queryKey: ["/api/organizations/analytics/hiring-managers"],
    queryFn: () => fetchWithAuth("/api/organizations/analytics/hiring-managers"),
  });

  const headerStats = useMemo<HeaderStat[]>(() => {
    const overview = overviewQuery.data;
    return [
      { label: "TOTAL APPS", value: formatCount(overview?.totalApplications), color: "#5B4FE8" },
      { label: "TOTAL HIRES", value: formatCount(overview?.totalHires), color: "#10B981" },
      { label: "CONVERSION", value: formatPercentValue(overview?.conversionRate), color: "#F59E0B" },
      { label: "AVG TIME TO FILL", value: formatDayValue(overview?.avgTimeToFill), color: "#EF4444", subtitle: "Last 90 days" },
    ];
  }, [overviewQuery.data]);

  const timeToFillRows = useMemo(
    () => [...(timeToFillQuery.data ?? [])].sort((a, b) => (b.daysToFill ?? -1) - (a.daysToFill ?? -1)).slice(0, 5),
    [timeToFillQuery.data],
  );
  const maxTimeToFillDays = useMemo(
    () => Math.max(...timeToFillRows.map((item) => item.daysToFill ?? 0), 1),
    [timeToFillRows],
  );

  const stageRows = useMemo(() => stageBreakdownQuery.data ?? [], [stageBreakdownQuery.data]);
  const maxStageDays = useMemo(
    () => Math.max(...stageRows.map((item) => item.avgDays ?? 0), 1),
    [stageRows],
  );

  const sourceRows = useMemo(() => sourcesQuery.data ?? [], [sourcesQuery.data]);
  const maxSourceApplications = useMemo(
    () => Math.max(...sourceRows.map((item) => item.applications ?? 0), 1),
    [sourceRows],
  );

  const recruiterRows = useMemo(() => {
    const items = recruitersQuery.data ?? [];
    return [...items]
      .sort((a, b) => {
        if (b.jobsPosted !== a.jobsPosted) return b.jobsPosted - a.jobsPosted;
        if (b.applicationsScreened !== a.applicationsScreened) return b.applicationsScreened - a.applicationsScreened;
        return a.recruiterName.localeCompare(b.recruiterName);
      })
      .slice(0, 3);
  }, [recruitersQuery.data]);

  const hiringManagerRows = useMemo(() => {
    const items = hiringManagersQuery.data ?? [];
    return [...items]
      .sort((a, b) => {
        if (b.jobsAssigned !== a.jobsAssigned) return b.jobsAssigned - a.jobsAssigned;
        if (b.feedbackGiven !== a.feedbackGiven) return b.feedbackGiven - a.feedbackGiven;
        return a.managerName.localeCompare(b.managerName);
      })
      .slice(0, 3);
  }, [hiringManagersQuery.data]);

  return (
    <Layout noFooter>
      <div className="min-h-full bg-[#F4F5F8] p-6">
        <div className="mx-auto flex w-full max-w-[1380px] flex-col gap-5">
          {overviewQuery.isLoading ? (
            <HeaderSkeleton />
          ) : (
            <section
              className={`${SURFACE_CLASS_NAME} flex flex-col gap-6 p-5 md:flex-row md:items-center md:justify-between md:px-6`}
            >
              <div className="min-w-0 flex-1">
                <div className="mb-2 font-dm-sans text-[0.68rem] uppercase tracking-[0.08em] text-[#9CA3AF]">
                  ORGANIZATION ANALYTICS
                </div>
                <h1 className="font-sora text-xl font-bold tracking-[-0.03em] text-[#111827]">
                  Hiring Performance Overview
                </h1>
              </div>

              <div className="grid flex-none grid-cols-2 gap-y-4 md:flex md:items-stretch md:gap-0">
                {headerStats.map((stat, index) => (
                  <div
                    key={stat.label}
                    className="min-w-[120px] px-0 md:px-5"
                    style={{ borderLeft: index === 0 ? "none" : "1px solid #E4E7EF" }}
                  >
                    <div className="font-dm-sans text-[0.68rem] uppercase tracking-[0.08em] text-[#9CA3AF]">
                      {stat.label}
                    </div>
                    <div className="mt-2 font-sora text-2xl font-bold leading-none" style={{ color: stat.color }}>
                      {stat.value}
                    </div>
                    {stat.subtitle ? (
                      <div className="mt-2 font-dm-sans text-xs text-[#9CA3AF]">{stat.subtitle}</div>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <div className={`${SURFACE_CLASS_NAME} p-5`}>
              <h2 className="font-sora text-base font-semibold text-[#111827]">Time to Fill by Job</h2>
              <div className="mt-5">
                <div className="grid grid-cols-[150px_50px_minmax(0,1fr)_55px] items-center gap-3 border-b border-[#E4E7EF] pb-2">
                  {["JOB", "APPS", "PROGRESS", "DAYS TO FILL"].map((label, index) => (
                    <div
                      key={label}
                      className={`font-dm-sans text-[0.68rem] uppercase tracking-[0.08em] text-[#9CA3AF] ${index > 0 ? "text-center" : ""} ${index === 3 ? "text-right" : ""}`}
                    >
                      {label}
                    </div>
                  ))}
                </div>

                {timeToFillQuery.isLoading
                  ? Array.from({ length: 5 }).map((_, index) => (
                      <div key={index} className="grid h-11 grid-cols-[150px_50px_minmax(0,1fr)_55px] items-center gap-3 border-b border-[#F3F4F6]">
                        <Skeleton className="h-4 w-28 rounded-none" />
                        <Skeleton className="mx-auto h-4 w-8 rounded-none" />
                        <Skeleton className="h-2 w-full rounded-none" />
                        <Skeleton className="ml-auto h-4 w-10 rounded-none" />
                      </div>
                    ))
                  : timeToFillRows.map((item) => (
                      <div
                        key={item.jobId}
                        className="grid h-11 grid-cols-[150px_50px_minmax(0,1fr)_55px] items-center gap-3 border-b border-[#F3F4F6] transition-all duration-150 ease-in-out hover:bg-[#FAFAFA]"
                      >
                        <div className="truncate font-dm-sans text-sm font-semibold text-[#111827]">{item.jobTitle || "—"}</div>
                        <div className="text-center font-dm-sans text-sm text-[#6B7280]">
                          {typeof item.totalApplications === "number" ? `${item.totalApplications} app${item.totalApplications === 1 ? "" : "s"}` : "—"}
                        </div>
                        <div className="h-2 rounded-[4px] bg-[#F3F4F6]">
                          <div
                            className="h-2 rounded-[4px]"
                            style={{
                              width: item.daysToFill ? percent(item.daysToFill, maxTimeToFillDays) : "0%",
                              background: "linear-gradient(90deg, #5B4FE8, #818CF8)",
                            }}
                          />
                        </div>
                        <div className="text-right font-sora text-sm font-bold text-[#5B4FE8]">
                          {formatDayValue(item.daysToFill)}
                        </div>
                      </div>
                    ))}

                {!timeToFillQuery.isLoading && timeToFillRows.length === 0 ? (
                  <div className="py-8 text-center font-dm-sans text-sm text-[#9CA3AF]">No data available</div>
                ) : null}
              </div>
            </div>

            <div className={`${SURFACE_CLASS_NAME} p-5`}>
              <h2 className="font-sora text-base font-semibold text-[#111827]">Time in Stage Breakdown</h2>
              <div className="mt-5">
                <div className="grid grid-cols-[minmax(160px,1.2fr)_70px_minmax(0,1fr)_80px] items-center gap-4 border-b border-[#E4E7EF] pb-2">
                  <div className="font-dm-sans text-[0.68rem] uppercase tracking-[0.08em] text-[#9CA3AF]">STAGE</div>
                  <div className="text-center font-dm-sans text-[0.68rem] uppercase tracking-[0.08em] text-[#9CA3AF]">AVG DAYS</div>
                  <div className="font-dm-sans text-[0.68rem] uppercase tracking-[0.08em] text-[#9CA3AF]">PROGRESS</div>
                  <div className="text-right font-dm-sans text-[0.68rem] uppercase tracking-[0.08em] text-[#9CA3AF]">TRANSITIONS</div>
                </div>

                {stageBreakdownQuery.isLoading
                  ? Array.from({ length: 4 }).map((_, index) => (
                      <div key={index} className="grid h-11 grid-cols-[minmax(160px,1.2fr)_70px_minmax(0,1fr)_80px] items-center gap-4 border-b border-[#F3F4F6]">
                        <Skeleton className="h-4 w-28 rounded-none" />
                        <Skeleton className="mx-auto h-4 w-10 rounded-none" />
                        <Skeleton className="h-2 w-full rounded-none" />
                        <Skeleton className="ml-auto h-4 w-8 rounded-none" />
                      </div>
                    ))
                  : stageRows.map((item, index) => {
                      const color = stageColor(item.stageName);
                      return (
                        <div
                          key={`${item.stageId ?? index}-${item.stageName}`}
                          className="grid h-11 grid-cols-[minmax(160px,1.2fr)_70px_minmax(0,1fr)_80px] items-center gap-4 border-b border-[#F3F4F6] transition-all duration-150 ease-in-out hover:bg-[#FAFAFA]"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="h-2 w-2 flex-none rounded-full" style={{ backgroundColor: color }} />
                            <span className="font-dm-sans text-sm font-semibold text-[#111827]">{item.stageName || "—"}</span>
                          </div>
                          <div className="text-center font-sora text-sm font-bold" style={{ color }}>
                            {formatDayValue(item.avgDays)}
                          </div>
                          <div className="h-2 rounded-[4px] bg-[#F3F4F6]">
                            <div
                              className="h-2 rounded-[4px]"
                              style={{
                                width: item.avgDays > 0 ? percent(item.avgDays, maxStageDays) : "0%",
                                backgroundColor: color,
                              }}
                            />
                          </div>
                          <div className="text-right font-dm-sans text-sm text-[#6B7280]">
                            {formatCount(item.transitions)}
                          </div>
                        </div>
                      );
                    })}

                {!stageBreakdownQuery.isLoading && stageRows.length === 0 ? (
                  <div className="py-8 text-center font-dm-sans text-sm text-[#9CA3AF]">No data available</div>
                ) : null}
              </div>
            </div>
          </section>

          <section className={`${SURFACE_CLASS_NAME} px-6 py-5`}>
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <h2 className="font-sora text-base font-semibold text-[#111827]">Source Performance</h2>
              <div className="flex flex-wrap items-center gap-4 font-dm-sans text-xs text-[#6B7280]">
                <span className="inline-flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-[2px] bg-[#5B4FE8]" />
                  Applications
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-[2px] bg-[#A5B4FC]" />
                  Shortlisted
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-[2px] bg-[#EF4444]" />
                  Hired
                </span>
              </div>
            </div>

            <div className="mt-5">
              <div className="grid grid-cols-[120px_minmax(0,1fr)_70px] items-center gap-4 border-b border-[#E4E7EF] pb-2">
                <div className="font-dm-sans text-[0.68rem] uppercase tracking-[0.08em] text-[#9CA3AF]">SOURCE</div>
                <div className="font-dm-sans text-[0.68rem] uppercase tracking-[0.08em] text-[#9CA3AF]">FUNNEL DISTRIBUTION</div>
                <div className="text-right font-dm-sans text-[0.68rem] uppercase tracking-[0.08em] text-[#9CA3AF]">CONV. RATE</div>
              </div>

              {sourcesQuery.isLoading
                ? Array.from({ length: 4 }).map((_, index) => (
                    <div key={index} className="grid h-16 grid-cols-[120px_minmax(0,1fr)_70px] items-center gap-4 border-b border-[#F3F4F6]">
                      <Skeleton className="h-4 w-24 rounded-none" />
                      <div className="space-y-2">
                        <Skeleton className="h-3 w-full rounded-none" />
                        <Skeleton className="h-3 w-40 rounded-none" />
                      </div>
                      <Skeleton className="ml-auto h-4 w-8 rounded-none" />
                    </div>
                  ))
                : sourceRows.map((item) => {
                    const totalRelativeWidth = item.applications > 0 ? (item.applications / maxSourceApplications) * 100 : 0;
                    const segmentBase = item.applications + item.shortlisted + item.hired;
                    const appliedWidth = segmentBase > 0 ? (item.applications / segmentBase) * totalRelativeWidth : 0;
                    const shortlistedWidth = segmentBase > 0 ? (item.shortlisted / segmentBase) * totalRelativeWidth : 0;
                    const hiredWidth = item.hired > 0 && segmentBase > 0 ? (item.hired / segmentBase) * totalRelativeWidth : 0;
                    const conversionLabel = formatPercentValue(item.conversionRate);

                    return (
                      <div
                        key={item.source}
                        className="grid h-16 grid-cols-[120px_minmax(0,1fr)_70px] items-center gap-4 border-b border-[#F3F4F6] py-2 transition-all duration-150 ease-in-out hover:bg-[#FAFAFA]"
                      >
                        <div className="font-dm-sans text-sm text-[#111827]">{sourceDisplayName(item.source)}</div>
                        <div>
                          <div className="h-3 w-full rounded-[4px] bg-[#F3F4F6]">
                            <div className="flex h-3 overflow-hidden rounded-[4px]" style={{ width: `${totalRelativeWidth}%` }}>
                              <div style={{ width: `${appliedWidth}%`, backgroundColor: "#5B4FE8" }} />
                              <div style={{ width: `${shortlistedWidth}%`, backgroundColor: "#A5B4FC" }} />
                              {item.hired > 0 ? (
                                <div style={{ width: `${hiredWidth}%`, backgroundColor: "#EF4444" }} />
                              ) : null}
                            </div>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-3">
                            <span className="font-sora text-[0.68rem] font-semibold text-[#5B4FE8]">{item.applications} Applied</span>
                            <span className="font-sora text-[0.68rem] font-semibold text-[#8B5CF6]">{item.shortlisted} Shortlisted</span>
                            <span className="font-sora text-[0.68rem] font-semibold text-[#9CA3AF]">{item.hired} Hired</span>
                          </div>
                        </div>
                        <div
                          className="text-right font-sora text-sm font-semibold"
                          style={{ color: item.conversionRate > 0 ? "#10B981" : "#9CA3AF" }}
                        >
                          {conversionLabel}
                        </div>
                      </div>
                    );
                  })}

              {!sourcesQuery.isLoading && sourceRows.length === 0 ? (
                <div className="py-8 text-center font-dm-sans text-sm text-[#9CA3AF]">No data available</div>
              ) : null}
            </div>
          </section>

          <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <div className={`${SURFACE_CLASS_NAME} p-5`}>
              <h2 className="font-sora text-base font-semibold text-[#111827]">Recruiter Performance</h2>
              <div className="mt-5">
                <div className="grid grid-cols-[minmax(0,1fr)_50px_70px_120px] items-center gap-3 border-b border-[#E4E7EF] pb-2">
                  <div className="font-dm-sans text-[0.68rem] uppercase tracking-[0.08em] text-[#9CA3AF]">RECRUITER</div>
                  <div className="text-center font-dm-sans text-[0.68rem] uppercase tracking-[0.08em] text-[#9CA3AF]">JOBS</div>
                  <div className="text-center font-dm-sans text-[0.68rem] uppercase tracking-[0.08em] text-[#9CA3AF]">SCREENED</div>
                  <div className="text-right font-dm-sans text-[0.68rem] uppercase tracking-[0.08em] text-[#9CA3AF]">AVG FIRST ACTION</div>
                </div>

                {recruitersQuery.isLoading
                  ? Array.from({ length: 3 }).map((_, index) => (
                      <div key={index} className="grid h-14 grid-cols-[minmax(0,1fr)_50px_70px_120px] items-center gap-3 border-b border-[#F3F4F6]">
                        <Skeleton className="h-8 w-40 rounded-none" />
                        <Skeleton className="mx-auto h-4 w-8 rounded-none" />
                        <Skeleton className="mx-auto h-4 w-10 rounded-none" />
                        <Skeleton className="ml-auto h-6 w-14 rounded-none" />
                      </div>
                    ))
                  : recruiterRows.map((person, index) => {
                      const rank = index + 1;
                      const timeValue = person.avgFirstActionDays > 0 ? person.avgFirstActionDays : null;
                      return (
                        <div
                          key={person.recruiterId}
                          className="grid h-14 grid-cols-[minmax(0,1fr)_50px_70px_120px] items-center gap-3 border-b border-[#F3F4F6] transition-all duration-150 ease-in-out hover:bg-[#FAFAFA]"
                          style={{
                            borderLeft: rank === 1 ? "2px solid #5B4FE8" : "2px solid transparent",
                            paddingLeft: rank === 1 ? "10px" : "12px",
                          }}
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <div className="font-sora text-xs font-bold" style={{ color: rankColor(rank) }}>
                              #{rank}
                            </div>
                            <div
                              className="flex h-8 w-8 flex-none items-center justify-center rounded-full font-sora text-xs font-bold text-white"
                              style={{ backgroundColor: avatarColorFromName(person.recruiterName) }}
                            >
                              {initialsFromName(person.recruiterName)}
                            </div>
                            <div className="min-w-0">
                              <div className="truncate font-sora text-sm font-semibold text-[#111827]">{person.recruiterName || "—"}</div>
                              <div className="truncate font-dm-sans text-xs text-[#9CA3AF]">N/A</div>
                            </div>
                          </div>
                          <div className="text-center font-dm-sans text-sm text-[#374151]">{formatCount(person.jobsPosted)}</div>
                          <div
                            className={`text-center font-dm-sans text-sm ${person.applicationsScreened > 0 ? "text-[#374151]" : "italic text-[#9CA3AF]"}`}
                          >
                            {person.applicationsScreened > 0 ? formatCount(person.applicationsScreened) : "N/A"}
                          </div>
                          <div className="flex justify-end">
                            <span
                              className="rounded-none border px-[10px] py-[3px] font-dm-sans text-[0.7rem] font-semibold"
                              style={timePillStyles(timeTone(timeValue))}
                            >
                              {formatDurationPill(timeValue)}
                            </span>
                          </div>
                        </div>
                      );
                    })}

                {!recruitersQuery.isLoading && recruiterRows.length === 0 ? (
                  <div className="py-8 text-center font-dm-sans text-sm text-[#9CA3AF]">No data available</div>
                ) : null}
              </div>
            </div>

            <div className={`${SURFACE_CLASS_NAME} p-5`}>
              <h2 className="font-sora text-base font-semibold text-[#111827]">Hiring Manager Performance</h2>
              <div className="mt-5">
                <div className="grid grid-cols-[minmax(0,1fr)_50px_70px_120px] items-center gap-3 border-b border-[#E4E7EF] pb-2">
                  <div className="font-dm-sans text-[0.68rem] uppercase tracking-[0.08em] text-[#9CA3AF]">MANAGER</div>
                  <div className="text-center font-dm-sans text-[0.68rem] uppercase tracking-[0.08em] text-[#9CA3AF]">JOBS</div>
                  <div className="text-center font-dm-sans text-[0.68rem] uppercase tracking-[0.08em] text-[#9CA3AF]">FEEDBACK</div>
                  <div className="text-right font-dm-sans text-[0.68rem] uppercase tracking-[0.08em] text-[#9CA3AF]">FEEDBACK TIME</div>
                </div>

                {hiringManagersQuery.isLoading
                  ? Array.from({ length: 3 }).map((_, index) => (
                      <div key={index} className="grid h-14 grid-cols-[minmax(0,1fr)_50px_70px_120px] items-center gap-3 border-b border-[#F3F4F6]">
                        <Skeleton className="h-8 w-40 rounded-none" />
                        <Skeleton className="mx-auto h-4 w-8 rounded-none" />
                        <Skeleton className="mx-auto h-4 w-10 rounded-none" />
                        <Skeleton className="ml-auto h-6 w-14 rounded-none" />
                      </div>
                    ))
                  : hiringManagerRows.map((person, index) => {
                      const rank = index + 1;
                      const timeValue = person.avgFeedbackDays > 0 ? person.avgFeedbackDays : null;
                      return (
                        <div
                          key={person.managerId}
                          className="grid h-14 grid-cols-[minmax(0,1fr)_50px_70px_120px] items-center gap-3 border-b border-[#F3F4F6] transition-all duration-150 ease-in-out hover:bg-[#FAFAFA]"
                          style={{
                            borderLeft: rank === 1 ? "2px solid #5B4FE8" : "2px solid transparent",
                            paddingLeft: rank === 1 ? "10px" : "12px",
                          }}
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <div className="font-sora text-xs font-bold" style={{ color: rankColor(rank) }}>
                              #{rank}
                            </div>
                            <div
                              className="flex h-8 w-8 flex-none items-center justify-center rounded-full font-sora text-xs font-bold text-white"
                              style={{ backgroundColor: avatarColorFromName(person.managerName) }}
                            >
                              {initialsFromName(person.managerName)}
                            </div>
                            <div className="min-w-0">
                              <div className="truncate font-sora text-sm font-semibold text-[#111827]">{person.managerName || "—"}</div>
                              <div className="truncate font-dm-sans text-xs text-[#9CA3AF]">N/A</div>
                            </div>
                          </div>
                          <div className="text-center font-dm-sans text-sm text-[#374151]">{formatCount(person.jobsAssigned)}</div>
                          <div className="text-center font-dm-sans text-sm text-[#374151]">{formatCount(person.feedbackGiven)}</div>
                          <div className="flex justify-end">
                            <span
                              className="rounded-none border px-[10px] py-[3px] font-dm-sans text-[0.7rem] font-semibold"
                              style={timePillStyles(timeTone(timeValue))}
                            >
                              {formatDurationPill(timeValue)}
                            </span>
                          </div>
                        </div>
                      );
                    })}

                {!hiringManagersQuery.isLoading && hiringManagerRows.length === 0 ? (
                  <div className="py-8 text-center font-dm-sans text-sm text-[#9CA3AF]">No data available</div>
                ) : null}
              </div>
            </div>
          </section>
        </div>
      </div>
    </Layout>
  );
}







