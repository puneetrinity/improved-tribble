import { useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { Application, Job } from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { candidatePrivateQueryKey } from "@/lib/candidate-query-keys";

export const candidateApplicationsQueryKey = ["/api/my-applications"] as const;
export const candidateResumesQueryKey = ["/api/ai/resume"] as const;
export const candidateSavedJobsQueryKey = ["/api/candidate/saved-jobs"] as const;

export type CandidateApplicationSummary = Pick<
  Application,
  | "id"
  | "jobId"
  | "status"
  | "coverLetter"
  | "appliedAt"
  | "updatedAt"
  | "aiFitScore"
  | "aiFitLabel"
  | "aiFitReasons"
  | "aiComputedAt"
  | "aiStaleReason"
> & {
  job: Pick<
    Job,
    | "id"
    | "title"
    | "location"
    | "type"
    | "description"
    | "skills"
    | "deadline"
    | "createdAt"
    | "isActive"
    | "expiresAt"
  >;
};

export type CandidateResumeSummary = {
  id: number;
  label: string;
  isDefault: boolean | null;
  createdAt: string | Date;
  updatedAt: string | Date;
};

export type SavedJobRecord = {
  id: number;
  createdAt: string | Date;
  canApply: boolean;
  job: Job;
};

type SavedJobsResponse = {
  savedJobs: SavedJobRecord[];
};

type ResumesResponse = {
  resumes: CandidateResumeSummary[];
};

const EMPTY_APPLICATIONS: CandidateApplicationSummary[] = [];
const EMPTY_SAVED_JOBS: SavedJobRecord[] = [];
const EMPTY_RESUMES: CandidateResumeSummary[] = [];

async function readJson<T>(url: string, errorMessage: string): Promise<T> {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) {
    throw new Error(errorMessage);
  }
  return response.json();
}

export function useCandidateJobState() {
  const { user, isLoading: authLoading } = useAuth();
  const isCandidate = !authLoading && user?.role === "candidate";
  const isVerifiedCandidate =
    isCandidate && user?.emailVerified === true;
  const candidateId = isVerifiedCandidate ? user.id : null;

  const applicationsQuery = useQuery<CandidateApplicationSummary[]>({
    queryKey: candidatePrivateQueryKey(
      candidateApplicationsQueryKey[0],
      candidateId,
    ),
    queryFn: () =>
      readJson<CandidateApplicationSummary[]>(
        "/api/my-applications",
        "Failed to load your applications",
      ),
    enabled: isVerifiedCandidate,
    staleTime: 30_000,
    refetchInterval: 30_000,
    // Auth refresh owns focus transitions so a replaced session cannot refetch
    // private data under the previous candidate's key.
    refetchOnWindowFocus: false,
  });

  const savedJobsQuery = useQuery<SavedJobsResponse>({
    queryKey: candidatePrivateQueryKey(
      candidateSavedJobsQueryKey[0],
      candidateId,
    ),
    queryFn: () =>
      readJson<SavedJobsResponse>(
        "/api/candidate/saved-jobs",
        "Failed to load your saved jobs",
      ),
    enabled: isVerifiedCandidate,
  });

  const resumesQuery = useQuery<ResumesResponse>({
    queryKey: candidatePrivateQueryKey(
      candidateResumesQueryKey[0],
      candidateId,
    ),
    queryFn: () =>
      readJson<ResumesResponse>(
        "/api/ai/resume",
        "Failed to load your resumes",
      ),
    enabled: isVerifiedCandidate,
  });

  const saveJobMutation = useMutation({
    mutationFn: async (jobId: number) => {
      const response = await apiRequest(
        "POST",
        `/api/candidate/saved-jobs/${jobId}`,
      );
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: candidateSavedJobsQueryKey });
    },
  });

  const unsaveJobMutation = useMutation({
    mutationFn: async (jobId: number) => {
      const response = await apiRequest(
        "DELETE",
        `/api/candidate/saved-jobs/${jobId}`,
      );
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: candidateSavedJobsQueryKey });
    },
  });

  const applications = applicationsQuery.data ?? EMPTY_APPLICATIONS;
  const savedJobs = savedJobsQuery.data?.savedJobs ?? EMPTY_SAVED_JOBS;
  const resumes = resumesQuery.data?.resumes ?? EMPTY_RESUMES;

  const applicationByJobId = useMemo(
    () =>
      new Map<number, CandidateApplicationSummary>(
        applications.map((application) => [application.jobId, application]),
      ),
    [applications],
  );

  const savedJobByJobId = useMemo(
    () =>
      new Map<number, SavedJobRecord>(
        savedJobs.map((savedJob) => [savedJob.job.id, savedJob]),
      ),
    [savedJobs],
  );

  const defaultResume = useMemo(
    () => resumes.find((resume) => resume.isDefault) ?? resumes[0] ?? null,
    [resumes],
  );

  return {
    isCandidate,
    isVerifiedCandidate,
    applications,
    applicationByJobId,
    applicationsQuery,
    savedJobs,
    savedJobByJobId,
    savedJobsQuery,
    resumes,
    defaultResume,
    resumesQuery,
    saveJob: (jobId: number) => saveJobMutation.mutateAsync(jobId),
    unsaveJob: (jobId: number) => unsaveJobMutation.mutateAsync(jobId),
    savingJobId: saveJobMutation.isPending
      ? saveJobMutation.variables ?? null
      : unsaveJobMutation.isPending
        ? unsaveJobMutation.variables ?? null
        : null,
  };
}
