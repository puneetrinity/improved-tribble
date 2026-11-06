// Screen states every spark page shares (UI ten-states standard, wording approved 2 Nov 2026):
// offline, still working after ~8s, signed out, and the password check before confirming.
import { useEffect, useState } from "react";
import { Loader2, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ProfileApiError, reauthenticate } from "@/lib/candidate-profile-api";

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine !== false);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  return online;
}

/** Shown only while the browser is offline. Promises nothing about unsaved edits. */
export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <p role="status" className="sticky top-0 z-40 flex items-center justify-center gap-2 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
      <WifiOff className="h-4 w-4 shrink-0" aria-hidden />You're offline. Reconnect to continue. Changes already saved are safe.
    </p>
  );
}

export const SLOW_AFTER_MS = 8000;
/** True once `active` has stayed true for `ms`. */
export function useSlowAfter(active: boolean, ms = SLOW_AFTER_MS): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!active) { setSlow(false); return; }
    const t = setTimeout(() => setSlow(true), ms);
    return () => clearTimeout(t);
  }, [active, ms]);
  return slow;
}
export const STILL_WORKING = "Still working…";
/** "Still working…" under a load or save that has taken more than ~8 seconds. */
export function StillWorking({ active, className = "" }: { active: boolean; className?: string }) {
  const slow = useSlowAfter(active);
  if (!slow) return null;
  return <p role="status" className={`text-sm text-muted-foreground ${className}`}>{STILL_WORKING}</p>;
}

/** The session ended while the candidate was using spark. */
export function SessionEnded({ signInUrl = "/candidate-auth#signin" }: { signInUrl?: string }) {
  return (
    <div className="min-h-screen bg-background px-4 text-foreground">
      <section role="alert" className="mx-auto w-full max-w-md space-y-4 py-16">
        <h1 className="text-2xl font-semibold text-foreground">You've been signed out</h1>
        <p className="text-base text-muted-foreground">Sign in again to continue. Anything you saved is kept.</p>
        <Button asChild className="min-h-11 cursor-pointer"><a href={signInUrl}>Sign in</a></Button>
      </section>
    </div>
  );
}

/** Password check the server needs (a sign-in within the last 10 minutes) before confirming.
 * "That password isn't right." is shown only for a wrong password; anything else says so. */
export function ReauthDialog({ open, onCancel, onConfirmed, onSignedOut, fetcher }: {
  open: boolean; onCancel: () => void; onConfirmed: () => void; onSignedOut?: () => void; fetcher?: typeof fetch;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Seconds left before another try is allowed, when the server says (rate limit).
  const [wait, setWait] = useState(0);
  useEffect(() => { if (!open) { setPassword(""); setError(null); setBusy(false); setWait(0); } }, [open]);
  useEffect(() => { if (wait <= 0) return; const t = setTimeout(() => setWait(w => w - 1), 1000); return () => clearTimeout(t); }, [wait]);
  async function submit() {
    // The button is disabled while busy or rate-limited; a direct form submit is refused the same way.
    if (!password || busy || wait > 0) return;
    setBusy(true); setError(null);
    try { await reauthenticate(password, fetcher); setPassword(""); onConfirmed(); }
    catch (e) {
      const code = e instanceof ProfileApiError ? e.code : null, status = e instanceof ProfileApiError ? e.status : 0;
      if (status === 401 && code === "candidate_privacy_reauth_failed") setError(WRONG_PASSWORD);
      else if (status === 401) { onSignedOut?.(); }
      else if (status === 429) { setError(TOO_MANY_ATTEMPTS); setWait(e instanceof ProfileApiError ? e.retryAfterSeconds ?? 0 : 0); }
      else setError(REAUTH_FAILED);
    } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onOpenChange={o => { if (!o && !busy) onCancel(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Confirm it's you</DialogTitle>
          <DialogDescription>Enter your password to confirm your profile.</DialogDescription>
        </DialogHeader>
        <form className="space-y-2" noValidate onSubmit={e => { e.preventDefault(); void submit(); }}>
          <Label htmlFor="reauth-password">Password</Label>
          <Input id="reauth-password" type="password" autoComplete="current-password" className="min-h-11 text-base" value={password} autoFocus
            aria-invalid={!!error} aria-describedby={error ? "reauth-error" : undefined} onChange={e => { setPassword(e.target.value); setError(null); }} />
          {error && <p id="reauth-error" role="alert" className="text-sm text-destructive">{error}</p>}
          {wait > 0 && <p className="text-sm text-muted-foreground" aria-live="off">Try again in {Math.floor(wait / 60)}:{String(wait % 60).padStart(2, "0")}.</p>}
          <DialogFooter className="gap-2 pt-2">
            <Button type="button" variant="outline" className="min-h-11 cursor-pointer" disabled={busy} onClick={onCancel}>Cancel</Button>
            <Button type="submit" className="min-h-11 cursor-pointer" disabled={busy || !password || wait > 0}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />}Confirm
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
export const WRONG_PASSWORD = "That password isn't right.";
/** Approved 2 Nov 2026. The countdown shows only when the server gives a wait time. */
export const TOO_MANY_ATTEMPTS = "Too many attempts. Please wait before trying again.";
export const REAUTH_FAILED = "We couldn't check your password. Please try again.";
