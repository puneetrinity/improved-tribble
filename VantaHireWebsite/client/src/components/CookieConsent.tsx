import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { loadApolloTracker } from '@/lib/analytics';

const CONSENT_KEY = 'consent.analytics';
const APOLLO_APP_ID = '6853f5cfaaefa40015106379';

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

  const accept = () => {
    try {
      localStorage.setItem(CONSENT_KEY, 'accepted');
    } catch {}
    // Inject Apollo only after consent
    loadApolloTracker(APOLLO_APP_ID);
    setVisible(false);
  };

  const decline = () => {
    try {
      localStorage.setItem(CONSENT_KEY, 'declined');
    } catch {}
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[1000] w-[95%] md:w-auto">
      <div className="bg-[rgba(10,10,15,0.9)] backdrop-blur-md border border-white/10 rounded-xl p-4 md:p-5 shadow-xl">
        <div className="md:flex md:items-center md:gap-4">
          <p className="text-white/90 text-sm md:text-base mb-3 md:mb-0">
            We use cookies to analyze traffic and improve your experience. Enable analytics? You can change this later in your browser settings.
          </p>
          <div className="flex gap-2 md:gap-3 justify-end">
            <Button variant="outline" className="border-white/20 text-white hover:bg-white/10" onClick={decline}>
              Decline
            </Button>
            <Button variant="gradient" onClick={accept}>
              Accept
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AnalyticsOnConsent() {
  useEffect(() => {
    try {
      const val = localStorage.getItem(CONSENT_KEY);
      if (val === 'accepted') {
        loadApolloTracker(APOLLO_APP_ID);
      }
    } catch {}
  }, []);
  return null;
}

