// Real AI help for SparkAssist (P6). The model only proposes: this adapter turns the server's
// typed proposal into the confirmation card, and the candidate's tap is what saves it.
// Copy is the approved journey wording (s2-preview); no new strings are introduced here.
import type { AssistResult, Interpret, Op, UseCase } from "@/components/candidate-profile/SparkAssist";
import { dateRange } from "@/components/candidate-profile/ProfileOverview";
import {
  FIELD_LABELS, ProfileApiError, newKey, requestInterpretation, type InterpretationChange, type InterpretationRequest,
  type InterpretationRestriction, type InterpretationUse, type SparkVersions,
} from "./candidate-profile-api";

export const ASSIST_COPY = {
  outside: "I can only help with your profile and job preferences. You can change things directly instead.",
  correction: "I can't change that from here. Choose \"Yes, this is me\" and edit it on the review screen.",
  failed: "That didn't work. You can try again or change it directly.",
  // Approved 6 Nov: shown when the shared AI allowance is used up (retrying would fail again).
  budget: "AI help isn't available right now. Use the options above, or add it as a private note later on My profile.",
  off: "This isn't available yet. You can change it directly.",
  stale: "Your profile changed since this suggestion was made, so we didn't use it. Please ask again.",
} as const;

const USE: Partial<Record<UseCase, InterpretationUse>> = { correction: "source_correction", exclusions: "private_exclusions", search: "change_preferences" };

/** One readable line per corrected imported fact. */
export function describeFact(f: { kind: string; value: any }): { field: string; value: string } {
  const v = f.value ?? {};
  switch (f.kind) {
    case "employment": return { field: `${v.title} at ${v.employer}`, value: dateRange(v) || v.title };
    case "education": return { field: v.institution ?? FIELD_LABELS.profile!, value: [v.qualification, dateRange(v)].filter(Boolean).join(" · ") };
    case "project": return { field: v.name ?? FIELD_LABELS.profile!, value: dateRange(v) || "" };
    case "skill": return { field: FIELD_LABELS.skills!, value: String(f.value) };
    case "headline": return { field: FIELD_LABELS.headline!, value: String(f.value) };
    case "currentLocation": return { field: FIELD_LABELS["currentLocation.city"]!, value: v.city ?? "" };
    default: return { field: FIELD_LABELS.profile!, value: typeof f.value === "string" ? f.value : "" };
  }
}

export type AssistDeps = {
  versions: () => SparkVersions;
  /** The lookup suggestion being corrected (correction only). */
  source?: (() => { proposalId: string; sourceVersion: number } | null) | undefined;
  /** The server wants a recent password check: ask once, then resend the same request. */
  askPassword?: (() => Promise<boolean>) | undefined;
  onSignedOut?: (() => void) | undefined;
  postFetcher?: typeof fetch | undefined;
  wait?: ((ms: number) => Promise<void>) | undefined;
};

export function createInterpret(d: AssistDeps): Interpret {
  // Same request (text, versions, source) → same key: a lost reply never buys a second answer.
  // A changed request is a new, deliberate one and gets a fresh key.
  const keys = new Map<string, string>();
  return async (useCase, text, ctx): Promise<AssistResult> => {
    const use = USE[useCase];
    if (!use || useCase === "search") return { kind: "cannot_help", message: ASSIST_COPY.off };
    const v = d.versions();
    const src = use === "source_correction" ? d.source?.() ?? null : null;
    if (use === "source_correction" && !src) return { kind: "cannot_help", message: ASSIST_COPY.correction };
    const base = { schemaVersion: 1 as const, expectedDraftVersion: v.draftVersion, expectedProfileVersion: v.profileVersion,
      expectedPreferenceVersion: v.preferenceVersion, expectedPreferenceDraftRevision: v.preferenceDraftRevision, use, text: text.trim(),
      sourceProposalId: src?.proposalId ?? null, sourceVersion: src?.sourceVersion ?? null, targetRowId: null };
    const id = JSON.stringify(base);
    if (!keys.has(id)) keys.set(id, newKey());
    const body: InterpretationRequest = { ...base, idempotencyKey: keys.get(id)! };
    let reply;
    try { reply = await requestInterpretation(body, { postFetcher: d.postFetcher, wait: d.wait }); }
    catch (e) {
      if (e instanceof ProfileApiError && e.status === 401) { d.onSignedOut?.(); return { kind: "cannot_help", message: ASSIST_COPY.failed }; }
      if (e instanceof ProfileApiError && e.code === "recent_auth_required" && d.askPassword && await d.askPassword()) {
        try { reply = await requestInterpretation(body, { postFetcher: d.postFetcher, wait: d.wait }); }
        catch (e2) { return failure(e2, useCase); }
      } else return failure(e, useCase);
    }
    if (reply.status === "clarify") return { kind: "clarify", question: reply.question, options: [] };
    if (reply.status === "cannot_help") {
      const failed = reply.reason === "budget_unavailable" || reply.reason === "insufficient_evidence";
      // A definite failed answer (e.g. the model call failed and the server held it): "Try again" must really
      // try again, so the next identical send gets a fresh key (one more model call; user decision 4 Nov).
      // Lost replies (thrown above) keep their key, so an unknown outcome is never paid for twice.
      if (failed) keys.delete(id);
      if (reply.reason === "budget_unavailable") return { kind: "cannot_help", message: ASSIST_COPY.budget };
      return { kind: "cannot_help", message: failed ? ASSIST_COPY.failed : useCase === "correction" ? ASSIST_COPY.correction : ASSIST_COPY.outside };
    }
    const ops: Op[] = [];
    const restrictions: InterpretationRestriction[] = [];
    const notes: string[] = [];
    let hasFacts = false;
    for (const c of reply.changes as InterpretationChange[]) {
      if (c.kind === "exclusions") for (const r of c.restrictions) {
        // There is no company registry yet, so a company rule can't be shown or saved here.
        if (r.kind === "exclude_company") continue;
        restrictions.push(r); ops.push({ op: "exclude", rule: r });
      } else if (c.kind === "preference_section" && c.answer.section === "private_notes" && Array.isArray(c.answer.value)) {
        for (const t of c.answer.value as string[]) { notes.push(t); ops.push({ op: "private_note", text: t }); }
      } else if (c.kind === "source_correction") { hasFacts = true; ops.push({ op: "fact", ...describeFact(c.fact) }); }
    }
    if (!ops.length) return { kind: "cannot_help", message: useCase === "correction" ? ASSIST_COPY.correction : ASSIST_COPY.outside };
    return { kind: "proposal", baseVersion: ctx.baseVersion, ops, evidence: text.trim().split("\n")[0]!.slice(0, 200),
      server: { proposalId: reply.proposalId, proposalHash: reply.proposalHash, restrictions, notes, hasFacts } };
  };
}

function failure(e: unknown, useCase: UseCase): AssistResult {
  if (e instanceof ProfileApiError && e.status === 404) return { kind: "cannot_help", message: ASSIST_COPY.off };
  if (e instanceof ProfileApiError && e.code === "stale_edit") return { kind: "cannot_help", message: ASSIST_COPY.stale };
  if (e instanceof ProfileApiError && e.code === "source_conflict" && useCase === "correction") return { kind: "cannot_help", message: ASSIST_COPY.correction };
  return { kind: "cannot_help", message: ASSIST_COPY.failed };
}
