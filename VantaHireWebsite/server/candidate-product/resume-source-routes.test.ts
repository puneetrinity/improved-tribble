import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Express } from 'express';
vi.mock('../candidate-privacy/decision', () => ({
  CandidatePrivacyRestrictedError: class extends Error { constructor(public code: string) { super(code); } },
}));
import { CandidatePrivacyRestrictedError } from '../candidate-privacy/decision';
import { registerResumeSourceRoutes, RESUME_SOURCE_PATHS } from './resume-source-routes';
import { ResumeSourceRepositoryError } from './resume-source-repository';

const KEY = '11111111-1111-4111-8111-111111111111';
const SRC = '22222222-2222-4222-8222-222222222222';
const CMD = '33333333-3333-4333-8333-333333333333';
const NEXT = '44444444-4444-4444-8444-444444444444';
const ACTOR = { userId: 7, subjectId: '55555555-5555-4555-8555-555555555555', bindingId: '66666666-6666-4666-8666-666666666666' };
const EMAIL = 'priya.rao@example.com';
const status = (over: Record<string, unknown> = {}) =>
  ({ commandId: CMD, sourceId: SRC, sourceVersion: 1, state: 'queued', reason: null, proposalId: null, ...over });
const retryView = (over: Record<string, unknown> = {}) => ({ schemaVersion: 1, commandId: CMD, attemptsUsed: 1, maxAttempts: 3,
  canRetry: true, canContinueWithoutResume: true, reason: null, message: null, ...over });

const enabled = { value: true };
const deps = {
  enabled: () => enabled.value,
  repo: { enqueue: vi.fn(), status: vi.fn(), retry: vi.fn(), retryStatus: vi.fn() },
  snapshot: vi.fn(),
  identity: vi.fn(async () => ACTOR),
  requireCandidate: (req: any, res: any, next: () => void) => {
    if (!req.user) { res.status(401).json({ code: 'authentication_required' }); return; }
    if (req.user.role !== 'candidate') { res.status(403).json({ code: 'candidate_required' }); return; }
    next();
  },
  csrf: (req: any, res: any, next: () => void) => { if (req.csrf) next(); else res.status(403).json({ code: 'csrf_required' }); },
  recentAuth: (req: any, res: any, next: () => void) => { if (req.recent) next(); else res.status(403).json({ code: 'recent_auth_required' }); },
};
const chains = new Map<string, Array<(req: any, res: any, next: () => void) => unknown>>();
registerResumeSourceRoutes({ get: (p: string, ...h: any[]) => chains.set(`GET ${p}`, h),
  post: (p: string, ...h: any[]) => chains.set(`POST ${p}`, h) } as unknown as Express, deps as never);

async function call(route: string, change: Record<string, unknown> = {}, params: Record<string, string> = {}) {
  const req = { user: { id: 7, role: 'candidate' }, query: {}, headers: {}, csrf: true, recent: true, is: () => true,
    params, rawBody: '{}', ...change };
  const res = { statusCode: 200, body: undefined as any, headers: {} as Record<string, string>,
    setHeader(k: string, v: string) { this.headers[k] = v; }, status(n: number) { this.statusCode = n; return this; },
    json(v: unknown) { this.body = v; return this; } };
  for (const fn of chains.get(route)!) { let next = false; await fn(req, res, () => { next = true; }); if (!next) break; }
  return res;
}
const snapshotBody = JSON.stringify({ schemaVersion: 1, idempotencyKey: KEY, resumeId: 12 });
const queueBody = JSON.stringify({ schemaVersion: 1, idempotencyKey: KEY, sourceId: SRC, sourceVersion: 1 });
const retryBody = JSON.stringify({ schemaVersion: 1, idempotencyKey: KEY, retryOfCommandId: CMD });
const P = RESUME_SOURCE_PATHS;
const allPosts: Array<[string, string, Record<string, string>]> = [
  [`POST ${P.snapshot}`, snapshotBody, {}], [`POST ${P.queue}`, queueBody, {}], [`POST ${P.retry}`, retryBody, { commandId: CMD }]];

beforeEach(() => {
  vi.clearAllMocks(); enabled.value = true;
  deps.snapshot.mockResolvedValue({ schemaVersion: 1, sourceId: SRC, sourceVersion: 1, contentHash: 'a'.repeat(64) });
  deps.repo.enqueue.mockResolvedValue(status());
  deps.repo.status.mockResolvedValue(status());
  deps.repo.retry.mockResolvedValue(status({ commandId: NEXT }));
  deps.repo.retryStatus.mockResolvedValue(retryView());
});

describe('résumé source routes', () => {
  it('stays dark (404) when the feature is off, before any authority or repository call', async () => {
    enabled.value = false;
    for (const [route, rawBody, params] of allPosts) expect((await call(route, { rawBody, user: null }, params)).statusCode).toBe(404);
    expect((await call(`GET ${P.status}`, { user: null }, { commandId: CMD })).statusCode).toBe(404);
    expect(deps.identity).not.toHaveBeenCalled();
    expect(deps.snapshot).not.toHaveBeenCalled();
  });

  it.each([
    ['no session', { user: null }, 401], ['a recruiter', { user: { id: 8, role: 'recruiter' } }, 403],
    ['no CSRF token', { csrf: false }, 403],
  ])('every paid-work POST refuses %s', async (_l, change, code) => {
    for (const [route, rawBody, params] of allPosts) expect((await call(route, { rawBody, ...change }, params)).statusCode).toBe(code);
    expect(deps.snapshot).not.toHaveBeenCalled();
    expect(deps.repo.enqueue).not.toHaveBeenCalled();
    expect(deps.repo.retry).not.toHaveBeenCalled();
  });

  it('allows an authenticated candidate with an older login to snapshot, queue and retry', async () => {
    for (const [route, rawBody, params] of allPosts) {
      expect((await call(route, { rawBody, recent: false }, params)).statusCode).toBeLessThan(300);
    }
  });

  it('snapshots only the owner\'s library résumé by id, with the session identity', async () => {
    const res = await call(`POST ${P.snapshot}`, { rawBody: snapshotBody });
    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(deps.snapshot).toHaveBeenCalledWith(ACTOR, { schemaVersion: 1, idempotencyKey: KEY, resumeId: 12 });
  });

  it.each([
    ['a bucket path', { gcsPath: 'gs://bucket/x.pdf' }], ['a URL', { url: 'https://evil.example/cv.pdf' }],
    ['a subject id', { subjectId: ACTOR.subjectId }], ['a page selection', { pageNumbers: [1] }],
  ])('refuses a snapshot request carrying %s', async (_l, extra) => {
    const rawBody = JSON.stringify({ schemaVersion: 1, idempotencyKey: KEY, resumeId: 12, ...extra });
    expect((await call(`POST ${P.snapshot}`, { rawBody })).statusCode).toBe(422);
    expect(deps.snapshot).not.toHaveBeenCalled();
  });

  it('refuses malformed JSON, query strings and wrong content types', async () => {
    expect((await call(`POST ${P.queue}`, { rawBody: '{bad' })).statusCode).toBe(422);
    expect((await call(`POST ${P.queue}`, { rawBody: queueBody, query: { x: '1' } })).statusCode).toBe(422);
    expect((await call(`POST ${P.queue}`, { rawBody: queueBody, is: () => false })).statusCode).toBe(422);
    expect(deps.repo.enqueue).not.toHaveBeenCalled();
  });

  it('queues extraction for a given snapshot and returns 202 with status only', async () => {
    const res = await call(`POST ${P.queue}`, { rawBody: queueBody });
    expect(res.statusCode).toBe(202);
    expect(deps.repo.enqueue).toHaveBeenCalledWith(ACTOR, { schemaVersion: 1, idempotencyKey: KEY, sourceId: SRC, sourceVersion: 1 });
    expect(res.body.commandId).toBe(CMD);
  });

  it('status is a plain read: it includes the Try-again offer after a failure but never starts a retry', async () => {
    deps.repo.status.mockResolvedValueOnce(status({ state: 'unavailable', reason: 'outcome_unknown' }));
    const res = await call(`GET ${P.status}`, {}, { commandId: CMD });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ state: 'unavailable', retry: { canRetry: true, attemptsUsed: 1, maxAttempts: 3 } });
    expect(deps.repo.retry).not.toHaveBeenCalled();
    const ok = await call(`GET ${P.status}`, {}, { commandId: CMD });
    expect(ok.body.retry).toBeNull();
    expect(deps.repo.retryStatus).toHaveBeenCalledTimes(1);
  });

  it.each([
    [retryView({ message: 'Something went wrong reading your résumé.' })],
    [retryView({ attemptsUsed: 3, canRetry: false, reason: 'attempt_limit',
      message: "We still couldn't read your résumé. Please upload a different file or fill in your profile yourself." })],
  ])('passes the approved failure message through to the browser (P2-V4)', async (view) => {
    deps.repo.status.mockResolvedValueOnce(status({ state: 'unavailable', reason: 'outcome_unknown' }));
    deps.repo.retryStatus.mockResolvedValueOnce({ ...view, scrubContext: { verifiedAccountEmail: EMAIL } } as never);
    const res = await call(`GET ${P.status}`, {}, { commandId: CMD });
    expect(res.body.retry).toEqual({ attemptsUsed: view.attemptsUsed, maxAttempts: 3, canRetry: view.canRetry,
      canContinueWithoutResume: true, reason: view.reason, message: view.message });
    expect(JSON.stringify(res.body)).not.toContain(EMAIL);
  });

  it('a status read needs a candidate session but not CSRF/recent login, and refuses a body or bad id', async () => {
    expect((await call(`GET ${P.status}`, { csrf: false, recent: false }, { commandId: CMD })).statusCode).toBe(200);
    expect((await call(`GET ${P.status}`, { user: null }, { commandId: CMD })).statusCode).toBe(401);
    expect((await call(`GET ${P.status}`, {}, { commandId: 'not-a-uuid' })).statusCode).toBe(400);
    expect((await call(`GET ${P.status}`, { headers: { 'content-length': '5' } }, { commandId: CMD })).statusCode).toBe(400);
  });

  it('Try again runs only from an explicit POST for the same command and returns the successor', async () => {
    const res = await call(`POST ${P.retry}`, { rawBody: retryBody }, { commandId: CMD });
    expect(res.statusCode).toBe(202);
    expect(res.body.commandId).toBe(NEXT);
    expect(deps.repo.retry).toHaveBeenCalledWith(ACTOR, { schemaVersion: 1, idempotencyKey: KEY, retryOfCommandId: CMD });
    expect((await call(`POST ${P.retry}`, { rawBody: retryBody }, { commandId: NEXT })).statusCode).toBe(422);
    expect(deps.repo.retry).toHaveBeenCalledTimes(1);
  });

  it('the attempt cap is enforced by the database and shown as a refusal', async () => {
    deps.repo.retry.mockRejectedValueOnce(new ResumeSourceRepositoryError('source_changed', 409));
    expect((await call(`POST ${P.retry}`, { rawBody: retryBody }, { commandId: CMD })).body).toEqual({ code: 'source_changed' });
  });

  it.each([
    [new ResumeSourceRepositoryError('idempotency_conflict', 409), 409, 'idempotency_conflict'],
    [new ResumeSourceRepositoryError('not_found', 404), 404, 'not_found'],
    [new CandidatePrivacyRestrictedError('candidate_privacy_restricted'), 451, 'candidate_privacy_restricted'],
    [new Error('source_changed'), 409, 'source_changed'],
    [new Error(`database said ${EMAIL} at host db.internal`), 503, 'resume_source_temporarily_unavailable'],
  ])('maps %s without leaking internals', async (error, code, body) => {
    deps.snapshot.mockRejectedValueOnce(error);
    const res = await call(`POST ${P.snapshot}`, { rawBody: snapshotBody });
    expect(res.statusCode).toBe(code);
    expect(res.body.code).toBe(body);
    expect(JSON.stringify(res.body)).not.toContain(EMAIL);
  });

  it('never returns the internal scrub context, even if a repository result carried one', async () => {
    deps.repo.status.mockResolvedValueOnce({ ...status(), scrubContext: { verifiedAccountEmail: EMAIL } } as never);
    const res = await call(`GET ${P.status}`, {}, { commandId: CMD });
    expect(JSON.stringify(res.body)).not.toContain(EMAIL);
  });
});
