import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Cpu,
  Loader2,
  XCircle,
  CheckCircle,
  Clock,
  AlertTriangle,
  RefreshCw,
  Trash2,
} from "lucide-react";
import Layout from "@/components/Layout";
import { useAuth } from "@/hooks/use-auth";
import { Redirect } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { adminAIJobsPageCopy } from "@/lib/internal-copy";

interface AIJob {
  id: number;
  userId: number;
  status: "pending" | "active" | "completed" | "failed" | "cancelled";
  queueName: string;
  bullJobId: string;
  progress: number;
  processedCount: number;
  totalCount: number;
  error: string | null;
  errorCode: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

interface AIJobsData {
  jobs: AIJob[];
}

interface QueueHealth {
  interactive: { waiting: number; active: number; completed: number; failed: number };
  batch: { waiting: number; active: number; completed: number; failed: number };
}

export default function AdminAIJobsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [cancelJobId, setCancelJobId] = useState<number | null>(null);

  // Redirect non-admin users
  if (!user || user.role !== "super_admin") {
    return <Redirect to="/recruiter-auth" />;
  }

  // Fetch AI jobs
  const { data: jobsData, isLoading: jobsLoading, refetch } = useQuery<AIJobsData>({
    queryKey: ["/api/admin/ai/jobs"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/ai/jobs");
      return res.json();
    },
    refetchInterval: 5000, // Auto-refresh every 5 seconds
  });

  // Fetch queue health
  const { data: healthData } = useQuery<QueueHealth>({
    queryKey: ["/api/admin/ai/queue-health"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/ai/queue-health");
      return res.json();
    },
    refetchInterval: 10000,
  });

  // Cancel job mutation
  const cancelMutation = useMutation({
    mutationFn: async (jobId: number) => {
      const res = await apiRequest("POST", `/api/admin/ai/jobs/${jobId}/cancel`);
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to cancel job");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: adminAIJobsPageCopy.toasts.cancelledTitle,
        description: adminAIJobsPageCopy.toasts.cancelledDescription,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ai/jobs"] });
      setCancelJobId(null);
    },
    onError: (error: Error) => {
      toast({
        title: adminAIJobsPageCopy.toasts.errorTitle,
        description: error.message,
        variant: "destructive",
      });
      setCancelJobId(null);
    },
  });

  const jobs = jobsData?.jobs || [];

  const getStatusBadge = (status: AIJob["status"]) => {
    const configs: Record<AIJob["status"], { color: string; icon: any }> = {
      pending: { color: "bg-yellow-100 text-yellow-800", icon: Clock },
      active: { color: "bg-blue-100 text-blue-800", icon: Loader2 },
      completed: { color: "bg-green-100 text-green-800", icon: CheckCircle },
      failed: { color: "bg-red-100 text-red-800", icon: XCircle },
      cancelled: { color: "bg-gray-100 text-gray-800", icon: Trash2 },
    };
    const config = configs[status];
    const Icon = config.icon;
    return (
      <Badge className={`${config.color} border-0`}>
        <Icon className={`w-3 h-3 mr-1 ${status === "active" ? "animate-spin" : ""}`} />
        {status}
      </Badge>
    );
  };

  const formatDate = (date: string | null) => {
    if (!date) return "-";
    return new Date(date).toLocaleString();
  };

  return (
    <Layout>
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white p-6">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
                <Cpu className="w-8 h-8 text-primary" />
                {adminAIJobsPageCopy.header.title}
              </h1>
              <p className="text-muted-foreground mt-1">{adminAIJobsPageCopy.header.subtitle}</p>
            </div>
            <Button onClick={() => refetch()} variant="outline" size="sm">
              <RefreshCw className="w-4 h-4 mr-2" />
              {adminAIJobsPageCopy.header.refresh}
            </Button>
          </div>

          {/* Queue Health Stats */}
          {healthData && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">{adminAIJobsPageCopy.queues.interactive}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-4 gap-4 text-center">
                    <div>
                      <p className="text-2xl font-bold text-yellow-600">{healthData.interactive?.waiting || 0}</p>
                      <p className="text-xs text-muted-foreground">{adminAIJobsPageCopy.queues.waiting}</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-blue-600">{healthData.interactive?.active || 0}</p>
                      <p className="text-xs text-muted-foreground">{adminAIJobsPageCopy.queues.active}</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-green-600">{healthData.interactive?.completed || 0}</p>
                      <p className="text-xs text-muted-foreground">{adminAIJobsPageCopy.queues.completed}</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-red-600">{healthData.interactive?.failed || 0}</p>
                      <p className="text-xs text-muted-foreground">{adminAIJobsPageCopy.queues.failed}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">{adminAIJobsPageCopy.queues.batch}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-4 gap-4 text-center">
                    <div>
                      <p className="text-2xl font-bold text-yellow-600">{healthData.batch?.waiting || 0}</p>
                      <p className="text-xs text-muted-foreground">{adminAIJobsPageCopy.queues.waiting}</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-blue-600">{healthData.batch?.active || 0}</p>
                      <p className="text-xs text-muted-foreground">{adminAIJobsPageCopy.queues.active}</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-green-600">{healthData.batch?.completed || 0}</p>
                      <p className="text-xs text-muted-foreground">{adminAIJobsPageCopy.queues.completed}</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-red-600">{healthData.batch?.failed || 0}</p>
                      <p className="text-xs text-muted-foreground">{adminAIJobsPageCopy.queues.failed}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Jobs Table */}
          <Card>
            <CardHeader>
              <CardTitle>{adminAIJobsPageCopy.jobs.title}</CardTitle>
              <CardDescription>{adminAIJobsPageCopy.jobs.description}</CardDescription>
            </CardHeader>
            <CardContent>
              {jobsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 text-primary animate-spin" />
                </div>
              ) : jobs.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <CheckCircle className="w-12 h-12 mx-auto mb-3 text-green-500 opacity-50" />
                  <p>{adminAIJobsPageCopy.jobs.empty}</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{adminAIJobsPageCopy.jobs.id}</TableHead>
                      <TableHead>{adminAIJobsPageCopy.jobs.status}</TableHead>
                      <TableHead>{adminAIJobsPageCopy.jobs.queue}</TableHead>
                      <TableHead>{adminAIJobsPageCopy.jobs.userId}</TableHead>
                      <TableHead>{adminAIJobsPageCopy.jobs.progress}</TableHead>
                      <TableHead>{adminAIJobsPageCopy.jobs.created}</TableHead>
                      <TableHead>{adminAIJobsPageCopy.jobs.error}</TableHead>
                      <TableHead>{adminAIJobsPageCopy.jobs.actions}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {jobs.map((job) => (
                      <TableRow key={job.id}>
                        <TableCell className="font-mono">{job.id}</TableCell>
                        <TableCell>{getStatusBadge(job.status)}</TableCell>
                        <TableCell>
                          <code className="text-xs bg-muted px-1 py-0.5 rounded">
                            {job.queueName}
                          </code>
                        </TableCell>
                        <TableCell>{job.userId}</TableCell>
                        <TableCell>
                          {job.processedCount}/{job.totalCount}
                          {job.progress > 0 && (
                            <span className="text-muted-foreground ml-1">
                              ({Math.round(job.progress)}%)
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDate(job.createdAt)}
                        </TableCell>
                        <TableCell>
                          {job.error && (
                            <span className="text-xs text-red-600 max-w-[200px] truncate block" title={job.error}>
                              {job.errorCode || job.error}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          {(job.status === "pending" || job.status === "active" || job.status === "failed") && (
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => setCancelJobId(job.id)}
                              disabled={cancelMutation.isPending}
                            >
                              <XCircle className="w-4 h-4 mr-1" />
                              Cancel
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Warning for stuck jobs */}
          {jobs.some(j => j.queueName.includes(":")) && (
            <Card className="border-yellow-300 bg-yellow-50">
              <CardContent className="pt-6">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-6 h-6 text-yellow-600 flex-shrink-0" />
                  <div>
                    <p className="font-medium text-yellow-800">Stuck Jobs Detected</p>
                    <p className="text-sm text-yellow-700 mt-1">
                      Some jobs have queue names with colons (e.g., <code>ai:batch</code>) which won't be processed
                      by the worker. Cancel these jobs so users can retry with the correct queue names.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Cancel Confirmation Dialog */}
      <AlertDialog open={cancelJobId !== null} onOpenChange={() => setCancelJobId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{adminAIJobsPageCopy.cancelDialog.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {adminAIJobsPageCopy.cancelDialog.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Job</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => cancelJobId && cancelMutation.mutate(cancelJobId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {cancelMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <XCircle className="w-4 h-4 mr-2" />
              )}
              Cancel Job
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}
