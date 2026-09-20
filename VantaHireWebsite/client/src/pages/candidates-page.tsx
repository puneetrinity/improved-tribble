import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Redirect, useLocation } from "wouter";
import {
  Search,
  Mail,
  Briefcase,
  Sparkles,
  FileText,
  Download,
  ExternalLink,
  ArrowRightLeft,
  Loader2,
  AlertCircle,
  Info,
  CheckCircle2,
  RefreshCw,
  AlertTriangle,
  History,
  Clock,
  XCircle,
  Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { MoveCandidateToJobDialog } from "@/components/recruiter/MoveCandidateToJobDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { talentSearchPageCopy } from "@/lib/internal-copy";
import {
  InternalEmptyState,
  InternalHero,
  InternalPageShell,
  InternalPanel,
  InternalSectionHeader,
} from "@/components/internal";

// ── Wave 4D private index adoption (reserved UI path) ─────────────────────────────────────────────────────────────
export type IndexState = "legacy" | "ready" | "updating" | "refresh_failed";
export type IndexCountKey = "ready" | "updating" | "refresh_failed" | "pending" | "needs_review" | "failed";
export interface IndexProcessing { counts: Record<IndexCountKey, number>; bounded: boolean; limit: number }
export type IndexReranker = "not_requested" | "not_needed" | "applied" | "fallback";

interface SemanticResult {
  applicationId: number;
  name: string;
  email: string | null;
  phone: string | null;
  currentJobId: number | null;
  currentJobTitle: string | null;
  currentStageId: number | null;
  currentStageName: string | null;
  rankingScoreRaw?: number;
  matchScoreRaw?: number;
  matchScore: number;
  matchedChunks: number;
  highlights: string[];
  resume: {
    resumeFilename: string | null;
    previewUrl?: string | null;
    signedUrl: string | null;
    expiresAt: string | null;
  };
  source?: string | null;
  isExternal?: boolean;
  canMoveToJob?: boolean;
  canOpenResume?: boolean;
  indexState?: IndexState;
  indexGeneration?: number | null;
  sourceObservedAt?: string | null;
}

interface SemanticSearchResponse {
  query: string;
  count: number;
  scoreType?: "rrf_fused" | "weighted_fusion" | "cosine" | "cross_encoder" | "unknown";
  displayScoreType?: "rrf_fused" | "weighted_fusion" | "cosine" | "cross_encoder" | "unknown";
  scoreDiagnostics?: {
    topRawScore: number | null;
    bottomRawScore: number | null;
    spreadRawScore: number | null;
    rankingTopRawScore: number | null;
    rankingBottomRawScore: number | null;
    rankingSpreadRawScore: number | null;
    resultCount: number;
  };
  results: SemanticResult[];
  candidates: SemanticResult[];
  indexProcessing?: IndexProcessing;
  indexReranker?: IndexReranker;
  indexSaturated?: boolean;
}

// Copy for the index states lives here because the shared copy module is outside the Wave 4D UI allowance.
// Every string states what is true now; none claims that every applicant is indexed or that matching is complete.
export const indexCopy = {
  states: {
    ready: { label: "Indexed", helper: "searchable from this resume" },
    updating: { label: "Updating", helper: "a newer resume is being processed" },
    refresh_failed: { label: "Refresh failed", helper: "the newer resume could not be processed" },
    legacy: { label: "Legacy match", helper: "from the previous search index" },
  },
  counts: {
    ready: "indexed", updating: "updating", refresh_failed: "refresh failed", pending: "pending",
    needs_review: "needs review", failed: "failed",
  },
  processingTitle: "Index status for your applicants",
  notAllSearchable: "Some applicants are still being processed and are not searchable yet.",
  bounded: "Counts are capped at 1,000.",
  saturated: "Results may be incomplete. Refine your search or try again.",
  rerankFallback: "Reranking was unavailable for this search. Results are ordered by retrieval.",
  rerankApplied: "Ordered by the reranker. The percentage is resume similarity.",
  unavailable: "Search is temporarily unavailable. Try again.",
  unsupportedFilter: "This search used a filter that is not supported.",
  filterConflict: "Those filters conflict with each other. Remove one and search again.",
  queryTooLong: "That search is too long. Shorten it and try again.",
  privacyReconciling: "Privacy settings are being updated. Try again in a moment.",
  failed: "Search failed. Try again.",
} as const;

export function formatObservedDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function indexStateBadge(
  result: Pick<SemanticResult, "indexState" | "indexGeneration" | "sourceObservedAt">,
): { state: IndexState; label: string; detail: string | null; helper: string } | null {
  const state = result.indexState;
  if (!state) return null;
  const copy = indexCopy.states[state];
  if (state === "legacy") return { state, label: copy.label, detail: null, helper: copy.helper };
  const version = typeof result.indexGeneration === "number" ? `v${result.indexGeneration}` : null;
  const observed = formatObservedDate(result.sourceObservedAt);
  const parts = [version, observed].filter((value): value is string => Boolean(value));
  const detail = parts.length === 0 ? null : (state === "ready" ? parts.join(" · ") : `showing ${parts.join(" · ")}`);
  return { state, label: copy.label, detail, helper: copy.helper };
}

const INDEX_COUNT_ORDER: IndexCountKey[] = ["ready", "updating", "refresh_failed", "pending", "needs_review", "failed"];
export function processingSummary(processing: IndexProcessing | undefined):
  { rows: { key: IndexCountKey; label: string; count: number }[]; notAllSearchable: boolean } | null {
  if (!processing) return null;
  const rows = INDEX_COUNT_ORDER.filter(key => processing.counts[key] > 0)
    .map(key => ({ key, label: indexCopy.counts[key], count: processing.counts[key] }));
  const notAllSearchable = processing.counts.pending + processing.counts.needs_review + processing.counts.failed > 0;
  return { rows, notAllSearchable };
}

export function searchErrorCopy(message: string | undefined): string {
  // Closed copy only: every closed code the server can answer with maps to a sentence, and anything else (raw
  // JSON, vendor/transport text, legacy-mode error bodies) collapses to one closed fallback. No server text is echoed.
  if (message?.includes("candidate_index_search_unavailable")) return indexCopy.unavailable;
  if (message?.includes("candidate_index_filter_unsupported")) return indexCopy.unsupportedFilter;
  if (message?.includes("candidate_index_filter_conflict")) return indexCopy.filterConflict;
  if (message?.includes("candidate_index_query_too_long")) return indexCopy.queryTooLong;
  if (message?.includes("candidate_privacy_reconciliation_required")) return indexCopy.privacyReconciling;
  return indexCopy.failed;
}

const STATE_ICONS = { ready: CheckCircle2, updating: RefreshCw, refresh_failed: AlertTriangle, legacy: History } as const;
const STATE_ICON_CLASS = { ready: "text-[#15803D]", updating: "text-[#4B8EF0]", refresh_failed: "text-[#B45309]", legacy: "text-[#5F6675]" } as const;
const COUNT_ICONS = { ready: CheckCircle2, updating: RefreshCw, refresh_failed: AlertTriangle, pending: Clock, needs_review: Eye, failed: XCircle } as const;

function IndexStateBadge({ result }: { result: SemanticResult }) {
  const badge = indexStateBadge(result);
  if (!badge) return null;
  const Icon = STATE_ICONS[badge.state];
  return (
    <Badge
      variant="outline"
      data-testid="index-state"
      data-state={badge.state}
      title={badge.helper}
      className="inline-flex max-w-full shrink-0 items-center gap-1 rounded-full font-dm text-xs font-medium text-[#1F2937]"
    >
      <Icon aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 ${STATE_ICON_CLASS[badge.state]}`} />
      <span className="break-words">{badge.label}{badge.detail ? <span className="text-[#5F6675]"> · {badge.detail}</span> : null}</span>
      <span className="sr-only">. {badge.helper}</span>
    </Badge>
  );
}

function IndexProcessingSummary({ processing, saturated }: { processing: IndexProcessing | undefined; saturated?: boolean }) {
  const summary = processingSummary(processing);
  if (!summary) return null;
  return (
    <div
      data-testid="index-processing"
      role="status"
      className="min-w-0 rounded-[16px] border border-[#EEF0F4] bg-[#F8F8FA] px-3 py-2"
    >
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[#5F6675]">{indexCopy.processingTitle}</p>
      {summary.rows.length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 font-dm text-sm text-[#5F6675]">
          {summary.rows.map(row => {
            const Icon = COUNT_ICONS[row.key];
            return (
              <li key={row.key} className="inline-flex items-center gap-1">
                <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[#5F6675]" />
                <span>{row.count} {row.label}</span>
              </li>
            );
          })}
        </ul>
      )}
      {(summary.notAllSearchable || processing?.bounded || saturated) && (
        <p className="mt-1 font-dm text-xs text-[#5F6675]">
          {[summary.notAllSearchable ? indexCopy.notAllSearchable : null, processing?.bounded ? indexCopy.bounded : null,
            saturated ? indexCopy.saturated : null].filter(Boolean).join(" ")}
        </p>
      )}
    </div>
  );
}

export default function CandidatesPage() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();

  // ── Semantic Search state ───────────────────────────────────────
  const [semanticQuery, setSemanticQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [moveCandidate, setMoveCandidate] = useState<SemanticResult | null>(null);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [resumePreviewCandidate, setResumePreviewCandidate] = useState<SemanticResult | null>(null);

  if (!user || !['recruiter', 'super_admin'].includes(user.role)) {
    return <Redirect to="/recruiter-auth" />;
  }

  // ── Semantic Search query ───────────────────────────────────────
  const semanticSearchQuery = useQuery<SemanticSearchResponse, Error>({
    queryKey: ["/api/candidates/semantic-search", user.id, user.role, submittedQuery],
    enabled: submittedQuery.trim().length > 0,
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/candidates/semantic-search", {
        query: submittedQuery,
        top_k: 10,
        use_reranker: true,
      });
      return res.json();
    },
  });

  const handleSemanticSearch = () => {
    const q = semanticQuery.trim();
    if (!q) return;
    if (q === submittedQuery) {
      void semanticSearchQuery.refetch();
      return;
    }
    setSubmittedQuery(q);
  };

  const handleOpenResume = (result: SemanticResult) => {
    setResumePreviewCandidate(result);
  };

  const handleMoveClick = (result: SemanticResult) => {
    setMoveCandidate(result);
    setMoveDialogOpen(true);
  };

  const handleMoveSuccess = () => {
    const q = submittedQuery.trim();
    if (!q) return;
    void semanticSearchQuery.refetch();
  };

  const semanticResults = semanticSearchQuery.data?.results ?? [];
  const semanticScoreType = semanticSearchQuery.data?.scoreType ?? "unknown";
  const semanticDisplayScoreType = semanticSearchQuery.data?.displayScoreType ?? semanticScoreType;
  const semanticScoreIsPercent = semanticDisplayScoreType === "cosine" || semanticDisplayScoreType === "weighted_fusion";
  const resumePreviewUrl = resumePreviewCandidate && !resumePreviewCandidate.isExternal
    ? `/api/applications/${resumePreviewCandidate.applicationId}/resume`
    : null;
  const resumeDownloadUrl = resumePreviewCandidate && !resumePreviewCandidate.isExternal
    ? `/api/applications/${resumePreviewCandidate.applicationId}/resume?download=1`
    : null;
  const resumeNameForType = (
    resumePreviewCandidate?.resume.resumeFilename ||
    resumePreviewUrl ||
    ""
  ).toLowerCase();
  const previewIsPdf = resumeNameForType.endsWith(".pdf") || resumeNameForType.includes(".pdf");
  const previewDisplayFilename =
    resumePreviewCandidate?.resume.resumeFilename ||
    "resume.pdf";
  const cleanDisplayFilename = previewDisplayFilename.split("?")[0] || "resume.pdf";

  const hasSubmittedSearch = submittedQuery.trim().length > 0;
  const resultCount = semanticSearchQuery.data?.count ?? semanticResults.length;

  return (
    <InternalPageShell>
      <InternalHero
        eyebrow="Your talent pool"
        tone="green"
        title={talentSearchPageCopy.header.title}
        subtitle={talentSearchPageCopy.header.subtitle}
        icon={Sparkles}
        badge="Compounds with every search"
        stats={[
          {
            label: "Search Mode",
            value: "Semantic",
            helper: "Keyword + meaning aware",
          },
          {
            label: "Result Window",
            value: "Top 10",
            helper: "Ranked candidate matches",
          },
          {
            label: "Last Result",
            value: hasSubmittedSearch && semanticSearchQuery.isSuccess ? resultCount : "Ready",
            helper: hasSubmittedSearch ? `For "${submittedQuery}"` : "Describe the ideal profile",
            accentClassName: semanticSearchQuery.isSuccess ? "text-[#4B8EF0]" : undefined,
          },
        ]}
      />

      <InternalPanel className="p-4 sm:p-5" data-tour="talent-search-input">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="min-w-0 flex-1">
            <div className="relative">
              <Sparkles className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#5F6675]" />
              <Input
                placeholder={talentSearchPageCopy.search.placeholder}
                value={semanticQuery}
                onChange={(e) => setSemanticQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSemanticSearch();
                }}
                className="h-11 rounded-2xl border-[#E5E7EB] bg-[#FAFAFB] pl-10 font-outfit text-sm text-[#111827] shadow-[0_3px_10px_rgba(15,23,42,0.04)] placeholder:text-[#9CA3AF]"
              />
            </div>
          </div>
          <Button
            onClick={handleSemanticSearch}
            disabled={!semanticQuery.trim() || semanticSearchQuery.isFetching}
            className="h-11 rounded-2xl bg-[#2F6EDB] px-5 text-[0.875rem] font-semibold text-white shadow-[0_10px_22px_rgba(75,142,240,0.22)] hover:bg-[#245CBE]"
          >
            {semanticSearchQuery.isFetching ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Search className="mr-2 h-4 w-4" />
            )}
            {talentSearchPageCopy.search.buttonLabel}
          </Button>
        </div>

        {submittedQuery && semanticSearchQuery.isSuccess && (
          <div className="mt-2 space-y-1 rounded-[14px] border border-[#EEF0F4] bg-[#F8F8FA] px-4 py-2.5">
            <p className="font-dm text-sm text-[#687182]">
              {semanticResults.length} result{semanticResults.length !== 1 ? "s" : ""} for "{submittedQuery}"
            </p>
            {semanticScoreType === "rrf_fused" && semanticDisplayScoreType === "cosine" && (
              <p className="font-dm text-xs text-[#5F6675]">
                {talentSearchPageCopy.search.hybridScoreHint}
              </p>
            )}
            {semanticSearchQuery.data?.indexReranker === "fallback" && (
              <p className="font-dm text-xs text-[#5F6675]" data-testid="index-rerank-note">{indexCopy.rerankFallback}</p>
            )}
            {semanticSearchQuery.data?.indexReranker === "applied" && semanticScoreType === "cross_encoder" && (
              <p className="font-dm text-xs text-[#5F6675]" data-testid="index-rerank-note">{indexCopy.rerankApplied}</p>
            )}
          </div>
        )}
      </InternalPanel>

      {semanticSearchQuery.isFetching && (
        <InternalPanel>
          <InternalEmptyState
            icon={Loader2}
            title={talentSearchPageCopy.search.searchingLabel}
            description="Scanning reusable candidate evidence and matching resumes against your query."
            className="[&_svg]:animate-spin"
          />
        </InternalPanel>
      )}

      {semanticSearchQuery.isError && (
        <InternalPanel data-testid="search-error">
          <InternalEmptyState
            icon={AlertCircle}
            title={talentSearchPageCopy.search.errorFallback}
            description={searchErrorCopy(semanticSearchQuery.error?.message)}
          />
        </InternalPanel>
      )}

      {semanticSearchQuery.isSuccess && semanticResults.length === 0 && (
        <InternalPanel data-testid="search-empty" className="space-y-3">
          <InternalEmptyState
            icon={Search}
            title={talentSearchPageCopy.search.noResultsTitle}
            description={talentSearchPageCopy.search.noResultsHint}
          />
          <IndexProcessingSummary processing={semanticSearchQuery.data?.indexProcessing} saturated={semanticSearchQuery.data?.indexSaturated === true} />
        </InternalPanel>
      )}

      {semanticSearchQuery.isSuccess && semanticResults.length > 0 && (
        <section className="space-y-4" data-tour="talent-search-results" data-testid="search-results">
          <InternalSectionHeader
            title="Matching Candidates"
            description="Ranked by candidate evidence, resume meaning, and reusable talent intelligence from Memory."
            actions={
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex cursor-help items-center gap-1 rounded-full border border-[#E7E9F0] bg-white px-3 py-1.5 font-dm text-xs font-semibold text-[#687182] shadow-[0_8px_18px_rgba(15,23,42,0.04)]">
                      <Info className="h-3.5 w-3.5" />
                      Ranking logic
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-xs">
                    {talentSearchPageCopy.search.rankingTooltip}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            }
          />

          <p className="flex items-center gap-1 font-dm text-xs text-[#5F6675]">
            {talentSearchPageCopy.search.rankingHint}
          </p>

          <IndexProcessingSummary
            processing={semanticSearchQuery.data?.indexProcessing}
            saturated={semanticSearchQuery.data?.indexSaturated === true}
          />

          <div className="space-y-3">
            {semanticResults.map((result) => (
              <InternalPanel key={result.applicationId} className="p-4 transition-all hover:-translate-y-0.5 hover:shadow-[0_18px_45px_rgba(15,23,42,0.08)]" data-tour="talent-search-result-card">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-3">
                      <h3 className="truncate font-satoshi text-lg font-bold tracking-[-0.02em] text-[#111827]">
                        {result.name}
                      </h3>
                      <Badge
                        variant={semanticScoreIsPercent
                          ? (result.matchScore >= 80 ? "default" : result.matchScore >= 50 ? "secondary" : "outline")
                          : "outline"}
                        className="shrink-0 rounded-full font-mono text-xs"
                      >
                        {semanticScoreIsPercent
                          ? `${result.matchScore}% match`
                          : `Relevance ${(result.matchScoreRaw ?? (result.matchScore / 100)).toFixed(4)}`}
                      </Badge>
                      <IndexStateBadge result={result} />
                    </div>

                    <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-dm text-sm text-[#687182]">
                      <span className="flex items-center gap-1">
                        <Mail className="h-3.5 w-3.5" />
                        {result.email ?? talentSearchPageCopy.search.emailUnavailable}
                      </span>
                      {result.source && (
                        <Badge variant="secondary" className="rounded-full text-xs">
                          {result.source}
                        </Badge>
                      )}
                      {result.matchedChunks > 0 && (
                        <span className="text-xs text-[#5F6675]">
                          {result.matchedChunks} {result.matchedChunks > 1 ? talentSearchPageCopy.search.matchingResumeSectionsSuffixPlural : talentSearchPageCopy.search.matchingResumeSectionsSuffixSingle}
                        </span>
                      )}
                      {result.currentJobTitle && (
                        <span className="flex items-center gap-1">
                          <Briefcase className="h-3.5 w-3.5" />
                          {result.currentJobTitle}
                        </span>
                      )}
                      {result.currentStageName && (
                        <Badge variant="outline" className="rounded-full text-xs">
                          {result.currentStageName}
                        </Badge>
                      )}
                    </div>

                    {result.highlights && result.highlights.length > 0 && (
                      <div className="mt-3 space-y-2">
                        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[#5F6675]">
                          {talentSearchPageCopy.search.whyMatched}
                        </p>
                        {result.highlights.slice(0, 3).map((highlight: string, idx: number) => (
                          <div
                            key={idx}
                            className="rounded-[16px] border border-[#EEF0F4] bg-[#F8F8FA] px-3 py-2 font-outfit text-sm leading-relaxed text-[#5F6675]"
                          >
                            {highlight}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-row gap-2 lg:flex-col">
                    {(result.canOpenResume ?? Boolean(result.resume.resumeFilename || result.resume.signedUrl)) && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleOpenResume(result)}
                        className="min-h-11 rounded-2xl border-[#D9DDEA] bg-white font-semibold text-[#1F2937] shadow-[0_8px_18px_rgba(15,23,42,0.05)] hover:bg-[#F7F8FC]"
                      >
                        <FileText className="mr-1 h-4 w-4" />
                        {talentSearchPageCopy.search.resume}
                      </Button>
                    )}
                    {result.canMoveToJob !== false && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleMoveClick(result)}
                        className="min-h-11 rounded-2xl border-[#D9DDEA] bg-white font-semibold text-[#1F2937] shadow-[0_8px_18px_rgba(15,23,42,0.05)] hover:bg-[#F7F8FC]"
                      >
                        <ArrowRightLeft className="mr-1 h-4 w-4" />
                        {talentSearchPageCopy.search.addToJob}
                      </Button>
                    )}
                  </div>
                </div>
              </InternalPanel>
            ))}
          </div>
        </section>
      )}

      {!semanticSearchQuery.isFetching &&
        !semanticSearchQuery.isSuccess &&
        !semanticSearchQuery.isError && (
        <InternalPanel data-tour="talent-search-results">
          <InternalEmptyState
            icon={Sparkles}
            title={talentSearchPageCopy.search.emptyTitle}
            description="Search your candidate pool using natural language. Describe the skills, experience, or qualifications you're looking for."
          />
        </InternalPanel>
      )}

      <MoveCandidateToJobDialog
        open={moveDialogOpen}
        onOpenChange={setMoveDialogOpen}
        candidate={moveCandidate}
        searchQuery={submittedQuery}
        onMoveSuccess={handleMoveSuccess}
      />

      <Dialog
        open={Boolean(resumePreviewCandidate)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setResumePreviewCandidate(null);
        }}
      >
        <DialogContent className="flex h-[90vh] max-h-[90vh] w-[95vw] max-w-5xl flex-col gap-0 p-0">
          <DialogHeader className="shrink-0 border-b border-border px-6 py-4">
            <DialogTitle className="text-xl font-semibold text-foreground">
              {resumePreviewCandidate?.name ?? talentSearchPageCopy.search.resumePreviewFallback}
            </DialogTitle>
            {resumePreviewCandidate?.email && (
              <p className="text-sm text-muted-foreground">{resumePreviewCandidate.email}</p>
            )}
          </DialogHeader>

          <div className="flex h-full flex-col p-4">
            <div className="mb-4 flex shrink-0 items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  {cleanDisplayFilename}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {previewIsPdf && resumePreviewUrl && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open(resumePreviewUrl, "_blank", "noopener")}
                  >
                    <ExternalLink className="mr-2 h-4 w-4" />
                    {talentSearchPageCopy.search.openInNewTab}
                  </Button>
                )}
                {resumeDownloadUrl && (
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => window.open(resumeDownloadUrl, "_blank", "noopener")}
                  >
                    <Download className="mr-2 h-4 w-4" />
                    {talentSearchPageCopy.search.download}
                  </Button>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-hidden rounded-lg border border-border bg-muted/50">
              {resumePreviewUrl ? (
                previewIsPdf ? (
                  <iframe
                    src={`${resumePreviewUrl}#toolbar=0&navpanes=0`}
                    className="h-full w-full"
                    title={talentSearchPageCopy.search.resumePreviewFrameTitle}
                  />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center p-8 text-center">
                    <FileText className="mb-4 h-16 w-16 text-muted-foreground/50" />
                    <p className="mb-4 text-muted-foreground">
                      {talentSearchPageCopy.search.unsupportedPreview}
                    </p>
                    {resumeDownloadUrl && (
                      <Button onClick={() => window.open(resumeDownloadUrl, "_blank", "noopener")}>
                        <Download className="mr-2 h-4 w-4" />
                        {talentSearchPageCopy.search.downloadToView}
                      </Button>
                    )}
                  </div>
                )
              ) : (
                <div className="flex h-full flex-col items-center justify-center p-8 text-center">
                  <AlertCircle className="mb-4 h-16 w-16 text-muted-foreground/50" />
                  <p className="text-muted-foreground">{talentSearchPageCopy.search.noResume}</p>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </InternalPageShell>
  );
}
