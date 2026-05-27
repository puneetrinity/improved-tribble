/**
 * Backfill matchTier + locationMatchType into job_sourced_candidates.candidate_summary
 *
 * Context: The webhook handler was missing these two fields from the ingest.
 * This script re-fetches Signal /results for each completed sourcing run and
 * patches the candidate_summary JSONB with the missing tier fields.
 *
 * Run with: npx tsx server/scripts/backfill-sourcing-tiers.ts
 *
 * Environment variables:
 *   DRY_RUN=false - Apply changes (default is dry-run / safe)
 *   JOB_ID=17     - Limit to a single job (optional)
 */

import { db } from '../db';
import { jobSourcingRuns, jobSourcedCandidates, organizations } from '../../shared/schema';
import { eq, and, sql } from 'drizzle-orm';
import { getResults } from '../lib/services/signal-client';

const DRY_RUN = process.env.DRY_RUN !== 'false';
const SINGLE_JOB_ID = process.env.JOB_ID ? parseInt(process.env.JOB_ID, 10) : null;

async function main() {
  console.log('=== Sourcing Tier Backfill ===\n');
  if (DRY_RUN) {
    console.log('*** DRY RUN MODE — no DB writes ***\n');
  }

  // 1. Find completed sourcing runs (optionally filtered by job)
  const runsQuery = db.query.jobSourcingRuns.findMany({
    where: SINGLE_JOB_ID
      ? and(eq(jobSourcingRuns.status, 'completed'), eq(jobSourcingRuns.jobId, SINGLE_JOB_ID))
      : eq(jobSourcingRuns.status, 'completed'),
    orderBy: jobSourcingRuns.id,
  });
  const runs = await runsQuery;
  console.log(`Found ${runs.length} completed sourcing run(s)\n`);

  let totalPatched = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (const run of runs) {
    console.log(`--- Run ${run.id}: job=${run.jobId} request=${run.requestId} ---`);

    // 2. Get the org's signalTenantId
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, run.organizationId),
      columns: { id: true, signalTenantId: true },
    });

    if (!org?.signalTenantId) {
      console.log(`  SKIP: org ${run.organizationId} has no signalTenantId`);
      totalSkipped++;
      continue;
    }

    // 3. Re-fetch results from Signal
    let results;
    try {
      results = await getResults(org.signalTenantId, run.externalJobId, run.requestId);
    } catch (err: any) {
      console.error(`  ERROR fetching results: ${err.message}`);
      totalErrors++;
      continue;
    }

    if (!(results as any).data?.length) {
      console.log(`  SKIP: no candidates in Signal response`);
      totalSkipped++;
      continue;
    }

    console.log(`  Signal returned ${(results as any).data.length} candidates`);

    // 4. Build a lookup: signalCandidateId → { matchTier, locationMatchType }
    const tierMap = new Map<string, { matchTier: string | null; locationMatchType: string | null }>();
    for (const c of (results as any).data) {
      tierMap.set((c as any).candidate.id, {
        matchTier: (c as any).sourcingContext?.matchStrength ?? null,
        locationMatchType: (c as any).sourcingContext?.locationStatus ?? null,
      });
    }

    // Count how many have tier data
    const withTier = [...tierMap.values()].filter(v => v.matchTier !== null).length;
    const withLocType = [...tierMap.values()].filter(v => v.locationMatchType !== null).length;
    console.log(`  Tier data: ${withTier}/${tierMap.size} have matchTier, ${withLocType}/${tierMap.size} have locationMatchType`);

    if (withTier === 0 && withLocType === 0) {
      console.log(`  SKIP: Signal still not returning tier data for this run`);
      totalSkipped++;
      continue;
    }

    // 5. Fetch existing candidates from DB for this run
    const existing = await db.query.jobSourcedCandidates.findMany({
      where: and(
        eq(jobSourcedCandidates.jobId, run.jobId),
        eq(jobSourcedCandidates.requestId, run.requestId),
      ),
      columns: { id: true, signalCandidateId: true, candidateSummary: true },
    });

    console.log(`  DB has ${existing.length} candidates for this run`);

    let runPatched = 0;
    for (const row of existing) {
      const tierData = tierMap.get(row.signalCandidateId);
      if (!tierData) continue;

      const cs = (row.candidateSummary && typeof row.candidateSummary === 'object'
        ? row.candidateSummary
        : {}) as Record<string, unknown>;

      // Patch per-field: only overwrite if the existing value is missing
      const needsMatchTier = cs.matchTier == null && tierData.matchTier != null;
      const needsLocType = cs.locationMatchType == null && tierData.locationMatchType != null;
      if (!needsMatchTier && !needsLocType) continue;

      const patched = {
        ...cs,
        ...(needsMatchTier ? { matchTier: tierData.matchTier } : {}),
        ...(needsLocType ? { locationMatchType: tierData.locationMatchType } : {}),
      };

      if (!DRY_RUN) {
        await db.execute(sql`
          UPDATE job_sourced_candidates
          SET candidate_summary = ${JSON.stringify(patched)}::jsonb,
              updated_at = NOW()
          WHERE id = ${row.id}
        `);
      }
      runPatched++;
    }

    console.log(`  ${DRY_RUN ? 'Would patch' : 'Patched'} ${runPatched} candidates`);
    totalPatched += runPatched;
  }

  console.log('\n=== Summary ===');
  console.log(`  Runs processed: ${runs.length}`);
  console.log(`  Candidates ${DRY_RUN ? 'would be patched' : 'patched'}: ${totalPatched}`);
  console.log(`  Runs skipped: ${totalSkipped}`);
  console.log(`  Runs with errors: ${totalErrors}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  });
