import type { Express, Request, Response } from "express";
import { requireAuth } from "../auth";
import { parsePositiveDecimalApplicationId, readAuthorizedCandidateHistoryContext } from "../lib/applicationReadAuthorization";
import { sameHistoryContext, type HistoryContext } from "./contracts";
import { HistoryMemoryError, readMemoryHistory } from "./memory-client";

function localState(context: HistoryContext, res: Response): boolean {
  if (context.status === "bound") return false;
  res.status(context.status === "binding_conflict" ? 409 : 200).json({ code: context.status, summary: null });
  return true;
}

export function registerCandidateHistoryRoutes(app: Express): void {
  app.get("/api/applications/:id/decision-history", requireAuth, async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "private, no-store");
    const id = parsePositiveDecimalApplicationId(req.params.id);
    if (!id || id > 2147483647 || Object.keys(req.query).length) {
      res.status(404).json({ code: "not_found" }); return;
    }
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const before = await readAuthorizedCandidateHistoryContext(req.user!.id, id);
        if (!before.ok) {
          res.status(before.reason === "not_found" ? 404 : 503).json({ code: before.reason === "not_found"
            ? "not_found" : "temporarily_unavailable" }); return;
        }
        if (localState(before.context, res)) return;
        const context = before.context;
        if (context.status !== "bound") return;
        // Revalidate authority even when the remote result is a refusal.
        let failure: unknown;
        let result;
        try { result = await readMemoryHistory({ schema_version: 1, organization_id: context.organization_id,
          application_id: context.application_id, job_id: context.job_id,
          reference_id: context.reference_id, expected: context.captured }); }
        catch (error) { failure = error; }
        const after = await readAuthorizedCandidateHistoryContext(req.user!.id, id);
        if (!after.ok) {
          res.status(after.reason === "not_found" ? 404 : 503).json({ code: after.reason === "not_found"
            ? "not_found" : "temporarily_unavailable" }); return;
        }
        if (!sameHistoryContext(context, after.context) || result?.freshness.status === "history_changed_retry") continue;
        if (failure) throw failure;
        if (!result) throw new HistoryMemoryError("temporarily_unavailable");
        // Only Flow can detect a missing mirror intent in the authoritative spine.
        if (context.capture_gap) result = { ...result, summary: null,
          freshness: { ...result.freshness, status: "capture_gap" } };
        res.json(result); return;
      }
      res.status(409).json({ code: "history_changed_retry", summary: null });
    } catch (error) {
      const code = error instanceof HistoryMemoryError ? error.code : "temporarily_unavailable";
      res.status(code === "not_found" ? 404 : code === "binding_conflict" ? 409 : 503).json({ code, summary: null });
    }
  });
}
