import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'
import { loadEnv } from 'vite'

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    env: loadEnv(mode, process.cwd(), ''),
    css: true,
    exclude: [
      'server/jobs-access/**/*.test.ts', // node:test; CI runs test:jobs-access separately
      'node_modules/**',
      '**/node_modules/**',    // Exclude all nested node_modules
      'provisioning-portal/**', // Exclude provisioning portal
      'dist/**',
      'test/e2e/**',           // Exclude Playwright E2E tests
      '**/*.spec.ts',          // Exclude .spec.ts files (Playwright)
      '**/*.spec.tsx',
      'server/tests/applicationClaiming.test.ts', // Standalone E2E script (run with ts-node)
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'test/',
        '**/*.d.ts',
        '**/*.config.*',
        'dist/',
        'coverage/',
      ],
      thresholds: {
        global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80
        }
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './client/src'),
      '@shared': path.resolve(__dirname, './shared'),
      '@assets': path.resolve(__dirname, './attached_assets'),
    },
  },
}))
