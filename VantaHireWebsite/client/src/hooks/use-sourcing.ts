import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, isApiError } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { trackEvent } from "@/lib/analytics";
import { useRef, useEffect, useState, useCallback } from "react";
import type { PipelineProgressState, EnrichmentCandidateEvent } from "@/components/sourcing/SourcingProgressModal";
import { INITIAL_PROGRESS } from "@/components/sourcing/SourcingProgressModal";

export type MatchTier = "best_matches" | "broader_pool";
export type LocationMatchType = "city_exact" | "city_alias" | "country_only" | "unknown_location" | "none";

export interface SourcedCandidateForUI {
  id: number;
  jobId: number;
  signalCandidateId: string;
  signalRank: number | null;
  fitScore: number | null;
  fitScoreRaw: number | null;
  fitBreakdown: Record<string, unknown> | null;
  sourceType: string;
  displayBucket: "talent_pool" | "newly_discovered";
  state: "new" | "shortlisted" | "hidden" | "converted";
  foundEmail: string | null;
  foundEmails: string[] | null;
  emailResolvedAt: string | null;
  emailResolveStatus: "pending" | "resolved" | "not_found" | "failed" | null;
  outreachCount: number;
  lastOutreachRound: number | null;
  lastOutreachCampaignId: string | null;
  lastOutreachAt: string | null;
  lastOutreachStatus: "sent" | "failed" | null;

  crustdata: Record<string, any> | null;
  linkedinUrl: string | null;
  enrichmentStatus: string | null;
  confidenceScore: number | null;
  searchSnippet: string | null;
  searchProvider: string | null;
  searchSignals: {
    serpDate: string | null;
    serpDateDaysAgo: number | null;
    linkedinHost: string | null;
    linkedinLocale: string | null;
  };

  matchTier?: MatchTier | null;
  locationMatchType?: LocationMatchType | null;
  dataConfidence?: "high" | "medium" | "low" | null;
  roleScore?: number | null;
  experienceScore?: number | null;

  identitySummary: {
    bestBridgeTier: number | null;
    maxIdentityConfidence: number | null;
    hasConfirmedIdentity: boolean;
    needsReview: boolean;
    platforms: string[];
    displayStatus: "verified" | "review" | "weak";
    lastIdentityCheckAt: string | null;
  } | null;

  snapshot: {
    skillsNormalized: unknown;
    roleType: string | null;
    seniorityBand: string | null;
    location: string | null;
    computedAt: string | null;
    signalsJson?: any;
  } | null;

  freshness: {
    lastEnrichedAt: string | null;
    lastIdentityCheckAt: string | null;
    enrichedDaysAgo: number | null;
    identityCheckDaysAgo: number | null;
  };

  engagementReady?: boolean;
  locationLabel?: string | null;
  locationConfidenceNumeric?: number | null;

  profilePictureUrl?: string | null;
  cardSignals: {
    email: string | null;
    phone: string | null;
    github: string | null;
    twitter: string | null;
    skillsTopN: string[];
    activeSeeker: boolean;
    summaryShort: string | null;
    emailAvailable: boolean;
    phoneAvailable: boolean;
  } | null;
  aiSummary: {
    text: string;
    skills: string[];
  } | null;
  candidateSummary: {
    identities?: Array<{
      platform: string;
      confidence: number;
      platformId: string;
      profileUrl: string;
    }>;
  } | null;
  lastSyncedAt: string | null;
  createdAt: string | null;
}

export interface SourcingStatus {
  hasRun: boolean;
  requestId?: string;
  status?: string;
  candidateCount?: number;
  submittedAt?: string;
  completedAt?: string;
  errorMessage?: string;

}

export interface SourcedCandidatesResponse {
  candidates: SourcedCandidateForUI[];
  counts: {
    total: number;
    talentPool: number;
    newlyDiscovered: number;
  };
  groupCounts?: {
    bestMatches: number;
    broaderPool: number;
    strictMatchedCount?: number;
    expandedCount?: number;
    expansionReason?: string | null;
    requestedLocation?: string | null;
    strictDemotedCount?: number;
    strictRescuedCount?: number;
    strictRescueApplied?: boolean;
    strictRescueMinFitScoreUsed?: number | null;
    countryGuardFilteredCount?: number;
    minDiscoveryPerRunApplied?: number;
    minDiscoveredInOutputApplied?: number;
    discoveredPromotedCount?: number;
    discoveredPromotedInTopCount?: number;
    discoveredOrphanCount?: number;
    discoveredOrphanQueued?: number;
    locationMatchCounts?: Record<string, number> | null;
    demotedStrictWithCityMatch?: number;
    strictBeforeDemotion?: number;
    selectedSnapshotTrack?: string | null;
  };
  expansionReason?: string | null;
  requestedLocation?: string | null;
  discoverySummary?: {
    mode: string;
    strictQueriesExecuted: number;
    fallbackQueriesExecuted: number;
    queriesExecuted: number;
    strictYield: number;
    fallbackYield: number;
    stoppedReason?: string | null;
    providerUsage?: Record<string, number> | null;
    groqUsed?: boolean;
  } | null;
  qualityDebug?: {
    totalCandidates: number;
    locationMatchedCount: number;
    locationMatchedPct: number;
    validLocationHintCount: number;
    validLocationHintPct: number;
    nonZeroSkillScoreCount: number;
    nonZeroSkillScorePct: number;
  } | null;
  kpis?: {
    engagementReadyCount: number;
    firstQualifiedCandidateRank: number | null;
  };
}

export interface ColdOutreachDraft {
  candidateId: number;
  name: string;
  email: string | null;
  subject: string;
  body: string;
}

export interface ColdOutreachHistoryResponse {
  nextAvailableRound: 1 | 2 | 3 | null;
  canStartAnyCampaign: boolean;
  eligibleByRound: Record<1 | 2 | 3, {
    count: number;
    candidateIds: number[];
  }>;
  maxCampaigns: number;
  campaigns: Array<{
    campaignId: string;
    campaignRound: number;
    status: string;
    launchedAt: string;
    completedAt: string | null;
    audienceCount: number;
    sent: number;
    failed: number;
    subjectTemplate: string | null;
    messages: Array<{
      id: number;
      sourcedCandidateId: number;
      recipientEmail: string;
      recipientName: string | null;
      subject: string;
      status: "sent" | "failed";
      errorMessage: string | null;
      sentAt: string;
    }>;
  }>;
}

const TERMINAL_STATUSES = new Set(["completed", "failed", "expired"]);
function isTerminal(status: string | undefined): boolean {
  return !!status && TERMINAL_STATUSES.has(status);
}



export function useSourcingStatus(jobId: number | undefined) {
  const queryClient = useQueryClient();
  const prevStatusRef = useRef<string | undefined>(undefined);

  const query = useQuery<SourcingStatus>({
    queryKey: ["/api/jobs", jobId, "sourcing-status"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/jobs/${jobId}/sourcing-status`);
      return res.json();
    },
    enabled: !!jobId,
    refetchOnWindowFocus: false,
    refetchInterval: (query) => {
      const data = query.state.data;
      // Only poll while job is actively running (not terminal).
      // Enrichment is now atomic in the orchestrator, so 'completed' = done.
      const isPolling = !!data?.hasRun && !isTerminal(data?.status);
      return isPolling ? 5000 : false;
    },
  });

  useEffect(() => {
    if (!jobId) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/api/sourcing/ws/${jobId}`;
    const ws = new WebSocket(wsUrl);

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.jobId !== jobId) return;

        // Only invalidate on the terminal sourcing_update — NOT on candidate_sourced.
        // The webhook streams a candidate_sourced event for every candidate synced
        // (up to 100), so listening to it here would fire 100 simultaneous
        // invalidateQueries calls and create a request storm.
        // candidate_enriched: no-op — enrichment is atomic, candidates fetched on completion.
        if (data.type === 'sourcing_update') {
          queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "sourcing-status"] });

          // Self-close WS once job reaches a terminal state — no more events expected.
          if (data.status && isTerminal(data.status)) {
            ws.close();
          }
        }
      } catch (e) {
        console.error("Failed to parse websocket message", e);
      }
    };

    return () => ws.close();
  }, [jobId, queryClient]);

  useEffect(() => {
    const currentStatus = query.data?.status;
    const prevStatus = prevStatusRef.current;
    prevStatusRef.current = currentStatus;

    // Only fetch candidates when job transitions TO a terminal state.
    // Candidates don't change mid-run — enrichment is atomic in the orchestrator.
    const justBecameTerminal =
      currentStatus && prevStatus && !isTerminal(prevStatus) && isTerminal(currentStatus);

    if (justBecameTerminal) {
      queryClient.refetchQueries({
        queryKey: ["/api/jobs", jobId, "sourced-candidates"],
      });
    }
  }, [query.data?.status, jobId, queryClient]);

  return {
    data: query.data,
    isLoading: query.isLoading,
    isPolling: !!query.data?.hasRun && !isTerminal(query.data?.status),
  };
}

export function useSourcedCandidates(jobId: number | undefined) {
  return useQuery<SourcedCandidatesResponse>({
    queryKey: ["/api/jobs", jobId, "sourced-candidates"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/jobs/${jobId}/sourced-candidates`);
      return res.json();
    },
    enabled: !!jobId,
    refetchOnWindowFocus: false,
    refetchInterval: (query) => {
      const candidates = query.state.data?.candidates ?? [];
      return candidates.some((candidate) => candidate.emailResolveStatus === "pending")
        ? 3000
        : false;
    },
  });
}

// ─── Pipeline Progress Hook ───────────────────────────────────────────────────

/**
 * useSourcingProgress — tracks the real-time pipeline state from the sourcing-status poll.
 * Powers the SourcingProgressModal. Derives phase/percent from DB status instead of WS
 * events (which are not bridged from the signal worker to Express).
 */
export function useSourcingProgress(jobId: number | undefined) {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<PipelineProgressState>({ ...INITIAL_PROGRESS });
  const [modalOpen, setModalOpen] = useState(false);
  const startTimeRef = useRef<number | null>(null);
  const logsRef = useRef<string[]>([]);

  const addLog = useCallback((msg: string) => {
    const now = new Date().toLocaleTimeString("en-GB", { hour12: false });
    const entry = `${now} ${msg}`;
    logsRef.current = [...logsRef.current.slice(-199), entry];
    setProgress((prev) => ({ ...prev, devLogs: logsRef.current }));
  }, []);

  const resetProgress = useCallback(() => {
    logsRef.current = [];
    startTimeRef.current = Date.now();
    setProgress({ ...INITIAL_PROGRESS });
  }, []);

  const openModal = useCallback(() => {
    resetProgress();
    setModalOpen(true);
    setProgress((prev) => ({
      ...prev,
      phase: "discovery",
      percent: 2,
      message: "Connecting to pipeline...",
    }));
    addLog("🚀 [PIPELINE] Sourcing job queued — waiting for worker...");
  }, [resetProgress, addLog]);

  const closeModal = useCallback(() => {
    setModalOpen(false);
  }, []);

  // ── WS-driven real-time progress ─────────────────────────────────────────
  // Each pipeline event from the server maps directly to a UI state update
  // with zero polling delay — the WS message arrives milliseconds after
  // the worker fires sendProgressCallback().
  useEffect(() => {
    if (!jobId || !modalOpen) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/sourcing/ws/${jobId}`);

    ws.onmessage = (rawEvent) => {
      try {
        const data = JSON.parse(rawEvent.data);
        if (data.jobId !== jobId) return;

        switch (data.type) {
          case "phase_started":
            setProgress((p) => ({
              ...p,
              phase: "discovery",
              percent: 5,
              message: "Pipeline started — fetching candidates from Crustdata...",
            }));
            addLog("🚀 [PIPELINE] Phase started — worker is live");
            break;

          case "crustdata_fetching":
            setProgress((p) => ({
              ...p,
              phase: "discovery",
              percent: 15,
              message: "Searching Crustdata (300 candidates, relaxed query)...",
            }));
            addLog("📡 [CRUSTDATA] Fetching up to 300 candidates...");
            break;

          case "ranking_started": {
            const found = data.count as number | undefined;
            setProgress((p) => ({
              ...p,
              phase: "ranking",
              percent: 45,
              message: `Ranking ${found ?? 300} candidates against job requirements...`,
              ...(found !== undefined ? { crustdataFound: found } : {}),
            }));
            addLog(`📊 [RANKING] Locally ranking ${found ?? "300"} candidates...`);
            break;
          }

          case "pipeline_complete": {
            const elapsed = startTimeRef.current
              ? Math.round((Date.now() - startTimeRef.current) / 1000)
              : 0;
            setProgress((p) => ({
              ...p,
              phase: "finalizing",
              percent: 92,
              message: "Saving results...",
            }));
            addLog(`✅ [PIPELINE] Ranked — saving top 100 to database (${elapsed}s)`);
            break;
          }

          case "sourcing_update": {
            if (data.status === "completed") {
              const count = (data.candidateCount as number | undefined) ?? 0;
              const elapsed = startTimeRef.current
                ? Math.round((Date.now() - startTimeRef.current) / 1000)
                : 0;
              addLog(`🎉 [DONE] ${count} candidates saved (${elapsed}s total)`);
              // Pre-fetch candidates NOW so they're already in cache when the
              // modal disappears — eliminates the "no candidates" flash.
              queryClient.refetchQueries({
                queryKey: ["/api/jobs", jobId, "sourced-candidates"],
              });
              // Also update status cache so the page knows it's completed.
              queryClient.invalidateQueries({
                queryKey: ["/api/jobs", jobId, "sourcing-status"],
              });
              setProgress({
                phase: "complete",
                percent: 100,
                message: `Done! ${count} candidates ranked & ready`,
                candidates: [],
                devLogs: logsRef.current,
                enrichedCount: 0,
                totalToEnrich: 0,
                replacedCount: 0,
              });
              // Close immediately — candidates are being fetched in parallel.
              setModalOpen(false);
            } else if (data.status === "failed") {
              setProgress((p) => ({
                ...p,
                phase: "error",
                message: `Pipeline failed${data.errorMessage ? `: ${data.errorMessage}` : ""}`,
                ...(data.errorMessage ? { error: data.errorMessage as string } : {}),
              }));
              addLog(`❌ [ERROR] ${data.errorMessage ?? "unknown error"}`);
            }
            break;
          }

          default:
            break;
        }
      } catch (e) {
        console.error("Failed to parse pipeline WS message", e);
      }
    };

    return () => ws.close();
  }, [jobId, modalOpen, addLog]);

  // ── Slow-creep fallback ───────────────────────────────────────────────────
  // Nudges the progress bar forward between WS events so the bar never looks
  // frozen. Stops automatically when phase reaches complete/error/idle.
  useEffect(() => {
    if (!modalOpen) return;
    const interval = setInterval(() => {
      setProgress((p) => {
        if (p.phase === "complete" || p.phase === "error" || p.phase === "idle") return p;
        return { ...p, percent: Math.min(p.percent + 0.3, 88) };
      });
    }, 2000);
    return () => clearInterval(interval);
  }, [modalOpen]);

  // ── Cache hydration on open ──────────────────────────────────────────────
  // If the modal opens on an already-completed job, show complete immediately.
  useEffect(() => {
    if (!jobId || !modalOpen) return;
    const cached = queryClient.getQueryData<SourcingStatus>(["/api/jobs", jobId, "sourcing-status"]);
    if (cached?.status === "completed") {
      const count = cached.candidateCount ?? 0;
      setProgress({
        phase: "complete",
        percent: 100,
        message: `Done! ${count} candidates ranked & ready`,
        candidates: [],
        devLogs: logsRef.current,
        enrichedCount: 0,
        totalToEnrich: 0,
        replacedCount: 0,
      });
      setModalOpen(false);
    }
  }, [jobId, modalOpen, queryClient]);

  return { progress, modalOpen, openModal, closeModal, resetProgress };
}




export function useFindCandidates(jobId: number | undefined) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: async (opts?: { refresh?: boolean; forceSourcing?: boolean }) => {
      const res = await apiRequest("POST", `/api/jobs/${jobId}/find-candidates`, opts);
      return res.json();
    },
    onSuccess: (data) => {
      const isIdempotent = data?.idempotent === true;

      // Immediately refetch both queries so stale data is dropped
      queryClient.refetchQueries({
        queryKey: ["/api/jobs", jobId, "sourcing-status"],
      });
      queryClient.refetchQueries({
        queryKey: ["/api/jobs", jobId, "sourced-candidates"],
      });

      // For idempotent (already-completed) runs, the server re-syncs Signal data
      // before responding. Give it 2 seconds to commit, then refetch candidates again.
      if (isIdempotent) {
        setTimeout(() => {
          queryClient.refetchQueries({
            queryKey: ["/api/jobs", jobId, "sourced-candidates"],
          });
        }, 2000);
      }

      toast({
        title: isIdempotent ? "Candidates refreshed" : "Sourcing started",
        description: isIdempotent
          ? "Showing the latest ranked candidates for this role."
          : "Searching for candidates matching this role...",
      });
    },
    onError: (error: Error) => {
      const isMissingTenant = isApiError(error) && error.code === "NO_SIGNAL_TENANT";
      toast({
        title: isMissingTenant ? "Candidate sourcing isn't enabled yet" : "Failed to start sourcing",
        description: isMissingTenant
          ? "Candidate sourcing has not been configured for this organization yet. Please contact your workspace admin."
          : error.message,
        variant: "destructive",
      });
    },
  });

  return {
    trigger: mutation.mutate,
    isPending: mutation.isPending,
  };
}

export function useUpdateCandidateState(jobId: number | undefined) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: async ({
      candidateId,
      state,
    }: {
      candidateId: number;
      state: "new" | "shortlisted" | "hidden";
      candidateSnapshot?: Partial<SourcedCandidateForUI>;
    }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/jobs/${jobId}/sourced-candidates/${candidateId}`,
        { state },
      );
      return res.json();
    },
    onMutate: async ({ candidateId, state }) => {
      await queryClient.cancelQueries({
        queryKey: ["/api/jobs", jobId, "sourced-candidates"],
      });

      const previous = queryClient.getQueryData<SourcedCandidatesResponse>([
        "/api/jobs",
        jobId,
        "sourced-candidates",
      ]);

      if (previous) {
        queryClient.setQueryData<SourcedCandidatesResponse>(
          ["/api/jobs", jobId, "sourced-candidates"],
          {
            ...previous,
            candidates: previous.candidates.map((c) =>
              c.id === candidateId
                ? {
                    ...c,
                    state,
                    emailResolveStatus:
                      state === "shortlisted"
                      && !c.foundEmail
                      && c.emailResolveStatus !== "resolved"
                      && c.emailResolveStatus !== "pending"
                        ? "pending"
                        : c.emailResolveStatus,
                  }
                : c,
            ),
          },
        );
      }

      return { previous };
    },
    onSuccess: (_data, { candidateId, state, candidateSnapshot }) => {
      const cached = queryClient.getQueryData<SourcedCandidatesResponse>(
        ["/api/jobs", jobId, "sourced-candidates"],
      )?.candidates.find((c) => c.id === candidateId);
      const c = candidateSnapshot ?? cached;
      const eventName = state === "shortlisted" ? "shortlist_clicked" : state === "hidden" ? "hide_clicked" : "candidate_state_changed";
      trackEvent(eventName, {
        job_id: jobId ?? 0,
        candidate_id: candidateId,
        signal_rank: c?.signalRank ?? 0,
        fit_score: c?.fitScore ?? 0,
        source_type: c?.sourceType ?? "",
        match_tier: c?.matchTier ?? "",
        engagement_ready: c?.engagementReady ?? false,
        location_match_type: c?.locationMatchType ?? "",
      });
    },
    onError: (error: Error, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          ["/api/jobs", jobId, "sourced-candidates"],
          context.previous,
        );
      }
      toast({
        title: "Failed to update candidate",
        description: error.message,
        variant: "destructive",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/jobs", jobId, "sourced-candidates"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/jobs", jobId, "cold-outreach-history"],
      });
    },
  });

  return {
    update: mutation.mutate,
    isPending: mutation.isPending,
  };
}


export function useFindContact() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({ candidateId, jobId }: { candidateId: number, jobId: number }) => {
      const res = await apiRequest("POST", `/api/candidates/${candidateId}/find-contact`);
      return await res.json();
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["/api/jobs", variables.jobId, "sourced-candidates"],
      });

      if (data.emails && data.emails.length > 0) {
        toast({
          title: "Contact Found",
          description: `Discovered ${data.emails.length} email(s) for this candidate!`,
        });
      } else {
        toast({
          title: "No Contact Found",
          description: "We couldn't find a professional email for this candidate.",
          variant: "destructive",
        });
      }
    },
    onError: (error: Error, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["/api/jobs", variables.jobId, "sourced-candidates"],
      });
      toast({
        title: "Contact Search Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return {
    findContact: mutation.mutate,
    isPending: mutation.isPending,
  };
}

export function useDraftOutreach(jobId: number | undefined) {
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: async (payload: {
      candidateIds: number[];
      campaignRound: 1 | 2 | 3;
      extraContext?: string;
    }) => {
      const res = await apiRequest("POST", `/api/jobs/${jobId}/cold-outreach/draft`, payload);
      return await res.json() as {
        campaignRound: number;
        campaignLabel: string;
        campaignSummary: string;
        drafts: ColdOutreachDraft[];
      };
    },
    onError: (error: Error) => {
      toast({
        title: "Draft generation failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return {
    draftOutreach: mutation.mutateAsync,
    isPending: mutation.isPending,
  };
}

export function useSendOutreach(jobId: number | undefined) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (payload: {
      campaignId: string;
      campaignRound: 1 | 2 | 3;
      extraContext?: string;
      messages: Array<{
        candidateId: number;
        subject: string;
        body: string;
        wasEdited: boolean;
        aiDraftSubject: string;
        aiDraftBody: string;
      }>;
    }) => {
      const res = await apiRequest("POST", `/api/jobs/${jobId}/cold-outreach/send`, payload);
      return await res.json() as {
        sent: number;
        failed: number;
        campaign: {
          campaignId: string;
          campaignRound: number;
          audienceCount: number;
        };
        results: Array<{
          candidateId: number;
          email: string;
          status: "sent" | "failed";
          errorMessage: string | null;
        }>;
      };
    },
    onSuccess: (_data) => {
      queryClient.invalidateQueries({
        queryKey: ["/api/jobs", jobId, "sourced-candidates"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/jobs", jobId, "cold-outreach-history"],
      });
      toast({
        title: "Outreach sent",
        description: "Campaign results have been saved.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Send failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return {
    sendOutreach: mutation.mutateAsync,
    isPending: mutation.isPending,
  };
}

export function useOutreachHistory(jobId: number | undefined) {
  return useQuery<ColdOutreachHistoryResponse>({
    queryKey: ["/api/jobs", jobId, "cold-outreach-history"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/jobs/${jobId}/cold-outreach/history`);
      return await res.json();
    },
    enabled: !!jobId,
    refetchOnWindowFocus: false,
  });
}
