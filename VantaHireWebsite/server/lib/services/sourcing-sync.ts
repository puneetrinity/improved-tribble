import { sql } from 'drizzle-orm';
import { db } from '../../db';
import { getResults } from './signal-client';
import type {
  SignalResultCandidateV3,
  SignalResultsResponse,
} from './signal-contracts';
import type { SignalExecutionIdentity } from './signal-callback-ack';
import { commitIfSignalExecutionCurrent } from './signal-execution-fence';

const ENRICHED_STATUSES = new Set(['completed', 'enriched']);
const PENDING_STATUSES = new Set(['pending', 'queued']);
const FAILED_STATUSES = new Set(['failed', 'error']);

function readOptionalStringOrNull(
  input: Record<string, unknown> | null | undefined,
  key: string,
): string | null | undefined {
  if (!input || !(key in input)) return undefined;
  const value = input[key];
  if (value == null) return null;
  return typeof value === 'string' ? value : undefined;
}

/**
 * Normalize Signal fit score for job_sourced_candidates.fit_score (INTEGER 0-100).
 * Signal may return either a ratio (0..1) or a percent-like number (0..100).
 */
function normalizeFitScoreForStorage(fitScore: number | null): number | null {
  if (typeof fitScore !== 'number' || Number.isNaN(fitScore)) {
    return null;
  }

  const scaled = fitScore <= 1 ? fitScore * 100 : fitScore;
  return Math.max(0, Math.min(100, Math.round(scaled)));
}

export interface SourcingEnrichmentProgress {
  totalCandidates: number;
  enrichedCount: number;
  pendingCount: number;
  failedCount: number;
  inProgress: boolean;
  percent: number;
  lastSyncedAt: string;
}

export interface SyncSignalResultsParams {
  organizationId: number;
  jobId: number;
  requestId: string;
  externalJobId: string;
  signalTenantId: string;
  execution?: SignalExecutionIdentity;
}

export interface SyncSignalResultsResult {
  fetchedResults: SignalResultsResponse;
  candidateCount: number;
  upsertedCount: number;
  enrichmentProgress: SourcingEnrichmentProgress;
  metaPatch: Record<string, unknown>;
}

export function computeEnrichmentProgress(
  candidates: SignalResultCandidateV3[],
): SourcingEnrichmentProgress {
  const totalCandidates = candidates.length;

  let enrichedCount = 0;
  let pendingCount = 0;
  let failedCount = 0;

  for (const c of candidates) {
    const status = c.candidate.enrichmentStatus ?? '';
    if (ENRICHED_STATUSES.has(status)) {
      enrichedCount++;
    } else if (FAILED_STATUSES.has(status)) {
      failedCount++;
    } else if (PENDING_STATUSES.has(status) || status === '') {
      pendingCount++;
    } else {
      // Unknown status — treat as pending
      pendingCount++;
    }
  }

  const percent = totalCandidates > 0
    ? Number(((enrichedCount / totalCandidates) * 100).toFixed(1))
    : 0;
  const inProgress = pendingCount > 0;

  return {
    totalCandidates,
    enrichedCount,
    pendingCount,
    failedCount,
    inProgress,
    percent,
    lastSyncedAt: new Date().toISOString(),
  };
}

function buildSignalRunMetaPatch(
  fetchedResults: SignalResultsResponse,
  enrichmentProgress: SourcingEnrichmentProgress,
): Record<string, unknown> {
  const resultGroupCounts = fetchedResults.groupCounts && typeof fetchedResults.groupCounts === 'object'
    ? fetchedResults.groupCounts as unknown as Record<string, unknown>
    : null;
  const resultDiagnostics = fetchedResults.diagnostics && typeof fetchedResults.diagnostics === 'object'
    ? fetchedResults.diagnostics as Record<string, unknown>
    : null;

  const groupRequestedLocation = readOptionalStringOrNull(resultGroupCounts, 'requestedLocation');
  const diagnosticsRequestedLocation = readOptionalStringOrNull(resultDiagnostics, 'requestedLocation');
  const requestedLocation = groupRequestedLocation !== undefined
    ? groupRequestedLocation
    : diagnosticsRequestedLocation;

  const groupExpansionReason = readOptionalStringOrNull(resultGroupCounts, 'expansionReason');
  const diagnosticsExpansionReason = readOptionalStringOrNull(resultDiagnostics, 'expansionReason');
  const expansionReason = groupExpansionReason !== undefined
    ? groupExpansionReason
    : diagnosticsExpansionReason;

  return {
    signalStatus: fetchedResults.status,
    resultCount: fetchedResults.resultCount,
    ...(fetchedResults.trackDecision ? { trackDecision: fetchedResults.trackDecision } : {}),
    ...(fetchedResults.groupCounts ? { groupCounts: fetchedResults.groupCounts } : {}),
    ...(fetchedResults.snapshotStats ? { snapshotStats: fetchedResults.snapshotStats } : {}),
    ...(fetchedResults.matchStrengthBands !== undefined
      ? { matchStrengthBands: fetchedResults.matchStrengthBands }
      : {}),
    ...(fetchedResults.diagnostics ? { diagnostics: fetchedResults.diagnostics } : {}),
    ...(requestedLocation !== undefined ? { requestedLocation } : {}),
    ...(expansionReason !== undefined ? { expansionReason } : {}),
    enrichmentProgress,
    lastResultsSyncAt: enrichmentProgress.lastSyncedAt,
    ...(fetchedResults.lastRerankedAt !== undefined ? { lastRerankedAt: fetchedResults.lastRerankedAt } : {}),
  };
}

/**
 * Upsert sourced candidates from Signal results.
 *
 * Recruiter state is preserved on conflict; fit/summary are refreshed.
 */
export async function upsertSignalCandidates(
  organizationId: number,
  jobId: number,
  requestId: string,
  candidates: SignalResultCandidateV3[],
  onCandidateUpserted?: (candidate: SignalResultCandidateV3, rank: number) => void,
  execution?: SignalExecutionIdentity,
): Promise<number> {
  if (candidates.length === 0) return 0;

  // Build all row values for a single bulk INSERT
  const rows = candidates.map((c) => {
    const fitScore = normalizeFitScoreForStorage(c.fitScore ?? null);
    const searchSnippet = (c.candidate as unknown as { searchSnippet?: unknown }).searchSnippet ?? null;
    const searchMeta = (c.candidate as unknown as { searchMeta?: unknown }).searchMeta ?? null;
    const searchProvider = (c.candidate as unknown as { searchProvider?: unknown }).searchProvider ?? null;
    const searchSignals = (c.candidate as unknown as { searchSignals?: unknown }).searchSignals ?? null;

    const summary = {
      candidate: c.candidate,
      sourcingContext: c.sourcingContext,
      cardSignals: c.cardSignals,
      nameHint: c.candidate.nameHint,
      headlineHint: c.candidate.headlineHint,
      locationHint: c.candidate.locationHint,
      companyHint: c.candidate.companyHint,
      linkedinUrl: c.candidate.linkedinUrl,
      enrichmentStatus: c.candidate.enrichmentStatus,
      confidenceScore: c.candidate.confidenceScore,
      lastEnrichedAt: c.candidate.lastEnrichedAt ?? c.freshness?.lastEnrichedAt ?? null,
      searchSnippet,
      searchMeta,
      searchProvider,
      searchSignals,
      identitySummary: c.identitySummary ?? null,
      identities: (c as any).identities ?? [],
      aiSummary: c.aiSummary ?? null,
      snapshot: c.snapshot ?? null,
      rank: c.sourcingContext?.rank ?? c.rank ?? null,
      fitScoreRaw: c.fitScore ?? null,
      matchTier: c.matchTier ?? null,
      locationMatchType: c.locationMatchType ?? null,
      countryCode: (c as any).countryCode ?? null,
      dataConfidence: c.dataConfidence ?? null,
      professionalValidation: c.professionalValidation ?? null,
      locationLabel: c.locationLabel ?? null,
    };

    return {
      candidateId: c.candidate.id,
      fitScore,
      fitBreakdown: JSON.stringify(c.fitBreakdown ?? null),
      sourceType: c.sourceType ?? 'discovered',
      summary: JSON.stringify(summary),
    };
  });

  // Single bulk upsert — dramatically faster than 100 sequential awaits
  // Build a drizzle sql template with all rows inlined as parameterized values
  let bulkSql = sql`
    INSERT INTO job_sourced_candidates (
      organization_id, job_id, request_id, signal_candidate_id,
      fit_score, fit_breakdown, source_type, state,
      candidate_summary, last_synced_at, created_at, updated_at
    ) VALUES
  `;

  const sqlParts = rows.map((row) =>
    sql`(
      ${organizationId}, ${jobId}, ${requestId}, ${row.candidateId},
      ${row.fitScore}, ${row.fitBreakdown}::jsonb, ${row.sourceType}, 'new',
      ${row.summary}::jsonb, NOW(), NOW(), NOW()
    )`
  );

  // Join rows with commas
  for (let i = 0; i < sqlParts.length; i++) {
    if (i > 0) bulkSql = sql`${bulkSql},`;
    bulkSql = sql`${bulkSql} ${sqlParts[i]}`;
  }

  bulkSql = sql`${bulkSql}
    ON CONFLICT (job_id, signal_candidate_id) DO UPDATE SET
      request_id = EXCLUDED.request_id,
      fit_score = EXCLUDED.fit_score,
      fit_breakdown = EXCLUDED.fit_breakdown,
      source_type = EXCLUDED.source_type,
      candidate_summary = EXCLUDED.candidate_summary,
      last_synced_at = NOW(),
      updated_at = NOW()
  `;

  if (execution) {
    const committed = await commitIfSignalExecutionCurrent(
      requestId,
      execution,
      (transaction) => transaction.execute(bulkSql),
    );
    if (!committed.committed) {
      throw new Error('Sourcing execution was superseded before candidate sync');
    }
  } else {
    await db.execute(bulkSql);
  }


  // Fire per-candidate callbacks after the batch
  if (onCandidateUpserted) {
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i]!;
      onCandidateUpserted(c, c.sourcingContext?.rank ?? c.rank ?? i + 1);
    }
  }

  return candidates.length;
}


/**
 * Fetch latest Signal /results and upsert candidates in Vanta.
 */
export async function syncSignalResultsIntoVanta(
  params: SyncSignalResultsParams,
  onCandidateUpserted?: (candidate: SignalResultCandidateV3, rank: number) => void,
): Promise<SyncSignalResultsResult> {
  const fetchedResults = await getResults(
    params.signalTenantId,
    params.externalJobId,
    params.requestId,
    true // includeSummary
  );

  const candidates = Array.isArray(fetchedResults.data)
    ? fetchedResults.data
    : [];
  let candidateCount = fetchedResults.resultCount ?? 0;
  let upsertedCount = 0;

  if (candidates.length > 0) {
    upsertedCount = await upsertSignalCandidates(
      params.organizationId,
      params.jobId,
      params.requestId,
      candidates,
      onCandidateUpserted,
      params.execution,
    );
    candidateCount = candidates.length;
  }

  const enrichmentProgress = computeEnrichmentProgress(candidates);
  const metaPatch = buildSignalRunMetaPatch(fetchedResults, enrichmentProgress);

  return {
    fetchedResults,
    candidateCount,
    upsertedCount,
    enrichmentProgress,
    metaPatch,
  };
}
