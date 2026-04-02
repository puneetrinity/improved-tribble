import { hydrateRoot, createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { initClientMonitoring } from "./lib/monitoring";
import "./styles/public-theme.css";
import "./index.css";

const CHUNK_RELOAD_SESSION_KEY = "vh:chunk-reload-attempted";

function isChunkLoadFailureMessage(message: string): boolean {
  return (
    message.includes("Failed to fetch dynamically imported module") ||
    message.includes("Importing a module script failed") ||
    message.includes("Failed to load module script")
  );
}

function reloadForChunkFailure() {
  if (typeof window === "undefined") {
    return;
  }

  if (window.sessionStorage.getItem(CHUNK_RELOAD_SESSION_KEY) === "true") {
    return;
  }

  window.sessionStorage.setItem(CHUNK_RELOAD_SESSION_KEY, "true");
  window.location.reload();
}

function installChunkLoadRecovery() {
  if (typeof window === "undefined") {
    return;
  }

  window.addEventListener("unhandledrejection", (event) => {
    const message = String(event.reason?.message || event.reason || "");
    if (!isChunkLoadFailureMessage(message)) {
      return;
    }

    reloadForChunkFailure();
  });

  window.addEventListener("error", (event) => {
    const message = String(event.message || "");
    if (!isChunkLoadFailureMessage(message)) {
      return;
    }

    reloadForChunkFailure();
  });
}

initClientMonitoring();
installChunkLoadRecovery();

const rootEl = document.getElementById("root")!;

const app = (
  <HelmetProvider>
    <App />
  </HelmetProvider>
);

// If server-rendered HTML exists, hydrate instead of full client render
if (rootEl.hasAttribute('data-ssr')) {
  hydrateRoot(rootEl, app);
} else {
  createRoot(rootEl).render(app);
}

// Successful boot clears the one-shot stale chunk reload guard for future deploys.
if (typeof window !== "undefined") {
  window.setTimeout(() => {
    window.sessionStorage.removeItem(CHUNK_RELOAD_SESSION_KEY);
  }, 0);
}
