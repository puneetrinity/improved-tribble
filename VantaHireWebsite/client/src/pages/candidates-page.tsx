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
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import Layout from "@/components/Layout";
import { MoveCandidateToJobDialog } from "@/components/recruiter/MoveCandidateToJobDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { talentSearchPageCopy } from "@/lib/internal-copy";

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
    locator?: string | null;
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
  const externalPreviewProxyUrl = resumePreviewCandidate?.isExternal && resumePreviewCandidate?.resume.locator
    ? `/api/candidates/external-resume?locator=${encodeURIComponent(resumePreviewCandidate.resume.locator)}&filename=${encodeURIComponent(resumePreviewCandidate.resume.resumeFilename ?? "resume.pdf")}`
    : null;
  const externalDownloadProxyUrl = resumePreviewCandidate?.isExternal && resumePreviewCandidate?.resume.locator
    ? `${externalPreviewProxyUrl}&download=1`
    : null;
  const resumePreviewUrl = resumePreviewCandidate
    ? (
      resumePreviewCandidate.isExternal
        ? (externalPreviewProxyUrl ?? resumePreviewCandidate.resume.previewUrl ?? resumePreviewCandidate.resume.signedUrl)
        : `/api/applications/${resumePreviewCandidate.applicationId}/resume`
    )
    : null;
  const resumeDownloadUrl = resumePreviewCandidate
    ? (
      resumePreviewCandidate.isExternal
        ? (externalDownloadProxyUrl ?? resumePreviewCandidate.resume.signedUrl)
        : `/api/applications/${resumePreviewCandidate.applicationId}/resume?download=1`
    )
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

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <Sparkles className="h-7 w-7 text-primary" />
            <h1 className="text-2xl md:text-3xl font-semibold text-foreground">
              {talentSearchPageCopy.header.title}
            </h1>
          </div>
          <p className="text-muted-foreground text-sm md:text-base max-w-2xl">
            {talentSearchPageCopy.header.subtitle}
          </p>
        </div>

        {/* Search Bar */}
        <Card className="mb-6 shadow-sm" data-tour="talent-search-input">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <div className="relative">
                  <Sparkles className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder={talentSearchPageCopy.search.placeholder}
                    value={semanticQuery}
                    onChange={(e) => setSemanticQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSemanticSearch();
                    }}
                    className="pl-10"
                  />
                </div>
              </div>
              <Button
                onClick={handleSemanticSearch}
                disabled={!semanticQuery.trim() || semanticSearchQuery.isFetching}
              >
                {semanticSearchQuery.isFetching ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Search className="h-4 w-4 mr-2" />
                )}
                {talentSearchPageCopy.search.buttonLabel}
              </Button>
            </div>
            {submittedQuery && semanticSearchQuery.isSuccess && (
              <div className="mt-2 space-y-1">
                <p className="text-sm text-muted-foreground">
                  {semanticResults.length} result{semanticResults.length !== 1 ? "s" : ""} for "{submittedQuery}"
                </p>
                {semanticScoreType === "rrf_fused" && semanticDisplayScoreType === "cosine" && (
                  <p className="text-xs text-muted-foreground">
                    {talentSearchPageCopy.search.hybridScoreHint}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Semantic Results */}
        {semanticSearchQuery.isFetching && (
          <div className="text-center py-12">
            <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
            <p className="text-muted-foreground mt-4">{talentSearchPageCopy.search.searchingLabel}</p>
          </div>
        )}

        {semanticSearchQuery.isError && (
          <Card className="shadow-sm">
            <CardContent className="p-6 text-center">
              <AlertCircle className="h-12 w-12 text-destructive/50 mx-auto mb-3" />
              <p className="text-muted-foreground">
                {semanticSearchQuery.error?.message || talentSearchPageCopy.search.errorFallback}
              </p>
            </CardContent>
          </Card>
        )}

        {semanticSearchQuery.isSuccess && semanticResults.length === 0 && (
          <Card className="shadow-sm">
            <CardContent className="p-6 text-center">
              <Search className="h-16 w-16 text-muted-foreground/50 mx-auto mb-4" />
              <p className="text-muted-foreground">{talentSearchPageCopy.search.noResultsTitle}</p>
              <p className="text-muted-foreground text-sm mt-2">
                {talentSearchPageCopy.search.noResultsHint}
              </p>
            </CardContent>
          </Card>
        )}

        {semanticSearchQuery.isSuccess && semanticResults.length > 0 && (
          <div className="space-y-3" data-tour="talent-search-results">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              {talentSearchPageCopy.search.rankingHint}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 shrink-0 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-xs">
                    {talentSearchPageCopy.search.rankingTooltip}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </p>
            {semanticResults.map((result) => (
              <Card key={result.applicationId} className="shadow-sm hover:shadow-md transition-shadow" data-tour="talent-search-result-card">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    {/* Candidate Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1">
                        <h3 className="font-semibold text-foreground truncate">
                          {result.name}
                        </h3>
                        <Badge
                          variant={semanticScoreIsPercent
                            ? (result.matchScore >= 80 ? "default" : result.matchScore >= 50 ? "secondary" : "outline")
                            : "outline"}
                          className="font-mono text-xs shrink-0"
                        >
                          {semanticScoreIsPercent
                            ? `${result.matchScore}% match`
                            : `Relevance ${(result.matchScoreRaw ?? (result.matchScore / 100)).toFixed(4)}`}
                        </Badge>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground mb-2">
                        <span className="flex items-center gap-1">
                          <Mail className="h-3.5 w-3.5" />
                          {result.email ?? talentSearchPageCopy.search.emailUnavailable}
                        </span>
                        {result.source && (
                          <Badge variant="secondary" className="text-xs">
                            {result.source}
                          </Badge>
                        )}
                        {result.matchedChunks > 0 && (
                          <span className="text-xs text-muted-foreground">
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
                          <Badge variant="outline" className="text-xs">
                            {result.currentStageName}
                          </Badge>
                        )}
                      </div>

                      {result.highlights && result.highlights.length > 0 && (
                        <div className="mt-3 space-y-2">
                          <p className="text-xs font-medium text-muted-foreground">
                            {talentSearchPageCopy.search.whyMatched}
                          </p>
                          {result.highlights.slice(0, 3).map((highlight: string, idx: number) => (
                            <div
                              key={idx}
                              className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
                            >
                              {highlight}
                            </div>
                          ))}
                        </div>
                      )}

                    </div>

                    {/* Actions */}
                    <div className="flex flex-col gap-2 shrink-0">
                      {(result.canOpenResume ?? Boolean(result.resume.resumeFilename || result.resume.signedUrl)) && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleOpenResume(result)}
                        >
                          <FileText className="h-4 w-4 mr-1" />
                          {talentSearchPageCopy.search.resume}
                        </Button>
                      )}
                      {result.canMoveToJob !== false && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleMoveClick(result)}
                        >
                          <ArrowRightLeft className="h-4 w-4 mr-1" />
                          {talentSearchPageCopy.search.addToJob}
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Empty state before any search */}
        {!semanticSearchQuery.isFetching &&
          !semanticSearchQuery.isSuccess &&
          !semanticSearchQuery.isError && (
          <Card className="shadow-sm" data-tour="talent-search-results">
            <CardContent className="p-12 text-center">
              <Sparkles className="h-16 w-16 text-muted-foreground/30 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-2">
                {talentSearchPageCopy.search.emptyTitle}
              </h3>
              <p className="text-muted-foreground text-sm max-w-md mx-auto">
                Search your candidate pool using natural language. Describe the skills,
                experience, or qualifications you're looking for.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Move Dialog */}
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
          <DialogContent className="max-w-5xl w-[95vw] h-[90vh] max-h-[90vh] p-0 gap-0 flex flex-col">
            <DialogHeader className="px-6 py-4 border-b border-border shrink-0">
              <DialogTitle className="text-xl font-semibold text-foreground">
                {resumePreviewCandidate?.name ?? talentSearchPageCopy.search.resumePreviewFallback}
              </DialogTitle>
              {resumePreviewCandidate?.email && (
                <p className="text-sm text-muted-foreground">{resumePreviewCandidate.email}</p>
              )}
            </DialogHeader>

            <div className="h-full flex flex-col p-4">
              <div className="flex items-center justify-between mb-4 shrink-0">
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
                      <ExternalLink className="h-4 w-4 mr-2" />
                      {talentSearchPageCopy.search.openInNewTab}
                    </Button>
                  )}
                  {resumeDownloadUrl && (
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => window.open(resumeDownloadUrl, "_blank", "noopener")}
                    >
                      <Download className="h-4 w-4 mr-2" />
                      {talentSearchPageCopy.search.download}
                    </Button>
                  )}
                </div>
              </div>

              <div className="flex-1 border border-border rounded-lg overflow-hidden bg-muted/50">
                {resumePreviewUrl ? (
                  previewIsPdf ? (
                    <iframe
                      src={`${resumePreviewUrl}#toolbar=0&navpanes=0`}
                      className="w-full h-full"
                      title={talentSearchPageCopy.search.resumePreviewFrameTitle}
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full p-8 text-center">
                      <FileText className="h-16 w-16 text-muted-foreground/50 mb-4" />
                      <p className="text-muted-foreground mb-4">
                        {talentSearchPageCopy.search.unsupportedPreview}
                      </p>
                      {resumeDownloadUrl && (
                        <Button onClick={() => window.open(resumeDownloadUrl, "_blank", "noopener")}>
                          <Download className="h-4 w-4 mr-2" />
                          {talentSearchPageCopy.search.downloadToView}
                        </Button>
                      )}
                    </div>
                  )
                ) : (
                  <div className="flex flex-col items-center justify-center h-full p-8 text-center">
                    <AlertCircle className="h-16 w-16 text-muted-foreground/50 mb-4" />
                    <p className="text-muted-foreground">{talentSearchPageCopy.search.noResume}</p>
                  </div>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}
