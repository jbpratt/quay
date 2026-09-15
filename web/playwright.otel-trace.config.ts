import {defineConfig, devices} from '@playwright/test';

/**
 * Standalone config for the OTel trace HTML renderer's browser regressions.
 * renderTraceHtml is a pure function producing static HTML, so these tests
 * only need a real browser (for CSS layout happy-dom can't compute) and must
 * not pull in playwright.config.ts's globalSetup/webServer, which require a
 * running Quay stack.
 */
export default defineConfig({
  testDir: './playwright/utils',
  testMatch: '**/*.browser.spec.ts',
  timeout: 30 * 1000,
  fullyParallel: true,
  reporter: [['list']],
  projects: [
    {
      name: 'chromium',
      use: {...devices['Desktop Chrome'], channel: 'chromium'},
    },
  ],
});
