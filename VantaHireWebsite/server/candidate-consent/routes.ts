import type { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";
import { requireVerifiedCandidate } from "../auth";
import { CandidatePrivacyRestrictedError } from "../candidate-privacy/decision";
import { CandidateConsentError, grantRequestSchema, withdrawRequestSchema, uuidSchema } from "./contracts";
import { captureConsent, getConsentStatus, listConsentSources, recentConsentAuth } from "./repository";
import { consentDeliveryConfig, runConsentProcessorOnce } from "./processor";

type Middleware = (req: Request, res: Response, next: NextFunction) => void;
const sourceQuery = z.object({ limit: z.string().regex(/^[0-9]+$/).transform(Number)
  .pipe(z.number().int().min(1).max(100)).optional(), after: uuidSchema.optional() }).strict();

function requireRecentConsentAuth(req: Request, res: Response, next: NextFunction): void {
  if (!recentConsentAuth(req.session.privacyReauthenticatedAt, req.session.privacyPasswordVersion, req.user!.password)) {
    res.status(403).json({ code: "candidate_consent_recent_auth_required" });
    return;
  }
  next();
}
function failure(error: unknown, res: Response): void {
  if (error instanceof CandidateConsentError) { res.status(error.status).json({ code: error.code }); return; }
  if (error instanceof CandidatePrivacyRestrictedError && error.code === "candidate_privacy_restricted") {
    res.status(451).json({ code: "candidate_privacy_restricted" }); return;
  }
  // Includes stale/unhealthy/missing privacy authority. Never reflect raw SQL/profile/identifier errors.
  res.status(503).json({ code: "candidate_consent_temporarily_unavailable" });
}
async function writeConsent(req: Request, res: Response, action: "grant" | "withdraw"): Promise<void> {
  const parsed = action === "grant" ? grantRequestSchema.safeParse(req.body) : withdrawRequestSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ code: "candidate_consent_invalid_request" }); return; }
  try {
    const result = await captureConsent(action, parsed.data, {
      userId: req.user!.id, authVersion: req.user!.authVersion,
      passwordVersion: req.session.privacyPasswordVersion!, reauthenticatedAt: req.session.privacyReauthenticatedAt!,
    });
    // Optional single-event, leased fast path after commit. Failure cannot reverse the committed command.
    try { await runConsentProcessorOnce(consentDeliveryConfig(), result.eventId); } catch { /* timer retries */ }
    const status = await getConsentStatus(req.user!.id);
    const complete = status.effective?.version === status.version && status.effective?.action === action;
    res.status(complete ? 200 : 202).json({ ...status, replayed: result.replayed,
      code: action === "withdraw" ? (complete ? "withdrawn" : "withdrawal_pending")
        : (complete ? "granted" : "grant_pending") });
  } catch (error) { failure(error, res); }
}

export function registerCandidateConsentRoutes(app: Express, csrfProtection: Middleware): void {
  app.get("/api/candidate/consent", requireVerifiedCandidate, async (req: Request, res: Response) => {
    if (Object.keys(req.query).length) { res.status(400).json({ code: "candidate_consent_invalid_request" }); return; }
    try { res.json({ ...await getConsentStatus(req.user!.id), recent_auth_required:
      !recentConsentAuth(req.session.privacyReauthenticatedAt, req.session.privacyPasswordVersion, req.user!.password) }); }
    catch (error) { failure(error, res); }
  });
  app.get("/api/candidate/consent/sources", requireVerifiedCandidate, async (req: Request, res: Response) => {
    const parsed = sourceQuery.safeParse(req.query);
    if (!parsed.success) { res.status(400).json({ code: "candidate_consent_invalid_request" }); return; }
    try { res.json(await listConsentSources(req.user!.id, parsed.data.limit ?? 25, parsed.data.after ?? null)); }
    catch (error) { failure(error, res); }
  });
  app.post("/api/candidate/consent/grant", requireVerifiedCandidate, csrfProtection, requireRecentConsentAuth,
    async (req: Request, res: Response) => { await writeConsent(req, res, "grant"); });
  app.post("/api/candidate/consent/withdraw", requireVerifiedCandidate, csrfProtection, requireRecentConsentAuth,
    async (req: Request, res: Response) => { await writeConsent(req, res, "withdraw"); });
}
