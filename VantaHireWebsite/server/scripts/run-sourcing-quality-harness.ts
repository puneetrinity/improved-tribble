/**
 * Sourcing Quality Harness (Vanta-side)
 *
 * End-to-end validation harness for Signal -> Vanta sourcing quality.
 *
 * Features:
 * - Evaluate latest run per job OR trigger fresh runs first
 * - Poll until runs are terminal (completed/failed/expired)
 * - Print quality matrix similar to manual runbook
 * - Validate SERP signal coverage in ingested candidate summaries
 *
 * Usage:
 *   npx tsx --env-file=.env server/scripts/run-sourcing-quality-harness.ts --jobs 25,27,29
 *   npx tsx --env-file=.env server/scripts/run-sourcing-quality-harness.ts --jobs 25,27,29 --trigger
 *   npx tsx --env-file=.env server/scripts/run-sourcing-quality-harness.ts --jobs 25,27,29 --trigger --poll-seconds 1200 --interval-seconds 10
 *
 * Optional env:
 * - SIGNAL_CALLBACK_URL (used when --trigger)
 * - BASE_URL (fallback to build callback URL when --trigger)
 */

import { and, desc, eq } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { db } from '../db';
import { jobs, jobSourcingRuns, jobSourcedCandidates, organizations } from '@shared/schema';
import { sourceJob } from '../lib/services/signal-client';
import { generateJDDigest, CURRENT_DIGEST_VERSION } from '../lib/jdDigest';

interface HarnessOptions {
  jobIds: number[];
  trigger: boolean;
  pollSeconds: number;
  intervalSeconds: number;
}

interface HarnessRow {
  jobId: number;
  jobTitle: string;
  runStatus: string;
  requestId: string;
  track: string;
  selectedSnapshotTrack: string;
  requestedLocation: string;
  expansionReason: string;
  bestMatches: number;
  broaderPool: number;
  strictDemotedCount: number;
  discoveryMode: string;
  strictQueriesExecuted: number;
  fallbackQueriesExecuted: number;
  stoppedReason: string;
  providerUsage: string;
  groqUsed: string;
  serpDateCoverage: string;
  localeCoverage: string;
  enrichment: string;
  note: string;
}

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'expired']);

function parseArgs(argv: string[]): HarnessOptions {
  const args = new Map<string, string | boolean>();

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token) continue;
    if (!token.startsWith('--')) continue;

    const stripped = token.slice(2);
    const eqIdx = stripped.indexOf('=');
    if (eqIdx >= 0) {
      args.set(stripped.slice(0, eqIdx), stripped.slice(eqIdx + 1));
      continue;
    }

    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args.set(stripped, next);
      i++;
    } else {
      args.set(stripped, true);
    }
  }

  const jobsRaw = args.get('jobs');
  if (typeof jobsRaw !== 'string' || !jobsRaw.trim()) {
    throw new Error('Missing required --jobs (example: --jobs 25,27,29)');
  }

  const jobIds = jobsRaw
    .split(',')
    .map((x) => parseInt(x.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);

  if (jobIds.length === 0) {
    throw new Error('No valid job IDs found in --jobs');
  }

  const trigger = args.get('trigger') === true;
  const pollSeconds = parseInt(String(args.get('poll-seconds') ?? '900'), 10);
  const intervalSeconds = parseInt(String(args.get('interval-seconds') ?? '7'), 10);

  return {
    jobIds,
    trigger,
    pollSeconds: Number.isFinite(pollSeconds) && pollSeconds > 0 ? pollSeconds : 900,
    intervalSeconds: Number.isFinite(intervalSeconds) && intervalSeconds > 0 ? intervalSeconds : 7,
  };
}

function safeRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function readString(obj: Record<string, unknown> | null, key: string): string | null {
  if (!obj || !(key in obj)) return null;
  const value = obj[key];
  if (value == null) return null;
  return typeof value === 'string' ? value : null;
}

function readNumber(obj: Record<string, unknown> | null, key: string): number | null {
  if (!obj || !(key in obj)) return null;
  const value = obj[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readBoolean(obj: Record<string, unknown> | null, key: string): boolean | null {
  if (!obj || !(key in obj)) return null;
  const value = obj[key];
  return typeof value === 'boolean' ? value : null;
}

function formatProviderUsage(value: unknown): string {
  const map = safeRecord(value);
  if (!map) return '-';
  const parts = Object.entries(map)
    .map(([k, v]) => [k, typeof v === 'number' && Number.isFinite(v) ? v : null] as const)
    .filter(([, v]) => v !== null)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => `${k}:${v}`);
  return parts.length > 0 ? parts.join(', ') : '-';
}

function pad(value: string, width: number): string {
  if (value.length >= width) return value;
  return value + ' '.repeat(width - value.length);
}

function printTable(headers: string[], rows: string[][]): void {
  const widths = headers.map((h, idx) => {
    const maxRow = Math.max(...rows.map((r) => (r[idx] ?? '').length), 0);
    return Math.max(h.length, maxRow);
  });

  const headerLine = headers.map((h, i) => pad(h, widths[i] ?? h.length)).join(' | ');
  const sepLine = widths.map((w) => '-'.repeat(w)).join('-+-');

  console.log(headerLine);
  console.log(sepLine);
  for (const row of rows) {
    console.log(row.map((cell, i) => pad(cell, widths[i] ?? cell.length)).join(' | '));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveCallbackUrl(): string {
  const explicit = process.env.SIGNAL_CALLBACK_URL?.trim();
  if (explicit) return explicit;

  const base = process.env.BASE_URL?.trim();
  if (!base) {
    throw new Error('For --trigger, set SIGNAL_CALLBACK_URL or BASE_URL');
  }
  return `${base.replace(/\/+$/, '')}/api/webhooks/signal/callback`;
}

async function triggerRun(jobId: number): Promise<string> {
  const job = await db.query.jobs.findFirst({
    where: eq(jobs.id, jobId),
    columns: {
      id: true,
      organizationId: true,
      title: true,
      description: true,
      skills: true,
      goodToHaveSkills: true,
      location: true,
      experienceYears: true,
      educationRequirement: true,
      jdDigest: true,
      jdDigestVersion: true,
    },
  });

  if (!job) {
    throw new Error(`Job ${jobId} not found`);
  }
  if (!job.organizationId) {
    throw new Error(`Job ${jobId} has no organizationId`);
  }

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, job.organizationId),
    columns: { id: true, signalTenantId: true },
  });

  if (!org?.signalTenantId) {
    throw new Error(`Organization ${job.organizationId} has no signalTenantId`);
  }

  const callbackUrl = resolveCallbackUrl();
  const externalJobId = `vanta:jobs:${job.id}`;

  // Ensure JD digest exists before sourcing (same as signal.routes.ts)
  let jdDigest = job.jdDigest as Record<string, unknown> | null;
  if (!jdDigest || !job.jdDigestVersion || job.jdDigestVersion < CURRENT_DIGEST_VERSION) {
    let generated = await generateJDDigest(job.title, job.description ?? '', { location: job.location });
    if (generated.topSkills.length === 0) {
      generated = await generateJDDigest(job.title, job.description ?? '', { location: job.location });
    }
    await db.update(jobs).set({
      jdDigest: generated,
      jdDigestVersion: generated.version,
    }).where(eq(jobs.id, job.id));
    jdDigest = generated as unknown as Record<string, unknown>;
  }

  const response = await sourceJob(org.signalTenantId, externalJobId, {
    jobContext: {
      jdDigest: JSON.stringify(jdDigest),
      title: job.title,
      skills: Array.isArray(job.skills) ? (job.skills as string[]) : [],
      goodToHaveSkills: Array.isArray(job.goodToHaveSkills) ? (job.goodToHaveSkills as string[]) : [],
      location: job.location ?? '',
      experienceYears: job.experienceYears ?? undefined,
      education: job.educationRequirement ?? undefined,
    },
    callbackUrl,
  });

  const existing = await db.query.jobSourcingRuns.findFirst({
    where: eq(jobSourcingRuns.requestId, response.requestId),
    columns: { id: true, requestId: true },
  });

  if (!existing) {
    await db.insert(jobSourcingRuns).values({
      organizationId: job.organizationId,
      jobId: job.id,
      requestId: response.requestId,
      externalJobId,
      status: 'submitted',
      contextHash: createHash('sha256').update(`harness:${job.id}:${randomUUID()}`).digest('hex'),
      callbackUrl,
      meta: {
        requestedLocation: job.location,
        harnessTriggeredAt: new Date().toISOString(),
      },
      submittedAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
  }

  return response.requestId;
}

async function waitForTerminal(requestIds: string[], pollSeconds: number, intervalSeconds: number): Promise<void> {
  const deadline = Date.now() + pollSeconds * 1000;

  while (Date.now() < deadline) {
    const states: string[] = [];
    let allTerminal = true;

    for (const requestId of requestIds) {
      const run = await db.query.jobSourcingRuns.findFirst({
        where: eq(jobSourcingRuns.requestId, requestId),
        columns: { requestId: true, status: true },
      });
      const status = run?.status ?? 'missing';
      states.push(`${requestId.slice(0, 8)}:${status}`);
      if (!TERMINAL_STATUSES.has(status)) {
        allTerminal = false;
      }
    }

    console.log(`poll ${new Date().toISOString()}: ${states.join(' | ')}`);
    if (allTerminal) return;
    await sleep(intervalSeconds * 1000);
  }

  console.log(`poll timeout after ${pollSeconds}s`);
}

async function evaluateJob(jobId: number, preferredRequestId?: string): Promise<HarnessRow> {
  const job = await db.query.jobs.findFirst({
    where: eq(jobs.id, jobId),
    columns: { id: true, title: true },
  });

  if (!job) {
    return {
      jobId,
      jobTitle: 'not_found',
      runStatus: 'missing',
      requestId: '-',
      track: '-',
      selectedSnapshotTrack: '-',
      requestedLocation: '-',
      expansionReason: '-',
      bestMatches: 0,
      broaderPool: 0,
      strictDemotedCount: 0,
      discoveryMode: '-',
      strictQueriesExecuted: 0,
      fallbackQueriesExecuted: 0,
      stoppedReason: '-',
      providerUsage: '-',
      groqUsed: '-',
      serpDateCoverage: '0/0',
      localeCoverage: '0/0',
      enrichment: '-',
      note: 'job_not_found',
    };
  }

  const run = preferredRequestId
    ? await db.query.jobSourcingRuns.findFirst({
        where: eq(jobSourcingRuns.requestId, preferredRequestId),
        orderBy: desc(jobSourcingRuns.createdAt),
      })
    : await db.query.jobSourcingRuns.findFirst({
        where: eq(jobSourcingRuns.jobId, jobId),
        orderBy: desc(jobSourcingRuns.createdAt),
      });

  if (!run) {
    return {
      jobId,
      jobTitle: job.title,
      runStatus: 'missing',
      requestId: '-',
      track: '-',
      selectedSnapshotTrack: '-',
      requestedLocation: '-',
      expansionReason: '-',
      bestMatches: 0,
      broaderPool: 0,
      strictDemotedCount: 0,
      discoveryMode: '-',
      strictQueriesExecuted: 0,
      fallbackQueriesExecuted: 0,
      stoppedReason: '-',
      providerUsage: '-',
      groqUsed: '-',
      serpDateCoverage: '0/0',
      localeCoverage: '0/0',
      enrichment: '-',
      note: 'run_not_found',
    };
  }

  const candidates = await db.query.jobSourcedCandidates.findMany({
    where: and(eq(jobSourcedCandidates.jobId, jobId), eq(jobSourcedCandidates.requestId, run.requestId)),
    columns: {
      id: true,
      state: true,
      sourceType: true,
      candidateSummary: true,
    },
  });

  const meta = safeRecord(run.meta);
  const trackDecision = safeRecord(meta?.trackDecision);
  const groupCounts = safeRecord(meta?.groupCounts);
  const diagnostics = safeRecord(meta?.diagnostics);
  const discoveryTelemetry = safeRecord(diagnostics?.discoveryTelemetry);
  const enrichmentProgress = safeRecord(meta?.enrichmentProgress);

  const track = readString(trackDecision, 'track') ?? '-';
  const selectedSnapshotTrack = readString(groupCounts, 'selectedSnapshotTrack') ?? '-';

  const requestedLocation =
    readString(groupCounts, 'requestedLocation') ??
    readString(meta, 'requestedLocation') ??
    '-';

  const expansionReason =
    readString(groupCounts, 'expansionReason') ??
    readString(meta, 'expansionReason') ??
    '-';

  const bestMatchesFromMeta = readNumber(groupCounts, 'bestMatches');
  const broaderPoolFromMeta = readNumber(groupCounts, 'broaderPool');

  let bestMatchesFromRows = 0;
  let broaderPoolFromRows = 0;
  let serpDateCount = 0;
  let localeCount = 0;
  let enrichedCount = 0;
  let pendingCount = 0;

  for (const row of candidates) {
    const summary = safeRecord(row.candidateSummary);
    const matchTier = readString(summary, 'matchTier');
    if (matchTier === 'best_matches') bestMatchesFromRows++;
    else if (matchTier === 'broader_pool') broaderPoolFromRows++;

    const searchSignals = safeRecord(summary?.searchSignals);
    const searchMeta = safeRecord(summary?.searchMeta);
    const serperMeta = safeRecord(searchMeta?.serper);

    const serpDate = readString(searchSignals, 'serpDate') ?? readString(serperMeta, 'resultDate');
    const locale = readString(searchSignals, 'linkedinLocale') ?? readString(serperMeta, 'linkedinLocale');

    if (serpDate) serpDateCount++;
    if (locale) localeCount++;

    const enrichmentStatusRaw =
      readString(summary, 'enrichmentStatus') ??
      (typeof row.state === 'string' ? row.state : null) ??
      '';
    const enrichmentStatus = enrichmentStatusRaw.toLowerCase();

    if (enrichmentStatus === 'completed' || enrichmentStatus === 'enriched') {
      enrichedCount++;
    } else {
      pendingCount++;
    }
  }

  const bestMatches = bestMatchesFromMeta ?? bestMatchesFromRows;
  const broaderPool = broaderPoolFromMeta ?? broaderPoolFromRows;

  const strictDemotedCount = readNumber(groupCounts, 'strictDemotedCount') ?? 0;

  const discoveryMode = readString(discoveryTelemetry, 'mode') ?? '-';
  const strictQueriesExecuted = readNumber(discoveryTelemetry, 'strictQueriesExecuted') ?? 0;
  const fallbackQueriesExecuted = readNumber(discoveryTelemetry, 'fallbackQueriesExecuted') ?? 0;
  const stoppedReason = readString(discoveryTelemetry, 'stoppedReason') ?? '-';
  const providerUsage = formatProviderUsage(discoveryTelemetry?.providerUsage);

  const groqObj = safeRecord(discoveryTelemetry?.groq);
  const groqUsedRaw = readBoolean(groqObj, 'used');
  const groqUsed = groqUsedRaw == null ? '-' : String(groqUsedRaw);

  const totalCandidates = candidates.length;
  const serpDateCoverage = `${serpDateCount}/${totalCandidates}`;
  const localeCoverage = `${localeCount}/${totalCandidates}`;

  const progressEnriched = readNumber(enrichmentProgress, 'enrichedCount');
  const progressPending = readNumber(enrichmentProgress, 'pendingCount');
  const progressTotal = readNumber(enrichmentProgress, 'totalCandidates');
  const enrichment = progressTotal != null
    ? `${progressEnriched ?? 0}/${progressTotal} (+pending ${progressPending ?? 0})`
    : `${enrichedCount}/${totalCandidates} (+pending ${pendingCount})`;

  const noteParts: string[] = [];
  if (run.status !== 'completed') noteParts.push(`run_${run.status}`);
  if (track === 'non_tech' && selectedSnapshotTrack !== 'non-tech') noteParts.push('track_snapshot_mismatch');
  if (requestedLocation === '-') noteParts.push('missing_requested_location');

  return {
    jobId,
    jobTitle: job.title,
    runStatus: run.status,
    requestId: run.requestId,
    track,
    selectedSnapshotTrack,
    requestedLocation,
    expansionReason,
    bestMatches,
    broaderPool,
    strictDemotedCount,
    discoveryMode,
    strictQueriesExecuted,
    fallbackQueriesExecuted,
    stoppedReason,
    providerUsage,
    groqUsed,
    serpDateCoverage,
    localeCoverage,
    enrichment,
    note: noteParts.length > 0 ? noteParts.join(',') : 'ok',
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  console.log('=== Sourcing Quality Harness ===');
  console.log(`jobs: ${opts.jobIds.join(', ')}`);
  console.log(`trigger: ${opts.trigger ? 'yes' : 'no'}`);
  console.log(`poll: ${opts.pollSeconds}s @ ${opts.intervalSeconds}s interval`);

  const requestIdsByJob = new Map<number, string>();

  if (opts.trigger) {
    console.log('\nTriggering runs...');
    for (const jobId of opts.jobIds) {
      const requestId = await triggerRun(jobId);
      requestIdsByJob.set(jobId, requestId);
      console.log(`job ${jobId} -> requestId ${requestId}`);
    }

    console.log('\nWaiting for terminal status...');
    await waitForTerminal([...requestIdsByJob.values()], opts.pollSeconds, opts.intervalSeconds);
  }

  console.log('\nCollecting metrics...');
  const rows: HarnessRow[] = [];
  for (const jobId of opts.jobIds) {
    rows.push(await evaluateJob(jobId, requestIdsByJob.get(jobId)));
  }

  console.log('\n3-Job Quality Matrix');
  printTable(
    [
      'job',
      'status',
      'track',
      'snapTrack',
      'requestedLocation',
      'expansionReason',
      'best/broader',
      'strictDemoted',
      'mode',
      'strictQ',
      'fallbackQ',
      'stoppedReason',
      'providerUsage',
      'groqUsed',
      'serpDateCov',
      'localeCov',
      'enrichment',
      'note',
    ],
    rows.map((r) => [
      `${r.jobId} (${r.jobTitle.slice(0, 24)})`,
      r.runStatus,
      r.track,
      r.selectedSnapshotTrack,
      r.requestedLocation,
      r.expansionReason,
      `${r.bestMatches}/${r.broaderPool}`,
      String(r.strictDemotedCount),
      r.discoveryMode,
      String(r.strictQueriesExecuted),
      String(r.fallbackQueriesExecuted),
      r.stoppedReason,
      r.providerUsage,
      r.groqUsed,
      r.serpDateCoverage,
      r.localeCoverage,
      r.enrichment,
      r.note,
    ]),
  );

  console.log('\nChecklist');
  for (const row of rows) {
    const checks: string[] = [];
    checks.push(row.runStatus === 'completed' ? 'run_completed' : `run_${row.runStatus}`);
    checks.push(row.requestedLocation !== '-' ? 'requestedLocation_ok' : 'requestedLocation_missing');
    if (row.track === 'non_tech') {
      checks.push(row.selectedSnapshotTrack === 'non-tech' ? 'snapshotTrack_ok' : 'snapshotTrack_mismatch');
    }
    checks.push(row.strictQueriesExecuted + row.fallbackQueriesExecuted > 0 ? 'queries_ok' : 'queries_zero');
    checks.push(row.serpDateCoverage !== '0/0' ? 'serp_signals_present' : 'no_candidates');
    console.log(`- job ${row.jobId}: ${checks.join(', ')}`);
  }

  console.log('\n=== Done ===');
}

main().catch((error) => {
  console.error('Harness failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
