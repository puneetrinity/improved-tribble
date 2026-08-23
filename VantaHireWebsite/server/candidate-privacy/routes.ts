import type { Express, NextFunction, Request, Response } from "express";
import {
  comparePasswords,
  privacyPasswordVersion,
  requireRole,
  requireVerifiedCandidate,
} from "../auth";
import { candidatePrivacyReauthRateLimit } from "../rateLimit";
import { loadCandidatePrivacyConfig } from "./config";
import {
  candidateRequestSchema,
  operatorRequestSchema,
  reauthSchema,
} from "./models";
import {
  CandidatePrivacyConflict,
  CandidatePrivacySubjectNotFound,
  createLocalPrivacyRequest,
  getCandidatePrivacyStatus,
  getOperatorPrivacyStatus,
} from "./repository";

type CsrfMiddleware = (req: Request, res: Response, next: NextFunction) => void;

const RECENT_AUTH_MS = 10 * 60 * 1000;

function recentAuthValid(req: Request): boolean {
  const at = req.session.privacyReauthenticatedAt;
  const passwordVersion = req.session.privacyPasswordVersion;
  return typeof at === "number"
    && Date.now() - at <= RECENT_AUTH_MS
    && passwordVersion === privacyPasswordVersion(req.user!.password);
}

function requireRecentPrivacyAuth(req: Request, res: Response, next: NextFunction): void {
  if (!recentAuthValid(req)) {
    res.status(403).json({ code: "candidate_privacy_recent_auth_required" });
    return;
  }
  next();
}

function intakeDisabled(res: Response): void {
  res.status(503).json({ code: "candidate_privacy_intake_disabled" });
}

function constantFailure(error: unknown, res: Response, next: NextFunction): void {
  if (error instanceof CandidatePrivacyConflict) {
    res.status(409).json({ code: "candidate_privacy_request_conflict" });
    return;
  }
  if (error instanceof CandidatePrivacySubjectNotFound) {
    res.status(404).json({ code: "candidate_privacy_subject_not_found" });
    return;
  }
  next(error);
}

export function registerCandidatePrivacyRoutes(
  app: Express,
  csrfProtection: CsrfMiddleware,
): void {
  app.post(
    "/api/candidate/privacy/reauth",
    requireVerifiedCandidate,
    csrfProtection,
    candidatePrivacyReauthRateLimit,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      const parsed = reauthSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ code: "candidate_privacy_reauth_failed" });
        return;
      }
      try {
        if (!(await comparePasswords(parsed.data.password, req.user!.password))) {
          res.status(401).json({ code: "candidate_privacy_reauth_failed" });
          return;
        }
        req.session.privacyReauthenticatedAt = Date.now();
        req.session.privacyPasswordVersion = privacyPasswordVersion(req.user!.password);
        res.json({ success: true });
      } catch (error) {
        // Stored-password format problems are operational faults, never reflected.
        next(error);
      }
    },
  );

  app.get(
    "/api/candidate/privacy/status",
    requireVerifiedCandidate,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        res.json({
          intakeEnabled: loadCandidatePrivacyConfig().intakeEnabled,
          recentAuthRequired: !recentAuthValid(req),
          requests: await getCandidatePrivacyStatus(req.user!.id),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    "/api/candidate/privacy/requests",
    requireVerifiedCandidate,
    csrfProtection,
    requireRecentPrivacyAuth,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      if (!loadCandidatePrivacyConfig().intakeEnabled) {
        intakeDisabled(res);
        return;
      }
      const parsed = candidateRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ code: "candidate_privacy_request_invalid" });
        return;
      }
      try {
        const result = await createLocalPrivacyRequest({
          requestId: parsed.data.requestId,
          action: parsed.data.action,
          authorityType: "verified_candidate",
          actorUserId: req.user!.id,
          // Candidate intake accepts no evidence field. Its opaque request id
          // is the server-derived evidence correlation for this first-party act.
          evidenceRef: parsed.data.requestId,
          reasonCode: parsed.data.action === "request_erasure"
            ? "candidate_erasure_request"
            : "candidate_global_opt_out",
          anchor: { type: "candidate_user", id: req.user!.id },
        });
        res.status(202).json(result);
      } catch (error) {
        constantFailure(error, res, next);
      }
    },
  );

  app.post(
    "/api/admin/privacy/requests",
    requireRole(["super_admin"]),
    csrfProtection,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      if (!loadCandidatePrivacyConfig().intakeEnabled) {
        intakeDisabled(res);
        return;
      }
      const parsed = operatorRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ code: "candidate_privacy_request_invalid" });
        return;
      }
      try {
        const result = await createLocalPrivacyRequest({
          requestId: parsed.data.requestId,
          action: parsed.data.action,
          authorityType: parsed.data.authorityType,
          actorUserId: req.user!.id,
          evidenceRef: parsed.data.evidenceRef,
          reasonCode: parsed.data.reasonCode,
          anchor: { type: parsed.data.subjectType, id: parsed.data.subjectId },
        });
        res.status(202).json(result);
      } catch (error) {
        constantFailure(error, res, next);
      }
    },
  );

  app.get(
    "/api/admin/privacy/requests/:requestId",
    requireRole(["super_admin"]),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      const requestId = req.params.requestId;
      if (!requestId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
        res.status(400).json({ code: "candidate_privacy_request_invalid" });
        return;
      }
      try {
        const result = await getOperatorPrivacyStatus(requestId);
        if (!result) {
          res.status(404).json({ code: "candidate_privacy_request_not_found" });
          return;
        }
        res.json(result);
      } catch (error) {
        next(error);
      }
    },
  );
}
