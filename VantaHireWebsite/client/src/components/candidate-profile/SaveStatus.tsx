import { AlertCircle, CheckCircle2, Clock } from "lucide-react";
import Orb from "@/components/ui/orb";
import { STILL_WORKING, useSlowAfter } from "./SparkStates";

export type SaveState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "pending" }
  | { kind: "retrying"; message: string }
  | { kind: "saved"; message?: string | undefined }
  | { kind: "error"; message: string };

/** Pill + text. Colour is never the only signal: every state has its own icon and words.
 * `retrying` is the server's automatic retry. Held saves get the server's own Try again / Discard (CareerProfilePanel). */
export function SaveStatus({ state }: { state: SaveState }) {
  // A save still going after ~8 seconds says so (ten-states: slow network).
  const slow = useSlowAfter(state.kind === "sending" || state.kind === "pending");
  if (state.kind === "idle") return <span className="sr-only" aria-live="polite" />;
  const view = {
    sending: { icon: <span aria-hidden className="inline-flex shrink-0"><Orb variant="pulse" size={16} color="#F25C2E" /></span>, text: slow ? STILL_WORKING : "Saving…", tone: "border-border bg-muted text-foreground" },
    pending: { icon: <span aria-hidden className="inline-flex shrink-0"><Orb variant="pulse" size={16} color="#F25C2E" /></span>, text: slow ? STILL_WORKING : "Saving…", tone: "border-border bg-muted text-foreground" },
    retrying: { icon: <Clock className="h-4 w-4" aria-hidden />, text: state.kind === "retrying" ? state.message : "", tone: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100" },
    saved: { icon: <CheckCircle2 className="h-4 w-4" aria-hidden />, text: state.kind === "saved" ? state.message ?? "Saved" : "", tone: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-100" },
    error: { icon: <AlertCircle className="h-4 w-4" aria-hidden />, text: state.kind === "error" ? state.message : "", tone: "border-destructive/40 bg-destructive/10 text-destructive" },
  }[state.kind];
  return (
    <p role={state.kind === "error" ? "alert" : "status"} aria-live="polite"
      className={`inline-flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${view.tone}`}>
      <span className="mt-0.5 shrink-0">{view.icon}</span>
      <span>{view.text}</span>
    </p>
  );
}
