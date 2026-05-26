import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import Layout from "@/components/Layout";
import { useAuth } from "@/hooks/use-auth";
import { Redirect, Link } from "wouter";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { adminSuperDashboardCopy } from "@/lib/internal-copy";
import {
  Users,
  Briefcase,
  FileText as FileTextIcon,
  Settings,
  Eye,
  Trash2,
  Search,
  Filter,
  Calendar,
  MapPin,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  UserCheck,
  Download,
  Shield,
  Activity,
  Crown,
  BarChart3,
  Cpu,
  RefreshCw,
  Mail,
  Send,
  Zap,
  Building2,
  Globe,
  TrendingUp,
  AlertTriangle,
  Loader2,
  Linkedin,
  ExternalLink,
  Phone,
} from "lucide-react";
import { format } from "date-fns";
import type { PipelineStage } from "@shared/schema";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// Types for analytics data
type HiringMetrics = {
  timeToFill: {
    overall: number | null;
    byJob: Array<{
      jobId: number;
      jobTitle: string;
      averageDays: number;
      hiredCount: number;
    }>;
  };
  timeInStage: Array<{
    stageId: number;
    stageName: string;
    stageOrder: number;
    averageDays: number;
    transitionCount: number;
  }>;
  totalApplications: number;
  totalHires: number;
  conversionRate: number;
};

type SourcePerfRow = {
  source: string;
  apps: number;
  shortlist: number;
  hires: number;
  conversion: number;
};

type PerformanceResponse = {
  recruiters: Array<{
    id: number;
    name: string;
    jobsHandled: number;
    candidatesScreened: number;
    avgFirstActionDays: number | null;
    avgStageMoveDays: number | null;
  }>;
  hiringManagers: Array<{
    id: number;
    name: string;
    jobsOwned: number;
    avgFeedbackDays: number | null;
    waitingCount: number;
  }>;
};

interface AdminStats {
  totalJobs: number;
  activeJobs: number;
  pendingJobs: number;
  totalApplications: number;
  totalUsers: number;
  totalRecruiters: number;
}

interface JobWithDetails {
  id: number;
  title: string;
  company: string;
  location: string;
  type: string;
  description: string;
  status: string;
  isActive: boolean;
  createdAt: string;
  expiresAt?: string | null;
  applicationCount: number;
  reviewComments?: string | null;
  reviewedAt?: string | null;
  reviewedBy?: {
    id: number;
    firstName: string;
    lastName: string;
    username: string;
  } | null;
  postedBy: {
    id: number;
    firstName: string;
    lastName: string;
    username: string;
  };
}

interface ApplicationWithDetails {
  id: number;
  fullName: string;
  email: string;
  phone: string;
  coverLetter: string;
  status: string;
  currentStage?: number | null;
  stageName?: string | null;
  stageOrder?: number | null;
  appliedAt: string;
  viewedAt?: string;
  downloadedAt?: string;
  notes?: string;
  job: {
    id: number;
    title: string;
    company: string;
  };
  recruiterNotes?: string;
}

interface UserDetails {
  id: number;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  emailVerified?: boolean;
  createdAt: string;
  profile?: {
    bio?: string;
    skills?: string[];
    linkedin?: string;
    location?: string;
    company?: string;
    phone?: string;
  };
  jobCount?: number;
  candidateCount?: number;
  applicationCount?: number;
  resumeCount?: number;
}

// Operations Command Center types
interface FunnelStage {
  id: number;
  name: string;
  order: number;
  color: string;
  count: number;
  type: 'stage' | 'terminal';
}

interface ClientSummary {
  id: number;
  name: string;
  domain: string | null;
  activeJobs: number;
  totalJobs: number;
  inPipeline: number;
  hired: number;
  rejected: number;
}

interface OpsSummary {
  range: string;
  generatedAt: string;
  kpis: {
    hires: number;
    offersOut: number;
    inPipeline: number;
    slaWarnings: number;
  };
  sla: {
    avgTimeToFirstTouchHours: number;
    overdueApplications: number;
    overdueInterviews: number;
  };
  automation: {
    settings: Array<{ key: string; value: boolean; description: string | null }>;
    summary: { success: number; failed: number; skipped: number };
    recentEvents: Array<{
      id: number;
      automationKey: string;
      targetType: string;
      targetId: number;
      outcome: string;
      errorMessage: string | null;
      triggeredAt: string;
      triggeredByName: string | null;
    }>;
  };
  health: {
    email: {
      sent: number;
      failed: number;
      recentFailures: Array<{
        id: number;
        recipientEmail: string;
        subject: string;
        errorMessage: string | null;
        sentAt: string;
      }>;
    };
    systemStatus: string;
  };
  quality: {
    rejectionReasons: Record<string, number>;
  };
  funnel: {
    stages: FunnelStage[];
    totalApplications: number;
  };
  clients: ClientSummary[];
}

interface Client {
  id: number;
  name: string;
}

type ResumeBackfillResult = {
  processed: number;
  updated: number;
  skipped: number;
  errors: number;
  durationMs: number;
  dryRun?: boolean;
};

export default function AdminSuperDashboard() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [selectedJob, setSelectedJob] = useState<JobWithDetails | null>(null);
  const [previewJob, setPreviewJob] = useState<JobWithDetails | null>(null);
  const [selectedApplication, setSelectedApplication] = useState<ApplicationWithDetails | null>(null);
  const [jobFilter, setJobFilter] = useState("all");
  const [applicationFilter, setApplicationFilter] = useState("all");
  const [applicationStageFilter, setApplicationStageFilter] = useState("all");
  const [userFilter, setUserFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedUser, setSelectedUser] = useState<UserDetails | null>(null);

  // Ops Command Center state
  const [opsRange, setOpsRange] = useState("7d");
  const [opsClientId, setOpsClientId] = useState<string>("all");

  // Hiring Manager Invitation state
  const [showInviteHMDialog, setShowInviteHMDialog] = useState(false);
  const [inviteHMEmail, setInviteHMEmail] = useState("");
  const [inviteHMName, setInviteHMName] = useState("");

  // Resume text backfill state
  const [backfillBatchSize, setBackfillBatchSize] = useState("100");
  const [backfillLimit, setBackfillLimit] = useState("");
  const [backfillResult, setBackfillResult] = useState<ResumeBackfillResult | null>(null);
  const [backfillEstimateMs, setBackfillEstimateMs] = useState<number | null>(null);
  const [backfillRunType, setBackfillRunType] = useState<'dry-run' | 'execute' | null>(null);
  const [backfillElapsedMs, setBackfillElapsedMs] = useState(0);

  const formatDuration = (ms?: number | null) => {
    if (ms === undefined || ms === null) return "—";
    const totalSeconds = Math.max(0, Math.round(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes === 0) return `${seconds}s`;
    return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
  };

  // Fetch admin statistics
  const { data: stats } = useQuery<AdminStats>({
    queryKey: ["/api/admin/stats"],
  });

  // Fetch all jobs with details
  const { data: jobs, isLoading: jobsLoading } = useQuery<JobWithDetails[]>({
    queryKey: ["/api/admin/jobs/all"],
  });

  // Fetch all applications with details
  const { data: applications, isLoading: applicationsLoading } = useQuery<ApplicationWithDetails[]>({
    queryKey: ["/api/admin/applications/all"],
  });

  // Fetch pipeline stages for filtering and labels
  const { data: pipelineStages = [] } = useQuery<PipelineStage[]>({
    queryKey: ["/api/pipeline/stages"],
  });

  // Fetch all users
  const { data: users, isLoading: usersLoading } = useQuery<UserDetails[]>({
    queryKey: ["/api/admin/users"],
  });

  // Analytics queries - org-wide metrics
  const { data: hiringMetrics, isLoading: metricsLoading } = useQuery<HiringMetrics>({
    queryKey: ["/api/analytics/hiring-metrics"],
    queryFn: async () => {
      const end = new Date();
      const start = new Date(end.getTime() - 90 * 24 * 60 * 60 * 1000); // Last 90 days
      const params = new URLSearchParams({
        startDate: start.toISOString(),
        endDate: end.toISOString(),
      });
      const res = await fetch(`/api/analytics/hiring-metrics?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch hiring metrics");
      return res.json();
    },
  });

  const { data: sourcePerformance, isLoading: sourcePerfLoading } = useQuery<SourcePerfRow[]>({
    queryKey: ["/api/analytics/source-performance"],
    queryFn: async () => {
      const end = new Date();
      const start = new Date(end.getTime() - 90 * 24 * 60 * 60 * 1000);
      const params = new URLSearchParams({
        startDate: start.toISOString(),
        endDate: end.toISOString(),
      });
      const res = await fetch(`/api/analytics/source-performance?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch source performance");
      return res.json();
    },
  });

  const { data: teamPerformance, isLoading: teamPerfLoading } = useQuery<PerformanceResponse>({
    queryKey: ["/api/analytics/performance"],
    queryFn: async () => {
      const end = new Date();
      const start = new Date(end.getTime() - 90 * 24 * 60 * 60 * 1000);
      const params = new URLSearchParams({
        startDate: start.toISOString(),
        endDate: end.toISOString(),
      });
      const res = await fetch(`/api/analytics/performance?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch team performance");
      return res.json();
    },
  });

  // Fetch ops summary (Operations Command Center data)
  const {
    data: opsSummary,
    isLoading: opsLoading,
    refetch: refetchOps,
    isRefetching: opsRefetching,
  } = useQuery<OpsSummary>({
    queryKey: ["/api/admin/ops/summary", opsRange, opsClientId],
    queryFn: async () => {
      const params = new URLSearchParams({ range: opsRange });
      if (opsClientId !== "all") params.append("clientId", opsClientId);
      const res = await fetch(`/api/admin/ops/summary?${params}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch ops summary");
      return res.json();
    },
    enabled: !!user && user.role === "super_admin",
    refetchInterval: 60000, // Auto-refresh every minute
  });

  // Fetch clients for ops filter
  const { data: opsClients = [] } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
    queryFn: async () => {
      const res = await fetch("/api/clients", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!user && user.role === "super_admin",
  });

  // Update job status mutation
  const updateJobMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: number; isActive: boolean }) => {
      const res = await apiRequest("PATCH", `/api/jobs/${id}/status`, { isActive });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/jobs/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({ title: "Job status updated successfully" });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update job status",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Delete job mutation
  const deleteJobMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/admin/jobs/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/jobs/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({ title: "Job deleted successfully" });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to delete job",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Update application status mutation
  const updateApplicationMutation = useMutation({
    mutationFn: async ({ id, status, notes }: { id: number; status: string; notes?: string }) => {
      const res = await apiRequest("PATCH", `/api/applications/${id}/status`, { status, notes });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/applications/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({ title: "Application status updated successfully" });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update application status",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Review job mutation (approve/decline)
  const reviewJobMutation = useMutation({
    mutationFn: async ({ id, status, comments }: { id: number; status: string; comments?: string }) => {
      const res = await apiRequest("PATCH", `/api/admin/jobs/${id}/review`, { status, reviewComments: comments });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/jobs/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({ title: "Job review status updated successfully" });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update job review status",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Update user role mutation
  const updateUserRoleMutation = useMutation({
    mutationFn: async ({ id, role }: { id: number; role: string }) => {
      const res = await apiRequest("PATCH", `/api/admin/users/${id}/role`, { role });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({ title: "User role updated successfully" });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update user role",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Update automation setting mutation
  const updateAutomationSettingMutation = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: boolean }) => {
      const res = await apiRequest("PATCH", `/api/admin/automation-settings/${key}`, { value });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ops/summary"] });
      toast({ title: "Automation setting updated" });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update automation setting",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const backfillResumeTextMutation = useMutation({
    mutationFn: async (mode: 'dry-run' | 'execute') => {
      const parsePositiveInt = (value: string) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
      };

      const payload = {
        batchSize: parsePositiveInt(backfillBatchSize),
        limit: parsePositiveInt(backfillLimit),
        dryRun: mode === 'dry-run',
      };

      const res = await apiRequest("POST", "/api/admin/applications/backfill-resume-text", payload);
      return res.json();
    },
    onMutate: (mode) => {
      setBackfillRunType(mode);
      setBackfillElapsedMs(0);
    },
    onSuccess: (data: ResumeBackfillResult, mode) => {
      setBackfillResult({
        ...data,
        dryRun: mode === 'dry-run',
      });
      if (mode === 'dry-run') {
        setBackfillEstimateMs(data.durationMs);
        toast({
          title: "Dry run complete",
          description: `Processed ${data.processed}, updated ${data.updated}, skipped ${data.skipped}, errors ${data.errors}.`,
        });
      } else {
        toast({
          title: "Backfill complete",
          description: `Processed ${data.processed}, updated ${data.updated}, skipped ${data.skipped}, errors ${data.errors}.`,
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Backfill failed",
        description: error.message,
        variant: "destructive",
      });
    },
    onSettled: () => {
      setBackfillRunType(null);
    },
  });

  useEffect(() => {
    if (!backfillResumeTextMutation.isPending || !backfillRunType) return;

    const start = Date.now();
    const interval = setInterval(() => {
      setBackfillElapsedMs(Date.now() - start);
    }, 1000);

    return () => clearInterval(interval);
  }, [backfillResumeTextMutation.isPending, backfillRunType]);

  // Invite hiring manager mutation
  const inviteHiringManagerMutation = useMutation({
    mutationFn: async (data: { email: string; name?: string }) => {
      const res = await apiRequest("POST", "/api/hiring-manager-invitations", data);
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Invitation Sent",
        description: `Invitation sent to ${inviteHMEmail}`,
      });
      setShowInviteHMDialog(false);
      setInviteHMEmail("");
      setInviteHMName("");
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Send Invitation",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Filter functions
  const filteredJobs = jobs?.filter(job => {
    const matchesFilter = jobFilter === "all" || 
      (jobFilter === "active" && job.isActive) ||
      (jobFilter === "inactive" && !job.isActive) ||
      (jobFilter === "pending" && job.status === "pending") ||
      (jobFilter === "approved" && job.status === "approved");
    
    const matchesSearch = !searchTerm || 
      job.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      job.company.toLowerCase().includes(searchTerm.toLowerCase()) ||
      job.location.toLowerCase().includes(searchTerm.toLowerCase());
    
    return matchesFilter && matchesSearch;
  });

  const filteredApplications = applications?.filter(app => {
    const matchesFilter = applicationFilter === "all" || app.status === applicationFilter;
    const matchesStage = applicationStageFilter === "all" ||
      (applicationStageFilter === "unassigned" && app.currentStage == null) ||
      (applicationStageFilter !== "unassigned" && app.currentStage === parseInt(applicationStageFilter));
    const matchesSearch = !searchTerm || 
      app.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      app.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      app.job.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      app.job.company.toLowerCase().includes(searchTerm.toLowerCase());
    
    return matchesFilter && matchesStage && matchesSearch;
  });

  const filteredUsers = users?.filter(user => {
    const matchesFilter = userFilter === "all" || user.role === userFilter;
    const matchesSearch = !searchTerm || 
      user.firstName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.lastName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.username.toLowerCase().includes(searchTerm.toLowerCase());
    
    return matchesFilter && matchesSearch;
  });

  const getStatusConfig = (status: string) => {
    const configs = {
      submitted: { color: "bg-info/10 text-info-foreground border-info/20", icon: Clock, label: "Submitted" },
      reviewed: { color: "bg-warning/10 text-warning-foreground border-yellow-200", icon: Eye, label: "Under Review" },
      shortlisted: { color: "bg-success/10 text-success-foreground border-success/20", icon: UserCheck, label: "Shortlisted" },
      rejected: { color: "bg-destructive/10 text-destructive border-destructive/20", icon: XCircle, label: "Rejected" },
      downloaded: { color: "bg-primary/10 text-primary border-primary/30", icon: Download, label: "Downloaded" },
      pending: { color: "bg-warning/10 text-warning-foreground border-warning/30", icon: AlertCircle, label: "Pending Review" },
      approved: { color: "bg-success/10 text-success-foreground border-success/20", icon: CheckCircle, label: "Approved" },
    };
    return configs[status as keyof typeof configs] || configs.submitted;
  };

  const getRoleColor = (role: string) => {
    const colors: Record<string, string> = {
      super_admin: "bg-destructive/10 text-destructive border-destructive/20",
      recruiter: "bg-primary/10 text-primary border-primary/30",
      candidate: "bg-info/10 text-info-foreground border-info/20",
      hiring_manager: "bg-warning/10 text-warning-foreground border-warning/20",
    };
    return colors[role] || colors.candidate;
  };

  // Ops helper functions
  const formatRejectionReason = (reason: string) => {
    return reason
      .replace(/_/g, " ")
      .replace(/\b\w/g, (l) => l.toUpperCase());
  };

  const formatAutomationKey = (key: string) => {
    return key
      .replace(/_/g, " ")
      .replace(/\b\w/g, (l) => l.toUpperCase());
  };

  const getOutcomeBadge = (outcome: string) => {
    switch (outcome) {
      case "success":
        return <Badge className="bg-success/20 text-success-foreground">Success</Badge>;
      case "failed":
        return <Badge className="bg-red-100 text-destructive">Failed</Badge>;
      case "skipped":
        return <Badge className="bg-yellow-100 text-warning-foreground">Skipped</Badge>;
      default:
        return <Badge variant="outline">{outcome}</Badge>;
    }
  };

  return (
    <Layout>
      <div className="max-w-7xl mx-auto p-6 space-y-8">
        {/* Header */}
        <div className="space-y-4 pt-8">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-primary/10 rounded-xl">
              <Shield className="h-8 w-8 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-foreground">{adminSuperDashboardCopy.header.title}</h1>
              <p className="text-muted-foreground">{adminSuperDashboardCopy.header.subtitle}</p>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="flex flex-wrap gap-4 mt-6">
            <Button
              onClick={() => window.location.href = '/admin/organizations'}
              variant="outline"
            >
              <Building2 className="h-4 w-4 mr-2" />
              {adminSuperDashboardCopy.header.organizations}
            </Button>
            <Button
              onClick={() => window.location.href = '/admin/subscriptions'}
              variant="outline"
            >
              <Crown className="h-4 w-4 mr-2" />
              {adminSuperDashboardCopy.header.subscriptions}
            </Button>
            <Button
              onClick={() => window.location.href = '/admin/org-controls'}
              variant="outline"
            >
              <Settings className="h-4 w-4 mr-2" />
              Org Controls
            </Button>
            <Button
              onClick={() => window.location.href = '/admin/domain-claims'}
              variant="outline"
            >
              <Globe className="h-4 w-4 mr-2" />
              Domain Claims
            </Button>
            <Button
              onClick={() => window.location.href = '/admin/ai-jobs'}
              variant="outline"
            >
              <Cpu className="h-4 w-4 mr-2" />
              AI Queue
            </Button>
            <Button
              onClick={() => window.location.href = '/admin/ai-usage'}
              variant="outline"
            >
              <BarChart3 className="h-4 w-4 mr-2" />
              AI Usage
            </Button>
            <Button
              onClick={() => window.location.href = '/analytics'}
              variant="outline"
            >
              <Activity className="h-4 w-4 mr-2" />
              Job Analytics
            </Button>
          </div>
        </div>

        {/* Statistics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6" data-tour="admin-stats">
          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Jobs</CardTitle>
              <Briefcase className="h-4 w-4 text-info-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-foreground">{stats?.totalJobs || 0}</div>
              <p className="text-xs text-muted-foreground">
                {stats?.activeJobs || 0} active, {stats?.pendingJobs || 0} pending
              </p>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Applications</CardTitle>
              <FileTextIcon className="h-4 w-4 text-success-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-foreground">{stats?.totalApplications || 0}</div>
              <p className="text-xs text-muted-foreground">Across all jobs</p>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Users</CardTitle>
              <Users className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-foreground">{stats?.totalUsers || 0}</div>
              <p className="text-xs text-muted-foreground">
                {stats?.totalRecruiters || 0} recruiters
              </p>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Platform Activity</CardTitle>
              <Activity className="h-4 w-4 text-warning" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-foreground">Live</div>
              <p className="text-xs text-muted-foreground">System operational</p>
            </CardContent>
          </Card>
        </div>

        {/* Main Tabs */}
        <Tabs defaultValue="operations" className="space-y-6">
          <TabsList className="flex flex-wrap gap-1 h-auto p-1" data-tour="admin-tabs">
            <TabsTrigger value="operations" className="flex items-center gap-1.5">
              <Activity className="h-4 w-4" />
              Operations
            </TabsTrigger>
            <TabsTrigger value="pending" className="relative flex items-center gap-1.5">
              <AlertCircle className="h-4 w-4" />
              Pending
              {stats?.pendingJobs && stats.pendingJobs > 0 && (
                <Badge className="ml-1 bg-warning/100 text-foreground text-xs px-1.5 py-0.5">
                  {stats.pendingJobs}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="jobs" className="flex items-center gap-1.5">
              <Briefcase className="h-4 w-4" />
              Jobs
            </TabsTrigger>
            <TabsTrigger value="applications" className="flex items-center gap-1.5">
              <FileTextIcon className="h-4 w-4" />
              Applications
            </TabsTrigger>
            <TabsTrigger value="users" className="flex items-center gap-1.5">
              <Users className="h-4 w-4" />
              Users
            </TabsTrigger>
            <TabsTrigger value="analytics" className="flex items-center gap-1.5">
              <BarChart3 className="h-4 w-4" />
              Analytics
            </TabsTrigger>
            <TabsTrigger value="logs" className="flex items-center gap-1.5">
              <Settings className="h-4 w-4" />
              Logs
            </TabsTrigger>
          </TabsList>

          {/* Operations Tab (Command Center) */}
          <TabsContent value="operations" className="space-y-6">
            {/* Ops Filters */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Select value={opsRange} onValueChange={setOpsRange}>
                  <SelectTrigger className="w-[130px]">
                    <SelectValue placeholder="Time range" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="24h">Last 24h</SelectItem>
                    <SelectItem value="7d">Last 7 days</SelectItem>
                    <SelectItem value="30d">Last 30 days</SelectItem>
                    <SelectItem value="90d">Last 90 days</SelectItem>
                  </SelectContent>
                </Select>

                {opsClients.length > 0 && (
                  <Select value={opsClientId} onValueChange={setOpsClientId}>
                    <SelectTrigger className="w-[160px]">
                      <SelectValue placeholder="All clients" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Clients</SelectItem>
                      {opsClients.map((client) => (
                        <SelectItem key={client.id} value={String(client.id)}>
                          {client.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Refresh operations metrics"
                  onClick={() => refetchOps()}
                  disabled={opsRefetching}
                >
                  <RefreshCw className={`w-4 h-4 ${opsRefetching ? "animate-spin" : ""}`} />
                </Button>
              </div>
            </div>

            {opsLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
              </div>
            ) : opsSummary ? (
              <>
                {/* Ops KPI Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4" data-tour="ops-kpis">
                  <Card className="bg-gradient-to-br from-green-50 to-green-100 border-success/20">
                    <CardContent className="pt-6">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-success-foreground font-medium">Hires</p>
                          <p className="text-3xl font-bold text-green-900">{opsSummary?.kpis?.hires ?? 0}</p>
                        </div>
                        <div className="p-3 bg-green-200 rounded-full">
                          <CheckCircle className="w-6 h-6 text-success-foreground" />
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-info/20">
                    <CardContent className="pt-6">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-info-foreground font-medium">Offers Out</p>
                          <p className="text-3xl font-bold text-blue-900">{opsSummary?.kpis?.offersOut ?? 0}</p>
                        </div>
                        <div className="p-3 bg-blue-200 rounded-full">
                          <Send className="w-6 h-6 text-info-foreground" />
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-primary/30 bg-gradient-to-br from-[#EEF5FF] to-[#EAFBF2]">
                    <CardContent className="pt-6">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-primary font-medium">In Pipeline</p>
                          <p className="text-3xl font-bold text-[#1F4E8C]">{opsSummary?.kpis?.inPipeline ?? 0}</p>
                        </div>
                        <div className="rounded-full bg-[#DCEBFF] p-3">
                          <Users className="w-6 h-6 text-primary" />
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className={`bg-gradient-to-br ${(opsSummary?.kpis?.slaWarnings ?? 0) > 0 ? "from-red-50 to-red-100 border-destructive/20" : "from-slate-50 to-slate-100 border-border"}`}>
                    <CardContent className="pt-6">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className={`text-sm font-medium ${(opsSummary?.kpis?.slaWarnings ?? 0) > 0 ? "text-destructive" : "text-muted-foreground"}`}>SLA Warnings</p>
                          <p className={`text-3xl font-bold ${(opsSummary?.kpis?.slaWarnings ?? 0) > 0 ? "text-red-900" : "text-foreground"}`}>{opsSummary?.kpis?.slaWarnings ?? 0}</p>
                        </div>
                        <div className={`p-3 rounded-full ${(opsSummary?.kpis?.slaWarnings ?? 0) > 0 ? "bg-red-200" : "bg-slate-200"}`}>
                          <AlertTriangle className={`w-6 h-6 ${(opsSummary?.kpis?.slaWarnings ?? 0) > 0 ? "text-destructive" : "text-muted-foreground"}`} />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Ops Sub-tabs */}
                <Tabs defaultValue="funnel" className="space-y-4">
                  <TabsList className="bg-muted" data-tour="ops-subtabs">
                    <TabsTrigger value="funnel" className="flex items-center gap-2">
                      <TrendingUp className="w-4 h-4" />
                      Pipeline
                    </TabsTrigger>
                    <TabsTrigger value="sla" className="flex items-center gap-2">
                      <Clock className="w-4 h-4" />
                      SLA
                    </TabsTrigger>
                    <TabsTrigger value="automation" className="flex items-center gap-2">
                      <Zap className="w-4 h-4" />
                      Automation
                    </TabsTrigger>
                    <TabsTrigger value="health" className="flex items-center gap-2">
                      <Activity className="w-4 h-4" />
                      Health
                    </TabsTrigger>
                    <TabsTrigger value="quality" className="flex items-center gap-2">
                      <BarChart3 className="w-4 h-4" />
                      Quality
                    </TabsTrigger>
                    {opsSummary?.clients?.length > 0 && (
                      <TabsTrigger value="clients" className="flex items-center gap-2">
                        <Building2 className="w-4 h-4" />
                        Clients
                      </TabsTrigger>
                    )}
                  </TabsList>

                  {/* Pipeline Funnel */}
                  <TabsContent value="funnel">
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2">
                          <TrendingUp className="w-4 h-4" />
                          Pipeline Conversion Funnel
                        </CardTitle>
                        <CardDescription>
                          Application distribution ({opsSummary?.funnel?.totalApplications ?? 0} total)
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        {(opsSummary?.funnel?.stages?.length ?? 0) > 0 ? (
                          <div className="space-y-3">
                            {(opsSummary?.funnel?.stages ?? [])
                              .filter(stage => stage.type === 'stage')
                              .map((stage) => {
                                const stages = opsSummary?.funnel?.stages ?? [];
                                const maxCount = Math.max(...stages.filter(s => s.type === 'stage').map(s => s.count), 1);
                                const widthPercent = Math.max((stage.count / maxCount) * 100, 8);
                                const totalApps = opsSummary?.funnel?.totalApplications ?? 0;
                                const percentage = totalApps > 0
                                  ? Math.round((stage.count / totalApps) * 100)
                                  : 0;

                                return (
                                  <div key={stage.id} className="relative">
                                    <div className="flex items-center gap-3">
                                      <div className="w-24 text-sm font-medium text-muted-foreground truncate">
                                        {stage.name}
                                      </div>
                                      <div className="flex-1 relative h-10">
                                        <div
                                          className="absolute inset-y-0 left-0 rounded-r-lg flex items-center justify-end pr-3 transition-all duration-500"
                                          style={{
                                            width: `${widthPercent}%`,
                                            backgroundColor: stage.color,
                                            minWidth: '60px',
                                          }}
                                        >
                                          <span className="text-foreground font-bold text-sm">
                                            {stage.count}
                                          </span>
                                        </div>
                                      </div>
                                      <div className="w-12 text-right text-sm text-muted-foreground">
                                        {percentage}%
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}

                            {(opsSummary?.funnel?.stages ?? []).some(s => s.type === 'terminal') && (
                              <>
                                <div className="border-t pt-3 mt-4">
                                  <p className="text-xs text-muted-foreground mb-3 font-medium uppercase tracking-wider">
                                    Final Outcomes
                                  </p>
                                </div>
                                <div className="grid grid-cols-3 gap-4">
                                  {(opsSummary?.funnel?.stages ?? [])
                                    .filter(stage => stage.type === 'terminal')
                                    .map(stage => {
                                      const totalApps = opsSummary?.funnel?.totalApplications ?? 0;
                                      const percentage = totalApps > 0
                                        ? Math.round((stage.count / totalApps) * 100)
                                        : 0;
                                      return (
                                        <div
                                          key={stage.id}
                                          className="p-4 rounded-lg text-center"
                                          style={{ backgroundColor: `${stage.color}15` }}
                                        >
                                          <p className="text-2xl font-bold" style={{ color: stage.color }}>
                                            {stage.count}
                                          </p>
                                          <p className="text-sm text-muted-foreground">{stage.name}</p>
                                          <p className="text-xs text-slate-400">{percentage}%</p>
                                        </div>
                                      );
                                    })}
                                </div>
                              </>
                            )}
                          </div>
                        ) : (
                          <div className="text-center py-8 text-muted-foreground">
                            <TrendingUp className="w-12 h-12 mx-auto mb-2 text-muted-foreground/50" />
                            <p>No pipeline stages configured</p>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </TabsContent>

                  {/* SLA Tab */}
                  <TabsContent value="sla">
                    <div className="grid md:grid-cols-3 gap-4">
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-base flex items-center gap-2">
                            <Clock className="w-4 h-4 text-info-foreground" />
                            Avg Time to First Touch
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <p className="text-3xl font-bold text-foreground">
                            {(opsSummary?.sla?.avgTimeToFirstTouchHours ?? 0).toFixed(1)}h
                          </p>
                          <p className="text-sm text-muted-foreground">Hours from application to first review</p>
                        </CardContent>
                      </Card>

                      <Card className={(opsSummary?.sla?.overdueApplications ?? 0) > 0 ? "border-destructive/20 bg-destructive/10/50" : ""}>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-base flex items-center gap-2">
                            <AlertTriangle className={`w-4 h-4 ${(opsSummary?.sla?.overdueApplications ?? 0) > 0 ? "text-destructive" : "text-muted-foreground"}`} />
                            Overdue Applications
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <p className={`text-3xl font-bold ${(opsSummary?.sla?.overdueApplications ?? 0) > 0 ? "text-red-900" : "text-foreground"}`}>
                            {opsSummary?.sla?.overdueApplications ?? 0}
                          </p>
                          <p className="text-sm text-muted-foreground">No response after 48 hours</p>
                        </CardContent>
                      </Card>

                      <Card className={(opsSummary?.sla?.overdueInterviews ?? 0) > 0 ? "border-warning/30 bg-warning/10/50" : ""}>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-base flex items-center gap-2">
                            <Clock className={`w-4 h-4 ${(opsSummary?.sla?.overdueInterviews ?? 0) > 0 ? "text-warning" : "text-muted-foreground"}`} />
                            Pending Feedback
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <p className={`text-3xl font-bold ${(opsSummary?.sla?.overdueInterviews ?? 0) > 0 ? "text-orange-900" : "text-foreground"}`}>
                            {opsSummary?.sla?.overdueInterviews ?? 0}
                          </p>
                          <p className="text-sm text-muted-foreground">Interviews without feedback &gt;5 days</p>
                        </CardContent>
                      </Card>
                    </div>
                  </TabsContent>

                  {/* Automation Tab */}
                  <TabsContent value="automation">
                    <div className="grid md:grid-cols-2 gap-4">
                      <Card data-tour="automation-settings">
                        <CardHeader>
                          <CardTitle className="text-base flex items-center gap-2">
                            <Settings className="w-4 h-4" />
                            Automation Settings
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-3">
                            {(opsSummary?.automation?.settings?.length ?? 0) > 0 ? (
                              (opsSummary?.automation?.settings ?? []).map((setting) => (
                                <div key={setting.key} className="flex items-center justify-between py-2 border-b last:border-0">
                                  <div className="flex-1 pr-4">
                                    <p className="text-sm font-medium text-foreground">
                                      {formatAutomationKey(setting.key)}
                                    </p>
                                    {setting.description && (
                                      <p className="text-xs text-muted-foreground">{setting.description}</p>
                                    )}
                                  </div>
                                  <Switch
                                    checked={setting.value}
                                    onCheckedChange={(checked) => {
                                      updateAutomationSettingMutation.mutate({
                                        key: setting.key,
                                        value: checked,
                                      });
                                    }}
                                    disabled={updateAutomationSettingMutation.isPending}
                                  />
                                </div>
                              ))
                            ) : (
                              <p className="text-sm text-muted-foreground">No automation settings configured</p>
                            )}
                          </div>
                        </CardContent>
                      </Card>

                      <Card data-tour="automation-events">
                        <CardHeader>
                          <CardTitle className="text-base flex items-center gap-2">
                            <Zap className="w-4 h-4" />
                            Automation Activity
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="grid grid-cols-3 gap-4 mb-4">
                            <div className="text-center p-3 bg-success/10 rounded-lg">
                              <p className="text-2xl font-bold text-success-foreground">{opsSummary?.automation?.summary?.success ?? 0}</p>
                              <p className="text-xs text-success-foreground">Success</p>
                            </div>
                            <div className="text-center p-3 bg-destructive/10 rounded-lg">
                              <p className="text-2xl font-bold text-destructive">{opsSummary?.automation?.summary?.failed ?? 0}</p>
                              <p className="text-xs text-destructive">Failed</p>
                            </div>
                            <div className="text-center p-3 bg-warning/10 rounded-lg">
                              <p className="text-2xl font-bold text-warning-foreground">{opsSummary?.automation?.summary?.skipped ?? 0}</p>
                              <p className="text-xs text-yellow-600">Skipped</p>
                            </div>
                          </div>
                          <div className="space-y-2 max-h-48 overflow-y-auto">
                            {(opsSummary?.automation?.recentEvents?.length ?? 0) > 0 ? (
                              (opsSummary?.automation?.recentEvents ?? []).slice(0, 5).map((event) => (
                                <div key={event.id} className="flex items-center justify-between py-2 border-b last:border-0 text-sm">
                                  <div>
                                    <p className="font-medium text-foreground">{formatAutomationKey(event.automationKey)}</p>
                                    <p className="text-xs text-muted-foreground">
                                      {event.targetType} #{event.targetId} • {new Date(event.triggeredAt).toLocaleString()}
                                    </p>
                                  </div>
                                  {getOutcomeBadge(event.outcome)}
                                </div>
                              ))
                            ) : (
                              <p className="text-sm text-muted-foreground text-center py-4">No automation events recorded</p>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  </TabsContent>

                  {/* Health Tab */}
                  <TabsContent value="health">
                    <div className="grid md:grid-cols-2 gap-4">
                      <Card data-tour="email-health">
                        <CardHeader>
                          <CardTitle className="text-base flex items-center gap-2">
                            <Mail className="w-4 h-4" />
                            Email Delivery
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="flex items-center gap-4 mb-4">
                            <div className="flex-1 p-3 bg-success/10 rounded-lg text-center">
                              <p className="text-2xl font-bold text-success-foreground">{opsSummary?.health?.email?.sent ?? 0}</p>
                              <p className="text-xs text-success-foreground">Sent</p>
                            </div>
                            <div className="flex-1 p-3 bg-destructive/10 rounded-lg text-center">
                              <p className="text-2xl font-bold text-destructive">{opsSummary?.health?.email?.failed ?? 0}</p>
                              <p className="text-xs text-destructive">Failed</p>
                            </div>
                            <div className="flex-1 p-3 bg-info/10 rounded-lg text-center">
                              <p className="text-2xl font-bold text-info-foreground">
                                {(() => {
                                  const sent = opsSummary?.health?.email?.sent ?? 0;
                                  const failed = opsSummary?.health?.email?.failed ?? 0;
                                  return sent + failed > 0
                                    ? Math.round((sent / (sent + failed)) * 100)
                                    : 100;
                                })()}%
                              </p>
                              <p className="text-xs text-info-foreground">Success Rate</p>
                            </div>
                          </div>
                          {(opsSummary?.health?.email?.recentFailures?.length ?? 0) > 0 && (
                            <div className="border-t pt-3">
                              <p className="text-sm font-medium text-destructive mb-2">Recent Failures</p>
                              <div className="space-y-2 max-h-32 overflow-y-auto">
                                {(opsSummary?.health?.email?.recentFailures ?? []).map((failure) => (
                                  <div key={failure.id} className="text-xs p-2 bg-destructive/10 rounded">
                                    <p className="font-medium text-destructive truncate">{failure.recipientEmail}</p>
                                    <p className="text-destructive truncate">{failure.errorMessage || "Unknown error"}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </CardContent>
                      </Card>

                      <Card data-tour="system-status">
                        <CardHeader>
                          <CardTitle className="text-base flex items-center gap-2">
                            <Activity className="w-4 h-4" />
                            System Status
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-4">
                            <div className="flex items-center justify-between p-3 bg-success/10 rounded-lg">
                              <div className="flex items-center gap-2">
                                <CheckCircle className="w-5 h-5 text-success-foreground" />
                                <span className="font-medium text-success-foreground">System Status</span>
                              </div>
                              <Badge className="bg-success/20 text-success-foreground">Healthy</Badge>
                            </div>
                            <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                              <span className="text-sm text-muted-foreground">Last Updated</span>
                              <span className="text-sm font-medium text-foreground">
                                {new Date(opsSummary.generatedAt).toLocaleString()}
                              </span>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  </TabsContent>

                  {/* Quality Tab */}
                  <TabsContent value="quality">
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2">
                          <BarChart3 className="w-4 h-4" />
                          Rejection Reasons
                        </CardTitle>
                        <CardDescription>Why candidates are being rejected</CardDescription>
                      </CardHeader>
                      <CardContent>
                        {Object.keys(opsSummary?.quality?.rejectionReasons ?? {}).length > 0 ? (
                          <div className="space-y-3">
                            {Object.entries(opsSummary?.quality?.rejectionReasons ?? {})
                              .sort(([, a], [, b]) => b - a)
                              .map(([reason, count]) => {
                                const total = Object.values(opsSummary?.quality?.rejectionReasons ?? {}).reduce((a, b) => a + b, 0);
                                const percentage = Math.round((count / total) * 100);
                                return (
                                  <div key={reason} className="space-y-1">
                                    <div className="flex items-center justify-between text-sm">
                                      <span className="font-medium text-muted-foreground">{formatRejectionReason(reason)}</span>
                                      <span className="text-muted-foreground">{count} ({percentage}%)</span>
                                    </div>
                                    <Progress value={percentage} className="h-2" />
                                  </div>
                                );
                              })}
                          </div>
                        ) : (
                          <div className="text-center py-8 text-muted-foreground">
                            <XCircle className="w-12 h-12 mx-auto mb-2 text-muted-foreground/50" />
                            <p>No rejection data available</p>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </TabsContent>

                  {/* Clients Tab */}
                  {opsSummary?.clients?.length > 0 && (
                    <TabsContent value="clients">
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-base flex items-center gap-2">
                            <Building2 className="w-4 h-4" />
                            Client Overview
                          </CardTitle>
                          <CardDescription>
                            Performance metrics by client ({opsSummary?.clients?.length ?? 0} clients)
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                            {(opsSummary?.clients ?? []).map(client => (
                              <Card key={client.id} className="bg-muted/50 border-border hover:border-primary/50 transition-colors">
                                <CardContent className="pt-4">
                                  <div className="flex items-start justify-between mb-3">
                                    <div>
                                      <h3 className="font-semibold text-foreground">{client.name}</h3>
                                      {client.domain && (
                                        <p className="text-xs text-muted-foreground">{client.domain}</p>
                                      )}
                                    </div>
                                    <Badge variant="outline" className="text-xs">
                                      {client.activeJobs} active
                                    </Badge>
                                  </div>

                                  <div className="grid grid-cols-3 gap-2 text-center">
                                    <div className="p-2 bg-info/10 rounded">
                                      <p className="text-lg font-bold text-info-foreground">{client.inPipeline}</p>
                                      <p className="text-xs text-info-foreground">In Pipeline</p>
                                    </div>
                                    <div className="p-2 bg-success/10 rounded">
                                      <p className="text-lg font-bold text-success-foreground">{client.hired}</p>
                                      <p className="text-xs text-success-foreground">Hired</p>
                                    </div>
                                    <div className="p-2 bg-muted rounded">
                                      <p className="text-lg font-bold text-muted-foreground">{client.rejected}</p>
                                      <p className="text-xs text-muted-foreground">Rejected</p>
                                    </div>
                                  </div>

                                  <div className="mt-3 pt-3 border-t flex items-center justify-between text-xs text-muted-foreground">
                                    <span>{client.totalJobs} total jobs</span>
                                  </div>
                                </CardContent>
                              </Card>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    </TabsContent>
                  )}
                </Tabs>
              </>
            ) : (
              <div className="text-center py-20 text-muted-foreground">
                <AlertTriangle className="w-12 h-12 mx-auto mb-2 text-muted-foreground/50" />
                <p>Failed to load operations data</p>
                <Button variant="outline" className="mt-4" onClick={() => refetchOps()}>
                  Retry
                </Button>
              </div>
            )}
          </TabsContent>

          {/* Pending Approval Tab */}
          <TabsContent value="pending" className="space-y-6">
            <Card className="shadow-sm border-warning/30" data-tour="pending-jobs">
              <CardHeader className="bg-warning/10">
                <div className="flex justify-between items-center">
                  <div>
                    <CardTitle className="text-foreground flex items-center gap-2">
                      <AlertCircle className="h-5 w-5 text-warning" />
                      Jobs Pending Approval
                    </CardTitle>
                    <CardDescription className="text-foreground/70">
                      Review and approve or decline job postings before they go live
                    </CardDescription>
                  </div>
                  <Badge variant="outline" className="bg-warning/20 text-warning-foreground border-orange-300">
                    {jobs?.filter(j => j.status === 'pending').length || 0} pending
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-6">
                {jobsLoading ? (
                  <div className="text-center py-8 text-foreground/70">Loading jobs...</div>
                ) : (
                  <div className="space-y-4">
                    {jobs?.filter(j => j.status === 'pending').length === 0 ? (
                      <div className="text-center py-12 text-muted-foreground">
                        <CheckCircle className="h-12 w-12 mx-auto mb-4 text-success" />
                        <p className="text-lg font-medium">All caught up!</p>
                        <p className="text-sm">No jobs pending approval</p>
                      </div>
                    ) : (
                      jobs?.filter(j => j.status === 'pending').map((job) => (
                        <div key={job.id} data-testid="job-row" data-job-id={job.id} className="border border-warning/30 rounded-lg p-4 bg-card hover:bg-warning/10/50 transition-colors">
                          <div className="flex justify-between items-start">
                            <div className="space-y-2 flex-1">
                              <div className="flex items-center space-x-3">
                                <h3 className="text-lg font-semibold text-foreground">{job.title}</h3>
                                <Badge className="bg-warning/20 text-warning-foreground border-warning/30">
                                  Pending Review
                                </Badge>
                              </div>
                              <div className="flex items-center space-x-4 text-sm text-foreground/70">
                                <span className="flex items-center space-x-1">
                                  <MapPin className="h-4 w-4" />
                                  <span>{job.company} • {job.location}</span>
                                </span>
                                <span className="flex items-center space-x-1">
                                  <Calendar className="h-4 w-4" />
                                  <span>{format(new Date(job.createdAt), "MMM d, yyyy")}</span>
                                </span>
                                <span className="flex items-center space-x-1">
                                  <Clock className="h-4 w-4" />
                                  <span>{job.type}</span>
                                </span>
                              </div>
                              <p className="text-foreground/60 text-sm">
                                Posted by: {job.postedBy.firstName} {job.postedBy.lastName} ({job.postedBy.username})
                              </p>
                            </div>
                            <div className="flex items-center space-x-2 flex-shrink-0">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setPreviewJob(job)}
                                className="border-primary/50 text-primary hover:bg-primary/10"
                              >
                                <FileTextIcon className="h-4 w-4 mr-1" />
                                Preview
                              </Button>
                              <Button
                                size="sm"
                                onClick={() => reviewJobMutation.mutate({ id: job.id, status: 'approved' })}
                                disabled={reviewJobMutation.isPending}
                                className="bg-success hover:bg-success/80 text-foreground"
                                data-testid="approve-job"
                              >
                                <CheckCircle className="h-4 w-4 mr-1" />
                                Approve
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => reviewJobMutation.mutate({ id: job.id, status: 'declined' })}
                                disabled={reviewJobMutation.isPending}
                                className="border-red-300 text-destructive hover:bg-destructive/10"
                                data-testid="decline-job"
                              >
                                <XCircle className="h-4 w-4 mr-1" />
                                Decline
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Jobs Management Tab */}
          <TabsContent value="jobs" className="space-y-6">
            <Card className="shadow-sm">
              <CardHeader>
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center space-y-4 sm:space-y-0">
                  <div>
                    <CardTitle className="text-foreground">Jobs Management</CardTitle>
                    <CardDescription className="text-foreground/70">
                      View, edit, and manage all platform jobs
                    </CardDescription>
                  </div>
                  <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-4">
                    <div className="flex items-center space-x-2">
                      <Search className="h-4 w-4 text-foreground/50" />
                      <Input
                        placeholder="Search jobs..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="bg-card border-border"
                      />
                    </div>
                    <Select value={jobFilter} onValueChange={setJobFilter}>
                      <SelectTrigger className="bg-card border-border">
                        <Filter className="h-4 w-4 mr-2" />
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-card border-border">
                        <SelectItem value="all">All Jobs</SelectItem>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="inactive">Inactive</SelectItem>
                        <SelectItem value="pending">Pending Review</SelectItem>
                        <SelectItem value="approved">Approved</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {jobsLoading ? (
                  <div className="text-center py-8 text-foreground/70">Loading jobs...</div>
                ) : (
                  <div className="space-y-4">
                    {filteredJobs?.map((job) => (
                      <div key={job.id} data-testid="job-row" data-job-id={job.id} className="border border-border rounded-lg p-4 bg-muted/50">
                        <div className="flex justify-between items-start">
                          <div className="space-y-2 flex-1">
                            <div className="flex items-center space-x-3">
                              <h3 className="text-lg font-semibold text-foreground">{job.title}</h3>
                              <Badge className={getStatusConfig(job.status).color}>
                                {getStatusConfig(job.status).label}
                              </Badge>
                              <Badge className={job.isActive ? "bg-success/10 text-success-foreground" : "bg-destructive/10 text-destructive"}>
                                {job.isActive ? "Active" : "Inactive"}
                              </Badge>
                            </div>
                            <div className="flex items-center space-x-4 text-sm text-foreground/70">
                              <span className="flex items-center space-x-1">
                                <MapPin className="h-4 w-4" />
                                <span>{job.company} • {job.location}</span>
                              </span>
                              <span className="flex items-center space-x-1">
                                <Calendar className="h-4 w-4" />
                                <span>{format(new Date(job.createdAt), "MMM d, yyyy")}</span>
                              </span>
                              <span className="flex items-center space-x-1">
                                <FileTextIcon className="h-4 w-4" />
                                <span>{job.applicationCount} applications</span>
                              </span>
                            </div>
                            <p className="text-foreground/60 text-sm">
                              Posted by: {job.postedBy.firstName} {job.postedBy.lastName} ({job.postedBy.username})
                            </p>
                            {/* Show review info for reviewed jobs */}
                            {(job.status === 'approved' || job.status === 'declined') && job.reviewedAt && (
                              <div className="mt-2 p-2 rounded bg-muted/50 border border-border" data-testid="reviewed-by">
                                <p className="text-xs text-muted-foreground">
                                  <span className="font-medium">{job.status === 'approved' ? 'Approved' : 'Declined'}</span>
                                  {job.reviewedBy && (
                                    <span> by {job.reviewedBy.firstName} {job.reviewedBy.lastName}</span>
                                  )}
                                  <span> on {format(new Date(job.reviewedAt), "MMM d, yyyy 'at' h:mm a")}</span>
                                </p>
                                {job.reviewComments && (
                                  <p className="text-xs text-muted-foreground mt-1 italic">"{job.reviewComments}"</p>
                                )}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center space-x-2">
                            {job.status === 'pending' && (
                              <>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => reviewJobMutation.mutate({ id: job.id, status: 'approved' })}
                                  className="border-green-600 text-success-foreground hover:bg-success/10 bg-card"
                                  data-testid="approve-job"
                                >
                                  <CheckCircle className="h-4 w-4 mr-1" />
                                  Approve
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => reviewJobMutation.mutate({ id: job.id, status: 'declined' })}
                                  className="border-red-600 text-destructive hover:bg-destructive/10 bg-card"
                                  data-testid="decline-job"
                                >
                                  <XCircle className="h-4 w-4 mr-1" />
                                  Decline
                                </Button>
                              </>
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setSelectedJob(job)}
                              className="border-border text-muted-foreground hover:bg-muted"
                            >
                              <Eye className="h-4 w-4 mr-1" />
                              View
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => updateJobMutation.mutate({ id: job.id, isActive: !job.isActive })}
                              className="border-border text-muted-foreground hover:bg-muted"
                            >
                              {job.isActive ? "Deactivate" : "Activate"}
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="border-red-600 text-destructive hover:bg-destructive/10 bg-card"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent className="bg-card border-border">
                                <AlertDialogHeader>
                                  <AlertDialogTitle className="text-foreground">Delete Job</AlertDialogTitle>
                                  <AlertDialogDescription className="text-foreground/70">
                                    Are you sure you want to delete "{job.title}"? This action cannot be undone and will remove all associated applications.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel className="bg-card border-border">Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => deleteJobMutation.mutate(job.id)}
                                    className="bg-destructive hover:bg-destructive/80"
                                  >
                                    Delete
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Applications Management Tab */}
          <TabsContent value="applications" className="space-y-6">
            <Card className="shadow-sm">
              <CardHeader>
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center space-y-4 sm:space-y-0">
                  <div>
                    <CardTitle className="text-foreground">Applications Management</CardTitle>
                    <CardDescription className="text-foreground/70">
                      Review and manage all job applications
                    </CardDescription>
                  </div>
                    <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-4">
                      <div className="flex items-center space-x-2">
                        <Search className="h-4 w-4 text-foreground/50" />
                        <Input
                          placeholder="Search applications..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="bg-card border-border"
                      />
                    </div>
                      <Select value={applicationFilter} onValueChange={setApplicationFilter}>
                        <SelectTrigger className="bg-card border-border">
                          <Filter className="h-4 w-4 mr-2" />
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-card border-border">
                          <SelectItem value="all">All Applications</SelectItem>
                          <SelectItem value="submitted">Submitted</SelectItem>
                          <SelectItem value="reviewed">Under Review</SelectItem>
                          <SelectItem value="shortlisted">Shortlisted</SelectItem>
                          <SelectItem value="rejected">Rejected</SelectItem>
                        </SelectContent>
                      </Select>
                      <Select value={applicationStageFilter} onValueChange={setApplicationStageFilter}>
                        <SelectTrigger className="bg-card border-border">
                          <Filter className="h-4 w-4 mr-2" />
                          <SelectValue placeholder="Stage" />
                        </SelectTrigger>
                        <SelectContent className="bg-card border-border">
                          <SelectItem value="all">All Stages</SelectItem>
                          <SelectItem value="unassigned">Unassigned</SelectItem>
                          {pipelineStages
                            .slice()
                            .sort((a, b) => (a.order - b.order) || (a.id - b.id))
                            .map((stage) => (
                              <SelectItem key={stage.id} value={stage.id.toString()}>
                                {stage.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardHeader>
              <CardContent>
                {applicationsLoading ? (
                  <div className="text-center py-8 text-foreground/70">Loading applications...</div>
                ) : (
                  <div className="space-y-4">
                    {filteredApplications?.map((application) => (
                      <div key={application.id} className="border border-border rounded-lg p-4 bg-muted/50">
                        <div className="flex justify-between items-start">
                        <div className="space-y-2 flex-1">
                          <div className="flex items-center space-x-3">
                            <h3 className="text-lg font-semibold text-foreground">{application.fullName}</h3>
                            <Badge className={getStatusConfig(application.status).color}>
                              {getStatusConfig(application.status).label}
                            </Badge>
                            {application.stageName && (
                              <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">
                                {application.stageName}
                              </Badge>
                            )}
                          </div>
                            <div className="flex items-center space-x-4 text-sm text-foreground/70">
                              <span>{application.email}</span>
                              <span>{application.phone}</span>
                              <span className="flex items-center space-x-1">
                                <Calendar className="h-4 w-4" />
                                <span>{format(new Date(application.appliedAt), "MMM d, yyyy")}</span>
                              </span>
                            </div>
                            <p className="text-foreground/60 text-sm">
                              Applied for: {application.job.title} at {application.job.company}
                            </p>
                            {application.notes && (
                              <p className="text-foreground/60 text-sm bg-muted p-2 rounded">
                                Notes: {application.notes}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center space-x-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setSelectedApplication(application)}
                              className="border-border text-foreground hover:bg-muted"
                            >
                              <Eye className="h-4 w-4 mr-1" />
                              View
                            </Button>
                            <Select
                              value={application.status}
                              onValueChange={(status) => updateApplicationMutation.mutate({ id: application.id, status })}
                            >
                              <SelectTrigger className="w-32 bg-card border-border">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="bg-card border-border">
                                <SelectItem value="submitted">Submitted</SelectItem>
                                <SelectItem value="reviewed">Under Review</SelectItem>
                                <SelectItem value="shortlisted">Shortlisted</SelectItem>
                                <SelectItem value="rejected">Rejected</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Users Management Tab */}
          <TabsContent value="users" className="space-y-6">
            <Card className="shadow-sm" data-tour="user-management">
              <CardHeader>
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center space-y-4 sm:space-y-0">
                  <div>
                    <CardTitle className="text-foreground">Users Management</CardTitle>
                    <CardDescription className="text-foreground/70">
                      Manage user roles and permissions
                    </CardDescription>
                  </div>
                  <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-4 items-end sm:items-center">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowInviteHMDialog(true)}
                    >
                      <Mail className="h-4 w-4 mr-2" />
                      Invite Hiring Manager
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (!filteredUsers || filteredUsers.length === 0) return;
                        const headers = ['ID', 'Full Name', 'Email', 'Role', 'Email Verified', 'Location', 'Company', 'LinkedIn', 'Skills', 'Jobs Posted', 'Total Candidates', 'Joined'];
                        const rows = filteredUsers.map(u => [
                          u.id,
                          `${u.firstName || ''} ${u.lastName || ''}`.trim(),
                          u.email || u.username,
                          u.role,
                          u.emailVerified ? 'Yes' : 'No',
                          u.profile?.location || '',
                          u.profile?.company || '',
                          u.profile?.linkedin || '',
                          u.profile?.skills?.join('; ') || '',
                          u.role === 'candidate' ? '' : (u.jobCount || 0),
                          u.role === 'candidate' ? (u.applicationCount || 0) : (u.candidateCount || 0),
                          format(new Date(u.createdAt), 'yyyy-MM-dd'),
                        ]);
                        const csvContent = [headers.join(','), ...rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))].join('\n');
                        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `users-export-${format(new Date(), 'yyyy-MM-dd')}.csv`;
                        a.click();
                        URL.revokeObjectURL(url);
                        toast({ title: 'Export complete', description: `Exported ${filteredUsers.length} users to CSV` });
                      }}
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Export
                    </Button>
                    <div className="flex items-center space-x-2">
                      <Search className="h-4 w-4 text-foreground/50" />
                      <Input
                        placeholder="Search users..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="bg-card border-border"
                      />
                    </div>
                    <Select value={userFilter} onValueChange={setUserFilter}>
                      <SelectTrigger className="bg-card border-border">
                        <Filter className="h-4 w-4 mr-2" />
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-card border-border">
                        <SelectItem value="all">All Users</SelectItem>
                        <SelectItem value="super_admin">Super Admins</SelectItem>
                        <SelectItem value="recruiter">Recruiters</SelectItem>
                        <SelectItem value="candidate">Candidates</SelectItem>
                        <SelectItem value="hiring_manager">Hiring Managers</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {usersLoading ? (
                  <div className="text-center py-8 text-foreground/70">Loading users...</div>
                ) : (
                  <div className="space-y-4">
                    {filteredUsers?.map((user) => (
                      <div key={user.id} className="border border-border rounded-lg p-4 bg-muted/50">
                        <div className="flex justify-between items-start">
                          <div className="space-y-2 flex-1">
                            <div className="flex items-center space-x-3">
                              <h3 className="text-lg font-semibold text-foreground">
                                {user.firstName} {user.lastName}
                              </h3>
                              <Badge className={getRoleColor(user.role)}>
                                {user.role.charAt(0).toUpperCase() + user.role.slice(1)}
                              </Badge>
                            </div>
                            <div className="flex items-center space-x-4 text-sm text-foreground/70">
                              <span>{user.username}</span>
                              <span className="flex items-center space-x-1">
                                <Calendar className="h-4 w-4" />
                                <span>Joined {format(new Date(user.createdAt), "MMM d, yyyy")}</span>
                              </span>
                              {user.jobCount !== undefined && (
                                <span>{user.jobCount} jobs posted</span>
                              )}
                              {user.applicationCount !== undefined && (
                                <span>{user.applicationCount} applications</span>
                              )}
                            </div>
                            {user.profile && (
                              <div className="text-foreground/60 text-sm space-y-1">
                                {user.profile.location && (
                                  <p className="flex items-center space-x-1">
                                    <MapPin className="h-3 w-3" />
                                    <span>{user.profile.location}</span>
                                  </p>
                                )}
                                {user.profile.skills && user.profile.skills.length > 0 && (
                                  <p>Skills: {user.profile.skills.slice(0, 3).join(", ")}</p>
                                )}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center space-x-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setSelectedUser(user)}
                            >
                              <Eye className="h-4 w-4 mr-1" />
                              Details
                            </Button>
                            <Select
                              value={user.role}
                              onValueChange={(role) => updateUserRoleMutation.mutate({ id: user.id, role })}
                            >
                              <SelectTrigger className="w-32 bg-card border-border">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="bg-card border-border">
                                <SelectItem value="candidate">Candidate</SelectItem>
                                <SelectItem value="recruiter">Recruiter</SelectItem>
                                <SelectItem value="super_admin">Super Admin</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* User Details Modal */}
            <Dialog open={!!selectedUser} onOpenChange={(open) => !open && setSelectedUser(null)}>
              <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    User Details
                  </DialogTitle>
                  <DialogDescription>
                    Detailed information about this user
                  </DialogDescription>
                </DialogHeader>
                {selectedUser && (
                  <div className="space-y-4">
                    {/* Basic Info */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-medium text-muted-foreground">Full Name</h4>
                        <span className="text-sm font-semibold">
                          {selectedUser.firstName} {selectedUser.lastName}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-medium text-muted-foreground">Email</h4>
                        <div className="flex items-center gap-2">
                          <span className="text-sm">{selectedUser.email || selectedUser.username}</span>
                          {selectedUser.emailVerified && (
                            <Badge variant="outline" className="text-xs bg-success/10 text-success border-success/30">
                              <CheckCircle className="h-3 w-3 mr-1" />
                              Verified
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-medium text-muted-foreground">Role</h4>
                        <Badge className={getRoleColor(selectedUser.role)}>
                          {selectedUser.role.charAt(0).toUpperCase() + selectedUser.role.slice(1).replace('_', ' ')}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-medium text-muted-foreground">Joined</h4>
                        <span className="text-sm">{format(new Date(selectedUser.createdAt), "MMM d, yyyy")}</span>
                      </div>
                    </div>

                    {/* Profile Info */}
                    {selectedUser.profile && (
                      <>
                        <div className="border-t pt-4">
                          <h4 className="text-sm font-medium mb-3">Profile Information</h4>
                          <div className="space-y-3">
                            {selectedUser.profile.company && (
                              <div className="flex items-center justify-between">
                                <span className="text-sm text-muted-foreground flex items-center gap-2">
                                  <Building2 className="h-4 w-4" /> Company
                                </span>
                                <span className="text-sm">{selectedUser.profile.company}</span>
                              </div>
                            )}
                            {selectedUser.profile.phone && (
                              <div className="flex items-center justify-between">
                                <span className="text-sm text-muted-foreground flex items-center gap-2">
                                  <Phone className="h-4 w-4" /> Phone
                                </span>
                                <span className="text-sm">{selectedUser.profile.phone}</span>
                              </div>
                            )}
                            {selectedUser.profile.location && (
                              <div className="flex items-center justify-between">
                                <span className="text-sm text-muted-foreground flex items-center gap-2">
                                  <MapPin className="h-4 w-4" /> Location
                                </span>
                                <span className="text-sm">{selectedUser.profile.location}</span>
                              </div>
                            )}
                            {selectedUser.profile.linkedin && (
                              <div className="flex items-center justify-between">
                                <span className="text-sm text-muted-foreground flex items-center gap-2">
                                  <Linkedin className="h-4 w-4" /> LinkedIn
                                </span>
                                <a
                                  href={selectedUser.profile.linkedin.startsWith('http') ? selectedUser.profile.linkedin : `https://${selectedUser.profile.linkedin}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-sm text-primary flex items-center gap-1 hover:underline"
                                >
                                  View Profile <ExternalLink className="h-3 w-3" />
                                </a>
                              </div>
                            )}
                            {selectedUser.profile.skills && selectedUser.profile.skills.length > 0 && (
                              <div>
                                <span className="text-sm text-muted-foreground block mb-2">Skills</span>
                                <div className="flex flex-wrap gap-1">
                                  {selectedUser.profile.skills.map((skill, i) => (
                                    <Badge key={i} variant="secondary" className="text-xs">
                                      {skill}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            )}
                            {selectedUser.profile.bio && (
                              <div>
                                <span className="text-sm text-muted-foreground block mb-2">Bio</span>
                                <p className="text-sm bg-muted p-2 rounded">{selectedUser.profile.bio}</p>
                              </div>
                            )}
                          </div>
                        </div>
                      </>
                    )}

                    {/* Activity Stats */}
                    <div className="border-t pt-4">
                      <h4 className="text-sm font-medium mb-3">Activity</h4>
                      <div className="grid grid-cols-2 gap-3">
                        {selectedUser.role === 'candidate' && (
                          <>
                            <div className="bg-muted/50 rounded p-3 text-center">
                              <div className="text-lg font-bold">{selectedUser.applicationCount || 0}</div>
                              <div className="text-xs text-muted-foreground">Applications</div>
                            </div>
                            <div className="bg-muted/50 rounded p-3 text-center">
                              <div className="text-lg font-bold flex items-center justify-center gap-1">
                                <FileTextIcon className="h-4 w-4" />
                                {selectedUser.resumeCount || 0}
                              </div>
                              <div className="text-xs text-muted-foreground">Resumes</div>
                            </div>
                          </>
                        )}
                        {(selectedUser.role === 'recruiter' || selectedUser.role === 'super_admin') && (
                          <>
                            <div className="bg-muted/50 rounded p-3 text-center">
                              <div className="text-lg font-bold">{selectedUser.jobCount || 0}</div>
                              <div className="text-xs text-muted-foreground">Jobs Posted</div>
                            </div>
                            <div className="bg-muted/50 rounded p-3 text-center">
                              <div className="text-lg font-bold">{selectedUser.candidateCount || 0}</div>
                              <div className="text-xs text-muted-foreground">Total Candidates</div>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )}
                <DialogFooter>
                  <Button variant="outline" onClick={() => setSelectedUser(null)}>
                    Close
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </TabsContent>

          {/* Analytics Tab */}
          <TabsContent value="analytics" className="space-y-6">
            <div className="space-y-6">
              {/* Time to Fill & Time in Stage */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card className="shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-foreground flex items-center gap-2">
                      <Clock className="h-5 w-5 text-info-foreground" />
                      Time to Fill by Job
                    </CardTitle>
                    <CardDescription className="text-muted-foreground">
                      Average days from posting to hire (last 90 days)
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {metricsLoading ? (
                      <div className="text-center py-4 text-muted-foreground">Loading...</div>
                    ) : hiringMetrics?.timeToFill.byJob?.length ? (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Job Title</TableHead>
                            <TableHead className="text-right">Avg Days</TableHead>
                            <TableHead className="text-right">Hires</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {hiringMetrics.timeToFill.byJob.slice(0, 10).map((row) => (
                            <TableRow key={row.jobId}>
                              <TableCell className="font-medium">{row.jobTitle}</TableCell>
                              <TableCell className="text-right">{row.averageDays.toFixed(1)}d</TableCell>
                              <TableCell className="text-right">{row.hiredCount}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    ) : (
                      <div className="text-center py-4 text-muted-foreground">No hiring data yet</div>
                    )}
                    {hiringMetrics?.timeToFill.overall && (
                      <div className="mt-4 pt-4 border-t text-sm">
                        <span className="text-muted-foreground">Overall average: </span>
                        <span className="font-semibold text-foreground">{hiringMetrics.timeToFill.overall.toFixed(1)} days</span>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-foreground flex items-center gap-2">
                      <Activity className="h-5 w-5 text-primary" />
                      Time in Stage Breakdown
                    </CardTitle>
                    <CardDescription className="text-muted-foreground">
                      Average days candidates spend in each stage
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {metricsLoading ? (
                      <div className="text-center py-4 text-muted-foreground">Loading...</div>
                    ) : hiringMetrics?.timeInStage?.length ? (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Stage</TableHead>
                            <TableHead className="text-right">Avg Days</TableHead>
                            <TableHead className="text-right">Transitions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {hiringMetrics.timeInStage
                            .sort((a, b) => a.stageOrder - b.stageOrder)
                            .map((row) => (
                              <TableRow key={row.stageId}>
                                <TableCell className="font-medium">{row.stageName}</TableCell>
                                <TableCell className="text-right">{row.averageDays.toFixed(1)}d</TableCell>
                                <TableCell className="text-right">{row.transitionCount}</TableCell>
                              </TableRow>
                            ))}
                        </TableBody>
                      </Table>
                    ) : (
                      <div className="text-center py-4 text-muted-foreground">No stage transition data yet</div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Source Performance */}
              <Card className="shadow-sm">
                <CardHeader>
                  <CardTitle className="text-foreground flex items-center gap-2">
                    <BarChart3 className="h-5 w-5 text-success-foreground" />
                    Source Performance
                  </CardTitle>
                  <CardDescription className="text-muted-foreground">
                    Application sources and their conversion rates (last 90 days)
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {sourcePerfLoading ? (
                    <div className="text-center py-4 text-muted-foreground">Loading...</div>
                  ) : sourcePerformance?.length ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Source</TableHead>
                          <TableHead className="text-right">Applications</TableHead>
                          <TableHead className="text-right">Shortlisted</TableHead>
                          <TableHead className="text-right">Hired</TableHead>
                          <TableHead className="text-right">Conversion</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sourcePerformance.map((row) => (
                          <TableRow key={row.source}>
                            <TableCell className="font-medium capitalize">{row.source || 'Direct'}</TableCell>
                            <TableCell className="text-right">{row.apps}</TableCell>
                            <TableCell className="text-right">{row.shortlist}</TableCell>
                            <TableCell className="text-right">{row.hires}</TableCell>
                            <TableCell className="text-right">
                              <Badge variant={row.conversion >= 10 ? "default" : "secondary"} className={row.conversion >= 10 ? "bg-success/20 text-success-foreground" : ""}>
                                {row.conversion}%
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="text-center py-4 text-muted-foreground">No source data available</div>
                  )}
                </CardContent>
              </Card>

              {/* Team Performance */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card className="shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-foreground flex items-center gap-2">
                      <Users className="h-5 w-5 text-info-foreground" />
                      Recruiter Performance
                    </CardTitle>
                    <CardDescription className="text-muted-foreground">
                      Recruiter activity and response times
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {teamPerfLoading ? (
                      <div className="text-center py-4 text-muted-foreground">Loading...</div>
                    ) : teamPerformance?.recruiters?.length ? (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Recruiter</TableHead>
                            <TableHead className="text-right">Jobs</TableHead>
                            <TableHead className="text-right">Screened</TableHead>
                            <TableHead className="text-right">Avg First Action</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {teamPerformance.recruiters.slice(0, 10).map((row) => (
                            <TableRow key={row.id}>
                              <TableCell className="font-medium">{row.name}</TableCell>
                              <TableCell className="text-right">{row.jobsHandled}</TableCell>
                              <TableCell className="text-right">{row.candidatesScreened}</TableCell>
                              <TableCell className="text-right">
                                {row.avgFirstActionDays != null ? `${row.avgFirstActionDays.toFixed(1)}d` : '—'}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    ) : (
                      <div className="text-center py-4 text-muted-foreground">No recruiter data yet</div>
                    )}
                  </CardContent>
                </Card>

                <Card className="shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-foreground flex items-center gap-2">
                      <Crown className="h-5 w-5 text-amber-600" />
                      Hiring Manager Performance
                    </CardTitle>
                    <CardDescription className="text-muted-foreground">
                      Feedback turnaround and pending reviews
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {teamPerfLoading ? (
                      <div className="text-center py-4 text-muted-foreground">Loading...</div>
                    ) : teamPerformance?.hiringManagers?.length ? (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Hiring Manager</TableHead>
                            <TableHead className="text-right">Jobs Owned</TableHead>
                            <TableHead className="text-right">Avg Feedback</TableHead>
                            <TableHead className="text-right">Waiting</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {teamPerformance.hiringManagers.slice(0, 10).map((row) => (
                            <TableRow key={row.id}>
                              <TableCell className="font-medium">{row.name}</TableCell>
                              <TableCell className="text-right">{row.jobsOwned}</TableCell>
                              <TableCell className="text-right">
                                {row.avgFeedbackDays != null ? `${row.avgFeedbackDays.toFixed(1)}d` : '—'}
                              </TableCell>
                              <TableCell className="text-right">
                                {row.waitingCount > 0 ? (
                                  <Badge className="bg-warning/20 text-orange-800">{row.waitingCount}</Badge>
                                ) : (
                                  '0'
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    ) : (
                      <div className="text-center py-4 text-muted-foreground">No hiring manager data yet</div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Summary Stats */}
              <Card className="border-info/20 bg-gradient-to-r from-blue-50 to-[#EEF5FF] shadow-sm">
                <CardContent className="py-6">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
                    <div>
                      <div className="text-3xl font-bold text-info-foreground">
                        {hiringMetrics?.totalApplications ?? 0}
                      </div>
                      <div className="text-sm text-muted-foreground">Total Applications</div>
                    </div>
                    <div>
                      <div className="text-3xl font-bold text-success-foreground">
                        {hiringMetrics?.totalHires ?? 0}
                      </div>
                      <div className="text-sm text-muted-foreground">Total Hires</div>
                    </div>
                    <div>
                      <div className="text-3xl font-bold text-primary">
                        {hiringMetrics?.conversionRate?.toFixed(1) ?? 0}%
                      </div>
                      <div className="text-sm text-muted-foreground">Conversion Rate</div>
                    </div>
                    <div>
                      <div className="text-3xl font-bold text-amber-700">
                        {hiringMetrics?.timeToFill.overall?.toFixed(0) ?? '—'}
                      </div>
                      <div className="text-sm text-muted-foreground">Avg Time to Fill (days)</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* System Logs Tab */}
          <TabsContent value="logs" className="space-y-6">
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle className="text-foreground">System Activity Logs</CardTitle>
                <CardDescription className="text-foreground/70">
                  Monitor platform activity and system events
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="border border-border rounded-lg p-4 bg-muted/50">
                    <div className="flex items-center space-x-3 text-sm">
                      <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                      <span className="text-foreground/70">{format(new Date(), "MMM d, yyyy HH:mm")}</span>
                      <span className="text-foreground">System</span>
                      <span className="text-success-foreground">Platform operational - All systems running</span>
                    </div>
                  </div>
                  <div className="border border-border rounded-lg p-4 bg-muted/50">
                    <div className="flex items-center space-x-3 text-sm">
                      <div className="w-2 h-2 bg-blue-400 rounded-full"></div>
                      <span className="text-foreground/70">{format(new Date(Date.now() - 300000), "MMM d, yyyy HH:mm")}</span>
                      <span className="text-foreground">Database</span>
                      <span className="text-info-foreground">User profiles table created successfully</span>
                    </div>
                  </div>
                  <div className="border border-border rounded-lg p-4 bg-muted/50">
                    <div className="flex items-center space-x-3 text-sm">
                      <div className="w-2 h-2 bg-primary rounded-full"></div>
                      <span className="text-foreground/70">{format(new Date(Date.now() - 600000), "MMM d, yyyy HH:mm")}</span>
                      <span className="text-foreground">Jobs</span>
                      <span className="text-primary">Job scheduler activated - Daily cleanup at 2 AM</span>
                    </div>
                  </div>
                  <div className="text-center py-4 text-foreground/50">
                    Real-time system monitoring active
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle className="text-foreground">Resume Text Backfill</CardTitle>
                <CardDescription className="text-foreground/70">
                  Populate extracted resume text for existing applications (admin only).
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="backfill-batch">Batch size</Label>
                    <Input
                      id="backfill-batch"
                      type="number"
                      min={1}
                      max={500}
                      value={backfillBatchSize}
                      onChange={(e) => setBackfillBatchSize(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="backfill-limit">Limit (optional)</Label>
                    <Input
                      id="backfill-limit"
                      type="number"
                      min={1}
                      value={backfillLimit}
                      onChange={(e) => setBackfillLimit(e.target.value)}
                      placeholder="Unlimited"
                    />
                  </div>
                </div>

                <div className="text-sm text-muted-foreground">
                  This will run a dry run first, then let you confirm the write step.
                </div>

                <div className="flex flex-wrap gap-3">
                  <Button
                    className="w-full md:w-auto"
                    disabled={backfillResumeTextMutation.isPending}
                    onClick={() => backfillResumeTextMutation.mutate('dry-run')}
                  >
                    {backfillResumeTextMutation.isPending && backfillRunType === 'dry-run' ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Running dry run...
                      </>
                    ) : (
                      "Run Dry Run"
                    )}
                  </Button>

                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-full md:w-auto"
                        disabled={
                          backfillResumeTextMutation.isPending
                          || !backfillResult
                          || !backfillResult.dryRun
                        }
                      >
                        Execute Backfill
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Execute resume text backfill?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will write extracted resume text to applications missing it.
                          Proceeding will run the same backfill with writes enabled.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => backfillResumeTextMutation.mutate('execute')}>
                          Confirm & Run
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>

                {backfillResumeTextMutation.isPending && (
                  <div className="text-sm text-muted-foreground">
                    Running {backfillRunType === 'execute' ? 'backfill' : 'dry run'} · Elapsed{" "}
                    <strong>{formatDuration(backfillElapsedMs)}</strong>
                    {backfillRunType === 'execute' && backfillEstimateMs && (
                      <>
                        {" "}· Est. remaining{" "}
                        <strong>{formatDuration(Math.max(backfillEstimateMs - backfillElapsedMs, 0))}</strong>
                      </>
                    )}
                  </div>
                )}

                {backfillResult && (
                  <div className="border border-border rounded-lg p-3 bg-muted/50 text-sm">
                    <div className="flex flex-wrap gap-3">
                      <span>Processed: <strong>{backfillResult.processed}</strong></span>
                      <span>Updated: <strong>{backfillResult.updated}</strong></span>
                      <span>Skipped: <strong>{backfillResult.skipped}</strong></span>
                      <span>Errors: <strong>{backfillResult.errors}</strong></span>
                      <span>Duration: <strong>{Math.round(backfillResult.durationMs)}ms</strong></span>
                      {backfillResult.dryRun && (
                        <Badge variant="outline">Dry run</Badge>
                      )}
                    </div>
                    {backfillResult.dryRun && (
                      <div className="mt-2 text-muted-foreground">
                        Estimated run time: <strong>{formatDuration(backfillResult.durationMs)}</strong>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Job Detail Dialog */}
      {selectedJob && (
        <Dialog open={!!selectedJob} onOpenChange={() => setSelectedJob(null)}>
          <DialogContent className="bg-card border-border max-w-2xl">
            <DialogHeader>
              <DialogTitle className="text-foreground">{selectedJob.title}</DialogTitle>
              <DialogDescription className="text-foreground/70">
                {selectedJob.company} • {selectedJob.location}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-foreground/70">Status:</span>
                  <Badge className={`ml-2 ${getStatusConfig(selectedJob.status).color}`}>
                    {getStatusConfig(selectedJob.status).label}
                  </Badge>
                </div>
                <div>
                  <span className="text-foreground/70">Active:</span>
                  <Badge className={`ml-2 ${selectedJob.isActive ? "bg-success/10 text-success-foreground" : "bg-destructive/10 text-destructive"}`}>
                    {selectedJob.isActive ? "Yes" : "No"}
                  </Badge>
                </div>
                <div className="text-foreground/70">
                  Applications: <span className="text-foreground">{selectedJob.applicationCount}</span>
                </div>
                <div className="text-foreground/70">
                  Posted: <span className="text-foreground">{format(new Date(selectedJob.createdAt), "MMM d, yyyy")}</span>
                </div>
              </div>
              <div>
                <span className="text-foreground/70">Posted by:</span>
                <span className="text-foreground ml-2">
                  {selectedJob.postedBy.firstName} {selectedJob.postedBy.lastName} ({selectedJob.postedBy.username})
                </span>
              </div>
            </div>
            <DialogFooter>
              <Button 
                variant="outline" 
                onClick={() => setSelectedJob(null)}
                className="border-border text-foreground hover:bg-muted"
              >
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Job Description Preview Dialog */}
      {previewJob && (
        <Dialog open={!!previewJob} onOpenChange={() => setPreviewJob(null)}>
          <DialogContent className="bg-card border-border max-w-3xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-foreground flex items-center gap-2">
                <FileTextIcon className="h-5 w-5" />
                {previewJob.title}
              </DialogTitle>
              <DialogDescription className="text-foreground/70">
                {previewJob.location} • {previewJob.type} • Posted by {previewJob.postedBy.firstName} {previewJob.postedBy.lastName}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="p-4 rounded-lg bg-muted/50 border border-border">
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-3">Job Description</p>
                <div className="prose prose-sm max-w-none text-foreground whitespace-pre-wrap">
                  {previewJob.description}
                </div>
              </div>
            </div>
            <DialogFooter className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setPreviewJob(null)}
                className="border-border text-foreground hover:bg-muted"
              >
                Close
              </Button>
              <Button
                onClick={() => {
                  reviewJobMutation.mutate({ id: previewJob.id, status: 'approved' });
                  setPreviewJob(null);
                }}
                disabled={reviewJobMutation.isPending}
                className="bg-success hover:bg-success/80 text-foreground"
              >
                <CheckCircle className="h-4 w-4 mr-1" />
                Approve
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  reviewJobMutation.mutate({ id: previewJob.id, status: 'declined' });
                  setPreviewJob(null);
                }}
                disabled={reviewJobMutation.isPending}
                className="border-red-300 text-destructive hover:bg-destructive/10"
              >
                <XCircle className="h-4 w-4 mr-1" />
                Decline
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Application Detail Dialog */}
      {selectedApplication && (
        <Dialog open={!!selectedApplication} onOpenChange={() => setSelectedApplication(null)}>
          <DialogContent className="bg-card border-border max-w-2xl">
            <DialogHeader>
              <DialogTitle className="text-foreground">{selectedApplication.fullName}</DialogTitle>
              <DialogDescription className="text-foreground/70">
                Application for {selectedApplication.job.title} at {selectedApplication.job.company}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="text-foreground/70">
                  Email: <span className="text-foreground">{selectedApplication.email}</span>
                </div>
                <div className="text-foreground/70">
                  Phone: <span className="text-foreground">{selectedApplication.phone}</span>
                </div>
                <div className="text-foreground/70">
                  Status: 
                  <Badge className={`ml-2 ${getStatusConfig(selectedApplication.status).color}`}>
                    {getStatusConfig(selectedApplication.status).label}
                  </Badge>
                </div>
                <div className="text-foreground/70">
                  Applied: <span className="text-foreground">{format(new Date(selectedApplication.appliedAt), "MMM d, yyyy")}</span>
                </div>
              </div>
              {selectedApplication.coverLetter && (
                <div>
                  <span className="text-foreground/70 block mb-2">Cover Letter:</span>
                  <div className="bg-muted p-3 rounded text-foreground text-sm max-h-32 overflow-y-auto">
                    {selectedApplication.coverLetter}
                  </div>
                </div>
              )}
              {selectedApplication.notes && (
                <div>
                  <span className="text-foreground/70 block mb-2">Recruiter Notes:</span>
                  <div className="bg-muted p-3 rounded text-foreground text-sm">
                    {selectedApplication.notes}
                  </div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setSelectedApplication(null)}
                className="border-border text-foreground hover:bg-muted"
              >
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Invite Hiring Manager Dialog */}
      <Dialog open={showInviteHMDialog} onOpenChange={setShowInviteHMDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Invite Hiring Manager</DialogTitle>
            <DialogDescription>
              Send an email invitation to collaborate on candidate reviews.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label htmlFor="hm-email" className="text-sm font-medium">
                Email <span className="text-destructive">*</span>
              </label>
              <Input
                id="hm-email"
                type="email"
                placeholder="hiring.manager@company.com"
                value={inviteHMEmail}
                onChange={(e) => setInviteHMEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="hm-name" className="text-sm font-medium">
                Name <span className="text-muted-foreground">(optional)</span>
              </label>
              <Input
                id="hm-name"
                placeholder="John Smith"
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
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!inviteHMEmail) {
                  toast({
                    title: "Email Required",
                    description: "Please enter an email address.",
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
                  Sending...
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  Send Invitation
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
