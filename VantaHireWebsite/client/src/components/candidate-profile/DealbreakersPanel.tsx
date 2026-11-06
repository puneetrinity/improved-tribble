import { useState } from "react";
import { Pencil, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SparkExclusion, SparkProfileRead } from "@/lib/candidate-profile-api";
import { describeRule, type Exclusion } from "./SparkAssist";
import { unknownNote } from "./OnboardingWizard";

// U3 (approved 4 Nov): deal-breakers and private notes on My profile after onboarding.
// Same rules, labels and save path (server preview, then its exact accept) as onboarding;
// no AI here. Company rules the candidate already has are kept as they are.
export const DEALBREAKERS_TITLE = "Deal-breakers & private notes";
export const DEALBREAKERS_HELP = "Only you see these. Supported deal-breakers will filter your job matches when matching is available. Private notes don't filter jobs.";
const RULES = [["remote_only", "Need on-site or hybrid work"], ["no_travel", "Require travel"]] as const;
const MAX_NOTES = 20, MAX_NOTE = 2000;

export type DealbreakerState = { exclusions: SparkExclusion[]; notes: string[] };

/** What the server holds now (the preference draft). */
export function dealbreakersFrom(p: SparkProfileRead): DealbreakerState {
  const section = p.preferenceDraft?.sections?.private_notes;
  const notes = section?.answered && Array.isArray(section.value) ? (section.value as unknown[]).filter((n): n is string => typeof n === "string") : [];
  return { exclusions: p.preferenceDraft?.exclusions ?? [], notes };
}

const asRule = (x: SparkExclusion): Exclusion => x.kind === "exclude_company"
  ? { id: x.id, kind: x.kind, companyId: x.companyId, companyName: "", domain: null } : { id: x.id, kind: x.kind };

/** Read view for the "What you're looking for" card. */
export function DealbreakersSummary({ state, canEdit, onEdit }: { state: DealbreakerState; canEdit: boolean; onEdit: () => void }) {
  const rules = state.exclusions.filter(x => x.kind !== "exclude_company").map(asRule);
  return (
    <section className="mt-4 space-y-2 border-t border-border pt-4" aria-labelledby="dealbreakers-title">
      <div className="flex items-start justify-between gap-3">
        <h3 id="dealbreakers-title" className="text-sm font-semibold text-foreground">{DEALBREAKERS_TITLE}</h3>
        <Button type="button" variant="ghost" size="sm" className="min-h-11 cursor-pointer gap-1.5" disabled={!canEdit} onClick={onEdit}
          aria-label={`Edit ${DEALBREAKERS_TITLE.toLowerCase()}`}><Pencil className="h-4 w-4" aria-hidden />Edit</Button>
      </div>
      <p className="text-xs text-muted-foreground">{DEALBREAKERS_HELP}</p>
      {rules.length > 0 && <p className="text-sm text-foreground"><span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Deal-breakers</span><br />{rules.map(describeRule).join(" ")}</p>}
      {state.notes.length > 0 && <p className="text-sm text-foreground"><span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Private notes</span><br />{state.notes.join(" · ")}</p>}
    </section>
  );
}

/** Edit sheet body. Calls onSave with the complete desired state. */
export function DealbreakersEditor({ initial, busy, onSave, onCancel }: {
  initial: DealbreakerState; busy: boolean; onSave: (next: DealbreakerState) => void; onCancel: () => void;
}) {
  const [exclusions, setExclusions] = useState<SparkExclusion[]>(initial.exclusions);
  const [notes, setNotes] = useState<string[]>(initial.notes);
  const [draft, setDraft] = useState("");
  const has = (kind: string) => exclusions.some(e => e.kind === kind);
  const toggle = (kind: "remote_only" | "no_travel") => setExclusions(ex => has(kind) ? ex.filter(e => e.kind !== kind) : [...ex, { id: crypto.randomUUID(), kind }]);
  const text = draft.trim();
  const canAdd = !!text && text.length <= MAX_NOTE && notes.length < MAX_NOTES && !notes.some(n => n.toLowerCase() === text.toLowerCase());
  const add = () => { if (canAdd) { setNotes([...notes, text]); setDraft(""); } };
  const rules = exclusions.filter(x => x.kind !== "exclude_company").map(asRule);
  const changed = JSON.stringify([exclusions.map(e => e.kind).sort(), notes]) !== JSON.stringify([initial.exclusions.map(e => e.kind).sort(), initial.notes]);
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">{DEALBREAKERS_HELP}</p>
      <div className="space-y-3">
        <p className="text-sm font-medium text-foreground">Hide jobs that…</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Hide jobs that">
          {RULES.map(([kind, label]) => (
            <button key={kind} type="button" aria-pressed={has(kind)} disabled={busy} onClick={() => toggle(kind)}
              className={`min-h-11 cursor-pointer rounded-full border px-4 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-50 ${has(kind) ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-foreground hover:border-primary"}`}>
              {label}
            </button>
          ))}
        </div>
        {unknownNote(rules) && <p className="text-xs text-muted-foreground">{unknownNote(rules)}</p>}
      </div>
      <div className="space-y-3">
        <p className="text-sm font-medium text-foreground">Private notes</p>
        {notes.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label="Private notes">
            {notes.map(n => (
              <li key={n} className="inline-flex min-h-11 items-center gap-1 rounded-full border border-border bg-background pl-4 pr-1 text-sm text-foreground">{n}
                <button type="button" aria-label={`Remove ${n}`} disabled={busy} onClick={() => setNotes(notes.filter(x => x !== n))}
                  className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-50"><X className="h-4 w-4" aria-hidden /></button>
              </li>
            ))}
          </ul>
        )}
        <form className="space-y-2" onSubmit={e => { e.preventDefault(); add(); }}>
          <Label htmlFor="add-private-note">Add a private note</Label>
          <div className="flex gap-2">
            <Input id="add-private-note" value={draft} onChange={e => setDraft(e.target.value)} maxLength={MAX_NOTE} disabled={busy || notes.length >= MAX_NOTES}
              placeholder="e.g. No early-stage startups" className="min-h-11 text-base" />
            <Button type="submit" variant="outline" className="min-h-11 cursor-pointer gap-1.5" disabled={busy || !canAdd}><Plus className="h-4 w-4" aria-hidden />Add</Button>
          </div>
        </form>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" className="min-h-11 cursor-pointer" disabled={busy || !changed} onClick={() => onSave({ exclusions, notes })}>Save</Button>
        <Button type="button" variant="ghost" className="min-h-11 cursor-pointer" disabled={busy} onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
