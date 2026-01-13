import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E Test Configuration for Podex
 *
 * This config is designed for autonomous testing by Claude:
 * - Captures screenshots at every step
 * - Generates traces for debugging
 * - Runs in headless mode
 * - Screenshots saved to test-results/ for analysis
 */
export default defineConfig({
  testDir: './e2e',

  // Run tests in parallel for speed
  fullyParallel: true,

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Retry on CI only
  retries: process.env.CI ? 2 : 0,

  // Limit parallel workers for stability
  workers: process.env.CI ? 1 : 2,

  // Reporter configuration - HTML report + console output
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
  ],

  // Shared settings for all projects
  use: {
    // Base URL for the web app
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',

    // Capture screenshot on every test step for Claude to analyze
    screenshot: 'on',

    // Record trace for failed tests
    trace: 'on-first-retry',

    // Record video on failure
    video: 'on-first-retry',

    // Reasonable timeouts
    actionTimeout: 10000,
    navigationTimeout: 30000,
  },

  // Output directory for screenshots and artifacts
  outputDir: 'test-results/',

  // Timeout for each test
  timeout: 60000,

  // Configure projects for different browsers
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Viewport size
        viewport: { width: 1280, height: 720 },
      },
    },
  ],

  // Web server configuration - start the dev server before running tests
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120000,
  },
});
