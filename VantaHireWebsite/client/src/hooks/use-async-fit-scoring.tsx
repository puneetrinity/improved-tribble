import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { candidatePrivateQueryKey } from "@/lib/candidate-query-keys";

interface AiFitJob {
  id: number;
  bullJobId: string;
  queueName: string;
  applicationId?: number | null;
  applicationIds?: number[] | null;
  status: string;
  progress: number;
  processedCount: number;
  totalCount?: number | null;
  result?: any;
  error?: string | null;
  errorCode?: string | null;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
}

interface EnqueueResponse {
  jobId: number;
  statusUrl: string;
  totalCount: number;
  cachedCount?: number;
  existing?: boolean;
  cached?: boolean;
  results?: any[];
  summary?: any;
}

interface EnqueueError {
  error: string;
  errorCode?: string;
  remaining?: number;
  staleCount?: number;
  max?: number;
  pending?: number;
}

/**
 * Get user-friendly error message based on error code
 */
function getErrorMessage(errorCode: string | undefined, error: string, details?: any): string {
  switch (errorCode) {
    case 'QUOTA_EXCEEDED':
      return details?.remaining !== undefined
        ? `You have only ${details.remaining} analyses left. Select fewer applications.`
        : 'Monthly fit computation quota exhausted.';
    case 'MAX_EXCEEDED':
      return details?.max
        ? `You can analyze up to ${details.max} at a time.`
        : 'Too many applications selected.';
    case 'PENDING_LIMIT':
      return 'Please wait for current analyses to complete.';
    case 'RATE_LIMIT':
      return 'Please wait a moment before starting more analyses.';
    case 'ENQUEUE_FAILED':
      return 'Failed to queue the analysis. Please try again.';
    case 'CIRCUIT_OPEN':
      return 'AI service temporarily unavailable. Please try again later.';
    default:
      return error || 'An unexpected error occurred.';
  }
}

interface UseAsyncFitScoringOptions {
  /** Whether the async queue is enabled (from /api/ai/features) */
  queueEnabled: boolean;
  candidateId: number | null;
}

/**
 * Hook for async fit scoring with job queue
 */
export function useAsyncFitScoring({
  queueEnabled,
  candidateId,
}: UseAsyncFitScoringOptions) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeJobId, setActiveJobId] = useState<number | null>(null);

  useEffect(() => {
    setActiveJobId(null);
  }, [candidateId]);

  // Fetch existing pending/active jobs on mount (only when queue is enabled)
  const { data: existingJobs, refetch: refetchJobs } = useQuery<{ jobs: AiFitJob[] }>({
    queryKey: candidatePrivateQueryKey(
      "/api/ai/match/jobs",
      candidateId,
    ),
    queryFn: async () => {
      try {
        const res = await apiRequest("GET", "/api/ai/match/jobs");
        return await res.json();
      } catch {
        // Return empty jobs if endpoint fails
        return { jobs: [] };
      }
    },
    enabled: queueEnabled && candidateId !== null,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });

  // Set active job on mount if there's a pending/active job
  useEffect(() => {
    if (existingJobs?.jobs) {
      const activeJob = existingJobs.jobs.find(
        j => j.status === 'pending' || j.status === 'active'
      );
      if (activeJob && !activeJobId) {
        setActiveJobId(activeJob.id);
      }
    }
  }, [existingJobs, activeJobId, candidateId]);

  // Poll for job status when there's an active job
  const { data: jobStatus, isLoading: isPolling } = useQuery<AiFitJob>({
    queryKey: candidatePrivateQueryKey(
      "/api/ai/match/jobs",
      candidateId,
      activeJobId,
    ),
    queryFn: async () => {
      if (!activeJobId) throw new Error("No active job");
      const res = await apiRequest("GET", `/api/ai/match/jobs/${activeJobId}`);
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to fetch job status");
      }
      return await res.json();
    },
    enabled: candidateId !== null && activeJobId !== null,
    refetchInterval: (query) => {
      const data = query.state.data;
      // Stop polling when job is done
      if (data?.status === 'completed' || data?.status === 'failed' || data?.status === 'cancelled') {
        return false;
      }
      // Poll every 2.5 seconds while active
      return 2500;
    },
  });

  // Handle job completion
  useEffect(() => {
    if (!jobStatus) return;

    if (jobStatus.status === 'completed') {
      // Invalidate queries to refresh application data
      queryClient.invalidateQueries({ queryKey: ["/api/my-applications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ai/limits"] });
      refetchJobs();

      const summary = jobStatus.result?.summary;
      toast({
        title: "Analysis complete",
        description: summary
          ? `Computed: ${summary.succeeded}, Cached: ${summary.cached}${summary.requiresPaid > 0 ? `, Quota exceeded: ${summary.requiresPaid}` : ''}${summary.errors > 0 ? `, Errors: ${summary.errors}` : ''}`
          : "AI has analyzed your fit for the position(s).",
      });

      setActiveJobId(null);
    } else if (jobStatus.status === 'failed') {
      refetchJobs();

      const errorMsg = getErrorMessage(
        jobStatus.errorCode || undefined,
        jobStatus.error || 'Analysis failed',
        {}
      );
      toast({
        title: "Analysis failed",
        description: errorMsg,
        variant: "destructive",
      });

      setActiveJobId(null);
    }
  }, [jobStatus?.status, jobStatus?.result, jobStatus?.error, jobStatus?.errorCode, queryClient, toast, refetchJobs]);

  // Enqueue single application
  const enqueueInteractiveMutation = useMutation({
    mutationFn: async (applicationId: number): Promise<EnqueueResponse> => {
      const res = await apiRequest("POST", "/api/ai/match/queue", { applicationId });
      const data = await res.json();

      if (!res.ok) {
        const error = data as EnqueueError;
        const err = new Error(getErrorMessage(error.errorCode, error.error, error));
        (err as any).errorCode = error.errorCode;
        throw err;
      }

      return data;
    },
    onSuccess: (data) => {
      if (data.cached) {
        // Immediate cached result
        queryClient.invalidateQueries({ queryKey: ["/api/my-applications"] });
        toast({
          title: "Cached fit score",
          description: "Returned from cache (no quota used).",
        });
      } else if (data.existing) {
        // Returned existing job
        setActiveJobId(data.jobId);
        toast({
          title: "Analysis in progress",
          description: "There's already an analysis running for this application.",
        });
      } else {
        // New job queued
        setActiveJobId(data.jobId);
        toast({
          title: "Analysis queued",
          description: "Your fit analysis is being processed.",
        });
      }
      refetchJobs();
    },
    onError: (error: Error & { errorCode?: string }) => {
      toast({
        title: error.errorCode === 'QUOTA_EXCEEDED' ? "Quota exceeded" : "Failed to queue analysis",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Enqueue batch applications
  const enqueueBatchMutation = useMutation({
    mutationFn: async (applicationIds: number[]): Promise<EnqueueResponse> => {
      const res = await apiRequest("POST", "/api/ai/match/batch/queue", { applicationIds });
      const data = await res.json();

      if (!res.ok) {
        const error = data as EnqueueError;
        const err = new Error(getErrorMessage(error.errorCode, error.error, error));
        (err as any).errorCode = error.errorCode;
        throw err;
      }

      return data;
    },
    onSuccess: (data) => {
      if (data.cached) {
        // All items were cached
        queryClient.invalidateQueries({ queryKey: ["/api/my-applications"] });
        toast({
          title: "All cached",
          description: `${data.summary?.cached || data.results?.length} fit scores returned from cache.`,
        });
      } else if (data.existing) {
        // Returned existing job
        setActiveJobId(data.jobId);
        toast({
          title: "Analysis in progress",
          description: "There's already a batch analysis running.",
        });
      } else {
        // New job queued
        setActiveJobId(data.jobId);
        toast({
          title: "Batch analysis queued",
          description: `Analyzing ${data.totalCount} application(s)${data.cachedCount ? ` (${data.cachedCount} already cached)` : ""}.`,
        });
      }
      refetchJobs();
    },
    onError: (error: Error & { errorCode?: string }) => {
      toast({
        title: error.errorCode === 'QUOTA_EXCEEDED' ? "Quota exceeded" : "Failed to queue analysis",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Cancel job
  const cancelJobMutation = useMutation({
    mutationFn: async (jobId: number) => {
      const res = await apiRequest("DELETE", `/api/ai/match/jobs/${jobId}`);
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to cancel job");
      }
      return await res.json();
    },
    onSuccess: () => {
      setActiveJobId(null);
      refetchJobs();
      toast({
        title: "Analysis cancelled",
        description: "The analysis has been cancelled.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to cancel",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return {
    // State
    activeJobId,
    jobStatus,
    existingJobs: existingJobs?.jobs || [],
    isQueueAvailable: queueEnabled,

    // Computed
    isProcessing: !!activeJobId && (jobStatus?.status === 'pending' || jobStatus?.status === 'active'),
    progress: jobStatus?.progress || 0,
    processedCount: jobStatus?.processedCount || 0,
    totalCount: jobStatus?.totalCount || 0,

    // Actions
    enqueueInteractive: enqueueInteractiveMutation.mutate,
    enqueueBatch: enqueueBatchMutation.mutate,
    cancelJob: cancelJobMutation.mutate,

    // Loading states
    isEnqueueingInteractive: enqueueInteractiveMutation.isPending,
    isEnqueueingBatch: enqueueBatchMutation.isPending,
    isCancelling: cancelJobMutation.isPending,
    isPolling,
  };
}
