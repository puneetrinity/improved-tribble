// Constrained AI input ("tell us in your own words"). The AI never writes: it returns typed
// operations on fields we already have, shown as a proposed-changes card. Nothing changes until
// the candidate taps "Use this". Unclear text gets one clarifying question; anything outside the
// allowed fields gets "can't help" and the candidate edits directly. Candidate text is data, not
// instructions. In the prototype `interpret` is simulated; the real one is a Codex backend call.
import Orb from "@/components/ui/orb";
import { exclusionEffects } from "@shared/candidate-spark-v3";
import { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, Check, Loader2, Pencil, Plus, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type UseCase = "correction" | "impact" | "exclusions" | "search";
/** The only things the AI may propose. Each maps to an existing S2 command field (or the
 * proposed private-notes field, pending decision). */
/** Profile ops name the exact row by id (never by employer name, so similar employers can't merge). */
export type Op =
  | { op: "employment_end"; rowId: string; employer: string; title: string; year: string }
  | { op: "employment_start"; rowId: string; employer: string; title: string; year: string }
  | { op: "role_description"; rowId: string; employer: string; title: string; text: string }
  | { op: "add_place"; city: string; countryCode: string }
  | { op: "relocation"; mode: "yes" | "no" | "discuss"; city?: string; countryCode?: string }
  | { op: "add_role"; role: string }
  | { op: "seniority"; values: string[] }
  | { op: "arrangements"; values: ("remote" | "hybrid" | "onsite")[] }
  | { op: "pay_minimum"; amount: string; currency: string }
  | { op: "exclude"; rule: ExclusionRule }
  | { op: "private_note"; text: string }
  /** A corrected imported fact, already worded for display (real AI only). */
  | { op: "fact"; field: string; value: string };
/** The only deal-breakers we can actually enforce. A company is an exact registry entry the
 * candidate picked (never matched by name). Anything else stays a private note. */
export type ExclusionRule =
  | { kind: "remote_only" }
  | { kind: "no_travel" }
  | { kind: "exclude_company"; companyId: string; companyName: string; domain: string | null };
export type Exclusion = ExclusionRule & { id: string };
export const ruleKey = (r: ExclusionRule) => r.kind === "exclude_company" ? `company:${r.companyId}` : r.kind;
/** The server's exact effect text, so the line shown is what the server enforces (user-approved 4 Nov).
 * Company rules stay hidden until the company registry exists. */
export function describeRule(r: ExclusionRule): string {
  return exclusionEffects[r.kind];
}
/** Every proposal is tied to the version it was made against and quotes what it's based on.
 * Confirming sends the normal save command with that version; a stale version is rejected. */
export type Proposal = { kind: "proposal"; baseVersion: string; ops: Op[]; evidence: string;
  /** Real AI: the server's stored proposal. The candidate's acceptance sends exactly this identity. */
  server?: { proposalId: string; proposalHash: string; restrictions: ({ kind: "remote_only" } | { kind: "no_travel" } | { kind: "exclude_company"; companyId: string })[]; notes: string[]; hasFacts: boolean } | undefined };
export type AssistResult =
  | Proposal
  | { kind: "clarify"; question: string; options: string[] }
  | { kind: "cannot_help"; message: string };
/** A ready-made suggestion drawn from the candidate's own LinkedIn profile or résumé. It is a
 * draft for them to check: nothing is saved until they tap "Use this" (or edit it first). */
export type Suggestion = { source: "linkedin" | "resume"; items: { text: string; evidence: string }[] };
export type Interpret = (useCase: UseCase, text: string, context: AssistContext) => Promise<AssistResult>;
/** What the AI may see: the version and only the fields in scope for that use case. */
export type AssistContext = { baseVersion: string; rows?: { id: string; employer: string; title: string }[]; row?: { id: string; employer: string; title: string } };

const ARR: Record<string, string> = { remote: "Remote", hybrid: "Hybrid", onsite: "On-site" };
/** Human-readable line for each proposed operation. */
export function describeOp(o: Op): { field: string; value: string } {
  switch (o.op) {
    case "employment_end": return { field: `${o.title} at ${o.employer}: end date`, value: o.year };
    case "employment_start": return { field: `${o.title} at ${o.employer}: start date`, value: o.year };
    case "role_description": return { field: `${o.title} at ${o.employer}`, value: o.text };
    case "add_place": return { field: "Add a location", value: o.city };
    case "relocation": return { field: "Relocation", value: o.mode === "yes" ? `Yes${o.city ? `, to ${o.city}` : ""}` : o.mode === "no" ? "No" : "Maybe" };
    case "add_role": return { field: "Add a role", value: o.role };
    case "seniority": return { field: "Level", value: o.values.join(", ") };
    case "arrangements": return { field: "How you work", value: o.values.map(v => ARR[v]).join(", ") };
    case "pay_minimum": return { field: "Pay minimum", value: o.currency === "INR" ? `₹${Number(o.amount) / 100000}L a year` : o.amount };
    case "exclude": return { field: "Hidden from your matches", value: describeRule(o.rule) };
    case "private_note": return { field: "Private note. We can't hide jobs for this yet", value: o.text };
    case "fact": return { field: o.field, value: o.value };
  }
}

type Props = {
  useCase: UseCase; label: string; placeholder: string; hint?: string;
  context: AssistContext;
  interpret: Interpret;
  /** Return a message to refuse the proposal (e.g. it's stale); it's shown and nothing changes. */
  onApply: (proposal: Proposal) => string | void;
  /** Shown on the confirm button, e.g. "Use this" or "Update my search". */
  applyLabel?: string | ((proposal: Proposal) => string);
  /** Label of the button that sends the text (default "Show me the changes"). Say what it does on this step. */
  submitLabel?: string | undefined;
  /** Heading of the confirmation card (default "Here's what would change"). */
  proposalTitle?: string | undefined;
  autoFocus?: boolean;
  /** Suggestion for this box, if we have one ("loading" while it's being drafted). */
  suggestion?: Suggestion | "loading" | null | undefined;
  /** Direct mode: the box is the candidate's own text, saved as written by the parent (no AI
   * rewrite, no "Show me the changes"). Used where they're describing their own work. */
  value?: string | undefined;
  onValueChange?: ((v: string) => void) | undefined;
};
const FROM: Record<Suggestion["source"], string> = { linkedin: "your LinkedIn profile", resume: "your résumé" };

export function SparkAssist({ useCase, label, placeholder, hint, context, interpret, onApply, applyLabel = "Use this", submitLabel = "Show me the changes", proposalTitle = "Here's what would change", autoFocus, suggestion, value, onValueChange }: Props) {
  const id = useId();
  const [ownText, setOwnText] = useState("");
  const direct = !!onValueChange;
  const text = direct ? value ?? "" : ownText;
  const setText = (v: string | ((cur: string) => string)) => { const next = typeof v === "function" ? v(text) : v; if (direct) onValueChange!(next); else setOwnText(next); };
  const [used, setUsed] = useState<string[]>([]);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  // The box grows with its text, so added suggestions are fully visible.
  useEffect(() => { const el = boxRef.current; if (el) { el.style.height = "auto"; el.style.height = `${el.scrollHeight + 2}px`; } }, [text]);
  function addSuggestion(t: string) { setText(cur => cur.trim() ? `${cur.trim().replace(/[.;]$/, "")}; ${/^[A-Z][a-z]/.test(t) ? t[0]!.toLowerCase() + t.slice(1) : t}` : t); setUsed(u => [...u, t]); setError(null); boxRef.current?.focus(); }
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AssistResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(input: string) {
    if (!input.trim()) { setError("Type something first."); return; }
    setBusy(true); setError(null); setResult(null);
    try { setResult(await interpret(useCase, input.slice(0, 1000), context)); }
    catch { setResult({ kind: "cannot_help", message: "That didn't work. You can try again or change it directly." }); }
    finally { setBusy(false); }
  }
  function reset() { setResult(null); }

  return (
    <div className="space-y-3">
      {!result || result.kind === "cannot_help" ? (
        <form className="space-y-2" onSubmit={e => { e.preventDefault(); if (!direct) void run(text); }} noValidate>
          <Label htmlFor={id} className="flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5 text-spark" aria-hidden />{label}</Label>
          <Textarea ref={boxRef} id={id} value={text} onChange={e => { setText(e.target.value); setError(null); }} placeholder={placeholder} rows={3} maxLength={1000} style={{ overflow: "hidden", resize: "none" }}
            autoFocus={autoFocus} aria-describedby={`${id}-hint`} aria-invalid={!!error} className="text-base" />
          {suggestion === "loading" && <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status"><span aria-hidden className="inline-flex shrink-0"><Orb variant="pulse" size={14} color="#F25C2E" /></span>Finding ideas in your profile…</p>}
          {suggestion && suggestion !== "loading" && suggestion.items.some(i => !used.includes(i.text)) && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Ideas from {FROM[suggestion.source]}. Tap to add, then edit:</p>
              <div className="flex flex-wrap gap-2">
                {suggestion.items.filter(i => !used.includes(i.text)).map(i => (
                  <button key={i.text} type="button" title={`From: "${i.evidence}"`} onClick={() => addSuggestion(i.text)}
                    className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border border-spark/40 bg-spark-soft px-3 py-1.5 text-left text-sm text-foreground transition-colors hover:border-spark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <Plus className="h-3.5 w-3.5 shrink-0 text-spark-ink" aria-hidden />{i.text}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p id={`${id}-hint`} className={error ? "text-sm text-destructive" : "text-xs text-muted-foreground"} role={error ? "alert" : undefined}>
              {error ?? hint ?? (direct ? "Saved as you wrote it when you continue." : "We'll show you exactly what would change. Nothing is saved until you say so.")}
            </p>
            {!direct && <Button type="submit" variant="outline" className="min-h-11 cursor-pointer gap-1.5" disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <ArrowRight className="h-4 w-4" aria-hidden />}
              {busy ? "Reading…" : submitLabel}
            </Button>}
          </div>
          {result?.kind === "cannot_help" && <p className="rounded-lg bg-muted p-3 text-sm text-foreground" role="status">{result.message}</p>}
        </form>
      ) : result?.kind === "clarify" ? (
        <div className="space-y-3 rounded-xl border border-spark/25 bg-spark-soft p-4" role="group" aria-label="Quick question">
          <p className="text-sm font-medium text-foreground">{result.question}</p>
          <div className="flex flex-wrap gap-2">
            {result.options.map(o => <Button key={o} type="button" variant="outline" className="min-h-11 cursor-pointer bg-background" onClick={() => void run(`${text}\n${o}`)}>{o}</Button>)}
          </div>
          <Button type="button" variant="ghost" size="sm" className="min-h-11 cursor-pointer" onClick={reset}>Change what I wrote</Button>
        </div>
      ) : result?.kind === "proposal" ? (
        <div className="space-y-3 rounded-xl border border-spark/25 bg-spark-soft p-4" role="group" aria-label="Proposed changes">
          <p className="text-sm font-medium text-foreground">{proposalTitle}</p>
          <ul className="space-y-2">
            {result.ops.map((o, n) => { const d = describeOp(o); return (
              <li key={n} className="rounded-lg bg-background p-3 text-sm">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{d.field}</p>
                <p className="mt-0.5 whitespace-pre-line text-foreground">{d.value}</p>
              </li>
            ); })}
          </ul>
          <p className="text-xs text-muted-foreground">Based on what you wrote: <q className="italic">{result.evidence}</q></p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" className="min-h-11 cursor-pointer gap-1.5" onClick={() => { const refused = onApply(result); if (refused) setResult({ kind: "cannot_help", message: refused }); else { setResult(null); setText(""); } }}><Check className="h-4 w-4" aria-hidden />{typeof applyLabel === "function" ? applyLabel(result) : applyLabel}</Button>
            <Button type="button" variant="outline" className="min-h-11 cursor-pointer gap-1.5 bg-background" onClick={reset}><Pencil className="h-4 w-4" aria-hidden />Edit what I wrote</Button>
            <Button type="button" variant="ghost" className="min-h-11 cursor-pointer gap-1.5" onClick={() => { setResult(null); setText(""); }}><X className="h-4 w-4" aria-hidden />Cancel</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
