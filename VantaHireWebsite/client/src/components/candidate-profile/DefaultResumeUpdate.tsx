// My profile: when a résumé becomes the default, offer to update the profile from it.
// Only the default résumé ever updates the profile. Nothing is read until the candidate asks,
// and nothing changes until they accept what we found (the same review as the wizard).
import { TetrisOrb } from "@/components/ui/tetris-orb";
import { useEffect, useRef, useState } from "react";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { queryClient } from "@/lib/queryClient";
import { createSparkSession, loadSparkProfile, type SparkProfileRead } from "@/lib/candidate-profile-api";
import { resumeAdapters, ResumeReadError, ResumeReadStatus, type ResumeRead } from "./SourceReview";
import { ResumeReviewList, type ResumeItem } from "./OnboardingWizard";
import { PROFILE_QUERY_KEY } from "./CareerProfilePanel";
import { candidateResumesQueryKey } from "@/hooks/use-candidate-job-state";

/** "Not now" is remembered per account and résumé, so we don't ask again about the same file. */
const dismissKey = (userId: number, resumeId: number) => `ealana:resume-offer-dismissed:${userId}:${resumeId}`;
export function offerDismissed(userId: number, resumeId: number): boolean {
  try { return window.localStorage.getItem(dismissKey(userId, resumeId)) === "1"; } catch { return false; }
}
function dismiss(userId: number, resumeId: number) {
  try { window.localStorage.setItem(dismissKey(userId, resumeId), "1"); } catch { /* best effort */ }
}

type Stage =
  | { kind: "checking" } | { kind: "hidden" } | { kind: "offer" } | { kind: "reading" }
  | { kind: "review"; proposalId: string; items: ResumeItem[] } | { kind: "nothing_new"; why: "empty" | "unmatched" | "unreadable"; rereadCommandId?: string | undefined }
  | { kind: "saving"; proposalId: string; items: ResumeItem[] }
  // The save may or may not have been applied: same proposal, choices and command key; never re-read.
  | { kind: "save_failed"; proposalId: string; items: ResumeItem[] }
  // Reading failed: only the server's own retry (when it allows one) — never a fresh read.
  | { kind: "read_failed"; read: Extract<ResumeRead, { kind: "failed" | "error" | "pending" }> }
  | { kind: "done" };

export function DefaultResumeUpdate({ userId, resumeId, label, onClose, explicit = false, loadProfile = () => loadSparkProfile() }: {
  userId: number; resumeId: number; label: string; onClose: () => void; explicit?: boolean;
  loadProfile?: () => ReturnType<typeof loadSparkProfile> }) {
  const [stage, setStage] = useState<Stage>({ kind: "checking" });
  const [choice, setChoice] = useState<Record<string, "keep" | "remove" | "profile" | "resume">>({});
  const [edits, setEdits] = useState<Record<string, string>>({});
  const adapters = useRef<ReturnType<typeof resumeAdapters> | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    generation.current++;
    let live = true;
    if (!explicit && offerDismissed(userId, resumeId)) { setStage({ kind: "hidden" }); return; }
    loadProfile().then(l => {
      if (!live) return;
      // Only for a Spark profile with résumé reading switched on.
      if (l.kind !== "ready" || l.profile.capabilities.canRequestResume !== true) { setStage({ kind: "hidden" }); return; }
      const p: SparkProfileRead = l.profile;
      adapters.current = resumeAdapters({ session: createSparkSession(p), currentProfile: () => p.draft ?? p.confirmedProfile });
      setStage({ kind: "offer" });
    }, () => { if (live) setStage({ kind: "hidden" }); });
    return () => { live = false; generation.current++; };
  }, [userId, resumeId, explicit]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load(run: () => Promise<{ resumeVersionId: string; items: ResumeItem[]; unmatched?: boolean | undefined; unreadable?: boolean | undefined; rereadCommandId?: string | undefined }>) {
    const current = generation.current;
    setStage({ kind: "reading" }); setChoice({}); setEdits({});
    try {
      const x = await run();
      if (current !== generation.current) return;
      setStage(x.items.length ? { kind: "review", proposalId: x.resumeVersionId, items: x.items } : { kind: "nothing_new", why: x.unreadable ? "unreadable" : x.unmatched ? "unmatched" : "empty", rereadCommandId: x.rereadCommandId });
    } catch (e) {
      if (current !== generation.current) return;
      setStage({ kind: "read_failed", read: e instanceof ResumeReadError ? e.read : { kind: "error", message: "We couldn't read this résumé." } });
    } finally {
      if (current === generation.current) void queryClient.invalidateQueries({ queryKey: candidateResumesQueryKey });
    }
  }
  const read = () => load(() => adapters.current!.readResumeById(resumeId));
  /** The same proposal, choices, edits and command key every time: a retry re-asks about that save. */
  async function accept(proposalId: string, items: ResumeItem[]) {
    setStage({ kind: "saving", proposalId, items });
    try { await adapters.current!.acceptResume(proposalId, choice, edits); }
    catch { setStage({ kind: "save_failed", proposalId, items }); return; }
    await queryClient.invalidateQueries({ queryKey: PROFILE_QUERY_KEY }).catch(() => undefined);
    setStage({ kind: "done" });
  }
  function notNow() { generation.current++; dismiss(userId, resumeId); onClose(); }
  // Closing a running or pending read is not a permanent rejection of its offer.
  function closeRead() { generation.current++; setStage({ kind: "hidden" }); onClose(); }

  if (stage.kind === "checking" || stage.kind === "hidden") return null;
  return (
    <section className="space-y-4 rounded-xl border border-spark/25 bg-spark-soft p-5" aria-labelledby="resume-update-title" aria-live="polite">
      <div className="flex items-start gap-3">
        <FileText className="mt-0.5 h-5 w-5 shrink-0 text-spark-ink" aria-hidden />
        <div className="min-w-0 space-y-1">
          <h3 id="resume-update-title" className="font-semibold text-foreground">
            {stage.kind === "done" ? "Added to your profile" : `Update your profile from “${label}”?`}
          </h3>
          <p className="text-sm text-muted-foreground">
            {stage.kind === "offer" ? "This is now your default résumé. We can read it and suggest updates to your profile. You choose what to keep."
              : stage.kind === "reading" ? "Reading your résumé…"
              : stage.kind === "nothing_new" ? (stage.why === "unreadable" ? "We couldn’t read suggestions from this résumé this time, so nothing was added. You can edit your profile yourself."
                : stage.why === "unmatched" ? "We found details in this résumé but couldn’t match them reliably to its text, so nothing was added. You can edit your profile yourself."
                : "We didn't find anything to add from this résumé.")
              : stage.kind === "done" ? "Saved to your draft. Confirm changes on your profile to update what employers see."
              : stage.kind === "save_failed" ? "We couldn't confirm your changes were saved. Try again to check — your choices are kept."
              : stage.kind === "read_failed" ? (stage.read.kind === "pending" ? "The résumé result is still pending." : "We couldn't read this résumé.")
              : "Keep what's right, edit or remove the rest. Only what's different from your profile is shown."}
          </p>
        </div>
      </div>
      {stage.kind === "reading" && <><p className="flex items-center gap-2 text-sm text-muted-foreground"><TetrisOrb label="Reading your résumé" decorative />This can take a minute. Closing this panel doesn't cancel the read.</p><Button variant="outline" onClick={closeRead}>Close</Button></>}
      {(stage.kind === "review" || stage.kind === "saving" || stage.kind === "save_failed") && (
        // Locked while a save is in flight or unresolved, so the screen always shows what was submitted.
        <fieldset disabled={stage.kind !== "review"} className="min-w-0 disabled:opacity-80">
          <ResumeReviewList items={stage.items} choice={choice} setChoice={setChoice} edits={edits} setEdits={setEdits} />
        </fieldset>
      )}
      {stage.kind === "read_failed" && (
        <ResumeReadStatus read={stage.read} fileName={label}
          onRetry={commandId => void load(() => adapters.current!.retryResume(commandId))} onContinue={closeRead} continueLabel="Close" />
      )}
      <div className="flex flex-wrap gap-2">
        {stage.kind === "offer" && <>
          <Button type="button" className="min-h-11 cursor-pointer" onClick={() => void read()}>Review suggestions</Button>
          <Button type="button" variant="ghost" className="min-h-11 cursor-pointer" onClick={notNow}>Not now</Button>
        </>}
        {(stage.kind === "review" || stage.kind === "saving") && <>
          <Button type="button" className="min-h-11 cursor-pointer" disabled={stage.kind === "saving" || stage.items.some(i => i.kind === "conflict" && !choice[i.id])}
            onClick={() => void accept(stage.proposalId, stage.items)}>{stage.kind === "saving" ? "Adding…" : "Add to my profile"}</Button>
          <Button type="button" variant="ghost" className="min-h-11 cursor-pointer" disabled={stage.kind === "saving"} onClick={notNow}>Not now</Button>
        </>}
        {stage.kind === "save_failed" && <>
          <Button type="button" className="min-h-11 cursor-pointer" onClick={() => void accept(stage.proposalId, stage.items)}>Try again</Button>
          <Button type="button" variant="ghost" className="min-h-11 cursor-pointer" onClick={onClose}>Close</Button>
        </>}
        {stage.kind === "nothing_new" && stage.rereadCommandId && <Button onClick={() => void load(() => adapters.current!.rereadResume(stage.rereadCommandId!))}>Read file again</Button>}
        {(stage.kind === "done" || stage.kind === "nothing_new") && <Button type="button" variant="outline" className="min-h-11 cursor-pointer" onClick={() => { dismiss(userId, resumeId); onClose(); }}>Done</Button>}
      </div>
    </section>
  );
}
