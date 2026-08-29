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
}

interface SemanticSearchResponse {
  query: string;
  count: number;
  scoreType?: "rrf_fused" | "weighted_fusion" | "cosine" | "unknown";
  displayScoreType?: "rrf_fused" | "weighted_fusion" | "cosine" | "unknown";
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
              <Sparkles className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7B8191]" />
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
            className="h-11 rounded-2xl bg-[#4B8EF0] px-5 text-[0.875rem] font-semibold text-white shadow-[0_10px_22px_rgba(75,142,240,0.22)] hover:bg-[#3679DB]"
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
          <div className="mt-3 space-y-1 rounded-[18px] border border-[#EEF0F4] bg-[#F8F8FA] px-4 py-3">
            <p className="font-dm text-sm text-[#687182]">
              {semanticResults.length} result{semanticResults.length !== 1 ? "s" : ""} for "{submittedQuery}"
            </p>
            {semanticScoreType === "rrf_fused" && semanticDisplayScoreType === "cosine" && (
              <p className="font-dm text-xs text-[#7B8191]">
                {talentSearchPageCopy.search.hybridScoreHint}
              </p>
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
        <InternalPanel>
          <InternalEmptyState
            icon={AlertCircle}
            title={talentSearchPageCopy.search.errorFallback}
            description={semanticSearchQuery.error?.message}
          />
        </InternalPanel>
      )}

      {semanticSearchQuery.isSuccess && semanticResults.length === 0 && (
        <InternalPanel>
          <InternalEmptyState
            icon={Search}
            title={talentSearchPageCopy.search.noResultsTitle}
            description={talentSearchPageCopy.search.noResultsHint}
          />
        </InternalPanel>
      )}

      {semanticSearchQuery.isSuccess && semanticResults.length > 0 && (
        <section className="space-y-4" data-tour="talent-search-results">
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

          <p className="flex items-center gap-1 font-dm text-xs text-[#7B8191]">
            {talentSearchPageCopy.search.rankingHint}
          </p>

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
                        <span className="text-xs text-[#7B8191]">
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
                        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[#7B8191]">
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
                        className="rounded-2xl border-[#D9DDEA] bg-white font-semibold text-[#1F2937] shadow-[0_8px_18px_rgba(15,23,42,0.05)] hover:bg-[#F7F8FC]"
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
                        className="rounded-2xl border-[#D9DDEA] bg-white font-semibold text-[#1F2937] shadow-[0_8px_18px_rgba(15,23,42,0.05)] hover:bg-[#F7F8FC]"
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
