import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];

test.describe('landing page', () => {
  test('loads with a title, one h1 and the main calls to action', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(/Email Filter/);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'Try the demo' })).toHaveAttribute(
      'href',
      'app/?demo',
    );
    await expect(page.getByRole('link', { name: 'Open the app' })).toHaveAttribute('href', 'app/');
  });

  for (const scheme of /** @type {const} */ (['light', 'dark'])) {
    test(`has no axe violations in the ${scheme} theme`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto('/');
      // Open every FAQ answer so axe checks the hidden text too.
      await page
        .locator('details')
        .evaluateAll((els) => els.forEach((el) => el.setAttribute('open', '')));
      const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
      expect(results.violations).toEqual([]);
    });
  }

  test('skip link is the first focus stop and moves focus to main', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to main content' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#main$/);
    await expect(page.locator('#main')).toBeFocused();
  });

  test('every in-page anchor points to an element that exists', async ({ page }) => {
    await page.goto('/');
    const missing = await page
      .locator('a[href^="#"]')
      .evaluateAll((links) =>
        links
          .map((a) => decodeURIComponent((a.getAttribute('href') || '').slice(1)))
          .filter((id) => id && !document.getElementById(id)),
      );
    expect(missing).toEqual([]);
  });

  test('ids are unique', async ({ page }) => {
    await page.goto('/');
    const dupes = await page.evaluate(() => {
      const seen = new Map();
      for (const el of document.querySelectorAll('[id]')) {
        seen.set(el.id, (seen.get(el.id) || 0) + 1);
      }
      return [...seen].filter(([, n]) => n > 1).map(([id]) => id);
    });
    expect(dupes).toEqual([]);
  });

  test('has no horizontal scroll at 320px wide', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('/');
    await page
      .locator('details')
      .evaluateAll((els) => els.forEach((el) => el.setAttribute('open', '')));
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });

  test('makes no requests to any other origin', async ({ page, baseURL }) => {
    const origin = new URL(/** @type {string} */ (baseURL)).origin;
    /** @type {string[]} */
    const foreign = [];
    page.on('request', (req) => {
      const url = req.url();
      if (url.startsWith('data:')) return;
      if (new URL(url).origin !== origin) foreign.push(url);
    });
    await page.goto('/', { waitUntil: 'networkidle' });
    expect(foreign).toEqual([]);
  });

  test('loads no scripts and reports no console errors', async ({ page }) => {
    /** @type {string[]} */
    const errors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.locator('script')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
