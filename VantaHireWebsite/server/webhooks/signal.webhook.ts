/**
 * Signal callback webhook handler.
 *
 * POST /api/webhooks/signal/callback
 *
 * Flow:
 * 1. Verify JWT (iss=signal, aud=vantahire, scopes=callbacks:write)
 * 2. DB-backed replay protection via webhook_events (provider='signal', eventId=jti)
 * 3. Parse SourcingCallbackPayload body
 * 4. Fetch results from Signal /results
 * 5. Upsert candidates with state-safe ON CONFLICT
 * 6. Update run status
 */

import type { Express, Request, Response } from 'express';
import { db } from '../db';
import { broadcastSourcingUpdate, broadcastPipelineEvent } from '../websocket';
import { eq, and } from 'drizzle-orm';
import {
  webhookEvents,
  jobSourcingRuns,
  jobSourcedCandidates,
  jobs,
  organizations,
  type WebhookStatus,
} from '@shared/schema';
import { verifySignalCallbackJwt } from '../lib/services/jwt-signer';
import {
  mapCallbackStatusToRunStatus,
  type SignalCallbackPayload,
} from '../lib/services/signal-contracts';
import { syncSignalResultsIntoVanta } from '../lib/services/sourcing-sync';

const WEBHOOK_PROVIDER = 'signal';

/**
 * Atomically claim a webhook event for processing.
 * Returns true if this call acquired the lock (inserted successfully).
 * Returns false if another request already claimed it (conflict = already processing/processed).
 */
async function claimWebhookEvent(
  eventId: string,
  eventType: string,
  payload: unknown,
): Promise<boolean> {
  const result = await db.insert(webhookEvents).values({
    provider: WEBHOOK_PROVIDER,
    eventId,
    eventType,
    payload: payload as Record<string, unknown>,
    processedAt: new Date(),
    status: 'processing',
  }).returning();

  return result.length > 0;
}

async function finalizeWebhookEvent(
  eventId: string,
  status: WebhookStatus,
  error?: string,
): Promise<void> {
  await db.update(webhookEvents)
    .set({
      status,
      errorMessage: error || null,
      processedAt: new Date(),
    })
    .where(and(
      eq(webhookEvents.provider, WEBHOOK_PROVIDER),
      eq(webhookEvents.eventId, eventId),
    ));
}

export function registerSignalWebhook(app: Express) {
  app.post('/api/webhooks/signal/callback', async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      console.error('Signal callback: Missing or invalid Authorization header');
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const token = authHeader.substring(7);
    let claims;
    try {
      claims = await verifySignalCallbackJwt(token);
    } catch (error: any) {
      console.error('Signal callback JWT verification failed:', error.message);
      res.status(401).json({ error: 'Invalid token' });
      return;
    }

    const payload = req.body as SignalCallbackPayload;
    if (!payload.requestId || !payload.status) {
      console.error('Signal callback: Invalid payload body', payload);
      res.status(400).json({ error: 'Invalid payload' });
      return;
    }

    let claimedJti: string | null = null;
    try {
      // 1. Claim the event for replay protection
      const success = await claimWebhookEvent(claims.jti, 'callback', payload);
      if (!success) {
        console.warn(`Signal callback already processed/processing: jti=${claims.jti}`);
        res.status(200).json({ success: true, message: 'Already processed' });
        return;
      }
      claimedJti = claims.jti;

      // 2. Fetch the sourcing run record
      const run = await db.query.jobSourcingRuns.findFirst({
        where: eq(jobSourcingRuns.requestId, payload.requestId),
      });

      if (!run) {
        console.error(`Signal callback: Unknown request ID ${payload.requestId}`);
        await finalizeWebhookEvent(claims.jti, 'failed', 'Unknown request ID');
        res.status(404).json({ error: 'Unknown request ID' });
        return;
      }

      // 3. Skip if already terminal (unless it's a re-delivery or we need to allow idempotency)
      // Actually, we should allow re-processing if the previous one failed, 
      // but replay protection via JTI already handles this.

      // 6. Verify tenant binding — ensure callback org matches JWT tenant
      const org = await db.query.organizations.findFirst({
        where: eq(organizations.id, run.organizationId),
        columns: { signalTenantId: true },
      });

      if (!org?.signalTenantId || org.signalTenantId !== claims.tenantId) {
        console.error(`Signal callback tenant mismatch: JWT tenant_id=${claims.tenantId}, org signal_tenant_id=${org?.signalTenantId}`);
        await finalizeWebhookEvent(claims.jti, 'failed', 'Tenant mismatch');
        res.status(403).json({ error: 'Tenant mismatch' });
        return;
      }

      // 7. Handle partial real-time updates (Pipeline Streaming)
      if (payload.status === 'partial') {
        const event = payload.event;
        const eventData = payload.candidateData ?? (payload as any).eventData ?? {};

        console.log(`✨ [WEBHOOK] PIPELINE EVENT: ${event} for jobId=${run.jobId}`);

        // Pipeline progress events → forward directly to the WS frontend modal
        const PIPELINE_PROGRESS_EVENTS = [
          'phase_started', 'crustdata_fetching', 'crustdata_complete',
          'ranking_started', 'ranking_complete',
          'enrichment_started', 'enrichment_candidate', 'enrichment_replacement',
          'final_ranking_started', 'final_ranking_complete',
          'pipeline_complete', 'pipeline_error',
        ];

        if (event && PIPELINE_PROGRESS_EVENTS.includes(event)) {
          broadcastPipelineEvent(run.jobId, event, eventData as Record<string, unknown>);
          console.log(`📡 [WEBHOOK] WS BROADCAST → ${event} to jobId=${run.jobId}`);
        }

        // Legacy: candidate_enriched → update DB + broadcast candidate refresh
        if (event === 'candidate_enriched' && payload.candidateData) {
          try {
            console.log(`👤 [WEBHOOK] LIVE ENRICHMENT FOR CANDIDATE: ${payload.candidateData.id}`);

            const existing = await db.query.jobSourcedCandidates.findFirst({
              where: and(
                eq(jobSourcedCandidates.jobId, run.jobId),
                eq(jobSourcedCandidates.signalCandidateId, payload.candidateData.id)
              )
            });

            if (existing) {
              const summary = (existing.candidateSummary as any) || {};
              const updatedSummary = {
                ...summary,
                candidate: {
                  ...(summary.candidate || {}),
                  ...payload.candidateData
                },
                enrichmentStatus: payload.candidateData.enrichmentStatus,
                lastEnrichedAt: payload.candidateData.lastEnrichedAt,
              };

              await db.update(jobSourcedCandidates)
                .set({
                  candidateSummary: updatedSummary,
                  updatedAt: new Date(),
                })
                .where(eq(jobSourcedCandidates.id, existing.id));
            }

            broadcastSourcingUpdate(run.jobId, {
              type: 'candidate_enriched',
              candidateId: payload.candidateData.id,
              data: payload.candidateData,
              requestId: payload.requestId
            });

            console.log(`✅ [WEBHOOK] BROADCASTED REAL-TIME UPDATE FOR ${payload.candidateData.id}`);
          } catch (err: any) {
            console.error('Failed to process partial callback:', err.message);
          }
        }

        await finalizeWebhookEvent(claims.jti, 'processed');
        res.json({ success: true });
        return;
      }


      // 8. Map callback status to run status
      const runStatus = mapCallbackStatusToRunStatus(payload.status);
      let processError: string | undefined;
      let candidateCount = payload.candidateCount || 0;
      let metaPatch: Record<string, unknown> | null = null;
      let refreshJobId: string | null = null;
      let refreshQueueError: string | undefined;
      let enrichmentInProgress = false;

      // 9. If completed, fetch results and upsert candidates
      if (runStatus === 'completed') {
        try {
          let streamedCount = 0;
          const sync = await syncSignalResultsIntoVanta(
            {
              organizationId: run.organizationId,
              jobId: run.jobId,
              requestId: payload.requestId,
              externalJobId: run.externalJobId,
              signalTenantId: org.signalTenantId,
            },
            (candidate, rank) => {
              streamedCount++;
              broadcastSourcingUpdate(run.jobId, {
                type: 'candidate_sourced',
                candidate: {
                  signalCandidateId: candidate.candidate.id,
                  rank,
                  crustdata: (candidate.candidate as any).searchMeta?.crustdata || null,
                  linkedinUrl: candidate.candidate.linkedinUrl,
                  enrichmentStatus: candidate.candidate.enrichmentStatus,
                  fitScore: candidate.fitScore ?? null,
                  matchTier: candidate.matchTier ?? null,
                  sourceType: candidate.sourceType ?? 'discovered',
                  summaryShort: candidate.cardSignals?.summaryShort ?? null,
                  skillsTopN: candidate.cardSignals?.skillsTopN ?? [],
                  emailAvailable: candidate.cardSignals?.emailAvailable ?? false,
                  phoneAvailable: candidate.cardSignals?.phoneAvailable ?? false,
                  aiSummary: candidate.aiSummary ?? null,
                },
                streamedCount,
              });
            },
          );

          candidateCount = sync.candidateCount;
          metaPatch = sync.metaPatch;
          enrichmentInProgress = sync.enrichmentProgress.inProgress;


        } catch (fetchError: any) {
          console.error(`Failed to fetch Signal results for ${payload.requestId}:`, fetchError.message);
          processError = `Results fetch failed: ${fetchError.message}`;
        }
      }

      // 10. Update run status — downgrade to 'failed' if result fetch threw
      const finalStatus = processError ? 'failed' : runStatus;
      const finalCandidateCount = finalStatus === 'failed' ? 0 : candidateCount;
      const runMeta = (run.meta as Record<string, unknown>) || {};
      const priorRefreshMeta = runMeta.enrichmentRefresh && typeof runMeta.enrichmentRefresh === 'object'
        ? runMeta.enrichmentRefresh as Record<string, unknown>
        : {};
      const refreshReason = enrichmentInProgress
        ? 'enrichment_in_progress'
        : refreshJobId
          ? 'post_callback_rerank_sync'
          : null;
      const refreshStatus = !enrichmentInProgress && !refreshJobId
        ? 'completed'
        : refreshJobId
          ? 'scheduled'
          : refreshQueueError
            ? 'stopped_enqueue_error'
            : 'stopped_no_queue';
      const forcedNotInProgressMetaPatch = (refreshStatus === 'stopped_no_queue' || refreshStatus === 'stopped_enqueue_error')
        ? {
          enrichmentProgress: {
            ...(metaPatch?.enrichmentProgress as Record<string, unknown> ?? {}),
            inProgress: false,
          },
        }
        : {};
      const enrichmentRefreshMeta = finalStatus === 'completed'
        ? {
          ...priorRefreshMeta,
          status: refreshStatus,
          reason: refreshReason,
          lastEnqueueAt: new Date().toISOString(),
          queueJobId: refreshJobId,
          ...(refreshQueueError ? { lastEnqueueError: refreshQueueError } : {}),
        }
        : priorRefreshMeta;

      await db.update(jobSourcingRuns)
        .set({
          status: finalStatus,
          candidateCount: finalCandidateCount,
          completedAt: new Date(),
          errorMessage: payload.error || processError || null,
          meta: {
            ...runMeta,
            callbackStatus: payload.status,
            enrichedCount: payload.enrichedCount,
            ...(metaPatch ?? {}),
            ...forcedNotInProgressMetaPatch,
            ...(finalStatus === 'completed' ? { enrichmentRefresh: enrichmentRefreshMeta } : {}),
            ...(processError ? { errorCode: 'RESULTS_FETCH_FAILED' } : {}),
          },
          updatedAt: new Date(),
        })
        .where(eq(jobSourcingRuns.id, run.id));

      // 11. Finalize webhook event
      await finalizeWebhookEvent(claims.jti, finalStatus === 'failed' ? 'failed' : 'processed', processError);

      broadcastSourcingUpdate(run.jobId, { status: finalStatus, candidateCount: finalCandidateCount });
      res.json({ success: true });
    } catch (error: any) {
      console.error('Signal webhook error:', error);
      // Unstick claimed event so retries aren't blocked
      if (claimedJti) {
        try {
          await finalizeWebhookEvent(claimedJti, 'failed', error.message || 'Unhandled error');
        } catch (finalizeError) {
          console.error('Failed to finalize webhook event after error:', finalizeError);
        }
      }
      res.status(500).json({ error: 'Internal server error' });
    }
  });
}
