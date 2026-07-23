import { useEffect, useState } from 'react';
import { loadApolloTracker, loadGoogleAnalytics } from '@/lib/analytics';
import { getClientConfig } from '@/lib/config';
import { X } from 'lucide-react';

const CONSENT_KEY = 'consent.analytics';
const EVENT_OPEN = 'cookie-consent:open';

export function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      const val = localStorage.getItem(CONSENT_KEY);
      if (!val) setVisible(true);
    } catch {
      // if storage unavailable, show banner
      setVisible(true);
    }
  }, []);

  // Allow reopening the banner from anywhere (e.g., footer link)
  useEffect(() => {
    const handler = (e: Event) => {
      try {
        const ce = e as CustomEvent;
        if (ce.detail?.reset) localStorage.removeItem(CONSENT_KEY);
      } catch {}
      setVisible(true);
    };
    window.addEventListener(EVENT_OPEN, handler as EventListener);
    return () => window.removeEventListener(EVENT_OPEN, handler as EventListener);
  }, []);

  const accept = async () => {
    try {
      localStorage.setItem(CONSENT_KEY, 'accepted');
    } catch {}
    // Inject analytics only after consent
    try {
      // Load Google Analytics
      loadGoogleAnalytics();
      // Load Apollo using server-provided appId
      const cfg = await getClientConfig();
      if (cfg.apolloAppId) loadApolloTracker(cfg.apolloAppId);
    } catch {}
    setVisible(false);
  };

  const decline = () => {
    try {
      localStorage.setItem(CONSENT_KEY, 'declined');
    } catch {}
    setVisible(false);
  };

  if (!visible) return null;

  const reduced = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  return (
    <div className="fixed bottom-4 left-1/2 z-[1000] w-[calc(100%-1rem)] max-w-[28rem] -translate-x-1/2 md:bottom-6 md:left-auto md:right-6 md:max-w-[26rem] md:translate-x-0">
      <div
        className="relative overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(17,19,38,0.96)_0%,rgba(10,12,24,0.98)_100%)] p-4 shadow-[0_24px_90px_rgba(0,0,0,0.38)] backdrop-blur-2xl md:p-5"
        style={{
          transition: reduced ? 'none' : undefined,
          background: 'linear-gradient(180deg, rgba(20,24,46,0.98) 0%, rgba(10,12,24,0.995) 100%)',
        }}
      >
        <div className="pointer-events-none absolute inset-x-6 top-0 h-20 bg-[radial-gradient(circle_at_top,rgba(75,142,240,0.18),transparent_65%)]" />
        <button
          type="button"
          aria-label="Dismiss cookie banner"
          onClick={decline}
          className="absolute right-3 top-3 rounded-full border border-white/10 bg-white/[0.04] p-1.5 text-white/60 transition-colors hover:bg-white/[0.08] hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="relative">
          <div className="mb-3 font-mono text-[0.68rem] uppercase tracking-[0.18em]" style={{ color: '#4B8EF0' }}>
            Cookie Preferences
          </div>
          <p className="mb-4 pr-8 text-sm leading-6 md:text-[0.97rem]" style={{ color: '#E7EBF7' }}>
            We use cookies to measure traffic and improve the product experience. You can allow analytics now and change this later from Cookie Preferences.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={decline}
              className="inline-flex h-11 items-center justify-center rounded-xl px-4 text-sm font-medium transition-colors"
              style={{
                border: '1px solid rgba(255,255,255,0.14)',
                background: 'rgba(255,255,255,0.06)',
                color: '#F4F5FA',
              }}
            >
              Decline
            </button>
            <button
              type="button"
              onClick={accept}
              className="inline-flex h-11 items-center justify-center rounded-xl px-4 text-sm font-semibold text-white transition-all hover:brightness-110"
              style={{
                background: '#4B8EF0',
                color: '#FFFFFF',
                boxShadow: '0 12px 30px rgba(75,142,240,0.25)',
              }}
            >
              Accept
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AnalyticsOnConsent() {
  useEffect(() => {
    (async () => {
      try {
        const val = localStorage.getItem(CONSENT_KEY);
        if (val === 'accepted') {
          // Load Google Analytics
          loadGoogleAnalytics();
          // Load Apollo
          const cfg = await getClientConfig();
          if (cfg.apolloAppId) loadApolloTracker(cfg.apolloAppId);
        }
      } catch {}
    })();
  }, []);
  return null;
}
