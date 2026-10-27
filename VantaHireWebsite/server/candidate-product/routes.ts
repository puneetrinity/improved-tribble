import type { Express, NextFunction, Request, Response } from 'express';
import { requireVerifiedCandidate } from '../auth';
import { pool } from '../db';
import { recentConsentAuth } from '../candidate-consent/repository';
import { CandidatePrivacyRestrictedError, requireCandidatePrivacyAllowed } from '../candidate-privacy/decision';
import { foundationEnabled } from './config';
import { foundationClaimRequest, foundationRequest, parseStrictJson, uuid } from './contracts';
import { foundationRepository, FoundationRepositoryError } from './repository';

type Middleware = (req: Request, res: Response, next: NextFunction) => void;
const repository = foundationRepository({query:(text,values)=>pool.query(text,values)}, userId => requireCandidatePrivacyAllowed(
  { type: 'candidate_user', id: userId }, { globalUse: true, newGlobalOperation: true }));

function failure(error: unknown, res: Response): void {
  if (error instanceof FoundationRepositoryError) { res.status(error.status).json({code:error.code}); return; }
  if (error instanceof CandidatePrivacyRestrictedError && error.code === 'candidate_privacy_restricted') {
    res.status(451).json({code:'privacy_restricted'}); return;
  }
  res.status(503).json({code:'authority_unavailable'});
}
const available: Middleware = (_req, res, next) => {
  if (!foundationEnabled()) { res.status(404).json({code:'not_found'}); return; }
  next();
};
const recent: Middleware = (req, res, next) => {
  if (!recentConsentAuth(req.session.privacyReauthenticatedAt, req.session.privacyPasswordVersion, req.user!.password)) {
    res.status(403).json({code:'recent_auth_required'}); return;
  }
  next();
};
function actor(req: Request) { return {userId:req.user!.id, authVersion:req.user!.authVersion}; }
function writer(req: Request) {
  return {...actor(req), passwordVersion:req.session.privacyPasswordVersion!,
    reauthenticatedAt:req.session.privacyReauthenticatedAt!};
}
function emptyQuery(req: Request): boolean { return Object.keys(req.query).length === 0; }
function body(req: Request): unknown {
  if (!emptyQuery(req) || !req.is('application/json')) throw Error('invalid_request');
  return parseStrictJson((req as Request & {rawBody?:string}).rawBody as string);
}
function emptyRead(req: Request): boolean {
  return emptyQuery(req) && !req.headers['transfer-encoding']
    && (!req.headers['content-length'] || req.headers['content-length'] === '0');
}
export function registerCandidateProductRoutes(app: Express, csrfProtection: Middleware): void {
  app.get('/api/candidate/product', available, requireVerifiedCandidate, async (req, res) => {
    if (!emptyRead(req)) { res.status(400).json({code:'invalid_request'}); return; }
    try { res.json(await repository.read(actor(req))); } catch(error) { failure(error,res); }
  });
  app.get('/api/candidate/product/commands/:id', available, requireVerifiedCandidate, async (req, res) => {
    if (!emptyRead(req) || !uuid.safeParse(req.params.id).success) { res.status(400).json({code:'invalid_request'}); return; }
    try { res.json(await repository.readCommand(actor(req),req.params.id!)); } catch(error) { failure(error,res); }
  });
  app.post('/api/candidate/product/foundation', available, requireVerifiedCandidate, csrfProtection, recent, async (req, res) => {
    let input;
    try { input=foundationRequest.parse(body(req)); }
    catch { res.status(400).json({code:'invalid_request'}); return; }
    try {
      const result=await repository.ensure(writer(req),input.idempotencyKey);
      res.status(result.status === 'acknowledged' ? 200 : 202).json(result);
    } catch(error) { failure(error,res); }
  });
  app.post('/api/candidate/product/intents/:id/claim', available, requireVerifiedCandidate, csrfProtection, recent, async (req,res) => {
    try { foundationClaimRequest.parse(body(req)); uuid.parse(req.params.id); }
    catch { res.status(400).json({code:'invalid_request'}); return; }
    try { res.json(await repository.claimIntent(writer(req),req.params.id!)); } catch(error) { failure(error,res); }
  });
}
