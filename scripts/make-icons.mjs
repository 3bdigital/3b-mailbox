// Renders the app icons from SVG to PNG with Playwright's Chromium.
// Usage: node scripts/make-icons.mjs   (set CHROMIUM_PATH to use a pre-installed Chromium)
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const dir = resolve('site/app/icons');
const jobs = [
  { src: 'icon.svg', out: 'icon-192.png', size: 192 },
  { src: 'icon.svg', out: 'icon-512.png', size: 512 },
  { src: 'icon-maskable.svg', out: 'icon-maskable-512.png', size: 512 },
  // Apple adds its own rounded corners, so the touch icon uses the full-bleed art.
  { src: 'icon-maskable.svg', out: 'apple-touch-icon.png', size: 180 },
];

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
try {
  const page = await browser.newPage();
  for (const job of jobs) {
    const svg = await readFile(resolve(dir, job.src), 'utf8');
    await page.setViewportSize({ width: job.size, height: job.size });
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:transparent">` +
        `<img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" width="${job.size}" height="${job.size}" style="display:block">` +
        `</body></html>`,
    );
    await page.locator('img').evaluate((img) => img.decode());
    const png = await page.screenshot({ omitBackground: true, type: 'png' });
    await writeFile(resolve(dir, job.out), png);
    console.warn(`Wrote ${job.out}`);
  }
} finally {
  await browser.close();
}
