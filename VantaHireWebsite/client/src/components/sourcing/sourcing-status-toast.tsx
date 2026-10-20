import { useEffect, useRef, type ReactElement } from "react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { toast as showToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { rcProgressPresentation } from "@shared/rc-skills-progress";

export type SourcingNoticeTone = "info" | "done" | "attention" | "failed";

export interface SourcingNotice {
  /** Stable identity: a notice is shown once per key; counts may update it in place. */
  key: string;
  tone: SourcingNoticeTone;
  title: string;
  description?: string;
  retry?: () => void;
}

type RcProgress = Parameters<typeof rcProgressPresentation>[0];

export interface SourcingNoticeInput {
  capabilityError?: boolean | undefined;
  onCapabilityRetry?: (() => void) | undefined;
  rcProgress?: RcProgress | undefined;
  rcStatusUnavailable?: boolean | undefined;
  /** Overall run status from the sourcing status endpoint, e.g. "completed". */
  runStatus?: string | undefined;
  governedMessage?: string | undefined;
  briefSourcingNotice?: boolean | undefined;
}

const RANK: Record<SourcingNoticeTone, number> = { failed: 3, attention: 2, info: 1, done: 0 };

function governedTone(message: string): SourcingNoticeTone {
  if (/^We couldn[’']t/.test(message)) return "failed";
  if (/changed\. Click Find candidates/.test(message)) return "attention";
  return "info";
}

/** Choose the single notice to show (toasts display one at a time): most severe first. */
export function pickSourcingNotice(input: SourcingNoticeInput): SourcingNotice | null {
  const notices: SourcingNotice[] = [];
  if (input.capabilityError) {
    notices.push({
      key: "capability-error",
      tone: "failed",
      title: "We couldn’t load search settings.",
      ...(input.onCapabilityRetry ? { retry: input.onCapabilityRetry } : {}),
    });
  }
  if (input.rcProgress || input.rcStatusUnavailable) {
    const rc = input.rcStatusUnavailable ? undefined : input.rcProgress;
    const p = rcProgressPresentation(rc, input.rcStatusUnavailable);
    const counts = rc && rc.total > 0 ? `${rc.processed} of ${rc.total} profiles checked. ` : "";
    const tone: SourcingNoticeTone =
      p.tone === "failed" ? "failed" : p.tone === "attention" ? "attention" : p.tone === "done" ? "done" : "info";
    if (tone === "done" && input.runStatus === "completed") {
      // Results are already on the page; "being prepared" would be stale.
      notices.push({ key: "rc:done:ready", tone, title: "Your results are ready.", description: `${p.heading}. ${counts}`.trim() });
    } else {
      notices.push({ key: `rc:${p.tone}:${p.heading}`, tone, title: p.heading, description: `${counts}${p.message}`.trim() });
    }
  }
  if (input.governedMessage) {
    notices.push({ key: `governed:${input.governedMessage}`, tone: governedTone(input.governedMessage), title: input.governedMessage });
  }
  if (input.briefSourcingNotice) {
    notices.push({
      key: "brief-not-enabled",
      tone: "info",
      title: "Searching isn’t turned on for this job yet.",
      description: "Approving the hiring criteria doesn’t start a search.",
    });
  }
  // Stable sort keeps the listed order for equal severity.
  return notices.sort((a, b) => RANK[b.tone] - RANK[a.tone])[0] ?? null;
}

const ICON: Record<SourcingNoticeTone, ReactElement> = {
  info: <Info className="h-4 w-4 shrink-0 text-sky-600" aria-hidden="true" />,
  done: <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />,
  attention: <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />,
  failed: <XCircle className="h-4 w-4 shrink-0" aria-hidden="true" />,
};

const TONE_CLASS: Record<SourcingNoticeTone, string> = {
  info: "",
  done: "",
  attention: "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-50",
  failed: "",
};

/** Info/done fade after 5 s; attention and failures stay until dismissed or resolved. */
export const AUTO_DISMISS_MS = 5000;

const isPersistent = (tone: SourcingNoticeTone) => tone === "attention" || tone === "failed";

/** Session-scoped memory of persistent notices the recruiter dismissed (notice identity only, per job). */
const DISMISSED_PREFIX = "ealana:sourcing-notice-dismissed:";
function readDismissed(scope: string): Set<string> {
  try {
    const raw = window.sessionStorage.getItem(DISMISSED_PREFIX + scope);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}
function rememberDismissed(scope: string, key: string) {
  try {
    const keys = readDismissed(scope);
    keys.add(key);
    window.sessionStorage.setItem(DISMISSED_PREFIX + scope, JSON.stringify([...keys].slice(-50)));
  } catch {
    /* storage unavailable: dismissal still applies for this page view */
  }
}

interface Handle {
  key: string;
  id: string;
  update: (props: never) => void;
  dismiss: () => void;
}

function toastProps(n: SourcingNotice, controls: { retry: () => void; close: () => void }) {
  const persistent = isPersistent(n.tone);
  return {
    variant: n.tone === "failed" ? ("destructive" as const) : ("default" as const),
    className: TONE_CLASS[n.tone],
    duration: persistent ? Number.POSITIVE_INFINITY : AUTO_DISMISS_MS,
    // Critical states interrupt screen readers; progress is announced politely.
    type: persistent ? ("foreground" as const) : ("background" as const),
    // The shared toast types only allow a string title, so the icon, title and detail render together in the body.
    description: (
      <span className="flex items-start gap-2" data-sourcing-notice={n.tone}>
        <span className="mt-0.5">{ICON[n.tone]}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{n.title}</span>
          {n.description ? <span className="mt-0.5 block text-sm opacity-90">{n.description}</span> : null}
        </span>
        {persistent ? (
          // Visible, labelled, 44px dismissal for persistent notices (the shared close is hover-only).
          <button
            type="button"
            aria-label="Dismiss notification"
            onClick={controls.close}
            className="-my-2 -mr-2 inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current dark:hover:bg-white/10"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
      </span>
    ),
    ...(n.retry
      ? { action: <ToastAction altText="Try loading search settings again" onClick={controls.retry}>Try again</ToastAction> }
      : {}),
  };
}

/**
 * Shows the current sourcing notice as a toast instead of inline text at the top of the page.
 * - Scoped to one job (`scope`): keys, suppression and dismissals never cross jobs; changing job resets state.
 * - The toast this page opened is always closed when superseded, when its condition clears, and on unmount.
 * - A notice is opened once per key in a page view (polling never re-opens it); same-key updates (counts, retry
 *   handler) apply in place. A persistent notice dismissed with its Dismiss button stays dismissed for this job for
 *   the browser session (sessionStorage, notice identity only). Swipe/Escape close it for this page view only;
 *   `onOpenChange` is deliberately not passed because the shared toast() owns it.
 */
export function useSourcingStatusToast(scope: string, notice: SourcingNotice | null) {
  const current = useRef<Handle | null>(null);
  const shown = useRef<{ scope: string; keys: Set<string> }>({ scope, keys: new Set() });
  const retryRef = useRef<(() => void) | undefined>(notice?.retry);
  retryRef.current = notice?.retry;

  const signature = notice ? `${scope}\u0000${notice.key}\u0000${notice.description ?? ""}` : `${scope}\u0000`;

  useEffect(() => {
    if (shown.current.scope !== scope) {
      current.current?.dismiss();
      current.current = null;
      shown.current = { scope, keys: new Set() };
    }
    // Same notice still applicable: refresh it in place.
    if (notice && current.current?.key === notice.key) {
      current.current.update({ id: current.current.id, ...toastProps(notice, controlsFor(notice.key)) } as never);
      return;
    }
    // Anything else first retires the toast this page owns (resolved, superseded or replaced).
    current.current?.dismiss();
    current.current = null;
    if (!notice) return;
    if (shown.current.keys.has(notice.key)) return;
    if (isPersistent(notice.tone) && readDismissed(scope).has(notice.key)) return;
    shown.current.keys.add(notice.key);
    const handle = showToast(toastProps(notice, controlsFor(notice.key))) as unknown as Omit<Handle, "key">;
    current.current = { key: notice.key, ...handle };

    function controlsFor(key: string) {
      const persistent = notice ? isPersistent(notice.tone) : false;
      return {
        retry: () => retryRef.current?.(),
        close: () => {
          if (persistent) rememberDismissed(scope, key);
          if (current.current?.key === key) {
            current.current.dismiss();
            current.current = null;
          }
        },
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  // Leaving the page never leaves this page's notice on another screen.
  useEffect(
    () => () => {
      current.current?.dismiss();
      current.current = null;
    },
    [],
  );
}
