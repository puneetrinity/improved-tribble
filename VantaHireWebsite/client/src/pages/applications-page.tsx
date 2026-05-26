import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Eye, Users, Search, Sparkles, Brain, AlertCircle, MessageCircle } from "lucide-react";
import { PageHeaderSkeleton, FilterBarSkeleton, ApplicationListSkeleton } from "@/components/skeletons";
import { ResumePreviewModal } from "@/components/ResumePreviewModal";
import { applicationsPageCopy } from "@/lib/internal-copy";
import {
  InternalEmptyState,
  InternalHero,
  InternalPageShell,
  InternalPanel,
  InternalSectionHeader,
} from "@/components/internal";
import type { Application, PipelineStage } from "@shared/schema";

// Extended types for API responses with relations
type ApplicationWithJob = Application & {
  job?: { title: string };
  feedbackCount?: number;
};

export default function ApplicationsPage() {
  const { toast } = useToast();
  const [location, setLocation] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [feedbackFilter, setFeedbackFilter] = useState<string>("all");
  const [minRating, setMinRating] = useState<string>("0");
  const [resumePreviewApp, setResumePreviewApp] = useState<ApplicationWithJob | null>(null);
  const [resumeText, setResumeText] = useState<string | null>(null);
  const [isLoadingResumeText, setIsLoadingResumeText] = useState(false);

  // Fetch all applications for recruiter's jobs
  const { data: applications = [], isLoading: applicationsLoading } = useQuery<ApplicationWithJob[]>({
    queryKey: ["/api/my-applications-received"],
  });

  // Fetch resume text on demand for modal
  const fetchResumeText = async (applicationId: number): Promise<string | null> => {
    try {
      const res = await fetch(`/api/applications/${applicationId}/resume-text`, {
        credentials: "include",
      });
      if (!res.ok) return null;
      const data = await res.json();
      return typeof data.text === "string" ? data.text : null;
    } catch {
      return null;
    }
  };

  // Handle opening review modal and fetch resume text
  const handleOpenReviewModal = async (application: ApplicationWithJob) => {
    setResumePreviewApp(application);
    setResumeText(null);

    // Fetch resume text in background for fallback display
    if (application.id) {
      setIsLoadingResumeText(true);
      const text = await fetchResumeText(application.id);
      setResumeText(text);
      setIsLoadingResumeText(false);
    }
  };

  // Read stage filter from URL on mount and when URL changes
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const stageParam = params.get("stage");
    const statusParam = params.get("status");
    setStageFilter(stageParam ?? "all");
    setStatusFilter(statusParam ?? "all");
  }, [location]);

  // Fetch pipeline stages for stage filter
  const { data: pipelineStages = [] } = useQuery<PipelineStage[]>({
    queryKey: ["/api/pipeline/stages"],
  });

  // Update application status mutation
  const updateStatusMutation = useMutation({
    mutationFn: async ({ applicationId, status, notes }: { applicationId: number; status: string; notes?: string }) => {
      const res = await apiRequest("PATCH", `/api/applications/${applicationId}/status`, {
        status,
        ...(notes ? { notes } : {}),
      });
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/my-applications-received"] });
      toast({
        title: applicationsPageCopy.toasts.statusUpdatedTitle,
        description: applicationsPageCopy.toasts.statusUpdatedDescription,
      });
    },
    onError: (error: Error) => {
      toast({
        title: applicationsPageCopy.toasts.updateFailedTitle,
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Download resume mutation
  const downloadResumeMutation = useMutation({
    mutationFn: async (applicationId: number) => {
      await apiRequest("PATCH", `/api/applications/${applicationId}/download`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/my-applications-received"] });
    },
  });

  // Update application stage mutation
  const updateStageMutation = useMutation({
    mutationFn: async ({ applicationId, stageId, notes }: { applicationId: number; stageId: number; notes?: string }) => {
      const res = await apiRequest("PATCH", `/api/applications/${applicationId}/stage`, {
        stageId,
        ...(notes ? { notes } : {}),
      });
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/my-applications-received"] });
      toast({
        title: applicationsPageCopy.toasts.stageUpdatedTitle,
        description: applicationsPageCopy.toasts.stageUpdatedDescription,
      });
    },
    onError: (error: Error) => {
      toast({
        title: applicationsPageCopy.toasts.stageUpdateFailedTitle,
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleMoveToStage = async (applicationId: number, targetStageId?: number, status?: string, notes?: string) => {
    // Move stage first if a stage target exists
    if (targetStageId) {
      await updateStageMutation.mutateAsync({
        applicationId,
        stageId: targetStageId,
        ...(notes ? { notes } : {}),
      });
    }

    // Also set status for filtering consistency
    if (status) {
      await updateStatusMutation.mutateAsync({
        applicationId,
        status,
        ...(notes ? { notes } : {}),
      });
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-warning/10 text-warning-foreground border-warning/30';
      case 'reviewed': return 'bg-info/10 text-info-foreground border-info/30';
      case 'shortlisted': return 'bg-success/10 text-success-foreground border-success/30';
      case 'rejected': return 'bg-destructive/10 text-destructive border-destructive/30';
      default: return 'bg-muted text-muted-foreground border-border';
    }
  };

  const getFitBadge = (score: number | null | undefined, label: string | null | undefined) => {
    if (score === null || score === undefined || label === null || label === undefined) return null;

    const colorMap: Record<string, string> = {
      'Exceptional': 'bg-success/10 text-success-foreground border-success/30',
      'Strong': 'bg-info/10 text-info-foreground border-info/30',
      'Good': 'bg-primary/10 text-primary border-primary/30',
      'Partial': 'bg-warning/10 text-warning-foreground border-warning/30',
      'Low': 'bg-destructive/10 text-destructive border-destructive/30',
    };

    const colorClass = colorMap[label] || 'bg-muted text-muted-foreground border-border';

    return (
      <Badge variant="outline" className={`${colorClass} font-medium`}>
        <Sparkles className="w-3 h-3 mr-1" />
        {label} ({score})
      </Badge>
    );
  };

  // Filter applications
  const filteredApplications = applications.filter((app) => {
    const matchesSearch = !searchQuery ||
      app.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      app.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      app.job?.title.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = statusFilter === "all" || app.status === statusFilter;

    // Stage filter
    const matchesStage = stageFilter === "all" ||
      (stageFilter === "unassigned" && !app.currentStage) ||
      (app.currentStage && app.currentStage.toString() === stageFilter);

    // Rating filter
    const matchesRating = minRating === "0" || (app.rating && app.rating >= Number(minRating));

    // Feedback filter (uses feedbackCount from backend)
    const matchesFeedback = feedbackFilter === "all" ||
      (feedbackFilter === "with-feedback" && (app.feedbackCount ?? 0) > 0) ||
      (feedbackFilter === "without-feedback" && (app.feedbackCount ?? 0) === 0);

    return matchesSearch && matchesStatus && matchesStage && matchesRating && matchesFeedback;
  });

  if (applicationsLoading) {
    return (
      <InternalPageShell>
        <PageHeaderSkeleton />
        <FilterBarSkeleton />
        <InternalPanel className="p-5">
          <ApplicationListSkeleton count={5} />
        </InternalPanel>
      </InternalPageShell>
    );
  }

  return (
    <InternalPageShell>
      <InternalHero
        eyebrow="Candidate Review"
        title={applicationsPageCopy.header.title}
        subtitle={applicationsPageCopy.header.subtitle}
        icon={Users}
        stats={[
          { label: "Total Applications", value: applications.length },
          { label: "Visible", value: filteredApplications.length },
          {
            label: "With Feedback",
            value: applications.filter((app) => (app.feedbackCount ?? 0) > 0).length,
            accentClassName: "text-[#4B8EF0]",
          },
        ]}
      />

      <InternalPanel className="p-4 sm:p-5" data-tour="applications-filters">
        <div className="space-y-4">
          <div className="flex flex-col gap-4 md:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7B8191]" />
              <Input
                placeholder={applicationsPageCopy.filters.searchPlaceholder}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-11 rounded-2xl border-[#E5E7EB] bg-[#FAFAFB] pl-10 font-outfit text-sm text-[#111827] shadow-[0_3px_10px_rgba(15,23,42,0.04)] placeholder:text-[#9CA3AF]"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full rounded-2xl border-[#E5E7EB] bg-[#FAFAFB] md:w-48">
                <SelectValue placeholder={applicationsPageCopy.filters.statusPlaceholder} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{applicationsPageCopy.filters.allStatus}</SelectItem>
                <SelectItem value="submitted">{applicationsPageCopy.filters.submitted}</SelectItem>
                <SelectItem value="shortlisted">{applicationsPageCopy.filters.shortlisted}</SelectItem>
                <SelectItem value="rejected">{applicationsPageCopy.filters.rejected}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-4 md:flex-row">
            <Select value={stageFilter} onValueChange={setStageFilter}>
              <SelectTrigger className="w-full rounded-2xl border-[#E5E7EB] bg-[#FAFAFB] md:w-56">
                <SelectValue placeholder={applicationsPageCopy.filters.stagePlaceholder} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{applicationsPageCopy.filters.allStages}</SelectItem>
                <SelectItem value="unassigned">{applicationsPageCopy.filters.unassigned}</SelectItem>
                {pipelineStages.map((stage) => (
                  <SelectItem key={stage.id} value={stage.id.toString()}>
                    {stage.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={feedbackFilter} onValueChange={setFeedbackFilter}>
              <SelectTrigger className="w-full rounded-2xl border-[#E5E7EB] bg-[#FAFAFB] md:w-56">
                <SelectValue placeholder={applicationsPageCopy.filters.feedbackPlaceholder} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{applicationsPageCopy.filters.allApplications}</SelectItem>
                <SelectItem value="with-feedback">{applicationsPageCopy.filters.withFeedback}</SelectItem>
                <SelectItem value="without-feedback">{applicationsPageCopy.filters.withoutFeedback}</SelectItem>
              </SelectContent>
            </Select>

            <Select value={minRating} onValueChange={setMinRating}>
              <SelectTrigger className="w-full rounded-2xl border-[#E5E7EB] bg-[#FAFAFB] md:w-48">
                <SelectValue placeholder={applicationsPageCopy.filters.ratingPlaceholder} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">{applicationsPageCopy.filters.allRatings}</SelectItem>
                <SelectItem value="1">{applicationsPageCopy.filters.ratingsPrefix} {applicationsPageCopy.filters.onePlus}</SelectItem>
                <SelectItem value="2">{applicationsPageCopy.filters.ratingsPrefix} {applicationsPageCopy.filters.twoPlus}</SelectItem>
                <SelectItem value="3">{applicationsPageCopy.filters.ratingsPrefix} {applicationsPageCopy.filters.threePlus}</SelectItem>
                <SelectItem value="4">{applicationsPageCopy.filters.ratingsPrefix} {applicationsPageCopy.filters.fourPlus}</SelectItem>
                <SelectItem value="5">{applicationsPageCopy.filters.ratingsPrefix} {applicationsPageCopy.filters.five}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </InternalPanel>

      <InternalPanel className="p-5" data-tour="applications-list">
        <InternalSectionHeader
          title={`${applicationsPageCopy.list.title} (${filteredApplications.length})`}
          description={applicationsPageCopy.list.description}
        />
        <div className="mt-5 space-y-4">
          {filteredApplications.length === 0 ? (
            <InternalEmptyState
              icon={Users}
              title={
                searchQuery || statusFilter !== "all"
                  ? applicationsPageCopy.list.emptyFiltered
                  : applicationsPageCopy.list.emptyNone
              }
            />
          ) : (
            filteredApplications.map((application) => (
              <div
                key={application.id}
                className="space-y-3 rounded-[20px] border border-[#EEF0F4] bg-[#F8F8FA] p-4 transition-all hover:bg-white hover:shadow-[0_14px_34px_rgba(15,23,42,0.07)]"
                data-testid="application-row"
              >
                      <div className="flex items-center justify-between">
                        <div className="space-y-1">
                          <h3 className="text-foreground font-medium">{application.name}</h3>
                          <p className="text-muted-foreground text-sm">{application.email}</p>
                          <p className="text-muted-foreground text-sm">{applicationsPageCopy.list.appliedForPrefix} {application.job?.title}</p>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Badge className={getStatusColor(application.status)}>
                            {application.status}
                          </Badge>
                          {typeof application.feedbackCount === "number" && application.feedbackCount > 0 && (
                            <Badge
                              variant="outline"
                              className="text-xs border-success/30 bg-success/10 text-success-foreground font-medium flex items-center gap-1"
                            >
                              <MessageCircle className="h-3 w-3" />
                              {application.feedbackCount} {applicationsPageCopy.list.feedbackLabel}
                            </Badge>
                          )}
                          {getFitBadge(application.aiFitScore, application.aiFitLabel)}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleOpenReviewModal(application)}
                            data-testid="review-application"
                          >
                            <Eye className="h-4 w-4 mr-1" />
                            {applicationsPageCopy.list.review}
                          </Button>
                        </div>
                      </div>

                      {application.coverLetter && (
                        <div className="pt-2 border-t border-border">
                          <p className="text-muted-foreground text-sm">
                            <strong>{applicationsPageCopy.list.coverLetter}</strong> {application.coverLetter}
                          </p>
                        </div>
                      )}

                      {/* AI Fit Analysis */}
                      {application.aiFitScore !== null && application.aiFitScore !== undefined && application.aiFitReasons && Array.isArray(application.aiFitReasons) ? (
                        <div className="pt-2 border-t border-border">
                          <div className="p-3 bg-primary/5 rounded-lg border-l-4 border-primary">
                            <div className="flex items-center gap-2 mb-2">
                              <Brain className="w-4 h-4 text-primary" />
                              <span className="text-primary font-medium text-sm">{applicationsPageCopy.list.aiFitAnalysis}</span>
                            </div>
                            <ul className="text-muted-foreground text-sm space-y-1">
                              {(application.aiFitReasons as string[]).slice(0, 3).map((reason: string, idx: number): JSX.Element => (
                                <li key={idx} className="flex items-start gap-2">
                                  <span className="text-primary mt-0.5">•</span>
                                  <span>{reason}</span>
                                </li>
                              ))}
                            </ul>
                            {application.aiStaleReason && (
                              <p className="text-warning-foreground text-xs mt-2 flex items-center gap-1">
                                <AlertCircle className="w-3 h-3" />
                                {applicationsPageCopy.list.staleScorePrefix} ({application.aiStaleReason})
                              </p>
                            )}
                          </div>
                        </div>
                      ) : null}
              </div>
            ))
          )}
        </div>
      </InternalPanel>

      {/* Application Review Modal */}
      <ResumePreviewModal
        applicationId={resumePreviewApp?.id ?? null}
        applicationName={resumePreviewApp?.name ?? ""}
        applicationEmail={resumePreviewApp?.email ?? ""}
        jobTitle={resumePreviewApp?.job?.title}
        resumeUrl={resumePreviewApp?.resumeUrl ?? null}
        resumeFilename={resumePreviewApp?.resumeFilename ?? null}
        status={resumePreviewApp?.status}
        aiFitScore={resumePreviewApp?.aiFitScore}
        aiFitLabel={resumePreviewApp?.aiFitLabel}
        aiFitReasons={resumePreviewApp?.aiFitReasons as string[] | null}
        resumeText={resumeText}
        open={!!resumePreviewApp}
        onClose={() => {
          setResumePreviewApp(null);
          setResumeText(null);
        }}
        onDownload={() => {
          if (resumePreviewApp) {
            downloadResumeMutation.mutate(resumePreviewApp.id);
          }
        }}
        onMoveToScreening={async (notes) => {
          if (resumePreviewApp) {
            const screeningStage = pipelineStages.find((s) =>
              s.name.toLowerCase().includes("screen")
            );
            await handleMoveToStage(resumePreviewApp.id, screeningStage?.id, "shortlisted", notes);
          }
        }}
        onReject={async (notes) => {
          if (resumePreviewApp) {
            const rejectStage = pipelineStages.find((s) =>
              s.name.toLowerCase().includes("reject")
            );
            await handleMoveToStage(resumePreviewApp.id, rejectStage?.id, "rejected", notes);
          }
        }}
      />
    </InternalPageShell>
  );
}
