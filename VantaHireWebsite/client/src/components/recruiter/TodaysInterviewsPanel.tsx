import { useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { recruiterDashboardCopy } from "@/lib/internal-copy";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { DASHBOARD_EYEBROW, DASHBOARD_PANEL, DASHBOARD_PANEL_MUTED, DASHBOARD_TITLE } from "@/lib/dashboard-theme";
import { cn } from "@/lib/utils";

type InterviewStatus = "scheduled" | "upcoming" | "completed";

type InterviewItem = {
  id: string;
  applicationId: number;
  jobId: number;
  candidateName: string;
  jobTitle: string;
  interviewDate: string;
  interviewTime: string | null;
  stageLabel: string;
  aiFitLabel: string | null;
  avatarUrl?: string | null;
  status: InterviewStatus;
  ctaLabel: string;
  ctaHref: string;
};

type InterviewWeekDay = {
  date: string;
  count: number;
  dayLabel?: string;
  isSelected?: boolean;
  isToday: boolean;
};

type TodaysInterviewsResponse = {
  count: number;
  interviewDate?: string;
  week?: Array<{
    date: string;
    dayLabel: string;
    count: number;
    isSelected: boolean;
  }>;
  items: InterviewItem[];
};

type TodaysInterviewsPanelProps = {
  jobId: number | "all";
};

function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateKey(value: string): Date {
  const [rawYear = "0", rawMonth = "1", rawDay = "1"] = value.split("-");
  const year = Number(rawYear);
  const month = Number(rawMonth);
  const day = Number(rawDay);
  return new Date(year, month - 1, day);
}

function getCurrentWeekDays(): InterviewWeekDay[] {
  const today = new Date();
  const weekStart = new Date(today);
  const dayOffset = (weekStart.getDay() + 6) % 7;
  weekStart.setDate(weekStart.getDate() - dayOffset);
  weekStart.setHours(0, 0, 0, 0);

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + index);
    const dateKey = formatDateKey(date);
    return {
      date: dateKey,
      count: 0,
      dayLabel: date.toLocaleDateString("en-US", { weekday: "short" }),
      isToday: dateKey === formatDateKey(today),
    };
  });
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function splitInterviewTime(value: string | null): { time: string; meridiem: string } {
  if (!value) {
    return { time: "TBD", meridiem: "" };
  }

  const [time = value, meridiem = ""] = value.split(" ");
  return { time, meridiem };
}

function statusDotClass(status: InterviewStatus): string {
  if (status === "completed") return "bg-[#22C55E]";
  if (status === "upcoming") return "bg-[#F59E0B]";
  return "bg-[#4F46E5]";
}

function avatarFallbackClass(name: string): string {
  const palette = [
    "from-[#D7D2FE] to-[#B9AEFF]",
    "from-[#C8E7FF] to-[#9BD0FF]",
    "from-[#FBD3E9] to-[#E8B8FF]",
    "from-[#FFE5BD] to-[#FFD194]",
  ] as const;
  const index = name.length % palette.length;
  return `bg-gradient-to-br ${palette[index]} text-[#1F2937]`;
}

export function TodaysInterviewsPanel({ jobId }: TodaysInterviewsPanelProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const todayKey = useMemo(() => formatDateKey(new Date()), []);
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const isMobile = useIsMobile();

  const { data, isLoading, isFetching } = useQuery<TodaysInterviewsResponse>({
    queryKey: ["/api/recruiter-dashboard/todays-interviews", jobId, selectedDate],
    queryFn: async () => {
      const params = new URLSearchParams({
        jobId: jobId === "all" ? "all" : String(jobId),
        interviewDate: selectedDate,
      });
      const response = await apiRequest("GET", `/api/recruiter-dashboard/todays-interviews?${params.toString()}`);
      return response.json();
    },
    placeholderData: keepPreviousData,
  });

  const weekDays = useMemo(() => {
    const fallback = getCurrentWeekDays();
    if (!data?.week?.length) return fallback;
    return data.week.map((day) => ({
      date: day.date,
      dayLabel: day.dayLabel,
      count: day.count,
      isSelected: day.isSelected,
      isToday: day.date === todayKey,
    }));
  }, [data?.week, todayKey]);
  const items = data?.items ?? [];
  const count = data?.count ?? 0;

  useEffect(() => {
    if (!isMobile || !listRef.current) return;
    listRef.current.style.overflowY = "auto";
  }, [isMobile]);

  return (
    <section
      className={cn(
        DASHBOARD_PANEL,
        "interview-panel h-auto min-h-0 w-full rounded-[26px] bg-white/95 px-4 py-5 md:h-[492px] md:px-6 md:py-6",
      )}
    >
      <div className="flex items-center gap-4">
        <div className="space-y-2">
          <p className={DASHBOARD_EYEBROW}>{recruiterDashboardCopy.interviewsPanel.eyebrow}</p>
          <div className="flex items-center gap-3">
            <h2 className={cn(DASHBOARD_TITLE, "text-base")}>{recruiterDashboardCopy.interviewsPanel.title}</h2>
            <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-[#F1EEFF] px-2 text-[11px] font-medium text-[#5B4FF7]">
              {count}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] font-medium text-[#7B8497]">
        <span className="rounded-full bg-[#F3F4F8] px-3 py-1">{recruiterDashboardCopy.interviewsPanel.hint}</span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F8F9FC] px-3 py-1">
          <span className="h-2 w-2 rounded-full bg-[#4F46E5]" />
          {recruiterDashboardCopy.interviewsPanel.statuses.scheduled}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FFF6E8] px-3 py-1">
          <span className="h-2 w-2 rounded-full bg-[#F59E0B]" />
          {recruiterDashboardCopy.interviewsPanel.statuses.upcoming}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#EEF8F1] px-3 py-1">
          <span className="h-2 w-2 rounded-full bg-[#22C55E]" />
          {recruiterDashboardCopy.interviewsPanel.statuses.completed}
        </span>
      </div>

      <div className="mt-7 flex gap-3 overflow-x-auto overflow-y-hidden pb-1 md:grid md:grid-cols-7 md:gap-x-5 md:gap-y-4 md:overflow-visible">
        {weekDays.map((day) => {
          const date = parseDateKey(day.date);
          const isSelected = day.date === selectedDate;
          const isWeekend = date.getDay() === 0 || date.getDay() === 6;

          return (
            <button
              key={day.date}
              type="button"
              onClick={() => setSelectedDate(day.date)}
              className="flex min-w-[52px] shrink-0 flex-col items-center gap-2 text-center md:min-w-0"
            >
              <span
                className={cn(
                  "text-[10px] font-medium uppercase tracking-[0.12em]",
                  isWeekend ? "text-[#D0D4DE]" : "text-[#B3B8C4]",
                  (day.isSelected ?? isSelected) && "text-[#8E93A3]",
                )}
              >
                {day.dayLabel ?? date.toLocaleDateString("en-US", { weekday: "short" })}
              </span>
              <span
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full border text-[11px] font-medium leading-none transition-all md:h-[42px] md:w-[42px] md:text-[14px]",
                  isSelected
                    ? "border-[#5B4FF7] bg-[#5B4FF7] text-white shadow-[0_8px_18px_rgba(91,79,247,0.22)]"
                    : "border-[#ECEEF3] bg-[#FAFAFC] text-[#B8BDC8]",
                  !isSelected && isWeekend && "text-[#CDD1DA]",
                  isSelected && "font-semibold",
                )}
              >
                {date.getDate()}
              </span>
              <span className={cn("h-1 w-1 rounded-full", day.count > 0 ? "bg-[#5B4FF7]" : "bg-transparent")} />
            </button>
          );
        })}
      </div>

      <div
        ref={listRef}
        className={cn(
          "interview-list mt-6 space-y-4 overflow-y-auto pr-1 transition-[overflow,opacity] duration-150 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-[4px] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#C4C0FF] [&::-webkit-scrollbar-thumb:hover]:bg-[#6C63FF] [&::-webkit-scrollbar-track]:bg-transparent md:h-[272px] md:overflow-y-hidden md:hover:[scrollbar-color:#C4C0FF_transparent] md:[.interview-panel:hover_&]:overflow-y-auto xl:h-[248px]",
          isFetching && !isLoading && "opacity-70",
        )}
      >
        {isLoading ? (
          Array.from({ length: 2 }).map((_, index) => (
            <div key={index} className="flex items-center gap-4 rounded-[12px] border border-[#EEF0F4] bg-[#F8F8FA] px-4 py-4">
              <div className="w-[56px] animate-pulse">
                <div className="h-5 rounded bg-[#E5E7EB]" />
                <div className="mt-2 h-4 w-8 rounded bg-[#E5E7EB]" />
              </div>
              <div className="h-12 w-12 animate-pulse rounded-full bg-[#E5E7EB]" />
              <div className="flex-1">
                <div className="h-5 w-36 animate-pulse rounded bg-[#E5E7EB]" />
                <div className="mt-2 h-4 w-28 animate-pulse rounded bg-[#E5E7EB]" />
              </div>
            </div>
          ))
        ) : count === 0 || items.length === 0 ? (
          <div className="flex min-h-[180px] items-center justify-center rounded-[12px] border border-dashed border-[#E7E9F0] bg-[#FBFBFD] px-6 text-center">
            <p className="max-w-sm text-sm font-medium text-[#9AA1AF]">
              {recruiterDashboardCopy.interviewsPanel.empty}
            </p>
          </div>
        ) : (
          items.map((item) => {
            const { time, meridiem } = splitInterviewTime(item.interviewTime);
            const isPrimaryAction = item.ctaLabel === "Join Meeting";

            return (
              <div
                key={item.id}
                onClick={() => {
                  if (isMobile) {
                    window.location.assign(item.ctaHref);
                  }
                }}
                className={cn(
                  DASHBOARD_PANEL_MUTED,
                  "flex cursor-pointer items-start gap-3 px-4 py-3.5 transition-colors hover:bg-[#F3F4F8] md:items-center md:gap-4 md:px-5",
                )}
              >
                <div className="w-[58px] shrink-0 text-left">
                  <div className="interview-time text-[13px] font-semibold leading-[1.05] tracking-[-0.01em] text-[#374151]">
                    {time}
                  </div>
                  <div className="interview-time mt-1 text-[13px] font-medium leading-none text-[#6B7280]">{meridiem}</div>
                </div>

                <div className="flex min-w-0 flex-1 flex-col items-start gap-3 md:flex-row md:items-center md:gap-4">
                  <div className="relative shrink-0">
                    <Avatar className="h-[46px] w-[46px] border border-[#E5E7EB]">
                      <AvatarImage src={item.avatarUrl ?? undefined} alt={item.candidateName} className="object-cover" />
                      <AvatarFallback className={cn("text-[13px] font-semibold", avatarFallbackClass(item.candidateName))}>
                        {getInitials(item.candidateName)}
                      </AvatarFallback>
                    </Avatar>
                    <span
                      className={cn(
                        "absolute bottom-0 right-0 h-2 w-2 rounded-full border border-white",
                        statusDotClass(item.status),
                      )}
                    />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="interview-name truncate text-[16px] font-semibold leading-[1.25] tracking-[-0.02em] text-[#0F172A]">
                      {item.candidateName}
                    </div>
                    <div className="interview-role mt-0.5 truncate text-[13px] font-normal leading-[1.35] text-[#6B7280]">
                      {item.jobTitle}
                    </div>
                    {item.aiFitLabel && (
                      <span className="mt-2 inline-flex rounded-[6px] bg-[#EEEBFF] px-2.5 py-1 text-[11px] font-medium leading-none text-[#5B4FF7]">
                        {item.aiFitLabel}
                      </span>
                    )}
                  </div>
                </div>

                <div className="ml-auto flex shrink-0 items-center justify-end gap-4 md:gap-5">
                  <Button
                    asChild
                    className={cn(
                      "h-11 min-w-[44px] rounded-[10px] px-4 py-2 text-[13px] font-semibold leading-none shadow-none",
                      isPrimaryAction
                        ? "bg-[#5B4FF7] text-white hover:bg-[#4F46E5]"
                        : "border-0 bg-[#F0F0F0] text-[#4B5563] hover:bg-[#E9E9E9]",
                    )}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <a href={item.ctaHref}>{item.ctaLabel}</a>
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

