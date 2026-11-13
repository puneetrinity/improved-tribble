// spark candidates' talent-network consent (v2) on the privacy page: status and withdrawal.
// Withdrawal never asks the candidate to accept the copy again; rejoining goes through the
// setup page, which shows the approved consent text and needs an explicit tick.
// Wording approved by the user on 2 Nov 2026.
import Orb from "@/components/ui/orb";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CONSENT_BASE, consentBlocked, newKey, ProfileApiError, readConsent, type ConsentStatus } from "@/lib/candidate-profile-api";
import { fetchWithCsrf } from "@/lib/csrf";

export const WITHDRAW_LINE = "Withdrawing stops personalised matching and new recruiter access to your talent-network profile. Employers keep details already unlocked on existing job records, without future updates. Your submitted applications remain unchanged.";
/** Approved by the user, 2 Nov 2026. */
export const WITHDRAW_FAILED = "We couldn't save your choice. Please try again.";
const KEY = ["/api/candidate/product/consent"] as const;
/** While a choice is being applied the panel checks again by itself, up to this many times. */
export const PENDING_POLL_MS = 4000;
export const PENDING_POLLS = 15;

type PanelState = "held" | "joined" | "withdrawn" | "none" | "applying";
/** "joined"/"withdrawn" only once the server has delivered the current choice; anything still on its
 * way (joining or withdrawing) is "applying". No consent on record is its own state, never "joined". */
export function panelState(s: ConsentStatus): PanelState {
  if (consentBlocked(s)) return "held";
  const settled = s.deliveryStatus === "delivered" && s.acknowledgedRevision === s.consentRevision;
  if (settled && s.acknowledgedAction === "grant") return "joined";
  if (settled && s.acknowledgedAction === "withdraw") return "withdrawn";
  if (s.desiredAction === null && s.acknowledgedAction === null) return "none";
  return "applying";
}

export async function withdrawConsent(body: { idempotencyKey: string; expectedConsentRevision: number }, fetcher: typeof fetch = fetchWithCsrf as typeof fetch): Promise<void> {
  let res: Response;
  try { res = await fetcher(CONSENT_BASE, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ schemaVersion: 2, action: "withdraw", ...body }) }); }
  catch { throw new ProfileApiError(0, "uncertain", "Network error"); }
  if (!res.ok) throw new ProfileApiError(res.status, null);
}

export function SparkConsentPanel({ fetcher, postFetcher, setupUrl = "/candidate-setup" }: { fetcher?: typeof fetch; postFetcher?: typeof fetch; setupUrl?: string }) {
  const qc = useQueryClient();
  const status = useQuery<ConsentStatus>({ queryKey: KEY, queryFn: () => readConsent(fetcher), retry: false });
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // One withdrawal request per candidate decision: a retry re-sends the same key.
  const pending = useRef<{ idempotencyKey: string; expectedConsentRevision: number } | null>(null);

  async function withdraw() {
    const s = status.data; if (!s) return;
    pending.current ??= { idempotencyKey: newKey(), expectedConsentRevision: s.consentRevision };
    setBusy(true); setFailed(false);
    try { await withdrawConsent(pending.current, postFetcher); pending.current = null; setConfirming(false); await qc.invalidateQueries({ queryKey: KEY }); await qc.invalidateQueries({ queryKey: ["/api/candidate/product/profile"] }); }
    catch { setFailed(true); }
    finally { setBusy(false); }
  }

  const s = status.data;
  const state = s ? panelState(s) : null;
  useEffect(() => {
    if (state) void qc.invalidateQueries({ queryKey: ["/api/candidate/product/profile"] });
  }, [qc, state, s?.acknowledgedRevision]);
  // Bounded automatic re-check while applying; "Check again" is always there too.
  const polls = useRef(0);
  useEffect(() => {
    if (state !== "applying") { polls.current = 0; return; }
    if (polls.current >= PENDING_POLLS) return;
    const t = setTimeout(() => { polls.current += 1; void status.refetch(); }, PENDING_POLL_MS);
    return () => clearTimeout(t);
  }, [state, status.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Card>
      <CardHeader><CardTitle>Talent network and matching</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        {status.isLoading ? <p role="status" className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />Loading…</p>
          : status.isError || !s ? (
            <div role="alert" className="space-y-3">
              <p className="text-foreground">We couldn't load your network settings.</p>
              <Button type="button" variant="outline" className="min-h-11 cursor-pointer" onClick={() => void status.refetch()}>Try again</Button>
            </div>
          ) : state === "held" ? (
            <p className="text-foreground">Your account needs a check by our team.</p>
          ) : state === "withdrawn" ? (
            <div className="space-y-3">
              <p className="text-foreground">You've withdrawn from the ealana talent network.</p>
              <Button asChild className="min-h-11 cursor-pointer"><a href={setupUrl}>Join again</a></Button>
            </div>
          ) : state === "applying" ? (
            <div className="space-y-3">
              <p role="status" className="flex items-center gap-2 text-foreground"><span aria-hidden className="inline-flex shrink-0"><Orb variant="sweep" size={18} color="#F25C2E" /></span>Your choice is saved and being applied.</p>
              <Button type="button" variant="outline" className="min-h-11 cursor-pointer" disabled={status.isFetching} onClick={() => void status.refetch()}>Check again</Button>
            </div>
          ) : state === "none" ? (
            <div className="space-y-3">
              <p className="text-foreground">You haven't joined the ealana talent network.</p>
              <Button asChild className="min-h-11 cursor-pointer"><a href={setupUrl}>Join</a></Button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-foreground">You've joined the ealana talent network.</p>
              <p className="text-muted-foreground">{WITHDRAW_LINE}</p>
              <Button type="button" variant="outline" className="min-h-11 cursor-pointer" onClick={() => setConfirming(true)}>Withdraw</Button>
            </div>
          )}
      </CardContent>
      <Dialog open={confirming} onOpenChange={o => { if (!o && !busy) setConfirming(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Withdraw from the talent network?</DialogTitle>
            <DialogDescription>{WITHDRAW_LINE}</DialogDescription>
          </DialogHeader>
          {failed && <p role="alert" className="text-sm text-destructive">{WITHDRAW_FAILED}</p>}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="min-h-11 cursor-pointer" disabled={busy} onClick={() => setConfirming(false)}>Cancel</Button>
            <Button type="button" variant="destructive" className="min-h-11 cursor-pointer" disabled={busy} onClick={() => void withdraw()}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />}Withdraw
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
