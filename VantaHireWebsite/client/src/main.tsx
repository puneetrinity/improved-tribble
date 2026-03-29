import { hydrateRoot, createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { initClientMonitoring } from "./lib/monitoring";
import "./styles/public-theme.css";
import "./index.css";

initClientMonitoring();

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
