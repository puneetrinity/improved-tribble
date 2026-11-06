import { useCallback, useEffect, useRef, useState } from "react";
import {
  describeReason, fetchReceipt, pollDelay, ProfileApiError, reasonForStatus, submitCommand,
  type CommandBody, type Receipt,
} from "@/lib/candidate-profile-api";
import type { SaveState } from "@/components/candidate-profile/SaveStatus";

export type Outcome =
  | { status: "applied"; receipt: Receipt }
  | { status: "rejected" | "held"; reason: string }
  | { status: "uncertain" }
  | { status: "cancelled" };

type Deps = { submit?: typeof submitCommand | undefined; receipt?: typeof fetchReceipt | undefined; sleep?: ((ms: number) => Promise<void>) | undefined };
const realSleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
export const UNCERTAIN_COPY = "We couldn't reach the server, so we don't know whether this edit was saved. Send it again to check. It won't be saved twice.";
export const NOT_FOUND_COPY = "We can't find this edit any more. Refresh to check your profile.";
const SEND_ATTEMPTS = 3;

/** Receipt read failures that waiting won't fix. Network errors, 429 and 5xx stay transient. */
function permanentReceiptFailure(e: unknown): { reason: string; message: string; block: boolean } | null {
  if (!(e instanceof ProfileApiError)) return null;
  if (e.status === 401 || e.status === 403) return { reason: "authentication_changed", message: describeReason("authentication_changed").message, block: true };
  if (e.status === 451) return { reason: "candidate_privacy_restricted", message: describeReason("candidate_privacy_restricted").message, block: true };
  if (e.status === 404) return { reason: "not_found", message: NOT_FOUND_COPY, block: false };
  return null;
}

/** One save at a time. The idempotency key is fixed by the caller's body: a send whose
 * outcome is unknown stays locked until it is re-sent with the identical body and key. */
export function useProfileCommand(onApplied: (r: Receipt) => void, deps: Deps = {}, onBlocked?: (reason: string) => void) {
  const [state, setRaw] = useState<SaveState>({ kind: "idle" });
  // Polling repeats the same status; skip identical updates so a held save doesn't re-render every poll.
  const setState = useCallback((next: SaveState) => setRaw(prev =>
    prev.kind === next.kind && (prev as { message?: string }).message === (next as { message?: string }).message ? prev : next), []);
  // A send whose admission is unknown. Save and confirm stay locked until it is resolved.
  const [unresolved, setUnresolved] = useState<CommandBody | null>(null);
  // Signed out or privacy-restricted while watching: no further edits until the page reloads.
  const [blocked, setBlocked] = useState(false);
  const alive = useRef(true);
  const submit = deps.submit ?? submitCommand, receipt = deps.receipt ?? fetchReceipt, sleep = deps.sleep ?? realSleep;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const watch = useCallback(async (commandId: string): Promise<Outcome> => {
    for (let attempt = 0; alive.current; attempt++) {
      let r: Receipt | null = null;
      try { r = await receipt(commandId); }
      catch (e) {
        const stop = permanentReceiptFailure(e);
        if (stop) {
          if (!alive.current) break;
          setState({ kind: "error", message: stop.message });
          if (stop.block) { setBlocked(true); onBlocked?.(stop.reason); }
          return { status: "held", reason: stop.reason };
        }
        /* transient: keep the last shown state and poll again */
      }
      if (!alive.current) break;
      if (r?.status === "applied") { setState({ kind: "saved" }); onApplied(r); return { status: "applied", receipt: r }; }
      if (r?.status === "rejected") { setState({ kind: "error", message: describeReason(r.reason).message }); return { status: "rejected", reason: r.reason ?? "unknown" }; }
      if (r?.status === "held") {
        const d = describeReason(r.reason);
        if (!d.retryable) { setState({ kind: "error", message: d.message }); return { status: "held", reason: r.reason ?? "unknown" }; }
        setState({ kind: "retrying", message: d.message });
      } else if (r?.status === "pending") setState({ kind: "pending" });
      await sleep(pollDelay(attempt));
    }
    return { status: "cancelled" };
  }, [receipt, sleep, onApplied, onBlocked, setState]);

  const run = useCallback(async (body: CommandBody): Promise<Outcome> => {
    setState({ kind: "sending" });
    let commandId: string | null = null;
    for (let attempt = 0; attempt < SEND_ATTEMPTS && alive.current; attempt++) {
      try { commandId = await submit(body); break; }
      catch (e) {
        if (e instanceof ProfileApiError && e.code === "uncertain") { await sleep(pollDelay(attempt)); continue; }
        const reason = reasonForStatus(e);
        setUnresolved(null);
        setState({ kind: "error", message: describeReason(reason).message });
        return { status: "rejected", reason };
      }
    }
    if (!commandId) {
      if (alive.current) { setUnresolved(body); setState({ kind: "error", message: UNCERTAIN_COPY }); }
      return { status: "uncertain" };
    }
    setUnresolved(null);
    setState({ kind: "pending" });
    return watch(commandId);
  }, [submit, sleep, watch, setState]);

  /** Re-send the unresolved edit with its original body and idempotency key. */
  const resend = useCallback(() => unresolved ? run(unresolved) : Promise.resolve<Outcome>({ status: "cancelled" }), [unresolved, run]);

  const inFlight = state.kind === "sending" || state.kind === "pending" || state.kind === "retrying";
  const busy = inFlight || unresolved !== null || blocked;
  return { state, setState, run, watch, resend, busy, inFlight, unresolved: unresolved !== null, blocked };
}
