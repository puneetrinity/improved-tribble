import type { Express, NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { CandidatePrivacyRestrictedError } from '../candidate-privacy/decision';
import { parseStrictJson, uuid } from './contracts';
import { resumeSourceRetryRequestSchema } from '../../shared/candidate-spark-v3';
import { ResumeSourceRepositoryError, queueRequestSchema, snapshotRequestSchema, type Actor,
  type ResumeSourceRepository, type SourceStatus } from './resume-source-repository';
import type { Snapshot } from './source-repository';

// P2 owner-only browser routes for "build my profile from my résumé". An injected
// factory: P0 mounts it and supplies the feature flag, repositories and middleware.
// The browser can choose only its own library resumeId, a source snapshot it was
// given, and an idempotency key. It never supplies a bucket path, URL, subject,
// binding, consent revision or page selection, and no response carries the
// internal scrub context. Every POST starts or can start paid work, so each one
// needs a verified candidate, CSRF and a recent login. Nothing retries on a GET.

type Middleware = (req: Request, res: Response, next: NextFunction) => void;
export interface ResumeSourceRouteDependencies {
  enabled: () => boolean;
  repo: Pick<ResumeSourceRepository, 'enqueue' | 'status' | 'retry' | 'retryStatus'>;
  /** sourceObjectDependencies(...).snapshot: locates the owned library resume and
   * registers its immutable generation before the snapshot routine. */
  snapshot: (actor: Actor, request: z.infer<typeof snapshotRequestSchema>) => Promise<Snapshot>;
  /** Trusted session identity: the current owner's subject and binding. */
  identity: (req: Request) => Promise<Actor>;
  requireCandidate: Middleware;
  csrf: Middleware;
  recentAuth: Middleware;
}

export const RESUME_SOURCE_PATHS = {
  snapshot: '/api/candidate/product/sources/resume-snapshots',
  queue: '/api/candidate/product/sources/resume',
  status: '/api/candidate/product/sources/resume/:commandId',
  retry: '/api/candidate/product/sources/resume/:commandId/retry',
} as const;

// Explicit projection: only these fields ever reach the browser.
const statusView = (s: SourceStatus) => ({ commandId: s.commandId, sourceId: s.sourceId, sourceVersion: s.sourceVersion,
  state: s.state, reason: s.reason, proposalId: s.proposalId });

function emptyQuery(req: Request) { return Object.keys(req.query).length === 0; }
function emptyRead(req: Request) {
  return emptyQuery(req) && !req.headers['transfer-encoding']
    && (!req.headers['content-length'] || req.headers['content-length'] === '0');
}
function jsonBody(req: Request): unknown {
  if (!emptyQuery(req) || !req.is('application/json')) throw Error('invalid_request');
  const raw = (req as Request & { rawBody?: string }).rawBody;
  if (typeof raw !== 'string') throw Error('invalid_request');
  return parseStrictJson(raw);
}
function failure(error: unknown, res: Response) {
  if (error instanceof ResumeSourceRepositoryError) { res.status(error.status).json({ code: error.code }); return; }
  if (error instanceof CandidatePrivacyRestrictedError && error.code === 'candidate_privacy_restricted') {
    res.status(451).json({ code: 'candidate_privacy_restricted' }); return;
  }
  if (error instanceof Error && error.message === 'source_changed') { res.status(409).json({ code: 'source_changed' }); return; }
  if (error instanceof Error && error.message === 'privacy_changed') { res.status(451).json({ code: 'candidate_privacy_restricted' }); return; }
  res.status(503).json({ code: 'resume_source_temporarily_unavailable', retryable: true });
}

export function registerResumeSourceRoutes(app: Express, deps: ResumeSourceRouteDependencies): void {
  const available: Middleware = (_req, res, next) => {
    if (!deps.enabled()) { res.status(404).json({ code: 'not_found' }); return; }
    res.setHeader('Cache-Control', 'no-store');
    next();
  };
  const post = [available, deps.requireCandidate, deps.csrf, deps.recentAuth];
  const parse = <T>(schema: z.ZodType<T>, req: Request, res: Response): T | null => {
    try { const r = schema.safeParse(jsonBody(req)); if (r.success) return r.data; } catch { /* falls through */ }
    res.status(422).json({ code: 'invalid_request' });
    return null;
  };

  app.post(RESUME_SOURCE_PATHS.snapshot, ...post, async (req, res) => {
    const request = parse(snapshotRequestSchema, req, res); if (!request) return;
    try { res.json(await deps.snapshot(await deps.identity(req), request)); } catch (error) { failure(error, res); }
  });

  app.post(RESUME_SOURCE_PATHS.queue, ...post, async (req, res) => {
    const request = parse(queueRequestSchema, req, res); if (!request) return;
    try { res.status(202).json(statusView(await deps.repo.enqueue(await deps.identity(req), request))); }
    catch (error) { failure(error, res); }
  });

  app.get(RESUME_SOURCE_PATHS.status, available, deps.requireCandidate, async (req, res) => {
    const commandId = req.params.commandId;
    if (!emptyRead(req) || !uuid.safeParse(commandId).success) { res.status(400).json({ code: 'invalid_request' }); return; }
    try {
      const actor = await deps.identity(req);
      const status = await deps.repo.status(actor, commandId!);
      // The Try-again offer is only ever read here; a GET never starts a retry.
      const retry = status.state === 'unavailable' || status.state === 'held' ? await deps.repo.retryStatus(actor, commandId!) : null;
      res.json({ ...statusView(status), retry: retry && { attemptsUsed: retry.attemptsUsed, maxAttempts: retry.maxAttempts,
        canRetry: retry.canRetry, canContinueWithoutResume: retry.canContinueWithoutResume, reason: retry.reason,
        // The approved candidate copy comes from P0 (validated string or null), e.g.
        // "Something went wrong reading your résumé." (P2-V4).
        message: retry.message } });
    } catch (error) { failure(error, res); }
  });

  app.post(RESUME_SOURCE_PATHS.retry, ...post, async (req, res) => {
    const commandId = req.params.commandId;
    const request = parse(resumeSourceRetryRequestSchema, req, res); if (!request) return;
    if (!uuid.safeParse(commandId).success || request.retryOfCommandId !== commandId) {
      res.status(422).json({ code: 'invalid_request' }); return;
    }
    try { res.status(202).json(statusView(await deps.repo.retry(await deps.identity(req), request))); }
    catch (error) { failure(error, res); }
  });
}
