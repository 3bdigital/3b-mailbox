import { expect } from '@playwright/test';

export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];

export const ROUTES = ['overview', 'filters', 'filters/new', 'suggestions', 'tidy', 'settings'];

/**
 * Opens the demo on a route and waits for the demo data.
 * @param {import('@playwright/test').Page} page
 * @param {string} [route]
 */
export async function openDemo(page, route = 'overview') {
  await page.goto(`/app/?demo#/${route}`);
  await expect(page.locator('h1')).toBeVisible();
  await expect(page.locator('.skeleton-group')).toHaveCount(0, { timeout: 10000 });
}

/**
 * The number of filters, read from the filters view.
 * @param {import('@playwright/test').Page} page
 */
export async function filterCount(page) {
  await page.getByRole('link', { name: 'Filters', exact: true }).first().click();
  await page.getByLabel('Search filters').fill('');
  await expect(page.locator('.result-count')).toHaveText(/^[\d,]+ filters?$/);
  const text = await page.locator('.result-count').textContent();
  return Number(/(\d[\d,]*)/.exec(text ?? '')?.[1].replace(/,/g, ''));
}

/**
 * Presses Tab until the locator has focus.
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').Locator} target
 * @param {{key?: string, max?: number}} [opts]
 */
export async function tabTo(page, target, opts = {}) {
  const handle = await target.elementHandle();
  for (let i = 0; i < (opts.max ?? 60); i++) {
    const focused = await page.evaluate((el) => document.activeElement === el, handle);
    if (focused) return;
    await page.keyboard.press(opts.key ?? 'Tab');
  }
  throw new Error('Could not reach the element with the keyboard');
}

/**
 * Confirms the open plan dialog and waits for the result.
 * @param {import('@playwright/test').Page} page
 * @param {string|RegExp} confirmName
 */
export async function confirmPlan(page, confirmName) {
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: confirmName }).click();
  await expect(dialog.getByRole('heading', { name: 'Done' })).toBeVisible({ timeout: 15000 });
}

/**
 * Closes the result dialog.
 * @param {import('@playwright/test').Page} page
 */
export async function closeDialog(page) {
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
