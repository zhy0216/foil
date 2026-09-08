import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const basePath = process.env.FOIL_E2E_BASE === '/' ? '/' : '/foil/';
// The website suite owns 4173. Never share its server or rebuild its dist here.
const port = Number(process.env.FOIL_EXTENSION_E2E_PORT || 4273);
const baseURL = `http://127.0.0.1:${port}${basePath}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 1 : 2,
  timeout: 90_000,
  reporter: [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'test-results/results.json' }]],
  outputDir: 'test-results',
  use: { baseURL, timezoneId: 'UTC', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'installed-chromium', testIgnore: '**/delivery.spec.ts', use: { ...devices['Desktop Chrome'], channel: 'chromium' } },
    { name: 'file-chromium', testMatch: '**/delivery.spec.ts', use: { ...devices['Desktop Chrome'], channel: 'chromium' } },
    { name: 'file-webkit', testMatch: '**/delivery.spec.ts', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    cwd: fileURLToPath(new URL('../web/', import.meta.url)),
    command: `bun run preview --base ${basePath} --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 30_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
  },
});
