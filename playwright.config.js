import { defineConfig, devices } from '@playwright/test';

// A random high port avoids clashes with other local projects.
const port = Number(process.env.E2E_PORT) || 40000 + Math.floor(Math.random() * 20000);
const baseURL = `http://127.0.0.1:${port}`;

// In environments with a pre-installed Chromium (for example a CI image), set CHROMIUM_PATH.
const chromiumLaunch = process.env.CHROMIUM_PATH
  ? { launchOptions: { executablePath: process.env.CHROMIUM_PATH } }
  : {};

const browsers = (process.env.E2E_BROWSERS || 'chromium').split(',');

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL, trace: 'retain-on-failure' },
  webServer: {
    command: `node scripts/serve.mjs --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], ...chromiumLaunch } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'], ...chromiumLaunch } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-webkit', use: { ...devices['iPhone 15'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ].filter((p) => browsers.some((b) => p.name.includes(b))),
});
