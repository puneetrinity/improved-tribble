import { useAuth } from "@/hooks/use-auth";
import { Redirect, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  Briefcase,
  Calendar,
  ClipboardCheck,
  MessageSquare,
  Sparkles,
  Users,
} from "lucide-react";
import Layout from "@/components/Layout";
import { ProfileCompletionBanner } from "@/components/ProfileCompletionBanner";
import { hiringManagerDashboardCopy } from "@/lib/internal-copy";
import {
  DASHBOARD_EYEBROW,
  DASHBOARD_PAGE_BACKGROUND,
  DASHBOARD_PANEL,
  DASHBOARD_PANEL_MUTED,
  DASHBOARD_SHELL_PANEL,
  DASHBOARD_TITLE,
} from "@/lib/dashboard-theme";
import { cn } from "@/lib/utils";

interface Job {
  id: number;
  title: string;
  location: string;
  type: string;
  createdAt: Date;
  isActive: boolean;
}

interface Application {
  id: number;
  name: string;
  email: string;
  appliedAt: Date | string;
  currentStage: number | null;
  jobId: number;
  hmFeedbackCount?: number;
  hmReviewRequestedAt?: Date | string | null;
  hmReviewNote?: string | null;
}

interface ApplicationWithJob extends Application {
  jobTitle: string;
}

export default function HiringManagerDashboard() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();

  if (!user || user.role !== "hiring_manager") {
    return <Redirect to="/recruiter-auth" />;
  }

  const { data: allJobs = [], isLoading: jobsLoading } = useQuery<Job[]>({
    queryKey: ["/api/hiring-manager/jobs"],
    queryFn: async () => {
      const response = await fetch("/api/hiring-manager/jobs");
      if (!response.ok) throw new Error("Failed to fetch jobs");
      return response.json();
    },
  });

  const myJobs = allJobs.filter((job: any) => job.hiringManagerId === user.id);

  const { data: allApplicationsData } = useQuery({
    queryKey: ["/api/hiring-manager/applications", myJobs.map((job) => job.id)],
    queryFn: async () => {
      if (myJobs.length === 0) return [];

      const applicationsPromises = myJobs.map(async (job) => {
        const response = await fetch(`/api/hiring-manager/jobs/${job.id}/applications`);
        if (!response.ok) throw new Error(`Failed to fetch applications for job ${job.id}`);
        const apps = await response.json();
        return apps.map((app: Application) => ({
          ...app,
          jobTitle: job.title,
        }));
      });

      const results = await Promise.all(applicationsPromises);
      return results.flat();
    },
    enabled: myJobs.length > 0,
  });

  const allApplications: ApplicationWithJob[] = allApplicationsData || [];
  const requestedReviewApplications = allApplications.filter((app) => !!app.hmReviewRequestedAt);
  const applicationsNeedingFeedback = requestedReviewApplications.filter(
    (app) => (app.hmFeedbackCount ?? 0) === 0
  );

  const handleViewJob = (jobId: number) => {
    setLocation(`/hiring-manager/jobs/${jobId}/review`);
  };

  return (
    <Layout>
      <div
        className={cn(DASHBOARD_PAGE_BACKGROUND, "hiring-manager-dashboard min-h-screen overflow-x-hidden px-4 pb-10 pt-6 md:px-8")}
        data-tour="hm-dashboard"
      >
        <div className="mx-auto max-w-[1500px] space-y-8">
          <div className="mt-0 space-y-6 pt-3">
            <div className={cn(DASHBOARD_SHELL_PANEL, "relative px-4 py-5 sm:px-6 sm:py-6 md:px-8 md:py-8")}>
              <div className="relative space-y-6">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                  <div className="space-y-3">
                    <p className={DASHBOARD_EYEBROW}>Hiring Manager Workspace</p>
                    <h1 className={cn(DASHBOARD_TITLE, "text-[28px] md:text-[34px]")}>
                      {hiringManagerDashboardCopy.header.title}
                    </h1>
                    <p className="max-w-2xl text-sm text-[#5F6675] md:text-[15px]">
                      {hiringManagerDashboardCopy.header.subtitlePrefix} {user.firstName || user.username}!{" "}
                      {hiringManagerDashboardCopy.header.subtitleSuffix}
                    </p>
                  </div>
                  <div className={cn(DASHBOARD_PANEL_MUTED, "max-w-md px-5 py-4 text-sm text-[#4B5563]")}>
                    <p className="font-semibold text-[#111827]">Recruiters send you a focused review queue.</p>
                    <p className="mt-1">
                      Open resumes, review recruiter notes, and leave structured decisions without taking over pipeline ownership.
                    </p>
                  </div>
                </div>

                <ProfileCompletionBanner />

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <Card className={cn(DASHBOARD_PANEL, "rounded-[26px] bg-white/95")}>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground">
                        {hiringManagerDashboardCopy.stats.myJobs}
                      </CardTitle>
                      <Briefcase className="h-4 w-4 text-info" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-foreground">{myJobs.length}</div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {hiringManagerDashboardCopy.stats.myJobsHint}
                      </p>
                    </CardContent>
                  </Card>

                  <Card className={cn(DASHBOARD_PANEL, "rounded-[26px] bg-white/95")}>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground">
                        {hiringManagerDashboardCopy.stats.totalCandidates}
                      </CardTitle>
                      <Users className="h-4 w-4 text-success" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-foreground">{allApplications.length}</div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {hiringManagerDashboardCopy.stats.totalCandidatesHint}
                      </p>
                    </CardContent>
                  </Card>

                  <Card className={cn(DASHBOARD_PANEL, "rounded-[26px] bg-white/95")}>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground">
                        {hiringManagerDashboardCopy.stats.requestedReviews}
                      </CardTitle>
                      <ClipboardCheck className="h-4 w-4 text-info" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-foreground">{requestedReviewApplications.length}</div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {hiringManagerDashboardCopy.stats.requestedReviewsHint}
                      </p>
                    </CardContent>
                  </Card>

                  <Card className={cn(DASHBOARD_PANEL, "rounded-[26px] bg-white/95")} data-tour="pending-feedback">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground">
                        {hiringManagerDashboardCopy.stats.awaitingFeedback}
                      </CardTitle>
                      <MessageSquare className="h-4 w-4 text-warning" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-foreground">
                        {applicationsNeedingFeedback.length}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {hiringManagerDashboardCopy.stats.awaitingFeedbackHint}
                      </p>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <section data-tour="my-jobs">
              <div className="mb-4 flex items-center gap-2">
                <div className={cn(DASHBOARD_PANEL_MUTED, "p-2 text-[#111827]")}>
                  <Briefcase className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-[#111827]">
                    {hiringManagerDashboardCopy.sections.myJobs}
                  </h2>
                  <p className="text-sm text-[#687182]">Roles assigned to you and their active review queues.</p>
                </div>
              </div>

          {jobsLoading ? (
                <Card className={cn(DASHBOARD_PANEL, "rounded-[26px] bg-white/95")}>
                  <CardContent className="py-12 text-center text-muted-foreground">
                    {hiringManagerDashboardCopy.sections.loadingJobs}
                  </CardContent>
                </Card>
          ) : myJobs.length === 0 ? (
                <Card className={cn(DASHBOARD_PANEL, "rounded-[26px] bg-white/95")}>
              <CardContent className="py-12 text-center">
                <Briefcase className="mx-auto mb-3 h-12 w-12 text-muted-foreground/50" />
                <p className="text-muted-foreground">{hiringManagerDashboardCopy.sections.emptyJobs}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {hiringManagerDashboardCopy.sections.emptyJobsHint}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {myJobs.map((job) => {
                const jobApplications = allApplications.filter((app) => app.jobId === job.id);
                const requestedReviewCount = jobApplications.filter((app) => !!app.hmReviewRequestedAt).length;
                const needingFeedback = jobApplications.filter(
                  (app) => !!app.hmReviewRequestedAt && (app.hmFeedbackCount ?? 0) === 0
                ).length;
                const hasReviewQueue = requestedReviewCount > 0;

                return (
                      <Card
                        key={job.id}
                        className={cn(DASHBOARD_PANEL, "rounded-[26px] bg-white/95 transition-all hover:-translate-y-0.5 hover:shadow-[0_18px_45px_rgba(15,23,42,0.08)]")}
                      >
                    <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
                      <div className="flex items-start gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <CardTitle className="text-base text-foreground">{job.title}</CardTitle>
                            {job.isActive && (
                              <Badge className="bg-success/20 text-success-foreground hover:bg-success/20">
                                Active
                              </Badge>
                            )}
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {job.location} • {job.type}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 sm:gap-4">
                        <div className={cn(DASHBOARD_PANEL_MUTED, "px-4 py-2.5 text-center")}>
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">Candidates</p>
                          <p className="mt-0.5 text-lg font-semibold text-foreground">{jobApplications.length}</p>
                        </div>
                        <div className={cn(DASHBOARD_PANEL_MUTED, "px-4 py-2.5 text-center")}>
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">Requested</p>
                          <p className="mt-0.5 text-lg font-semibold text-foreground">{requestedReviewCount}</p>
                        </div>

                        {needingFeedback > 0 ? (
                          <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
                            <span className="text-amber-900">Awaiting your feedback</span>
                            <Badge variant="outline" className="border-warning/30 bg-warning/10 text-warning-foreground">
                              {needingFeedback}
                            </Badge>
                          </div>
                        ) : hasReviewQueue ? (
                          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                            All reviewed
                          </div>
                        ) : (
                          <div className="rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
                            No review requested
                          </div>
                        )}

                        <Button
                          onClick={() => handleViewJob(job.id)}
                          className="h-11 rounded-2xl"
                          variant={hasReviewQueue ? "default" : "outline"}
                          disabled={!hasReviewQueue}
                        >
                          {hasReviewQueue ? "Review Requested Candidates" : "No Review Requested"}
                          <ArrowRight className="ml-2 h-4 w-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
            </section>

            <section>
              <div className="mb-4 flex items-center gap-2">
                <div className={cn(DASHBOARD_PANEL_MUTED, "p-2 text-[#111827]")}>
                  <MessageSquare className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-[#111827]">Candidates Awaiting Your Feedback</h2>
                  <p className="text-sm text-[#687182]">Pending recruiter requests that still need your recommendation.</p>
                </div>
              </div>

          {applicationsNeedingFeedback.length === 0 ? (
                <Card className={cn(DASHBOARD_PANEL, "rounded-[26px] bg-white/95")}>
              <CardContent className="py-12 text-center">
                <MessageSquare className="mx-auto mb-3 h-12 w-12 text-muted-foreground/50" />
                <p className="text-muted-foreground">No recruiter-requested reviews are waiting on you.</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Once recruiters flag candidates for your review, they will appear here.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {applicationsNeedingFeedback.map((app) => (
                    <Card
                      key={app.id}
                      className={cn(DASHBOARD_PANEL, "rounded-[26px] bg-white/95 transition-all hover:-translate-y-0.5 hover:shadow-[0_18px_45px_rgba(15,23,42,0.08)]")}
                    >
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex-1">
                        <div className="mb-2 flex items-center gap-3">
                          <h3 className="font-medium text-foreground">{app.name}</h3>
                          <Badge variant="outline" className="text-xs">
                            {app.jobTitle}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                          <span>{app.email}</span>
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {new Date(app.appliedAt).toLocaleDateString()}
                          </span>
                        </div>
                        {app.hmReviewNote ? (
                          <p className="mt-3 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-foreground">
                            <span className="font-medium">Recruiter note:</span> {app.hmReviewNote}
                          </p>
                        ) : null}
                      </div>
                      <Button onClick={() => handleViewJob(app.jobId)} size="sm">
                        Review
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
            </section>
          </div>
        </div>
      </div>
    </Layout>
  );
}
