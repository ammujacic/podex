import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['e2e/**/*.e2e.{ts,tsx}'],
    testTimeout: 60000,
    hookTimeout: 30000,
    // Run serially to avoid port conflicts
    sequence: {
      concurrent: false,
    },
    // Retry flaky tests in CI
    retry: process.env.CI ? 2 : 0,
  },
});
