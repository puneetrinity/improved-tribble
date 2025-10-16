declare global {
  interface Window {
    trackingFunctions?: { onLoad: (opts: { appId: string }) => void };
  }
}

export function loadApolloTracker(appId: string) {
  if (!appId) return;
  try {
    // Avoid duplicate injection
    const exists = Array.from(document.getElementsByTagName('script')).some(s => s.src.includes('assets.apollo.io/micro/website-tracker'));
    if (exists) return;
    const script = document.createElement('script');
    const nocache = Math.random().toString(36).substring(7);
    script.src = `https://assets.apollo.io/micro/website-tracker/tracker.iife.js?nocache=${nocache}`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      try {
        window.trackingFunctions?.onLoad({ appId });
      } catch (e) {
        console.warn('Apollo tracker onLoad failed:', e);
      }
    };
    document.head.appendChild(script);
  } catch (e) {
    console.warn('Apollo tracker injection failed:', e);
  }
}
