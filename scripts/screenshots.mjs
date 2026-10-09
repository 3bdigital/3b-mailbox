// Takes the README screenshots from the demo account.
// Usage: node scripts/screenshots.mjs (set CHROMIUM_PATH to use a pre-installed Chromium).
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const port = 40000 + Math.floor(Math.random() * 20000);
const server = spawn(process.execPath, ['scripts/serve.mjs', '--port', String(port)], {
  stdio: 'ignore',
});
const base = `http://127.0.0.1:${port}/app/?demo`;

const views = {
  overview: '#/overview',
  filters: '#/filters',
  editor: '#/filters/new',
  suggestions: '#/suggestions',
  tidy: '#/tidy',
};
const sizes = { desktop: { width: 1280, height: 860 }, phone: { width: 390, height: 844 } };

try {
  await new Promise((r) => setTimeout(r, 500));
  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  );
  for (const [sizeName, viewport] of Object.entries(sizes)) {
    for (const scheme of ['light', 'dark']) {
      const page = await browser.newPage({
        viewport,
        colorScheme: scheme,
        deviceScaleFactor: sizeName === 'phone' ? 2 : 1,
        reducedMotion: 'reduce',
      });
      for (const [view, hash] of Object.entries(views)) {
        await page.goto(`${base}${hash}`);
        await page.getByRole('heading', { level: 1 }).waitFor();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(400);
        await page.screenshot({ path: `docs/screenshots/${view}-${scheme}-${sizeName}.png` });
      }
      await page.close();
    }
  }
  await browser.close();
} finally {
  server.kill();
}
