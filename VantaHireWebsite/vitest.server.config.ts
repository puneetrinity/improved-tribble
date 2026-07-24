import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['server/tests/resumeExtractor.isolation.test.ts', 'server/lib/__tests__/**/*.test.ts'],
  },
});
