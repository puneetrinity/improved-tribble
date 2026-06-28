import { useMemo, useState, useEffect, useRef } from "react";
import { trackEvent } from "@/lib/analytics";
import { useParams } from "wouter";
import Layout from "@/components/Layout";
import { JobSubNav } from "@/components/JobSubNav";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent } from "@/components/ui/card";
import { Search, Loader2, AlertCircle, Sparkles, ChevronDown, ChevronRight, Mail } from "lucide-react";
import {
  useSourcingStatus,
  useSourcedCandidates,
  useFindCandidates,
  useFindContact,
  useDraftOutreach,
  useSendOutreach,
  useOutreachHistory,
  useUpdateCandidateState,
  useSourcingProgress,
  // useBatchEnrich,
  type SourcedCandidateForUI,
} from "@/hooks/use-sourcing";
import { SourcingProgressModal } from "@/components/sourcing/SourcingProgressModal";
import { CandidateCard } from "@/components/sourcing/CandidateCard";
import { CandidateDrawer } from "@/components/sourcing/CandidateDrawer";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  SourcingFilters,
  defaultFilters,
  type SourcingFilterState,
} from "@/components/sourcing/SourcingFilters";
import { SourcingListSkeleton } from "@/components/skeletons";
import { splitByTier, type TierModel } from "@/lib/sourcing-tiering";
import { jobSourcingPageCopy } from "@/lib/internal-copy";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ColdOutreachSidebar } from "@/components/outreach/ColdOutreachSidebar";

type SortKey = "rank" | "fitScore" | "source" | "freshness";
type ShortlistOutreachFilter = "all" | "fresh" | "first_sent" | "second_sent" | "completed";

const SOURCE_PRIORITY: Record<string, number> = {
  pool_enriched: 0,
  pool: 1,
  discovered: 2,
};

function sortCandidates(candidates: SourcedCandidateForUI[], sortBy: SortKey): SourcedCandidateForUI[] {
  const sorted = [...candidates];
  const signalRank = (candidate: SourcedCandidateForUI): number =>
    typeof candidate.signalRank === "number" ? candidate.signalRank : Number.MAX_SAFE_INTEGER;
  const recencyDays = (candidate: SourcedCandidateForUI): number =>
    candidate.freshness.enrichedDaysAgo
    ?? candidate.searchSignals.serpDateDaysAgo
    ?? 999;
  const rankTieBreak = (a: SourcedCandidateForUI, b: SourcedCandidateForUI): number =>
    signalRank(a) - signalRank(b) || a.id - b.id;
  const recencyTieBreak = (a: SourcedCandidateForUI, b: SourcedCandidateForUI): number =>
    recencyDays(a) - recencyDays(b) || rankTieBreak(a, b);
  switch (sortBy) {
    case "rank":
      return sorted.sort((a, b) => rankTieBreak(a, b));
    case "fitScore":
      return sorted.sort((a, b) => (b.fitScore ?? -1) - (a.fitScore ?? -1) || rankTieBreak(a, b));
    case "source":
      return sorted.sort(
        (a, b) =>
          (SOURCE_PRIORITY[a.sourceType] ?? 9) - (SOURCE_PRIORITY[b.sourceType] ?? 9) ||
          rankTieBreak(a, b) ||
          (b.fitScore ?? -1) - (a.fitScore ?? -1) ||
          recencyTieBreak(a, b),
      );
    case "freshness":
      return sorted.sort(
        (a, b) =>
          recencyTieBreak(a, b),
      );
    default:
      return sorted;
  }
}

function filterCandidates(candidates: SourcedCandidateForUI[], filters: SourcingFilterState): SourcedCandidateForUI[] {
  return candidates.filter((c) => {
    if (filters.identityStatus !== "all" && c.identitySummary?.displayStatus !== filters.identityStatus) {
      return false;
    }

    if (filters.enrichedOnly && c.freshness.enrichedDaysAgo == null) {
      return false;
    }

    if (filters.location) {
      const crustLoc = c.crustdata?.location || c.crustdata?.basic_profile?.location?.full_location || c.crustdata?.basic_profile?.location?.name;
      const loc = (crustLoc || c.snapshot?.location || "").toLowerCase();
      if (!loc.includes(filters.location.toLowerCase())) return false;
    }

    if (filters.seniority !== "all") {
      const band = (c.snapshot?.seniorityBand || "").toLowerCase();
      if (!band.includes(filters.seniority.toLowerCase())) return false;
    }

    if (filters.candidateState !== "all" && c.state !== filters.candidateState) {
      return false;
    }

    return true;
  });
}

function getExpansionReasonText(reason?: string | null, requestedLocation?: string | null): string | null {
  if (!reason) return null;
  switch (reason) {
    case "strict_low_quality":
      return requestedLocation
        ? `Matches in ${requestedLocation} were low confidence, so we expanded the search.`
        : "Top strict matches were low confidence, so we expanded the search.";
    case "insufficient_strict_location_matches":
      return requestedLocation
        ? `Not enough strong matches were found in ${requestedLocation}, so we expanded the search.`
        : "Not enough strong strict matches were found, so we expanded the search.";
    case "expanded_location_results":
      return requestedLocation
        ? `To increase results, we looked beyond ${requestedLocation}.`
        : "To increase results, we broadened the search criteria.";
    default:
      return "We expanded the search to return more relevant candidates.";
  }
}

function getCandidateOutreachCount(candidate: SourcedCandidateForUI): number {
  return Math.max(0, Math.min(candidate.outreachCount ?? 0, 3));
}

function matchesShortlistOutreachFilter(
  candidate: SourcedCandidateForUI,
  filter: ShortlistOutreachFilter,
): boolean {
  const outreachCount = getCandidateOutreachCount(candidate);
  if (filter === "all") return true;
  if (filter === "fresh") return outreachCount === 0;
  if (filter === "first_sent") return outreachCount === 1;
  if (filter === "second_sent") return outreachCount === 2;
  return outreachCount >= 3;
}

export default function JobSourcingPage() {
  const params = useParams<{ id: string }>();
  const jobId = params.id ? parseInt(params.id, 10) : undefined;

  const [selectedCandidate, setSelectedCandidate] = useState<SourcedCandidateForUI | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [filters, setFilters] = useState<SourcingFilterState>(defaultFilters);
  const [sortBy, setSortBy] = useState<SortKey>("rank");
  const [bestMatchesOnly, setBestMatchesOnly] = useState(false);
  const [showBroader, setShowBroader] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [listMode, setListMode] = useState<"all" | "shortlisted">("all");
  const [shortlistOutreachFilter, setShortlistOutreachFilter] = useState<ShortlistOutreachFilter>("fresh");
  const [revealedEmails, setRevealedEmails] = useState<Record<number, boolean>>({});
  const [outreachSidebarOpen, setOutreachSidebarOpen] = useState(false);
  const PAGE_SIZE = 25;

  const { data: status, isLoading: statusLoading, isPolling } = useSourcingStatus(jobId);
  const { data: candidatesData, isLoading: candidatesLoading } = useSourcedCandidates(jobId);
  const { trigger: findCandidatesBase, isPending: findPending } = useFindCandidates(jobId);
  const { update: updateState, isPending: updatePending } = useUpdateCandidateState(jobId);
  const { findContact, isPending: contactLookupPending } = useFindContact();
  const { draftOutreach, isPending: draftingOutreach } = useDraftOutreach(jobId);
  const { sendOutreach, isPending: sendingOutreach } = useSendOutreach(jobId);
  const { data: outreachHistory } = useOutreachHistory(jobId);
  const { progress, modalOpen, openModal, closeModal } = useSourcingProgress(jobId);
  // const { enrichBatch, isPending: enrichPending } = useBatchEnrich(jobId);

  // Open the progress modal first, then trigger sourcing
  const findCandidates = (opts: Record<string, unknown>) => {
    if (!opts.refresh) {
      openModal();
    }
    findCandidatesBase(opts);
  };

  // Lock tier model per sourcing run to prevent UI instability during enrichment refreshes
  const [lockedTierModel, setLockedTierModel] = useState<TierModel | null>(null);
  const prevRequestIdRef = useRef<string | null>(null);
  const currentRequestId = status?.requestId ?? null;

  useEffect(() => {
    if (currentRequestId !== prevRequestIdRef.current) {
      prevRequestIdRef.current = currentRequestId;
      setLockedTierModel(null);
    }
  }, [currentRequestId]);

  // Also unlock the tier model whenever the underlying candidate list changes
  // so re-enrichment / re-rank updates are reflected immediately
  const prevCandidateCountRef = useRef<number>(-1);

  const allCandidates = candidatesData?.candidates ?? [];
  const counts = candidatesData?.counts ?? { total: 0, talentPool: 0, newlyDiscovered: 0 };
  const shortlistedCandidates = allCandidates.filter((candidate) => candidate.state === "shortlisted");
  const shortlistedWithResolvedEmail = shortlistedCandidates.filter((candidate) => candidate.emailResolveStatus === "resolved" && candidate.foundEmail);
  const shortlistCounts = {
    all: shortlistedCandidates.length,
    fresh: shortlistedCandidates.filter((candidate) => matchesShortlistOutreachFilter(candidate, "fresh")).length,
    first_sent: shortlistedCandidates.filter((candidate) => matchesShortlistOutreachFilter(candidate, "first_sent")).length,
    second_sent: shortlistedCandidates.filter((candidate) => matchesShortlistOutreachFilter(candidate, "second_sent")).length,
    completed: shortlistedCandidates.filter((candidate) => matchesShortlistOutreachFilter(candidate, "completed")).length,
  };
  const selectedCampaignRound: 1 | 2 | 3 | null =
    shortlistOutreachFilter === "fresh"
      ? 1
      : shortlistOutreachFilter === "first_sent"
        ? 2
        : shortlistOutreachFilter === "second_sent"
          ? 3
          : shortlistOutreachFilter === "all"
            ? (outreachHistory?.nextAvailableRound ?? null)
            : null;
  const outreachEligibleCandidateIds = selectedCampaignRound
    ? (
      outreachHistory?.eligibleByRound?.[selectedCampaignRound]?.candidateIds
      ?? shortlistedWithResolvedEmail
        .filter((candidate) => getCandidateOutreachCount(candidate) === selectedCampaignRound - 1)
        .map((candidate) => candidate.id)
    )
    : [];
  const outreachEligibleCandidates = shortlistedWithResolvedEmail.filter((candidate) =>
    outreachEligibleCandidateIds.includes(candidate.id),
  );
  const canStartOutreachCampaign = Boolean(selectedCampaignRound && outreachEligibleCandidates.length > 0);
  const outreachButtonLabel =
    selectedCampaignRound === 1
      ? "Start First Campaign"
      : selectedCampaignRound === 2
        ? "Start Second Campaign"
        : selectedCampaignRound === 3
          ? "Start Final Campaign"
          : "No Campaign Available";

  useEffect(() => {
    if (listMode !== "shortlisted") return;
    if (shortlistOutreachFilter !== "all" && shortlistCounts[shortlistOutreachFilter] > 0) return;

    if (shortlistCounts.fresh > 0) {
      setShortlistOutreachFilter("fresh");
      return;
    }
    if (shortlistCounts.first_sent > 0) {
      setShortlistOutreachFilter("first_sent");
      return;
    }
    if (shortlistCounts.second_sent > 0) {
      setShortlistOutreachFilter("second_sent");
      return;
    }
    if (shortlistCounts.completed > 0) {
      setShortlistOutreachFilter("completed");
      return;
    }
    setShortlistOutreachFilter("all");
  }, [
    listMode,
    shortlistOutreachFilter,
    shortlistCounts.completed,
    shortlistCounts.first_sent,
    shortlistCounts.fresh,
    shortlistCounts.second_sent,
  ]);

  useEffect(() => {
    const newCount = allCandidates.length;
    if (prevCandidateCountRef.current !== -1 && prevCandidateCountRef.current !== newCount) {
      setLockedTierModel(null);
    }
    prevCandidateCountRef.current = newCount;
  }, [allCandidates.length]);


  const filteredSortedBase = useMemo(
    () => sortCandidates(
      filterCandidates(
        allCandidates,
        listMode === "shortlisted"
          ? { ...filters, candidateState: "shortlisted" }
          : filters,
      ),
      sortBy,
    ),
    [allCandidates, filters, sortBy, listMode],
  );
  const filteredSorted = useMemo(
    () => (
      listMode === "shortlisted"
        ? filteredSortedBase.filter((candidate) => matchesShortlistOutreachFilter(candidate, shortlistOutreachFilter))
        : filteredSortedBase
    ),
    [filteredSortedBase, listMode, shortlistOutreachFilter],
  );

  const grouped = useMemo(
    () => splitByTier(filteredSorted, lockedTierModel ?? undefined),
    [filteredSorted, lockedTierModel],
  );

  // Lock on first non-empty load
  useEffect(() => {
    if (lockedTierModel === null && filteredSorted.length > 0) {
      setLockedTierModel(grouped.tierModel);
    }
  }, [filteredSorted.length, grouped.tierModel, lockedTierModel]);

  const bestMatches = grouped.bestMatches;
  const broaderPool = grouped.broaderPool;

  // Detect all-broader edge case: explicit tier data exists, but zero best matches
  const allBroader = grouped.tierModel === "explicit" && bestMatches.length === 0 && broaderPool.length > 0;

  // Pagination Logic
  const visibleCandidates = bestMatchesOnly && !allBroader ? bestMatches : [...bestMatches, ...broaderPool];
  const totalVisibleCount = visibleCandidates.length;
  const totalPages = Math.ceil(totalVisibleCount / PAGE_SIZE) || 1;
  const safePage = Math.min(Math.max(1, currentPage), totalPages);

  const startIndex = (safePage - 1) * PAGE_SIZE;
  const endIndex = startIndex + PAGE_SIZE;

  const currentVisibleCandidates = visibleCandidates.slice(startIndex, endIndex);
  const currentBestMatches = currentVisibleCandidates.filter(c => bestMatches.some(bm => bm.id === c.id));
  const currentBroaderPool = currentVisibleCandidates.filter(c => broaderPool.some(bp => bp.id === c.id));

  // Reset page to 1 when filters or data change fundamentally
  useEffect(() => {
    setCurrentPage(1);
  }, [filters, sortBy, bestMatchesOnly, lockedTierModel]);

  // Removed frontend lazy enrichment as this is now orchestrated by the backend

  // Auto-disable bestMatchesOnly when all candidates are broader pool
  useEffect(() => {
    if (allBroader && bestMatchesOnly) {
      setBestMatchesOnly(false);
      trackEvent("sourcing_all_broader_auto_expand", {
        location: "job_sourcing",
        job_id: jobId ?? 0,
        broader_count: broaderPool.length,
        tier_model: grouped.tierModel,
        all_broader_mode: true,
      });
    }
  }, [allBroader]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleBestMatchesOnlyChange = (checked: boolean) => {
    setBestMatchesOnly(checked);
    trackEvent("sourcing_best_matches_only_toggled", {
      location: "job_sourcing",
      job_id: jobId ?? 0,
      enabled: checked,
      has_broader_pool: broaderPool.length > 0,
      tier_model: grouped.tierModel,
      total_candidates: counts.total,
      all_broader_mode: allBroader,
    });
  };

  const requestedLocation = candidatesData?.requestedLocation || filters.location || null;
  const expansionReason = candidatesData?.expansionReason;
  const expansionReasonText = getExpansionReasonText(expansionReason, requestedLocation);
  const strictRescueApplied = candidatesData?.groupCounts?.strictRescueApplied === true;
  const strictRescuedCount = candidatesData?.groupCounts?.strictRescuedCount ?? 0;
  const rescueFloor = candidatesData?.groupCounts?.strictRescueMinFitScoreUsed;
  const qualityDebug = candidatesData?.qualityDebug;

  const liveSelected = selectedCandidate
    ? allCandidates.find((c) => c.id === selectedCandidate.id) ?? selectedCandidate
    : null;

  const hasRun = status?.hasRun ?? false;
  const runStatus = status?.status;
  // const enrichment = status?.enrichment;
  // const enrichmentInProgress = enrichment?.inProgress === true;
  const isSourcingActive = hasRun && !["completed", "failed", "expired"].includes(runStatus ?? "");
  const isRunning = isSourcingActive/*  || enrichmentInProgress */;
  const isFailed = runStatus === "failed";
  const isExpired = runStatus === "expired";
  const isCompleted = runStatus === "completed";

  const kpis = candidatesData?.kpis;

  // GA4 supplementary event for first_engagement_ready_seen (server A7 is source of truth)
  const trackedRef = useRef(false);
  useEffect(() => {
    if (!trackedRef.current && isCompleted && kpis?.firstQualifiedCandidateRank != null) {
      trackedRef.current = true;
      trackEvent("first_engagement_ready_seen", {
        job_id: jobId ?? 0,
        first_qualified_rank: kpis.firstQualifiedCandidateRank,
        total_candidates: counts.total,
        engagement_ready_count: kpis.engagementReadyCount,
      });
    }
  }, [isCompleted, kpis?.firstQualifiedCandidateRank]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCardClick = (c: SourcedCandidateForUI) => {
    trackEvent("candidate_viewed", {
      job_id: jobId ?? 0,
      candidate_id: c.id,
      signal_rank: c.signalRank ?? 0,
      fit_score: c.fitScore ?? 0,
      engagement_ready: c.engagementReady ?? false,
    });
    setSelectedCandidate(c);
    setDrawerOpen(true);
  };

  const handleShortlistToggle = (c: SourcedCandidateForUI) => {
    updateState({
      candidateId: c.id,
      state: c.state === "shortlisted" ? "new" : "shortlisted",
      candidateSnapshot: c,
    });
  };

  // Compute sequential display positions across ALL visible candidates
  // (best matches first, then broader pool) so #1 is always the first rendered card.
  const displayPositionMap = useMemo(() => {
    const map = new Map<number, number>();
    let pos = 1;
    const sections = allBroader ? [broaderPool] : [bestMatches, ...(!bestMatchesOnly && showBroader ? [broaderPool] : [])];
    for (const section of sections) {
      for (const c of section) {
        map.set(c.id, pos++);
      }
    }
    return map;
  }, [bestMatches, broaderPool, allBroader, bestMatchesOnly, showBroader]);

  const renderList = (candidates: SourcedCandidateForUI[]) => {
    if (candidatesLoading) {
      return <SourcingListSkeleton />;
    }

    if (candidates.length === 0) {
      return <p className="text-sm text-muted-foreground text-center py-8">No candidates match your current filters.</p>;
    }

    return (
      <div className="space-y-3">
        {candidates.map((c) => {
          const pos = displayPositionMap.get(c.id);
          return (
            <CandidateCard
              key={c.id}
              candidate={c}
              onClick={() => handleCardClick(c)}
              onShortlist={() => handleShortlistToggle(c)}
              isUpdating={updatePending}
              shortlistMode={listMode === "shortlisted"}
              emailRevealed={Boolean(revealedEmails[c.id])}
              onToggleRevealEmail={() =>
                setRevealedEmails((current) => ({ ...current, [c.id]: !current[c.id] }))
              }
              onRetryEmailLookup={() => {
                if (!jobId) return;
                findContact({ candidateId: c.id, jobId });
              }}
              isRetryingEmail={contactLookupPending}
              {...(pos != null ? { displayPosition: pos } : {})}
            />
          );
        })}
      </div>
    );
  };

  return (
    <Layout>
      <JobSubNav jobId={jobId ?? 0} />

      <div className="container mx-auto px-4 py-6 max-w-6xl">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold">{jobSourcingPageCopy.header.title}</h1>
            </div>
            {isPolling && (
              <div className="flex items-center gap-2 mt-1">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                <span className="text-sm text-muted-foreground">
                  {isSourcingActive
                    ? jobSourcingPageCopy.header.searching
                    : jobSourcingPageCopy.header.enriching}
                  {isSourcingActive && status?.candidateCount != null && status.candidateCount > 0 && (
                    <> ({status.candidateCount} found so far)</>
                  )}
                  {/* {!isSourcingActive && (
                    <> ({enrichment?.enrichedCount ?? 0}/{enrichment?.totalCandidates ?? 0} enriched)</>
                  )} */}
                </span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => findCandidates({ forceSourcing: true })}
              disabled={findPending || isRunning}
              size="sm"
              variant={hasRun ? "outline" : "default"}
            >
              {findPending || isRunning ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <Search className="h-4 w-4 mr-1.5" />
              )}
              {isRunning ? "Running..." : hasRun ? "Find Candidates Again" : "Find Candidates"}
            </Button>
          </div>
        </div>

        {isRunning && (
          <Progress
            value={isSourcingActive ? undefined : /* enrichment?.percent */ 0}
            className="h-1.5 mb-4"
          />
        )}

        <div className="mb-4 flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <ToggleGroup
                type="single"
                value={listMode}
                onValueChange={(value) => {
                  if (value === "all" || value === "shortlisted") {
                    setListMode(value);
                  }
                }}
              >
                <ToggleGroupItem value="all" aria-label="Show all candidates">
                  All candidates
                </ToggleGroupItem>
                <ToggleGroupItem value="shortlisted" aria-label="Show shortlisted candidates">
                  Shortlisted ({shortlistedCandidates.length})
                </ToggleGroupItem>
              </ToggleGroup>
              {listMode === "shortlisted" && (
                <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                  {outreachEligibleCandidates.length} ready for outreach
                </Badge>
              )}
            </div>
            {listMode === "shortlisted" && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Filter shortlisted candidates by outreach stage, then launch the matching campaign for that cohort.
                </p>
                <ToggleGroup
                  type="single"
                  value={shortlistOutreachFilter}
                  onValueChange={(value) => {
                    if (
                      value === "all"
                      || value === "fresh"
                      || value === "first_sent"
                      || value === "second_sent"
                      || value === "completed"
                    ) {
                      setShortlistOutreachFilter(value);
                    }
                  }}
                >
                  <ToggleGroupItem value="all" aria-label="Show all shortlisted candidates">
                    All ({shortlistCounts.all})
                  </ToggleGroupItem>
                  <ToggleGroupItem value="fresh" aria-label="Show fresh shortlisted candidates">
                    Fresh ({shortlistCounts.fresh})
                  </ToggleGroupItem>
                  <ToggleGroupItem value="first_sent" aria-label="Show candidates after first campaign">
                    First sent ({shortlistCounts.first_sent})
                  </ToggleGroupItem>
                  <ToggleGroupItem value="second_sent" aria-label="Show candidates after second campaign">
                    Second sent ({shortlistCounts.second_sent})
                  </ToggleGroupItem>
                  <ToggleGroupItem value="completed" aria-label="Show candidates who already got final outreach">
                    Third sent ({shortlistCounts.completed})
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
            )}
          </div>

          {listMode === "shortlisted" && (
            <Button
              disabled={!canStartOutreachCampaign}
              onClick={() => setOutreachSidebarOpen(true)}
            >
              <Mail className="mr-1.5 h-4 w-4" />
              {outreachButtonLabel}
            </Button>
          )}
        </div>

        {/* {!isFailed && !isExpired && enrichmentInProgress && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30 p-3 mb-4">
            <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
              We are still enriching candidate profiles in the background.
            </p>
            <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
              {enrichment?.enrichedCount ?? 0} of {enrichment?.totalCandidates ?? 0} profiles enriched so far. This list updates automatically.
            </p>
          </div>
        )} */}

        {isFailed && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 mb-4 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-destructive">Sourcing failed</p>
              {status?.errorMessage && <p className="text-xs text-muted-foreground mt-0.5">{status.errorMessage}</p>}
            </div>
            <Button variant="outline" size="sm" onClick={() => findCandidates({})} disabled={findPending}>
              Retry
            </Button>
          </div>
        )}

        {isExpired && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-4 mb-4 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200">Sourcing run expired</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                The search timed out. This can happen if results take longer than expected.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => findCandidates({})} disabled={findPending}>
              Retry
            </Button>
          </div>
        )}

        {!hasRun && !statusLoading && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="rounded-full bg-primary/10 p-4 mb-4">
              <Sparkles className="h-8 w-8 text-primary" />
            </div>
            <h2 className="text-lg font-semibold mb-2">{jobSourcingPageCopy.emptyState.title}</h2>
            <p className="text-sm text-muted-foreground mb-6 max-w-md">
              We will prioritize the strongest matches first and clearly separate broader results when location or fit constraints are expanded.
            </p>
            <Button onClick={() => findCandidates({})} disabled={findPending}>
              {findPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Search className="h-4 w-4 mr-1.5" />}
              Find Candidates
            </Button>
          </div>
        )}

        {isCompleted && counts.total === 0 && !candidatesLoading && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-sm text-muted-foreground mb-4">No matching candidates found for this role.</p>
            <Button variant="outline" size="sm" onClick={() => findCandidates({})} disabled={findPending}>
              Retry
            </Button>
          </div>
        )}

        {(counts.total > 0 || candidatesLoading) && (
          <>
            <div className={`grid grid-cols-1 ${grouped.tierModel !== "fallback" && !allBroader ? "sm:grid-cols-3" : "sm:grid-cols-1"} gap-3 mb-4`}>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">
                    {allBroader ? "Wider Search Results" : "Total"}
                  </p>
                  <p className="text-base font-semibold">{counts.total}</p>
                </CardContent>
              </Card>
              {grouped.tierModel !== "fallback" && !allBroader && (
                <>
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-xs text-muted-foreground">Top Matches</p>
                      <p className="text-base font-semibold">{bestMatches.length}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-xs text-muted-foreground">Wider Search</p>
                      <p className="text-base font-semibold">{broaderPool.length}</p>
                    </CardContent>
                  </Card>
                </>
              )}
            </div>

            {(qualityDebug || kpis) && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/40 p-3 mb-4">
                <p className="text-xs font-medium text-slate-800 dark:text-slate-200">
                  Search Quality
                </p>
                <div className="text-xs text-slate-700 dark:text-slate-300 mt-1 flex flex-wrap gap-x-4 gap-y-1">
                  {qualityDebug && <span>Location confirmed: {qualityDebug.locationMatchedPct}%</span>}
                  {qualityDebug && <span>Location data available: {qualityDebug.validLocationHintPct}%</span>}
                  {qualityDebug && <span>Skills matched: {qualityDebug.nonZeroSkillScorePct}%</span>}
                  {kpis?.firstQualifiedCandidateRank != null && (
                    <span>First ready candidate: #{kpis.firstQualifiedCandidateRank}</span>
                  )}
                  {kpis?.engagementReadyCount != null && kpis.engagementReadyCount > 0 && (
                    <span>Ready to engage: {kpis.engagementReadyCount}</span>
                  )}
                </div>
              </div>
            )}

            {strictRescueApplied && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-3 mb-4">
                <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
                  We found limited exact matches, so we're showing the best available candidates in the requested region.
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                  Kept {strictRescuedCount} candidates that partially match location
                  {typeof rescueFloor === "number" ? ` using a temporary fit floor of ${rescueFloor.toFixed(2)}.` : "."}
                </p>
              </div>
            )}

            {allBroader && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30 p-3 mb-4">
                <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
                  {requestedLocation
                    ? `We couldn't find enough strong matches in ${requestedLocation}. Showing broader matches.`
                    : "We couldn't find enough strong direct matches. Showing broader matches."}
                </p>
                {expansionReasonText && (
                  <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                    Why this happened: {expansionReasonText}
                  </p>
                )}
                {strictRescueApplied && (
                  <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                    Strict rescue was used before expansion to keep the best in-country options.
                  </p>
                )}
              </div>
            )}

            {!allBroader && !bestMatchesOnly && broaderPool.length > 0 && (
              <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 mb-4">
                <p className="text-sm text-warning-foreground font-medium">
                  {requestedLocation
                    ? `Found ${bestMatches.length} strong matches in ${requestedLocation}. Also showing ${broaderPool.length} broader matches.`
                    : `Showing ${broaderPool.length} broader matches in addition to best matches.`}
                </p>
                {(expansionReasonText || grouped.tierModel !== "fallback") && (
                  <p className="text-xs text-warning-foreground/80 mt-1">
                    Why this happened: {expansionReasonText || "We expanded the search to include additional relevant profiles."}
                  </p>
                )}
              </div>
            )}

            <div className="mb-4">
              <SourcingFilters
                filters={filters}
                onChange={setFilters}
                sortBy={sortBy}
                onSortChange={(s) => setSortBy(s as SortKey)}
                resultCount={visibleCandidates.length}
                totalCount={counts.total}
                bestMatchesOnly={bestMatchesOnly}
                onBestMatchesOnlyChange={handleBestMatchesOnlyChange}
                hasTierData={grouped.tierModel !== "fallback"}
                allBroader={allBroader}
              />
            </div>

            <div className="space-y-6">
              {allBroader ? (
                <section>
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="text-sm font-medium text-muted-foreground">
                      {requestedLocation ? `Additional Candidates near ${requestedLocation}` : "Wider Search Results"}
                    </h2>
                    <Badge variant="secondary">{currentBroaderPool.length}</Badge>
                  </div>
                  {renderList(currentBroaderPool)}
                </section>
              ) : (
                <>
                  {currentBestMatches.length > 0 && (
                    <section>
                      <div className="flex items-center justify-between mb-2">
                        <h2 className="text-sm font-medium text-muted-foreground">
                          {grouped.tierModel === "fallback"
                            ? "Candidates"
                            : requestedLocation ? `Top Matches in ${requestedLocation}` : "Top Matches"}
                        </h2>
                        <Badge variant="secondary">{currentBestMatches.length}</Badge>
                      </div>
                      {renderList(currentBestMatches)}
                    </section>
                  )}

                  {!bestMatchesOnly && currentBroaderPool.length > 0 && (
                    <section className={currentBestMatches.length > 0 ? "pt-6 border-t border-border/50" : ""}>
                      <button
                        type="button"
                        className="flex items-center gap-2 mb-2 text-sm font-medium text-muted-foreground"
                        onClick={() => setShowBroader((v) => !v)}
                      >
                        {showBroader ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        Wider Search Results ({broaderPool.length})
                      </button>
                      {showBroader && renderList(currentBroaderPool)}
                    </section>
                  )}
                </>
              )}
            </div>

            {totalPages > 1 && (
              <div className="mt-8 mb-4">
                <Pagination>
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        href="#"
                        onClick={(e) => { e.preventDefault(); setCurrentPage(p => Math.max(1, p - 1)); }}
                        className={safePage === 1 ? "pointer-events-none opacity-50" : ""}
                      />
                    </PaginationItem>

                    <PaginationItem>
                      <span className="text-sm px-4 text-muted-foreground">Page {safePage} of {totalPages}</span>
                    </PaginationItem>

                    <PaginationItem>
                      <PaginationNext
                        href="#"
                        onClick={(e) => { e.preventDefault(); setCurrentPage(p => Math.min(totalPages, p + 1)); }}
                        className={safePage === totalPages ? "pointer-events-none opacity-50" : ""}
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              </div>
            )}
          </>
        )}
      </div>

      <CandidateDrawer
        candidate={liveSelected}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onUpdateState={(candidateId, state) => updateState({ candidateId, state })}
        isUpdating={updatePending}
      />

      <ColdOutreachSidebar
        open={outreachSidebarOpen}
        onOpenChange={setOutreachSidebarOpen}
        candidates={shortlistedWithResolvedEmail}
        campaignRound={selectedCampaignRound ?? 1}
        {...(outreachHistory ? { history: outreachHistory } : {})}
        onDraft={draftOutreach}
        onSend={sendOutreach}
        isDrafting={draftingOutreach}
        isSending={sendingOutreach}
      />

      <SourcingProgressModal
        open={modalOpen}
        progress={progress}
        onClose={closeModal}
      />
    </Layout>
  );
}
