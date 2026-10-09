import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { AXE_TAGS, closeDialog, confirmPlan, filterCount } from './helpers.js';

test.use({ serviceWorkers: 'block' });

const FIXTURE = fileURLToPath(new URL('../../fixtures/core/mailFilters.xml', import.meta.url));

/**
 * Opens the setup page and loads the Gmail export fixture through the file input.
 * @param {import('@playwright/test').Page} page
 */
async function openFile(page) {
  await page.goto('/app/#/setup');
  await page.getByLabel('Choose your mailFilters.xml file').setInputFiles(FIXTURE);
  await expect(page).toHaveURL(/#\/overview$/);
  await expect(page.locator('.skeleton-group')).toHaveCount(0);
}

/** @param {import('@playwright/test').Page} page */
async function axe(page) {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  return results.violations.map((v) => ({
    id: v.id,
    help: v.help,
    nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
  }));
}

/** @param {import('@playwright/test').Page} page */
const guardBlocksLeaving = (page) =>
  page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    dispatchEvent(event);
    return event.defaultPrevented;
  });

test.describe('no sign-in mode', () => {
  test('open a Gmail export, change it and download the new file, with no other origin', async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(/** @type {string} */ (baseURL)).origin;
    /** @type {string[]} */
    const foreign = [];
    page.on('request', (req) => {
      const url = req.url();
      if (url.startsWith('data:') || url.startsWith('blob:')) return;
      if (new URL(url).origin !== origin) foreign.push(url);
    });

    await openFile(page);
    await expect(page.locator('#auth-status')).toHaveText('No sign-in');
    await expect(page.locator('.banner-file')).toContainText(
      'No sign-in mode. Your changes stay in this tab until you download them.',
    );
    await expect(page.getByRole('link', { name: /How to put them back in Gmail/ })).toHaveAttribute(
      'href',
      '../index.html#no-sign-in',
    );
    expect(await guardBlocksLeaving(page)).toBe(false);
    expect(await filterCount(page)).toBe(12);

    // Edit one filter.
    await page.getByRole('link', { name: 'From ebay.co.uk', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Edit filter', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Show matching mail' })).toBeDisabled();
    await expect(
      page.getByRole('button', { name: 'Show matching mail' }),
    ).toHaveAccessibleDescription('Needs Google sign-in.');
    await expect(page.getByLabel('Also apply to existing mail')).toBeDisabled();
    await expect(page.locator('.apply-existing')).toContainText('Needs Google sign-in.');
    await page.getByLabel('From', { exact: true }).fill('ebay.com');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('dialog')).toContainText('Gmail changes only when you import');
    await confirmPlan(page, 'Save changes');
    await closeDialog(page);
    await expect(page.locator('.banner-file')).toContainText('You have changes to download.');
    expect(await guardBlocksLeaving(page)).toBe(true);

    // Change the label on two filters at once.
    await page.getByLabel('Search filters').fill('Shopping/Receipts');
    await expect(page.locator('.filter-card')).toHaveCount(2);
    await page.getByLabel(/^Select all 2 shown/).check();
    const bar = page.getByRole('region', { name: 'Selected filters' });
    await expect(bar).toContainText('2 selected');
    await bar.getByRole('button', { name: 'Change label' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('combobox', { name: 'To this label' }).fill('Shopping/Orders');
    await dialog.getByRole('option', { name: /Shopping\/Orders/ }).click();
    await dialog.getByRole('button', { name: 'Review the change' }).click();
    await confirmPlan(page, 'Change the label in 2 filters');
    await closeDialog(page);

    // The filter menu says why matching mail is not there.
    await page.getByLabel('Search filters').fill('');
    await page
      .getByRole('button', { name: /^Actions for filter/ })
      .first()
      .click();
    await expect(
      page.getByRole('button', { name: 'Show matching mail (needs Google sign-in)' }),
    ).toBeDisabled();
    await page.keyboard.press('Escape');

    // Download for Gmail.
    await page.locator('.banner-file').getByRole('button', { name: 'Download for Gmail' }).click();
    const steps = page.getByRole('dialog', { name: 'Put your filters back in Gmail' });
    await expect(steps).toContainText('select all your filters, then choose Delete');
    await expect(steps).toContainText('Tick nothing else. Choose Create filters.');
    await expect(steps).toContainText('Gmail matches labels by name');
    await expect(steps).toContainText('already verified in Gmail');
    const original = page.waitForEvent('download');
    await steps.getByRole('button', { name: 'Download the original file again' }).click();
    const originalText = await readFile(
      /** @type {string} */ (await (await original).path()),
      'utf8',
    );
    expect(originalText).toBe(await readFile(FIXTURE, 'utf8'));
    const fresh = page.waitForEvent('download');
    await steps.getByRole('button', { name: 'Download the new file' }).click();
    const file = await fresh;
    expect(file.suggestedFilename()).toBe('mailFilters-new.xml');
    const xml = await readFile(/** @type {string} */ (await file.path()), 'utf8');
    expect(xml).toContain("<apps:property name='from' value='ebay.com'/>");
    expect(xml).not.toContain("value='ebay.co.uk'");
    expect(xml.match(/<apps:property name='label' value='Shopping\/Orders'\/>/g)).toHaveLength(2);
    expect(xml).not.toContain("value='Shopping/Receipts'");
    expect(xml).toContain("value='Money &amp; Bills/Statements'");
    expect((xml.match(/<entry>/g) ?? []).length).toBe(12);
    await expect(steps.getByRole('status')).toHaveText('Downloaded mailFilters-new.xml.');
    await steps.getByRole('button', { name: 'Close', exact: true }).last().click();
    await expect(page.locator('.banner-file')).toContainText('No changes since');
    expect(await guardBlocksLeaving(page)).toBe(false);

    expect(foreign).toEqual([]);
  });

  test('settings hide the parts that need Google sign-in', async ({ page }) => {
    await openFile(page);
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Settings' })
      .click();
    for (const id of ['set-client', 'set-perms', 'set-diag']) {
      await expect(page.locator(`#section-${id}`)).toContainText('Needs Google sign-in.');
    }
    await expect(page.getByRole('textbox', { name: 'Client ID' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Measure the limit' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Download for Gmail (XML)' }).click();
    await expect(
      page.getByRole('dialog', { name: 'Put your filters back in Gmail' }),
    ).toBeVisible();
  });

  test('things the app cannot keep are listed in the banner', async ({ page }) => {
    const text = (await readFile(FIXTURE, 'utf8')).replace(
      "<apps:property name='shouldStar' value='true'/>",
      "<apps:property name='shouldStar' value='true'/><apps:property name='cannedResponse' value='x'/>",
    );
    await page.goto('/app/#/setup');
    await page
      .getByLabel('Choose your mailFilters.xml file')
      .setInputFiles({ name: 'mailFilters.xml', mimeType: 'text/xml', buffer: Buffer.from(text) });
    await expect(page).toHaveURL(/#\/overview$/);
    const details = page.locator('.banner-file details');
    await details.locator('summary').click();
    await expect(details).toContainText('1 thing in your file to check');
    await expect(details).toContainText('Filter 5 uses "cannedResponse"');
  });

  test('change mode: back to the setup page, then leave', async ({ page }) => {
    await openFile(page);
    await page.getByRole('link', { name: 'Change mode' }).click();
    await expect(page).toHaveURL(/#\/setup$/);
    await expect(page.getByText('You are in no sign-in mode with mailFilters.xml.')).toBeVisible();
    await page.getByRole('link', { name: 'Back to your filters' }).click();
    await expect(page).toHaveURL(/#\/overview$/);
    await page.getByRole('link', { name: 'Change mode' }).click();
    await page.getByRole('button', { name: 'Leave no sign-in mode' }).click();
    await expect(page.locator('#auth-status')).toHaveText('Not set up');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Set up Email Filter');
  });

  test('a file that is not a Gmail export shows an error summary', async ({ page }) => {
    await page.goto('/app/#/setup');
    await page.getByLabel('Choose your mailFilters.xml file').setInputFiles({
      name: 'backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{"app":"email-filter"}'),
    });
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('There is a problem');
    await expect(alert).toContainText('This is not a Gmail filter file.');
    await expect(page.getByLabel('Choose your mailFilters.xml file')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await alert.getByRole('link').click();
    await expect(page.getByLabel('Choose your mailFilters.xml file')).toBeFocused();
    await expect(page).toHaveURL(/#\/setup$/);
  });

  test('the setup page offers all three ways in', async ({ page }) => {
    await page.goto('/app/#/setup');
    const ways = page.getByRole('list', { name: 'Ways to use Email Filter' });
    await expect(ways.getByRole('heading')).toHaveText([
      'Sign in with your own Google client ID',
      'Work without signing in',
      'Try the demo',
    ]);
    await ways.getByRole('button', { name: 'Open your filter file' }).click();
    await expect(page.getByLabel('Choose your mailFilters.xml file')).toBeFocused();
    await expect(page.locator('#setup-file')).toContainText(
      'Select all your filters and choose Export.',
    );
  });

  for (const scheme of /** @type {const} */ (['light', 'dark'])) {
    test(`axe: setup page and download dialog in the ${scheme} theme`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto('/app/#/setup');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Set up Email Filter');
      expect(await axe(page)).toEqual([]);
      await page.getByLabel('Choose your mailFilters.xml file').setInputFiles(FIXTURE);
      await expect(page).toHaveURL(/#\/overview$/);
      expect(await axe(page)).toEqual([]);
      await page
        .locator('.banner-file')
        .getByRole('button', { name: 'Download for Gmail' })
        .click();
      await expect(page.getByRole('dialog')).toBeVisible();
      expect(await axe(page)).toEqual([]);
    });
  }

  for (const route of ['setup', 'overview', 'filters']) {
    test(`no horizontal scroll at 320px in no sign-in mode: ${route}`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 700 });
      if (route === 'setup') await page.goto('/app/#/setup');
      else {
        await openFile(page);
        await page.evaluate((r) => (location.hash = `#/${r}`), route);
        await expect(page).toHaveURL(new RegExp(`#/${route}$`));
      }
      await expect(page.locator('h1')).toBeVisible();
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    });
  }
});
