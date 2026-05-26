import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import Layout from "@/components/Layout";
import type { Job, Application, PipelineStage } from "@shared/schema";
import { StageFunnel } from "@/components/dashboards/StageFunnel";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { DASHBOARD_EYEBROW, DASHBOARD_PAGE_BACKGROUND, DASHBOARD_SHELL_PANEL, DASHBOARD_TITLE } from "@/lib/dashboard-theme";
import { recruiterDashboardCopy } from "@/lib/internal-copy";
import { cn } from "@/lib/utils";
import { Mail, Send, Loader2, ChevronDown, Plus } from "lucide-react";
import { RecruiterKpiRibbon } from "@/components/recruiter/RecruiterKpiRibbon";
import type { RecruiterDashboardKpiResponse } from "@/components/recruiter/RecruiterKpiRibbon";
import { AIActionsPanel } from "@/components/recruiter/AIActionsPanel";
import { TodaysInterviewsPanel } from "@/components/recruiter/TodaysInterviewsPanel";
import { ProfileCompletionBanner } from "@/components/ProfileCompletionBanner";
import { useSubscription } from "@/hooks/use-subscription";
import BrandedLoadingScreen from "@/components/internal/BrandedLoadingScreen";
// Extended types for API responses with relations
type ApplicationWithJob = Application & {
  job?: { title: string };
};

type JobWithCounts = Job & {
  company?: string;
  applicationCount?: number;
  clientName?: string | null;
};

const RANGE_PRESETS: Record<string, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

function isClosedStageStatus(status: string, stageName = ""): boolean {
  return (
    status === "rejected" ||
    status === "hired" ||
    stageName.includes("rejected") ||
    stageName.includes("hired")
  );
}

export default function RecruiterDashboard() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [rangePreset, setRangePreset] = useState<keyof typeof RANGE_PRESETS>("30d");
  const [selectedJobId, setSelectedJobId] = useState<number | "all">("all");

  // Fetch subscription to show plan badge
  const { data: subscriptionData } = useSubscription();
  const planName = subscriptionData?.plan?.displayName || "Free";

  // Hiring Manager Invitation state
  const [showInviteHMDialog, setShowInviteHMDialog] = useState(false);
  const [inviteHMEmail, setInviteHMEmail] = useState("");
  const [inviteHMName, setInviteHMName] = useState("");

  // Invite hiring manager mutation
  const inviteHiringManagerMutation = useMutation({
    mutationFn: async (data: { email: string; name?: string }) => {
      const res = await apiRequest("POST", "/api/hiring-manager-invitations", data);
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: recruiterDashboardCopy.toasts.inviteSuccessTitle,
        description: `Invitation sent to ${inviteHMEmail}`,
      });
      setShowInviteHMDialog(false);
      setInviteHMEmail("");
      setInviteHMName("");
    },
    onError: (error: Error) => {
      toast({
        title: recruiterDashboardCopy.toasts.inviteErrorTitle,
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Fetch recruiter's jobs
  const { data: jobs = [], isLoading: jobsLoading } = useQuery<JobWithCounts[]>({
    queryKey: ["/api/my-jobs"],
  });

  // Fetch all applications for recruiter's jobs
  const { data: applications = [], isLoading: applicationsLoading } = useQuery<ApplicationWithJob[]>({
    queryKey: ["/api/my-applications-received"],
  });

  // Fetch pipeline stages
  const { data: pipelineStages = [], isLoading: stagesLoading } = useQuery<PipelineStage[]>({
    queryKey: ["/api/pipeline/stages"],
  });

  const days = RANGE_PRESETS[rangePreset] ?? 30;
  const dateEnd = useMemo(() => new Date(), [rangePreset]);
  const dateStart = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d;
  }, [days]);

  const filteredJobs = useMemo(() => {
    if (selectedJobId === "all") return jobs;
    return jobs.filter((job) => job.id === selectedJobId);
  }, [jobs, selectedJobId]);

  const currentApplications = useMemo(() => {
    return applications.filter((app) =>
      selectedJobId === "all" ? true : app.jobId === selectedJobId,
    );
  }, [applications, selectedJobId]);

  const filteredApplications = useMemo(() => {
    return currentApplications.filter((app) => {
      const appliedAt = new Date(app.appliedAt);
      return appliedAt >= dateStart && appliedAt <= dateEnd;
    });
  }, [currentApplications, dateStart, dateEnd]);

  const selectedJobParam = selectedJobId === "all" ? null : selectedJobId;
  const kpiQueryString = useMemo(() => {
    const params = new URLSearchParams({ range: rangePreset });
    if (selectedJobParam != null) {
      params.set("jobId", String(selectedJobParam));
    }
    return params.toString();
  }, [rangePreset, selectedJobParam]);

  const { data: recruiterKpis, isLoading: kpisLoading } = useQuery<RecruiterDashboardKpiResponse>({
    queryKey: [`/api/recruiter-dashboard/kpis?${kpiQueryString}`],
  });

  const pipelineHealthScore = useMemo(
    () => ({
      score: recruiterKpis?.cards.pipelineHealth.value ?? 0,
      tag: recruiterKpis?.cards.pipelineHealth.contextLine ?? "—",
      isEmpty: !recruiterKpis?.cards.pipelineHealth.displayValue,
    }),
    [recruiterKpis],
  );

  const stats = useMemo(
    () => ({
      activeJobs: recruiterKpis?.cards.activeRoles.value ?? 0,
      newToday: recruiterKpis?.cards.todaysApplications.value ?? 0,
      avgFirstReview: recruiterKpis?.cards.firstReviewTime.value ?? null,
      interviewConv: recruiterKpis?.cards.screenToInterview.value ?? 0,
    }),
    [recruiterKpis],
  );

  const appsTrend = useMemo(
    () => ({
      trend: recruiterKpis?.cards.todaysApplications.trendDirection ?? "flat",
      value:
        recruiterKpis?.cards.todaysApplications.trendDelta == null
          ? ""
          : `${recruiterKpis.cards.todaysApplications.trendDelta > 0 ? "+" : ""}${recruiterKpis.cards.todaysApplications.trendDelta}%`,
    }),
    [recruiterKpis],
  );

  const timeSeriesData = useMemo(() => {
    const buckets: Record<string, number> = {};
    const cursor = new Date(dateStart);
    while (cursor <= dateEnd) {
      const key = cursor.toISOString().slice(0, 10);
      buckets[key] = 0;
      cursor.setDate(cursor.getDate() + 1);
    }
    filteredApplications.forEach((app) => {
      const dateKey = new Date(app.appliedAt).toISOString().slice(0, 10);
      if (buckets[dateKey] !== undefined) buckets[dateKey] += 1;
    });
    return Object.entries(buckets)
      .map(([date, value]) => ({ date, value }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [filteredApplications, dateStart, dateEnd]);

  const funnelData = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredApplications.forEach((app) => {
      const key = app.currentStage ? String(app.currentStage) : "unassigned";
      counts[key] = (counts[key] || 0) + 1;
    });

    // The recruiter dashboard should only visualize stages that are actually
    // in play for the current recruiter/job filter, not the org's full stage catalog.
    const sortedStages = [...pipelineStages].sort((a, b) => (a.order - b.order) || (a.id - b.id));
    const mapped = sortedStages
      .filter((stage) => (counts[String(stage.id)] || 0) > 0)
      .map((stage) => ({
        name: stage.name,
        count: counts[String(stage.id)] || 0,
        color: stage.color || "#64748b",
        order: stage.order,
        stageId: stage.id,
      }));
    const unassigned = counts["unassigned"]
      ? [{ name: "Unassigned", count: counts["unassigned"], color: "#94a3b8", order: -1 }]
      : [];
    return [...unassigned, ...mapped];
  }, [filteredApplications, pipelineStages]);



  const kpiItems = useMemo(
    () => [
      {
        label: recruiterDashboardCopy.kpis.pipelineHealth.label,
        value: pipelineHealthScore.isEmpty ? "—" : `${pipelineHealthScore.score}%`,
        hint: pipelineHealthScore.isEmpty ? recruiterDashboardCopy.kpis.pipelineHealth.emptyHint : pipelineHealthScore.tag,
        trend: pipelineHealthScore.isEmpty ? "flat" as const : pipelineHealthScore.score >= 70 ? "up" as const : pipelineHealthScore.score >= 50 ? "flat" as const : "down" as const,
        tooltip: recruiterDashboardCopy.kpis.pipelineHealth.tooltip,
        variant: "pipeline" as const,
      },
      {
        label: recruiterDashboardCopy.kpis.activeRoles.label,
        value: stats.activeJobs,
        secondary: recruiterDashboardCopy.kpis.activeRoles.secondary,
        tooltip: recruiterDashboardCopy.kpis.activeRoles.tooltip,
        variant: "roles" as const,
      },
      {
        label: recruiterDashboardCopy.kpis.todaysApps.label,
        value: stats.newToday ?? 0,
        trend: appsTrend.trend,
        trendValue: appsTrend.value || undefined,
        tooltip: recruiterDashboardCopy.kpis.todaysApps.tooltip,
        variant: "apps" as const,
      },
      {
        label: recruiterDashboardCopy.kpis.firstReview.label,
        value: stats.avgFirstReview != null ? `${stats.avgFirstReview}d` : "—",
        trend: stats.avgFirstReview != null && stats.avgFirstReview <= 2 ? "up" as const : stats.avgFirstReview != null && stats.avgFirstReview > 4 ? "down" as const : "flat" as const,
        secondary: recruiterDashboardCopy.kpis.firstReview.secondary,
        tooltip: recruiterDashboardCopy.kpis.firstReview.tooltip,
        variant: "review" as const,
      },
      {
        label: recruiterDashboardCopy.kpis.toInterview.label,
        value: `${stats.interviewConv}%`,
        trend: stats.interviewConv >= 30 ? "up" as const : stats.interviewConv >= 15 ? "flat" as const : "down" as const,
        tooltip: recruiterDashboardCopy.kpis.toInterview.tooltip,
        variant: "interview" as const,
        secondary: recruiterDashboardCopy.kpis.toInterview.secondary,
      },
    ],
    [stats, pipelineHealthScore, appsTrend]
  );

  const handleStageClick = (stage: { stageId?: number; name: string }) => {
    const params = new URLSearchParams();
    if (stage.stageId) {
      params.set("stage", String(stage.stageId));
    } else if (stage.name.toLowerCase() === "unassigned") {
      params.set("stage", "unassigned");
    }
    // TODO: Pass date range filters when the applications page supports them.
    const basePath = selectedJobId === "all" ? "/applications" : `/jobs/${selectedJobId}/applications`;
    const query = params.toString();
    setLocation(query ? `${basePath}?${query}` : basePath);
  };

  if (jobsLoading || applicationsLoading) {
    return (
      <Layout>
        <div className={cn(DASHBOARD_PAGE_BACKGROUND, "min-h-screen px-4 py-16 md:px-8")}>
          <BrandedLoadingScreen label="Loading your Flow dashboard..." />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="recruiter-dashboard min-h-screen overflow-x-hidden bg-white px-4 pb-10 pt-6 md:px-8">
        <div className="mx-auto max-w-[1500px] space-y-8">
          {/* Header + filters + KPIs */}
          <div className="mt-0 space-y-6 pt-3">
            <div className={cn(DASHBOARD_SHELL_PANEL, "relative px-4 py-5 sm:px-6 sm:py-6 md:px-8 md:py-8")} data-tour="dashboard-metrics">
              <div className="relative space-y-6">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                  <div className="space-y-3">
                    <p className={DASHBOARD_EYEBROW}>{recruiterDashboardCopy.header.eyebrow}</p>
                    <div className="flex flex-wrap items-center gap-3">
                      <h1 className={cn(DASHBOARD_TITLE, "text-[28px] md:text-[34px]")}>{recruiterDashboardCopy.header.title}</h1>
                      <Badge variant="outline" className="rounded-full border-[#D8DBE6] bg-white/80 px-3 py-1 text-xs font-semibold text-[#4B8EF0]">
                    {planName} Plan
                  </Badge>
                    </div>
                    <p className="max-w-2xl text-sm text-[#5F6675] md:text-[15px]">
                      {recruiterDashboardCopy.header.subtitle}
                    </p>
                  </div>
                  <div className="flex flex-col items-stretch gap-3 sm:items-end">
                    <Button
                      size="sm"
                      onClick={() => setLocation("/jobs/post")}
                      className="h-11 rounded-2xl bg-[#4B8EF0] px-5 text-[0.875rem] font-semibold text-white shadow-[0_10px_22px_rgba(75,142,240,0.22)] hover:bg-[#3679DB]"
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Post New Job
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowInviteHMDialog(true)}
                      data-tour="invite-hiring-manager-btn"
                      className="h-11 rounded-2xl border-[#D9DDEA] bg-white px-5 text-[0.875rem] font-semibold text-[#1F2937] shadow-[0_8px_18px_rgba(15,23,42,0.05)] hover:bg-[#F7F8FC]"
                    >
                      <Mail className="mr-2 h-4 w-4" />
                      {recruiterDashboardCopy.header.inviteHiringManager}
                    </Button>
                  </div>
                </div>

                <ProfileCompletionBanner />

                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="text-sm text-[#687182]">
                    {recruiterDashboardCopy.header.filterSummaryPrefix}{" "}
                    <span className="font-semibold text-[#111827]">
                      Last {RANGE_PRESETS[rangePreset]} days
                    </span>{" "}
                    ·{" "}
                    <span className="font-semibold text-[#111827]">
                      {selectedJobId === "all" ? recruiterDashboardCopy.header.allJobsLabel : `Job #${selectedJobId}`}
                    </span>
                  </div>
                  <div className="flex w-full flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end md:w-auto">
                    <Select value={rangePreset} onValueChange={(val) => setRangePreset(val as keyof typeof RANGE_PRESETS)}>
                      <SelectTrigger className="h-11 w-full min-w-0 rounded-2xl border-[#E5E7EB] bg-[#FAFAFB] px-5 text-[0.95rem] font-semibold text-[#111827] shadow-[0_3px_10px_rgba(15,23,42,0.04)] sm:w-[164px] [&>svg]:hidden">
                        <SelectValue placeholder={recruiterDashboardCopy.filters.dateRangePlaceholder} />
                        <ChevronDown className="h-4 w-4 text-[#4B5563]" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="7d">{recruiterDashboardCopy.filters.last7Days}</SelectItem>
                        <SelectItem value="30d">{recruiterDashboardCopy.filters.last30Days}</SelectItem>
                        <SelectItem value="90d">{recruiterDashboardCopy.filters.last90Days}</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select
                      value={selectedJobId === "all" ? "all" : String(selectedJobId)}
                      onValueChange={(val) => setSelectedJobId(val === "all" ? "all" : Number(val))}
                    >
                      <SelectTrigger className="h-11 w-full min-w-0 rounded-2xl border-[#E5E7EB] bg-[#FAFAFB] px-5 text-[0.95rem] font-semibold text-[#111827] shadow-[0_3px_10px_rgba(15,23,42,0.04)] sm:w-[154px] [&>svg]:hidden">
                        <SelectValue placeholder={recruiterDashboardCopy.filters.allJobsPlaceholder} />
                        <ChevronDown className="h-4 w-4 text-[#4B5563]" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{recruiterDashboardCopy.header.allJobsLabel}</SelectItem>
                        {jobs.map((job) => (
                          <SelectItem key={job.id} value={String(job.id)}>
                            {job.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <RecruiterKpiRibbon data={recruiterKpis} isLoading={kpisLoading} />
              </div>
            </div>
          </div>

          {/* Interviews + AI Actions */}
          <div className="grid grid-cols-1 items-stretch gap-6 md:grid-cols-2">
            <div>
              <TodaysInterviewsPanel jobId={selectedJobId} />
            </div>
            <div data-tour="pipeline-checklist">
              <AIActionsPanel range={rangePreset} jobId={selectedJobId} />
            </div>
          </div>

          <div className="grid gri  d-cols-1 gap-6">
            <div data-tour="stage-funnel">
              <StageFunnel
                title="Pipeline Stage Distribution"
                data={funnelData}
                isLoading={applicationsLoading || stagesLoading}
                onStageClick={handleStageClick}
                rangePreset={rangePreset}
                selectedJobId={selectedJobId}
                applications={currentApplications}
                pipelineStages={pipelineStages}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Invite Hiring Manager Dialog */}
      <Dialog open={showInviteHMDialog} onOpenChange={setShowInviteHMDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{recruiterDashboardCopy.inviteDialog.title}</DialogTitle>
            <DialogDescription>
              {recruiterDashboardCopy.inviteDialog.description}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label htmlFor="hm-email" className="text-sm font-medium">
                {recruiterDashboardCopy.inviteDialog.emailLabel} <span className="text-destructive">*</span>
              </label>
              <Input
                id="hm-email"
                type="email"
                placeholder={recruiterDashboardCopy.inviteDialog.emailPlaceholder}
                value={inviteHMEmail}
                onChange={(e) => setInviteHMEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="hm-name" className="text-sm font-medium">
                {recruiterDashboardCopy.inviteDialog.nameLabel} <span className="text-muted-foreground">{recruiterDashboardCopy.inviteDialog.optionalLabel}</span>
              </label>
              <Input
                id="hm-name"
                placeholder={recruiterDashboardCopy.inviteDialog.namePlaceholder}
                value={inviteHMName}
                onChange={(e) => setInviteHMName(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowInviteHMDialog(false);
                setInviteHMEmail("");
                setInviteHMName("");
              }}
            >
              {recruiterDashboardCopy.inviteDialog.cancelLabel}
            </Button>
            <Button
              onClick={() => {
                if (!inviteHMEmail) {
                  toast({
                    title: recruiterDashboardCopy.inviteDialog.emailRequiredTitle,
                    description: recruiterDashboardCopy.inviteDialog.emailRequiredDescription,
                    variant: "destructive",
                  });
                  return;
                }
                const data: { email: string; name?: string } = { email: inviteHMEmail };
                if (inviteHMName.trim()) {
                  data.name = inviteHMName.trim();
                }
                inviteHiringManagerMutation.mutate(data);
              }}
              disabled={inviteHiringManagerMutation.isPending}
            >
              {inviteHiringManagerMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {recruiterDashboardCopy.inviteDialog.submittingLabel}
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  {recruiterDashboardCopy.inviteDialog.submitLabel}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
