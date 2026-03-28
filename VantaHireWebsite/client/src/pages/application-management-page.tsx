import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Redirect } from "wouter";
import {
  MapPin,
  Clock,
  Calendar,
  Users,
  FileText,
  Download,
  Eye,
  CheckCircle,
  XCircle,
  UserCheck,
  MessageSquare,
  Briefcase,
  Target,
  Mail,
  Star,
  History,
  ArrowLeft,
  FileDown,
  Plus,
  Sparkles,
  X,
  Info,
  AlertCircle,
  Loader2,
  Upload
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useAiCreditExhaustionToast } from "@/hooks/use-ai-credit-exhaustion";
import { Job, Application, PipelineStage, EmailTemplate } from "@shared/schema";
import { apiRequest, isApiError, queryClient } from "@/lib/queryClient";
import { formsApi, formsQueryKeys, type FormTemplateDTO, type InvitationQuotaResponse } from "@/lib/formsApi";
import Layout from "@/components/Layout";
import { CandidateIntakeForm } from "@/components/candidate-intake";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { KanbanBoard } from "@/components/kanban/KanbanBoard";
import { BulkActionBar } from "@/components/kanban/BulkActionBar";
import { ApplicationDetailModal } from "@/components/kanban/ApplicationDetailModal";
import type { EmailSendPayload } from "@/components/kanban/ApplicationDetailPanel";
import { PageHeaderSkeleton, FilterBarSkeleton, KanbanBoardSkeleton } from "@/components/skeletons";
import { JobSubNav } from "@/components/JobSubNav";
import { UploadDialog } from "@/components/bulk-import/UploadDialog";
import { describeBulkFailures, type BulkFailureDetail } from "@/lib/bulk-action-failures";
import { applicationManagementCopy } from "@/lib/internal-copy";

export default function ApplicationManagementPage() {
  const [match, params] = useRoute("/jobs/:id/applications");
  const { user } = useAuth();
  const { toast } = useToast();
  const { showAiCreditExhaustionToast } = useAiCreditExhaustionToast();
  const [location, setLocation] = useLocation();
  const [selectedApplications, setSelectedApplications] = useState<number[]>([]);
  const [deepLinkedApplicationId, setDeepLinkedApplicationId] = useState<number | null>(null);
  const [actionFilter, setActionFilter] = useState<string[]>([]); // AI Suggested Action Filter
  const [isVisible, setIsVisible] = useState(false);

  // ATS features state
  const [selectedApp, setSelectedApp] = useState<Application | null>(null);
  const [selectedAppContext, setSelectedAppContext] = useState<Application[]>([]);
  const [selectedAppResumeText, setSelectedAppResumeText] = useState<string | null>(null);
  const [interviewDate, setInterviewDate] = useState("");
  const [interviewTime, setInterviewTime] = useState("");
  const [interviewLocation, setInterviewLocation] = useState("");
  const [interviewNotes, setInterviewNotes] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [newRecruiterNote, setNewRecruiterNote] = useState("");
  const [showInterviewDialog, setShowInterviewDialog] = useState(false);
  const [addCandidateModalOpen, setAddCandidateModalOpen] = useState(false);
  const [bulkImportDialogOpen, setBulkImportDialogOpen] = useState(false);
  const [showEmailDialog, setShowEmailDialog] = useState(false);
  const [showBulkEmailDialog, setShowBulkEmailDialog] = useState(false);
  const [bulkTemplateId, setBulkTemplateId] = useState<number | null>(null);
  const [bulkProgress, setBulkProgress] = useState<{ sent: number; total: number }>({ sent: 0, total: 0 });
  const [showBulkFormsDialog, setShowBulkFormsDialog] = useState(false);
  const [bulkFormId, setBulkFormId] = useState<number | null>(null);
  const [bulkFormMessage, setBulkFormMessage] = useState("");
  const [bulkFormsProgress, setBulkFormsProgress] = useState<{ sent: number; total: number }>({ sent: 0, total: 0 });
  const [showHistoryDialog, setShowHistoryDialog] = useState(false);
  const [emailDialogApp, setEmailDialogApp] = useState<Application | null>(null);
  const [showBatchInterviewDialog, setShowBatchInterviewDialog] = useState(false);
  const [batchInterviewDate, setBatchInterviewDate] = useState("");
  const [batchInterviewTime, setBatchInterviewTime] = useState("");
  const [batchIntervalHours, setBatchIntervalHours] = useState("0");
  const [batchLocation, setBatchLocation] = useState("");
  const [batchNotes, setBatchNotes] = useState("");
  const [batchStageId, setBatchStageId] = useState<string>("");
  const [showShareShortlistDialog, setShowShareShortlistDialog] = useState(false);
  const [shortlistTitle, setShortlistTitle] = useState("");
  const [shortlistMessage, setShortlistMessage] = useState("");
  const [shortlistExpiresAt, setShortlistExpiresAt] = useState("");
  const [shortlistUrl, setShortlistUrl] = useState<string | null>(null);

  // AI Summary state
  const [showAISummaryDialog, setShowAISummaryDialog] = useState(false);
  const [aiSummaryJobId, setAiSummaryJobId] = useState<number | null>(null);
  const [regenerateSummaries, setRegenerateSummaries] = useState(false);
  const [hasTriggeredAISummaryFilters, setHasTriggeredAISummaryFilters] = useState(false);

  type JobShortlistSummary = {
    id: number;
    title: string | null;
    message: string | null;
    createdAt: string;
    expiresAt: string | null;
    status: string;
    client: { id: number; name: string } | null;
    candidateCount: number;
    publicUrl: string;
    fullUrl: string;
  };

  const jobId = params?.id ? parseInt(params.id) : null;

  // Fade-in animation on mount
  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 200);
    return () => clearTimeout(timer);
  }, []);

  // Read deep-linked application from URL on mount and when URL changes
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const applicationIdParam = params.get("applicationId");
    setDeepLinkedApplicationId(applicationIdParam ? Number(applicationIdParam) : null);
  }, [location]);

  // Redirect if not recruiter or admin
  if (!user || !['recruiter', 'super_admin'].includes(user.role)) {
    return <Redirect to="/auth" />;
  }

  const { data: job, isLoading: jobLoading, error: jobError } = useQuery<Job>({
    queryKey: ["/api/jobs", jobId],
    queryFn: async () => {
      const response = await fetch(`/api/jobs/${jobId}`);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to fetch job (${response.status})`);
      }
      return response.json();
    },
    enabled: !!jobId,
  });

  const { data: rawShortlists } = useQuery<JobShortlistSummary[]>({
    queryKey: ["/api/jobs", jobId, "client-shortlists"],
    queryFn: async () => {
      if (!jobId) return [];
      const response = await fetch(`/api/jobs/${jobId}/client-shortlists`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch client shortlists");
      return response.json();
    },
    enabled: !!jobId && !!job?.clientId,
  });
  const shortlists: JobShortlistSummary[] = Array.isArray(rawShortlists) ? rawShortlists : [];

  const { data: applications, isLoading: applicationsLoading } = useQuery<Application[]>({
    queryKey: ["/api/jobs", jobId, "applications"],
    queryFn: async () => {
      const response = await fetch(`/api/jobs/${jobId}/applications`);
      if (!response.ok) throw new Error("Failed to fetch applications");
      return response.json();
    },
    enabled: !!jobId,
  });

  // ATS: Fetch pipeline stages
  // For super_admin: use job's orgId if set, or 'none' for null-org jobs to get defaults
  const pipelineOrgParam = user?.role === 'super_admin'
    ? (job?.organizationId ? String(job.organizationId) : 'none')
    : undefined;
  const { data: pipelineStages = [] } = useQuery<PipelineStage[]>({
    queryKey: ["/api/pipeline/stages", pipelineOrgParam ?? 'default'],
    queryFn: async () => {
      const url = pipelineOrgParam ? `/api/pipeline/stages?orgId=${pipelineOrgParam}` : "/api/pipeline/stages";
      const response = await fetch(url);
      if (!response.ok) throw new Error("Failed to fetch pipeline stages");
      return response.json();
    },
    enabled: user?.role === 'super_admin' ? !!job : true,
  });

  // ATS: Fetch email templates
  const { data: emailTemplates = [] } = useQuery<EmailTemplate[]>({
    queryKey: ["/api/email-templates"],
    queryFn: async () => {
      const response = await fetch("/api/email-templates");
      if (!response.ok) throw new Error("Failed to fetch email templates");
      return response.json();
    },
  });

  // ATS: Fetch form templates
  const { data: formTemplates = [] } = useQuery({
    queryKey: formsQueryKeys.templates(),
    queryFn: formsApi.listTemplates,
    select: (data) => data.templates,
  });

  // ATS: Fetch form invitation quota (remaining daily invites)
  const { data: invitationQuota } = useQuery<InvitationQuotaResponse>({
    queryKey: formsQueryKeys.invitationQuota(),
    queryFn: () => formsApi.getInvitationQuota(),
    enabled: showBulkFormsDialog,
    staleTime: 30_000, // Cache for 30 seconds
  });

  // ATS: Fetch stage history for selected application
  const { data: stageHistory = [] } = useQuery({
    queryKey: ["/api/applications", selectedApp?.id, "history"],
    queryFn: async () => {
      const response = await fetch(`/api/applications/${selectedApp?.id}/history`);
      if (!response.ok) throw new Error("Failed to fetch stage history");
      return response.json();
    },
    enabled: !!selectedApp?.id && showHistoryDialog,
  });

  // AI Summary: Rate limit status query
  interface SummaryLimitStatus {
    dailyLimit: number;
    dailyUsed: number;
    dailyRemaining: number;
    dailyResetAt: string;
    budgetAllowed: boolean;
    budgetSpent: number;
    budgetLimit: number;
    effectiveRemaining: number;
    maxBatchSize: number;
  }

  const { data: summaryLimitStatus } = useQuery<SummaryLimitStatus>({
    queryKey: ['/api/ai/summary/limit-status'],
    queryFn: async () => {
      const response = await fetch('/api/ai/summary/limit-status', { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch limit status');
      return response.json();
    },
    refetchInterval: 60000, // Refresh every minute
    staleTime: 30000,
  });

  // AI Summary: Job status polling
  interface SummaryJobStatus {
    id: number;
    status: 'pending' | 'active' | 'completed' | 'failed' | 'cancelled';
    progress: number;
    processedCount: number;
    totalCount: number;
    result?: {
      results: Array<{ applicationId: number; status: string; error?: string }>;
      summary: { total: number; succeeded: number; skipped: number; errors: number };
    };
    error?: string;
  }

  const { data: summaryJobStatus } = useQuery<SummaryJobStatus>({
    queryKey: ['/api/ai/summary/jobs', aiSummaryJobId],
    queryFn: async () => {
      const response = await fetch(`/api/ai/summary/jobs/${aiSummaryJobId}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch job status');
      return response.json();
    },
    enabled: !!aiSummaryJobId,
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.status === 'completed' || data?.status === 'failed' || data?.status === 'cancelled' ? false : 2000;
    },
  });

  // AI Summary: Start mutation
  const startAISummaryMutation = useMutation({
    mutationFn: async ({ applicationIds, regenerate }: { applicationIds: number[]; regenerate: boolean }) => {
      const res = await apiRequest('POST', '/api/applications/bulk/ai-summary/queue', { applicationIds, regenerate });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.cached) {
        toast({ title: applicationManagementCopy.toasts.aiSummaryAllCachedTitle, description: data.message });
        setShowAISummaryDialog(false);
      } else {
        setAiSummaryJobId(data.jobId);
        toast({ title: applicationManagementCopy.toasts.aiSummaryStartedTitle, description: `Processing ${data.totalCount} candidates...` });
      }
    },
    onError: (error: any) => {
      if (showAiCreditExhaustionToast(error)) {
        return;
      }

      const errorData = isApiError(error) ? error.payload || {} : {};
      let msg = (typeof errorData.error === 'string' && errorData.error) || error.message || 'Failed to start AI summary generation';

      // Handle specific error codes with clear messaging
      if (errorData.errorCode === 'MAX_EXCEEDED') {
        msg = `Please select 50 or fewer candidates.`;
      } else if (errorData.errorCode === 'RATE_LIMIT_EXCEEDED') {
        msg = `You have only ${errorData.remaining} analyses left today. Select fewer candidates.`;
      } else if (errorData.errorCode === 'PENDING_LIMIT') {
        msg = 'You have a job in progress. Please wait for it to complete.';
      }

      toast({ title: applicationManagementCopy.toasts.aiSummaryCannotStartTitle, description: msg, variant: 'destructive' });
    },
  });

  // AI Summary: Handle job completion effect
  useEffect(() => {
    if (summaryJobStatus?.status === 'completed') {
      const result = summaryJobStatus.result?.summary || { succeeded: 0, skipped: 0, errors: 0 };
      toast({
        title: applicationManagementCopy.toasts.aiSummariesGeneratedTitle,
        description: `${result.succeeded} generated, ${result.skipped} skipped, ${result.errors} failed.`,
      });
      setShowAISummaryDialog(false);
      setAiSummaryJobId(null);
      setRegenerateSummaries(false);
      // Refresh applications to show new summaries
      queryClient.invalidateQueries({ queryKey: ['/api/jobs', jobId, 'applications'] });
      // Refresh limit status
      queryClient.invalidateQueries({ queryKey: ['/api/ai/summary/limit-status'] });
    }

    if (summaryJobStatus?.status === 'failed') {
      toast({
        title: applicationManagementCopy.toasts.aiSummaryFailedTitle,
        description: summaryJobStatus.error || 'An error occurred during processing',
        variant: 'destructive',
      });
      setAiSummaryJobId(null);
    }
  }, [summaryJobStatus?.status, summaryJobStatus?.result, summaryJobStatus?.error, jobId, toast]);

  // ATS: Auto-select an Interview stage in the batch interview dialog (if available)
  useEffect(() => {
    if (!showBatchInterviewDialog || batchStageId || pipelineStages.length === 0) {
      return;
    }

    // Prefer the earliest "Interview" stage by order if multiple exist
    const sortedStages = [...pipelineStages].sort((a, b) => ((a.order ?? 0) - (b.order ?? 0)) || (a.id - b.id));
    const interviewStage = sortedStages.find((stage) =>
      stage.name.toLowerCase().includes("interview")
    );

    if (interviewStage) {
      setBatchStageId(interviewStage.id.toString());
    }
  }, [showBatchInterviewDialog, batchStageId, pipelineStages]);

  const updateStatusMutation = useMutation({
    mutationFn: async ({ applicationId, status, notes }: { applicationId: number; status: string; notes?: string }) => {
      const res = await apiRequest("PATCH", `/api/applications/${applicationId}/status`, {
        status,
        notes
      });
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "applications"] });
      toast({
        title: applicationManagementCopy.toasts.statusUpdatedTitle,
        description: applicationManagementCopy.toasts.statusUpdatedDescription,
      });
    },
    onError: (error: Error) => {
      toast({
        title: applicationManagementCopy.toasts.updateFailedTitle,
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const bulkUpdateMutation = useMutation({
    mutationFn: async ({ applicationIds, status, notes }: { applicationIds: number[]; status: string; notes?: string }) => {
      const res = await apiRequest("PATCH", "/api/applications/bulk", {
        applicationIds,
        status,
        notes
      });
      return await res.json();
    },
    onSuccess: (data: { updatedCount: number; total?: number; failed?: BulkFailureDetail[] }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "applications"] });
      setSelectedApplications([]);
      if (data.failed && data.failed.length > 0) {
        toast({
          title: "Bulk update completed with issues",
          description: `${data.updatedCount} updated. Failed: ${describeBulkFailures(data.failed, applications || [], "application")}`,
          variant: "destructive",
        });
      } else {
        toast({
          title: applicationManagementCopy.toasts.bulkUpdateSuccessTitle,
          description: `${data.updatedCount} applications updated successfully.`,
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: applicationManagementCopy.toasts.bulkUpdateFailedTitle,
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const requestHiringManagerReviewMutation = useMutation({
    mutationFn: async ({ applicationIds, note }: { applicationIds: number[]; note?: string }) => {
      const res = await apiRequest("POST", "/api/applications/bulk/request-hm-review", {
        applicationIds,
        note,
      });
      return await res.json();
    },
    onSuccess: (data: { requestedCount: number; failed?: BulkFailureDetail[] }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "applications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/hiring-manager/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/hiring-manager/jobs", jobId, "applications"] });
      setSelectedApplications([]);

      if (data.failed && data.failed.length > 0) {
        toast({
          title: applicationManagementCopy.toasts.hmReviewRequestedWithIssuesTitle,
          description: `${data.requestedCount} queued. Failed: ${describeBulkFailures(data.failed, applications || [])}`,
          variant: "destructive",
        });
      } else {
        toast({
          title: applicationManagementCopy.toasts.hmReviewRequestedTitle,
          description: `${data.requestedCount} candidate${data.requestedCount === 1 ? "" : "s"} sent to the assigned hiring manager.`,
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: applicationManagementCopy.toasts.hmReviewRequestFailedTitle,
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const markViewedMutation = useMutation({
    mutationFn: async (applicationId: number) => {
      const res = await apiRequest("PATCH", `/api/applications/${applicationId}/view`);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "applications"] });
    },
  });

  const markDownloadedMutation = useMutation({
    mutationFn: async (applicationId: number) => {
      const res = await apiRequest("PATCH", `/api/applications/${applicationId}/download`);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "applications"] });
      toast({
        title: applicationManagementCopy.toasts.downloadTrackedTitle,
        description: applicationManagementCopy.toasts.downloadTrackedDescription,
      });
    },
  });

  // ATS: Update application stage mutation
  const updateStageMutation = useMutation({
    mutationFn: async ({ applicationId, stageId, notes }: { applicationId: number; stageId: number; notes?: string }) => {
      const res = await apiRequest("PATCH", `/api/applications/${applicationId}/stage`, {
        stageId,
        notes,
      });
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "applications"] });
      toast({
        title: applicationManagementCopy.toasts.stageUpdatedTitle,
        description: applicationManagementCopy.toasts.stageUpdatedDescription,
      });
    },
  });

  // ATS: Schedule interview mutation
  const scheduleInterviewMutation = useMutation({
    mutationFn: async ({ applicationId, date, time, location, notes }: {
      applicationId: number;
      date: string;
      time: string;
      location: string;
      notes?: string;
    }) => {
      const res = await apiRequest("PATCH", `/api/applications/${applicationId}/interview`, {
        date,
        time,
        location,
        notes,
      });
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "applications"] });
      setShowInterviewDialog(false);
      setInterviewDate("");
      setInterviewTime("");
      setInterviewLocation("");
      setInterviewNotes("");
      toast({
        title: applicationManagementCopy.toasts.interviewScheduledTitle,
        description: applicationManagementCopy.toasts.interviewScheduledDescription,
      });
    },
  });

  const createShortlistMutation = useMutation({
    mutationFn: async () => {
      if (!jobId || !job?.clientId || selectedApplications.length === 0) {
        throw new Error("Missing job, client, or applications");
      }
      const payload: {
        clientId: number;
        jobId: number;
        title?: string;
        message?: string;
        applicationIds: number[];
        expiresAt?: string;
      } = {
        clientId: job.clientId,
        jobId,
        applicationIds: selectedApplications,
      };
      if (shortlistTitle.trim()) payload.title = shortlistTitle.trim();
      if (shortlistMessage.trim()) payload.message = shortlistMessage.trim();
      if (shortlistExpiresAt) payload.expiresAt = new Date(shortlistExpiresAt).toISOString();

      const res = await apiRequest("POST", "/api/client-shortlists", payload);
      return await res.json();
    },
    onSuccess: (data: { publicUrl?: string; fullUrl?: string }) => {
      const url = data.fullUrl || data.publicUrl || "";
      setShortlistUrl(url || null);
      toast({
        title: applicationManagementCopy.toasts.shortlistCreatedTitle,
        description: applicationManagementCopy.toasts.shortlistCreatedDescription,
      });
    },
    onError: (error: Error) => {
      toast({
        title: applicationManagementCopy.toasts.shortlistFailedTitle,
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // ATS: Send email mutation
  const sendEmailMutation = useMutation({
    mutationFn: async ({ applicationId, ...payload }: { applicationId: number } & EmailSendPayload) => {
      const res = await apiRequest("POST", `/api/applications/${applicationId}/send-email`, {
        ...payload,
      });
      return await res.json();
    },
    onSuccess: () => {
      setShowEmailDialog(false);
      setEmailDialogApp(null);
      setSelectedTemplateId(null);
      toast({
        title: applicationManagementCopy.toasts.emailSentTitle,
        description: applicationManagementCopy.toasts.emailSentDescription,
      });
    },
  });

  // ATS: Send bulk emails mutation
  const sendBulkEmailsMutation = useMutation({
    mutationFn: async ({ applicationIds, templateId }: { applicationIds: number[]; templateId: number }) => {
      let success = 0;
      const failed: BulkFailureDetail[] = [];
      setBulkProgress({ sent: 0, total: applicationIds.length });
      for (const id of applicationIds) {
        try {
          const res = await apiRequest("POST", `/api/applications/${id}/send-email`, { templateId });
          await res.json();
          success++;
        } catch (error: any) {
          failed.push({
            applicationId: id,
            error: error?.message || "Failed to send email",
          });
        } finally {
          setBulkProgress((p) => ({ sent: Math.min(p.sent + 1, applicationIds.length), total: applicationIds.length }));
        }
      }
      return { summary: { total: applicationIds.length, success, failed } };
    },
    onSuccess: ({ summary }) => {
      setShowBulkEmailDialog(false);
      setBulkTemplateId(null);
      setSelectedApplications([]);
      setBulkProgress({ sent: 0, total: 0 });
      if (summary.failed.length > 0) {
        toast({
          title: "Bulk email completed with issues",
          description: `Sent: ${summary.success}. Failed: ${describeBulkFailures(summary.failed, applications || [])}`,
          variant: "destructive",
        });
      } else {
        toast({
          title: applicationManagementCopy.toasts.bulkEmailSentTitle,
          description: `Sent: ${summary.success}, Failed: 0`,
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: applicationManagementCopy.toasts.bulkEmailFailedTitle,
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // ATS: Send bulk forms mutation (client fan-out)
  const sendBulkFormsMutation = useMutation({
    mutationFn: async ({ applicationIds, formId, customMessage }: { applicationIds: number[]; formId: number; customMessage?: string }) => {
      let created = 0;
      const failed: BulkFailureDetail[] = [];
      setBulkFormsProgress({ sent: 0, total: applicationIds.length });

      for (const appId of applicationIds) {
        try {
          await formsApi.createInvitation({
            applicationId: appId,
            formId,
            ...(customMessage && { customMessage })
          });
          created++;
        } catch (err: any) {
          let reason = "Failed to send form";
          if (err.status === 409 || (err.message && err.message.includes('already been sent'))) {
            reason = "Invitation already exists";
          } else if (err.status === 403 || (err.message && err.message.includes('Unauthorized'))) {
            reason = "Unauthorized";
          } else if (err?.message) {
            reason = err.message;
          }
          failed.push({ applicationId: appId, error: reason });
        } finally {
          setBulkFormsProgress(p => ({
            sent: Math.min(p.sent + 1, applicationIds.length),
            total: applicationIds.length
          }));
        }
      }

      return { summary: { total: applicationIds.length, created, failed } };
    },
    onSuccess: ({ summary }) => {
      setShowBulkFormsDialog(false);
      setBulkFormId(null);
      setBulkFormMessage("");
      setSelectedApplications([]);
      setBulkFormsProgress({ sent: 0, total: 0 });
      // Invalidate invitation quota to refresh remaining count
      queryClient.invalidateQueries({ queryKey: formsQueryKeys.invitationQuota() });
      if (summary.failed.length > 0) {
        toast({
          title: "Bulk forms completed with issues",
          description: `Created: ${summary.created}. Not sent to: ${describeBulkFailures(summary.failed, applications || [])}`,
          variant: "destructive",
        });
      } else {
        toast({
          title: applicationManagementCopy.toasts.bulkFormsSentTitle,
          description: `Created: ${summary.created}, Failed: 0`,
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: applicationManagementCopy.toasts.bulkFormsFailedTitle,
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // ATS: Batch interview scheduling mutation
  const batchInterviewMutation = useMutation({
    mutationFn: async () => {
      if (!jobId) throw new Error("Invalid job id");
      const interval = parseFloat(batchIntervalHours || "0");
      const startIso = batchInterviewDate && batchInterviewTime
        ? new Date(`${batchInterviewDate}T${batchInterviewTime}`).toISOString()
        : new Date(batchInterviewDate).toISOString();

      const res = await apiRequest("PATCH", "/api/applications/bulk/interview", {
        applicationIds: selectedApplications,
        start: startIso,
        intervalHours: interval,
        location: batchLocation,
        timeRangeLabel: interval === 0 && batchInterviewTime
          ? batchInterviewTime
          : undefined,
        notes: batchNotes || undefined,
        stageId: batchStageId ? parseInt(batchStageId, 10) : undefined,
      });
      return await res.json();
    },
    onSuccess: (data: { total: number; scheduledCount: number; failedCount: number; failed?: BulkFailureDetail[] }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "applications"] });
      setShowBatchInterviewDialog(false);
      setBatchInterviewDate("");
      setBatchInterviewTime("");
      setBatchIntervalHours("0");
      setBatchLocation("");
      setBatchNotes("");
      setBatchStageId("");
      if (data.failed && data.failed.length > 0) {
        toast({
          title: "Batch interviews completed with issues",
          description: `${data.scheduledCount} of ${data.total} scheduled. Failed: ${describeBulkFailures(data.failed, applications || [])}`,
          variant: "destructive",
        });
      } else {
        toast({
          title: applicationManagementCopy.toasts.batchInterviewsScheduledTitle,
          description: `${data.scheduledCount} of ${data.total} candidates scheduled.`,
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: applicationManagementCopy.toasts.batchSchedulingFailedTitle,
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // ATS: Add recruiter note mutation
  const addNoteMutation = useMutation({
    mutationFn: async ({ applicationId, note }: { applicationId: number; note: string }) => {
      const res = await apiRequest("POST", `/api/applications/${applicationId}/notes`, {
        note,
      });
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "applications"] });
      setNewRecruiterNote("");
      toast({
        title: applicationManagementCopy.toasts.noteAddedTitle,
        description: applicationManagementCopy.toasts.noteAddedDescription,
      });
    },
  });

  // ATS: Set rating mutation
  const setRatingMutation = useMutation({
    mutationFn: async ({ applicationId, rating }: { applicationId: number; rating: number }) => {
      const res = await apiRequest("PATCH", `/api/applications/${applicationId}/rating`, {
        rating,
      });
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "applications"] });
      toast({
        title: applicationManagementCopy.toasts.ratingUpdatedTitle,
        description: applicationManagementCopy.toasts.ratingUpdatedDescription,
      });
    },
  });

  const handleStatusUpdate = (applicationId: number, status: string, notes?: string) => {
    updateStatusMutation.mutate({
      applicationId,
      status,
      ...(notes !== undefined && { notes })
    });
  };

  const handleResumeDownload = (application: Application) => {
    // Use secure, permission-gated endpoint
    window.open(`/api/applications/${application.id}/resume?download=1`, '_blank');
    // Track download for analytics/status (server also marks for recruiter/admin)
    markDownloadedMutation.mutate(application.id);
  };

  const handleApplicationView = (applicationId: number) => {
    markViewedMutation.mutate(applicationId);
  };

  // Kanban-specific handlers
  const handleToggleSelect = (id: number) => {
    setSelectedApplications((prev) =>
      prev.includes(id) ? prev.filter((appId) => appId !== id) : [...prev, id]
    );
  };

  const handleOpenDetails = async (application: Application, contextApplications?: Application[]) => {
    setSelectedApp(application);
    setSelectedAppContext(
      (contextApplications && contextApplications.length > 0 ? contextApplications : [application]).slice()
    );
    setSelectedAppResumeText(null);
    handleApplicationView(application.id);

    // Fetch resume text in background for fallback display
    if (application.id) {
      try {
        const res = await fetch(`/api/applications/${application.id}/resume-text`, {
          credentials: "include",
        });
        if (res.ok) {
          const data = await res.json();
          if (typeof data.text === "string") {
            setSelectedAppResumeText(data.text);
          }
        }
      } catch {
        // Ignore - fallback text unavailable
      }
    }
  };

  const handleCloseDetails = () => {
    setSelectedApp(null);
    setSelectedAppContext([]);
    setSelectedAppResumeText(null);
  };

  useEffect(() => {
    if (!deepLinkedApplicationId || !applications?.length) {
      return;
    }

    const targetApplication = applications.find((app) => app.id === deepLinkedApplicationId);
    if (!targetApplication) {
      setDeepLinkedApplicationId(null);
      return;
    }

    if (selectedApp?.id === targetApplication.id) {
      setDeepLinkedApplicationId(null);
      return;
    }

    void handleOpenDetails(targetApplication);
    setDeepLinkedApplicationId(null);
  }, [applications, deepLinkedApplicationId, selectedApp?.id]);

  const handleDragCancel = () => {
    toast({
      title: applicationManagementCopy.toasts.dragCancelledTitle,
      description: applicationManagementCopy.toasts.dragCancelledDescription,
    });
  };

  const handleDragEnd = async (applicationId: number, targetStageId: number) => {
    // Optimistic update
    const previousApplications = applications;

    queryClient.setQueryData(["/api/jobs", jobId, "applications"], (old: Application[] | undefined) => {
      if (!old) return old;
      return old.map((app) =>
        app.id === applicationId ? { ...app, currentStage: targetStageId } : app
      );
    });

    try {
      await updateStageMutation.mutateAsync({
        applicationId,
        stageId: targetStageId
      });
    } catch (error) {
      // Revert on error
      queryClient.setQueryData(["/api/jobs", jobId, "applications"], previousApplications);
      toast({
        title: applicationManagementCopy.toasts.moveFailedTitle,
        description: applicationManagementCopy.toasts.moveFailedDescription,
        variant: "destructive",
      });
    }
  };

  const handleBulkMoveStage = async (stageId: number) => {
    if (selectedApplications.length === 0) {
      toast({
        title: applicationManagementCopy.toasts.noApplicationsSelectedTitle,
        description: applicationManagementCopy.toasts.noApplicationsSelectedDescription,
        variant: "destructive",
      });
      return;
    }

    let success = 0;
    const failed: BulkFailureDetail[] = [];
    const total = selectedApplications.length;

    setBulkProgress({ sent: 0, total });

    // Process with concurrency limit of 3
    const concurrencyLimit = 3;
    for (let i = 0; i < selectedApplications.length; i += concurrencyLimit) {
      const batch = selectedApplications.slice(i, i + concurrencyLimit);
      await Promise.allSettled(
        batch.map(async (id) => {
          try {
            await updateStageMutation.mutateAsync({ applicationId: id, stageId });
            success++;
          } catch (error: any) {
            failed.push({
              applicationId: id,
              error: error?.message || "Failed to move stage",
            });
          } finally {
            setBulkProgress((p) => ({ sent: Math.min(p.sent + 1, total), total }));
          }
        })
      );
    }

    setBulkProgress({ sent: 0, total: 0 });
    setSelectedApplications([]);

    if (failed.length > 0) {
      toast({
        title: "Bulk move completed with issues",
        description: `${applicationManagementCopy.toasts.movedPrefix} ${success}. Failed: ${describeBulkFailures(failed, applications || [])}`,
        variant: "destructive",
      });
    } else {
      toast({
        title: applicationManagementCopy.toasts.bulkMoveCompleteTitle,
        description: `${applicationManagementCopy.toasts.movedPrefix} ${success}, ${applicationManagementCopy.toasts.failedPrefix} 0`,
      });
    }
  };

  const handleBulkSendEmails = async (templateId: number) => {
    await sendBulkEmailsMutation.mutateAsync({
      applicationIds: selectedApplications,
      templateId,
    });
  };

  const handleBulkSendForms = async (formId: number, message: string) => {
    await sendBulkFormsMutation.mutateAsync({
      applicationIds: selectedApplications,
      formId,
      ...(message && { customMessage: message })
    });
  };

  const handleClearSelection = () => {
    setSelectedApplications([]);
  };

  const handleSelectAll = (selected: boolean) => {
    if (selected) {
      // Select all filtered applications
      setSelectedApplications(filteredApplications.map(app => app.id));
    } else {
      setSelectedApplications([]);
    }
  };

  // Archive (uses bulk status update to mark as rejected with archive note)
  const handleArchiveSelected = async () => {
    if (selectedApplications.length === 0) return;
    await bulkUpdateMutation.mutateAsync({
      applicationIds: selectedApplications,
      status: 'rejected',
      notes: '[Archived via bulk action]'
    });
  };

  const handleRequestHiringManagerReview = async (note: string) => {
    if (selectedApplications.length === 0) return;
    await requestHiringManagerReviewMutation.mutateAsync({
      applicationIds: selectedApplications,
      note,
    });
  };

  const handleMoveStageFromPanel = (stageId: number, notes?: string) => {
    if (!selectedApp) return;
    updateStageMutation.mutate({
      applicationId: selectedApp.id,
      stageId,
      ...(notes && { notes }),
    });
  };

  const handleScheduleInterviewFromPanel = (data: {
    date: string;
    time: string;
    location: string;
    notes: string;
  }) => {
    if (!selectedApp) return;
    scheduleInterviewMutation.mutate({
      applicationId: selectedApp.id,
      ...data,
    });
  };

  const handleSendEmailFromPanel = (payload: EmailSendPayload) => {
    if (!selectedApp) return;
    sendEmailMutation.mutate({
      applicationId: selectedApp.id,
      ...payload,
    });
  };

  const handleSendFormFromPanel = (formId: number, message: string) => {
    if (!selectedApp) return;
    formsApi.createInvitation({
      applicationId: selectedApp.id,
      formId,
      ...(message && { customMessage: message })
    }).then(() => {
      toast({
        title: applicationManagementCopy.toasts.invitationSentTitle,
        description: applicationManagementCopy.toasts.invitationSentDescription,
      });
    }).catch((error) => {
      toast({
        title: applicationManagementCopy.toasts.invitationFailedTitle,
        description: error.message,
        variant: "destructive",
      });
    });
  };

  const handleAddNoteFromPanel = (note: string) => {
    if (!selectedApp) return;
    addNoteMutation.mutate({
      applicationId: selectedApp.id,
      note,
    });
  };

  const handleSetRatingFromPanel = (rating: number) => {
    if (!selectedApp) return;
    setRatingMutation.mutate({
      applicationId: selectedApp.id,
      rating,
    });
  };

  const handleDownloadResumeFromPanel = () => {
    if (!selectedApp) return;
    handleResumeDownload(selectedApp);
  };

  // Export applications to CSV
  const handleExportCSV = () => {
    if (!applications || applications.length === 0) {
      toast({
        title: applicationManagementCopy.toasts.noDataTitle,
        description: applicationManagementCopy.toasts.noDataDescription,
        variant: "destructive",
      });
      return;
    }

    try {
      // Helper to escape CSV values
      const escapeCsv = (val: any): string => {
        if (val === null || val === undefined) return '';
        const str = String(val);
        // Wrap in quotes if contains comma, quote, or newline
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      // Get stage name helper
      const getStageName = (stageId: number | null | undefined): string => {
        if (!stageId || !pipelineStages) return 'Unassigned';
        const stage = pipelineStages.find(s => s.id === stageId);
        return stage?.name || 'Unknown';
      };

      // CSV header
      const headers = [
        'Name',
        'Email',
        'Phone',
        'Status',
        'Pipeline Stage',
        'Applied Date',
        'AI Fit Score',
        'AI Fit Label',
        'Rating',
        'Tags',
        'Resume URL'
      ];

      // CSV rows
      const rows = applications.map(app => [
        escapeCsv(app.name),
        escapeCsv(app.email),
        escapeCsv(app.phone),
        escapeCsv(app.status),
        escapeCsv(getStageName(app.currentStage)),
        escapeCsv(app.appliedAt ? new Date(app.appliedAt).toISOString() : ''),
        escapeCsv(app.aiFitScore),
        escapeCsv(app.aiFitLabel),
        escapeCsv(app.rating),
        escapeCsv(app.tags?.join('; ')),
        escapeCsv(app.resumeUrl)
      ].join(','));

      // Combine header and rows
      const csvContent = '\ufeff' + headers.join(',') + '\n' + rows.join('\n');

      // Create blob and download
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `applications-${job?.title?.replace(/[^a-z0-9]/gi, '-') || 'export'}-${Date.now()}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: applicationManagementCopy.toasts.exportSuccessTitle,
        description: `Exported ${applications.length} application(s) to CSV.`,
      });
    } catch (error: any) {
      toast({
        title: applicationManagementCopy.toasts.exportFailedTitle,
        description: error.message || applicationManagementCopy.toasts.exportFailedDescription,
        variant: "destructive",
      });
    }
  };

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      submitted: { color: "bg-info/10 text-info-foreground border-info/30", icon: Clock },
      reviewed: { color: "bg-warning/10 text-warning-foreground border-warning/30", icon: Eye },
      shortlisted: { color: "bg-success/10 text-success-foreground border-success/30", icon: UserCheck },
      rejected: { color: "bg-destructive/10 text-destructive border-destructive/30", icon: XCircle },
      downloaded: { color: "bg-primary/10 text-primary border-primary/30", icon: Download },
    };

    const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.submitted;
    const Icon = config.icon;

    return (
      <Badge variant="secondary" className={config.color}>
        <Icon className="w-3 h-3 mr-1" />
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    );
  };

  const formatDate = (dateString: string | Date) => {
    const date = typeof dateString === 'string' ? new Date(dateString) : dateString;
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const filteredApplications = applications?.filter(app => {
    // AI Suggested Action Filter
    const matchesAction = actionFilter.length === 0 ||
      (actionFilter.includes('Not Analyzed') && !app.aiSuggestedAction) ||
      (app.aiSuggestedAction && actionFilter.includes(app.aiSuggestedAction));
    return matchesAction;
  }).sort((a, b) => {
    // Keep existing default ordering: newest applications first
    return new Date(b.appliedAt).getTime() - new Date(a.appliedAt).getTime();
  }) || [];

  // AI Summary: Calculate to-generate count (apps needing summaries)
  // Use full applications list (not filteredApplications) to handle selections persisting across filters
  const selectedAppsData = (applications || []).filter(app => selectedApplications.includes(app.id));
  const appsWithSummary = selectedAppsData.filter(app => app.aiSummary);
  const appsWithoutSummary = selectedAppsData.filter(app => !app.aiSummary);
  const toGenerateCount = regenerateSummaries ? selectedAppsData.length : appsWithoutSummary.length;
  const willSkipCount = regenerateSummaries ? 0 : appsWithSummary.length;

  // Visible apps for current tab (used by Select All)
  const getVisibleApplications = (): Application[] => {
    if (!applications) return [];
    return filteredApplications;
  };

  const totalApplications = applications?.length || 0;
  const shortlistedApplications = applications?.filter((app) => app.status === "shortlisted").length || 0;
  const toReviewApplications =
    applications?.filter((app) => !["shortlisted", "rejected"].includes(app.status)).length || 0;
  const showAiFilterBar =
    actionFilter.length > 0 || (hasTriggeredAISummaryFilters && selectedApplications.length > 0);

  const jobStatusBadge =
    job?.status === "approved"
      ? {
          label: "Active",
          className: "border-emerald-200 bg-emerald-50 text-emerald-700",
        }
      : job?.status === "pending"
        ? {
            label: applicationManagementCopy.header.pendingApprovalTitle,
            className: "border-amber-200 bg-amber-50 text-amber-700",
          }
        : {
            label: job?.status ? job.status.charAt(0).toUpperCase() + job.status.slice(1) : "Unknown",
            className: "border-border bg-muted text-foreground",
          };

  const heroStats = [
    { label: "Total Apps", value: totalApplications, accent: "text-primary" },
    { label: "To Review", value: toReviewApplications, accent: "text-amber-600" },
    { label: "Shortlisted", value: shortlistedApplications, accent: "text-emerald-600" },
  ];


  if (jobLoading || applicationsLoading) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-8">
          <div className="max-w-7xl mx-auto space-y-6 pt-8">
            <PageHeaderSkeleton />
            <Card className="shadow-sm">
              <CardHeader>
                <div className="h-6 w-48 bg-muted rounded animate-pulse" />
                <div className="h-4 w-64 bg-muted rounded animate-pulse mt-2" />
              </CardHeader>
            </Card>
            <FilterBarSkeleton />
            <div className="rounded-lg border border-border bg-card shadow-sm p-4">
              <KanbanBoardSkeleton columns={5} />
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  if (!job) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-8">
          <Card className="shadow-sm">
            <CardContent className="p-8 text-center">
              <h3 className="text-xl font-semibold text-foreground mb-2">Job Not Found</h3>
              <p className="text-muted-foreground">
                {jobError?.message || "The requested job could not be found."}
              </p>
            </CardContent>
          </Card>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className={`container mx-auto px-4 py-8 transition-opacity duration-500 ${isVisible ? 'opacity-100' : 'opacity-0'}`}>
        <div className="mx-auto max-w-7xl space-y-6">
          <div className="flex flex-wrap items-center gap-3 pt-8 text-sm">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLocation("/my-jobs")}
              className="h-auto rounded-none px-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Jobs
            </Button>
            <span className="text-muted-foreground">/</span>
            <span className="font-medium text-foreground">Application Management</span>
          </div>

          <section className="border border-border/70 bg-[linear-gradient(180deg,#ffffff_0%,#f8f8ff_100%)] p-6 shadow-[0_20px_60px_rgba(15,23,42,0.06)] md:p-8">
            <div className="flex flex-col gap-8 xl:flex-row xl:items-start xl:justify-between">
              <div className="space-y-4">
                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                    Application Management
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <h1 className="text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
                      {job.title}
                    </h1>
                    <Badge className={`rounded-none ${jobStatusBadge.className}`}>{jobStatusBadge.label}</Badge>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground md:text-base">
                  <span className="flex items-center gap-2">
                    <MapPin className="h-4 w-4" />
                    {job.location || "Location unavailable"}
                  </span>
                  <span className="hidden text-border md:inline">|</span>
                  <span className="flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    {applicationManagementCopy.header.postedPrefix} {formatDate(job.createdAt)}
                  </span>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3 xl:min-w-[480px] xl:max-w-[520px] xl:flex-1">
                {heroStats.map((stat) => (
                  <Card key={stat.label} className="rounded-none border border-border/80 bg-white/95 shadow-sm">
                    <CardContent className="space-y-3 p-5">
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        {stat.label}
                      </p>
                      <p className={`text-4xl font-semibold leading-none ${stat.accent}`}>{stat.value}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </section>

          <div data-tour="job-context">
            <JobSubNav jobId={jobId!} variant="inline" className="mb-0" />
          </div>

          {job.status === 'pending' && (
            <Alert className="border-warning/50 bg-warning/10">
              <Clock className="h-4 w-4 text-warning" />
              <AlertTitle className="text-warning-foreground">{applicationManagementCopy.header.pendingApprovalTitle}</AlertTitle>
              <AlertDescription className="text-muted-foreground">
                {applicationManagementCopy.header.pendingApprovalDescription}
              </AlertDescription>
            </Alert>
          )}

          <div className="border border-border/70 bg-white shadow-sm">
            <div className="p-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Job Actions
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-none"
                  onClick={() => {
                    if (selectedApplications.length === 0) {
                      toast({
                        title: applicationManagementCopy.validation.noCandidatesTitle,
                        description: applicationManagementCopy.validation.noCandidatesDescription,
                        variant: "destructive",
                      });
                      return;
                    }
                    if (!job?.clientId) {
                      toast({
                        title: applicationManagementCopy.validation.noClientTitle,
                        description: applicationManagementCopy.validation.noClientDescription,
                        variant: "destructive",
                      });
                      return;
                    }
                    setShowShareShortlistDialog(true);
                  }}
                >
                  <Users className="mr-2 h-4 w-4" />
                  {applicationManagementCopy.actions.shareWithClient}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-none"
                  onClick={() => {
                    if (selectedApplications.length === 0) {
                      toast({
                        title: applicationManagementCopy.validation.noCandidatesTitle,
                        description: applicationManagementCopy.validation.noCandidatesDescription,
                        variant: "destructive",
                      });
                      return;
                    }
                    setShowBatchInterviewDialog(true);
                  }}
                >
                  <Calendar className="mr-2 h-4 w-4" />
                  {applicationManagementCopy.actions.batchInterview}
                </Button>
                <Button variant="outline" size="sm" className="rounded-none" onClick={() => setBulkImportDialogOpen(true)}>
                  <Upload className="mr-2 h-4 w-4" />
                  Import Resumes
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-none"
                  onClick={() => handleExportCSV()}
                  disabled={!applications || applications.length === 0}
                >
                  <FileDown className="mr-2 h-4 w-4" />
                  Export CSV
                </Button>
              </div>

              <div className="flex justify-start xl:justify-end">
                <Button size="sm" className="rounded-none" onClick={() => setAddCandidateModalOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  {applicationManagementCopy.actions.addCandidate}
                </Button>
              </div>
            </div>

            <div className="mt-4 space-y-0 border-t border-border/70">
              <div data-tour="bulk-actions" className="border-b border-border/70">
                <BulkActionBar
                  selectedCount={selectedApplications.length}
                  totalCount={filteredApplications.length}
                  pipelineStages={pipelineStages}
                  emailTemplates={emailTemplates}
                  formTemplates={formTemplates}
                  onMoveStage={handleBulkMoveStage}
                  onSendEmails={handleBulkSendEmails}
                  onSendForms={handleBulkSendForms}
                  onSelectAll={handleSelectAll}
                  onClearSelection={handleClearSelection}
                  onArchiveSelected={handleArchiveSelected}
                  onRequestHiringManagerReview={handleRequestHiringManagerReview}
                  canRequestHiringManagerReview={!!job?.hiringManagerId}
                  hiringManagerReviewDisabledReason={!job?.hiringManagerId ? "Assign a hiring manager to this job before requesting review." : undefined}
                  isBulkProcessing={sendBulkEmailsMutation.isPending || sendBulkFormsMutation.isPending || bulkUpdateMutation.isPending || requestHiringManagerReviewMutation.isPending || startAISummaryMutation.isPending || !!aiSummaryJobId}
                  bulkProgress={bulkProgress}
                  onGenerateAISummary={() => {
                    setHasTriggeredAISummaryFilters(true);
                    setShowAISummaryDialog(true);
                  }}
                  aiSummaryEnabled={true}
                  aiSummaryLimit={summaryLimitStatus?.effectiveRemaining}
                  aiSummaryToGenerateCount={toGenerateCount}
                />
              </div>

              {showAiFilterBar && (
                <div className="border-b border-border/70 bg-slate-50/60 p-4" data-tour="applications-filters">
                  <div className="flex flex-col gap-3 border border-border bg-white px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Sparkles className="h-4 w-4 text-muted-foreground" />
                        <Label className="whitespace-nowrap text-sm font-medium text-foreground">
                          {applicationManagementCopy.filters.aiAction}
                        </Label>
                        <span className="cursor-help" title={applicationManagementCopy.filters.aiActionHelp}>
                          <Info className="h-3.5 w-3.5 text-muted-foreground" />
                        </span>
                      </div>

                      <div className="text-sm text-muted-foreground">
                        {selectedApplications.length > 0
                          ? `${selectedApplications.length} candidate${selectedApplications.length === 1 ? "" : "s"} selected`
                          : "AI filters ready"}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {['advance', 'hold', 'reject', 'Not Analyzed'].map((action) => {
                        const isActive = actionFilter.includes(action);
                        const displayLabel =
                          action === 'Not Analyzed'
                            ? applicationManagementCopy.filters.notAnalyzed
                            : action.charAt(0).toUpperCase() + action.slice(1);
                        const getActionStyle = () => {
                          if (!isActive) return 'hover:bg-muted';
                          switch (action) {
                            case 'advance': return 'bg-green-500 text-white hover:bg-green-600';
                            case 'hold': return 'bg-amber-500 text-white hover:bg-amber-600';
                            case 'reject': return 'bg-red-500 text-white hover:bg-red-600';
                            case 'Not Analyzed': return 'bg-gray-500 text-white hover:bg-gray-600';
                            default: return 'bg-primary text-primary-foreground hover:bg-primary/90';
                          }
                        };
                        return (
                          <Badge
                            key={action}
                            variant={isActive ? "default" : "outline"}
                            className={`cursor-pointer text-xs transition-all ${getActionStyle()}`}
                            onClick={() => {
                              setActionFilter((prev) =>
                                isActive
                                  ? prev.filter((a) => a !== action)
                                  : [...prev, action]
                              );
                            }}
                          >
                            {displayLabel}
                          </Badge>
                        );
                      })}
                      {actionFilter.length > 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 rounded-none px-2 text-xs text-muted-foreground hover:text-foreground"
                          onClick={() => setActionFilter([])}
                        >
                          <X className="mr-1 h-3 w-3" />
                          Clear
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
            </div>

            <div className="border-t border-border/70 bg-card p-4 overflow-hidden" data-tour="kanban-board">
              <div className="mb-4 flex justify-end">
                <div className="pointer-events-none border border-border bg-white/95 px-3 py-1 text-xs text-muted-foreground shadow-sm">
                  Showing {filteredApplications.length} of {totalApplications} applications
                </div>
              </div>
              <div className="min-h-[600px]">
              <KanbanBoard
                applications={filteredApplications}
                pipelineStages={[...pipelineStages].sort((a, b) => (a.order - b.order) || (a.id - b.id))}
                selectedIds={selectedApplications}
                onToggleSelect={handleToggleSelect}
                onOpenDetails={handleOpenDetails}
                onDragEnd={handleDragEnd}
                onDragCancel={handleDragCancel}
                onQuickMoveStage={(appId, stageId) => {
                  updateStageMutation.mutate({ applicationId: appId, stageId });
                }}
                onQuickEmail={(appId) => {
                  const app = applications?.find(a => a.id === appId);
                  if (app) {
                    setEmailDialogApp(app);
                    setSelectedTemplateId(null);
                    setShowEmailDialog(true);
                  }
                }}
                onQuickInterview={(appId) => {
                  const app = applications?.find(a => a.id === appId);
                  if (app) {
                    handleOpenDetails(app);
                  }
                }}
                onQuickDownload={(appId) => {
                  window.open(`/api/applications/${appId}/resume?download=1`, '_blank');
                }}
                onToggleStageSelect={(stageId, shouldSelect) => {
                  const stageApps = applications?.filter(app => 
                    // Handle unassigned (stageId null) vs specific stage
                    stageId === null ? app.currentStage === null : app.currentStage === stageId
                  ) || [];
                  const stageAppIds = stageApps.map(app => app.id);

                  if (shouldSelect) {
                    // Exclusive selection: Select ONLY this stage's apps
                    setSelectedApplications(stageAppIds);
                  } else {
                    // Deselect ONLY this stage's apps
                    setSelectedApplications(prev => prev.filter(id => !stageAppIds.includes(id)));
                  }
                }}
              />
              </div>
            </div>
          </div>

          {/* Application Detail Modal */}
          <ApplicationDetailModal
            application={selectedApp}
            applications={selectedAppContext}
            jobId={jobId!}
            pipelineStages={pipelineStages}
            emailTemplates={emailTemplates}
            formTemplates={formTemplates}
            stageHistory={stageHistory}
            resumeText={selectedAppResumeText}
            open={!!selectedApp}
            onClose={handleCloseDetails}
            onSelectApplication={(application) => {
              void handleOpenDetails(application, selectedAppContext);
            }}
            onMoveStage={handleMoveStageFromPanel}
            onScheduleInterview={handleScheduleInterviewFromPanel}
            onSendEmail={handleSendEmailFromPanel}
            onSendForm={handleSendFormFromPanel}
            onAddNote={handleAddNoteFromPanel}
            onSetRating={handleSetRatingFromPanel}
            onDownloadResume={handleDownloadResumeFromPanel}
            onUpdateStatus={(status: string, notes?: string) => {
              if (!selectedApp) return;
              handleStatusUpdate(selectedApp.id, status, notes);
            }}
          />
        </div>

        {/* ATS Dialogs */}

        {/* Interview Scheduling Dialog */}
        <Dialog key={`interview-${selectedApp?.id ?? 'none'}`} open={showInterviewDialog} onOpenChange={setShowInterviewDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{applicationManagementCopy.dialogs.interview.titlePrefix} - {selectedApp?.name}</DialogTitle>
              <DialogDescription>
                {applicationManagementCopy.dialogs.interview.description}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <div>
                <Label>{applicationManagementCopy.dialogs.interview.date}</Label>
                <Input
                  type="datetime-local"
                  value={interviewDate}
                  onChange={(e) => setInterviewDate(e.target.value)}
                />
              </div>
              <div>
                <Label>{applicationManagementCopy.dialogs.interview.time}</Label>
                <Input
                  type="text"
                  placeholder={applicationManagementCopy.dialogs.interview.timePlaceholder}
                  value={interviewTime}
                  onChange={(e) => setInterviewTime(e.target.value)}
                />
              </div>
              <div>
                <Label>{applicationManagementCopy.dialogs.interview.location}</Label>
                <Input
                  type="text"
                  placeholder={applicationManagementCopy.dialogs.interview.locationPlaceholder}
                  value={interviewLocation}
                  onChange={(e) => setInterviewLocation(e.target.value)}
                />
              </div>
              <div>
                <Label>{applicationManagementCopy.dialogs.interview.notes}</Label>
                <Textarea
                  placeholder={applicationManagementCopy.dialogs.interview.notesPlaceholder}
                  value={interviewNotes}
                  onChange={(e) => setInterviewNotes(e.target.value)}
                />
              </div>
              <Button
                onClick={() =>
                  selectedApp &&
                  scheduleInterviewMutation.mutate({
                    applicationId: selectedApp.id,
                    date: interviewDate,
                    time: interviewTime,
                    location: interviewLocation,
                    notes: interviewNotes,
                  })
                }
                disabled={!interviewDate || !interviewTime || !interviewLocation || scheduleInterviewMutation.isPending}
                className="w-full"
              >
                {scheduleInterviewMutation.isPending ? applicationManagementCopy.dialogs.interview.submitting : applicationManagementCopy.dialogs.interview.submit}
              </Button>

              {/* Download Calendar Invite - show if interview is already scheduled */}
              {selectedApp?.interviewDate && selectedApp?.interviewTime && (
                <div className="pt-4 border-t">
                  <p className="text-sm text-muted-foreground mb-2">
                    {applicationManagementCopy.dialogs.interview.scheduledPrefix} {new Date(selectedApp.interviewDate).toLocaleDateString()} at {selectedApp.interviewTime}
                  </p>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={(e) => {
                      e.preventDefault();
                      window.open(`/api/applications/${selectedApp.id}/interview/ics`, '_blank');
                    }}
                  >
                    <FileDown className="h-4 w-4 mr-2" />
                    {applicationManagementCopy.dialogs.interview.downloadInvite}
                  </Button>
                  <p className="text-xs text-muted-foreground mt-2">
                    {applicationManagementCopy.dialogs.interview.downloadInviteHint}
                  </p>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* Email Sending Dialog */}
        <Dialog
          key={`email-${(emailDialogApp ?? selectedApp)?.id ?? 'none'}`}
          open={showEmailDialog}
          onOpenChange={(open) => {
            setShowEmailDialog(open);
            if (!open) {
              setEmailDialogApp(null);
              setSelectedTemplateId(null);
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {applicationManagementCopy.dialogs.email.titlePrefix} - {(emailDialogApp ?? selectedApp)?.name}
              </DialogTitle>
              <DialogDescription>
                {applicationManagementCopy.dialogs.email.description}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <div>
                <Label>{applicationManagementCopy.dialogs.email.template}</Label>
                <Select
                  value={selectedTemplateId?.toString() || ""}
                  onValueChange={(value) => setSelectedTemplateId(parseInt(value))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={applicationManagementCopy.dialogs.email.templatePlaceholder} />
                  </SelectTrigger>
                  <SelectContent>
                    {emailTemplates.map(template => (
                      <SelectItem key={template.id} value={template.id.toString()}>
                        {template.name} - {template.subject}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {selectedTemplateId && (
                <div className="p-3 bg-muted/50 rounded-lg border border-border">
                  <Label className="text-sm text-muted-foreground">{applicationManagementCopy.dialogs.email.preview}</Label>
                  <p className="text-sm text-foreground mt-1">
                    {emailTemplates.find(t => t.id === selectedTemplateId)?.body.substring(0, 200)}...
                  </p>
                </div>
              )}
              <Button
                onClick={() =>
                  (emailDialogApp ?? selectedApp) &&
                  selectedTemplateId &&
                  sendEmailMutation.mutate({
                    applicationId: (emailDialogApp ?? selectedApp)!.id,
                    templateId: selectedTemplateId,
                  })
                }
                disabled={!selectedTemplateId || sendEmailMutation.isPending}
                className="w-full"
              >
                {sendEmailMutation.isPending ? applicationManagementCopy.dialogs.email.submitting : applicationManagementCopy.dialogs.email.submit}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Share Shortlist Dialog */}
        <Dialog open={showShareShortlistDialog} onOpenChange={setShowShareShortlistDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{applicationManagementCopy.dialogs.shortlist.title}</DialogTitle>
              <DialogDescription>
                {applicationManagementCopy.dialogs.shortlist.description}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <div>
                <Label>{applicationManagementCopy.dialogs.shortlist.client}</Label>
                <p className="text-sm text-foreground font-medium">
                  {job?.clientId ? job?.title : applicationManagementCopy.dialogs.shortlist.noClientLinked}
                </p>
                {!job?.clientId && (
                  <p className="text-xs text-destructive mt-1">
                    {applicationManagementCopy.dialogs.shortlist.noClientHint}
                  </p>
                )}
              </div>
              <div>
                <Label>{applicationManagementCopy.dialogs.shortlist.titleLabel}</Label>
                <Input
                  value={shortlistTitle}
                  onChange={(e) => setShortlistTitle(e.target.value)}
                  placeholder={job?.title || applicationManagementCopy.dialogs.shortlist.titlePlaceholder}
                />
              </div>
              <div>
                <Label>{applicationManagementCopy.dialogs.shortlist.messageLabel}</Label>
                <Textarea
                  value={shortlistMessage}
                  onChange={(e) => setShortlistMessage(e.target.value)}
                  placeholder={applicationManagementCopy.dialogs.shortlist.messagePlaceholder}
                  rows={3}
                />
              </div>
              <div>
                <Label>{applicationManagementCopy.dialogs.shortlist.expiresAt}</Label>
                <Input
                  type="date"
                  value={shortlistExpiresAt}
                  onChange={(e) => setShortlistExpiresAt(e.target.value)}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {applicationManagementCopy.dialogs.shortlist.expiresHint}
                </p>
              </div>

              {shortlistUrl && (
                <div className="p-3 bg-muted/50 border border-border rounded-md space-y-2">
                  <Label className="text-xs text-muted-foreground">{applicationManagementCopy.dialogs.shortlist.shareableLink}</Label>
                  <div className="flex items-center gap-2">
                    <Input value={shortlistUrl} readOnly className="text-xs" />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        navigator.clipboard
                          .writeText(shortlistUrl)
                          .then(() =>
                            toast({
                              title: applicationManagementCopy.toasts.linkCopiedTitle,
                              description: applicationManagementCopy.toasts.linkCopiedDescription,
                            })
                          )
                          .catch(() =>
                            toast({
                              title: applicationManagementCopy.toasts.copyFailedTitle,
                              description: applicationManagementCopy.toasts.copyFailedDescription,
                              variant: "destructive",
                            })
                          );
                      }}
                    >
                      {applicationManagementCopy.dialogs.shortlist.copy}
                    </Button>
                  </div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setShowShareShortlistDialog(false);
                  setShortlistUrl(null);
                  setShortlistTitle("");
                  setShortlistMessage("");
                  setShortlistExpiresAt("");
                }}
              >
                {applicationManagementCopy.dialogs.shortlist.close}
              </Button>
              <Button
                onClick={() => createShortlistMutation.mutate()}
                disabled={
                  !job?.clientId ||
                  selectedApplications.length === 0 ||
                  createShortlistMutation.isPending
                }
              >
                {createShortlistMutation.isPending ? applicationManagementCopy.dialogs.shortlist.creating : applicationManagementCopy.dialogs.shortlist.create}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Bulk Email Dialog */}
        <Dialog key={`bulk-email-${selectedApplications.length}`} open={showBulkEmailDialog} onOpenChange={setShowBulkEmailDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{applicationManagementCopy.dialogs.bulkEmail.titlePrefix} - {selectedApplications.length} {applicationManagementCopy.dialogs.bulkEmail.titleSuffix}</DialogTitle>
              <DialogDescription>
                {applicationManagementCopy.dialogs.bulkEmail.description}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <div className="flex items-center gap-3 p-2 bg-muted/50 rounded border border-border">
                <Checkbox
                  checked={getVisibleApplications().every(a => selectedApplications.includes(a.id)) && getVisibleApplications().length > 0}
                  onCheckedChange={(checked) => {
                    const visible = getVisibleApplications().map(a => a.id);
                    if (checked) {
                      setSelectedApplications(Array.from(new Set([...selectedApplications, ...visible])));
                    } else {
                      setSelectedApplications(selectedApplications.filter(id => !visible.includes(id)));
                    }
                  }}
                />
                <span className="text-sm text-muted-foreground">{applicationManagementCopy.dialogs.bulkEmail.selectAllInView}</span>
                {selectedApplications.length > 0 && (
                  <button
                    className="text-xs text-muted-foreground underline ml-auto hover:text-foreground"
                    onClick={() => setSelectedApplications([])}
                  >
                    {applicationManagementCopy.dialogs.bulkEmail.clearSelection}
                  </button>
                )}
              </div>
              <div>
                <Label>{applicationManagementCopy.dialogs.bulkEmail.template}</Label>
                <Select
                  value={bulkTemplateId?.toString() || ""}
                  onValueChange={(value) => setBulkTemplateId(parseInt(value))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={applicationManagementCopy.dialogs.bulkEmail.templatePlaceholder} />
                  </SelectTrigger>
                  <SelectContent>
                    {emailTemplates.map((template) => (
                      <SelectItem key={template.id} value={template.id.toString()}>
                        {template.name} - {template.subject}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {bulkTemplateId && (
                <div className="p-3 bg-muted/50 rounded-lg border border-border">
                  <Label className="text-sm text-muted-foreground">{applicationManagementCopy.dialogs.bulkEmail.preview}</Label>
                  <p className="text-sm text-foreground mt-1">
                    {emailTemplates.find((t) => t.id === bulkTemplateId)?.body.substring(0, 200)}...
                  </p>
                </div>
              )}
              <Button
                onClick={() =>
                  bulkTemplateId &&
                  sendBulkEmailsMutation.mutate({
                    applicationIds: selectedApplications,
                    templateId: bulkTemplateId,
                  })
                }
                disabled={!bulkTemplateId || sendBulkEmailsMutation.isPending}
                className="w-full"
              >
                {sendBulkEmailsMutation.isPending ? applicationManagementCopy.dialogs.bulkEmail.submitting : applicationManagementCopy.dialogs.bulkEmail.submit}
              </Button>
              {sendBulkEmailsMutation.isPending && (
                <p className="text-xs text-muted-foreground text-center">
                  {applicationManagementCopy.dialogs.bulkEmail.progressPrefix} {bulkProgress.sent}/{bulkProgress.total}...
                </p>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* Bulk Forms Dialog */}
        <Dialog key={`bulk-forms-${selectedApplications.length}`} open={showBulkFormsDialog} onOpenChange={setShowBulkFormsDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{applicationManagementCopy.dialogs.bulkForms.titlePrefix} - {selectedApplications.length} {applicationManagementCopy.dialogs.bulkForms.titleSuffix}</DialogTitle>
              <DialogDescription>
                {applicationManagementCopy.dialogs.bulkForms.description}
              </DialogDescription>
            </DialogHeader>
            {/* Invitation Quota Display */}
            {invitationQuota && (
              <div className={`flex items-center justify-between p-2 rounded-md text-sm ${
                invitationQuota.remaining === 0
                  ? 'bg-destructive/10 border border-destructive/30 text-destructive'
                  : invitationQuota.remaining <= 10
                  ? 'bg-warning/10 border border-warning/30 text-warning-foreground'
                  : 'bg-info/10 border border-info/30 text-info-foreground'
              }`}>
                <span>
                  {invitationQuota.remaining === 0
                    ? applicationManagementCopy.dialogs.bulkForms.dailyInviteLimitReached
                    : `${invitationQuota.remaining} ${applicationManagementCopy.dialogs.bulkForms.invitesRemainingSuffix}`}
                </span>
                <span className="text-xs opacity-75">
                  ({invitationQuota.used}/{invitationQuota.limit} {applicationManagementCopy.dialogs.bulkForms.usedSuffix})
                </span>
              </div>
            )}
            <div className="space-y-4 mt-4">
              <div className="flex items-center gap-3 p-2 bg-muted/50 rounded border border-border">
                <Checkbox
                  checked={getVisibleApplications().every(a => selectedApplications.includes(a.id)) && getVisibleApplications().length > 0}
                  onCheckedChange={(checked) => {
                    const visible = getVisibleApplications().map(a => a.id);
                    if (checked) {
                      setSelectedApplications(Array.from(new Set([...selectedApplications, ...visible])));
                    } else {
                      setSelectedApplications(selectedApplications.filter(id => !visible.includes(id)));
                    }
                  }}
                />
                <span className="text-sm text-muted-foreground">{applicationManagementCopy.dialogs.bulkForms.selectAllInView}</span>
                {selectedApplications.length > 0 && (
                  <button
                    className="text-xs text-muted-foreground underline ml-auto hover:text-foreground"
                    onClick={() => setSelectedApplications([])}
                  >
                    {applicationManagementCopy.dialogs.bulkForms.clearSelection}
                  </button>
                )}
              </div>
              <div>
                <Label>{applicationManagementCopy.dialogs.bulkForms.formTemplate}</Label>
                <Select
                  value={bulkFormId?.toString() || ""}
                  onValueChange={(value) => setBulkFormId(parseInt(value))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={applicationManagementCopy.dialogs.bulkForms.formTemplatePlaceholder} />
                  </SelectTrigger>
                  <SelectContent>
                    {formTemplates.map((template) => (
                      <SelectItem key={template.id} value={template.id.toString()}>
                        {template.name}
                        {template.description && ` - ${template.description.substring(0, 50)}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {bulkFormId && (
                <div className="p-3 bg-muted/50 rounded-lg border border-border">
                  <Label className="text-sm text-muted-foreground">{applicationManagementCopy.dialogs.bulkForms.formInfo}</Label>
                  {(() => {
                    const template = formTemplates.find((t) => t.id === bulkFormId);
                    return template ? (
                      <div className="text-sm text-foreground mt-1">
                        <p className="font-medium">{template.name}</p>
                        {template.description && (
                          <p className="text-muted-foreground mt-1">{template.description}</p>
                        )}
                        <p className="text-muted-foreground mt-1">
                          {template.fields?.length || 0} {template.fields?.length !== 1 ? applicationManagementCopy.dialogs.bulkForms.questionsSuffixPlural : applicationManagementCopy.dialogs.bulkForms.questionsSuffixSingle}
                        </p>
                      </div>
                    ) : null;
                  })()}
                </div>
              )}
              <div>
                <Label>{applicationManagementCopy.dialogs.bulkForms.customMessage}</Label>
                <Textarea
                  placeholder={applicationManagementCopy.dialogs.bulkForms.customMessagePlaceholder}
                  value={bulkFormMessage}
                  onChange={(e) => setBulkFormMessage(e.target.value)}
                  rows={3}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {applicationManagementCopy.dialogs.bulkForms.customMessageHint}
                </p>
              </div>
              <Button
                onClick={() =>
                  bulkFormId &&
                  sendBulkFormsMutation.mutate({
                    applicationIds: selectedApplications,
                    formId: bulkFormId,
                    ...(bulkFormMessage && { customMessage: bulkFormMessage }),
                  })
                }
                disabled={!bulkFormId || sendBulkFormsMutation.isPending || (invitationQuota?.remaining === 0)}
                className="w-full"
              >
                {sendBulkFormsMutation.isPending
                  ? applicationManagementCopy.dialogs.bulkForms.submitting
                  : invitationQuota?.remaining === 0
                  ? applicationManagementCopy.dialogs.bulkForms.dailyLimitReachedButton
                  : applicationManagementCopy.dialogs.bulkForms.submit}
              </Button>
              {sendBulkFormsMutation.isPending && (
                <p className="text-xs text-muted-foreground text-center">
                  {applicationManagementCopy.dialogs.bulkForms.progressPrefix} {bulkFormsProgress.sent}/{bulkFormsProgress.total}...
                </p>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* Batch Interview Dialog */}
        <Dialog open={showBatchInterviewDialog} onOpenChange={setShowBatchInterviewDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{applicationManagementCopy.dialogs.batchInterview.title}</DialogTitle>
              <DialogDescription>
                {applicationManagementCopy.dialogs.batchInterview.description}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label className="text-foreground text-sm">{applicationManagementCopy.dialogs.batchInterview.date}</Label>
                  <Input
                    type="date"
                    value={batchInterviewDate}
                    onChange={(e) => setBatchInterviewDate(e.target.value)}
                  />
                </div>
                <div>
                  <Label className="text-foreground text-sm">{applicationManagementCopy.dialogs.batchInterview.startTime}</Label>
                  <Input
                    type="time"
                    value={batchInterviewTime}
                    onChange={(e) => setBatchInterviewTime(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label className="text-foreground text-sm">{applicationManagementCopy.dialogs.batchInterview.intervalLabel}</Label>
                  <Select
                    value={batchIntervalHours}
                    onValueChange={setBatchIntervalHours}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={applicationManagementCopy.dialogs.batchInterview.intervalPlaceholder} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">{applicationManagementCopy.dialogs.batchInterview.intervalSameTime}</SelectItem>
                      <SelectItem value="0.5">0.5 hours</SelectItem>
                      <SelectItem value="1">1 hour</SelectItem>
                      <SelectItem value="2">2 hours</SelectItem>
                      <SelectItem value="3">3 hours</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-foreground text-sm">{applicationManagementCopy.dialogs.batchInterview.moveToStage}</Label>
                  <Select
                    value={batchStageId}
                    onValueChange={setBatchStageId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={applicationManagementCopy.dialogs.batchInterview.keepCurrent} />
                    </SelectTrigger>
                    <SelectContent>
                      {pipelineStages.map((stage) => (
                        <SelectItem key={stage.id} value={stage.id.toString()}>
                          {stage.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label className="text-foreground text-sm">{applicationManagementCopy.dialogs.batchInterview.location}</Label>
                <Input
                  placeholder={applicationManagementCopy.dialogs.batchInterview.locationPlaceholder}
                  value={batchLocation}
                  onChange={(e) => setBatchLocation(e.target.value)}
                />
              </div>

              <div>
                <Label className="text-foreground text-sm">{applicationManagementCopy.dialogs.batchInterview.notes}</Label>
                <Textarea
                  value={batchNotes}
                  onChange={(e) => setBatchNotes(e.target.value)}
                  placeholder={applicationManagementCopy.dialogs.batchInterview.notesPlaceholder}
                />
              </div>

              <p className="text-xs text-muted-foreground">
                {applicationManagementCopy.dialogs.batchInterview.hint}
              </p>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowBatchInterviewDialog(false)}
                disabled={batchInterviewMutation.isPending}
              >
                {applicationManagementCopy.dialogs.batchInterview.cancel}
              </Button>
              <Button
                onClick={() => batchInterviewMutation.mutate()}
                disabled={
                  batchInterviewMutation.isPending ||
                  !batchInterviewDate ||
                  !batchLocation ||
                  selectedApplications.length === 0
                }
              >
                {batchInterviewMutation.isPending ? applicationManagementCopy.dialogs.batchInterview.submitting : applicationManagementCopy.dialogs.batchInterview.submit}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Stage History Dialog */}
        <Dialog key={`history-${selectedApp?.id ?? 'none'}`} open={showHistoryDialog} onOpenChange={setShowHistoryDialog}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{applicationManagementCopy.dialogs.stageHistory.titlePrefix} - {selectedApp?.name}</DialogTitle>
              <DialogDescription>
                {applicationManagementCopy.dialogs.stageHistory.description}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 mt-4 max-h-96 overflow-y-auto">
              {stageHistory.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">{applicationManagementCopy.dialogs.stageHistory.empty}</p>
              ) : (
                stageHistory.map((history: any, idx: number) => {
                  const fromStage = pipelineStages.find(s => s.id === history.fromStage);
                  const toStage = pipelineStages.find(s => s.id === history.toStage);

                  return (
                    <div key={idx} className="flex gap-4 p-3 bg-muted/50 rounded-lg border border-border">
                      <div className="flex-shrink-0">
                        <div
                          className="w-3 h-3 rounded-full mt-1"
                          style={{ backgroundColor: toStage?.color || '#6b7280' }}
                        />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          {fromStage && fromStage.color && (
                            <Badge
                              style={{
                                backgroundColor: `${fromStage.color}20`,
                                borderColor: fromStage.color,
                                color: fromStage.color
                              }}
                              className="border text-xs"
                            >
                              {fromStage.name}
                            </Badge>
                          )}
                          <span className="text-slate-400">→</span>
                          {toStage && toStage.color && (
                            <Badge
                              style={{
                                backgroundColor: `${toStage.color}20`,
                                borderColor: toStage.color,
                                color: toStage.color
                              }}
                              className="border text-xs"
                            >
                              {toStage.name}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatDate(history.changedAt)}
                        </p>
                        {history.notes && (
                          <p className="text-sm text-muted-foreground mt-1">{history.notes}</p>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* Add Candidate Intake Form */}
        {jobId && (
          <CandidateIntakeForm
            jobId={jobId}
            open={addCandidateModalOpen}
            onOpenChange={setAddCandidateModalOpen}
          />
        )}

        {/* Bulk Resume Import Dialog */}
        {jobId && (
          <UploadDialog
            jobId={jobId}
            open={bulkImportDialogOpen}
            onOpenChange={setBulkImportDialogOpen}
          />
        )}

        {/* AI Summary Dialog */}
        <Dialog open={showAISummaryDialog} onOpenChange={(open) => {
          if (!open && !aiSummaryJobId) {
            setShowAISummaryDialog(false);
            setRegenerateSummaries(false);
          }
        }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                {applicationManagementCopy.dialogs.aiSummary.title}
              </DialogTitle>
              <DialogDescription>
                {applicationManagementCopy.dialogs.aiSummary.description}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {/* Selection and generation counts */}
              <div className="text-sm bg-muted/30 p-3 rounded-lg space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{applicationManagementCopy.dialogs.aiSummary.selectedCandidates}</span>
                  <span className="font-medium">{selectedApplications.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{applicationManagementCopy.dialogs.aiSummary.willGenerate}</span>
                  <span className="font-medium text-primary">{toGenerateCount}</span>
                </div>
                {willSkipCount > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">{applicationManagementCopy.dialogs.aiSummary.alreadyHaveSummaries}</span>
                    <span className="font-medium text-muted-foreground">{willSkipCount}</span>
                  </div>
                )}
              </div>

              {/* Error: selected > 50 */}
              {selectedApplications.length > 50 && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>{applicationManagementCopy.dialogs.aiSummary.tooManySelectedTitle}</AlertTitle>
                  <AlertDescription>
                    {applicationManagementCopy.dialogs.aiSummary.tooManySelectedDescriptionPrefix} {selectedApplications.length} {applicationManagementCopy.dialogs.aiSummary.tooManySelectedDescriptionSuffix}
                  </AlertDescription>
                </Alert>
              )}

              {/* Error: to-generate > remaining limit */}
              {summaryLimitStatus && selectedApplications.length <= 50 && toGenerateCount > summaryLimitStatus.effectiveRemaining && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>{applicationManagementCopy.dialogs.aiSummary.dailyLimitExceededTitle}</AlertTitle>
                  <AlertDescription>
                    You have only {summaryLimitStatus.effectiveRemaining} {applicationManagementCopy.dialogs.aiSummary.dailyLimitExceededDescriptionMiddle}
                    {toGenerateCount} {applicationManagementCopy.dialogs.aiSummary.dailyLimitExceededDescriptionSuffix}
                  </AlertDescription>
                </Alert>
              )}

              {/* Budget warning */}
              {summaryLimitStatus && !summaryLimitStatus.budgetAllowed && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>{applicationManagementCopy.dialogs.aiSummary.serviceUnavailableTitle}</AlertTitle>
                  <AlertDescription>
                    {applicationManagementCopy.dialogs.aiSummary.serviceUnavailableDescription}
                  </AlertDescription>
                </Alert>
              )}

              {/* Limit status info */}
              {summaryLimitStatus && summaryLimitStatus.budgetAllowed && (
                <div className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-lg">
                  <div className="flex justify-between">
                    <span>{applicationManagementCopy.dialogs.aiSummary.dailyLimit}</span>
                    <span>{summaryLimitStatus.dailyUsed} / {summaryLimitStatus.dailyLimit} used</span>
                  </div>
                  <div className="flex justify-between mt-1">
                    <span>{applicationManagementCopy.dialogs.aiSummary.remaining}</span>
                    <span className="font-medium text-foreground">{summaryLimitStatus.effectiveRemaining}</span>
                  </div>
                  <div className="flex justify-between mt-1">
                    <span>{applicationManagementCopy.dialogs.aiSummary.resetsAt}</span>
                    <span>{new Date(summaryLimitStatus.dailyResetAt).toLocaleString()}</span>
                  </div>
                </div>
              )}

              {/* Regenerate checkbox */}
              <div className="flex items-start gap-3 p-3 border border-border rounded-lg">
                <Checkbox
                  id="regenerate"
                  checked={regenerateSummaries}
                  onCheckedChange={(c) => setRegenerateSummaries(!!c)}
                  className="mt-0.5"
                />
                <div>
                  <label htmlFor="regenerate" className="text-sm font-medium cursor-pointer">
                    {applicationManagementCopy.dialogs.aiSummary.regenerateTitle}
                  </label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {applicationManagementCopy.dialogs.aiSummary.regenerateHint}
                  </p>
                </div>
              </div>

              {/* Progress section when job running */}
              {aiSummaryJobId && (
                <div className="space-y-3 p-3 bg-primary/5 border border-primary/20 rounded-lg">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary animate-pulse" />
                    <span className="text-sm font-medium">{applicationManagementCopy.dialogs.aiSummary.generating}</span>
                  </div>
                  <Progress value={summaryJobStatus?.progress || 0} className="h-2" />
                  <p className="text-sm text-muted-foreground text-center">
                    {summaryJobStatus?.processedCount || 0} / {summaryJobStatus?.totalCount || 0} {applicationManagementCopy.dialogs.aiSummary.processedSuffix}
                  </p>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setShowAISummaryDialog(false);
                  setRegenerateSummaries(false);
                }}
                disabled={startAISummaryMutation.isPending}
              >
                {aiSummaryJobId ? applicationManagementCopy.dialogs.aiSummary.close : applicationManagementCopy.dialogs.aiSummary.cancel}
              </Button>
              {aiSummaryJobId && (
                <Button
                  variant="destructive"
                  onClick={async () => {
                    try {
                      const response = await fetch(`/api/ai/summary/jobs/${aiSummaryJobId}`, {
                        method: 'DELETE',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/json' },
                      });
                      if (!response.ok) {
                        const errorData = await response.json().catch(() => ({}));
                        throw new Error(errorData.error || 'Failed to cancel job');
                      }
                      setAiSummaryJobId(null);
                      toast({ title: applicationManagementCopy.toasts.jobCancelledTitle, description: applicationManagementCopy.toasts.jobCancelledDescription });
                    } catch (err) {
                      toast({
                        title: applicationManagementCopy.toasts.cancelFailedTitle,
                        description: err instanceof Error ? err.message : applicationManagementCopy.toasts.cancelFailedDescription,
                        variant: 'destructive'
                      });
                    }
                  }}
                >
                  {applicationManagementCopy.dialogs.aiSummary.cancelJob}
                </Button>
              )}
              {!aiSummaryJobId && (
                <Button
                  onClick={() => startAISummaryMutation.mutate({
                    applicationIds: selectedApplications,
                    regenerate: regenerateSummaries,
                  })}
                  disabled={
                    selectedApplications.length === 0 ||
                    toGenerateCount === 0 ||
                    selectedApplications.length > 50 ||
                    (summaryLimitStatus && toGenerateCount > summaryLimitStatus.effectiveRemaining) ||
                    (summaryLimitStatus && !summaryLimitStatus.budgetAllowed) ||
                    startAISummaryMutation.isPending
                  }
                >
                  {startAISummaryMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      {applicationManagementCopy.dialogs.aiSummary.starting}
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4 mr-2" />
                      {applicationManagementCopy.dialogs.aiSummary.generatePrefix} {toGenerateCount} {toGenerateCount === 1 ? applicationManagementCopy.dialogs.aiSummary.summarySingular : applicationManagementCopy.dialogs.aiSummary.summaryPlural}
                    </>
                  )}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}
