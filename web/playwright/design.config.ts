import path from 'path';
import {defineConfig} from '@playwright/test';
import base from '../playwright.config';

/**
 * Dev-only config for the design tools in ./design (screenshot capture and
 * a11y smoke). Kept out of the default testDir so CI never runs them.
 *
 * Paths here resolve against this file's directory, not web/, so the base
 * webServer command (which uses ../static and dist/) needs web/ as its cwd,
 * and the base reporters are replaced to avoid writing reports and
 * results.json under web/playwright/.
 */
export default defineConfig({
  ...base,
  testDir: './design',
  // Each test creates and deletes testuser data, so parallel tests would show
  // up in each other's list-page captures.
  fullyParallel: false,
  workers: 1,
  outputDir: '../test-results/design/',
  reporter: 'list',
  webServer:
    base.webServer && !Array.isArray(base.webServer)
      ? {...base.webServer, cwd: path.resolve(__dirname, '..')}
      : base.webServer,
});
