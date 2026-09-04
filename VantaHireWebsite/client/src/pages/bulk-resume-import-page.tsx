import { useState, useMemo } from 'react';
import { useRoute, useLocation } from 'wouter';
import { ArrowLeft, Loader2, RefreshCw, Upload } from 'lucide-react';
import Layout from '@/components/Layout';
import { JobSubNav } from '@/components/JobSubNav';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { BatchSummaryBar } from '@/components/bulk-import/BatchSummaryBar';
import { BatchItemsTable } from '@/components/bulk-import/BatchItemsTable';
import { FinalizeResultCard } from '@/components/bulk-import/FinalizeResultCard';
import {
  useBulkImportBatch,
  useBulkImportPatchItem,
  useBulkImportAdvancedExtract,
  useBulkImportFinalize,
  useBulkImportReprocess,
} from '@/hooks/use-bulk-import';
import type { FinalizeResponse, PatchItemRequest } from '@/lib/bulkImportApi';
import { bulkResumeImportPageCopy } from '@/lib/internal-copy';

function useBatchIdFromSearch(): number | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('batchId');
  if (!raw) return null;
  const num = Number(raw);
  return Number.isFinite(num) && num > 0 ? num : null;
}

export default function BulkResumeImportPage() {
  const [match, routeParams] = useRoute('/jobs/:id/bulk-import');
  const [, setLocation] = useLocation();
  const jobId = Number(routeParams?.id);
  const batchId = useBatchIdFromSearch();

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [dismissedIds, setDismissedIds] = useState<Set<number>>(new Set());
  const [finalizeResult, setFinalizeResult] = useState<FinalizeResponse | null>(null);

  const batchQuery = useBulkImportBatch(jobId, batchId);
  const patchMutation = useBulkImportPatchItem(jobId, batchId ?? 0);
  const advancedExtractMutation = useBulkImportAdvancedExtract(jobId, batchId ?? 0);
  const finalizeMutation = useBulkImportFinalize(jobId, batchId ?? 0);
  const reprocessMutation = useBulkImportReprocess(jobId, batchId ?? 0);

  const batch = batchQuery.data?.batch;
  const items = batchQuery.data?.items ?? [];

  const visibleItems = useMemo(
    () => items.filter((i) => !dismissedIds.has(i.id)),
    [items, dismissedIds],
  );

  const finalizableCount = useMemo(
    () => visibleItems.filter((i) => i.canFinalize && i.status !== 'finalized').length,
    [visibleItems],
  );

  const selectedFinalizableCount = useMemo(
    () => visibleItems.filter((i) => i.canFinalize && i.status !== 'finalized' && selectedIds.has(i.id)).length,
    [visibleItems, selectedIds],
  );

  const handleDismiss = (id: number) => {
    setDismissedIds((prev) => new Set(prev).add(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const handlePatch = async (itemId: number, data: PatchItemRequest) => {
    await patchMutation.mutateAsync({ itemId, data });
  };

  const handleAdvancedExtract = async (itemId: number) => {
    await advancedExtractMutation.mutateAsync(itemId);
  };

  const handleFinalize = async () => {
    const idsToFinalize = selectedFinalizableCount > 0
      ? items.filter((i) => i.canFinalize && i.status !== 'finalized' && selectedIds.has(i.id)).map((i) => i.id)
      : undefined;
    const result = await finalizeMutation.mutateAsync(idsToFinalize);
    setFinalizeResult(result);
    setSelectedIds(new Set());
  };

  const handleContinueReview = () => {
    setFinalizeResult(null);
  };

  // Missing / invalid batchId
  if (!batchId) {
    return (
      <Layout>
        <div className="container mx-auto max-w-6xl px-4 pb-10 pt-4 sm:px-6">
          <JobSubNav jobId={jobId} />
          <Card className="mt-6">
            <CardContent className="flex flex-col items-center py-12 gap-4">
              <Upload className="h-10 w-10 text-muted-foreground" />
              <p className="text-muted-foreground">No batch selected. Start by importing resumes from the applications page.</p>
              <Button variant="outline" onClick={() => setLocation(`/jobs/${jobId}/applications`)}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Applications
              </Button>
            </CardContent>
          </Card>
        </div>
      </Layout>
    );
  }

  // Loading
  if (batchQuery.isLoading) {
    return (
      <Layout>
        <div className="container mx-auto max-w-6xl px-4 pb-10 pt-4 sm:px-6">
          <JobSubNav jobId={jobId} />
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </div>
      </Layout>
    );
  }

  // Error
  if (batchQuery.isError || !batch) {
    return (
      <Layout>
        <div className="container mx-auto max-w-6xl px-4 pb-10 pt-4 sm:px-6">
          <JobSubNav jobId={jobId} />
          <Card className="mt-6">
            <CardContent className="flex flex-col items-center py-12 gap-4">
              <p className="text-destructive">Failed to load batch. It may not exist or you may not have access.</p>
              <Button variant="outline" onClick={() => setLocation(`/jobs/${jobId}/applications`)}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Applications
              </Button>
            </CardContent>
          </Card>
        </div>
      </Layout>
    );
  }

  const isProcessing = batch.status === 'queued' || batch.status === 'processing';
  const showFinalizeBar = !isProcessing && !finalizeResult && finalizableCount > 0;

  // Derive completed summary if user refreshes after finalize
  const completedFallback = !finalizeResult && batch.status === 'completed';

  return (
    <Layout>
      <div className="container mx-auto max-w-6xl px-4 pb-10 pt-4 sm:px-6">
        <JobSubNav jobId={jobId} className="mb-4" />

        {/* Page header — compact, actions on the same row */}
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[22px] font-semibold leading-[1.15] tracking-[-0.02em] md:text-[26px]">{bulkResumeImportPageCopy.header.title}</h1>
            <p className="text-sm text-muted-foreground">
              Batch #{batchId} &middot; {batch.fileCount} file{batch.fileCount !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="flex gap-2">
            {!isProcessing && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => reprocessMutation.mutate()}
                disabled={reprocessMutation.isPending}
              >
                {reprocessMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                {bulkResumeImportPageCopy.header.reparse}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setLocation(`/jobs/${jobId}/applications`)}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              {bulkResumeImportPageCopy.header.applications}
            </Button>
          </div>
        </div>

        {/* Summary bar */}
        <div className="mb-4">
          <BatchSummaryBar batch={batch} />
        </div>

        {/* Items table */}
        <BatchItemsTable
          items={items}
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          onPatchItem={handlePatch}
          onAdvancedExtract={handleAdvancedExtract}
          isPatchPending={patchMutation.isPending}
          advancedExtractingItemId={advancedExtractMutation.isPending ? advancedExtractMutation.variables ?? null : null}
          dismissedIds={dismissedIds}
          onDismiss={handleDismiss}
        />

        {/* Sticky finalize bar */}
        {showFinalizeBar && (
          <div className="sticky bottom-0 mt-4 p-4 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 flex items-center justify-between rounded-b-lg">
            <p className="text-sm text-muted-foreground">
              {selectedFinalizableCount > 0
                ? `${selectedFinalizableCount} of ${finalizableCount} selected`
                : `${finalizableCount} candidate${finalizableCount !== 1 ? 's' : ''} ready to finalize`}
            </p>
            <Button
              onClick={handleFinalize}
              disabled={finalizeMutation.isPending || finalizableCount === 0}
            >
              {finalizeMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Finalizing...
                </>
              ) : selectedFinalizableCount > 0 ? (
                `Finalize Selected (${selectedFinalizableCount})`
              ) : (
                `Finalize All Ready (${finalizableCount})`
              )}
            </Button>
          </div>
        )}

        {finalizeResult && (
          <div className="mt-4">
            <FinalizeResultCard
              result={finalizeResult}
              jobId={jobId}
              onContinueReview={handleContinueReview}
            />
          </div>
        )}

        {completedFallback && (
          <Card className="mt-4">
            <CardContent className="py-4">
              <p className="text-sm text-muted-foreground">
                This batch has been completed. {batch.readyCount} candidates were processed.
              </p>
              <Button
                size="sm"
                className="mt-2"
                onClick={() => setLocation(`/jobs/${jobId}/applications`)}
              >
                Back to Applications
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}
