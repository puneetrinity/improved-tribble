import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  server: {
    headers: {
      // CSP for development - mirrors Express helmet config
      "Content-Security-Policy": [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://assets.apollo.io https://mautic.evalmatch.app https://www.googletagmanager.com https://sdk.cashfree.com",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://api.fontshare.com https://mautic.evalmatch.app",
        "img-src 'self' data: https:",
        "connect-src 'self' ws: wss: https://assets.apollo.io https://mautic.evalmatch.app https://www.google-analytics.com https://region1.google-analytics.com https://*.cashfree.com",
        "font-src 'self' data: https://fonts.gstatic.com https://api.fontshare.com https://cdn.fontshare.com https://fonts.fontshare.com https://r2cdn.perplexity.ai",
        "object-src 'self'",
        "media-src 'self'",
        "frame-src 'self' https://mautic.evalmatch.app https://sdk.cashfree.com https://*.cashfree.com",
        "form-action 'self' https://mautic.evalmatch.app https://*.cashfree.com https://api.cashfree.com",
      ].join("; "),
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  ssr: {
    // Bundle CJS-only packages into the SSR output so Node.js ESM can import them
    noExternal: ['react-helmet-async'],
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    sourcemap: true,
    chunkSizeWarningLimit: 1000, // Raised after vendor chunking; further reduction needs lazy routes
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // Shared utilities used across the app — must stay OUT of lazy vendor chunks
          // to prevent the main bundle from depending on recharts/d3/tours
          if (id.includes('node_modules/clsx') || id.includes('node_modules/tailwind-merge') || id.includes('node_modules/class-variance-authority')) {
            return 'vendor-utils';
          }
          // Core React runtime
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) {
            return 'vendor-react';
          }
          // Data fetching
          if (id.includes('@tanstack/react-query')) {
            return 'vendor-query';
          }
          // Date utilities
          if (id.includes('date-fns')) {
            return 'vendor-date';
          }
          // Icons (lucide is large)
          if (id.includes('lucide-react')) {
            return 'vendor-icons';
          }
          // UI components (Radix primitives)
          if (id.includes('@radix-ui')) {
            return 'vendor-ui';
          }
          // Charts and visualization (lazy-only — NOT needed on public pages)
          if (id.includes('recharts')) {
            return 'vendor-recharts';
          }
          // D3 utilities used by recharts (lazy-only)
          if (id.includes('d3-')) {
            return 'vendor-d3';
          }
          if (id.includes('victory')) {
            return 'vendor-charts';
          }
          // Form handling
          if (id.includes('react-hook-form') || id.includes('@hookform') || id.includes('node_modules/zod')) {
            return 'vendor-forms';
          }
          // Animation
          if (id.includes('framer-motion')) {
            return 'vendor-motion';
          }
          // Markdown/Editor
          if (id.includes('react-markdown') || id.includes('remark') || id.includes('rehype')) {
            return 'vendor-markdown';
          }
          // React Joyride (tours) — lazy-only
          if (id.includes('react-joyride') || id.includes('react-floater') || id.includes('popper')) {
            return 'vendor-tours';
          }
          return undefined;
        },
      },
    },
  },
});
