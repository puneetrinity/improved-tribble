import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '../../db';
import { getResults } from './signal-client';
import type {
  SignalResultCandidateV3,
  SignalResultsResponse,
} from './signal-contracts';
import type { SignalExecutionIdentity } from './signal-callback-ack';
import { commitIfSignalExecutionCurrent,buildSignalExecutionLockQuery } from './signal-execution-fence';
import {sourcingDeliverySchema,type SourcingDelivery} from '../../sourcing-authority/contracts';
import {SourcingRepository} from '../../sourcing-authority/repository';
import {rankedCandidateSchema} from '../../sourcing-authority/ranking-contract';
import { loadCandidatePrivacyConfig } from '../../candidate-privacy/config';
import { checkMemoryEligibilityBatch } from '../../candidate-privacy/memory-client';

const ENRICHED_STATUSES = new Set(['completed', 'enriched']);
const PENDING_STATUSES = new Set(['pending', 'queued']);
const FAILED_STATUSES = new Set(['failed', 'error']);

async function filterPrivacyAllowedCandidates(
  candidates: SignalResultCandidateV3[],
): Promise<SignalResultCandidateV3[]> {
  if (candidates.length === 0) return [];
  const config = loadCandidatePrivacyConfig();
  const subjects = candidates.map((candidate) => ({
    candidate,
    requestRef: randomUUID(),
  }));
  const decisions = await checkMemoryEligibilityBatch({
    subjects: subjects.map(({ candidate, requestRef }) => ({
      requestRef,
      identifiers: [{ identifier_type: 'signal_candidate_id' as const, value: candidate.candidate.id }],
    })),
    timeoutMs: config.memoryTimeoutMs,
  });
  return subjects
    .filter(({ requestRef }) => decisions.get(requestRef) === 'allow')
    .map(({ candidate }) => candidate);
}

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
    ...(fetchedResults.governed?.protocolVersion===2?{rankingProtocolVersion:2,
      rankingRevision:fetchedResults.governed.rankingRevision,rankingHash:fetchedResults.governed.rankingHash,
      rankingContractHash:fetchedResults.governed.contractHash}:{}),
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
  governed?:SourcingDelivery,
): Promise<{ count: number; candidates: SignalResultCandidateV3[] }> {
  if (candidates.length === 0 && !governed) return { count: 0, candidates: [] };

  const allowedCandidates = await filterPrivacyAllowedCandidates(candidates);
  if (allowedCandidates.length === 0 && !governed) return { count: 0, candidates: [] };

  // Build all row values for a single bulk INSERT
  const rows = allowedCandidates.map((c) => {
    const fitScore = normalizeFitScoreForStorage(c.fitScore ?? null);
    const searchSnippet = (c.candidate as unknown as { searchSnippet?: unknown }).searchSnippet ?? null;
    const searchMeta = (c.candidate as unknown as { searchMeta?: unknown }).searchMeta ?? null;
    const searchProvider = (c.candidate as unknown as { searchProvider?: unknown }).searchProvider ?? null;
    const searchSignals = (c.candidate as unknown as { searchSignals?: unknown }).searchSignals ?? null;

    const summary = {
      ...(governed?.protocolVersion===2?{ranking:rankedCandidateSchema.parse(c.ranking)}:{}),
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

  if(governed) {
    if(!execution || execution.acquisitionGeneration!==1 || execution.executionAttemptId!==governed.executionAttemptId)throw Error('SOURCING_DELIVERY_EXECUTION_MISMATCH');
    await db.transaction(async (transaction:typeof db)=>{
      // Same org-first lock order as admission/decisions. The result projection
      // and ordered evidence commit together, or neither does.
      await transaction.execute(sql`SELECT public.flow_sourcing_org_state(${organizationId},true)`);
      const locked=await transaction.execute(buildSignalExecutionLockQuery(requestId,execution));
      if(locked.rows.length!==1)throw Error('SOURCING_DELIVERY_EXECUTION_STALE');
      if(rows.length)await transaction.execute(bulkSql);
      const command={requestId,executionAttemptId:governed.executionAttemptId,artifactHash:governed.artifactHash,
        revision:governed.revision,orderedSignalIds:governed.protocolVersion===2
          ? allowedCandidates.map(c=>c.candidate.id) : governed.orderedSignalIds,
        ...(governed.protocolVersion===2?{rankingRevision:governed.rankingRevision,rankingHash:governed.rankingHash,contractHash:governed.contractHash}:{})};
      const result=await transaction.execute(sql`SELECT public.flow_sourcing_deliver(${organizationId},${governed.flowRunId}::uuid,${JSON.stringify(command)}::jsonb) result`);
      if(!result.rows[0]?.result)throw Error('SOURCING_DELIVERY_BINDING_MISSING');
    });
  } else if (execution) {
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
    const publishableCandidates = await filterPrivacyAllowedCandidates(allowedCandidates);
    for (let i = 0; i < publishableCandidates.length; i++) {
      const c = publishableCandidates[i]!;
      onCandidateUpserted(c, c.sourcingContext?.rank ?? c.rank ?? i + 1);
    }
  }

  return { count: allowedCandidates.length, candidates: allowedCandidates };
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
  const binding=await new SourcingRepository().call<{flowRunId:string;artifactHash:string;executionAttemptId:string;protocolVersion?:1|2;contractHash?:string}>('runBinding',
    [params.organizationId,params.jobId,params.requestId]);
  const governed=binding?sourcingDeliverySchema.parse(fetchedResults.governed):undefined;
  if(governed && (governed.protocolVersion!==(binding!.protocolVersion??1)||
    (governed.protocolVersion===2&&governed.contractHash!==binding!.contractHash)))throw Error('SOURCING_RANKING_CONFLICT');
  if(governed && (governed.flowRunId!==binding!.flowRunId || governed.artifactHash!==binding!.artifactHash ||
    governed.executionAttemptId!==binding!.executionAttemptId || fetchedResults.requestId!==params.requestId ||
    fetchedResults.externalJobId!==params.externalJobId || (governed.protocolVersion===1&&JSON.stringify(governed.orderedSignalIds)!==JSON.stringify(candidates.map(c=>c.candidate.id)))))throw Error('SOURCING_DELIVERY_BINDING_MISMATCH');
  if(governed?.protocolVersion===2) {
    let previous=0;
    const seen=new Set<string>();
    if(JSON.stringify(governed.orderedSignalIds)!==JSON.stringify(candidates.map(c=>c.candidate.id)))
      throw Error('SOURCING_DELIVERY_BINDING_MISMATCH');
    for(const candidate of candidates) {
      const ranking=rankedCandidateSchema.parse(candidate.ranking);
      if(ranking.revisionId!==governed.rankingRevision||ranking.outputHash!==governed.rankingHash||
        ranking.contractHash!==governed.contractHash||ranking.candidateId!==candidate.candidate.id||
        ranking.ordinal<=previous||
        candidate.sourcingContext?.rank!==ranking.ordinal||seen.has(ranking.candidateId)||candidate.fitScore!=null)
        throw Error('SOURCING_RANKING_CONFLICT');
      previous=ranking.ordinal;seen.add(ranking.candidateId);
    }
  }
  if(!binding&&fetchedResults.governed)throw Error('SOURCING_DELIVERY_BINDING_MISSING');
  let candidateCount = fetchedResults.resultCount ?? 0;
  let upsertedCount = 0;
  let privacyAllowedCandidates: SignalResultCandidateV3[] = [];

  if (candidates.length > 0 || governed) {
    const upserted = await upsertSignalCandidates(
      params.organizationId,
      params.jobId,
      params.requestId,
      candidates,
      onCandidateUpserted,
      params.execution,
      governed,
    );
    upsertedCount = upserted.count;
    privacyAllowedCandidates = upserted.candidates;
    candidateCount = upsertedCount;
  }

  const enrichmentProgress = computeEnrichmentProgress(privacyAllowedCandidates);
  const metaPatch = buildSignalRunMetaPatch(
    { ...fetchedResults, resultCount: candidateCount },
    enrichmentProgress,
  );

  return {
    fetchedResults,
    candidateCount,
    upsertedCount,
    enrichmentProgress,
    metaPatch,
  };
}
