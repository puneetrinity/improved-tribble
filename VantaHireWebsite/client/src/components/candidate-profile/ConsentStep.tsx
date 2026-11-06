// Signup consent: one affirmative action covering the disclosed uses (matching, profile lookup,
// talent network), every use listed before acceptance, marketing separate and unticked.
// Wording is a DRAFT pending policy/legal review (plan: "Signup popup and consent"; S2 lock:
// no public copy or hash is invented to bypass that gate). The accepted text version is
// recorded by the S2C backend with each purpose; this component only reports the choice.
import { useState, type ReactNode } from "react";
import { Bot, Briefcase, Mail, Network, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

/** Every purpose disclosed on this screen, recorded with the text version (never one boolean). */
export const CONSENT_PURPOSES = ["job_matching", "profile_enrichment", "ai_processing", "talent_network_discovery", "recruiter_contact"] as const;
export type ConsentPurpose = typeof CONSENT_PURPOSES[number];
export type ConsentChoice =
  | { accepted: true; textVersion: string; purposes: ConsentPurpose[]; marketing: boolean }
  | { accepted: false; textVersion: string };
type Props = {
  /** Version id of the consent text shown; recorded with the acceptance. */
  textVersion: string;
  privacyUrl: string; termsUrl: string; privacySettingsUrl: string; jobsUrl: string;
  /** Shows a visible "draft wording" marker until the copy is policy-reviewed. */
  draftWording?: boolean | undefined;
  /** Inside a dialog: no card of its own. The header and the agreement stay put; only the
   * explanation scrolls (layout from 21st.dev efferd "Dialog", sticky header/footer variant). */
  bare?: boolean;
  /** Progress or error shown beside the buttons (e.g. "Creating your account…"). */
  status?: ReactNode;
  /** The optional marketing choice is shown only where it's actually stored (no server field yet). */
  showMarketing?: boolean | undefined;
  onDecide: (c: ConsentChoice) => void;
};

type Use = { icon: typeof Briefcase; title: string; body: ReactNode };
const USES: Use[] = [
  { icon: Briefcase, title: "Match you with jobs", body: "We use the profile and preferences you confirm to find jobs that fit you." },
  { icon: Sparkles, title: "Fill in your details", body: "We look up your professional profile and read your résumé if you add one. You review the details we propose before they become part of your confirmed profile." },
  { icon: Bot, title: "Use AI", body: "AI reads your details, proposes profile details and suggests jobs. It can make mistakes. Nothing it proposes joins your confirmed profile until you accept it." },
  { icon: Network, title: "Let recruiters find you", body: <>Your confirmed profile joins the ealana talent network, where recruiters can discover it in their searches. <strong className="font-medium text-foreground">Your current employer isn't automatically excluded.</strong></> },
  { icon: Mail, title: "Let recruiters contact you", body: "Recruiters who unlock your profile can access your verified email address, your phone number if you add one, and your default résumé if you have one, to contact you about relevant jobs. Companies you apply to receive this information without needing to spend a credit." },
];

// Same five uses and wording, grouped by what they are about.
const GROUPS: { label: string; uses: Use[] }[] = [
  { label: "Building your profile", uses: [USES[1]!, USES[2]!, USES[0]!] },
  { label: "Being found by recruiters", uses: [USES[3]!, USES[4]!] },
];

export function ConsentStep({ textVersion, privacyUrl, termsUrl, privacySettingsUrl, jobsUrl, draftWording, bare, status, showMarketing = true, onDecide }: Props) {
  const Shell = bare ? BareShell : CardShell;
  const [agreed, setAgreed] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [declined, setDeclined] = useState(false);

  // Declining ends candidate onboarding: no profile setup, imports, matches or network access.
  if (declined) {
    return (
      <Shell draft={draftWording}>
        <h2 className="text-2xl font-semibold text-foreground">You can still apply to ealana jobs</h2>
        <p className="text-base text-muted-foreground">
          To continue setting up your profile and receive personalised job matches, you need to join the ealana talent network. If you choose not to, you can still browse ealana jobs and apply as a guest.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" className="min-h-11 cursor-pointer" onClick={() => setDeclined(false)}>Review consent</Button>
          <Button asChild variant="outline" className="min-h-11 cursor-pointer">
            <a href={jobsUrl} onClick={() => onDecide({ accepted: false, textVersion })}>Browse ealana jobs</a>
          </Button>
        </div>
      </Shell>
    );
  }

  const intro = (
    <div className="space-y-2">
      <h2 className="text-2xl font-semibold tracking-tight text-foreground text-balance">Set up your ealana matching profile</h2>
      <p className="text-base text-muted-foreground">Personalised job matching requires joining the ealana talent network. Here's what that means. Agreeing doesn't publish anything: recruiters only see your profile after you confirm it.</p>
    </div>
  );
  const uses = (
    <div className="space-y-6" aria-label="What you're agreeing to" role="group">
      {GROUPS.map(g => (
        <section key={g.label} className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{g.label}</h3>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {g.uses.map(u => (
              <li key={u.title} className="flex gap-3.5 p-4">
                <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-spark-soft text-spark-ink"><u.icon className="h-[18px] w-[18px]" /></span>
                <div className="min-w-0 space-y-0.5"><p className="font-medium text-foreground">{u.title}</p><p className="text-sm leading-relaxed text-muted-foreground">{u.body}</p></div>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="flex items-start gap-2.5 rounded-xl bg-muted/60 p-4 text-sm leading-relaxed text-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span>You can withdraw any time in <a href={privacySettingsUrl} className="font-medium underline underline-offset-4">Privacy settings</a>. Withdrawing stops personalised matching and new recruiter access to your talent-network profile. Employers keep details already unlocked on existing job records, without future updates. Your submitted applications remain unchanged.</span>
      </p>
    </div>
  );
  const agreement = (
    <div className="space-y-4">
      <div className="space-y-1">
        <label className="flex min-h-11 cursor-pointer items-start gap-3 py-1 text-sm text-foreground">
          <Checkbox checked={agreed} onCheckedChange={v => setAgreed(v === true)} className="mt-0.5" aria-describedby="consent-required" />
          <span>I agree to the uses above, the <a href={privacyUrl} target="_blank" rel="noopener noreferrer" className="font-medium underline underline-offset-4">Privacy Policy</a> and the <a href={termsUrl} target="_blank" rel="noopener noreferrer" className="font-medium underline underline-offset-4">Terms of Service</a>.<span id="consent-required" className="sr-only"> Required.</span></span>
        </label>
        {showMarketing && (
          <label className="flex min-h-11 cursor-pointer items-start gap-3 py-1 text-sm text-foreground">
            <Checkbox checked={marketing} onCheckedChange={v => setMarketing(v === true)} className="mt-0.5" />
            <span>Send me ealana news and tips by email. <span className="text-muted-foreground">Optional.</span></span>
          </label>
        )}
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
        {status && <div className="sm:mr-auto">{status}</div>}
        <Button type="button" variant="ghost" className="min-h-11 cursor-pointer" onClick={() => setDeclined(true)}>Not now</Button>
        <Button type="button" className="min-h-11 cursor-pointer" disabled={!agreed} onClick={() => onDecide({ accepted: true, textVersion, purposes: [...CONSENT_PURPOSES], marketing: showMarketing && marketing })}>Agree and continue</Button>
      </div>
    </div>
  );

  if (bare) return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="space-y-3 border-b border-border px-6 pb-5 pt-6 sm:px-8">{draftWording && <DraftMark />}{intro}</header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-muted/25 px-6 py-6 sm:px-8">{uses}</div>
      <footer className="border-t border-border bg-background px-6 py-5 sm:px-8">{agreement}</footer>
    </div>
  );
  return <Shell draft={draftWording}>{intro}{uses}<div className="border-t border-border pt-5">{agreement}</div></Shell>;
}

function BareShell({ draft, children }: { draft?: boolean | undefined; children: ReactNode }) {
  return <div className="space-y-6 overflow-y-auto p-6 sm:p-8">{draft && <DraftMark />}{children}</div>;
}
function DraftMark() {
  return <p className="inline-flex rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-900">Draft wording, pending policy review</p>;
}
function CardShell({ draft, children }: { draft?: boolean | undefined; children: ReactNode }) {
  return (
    <section className="mx-auto w-full max-w-xl space-y-6 rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
      {draft && <DraftMark />}
      {children}
    </section>
  );
}
