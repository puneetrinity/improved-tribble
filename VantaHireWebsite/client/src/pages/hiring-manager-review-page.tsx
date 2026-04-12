import { useEffect, useMemo, useState } from "react";
import { Redirect, useLocation, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Briefcase,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Download,
  ExternalLink,
  FileText,
  MessageSquare,
  Sparkles,
  UserRound,
} from "lucide-react";
import Layout from "@/components/Layout";
import { FeedbackPanel } from "@/components/FeedbackPanel";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { hiringManagerReviewPageCopy } from "@/lib/internal-copy";
import {
  DASHBOARD_EYEBROW,
  DASHBOARD_PAGE_BACKGROUND,
  DASHBOARD_PANEL,
  DASHBOARD_PANEL_MUTED,
  DASHBOARD_SHELL_PANEL,
  DASHBOARD_TITLE,
} from "@/lib/dashboard-theme";
import { cn } from "@/lib/utils";

interface HiringManagerJob {
  id: number;
  title: string;
  location: string;
  type: string;
  hiringManagerId: number;
  isActive: boolean;
}

interface HiringManagerApplication {
  id: number;
  name: string;
  email: string;
  phone?: string | null;
  status: string;
  appliedAt: Date | string;
  currentStage: number | null;
  jobId: number;
  stageName?: string | null;
  hmFeedbackCount?: number;
  hmReviewRequestedAt?: Date | string | null;
  hmReviewNote?: string | null;
  resumeFilename?: string | null;
}

export default function HiringManagerReviewPage() {
  const [match, params] = useRoute("/hiring-manager/jobs/:id/review");
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const [selectedApplicationId, setSelectedApplicationId] = useState<number | null>(null);

  const jobId = params?.id ? parseInt(params.id, 10) : null;

  if (!user || user.role !== "hiring_manager") {
    return <Redirect to="/recruiter-auth" />;
  }

  if (!match || !jobId || Number.isNaN(jobId)) {
    return <Redirect to="/hiring-manager" />;
  }

  const { data: jobs = [], isLoading: jobsLoading } = useQuery<HiringManagerJob[]>({
    queryKey: ["/api/hiring-manager/jobs"],
    queryFn: async () => {
      const response = await fetch("/api/hiring-manager/jobs", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch hiring manager jobs");
      return response.json();
    },
  });

  const job = useMemo(
    () => jobs.find((candidateJob) => candidateJob.id === jobId) ?? null,
    [jobs, jobId]
  );

  const {
    data: applications = [],
    isLoading: applicationsLoading,
    isError: applicationsError,
  } = useQuery<HiringManagerApplication[]>({
    queryKey: ["/api/hiring-manager/jobs", jobId, "applications"],
    queryFn: async () => {
      const response = await fetch(`/api/hiring-manager/jobs/${jobId}/applications`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch job applications");
      return response.json();
    },
    enabled: !!job,
  });

  const requestedApplications = useMemo(
    () => applications.filter((application) => !!application.hmReviewRequestedAt),
    [applications]
  );

  useEffect(() => {
    if (requestedApplications.length === 0) {
      setSelectedApplicationId(null);
      return;
    }

    const stillSelected = requestedApplications.some(
      (application) => application.id === selectedApplicationId
    );
    if (stillSelected) return;

    const nextSelection =
      requestedApplications.find((application) => (application.hmFeedbackCount ?? 0) === 0) ??
      requestedApplications[0];
    setSelectedApplicationId(nextSelection?.id ?? null);
  }, [requestedApplications, selectedApplicationId]);

  const selectedApplication =
    requestedApplications.find((application) => application.id === selectedApplicationId) ?? null;
  const awaitingFeedbackCount = requestedApplications.filter(
    (application) => (application.hmFeedbackCount ?? 0) === 0
  ).length;
  const reviewedCount = requestedApplications.length - awaitingFeedbackCount;

  const resumeBaseUrl = selectedApplication
    ? `/api/applications/${selectedApplication.id}/resume`
    : null;
  const resumePreviewUrl = resumeBaseUrl ? `${resumeBaseUrl}?inline=1` : null;
  const resumeDownloadUrl = resumeBaseUrl ? `${resumeBaseUrl}?download=1` : null;
  const canInlinePreview = !!selectedApplication?.resumeFilename?.toLowerCase().endsWith(".pdf");

  const isLoading = jobsLoading || (Boolean(job) && applicationsLoading);

  return (
    <Layout>
      <div
        className={cn(DASHBOARD_PAGE_BACKGROUND, "hiring-manager-review min-h-screen overflow-x-hidden px-4 pb-10 pt-6 md:px-8")}
      >
        <div className="mx-auto max-w-[1500px] space-y-8">
          <div className="mt-0 space-y-6 pt-3">
            <div className={cn(DASHBOARD_SHELL_PANEL, "relative px-4 py-5 sm:px-6 sm:py-6 md:px-8 md:py-8")}>
              <div className="relative space-y-6">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                  <div className="space-y-3">
                    <p className={DASHBOARD_EYEBROW}>Recruiter-Requested Review Queue</p>
                    <h1 className={cn(DASHBOARD_TITLE, "text-[28px] md:text-[34px]")}>
                      {hiringManagerReviewPageCopy.header.title}
                    </h1>
                    <p className="max-w-2xl text-sm text-[#5F6675] md:text-[15px]">
                      {hiringManagerReviewPageCopy.header.subtitle}
                    </p>
                  </div>
                  <div className={cn(DASHBOARD_PANEL_MUTED, "max-w-md px-5 py-4 text-sm text-[#4B5563]")}>
                    <p className="font-semibold text-[#111827]">Your job here is evaluation, not pipeline control.</p>
                    <p className="mt-1">
                      Open recruiter-requested candidates, inspect resumes, and record a clear recommendation for the recruiting team.
                    </p>
                  </div>
                </div>

                {job && (
                  <Card className={cn(DASHBOARD_PANEL, "rounded-[26px] bg-white/95")}>
                    <CardContent className="flex flex-col gap-4 p-6 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <Briefcase className="h-4 w-4 text-info" />
                          <p className="font-semibold text-foreground">{job.title}</p>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {job.location} • {job.type}
                        </p>
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <Card className={cn(DASHBOARD_PANEL_MUTED, "shadow-none")}>
                          <CardContent className="p-4">
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">
                              {hiringManagerReviewPageCopy.stats.totalCandidates}
                            </p>
                            <p className="mt-1 text-2xl font-bold text-foreground">{applications.length}</p>
                          </CardContent>
                        </Card>
                        <Card className={cn(DASHBOARD_PANEL_MUTED, "shadow-none")}>
                          <CardContent className="p-4">
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">
                              {hiringManagerReviewPageCopy.stats.requestedReviews}
                            </p>
                            <p className="mt-1 text-2xl font-bold text-foreground">{requestedApplications.length}</p>
                          </CardContent>
                        </Card>
                        <Card className={cn(DASHBOARD_PANEL_MUTED, "shadow-none")}>
                          <CardContent className="p-4">
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">
                              {hiringManagerReviewPageCopy.stats.awaitingFeedback}
                            </p>
                            <p className="mt-1 text-2xl font-bold text-foreground">{awaitingFeedbackCount}</p>
                          </CardContent>
                        </Card>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          </div>

          <div className="mb-2">
          <Button
            variant="ghost"
            className="w-fit px-0 text-[#687182] hover:text-[#111827]"
            onClick={() => setLocation("/hiring-manager")}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            {hiringManagerReviewPageCopy.header.back}
          </Button>
          </div>

        {!jobsLoading && !job ? (
            <Card className={cn(DASHBOARD_PANEL, "rounded-[26px] bg-white/95")}>
            <CardContent className="py-12 text-center">
              <Briefcase className="mx-auto mb-3 h-12 w-12 text-muted-foreground/50" />
              <p className="text-foreground">{hiringManagerReviewPageCopy.sections.inaccessibleJob}</p>
            </CardContent>
          </Card>
        ) : isLoading ? (
            <Card className={cn(DASHBOARD_PANEL, "rounded-[26px] bg-white/95")}>
            <CardContent className="py-12 text-center text-muted-foreground">
              {hiringManagerReviewPageCopy.sections.loading}
            </CardContent>
          </Card>
        ) : applicationsError ? (
            <Card className={cn(DASHBOARD_PANEL, "rounded-[26px] bg-white/95")}>
            <CardContent className="py-12 text-center">
              <MessageSquare className="mx-auto mb-3 h-12 w-12 text-muted-foreground/50" />
              <p className="text-foreground">Unable to load candidates for this job.</p>
              <p className="mt-1 text-sm text-muted-foreground">Please try again from your dashboard.</p>
            </CardContent>
          </Card>
        ) : requestedApplications.length === 0 ? (
            <Card className={cn(DASHBOARD_PANEL, "rounded-[26px] bg-white/95")}>
            <CardContent className="py-12 text-center">
              <ClipboardCheck className="mx-auto mb-3 h-12 w-12 text-muted-foreground/50" />
              <p className="text-foreground">{hiringManagerReviewPageCopy.sections.noRequestedReviews}</p>
              <p className="mt-1 text-sm text-muted-foreground">{hiringManagerReviewPageCopy.sections.noRequestedReviewsHint}</p>
            </CardContent>
          </Card>
        ) : (
            <div className="grid gap-6 lg:grid-cols-[420px_minmax(0,1fr)]">
              <Card className={cn(DASHBOARD_PANEL, "rounded-[26px] bg-white/95")}>
              <CardHeader>
                <CardTitle>{hiringManagerReviewPageCopy.sections.candidates}</CardTitle>
                <CardDescription>
                  Recruiter-selected candidates waiting for your evaluation.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {requestedApplications.map((application) => {
                  const hasFeedback = (application.hmFeedbackCount ?? 0) > 0;
                  const isSelected = application.id === selectedApplicationId;

                  return (
                    <button
                      key={application.id}
                      type="button"
                      onClick={() => setSelectedApplicationId(application.id)}
                        className={`w-full rounded-[22px] border p-4 text-left transition-colors ${
                        isSelected
                            ? "border-[#C9D6F2] bg-[#F8FAFC]"
                            : cn(DASHBOARD_PANEL_MUTED, "border-[#E7E9F0] bg-white hover:border-[#D8DBE6] hover:bg-[#FAFAFB]")
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium text-foreground">{application.name}</p>
                          <p className="truncate text-sm text-muted-foreground">{application.email}</p>
                        </div>
                        <Badge variant={hasFeedback ? "secondary" : "outline"}>
                          {hasFeedback
                            ? hiringManagerReviewPageCopy.sections.alreadyReviewed
                            : hiringManagerReviewPageCopy.sections.awaitingFeedback}
                        </Badge>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                        {application.stageName ? (
                          <span className="flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" />
                            {application.stageName}
                          </span>
                        ) : null}
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {new Date(application.appliedAt).toLocaleDateString()}
                        </span>
                        {application.hmReviewRequestedAt ? (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            Requested {new Date(application.hmReviewRequestedAt).toLocaleDateString()}
                          </span>
                        ) : null}
                      </div>

                      {application.hmReviewNote ? (
                          <p className={cn(DASHBOARD_PANEL_MUTED, "mt-3 px-3 py-2 text-sm text-foreground")}>
                          <span className="font-medium">Recruiter note:</span> {application.hmReviewNote}
                        </p>
                      ) : null}
                    </button>
                  );
                })}
              </CardContent>
            </Card>

            <div className="space-y-4">
              {selectedApplication ? (
                <>
                    <Card className={cn(DASHBOARD_PANEL, "rounded-[26px] bg-white/95")}>
                    <CardHeader>
                      <CardTitle>{selectedApplication.name}</CardTitle>
                      <CardDescription>{selectedApplication.email}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex flex-wrap gap-2">
                        {selectedApplication.phone ? (
                          <Badge variant="outline">{selectedApplication.phone}</Badge>
                        ) : null}
                        {selectedApplication.stageName ? (
                          <Badge variant="outline">{selectedApplication.stageName}</Badge>
                        ) : null}
                        <Badge variant="outline">
                          Applied {new Date(selectedApplication.appliedAt).toLocaleDateString()}
                        </Badge>
                        {selectedApplication.hmReviewRequestedAt ? (
                          <Badge variant="outline">
                            Requested {new Date(selectedApplication.hmReviewRequestedAt).toLocaleDateString()}
                          </Badge>
                        ) : null}
                      </div>

                      {selectedApplication.hmReviewNote ? (
                            <div className={cn(DASHBOARD_PANEL_MUTED, "p-4")}>
                          <p className="text-sm font-medium text-foreground">
                            {hiringManagerReviewPageCopy.sections.recruiterContext}
                          </p>
                          <p className="mt-2 text-sm text-muted-foreground">
                            {selectedApplication.hmReviewNote}
                          </p>
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>

                    <Card className={cn(DASHBOARD_PANEL, "rounded-[26px] bg-white/95")}>
                    <CardHeader>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <CardTitle className="flex items-center gap-2">
                            <FileText className="h-5 w-5 text-info" />
                            {hiringManagerReviewPageCopy.sections.resume}
                          </CardTitle>
                          <CardDescription>
                            Open the candidate resume before leaving feedback.
                          </CardDescription>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {resumePreviewUrl ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => window.open(resumePreviewUrl, "_blank", "noopener,noreferrer")}
                            >
                              <ExternalLink className="mr-2 h-4 w-4" />
                              {hiringManagerReviewPageCopy.sections.viewResume}
                            </Button>
                          ) : null}
                          {resumeDownloadUrl ? (
                            <Button
                              size="sm"
                              onClick={() => window.open(resumeDownloadUrl, "_blank", "noopener,noreferrer")}
                            >
                              <Download className="mr-2 h-4 w-4" />
                              {hiringManagerReviewPageCopy.sections.downloadResume}
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {canInlinePreview && resumePreviewUrl ? (
                            <div className={cn(DASHBOARD_PANEL_MUTED, "overflow-hidden")}>
                          <iframe
                            title={`Resume preview for ${selectedApplication.name}`}
                            src={resumePreviewUrl}
                            className="h-[720px] w-full bg-white"
                          />
                        </div>
                      ) : (
                            <div className="rounded-[22px] border border-dashed border-[#CBD5E1] bg-[#F8FAFC] p-6 text-center">
                          <FileText className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
                          <p className="font-medium text-foreground">
                            {selectedApplication.resumeFilename || "Resume"}
                          </p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {hiringManagerReviewPageCopy.sections.resumePreviewFallback}
                          </p>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <FeedbackPanel applicationId={selectedApplication.id} jobId={jobId} />
                </>
              ) : (
                  <Card className={cn(DASHBOARD_PANEL, "rounded-[26px] bg-white/95")}>
                  <CardContent className="py-12 text-center text-muted-foreground">
                    {hiringManagerReviewPageCopy.sections.chooseCandidate}
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        )}
        </div>
      </div>
    </Layout>
  );
}
