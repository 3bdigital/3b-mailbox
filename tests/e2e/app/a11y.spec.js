import { measureOverflow } from './overflow.js';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { AXE_TAGS, ROUTES, openDemo, tabTo } from './helpers.js';

test.use({ serviceWorkers: 'block' });

/** @param {import('@playwright/test').Page} page */
async function axe(page) {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  return results.violations.map((v) => ({
    id: v.id,
    help: v.help,
    nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
  }));
}

test.describe('accessibility', () => {
  for (const scheme of /** @type {const} */ (['light', 'dark'])) {
    for (const route of ROUTES) {
      test(`axe: ${route} in the ${scheme} theme`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await openDemo(page, route);
        await page
          .locator('details')
          .evaluateAll((els) => els.slice(0, 12).forEach((el) => el.setAttribute('open', '')));
        expect(await axe(page)).toEqual([]);
      });
    }

    test(`axe: plan preview dialog in the ${scheme} theme`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await openDemo(page, 'tidy');
      await page.getByRole('button', { name: 'Merge 4 filters into 1' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      expect(await axe(page)).toEqual([]);
    });

    test(`axe: bulk bar, menu and change label dialog in the ${scheme} theme`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await openDemo(page, 'filters');
      await page.getByLabel(/^Select filter: From ebay/).check();
      await page.getByRole('button', { name: 'More actions' }).click();
      await expect(page.getByRole('button', { name: 'Add an action' })).toBeVisible();
      await page.keyboard.press('Escape');
      expect(await axe(page)).toEqual([]);
      await page.getByRole('button', { name: 'Change label' }).click();
      await page.getByRole('combobox', { name: 'To this label' }).fill('fin');
      expect(await axe(page)).toEqual([]);
    });

    test(`axe: editor with errors and warnings in the ${scheme} theme`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await openDemo(page, 'filters/new');
      await page.getByRole('combobox', { name: 'Has the words' }).fill('is:unread');
      await page.getByLabel('Delete it').check();
      await page.getByLabel('From', { exact: true }).fill('');
      await page.getByRole('button', { name: 'Create filter' }).click();
      expect(await axe(page)).toEqual([]);
    });
  }

  test('axe: setup page with no client ID', async ({ page }) => {
    await page.goto('/app/#/setup');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Set up 3B Mailbox');
    expect(await axe(page)).toEqual([]);
  });

  test('focus moves to the h1 on navigation and the title changes', async ({ page }) => {
    await openDemo(page, 'overview');
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeFocused();
    for (const [link, title] of [
      ['Filters', 'Filters'],
      ['Suggestions', 'Suggestions'],
      ['Tidy up', 'Tidy up'],
      ['Settings', 'Settings'],
    ]) {
      await page
        .getByRole('navigation', { name: 'Main' })
        .getByRole('link', { name: link })
        .click();
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeFocused();
      await expect(page).toHaveTitle(`${title} - 3B Mailbox`);
      await expect(
        page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: link }),
      ).toHaveAttribute('aria-current', 'page');
    }
  });

  test('the skip link moves focus to main without changing the route', async ({ page }) => {
    await openDemo(page, 'filters');
    const skip = page.getByRole('link', { name: 'Skip to main content' });
    await tabTo(page, skip, { key: 'Shift+Tab' });
    await expect(skip).toBeInViewport();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main')).toBeFocused();
    await expect(page).toHaveURL(/#\/filters$/);
  });

  for (const route of ROUTES) {
    test(`no horizontal scroll at 320px: ${route}`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 700 });
      await openDemo(page, route);
      const { scrollWidth, clientWidth, culprits } = await measureOverflow(page);
      expect(scrollWidth, culprits.join('\n')).toBeLessThanOrEqual(clientWidth);
    });
  }

  test('text spacing override does not break the layout', async ({ browser, baseURL }) => {
    // The app's CSP blocks inline styles, so this test turns CSP off to add the override.
    const context = await browser.newContext({ baseURL, bypassCSP: true, serviceWorkers: 'block' });
    const page = await context.newPage();
    await page.setViewportSize({ width: 360, height: 800 });
    await openDemo(page, 'filters');
    await page.addStyleTag({
      content:
        '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }',
    });
    const { scrollWidth, clientWidth, culprits } = await measureOverflow(page);
    expect(scrollWidth, culprits.join('\n')).toBeLessThanOrEqual(clientWidth);
    await context.close();
  });

  test('demo mode makes no requests to any other origin', async ({ page, baseURL }) => {
    const origin = new URL(/** @type {string} */ (baseURL)).origin;
    /** @type {string[]} */
    const foreign = [];
    page.on('request', (req) => {
      const url = req.url();
      if (url.startsWith('data:') || url.startsWith('blob:')) return;
      if (new URL(url).origin !== origin) foreign.push(url);
    });
    for (const route of ROUTES) await openDemo(page, route);
    await openDemo(page, 'filters/new');
    await page.getByLabel('From', { exact: true }).fill('amazon.co.uk');
    await page.getByRole('button', { name: 'Show matching mail' }).click();
    await page.getByRole('button', { name: 'Allow in the demo' }).click();
    await expect(
      page.getByRole('dialog', { name: 'Matching mail' }).getByRole('table'),
    ).toBeVisible();
    expect(foreign).toEqual([]);
  });

  test('no console errors on any route', async ({ page }) => {
    /** @type {string[]} */
    const errors = [];
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const { url, lineNumber } = msg.location();
      errors.push(`${msg.text()} (${url || 'no url'}:${lineNumber ?? '?'})`);
    });
    page.on('pageerror', (err) => errors.push(err.message));
    for (const route of ROUTES) await openDemo(page, route);
    expect(errors).toEqual([]);
  });

  test('keyboard only: create a filter', async ({ page }) => {
    await openDemo(page, 'overview');
    await page.keyboard.press('n');
    await expect(page.getByRole('heading', { level: 1, name: 'New filter' })).toBeFocused();
    const from = page.getByLabel('From', { exact: true });
    await tabTo(page, from);
    await page.keyboard.type('club@example.org');
    await tabTo(page, page.getByLabel('Star it'));
    await page.keyboard.press('Space');
    await expect(page.getByLabel('Star it')).toBeChecked();
    await tabTo(page, page.getByRole('button', { name: 'Create filter' }));
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await tabTo(page, dialog.getByRole('button', { name: 'Create filter' }));
    await page.keyboard.press('Enter');
    await expect(dialog.getByRole('heading', { name: 'Done' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Close', exact: true }).last()).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).toHaveURL(/#\/filters$/);
  });

  test('keyboard only: select filters and change their label', async ({ page }) => {
    await openDemo(page, 'filters');
    await page.locator('h1').focus();
    await page.keyboard.press('/');
    await expect(page.getByLabel('Search filters')).toBeFocused();
    await page.keyboard.type('travel');
    await expect(page.locator('.result-count')).toContainText('match');
    const first = page.getByLabel(/^Select filter: From booking\.com/);
    await tabTo(page, first);
    await page.keyboard.press('Space');
    const second = page.getByLabel(/^Select filter: From easyjet\.com/);
    await tabTo(page, second);
    await page.keyboard.press('Space');
    await expect(page.getByRole('region', { name: 'Selected filters' })).toContainText(
      '2 selected',
    );
    await tabTo(page, page.getByRole('button', { name: 'Change label' }));
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await tabTo(page, dialog.getByRole('combobox', { name: 'To this label' }));
    await page.keyboard.type('Holidays');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(dialog.locator('.picker-chips')).toContainText('Holidays');
    await tabTo(page, dialog.getByRole('button', { name: 'Review the change' }));
    await page.keyboard.press('Enter');
    const review = page.getByRole('dialog');
    await expect(review).toContainText('Make the label');
    await tabTo(page, review.getByRole('button', { name: 'Change the label in 2 filters' }));
    await page.keyboard.press('Enter');
    await expect(review.getByRole('heading', { name: 'Done' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByLabel('Search filters').fill('booking');
    await expect(page.locator('.filter-card')).toHaveCount(1);
    await expect(page.locator('.filter-card .chip')).toHaveText('Holidays');
  });

  test('dialogs close with Escape and return focus', async ({ page }) => {
    await openDemo(page, 'tidy');
    const opener = page.getByRole('button', { name: 'Merge 4 filters into 1' });
    await opener.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(opener).toBeFocused();
  });

  test('plan progress is announced and the result offers undo', async ({ page }) => {
    await openDemo(page, 'tidy');
    await page.getByRole('button', { name: 'Merge 4 filters into 1' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Merge 4 filters into 1' }).click();
    await expect(dialog.getByRole('progressbar')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Stop' })).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Done' })).toBeVisible({ timeout: 15000 });
    await expect(dialog.getByRole('button', { name: 'Undo' })).toBeVisible();
  });
});
