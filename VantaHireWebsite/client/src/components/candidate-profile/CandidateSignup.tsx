// Candidate sign-up: email and password, then the consent popup on the same page, then email
// verification. Order is fixed (user + D0 lock): the professional-profile lookup starts only
// after consent AND a verified email, never while ownership of the email is unproven. Declining
// consent creates nothing and offers ealana jobs as a guest. Returning candidates sign in and
// resume where they left off; verification, consent and paid lookups aren't repeated.
// Prototype for the real page, which extends Flow's existing candidate-auth.tsx.
import { TetrisLoader } from "@/components/ui/loader-tetris";
import { useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConsentStep, type ConsentChoice } from "./ConsentStep";

type Props = {
  /** Creates the account with the recorded consent and sends the verification email. */
  onCreate: (email: string, password: string, consent: Extract<ConsentChoice, { accepted: true }>) => Promise<void>;
  onDeclined: () => void;
  signInUrl: string; privacyUrl: string; termsUrl: string; jobsUrl: string; consentVersion: string; draftWording?: boolean;
  /** Show the optional marketing choice (only where it's stored). */
  showMarketing?: boolean | undefined;
};

/** A message the server gave for the candidate to read (e.g. the email already has an account). */
export class CandidateAuthError extends Error {}

/** Same rule the server enforces on /api/register (server/auth.ts). */
export const PASSWORD_HINT = "At least 10 characters, with upper and lower case, a number and a symbol.";
export function passwordProblem(pw: string): string | undefined {
  if (pw.length < 10) return "Use at least 10 characters.";
  const missing = [!/[A-Z]/.test(pw) && "an upper-case letter", !/[a-z]/.test(pw) && "a lower-case letter", !/\d/.test(pw) && "a number", !/[^A-Za-z0-9]/.test(pw) && "a symbol"]
    .filter((x): x is string => !!x);
  if (!missing.length) return undefined;
  return `Add ${missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(", ")} and ${missing.at(-1)}`}.`;
}

export function CandidateSignup({ onCreate, onDeclined, signInUrl, privacyUrl, termsUrl, jobsUrl, consentVersion, draftWording, showMarketing = true }: Props) {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [show, setShow] = useState(false);
  const [errors, setErrors] = useState<{ email?: string | undefined; password?: string | undefined }>({});
  const [consentOpen, setConsentOpen] = useState(false); const [busy, setBusy] = useState(false); const [failed, setFailed] = useState<string | null>(null);

  function submit() {
    const e: typeof errors = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) e.email = "Enter your email address, like name@example.com";
    e.password = passwordProblem(password);
    setErrors(e); if (!e.email && !e.password) setConsentOpen(true);
  }
  async function decide(c: ConsentChoice) {
    if (!c.accepted) { setConsentOpen(false); onDeclined(); return; }
    setBusy(true); setFailed(null);
    try { await onCreate(email.trim(), password, c); setConsentOpen(false); }
    catch (err) { setFailed(err instanceof CandidateAuthError ? err.message : "We couldn't create your account. Please try again."); }
    finally { setBusy(false); }
  }

  return (
    <section className="mx-auto w-full max-w-md space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Create your account</h1>
        <p className="text-base text-muted-foreground">Create your free ealana account. We'll help you build your profile and find jobs that fit.</p>
      </div>
      <form className="space-y-4" noValidate onSubmit={e => { e.preventDefault(); submit(); }}>
        <div className="space-y-2">
          <Label htmlFor="su-email">Email</Label>
          <Input id="su-email" type="email" autoComplete="email" inputMode="email" className="min-h-11 text-base" value={email}
            aria-invalid={!!errors.email} aria-describedby={errors.email ? "su-email-err" : undefined} onChange={e => { setEmail(e.target.value); setErrors(x => ({ ...x, email: undefined })); }} />
          {errors.email && <p id="su-email-err" role="alert" className="text-sm text-destructive">{errors.email}</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="su-password">Password</Label>
          <div className="relative">
            <Input id="su-password" type={show ? "text" : "password"} autoComplete="new-password" className="min-h-11 pr-12 text-base" value={password}
              aria-invalid={!!errors.password} aria-describedby={errors.password ? "su-pw-err" : "su-pw-hint"} onChange={e => { setPassword(e.target.value); setErrors(x => ({ ...x, password: undefined })); }} />
            <button type="button" onClick={() => setShow(v => !v)} aria-label={show ? "Hide password" : "Show password"}
              className="absolute right-0 top-0 flex h-11 w-11 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {show ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
            </button>
          </div>
          {errors.password ? <p id="su-pw-err" role="alert" className="text-sm text-destructive">{errors.password}</p> : <p id="su-pw-hint" className="text-xs text-muted-foreground">{PASSWORD_HINT}</p>}
        </div>
        <Button type="submit" className="min-h-11 w-full cursor-pointer">Create account</Button>
      </form>
      <p className="text-center text-sm text-muted-foreground">Already have an account? <a href={signInUrl} className="font-medium text-foreground underline underline-offset-4">Sign in</a></p>

      <Dialog open={consentOpen} onOpenChange={o => { if (!busy) setConsentOpen(o); }}>
        <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col gap-0 overflow-hidden p-0">
          <DialogTitle className="sr-only">Set up your ealana matching profile</DialogTitle>
          <DialogDescription className="sr-only">How ealana uses your profile. Agree to continue.</DialogDescription>
          <ConsentStep bare textVersion={consentVersion} privacyUrl={privacyUrl} termsUrl={termsUrl} privacySettingsUrl="#privacy" jobsUrl={jobsUrl} draftWording={draftWording} showMarketing={showMarketing} onDecide={c => void decide(c)}
            status={busy ? <p role="status" className="flex items-center gap-2 text-sm text-foreground"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />Creating your account…</p>
              : failed ? <p role="alert" className="text-sm text-destructive">{failed}</p> : undefined} />
        </DialogContent>
      </Dialog>
    </section>
  );
}

/** Returning candidates: email and password. An unverified email goes to Check your email. */
export type ResetRequest = "sent" | "too_many" | "failed";
/** Asks the server to email a reset link. The server answers the same way whether or not the
 * account exists; only "too many requests" is told apart, and never shown as sent. */
export async function requestPasswordReset(email: string): Promise<ResetRequest> {
  try {
    const r = await fetch("/api/forgot-password", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ email }) });
    return r.ok ? "sent" : r.status === 429 ? "too_many" : "failed";
  } catch { return "failed"; }
}

/** Forgot password: one email field, then the same neutral answer for every address. */
export function ForgotPasswordForm({ initialEmail = "", onRequest = requestPasswordReset, onBack }: { initialEmail?: string | undefined; onRequest?: ((email: string) => Promise<ResetRequest>) | undefined; onBack: () => void }) {
  const [email, setEmail] = useState(initialEmail); const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "sending" | ResetRequest>("idle");
  async function submit() {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError("Enter your email address, like name@example.com"); return; }
    setError(null); setState("sending"); setState(await onRequest(email.trim()));
  }
  if (state === "sent") return (
    <section className="space-y-4" aria-live="polite">
      <h2 className="text-xl font-semibold text-foreground">Check your email</h2>
      <p className="text-sm text-muted-foreground">If there's an account for <span className="font-medium text-foreground">{email.trim()}</span>, we've sent a link to reset your password. It works for one hour.</p>
      <Button type="button" variant="outline" className="min-h-11 w-full cursor-pointer" onClick={onBack}>Back to sign in</Button>
    </section>
  );
  return (
    <form className="space-y-4" noValidate onSubmit={e => { e.preventDefault(); void submit(); }} aria-label="Reset your password">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold text-foreground">Reset your password</h2>
        <p className="text-sm text-muted-foreground">Enter the email you signed up with and we'll send you a link to choose a new password.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="fp-email">Email</Label>
        <Input id="fp-email" type="email" autoComplete="email" inputMode="email" className="min-h-11 text-base" value={email}
          aria-invalid={!!error} aria-describedby={error ? "fp-email-err" : undefined} onChange={e => { setEmail(e.target.value); setError(null); }} />
        {error && <p id="fp-email-err" role="alert" className="text-sm text-destructive">{error}</p>}
      </div>
      {state === "too_many" && <p role="alert" className="text-sm text-destructive">Too many reset requests. Please wait a few minutes and try again.</p>}
      {state === "failed" && <p role="alert" className="text-sm text-destructive">We couldn't send the reset link. Please try again.</p>}
      <Button type="submit" className="min-h-11 w-full cursor-pointer" disabled={state === "sending"}>
        {state === "sending" ? <><Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />Sending…</> : "Send reset link"}
      </Button>
      <Button type="button" variant="ghost" className="min-h-11 w-full cursor-pointer" onClick={onBack}>Back to sign in</Button>
    </form>
  );
}

export function CandidateSignIn({ onSignIn, signUpUrl, onRequestReset }: { onSignIn: (email: string, password: string) => Promise<void>; signUpUrl: string;
  onRequestReset?: ((email: string) => Promise<ResetRequest>) | undefined }) {
  const [forgot, setForgot] = useState(false);
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [show, setShow] = useState(false);
  const [errors, setErrors] = useState<{ email?: string | undefined; password?: string | undefined }>({});
  const [busy, setBusy] = useState(false); const [failed, setFailed] = useState<string | null>(null);
  async function submit() {
    const e: typeof errors = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) e.email = "Enter your email address, like name@example.com";
    if (!password) e.password = "Enter your password";
    setErrors(e); if (e.email || e.password) return;
    setBusy(true); setFailed(null);
    try { await onSignIn(email.trim(), password); }
    catch (err) { setFailed(err instanceof CandidateAuthError ? err.message : "We couldn't sign you in. Please try again."); }
    finally { setBusy(false); }
  }
  if (forgot) return (
    <section className="mx-auto w-full max-w-md">
      <ForgotPasswordForm initialEmail={email} onRequest={onRequestReset} onBack={() => setForgot(false)} />
    </section>
  );
  return (
    <section className="mx-auto w-full max-w-md space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Sign in</h1>
        <p className="text-base text-muted-foreground">Welcome back. Sign in to see your jobs and profile.</p>
      </div>
      <form className="space-y-4" noValidate onSubmit={e => { e.preventDefault(); void submit(); }}>
        <div className="space-y-2">
          <Label htmlFor="si-email">Email</Label>
          <Input id="si-email" type="email" autoComplete="email" inputMode="email" className="min-h-11 text-base" value={email}
            aria-invalid={!!errors.email} aria-describedby={errors.email ? "si-email-err" : undefined} onChange={e => { setEmail(e.target.value); setErrors(x => ({ ...x, email: undefined })); }} />
          {errors.email && <p id="si-email-err" role="alert" className="text-sm text-destructive">{errors.email}</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="si-password">Password</Label>
          <div className="relative">
            <Input id="si-password" type={show ? "text" : "password"} autoComplete="current-password" className="min-h-11 pr-12 text-base" value={password}
              aria-invalid={!!errors.password} aria-describedby={errors.password ? "si-pw-err" : undefined} onChange={e => { setPassword(e.target.value); setErrors(x => ({ ...x, password: undefined })); }} />
            <button type="button" onClick={() => setShow(v => !v)} aria-label={show ? "Hide password" : "Show password"}
              className="absolute right-0 top-0 flex h-11 w-11 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {show ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
            </button>
          </div>
          {errors.password && <p id="si-pw-err" role="alert" className="text-sm text-destructive">{errors.password}</p>}
          <button type="button" onClick={() => setForgot(true)}
            className="min-h-11 cursor-pointer text-sm font-medium text-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Forgot password?</button>
        </div>
        {failed && <p role="alert" className="text-sm text-destructive">{failed}</p>}
        <Button type="submit" className="min-h-11 w-full cursor-pointer" disabled={busy}>
          {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />Signing in…</> : "Sign in"}
        </Button>
      </form>
      <p className="text-center text-sm text-muted-foreground">New to ealana? <a href={signUpUrl} className="font-medium text-foreground underline underline-offset-4">Create an account</a></p>
    </section>
  );
}

/** After sign-up: verify the email. Nothing is looked up until this is done. */
/** Coral shades: a quiet board while the candidate goes to their inbox. */
const WAIT_SHADES = ["#F25C2E", "#F47A52", "#C2410C", "#F25C2E", "#E0552B", "#F68E6C", "#D9481F"] as const;

export function CheckYourEmail({ email, onResend, onChangeEmail, lookupReady = false, children }: { email: string; onResend: () => Promise<void>; onChangeEmail: () => void;
  /** The profile lookup line is shown only once the lookup is really connected. */
  lookupReady?: boolean; children?: React.ReactNode }) {
  const [sent, setSent] = useState<"idle" | "sending" | "sent">("idle");
  return (
    <section className="mx-auto w-full max-w-md space-y-5 text-center">
      <span aria-hidden className="mx-auto flex w-fit rounded-xl bg-spark-soft p-3"><TetrisLoader columns={6} rows={8} cellSize={6} gap={2} speed={90} label="Waiting for you to verify" aria-hidden role={undefined}
        colors={WAIT_SHADES} dotClassName="bg-background" flashColor="hsl(var(--foreground))" deadColor="hsl(var(--foreground) / 0.3)" /></span>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold text-foreground">Check your email</h1>
        <p className="text-base text-muted-foreground">We sent a link to <span className="font-medium text-foreground">{email}</span>. Open it to verify your email and continue.</p>
        {lookupReady && <p className="text-sm text-muted-foreground">Once you've verified, we'll look up your professional profile to save you typing.</p>}
      </div>
      <div className="flex flex-col gap-2">
        <Button type="button" variant="outline" className="min-h-11 cursor-pointer" disabled={sent !== "idle"}
          onClick={async () => { setSent("sending"); try { await onResend(); setSent("sent"); } catch { setSent("idle"); } }}>
          {sent === "sending" ? "Sending…" : sent === "sent" ? "Sent. Check your inbox" : "Resend the email"}
        </Button>
        <Button type="button" variant="ghost" className="min-h-11 cursor-pointer" onClick={onChangeEmail}>Use a different email</Button>
      </div>
      <p className="text-xs text-muted-foreground">Can't find it? Check your spam folder.</p>
      {children}
    </section>
  );
}
