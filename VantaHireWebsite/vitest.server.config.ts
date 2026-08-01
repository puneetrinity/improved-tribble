import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'server/lib/__tests__/**/*.test.ts',
      'server/tests/ai.routes.test.ts',
      'server/tests/hiring-manager-feedback-access.routes.test.ts',
      'server/tests/recruiter-dashboard-scoping.routes.test.ts',
      'server/tests/resumeExtractor.isolation.test.ts',
      'server/tests/outreachHygieneConcurrency.pg.test.ts',
    ],
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, './shared'),
    },
  },
});
