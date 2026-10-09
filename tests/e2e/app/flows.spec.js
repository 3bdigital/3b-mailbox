import { test, expect } from '@playwright/test';
import { closeDialog, confirmPlan, filterCount, openDemo } from './helpers.js';

test.use({ serviceWorkers: 'block' });

test.describe('demo flows', () => {
  test('overview loads with 66 filters', async ({ page }) => {
    await openDemo(page);
    await expect(page).toHaveTitle('Overview - 3B Mailbox');
    await expect(page.getByText('Demo account.')).toBeVisible();
    const filters = page.locator('.stat', { hasText: 'Filters' }).first();
    await expect(filters.locator('.stat-value')).toHaveText('66');
    await expect(page.getByRole('meter', { name: 'Filters' })).toHaveAttribute(
      'aria-valuenow',
      '66',
    );
    await expect(page.getByRole('table')).toContainText('Apply a label');
  });

  test('search narrows the list', async ({ page }) => {
    await openDemo(page, 'filters');
    await expect(page.locator('.filter-card')).toHaveCount(66);
    await page.getByLabel('Search filters').fill('octopus');
    await expect(page.locator('.result-count')).toHaveText('2 filters match "octopus"');
    await expect(page.locator('.filter-card')).toHaveCount(2);
    await page.getByLabel('Search filters').fill('zzzz nothing');
    await expect(page.getByRole('heading', { name: 'No filters match' })).toBeVisible();
  });

  test('group by label shows labelled groups', async ({ page }) => {
    await openDemo(page, 'filters');
    await page.getByLabel('Group by').selectOption('label');
    await expect(page.getByRole('heading', { name: /Finance\/Receipts/ })).toBeVisible();
    await page.getByLabel('Group by').selectOption('risk');
    await expect(page.getByRole('heading', { name: /Risky filters/ })).toBeVisible();
  });

  test('select 3 filters and change their label', async ({ page }) => {
    await openDemo(page, 'filters');
    await page.getByLabel('Search filters').fill('Finance/Receipts');
    await expect(page.locator('.result-count')).toContainText('match');
    for (const name of ['From deliveroo.co.uk', 'From ocado.com', 'From tesco.com']) {
      await page.getByLabel(new RegExp(`^Select filter: ${name}`)).check();
    }
    const bar = page.getByRole('region', { name: 'Selected filters' });
    await expect(bar).toContainText('3 selected');
    await bar.getByRole('button', { name: 'Change label' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('combobox', { name: 'To this label' }).fill('Shopping');
    await dialog.getByRole('option', { name: 'Shopping', exact: true }).click();
    await dialog.getByRole('button', { name: 'Review the change' }).click();
    await expect(
      page.getByRole('dialog').getByRole('heading', { name: 'Change the label in 3 filters' }),
    ).toBeVisible();
    await confirmPlan(page, 'Change the label in 3 filters');
    await closeDialog(page);
    await page.getByLabel('Search filters').fill('ocado');
    const card = page.locator('.filter-card');
    await expect(card).toHaveCount(1);
    await expect(card.locator('.chip')).toHaveText('Shopping');
  });

  test('edit a filter, see the journal entry and undo it', async ({ page }) => {
    await openDemo(page, 'filters');
    await page.getByRole('link', { name: 'From royalmail.com', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Edit filter', level: 1 })).toBeFocused();
    await page.getByLabel('Subject', { exact: true }).fill('parcel');
    await expect(page.locator('.summary-when')).toHaveText(
      'From royalmail.com, with "parcel" in the subject',
    );
    await page.getByRole('button', { name: 'Save changes' }).click();
    await confirmPlan(page, 'Save changes');
    await closeDialog(page);
    await expect(page).toHaveURL(/#\/filters$/);
    await page.getByRole('link', { name: 'Overview' }).click();
    const recent = page.locator('.history-item').first();
    await expect(recent).toContainText('Save changes to 1 filter');
    await recent.getByRole('button', { name: 'Undo: Save changes to 1 filter' }).click();
    await confirmPlan(page, /Restore the filters/);
    await closeDialog(page);
    await page.getByRole('link', { name: 'Filters', exact: true }).first().click();
    await page.getByLabel('Search filters').fill('royalmail');
    await expect(page.locator('.filter-card .filter-link')).toHaveText(['From royalmail.com']);
  });

  test('undo straight from the result', async ({ page }) => {
    await openDemo(page, 'filters');
    await page.getByLabel('Search filters').fill('ebay');
    await expect(page.locator('.filter-card')).toHaveCount(1);
    await page.getByRole('button', { name: /Actions for filter: From ebay/ }).click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await confirmPlan(page, 'Delete 1 filter');
    await page.getByRole('dialog').getByRole('button', { name: 'Undo' }).click();
    await confirmPlan(page, 'Undo "Delete 1 filter"');
    await closeDialog(page);
    expect(await filterCount(page)).toBe(66);
  });

  test('create a filter with a live summary and length meter', async ({ page }) => {
    await openDemo(page, 'filters/new');
    const meter = page.getByRole('meter', { name: 'Length' });
    await expect(meter).toHaveAttribute('aria-valuenow', '0');
    await page.getByLabel('From', { exact: true }).fill('news@example.org');
    await expect(page.locator('.summary-when')).toHaveText('From news@example.org');
    await expect(meter).toHaveAttribute('aria-valuenow', '23');
    await expect(page.locator('.editor-side')).toContainText('23 of 1,400 characters');
    await page.getByLabel('Mark as read').check();
    await expect(page.locator('.summary-then')).toHaveText('Mark as read');
    await page.getByRole('button', { name: 'Create filter' }).click();
    await confirmPlan(page, 'Create filter');
    await closeDialog(page);
    expect(await filterCount(page)).toBe(67);
  });

  test('the editor shows errors at the top when the form is empty', async ({ page }) => {
    await openDemo(page, 'filters/new');
    await page.getByRole('button', { name: 'Create filter' }).click();
    const summary = page.getByRole('alert').filter({ hasText: 'Fix 2 problems' });
    await expect(summary).toBeFocused();
    await summary.getByRole('link', { name: /Add at least one search term/ }).click();
    await expect(page.getByLabel('From', { exact: true })).toBeFocused();
    await expect(page.getByLabel('From', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  });

  test('an unsafe operator shows a warning', async ({ page }) => {
    await openDemo(page, 'filters/new');
    await page.getByRole('combobox', { name: 'Has the words' }).fill('is:unread');
    await expect(page.locator('.warnings')).toContainText('is:');
    await expect(page.locator('.warnings')).toContainText('never match new mail');
  });

  test('operator autocomplete works with the keyboard', async ({ page }) => {
    await openDemo(page, 'filters/new');
    const box = page.getByRole('combobox', { name: 'Has the words' });
    await box.fill('lis');
    await expect(box).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(box).toHaveValue('list:');
  });

  test('a filter that deletes mail needs the extra confirmation', async ({ page }) => {
    await openDemo(page, 'filters/new');
    await page.getByLabel('From', { exact: true }).fill('spam@example.com');
    await page.getByLabel('Delete it').check();
    await page.getByRole('button', { name: 'Create filter' }).click();
    const dialog = page.getByRole('dialog');
    const confirm = dialog.getByRole('button', { name: 'Create filter' });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel('I understand this filter will delete mail').check();
    await expect(confirm).toBeEnabled();
  });

  test('the forward picker shows a pending address as disabled', async ({ page }) => {
    await openDemo(page, 'filters/new');
    const select = page.getByLabel('Forward it to');
    await expect(select.locator('option', { hasText: 'bookkeeper@example.net' })).toBeDisabled();
    await expect(select.locator('option', { hasText: 'partner@example.com' })).toBeEnabled();
    await expect(select.locator('option', { hasText: 'bookkeeper@example.net' })).toContainText(
      'verify',
    );
  });

  test('show matching mail asks for the preview permission first', async ({ page }) => {
    await openDemo(page, 'filters/new');
    await page.getByLabel('From', { exact: true }).fill('amazon.co.uk');
    await page.getByRole('button', { name: 'Show matching mail' }).click();
    const ask = page.getByRole('dialog', { name: /Preview matching mail/ });
    await expect(ask).toContainText('optional');
    await ask.getByRole('button', { name: 'Allow in the demo' }).click();
    const results = page.getByRole('dialog', { name: 'Matching mail' });
    await expect(results.getByRole('table')).toBeVisible();
    await expect(results.locator('tbody tr').first()).toContainText('amazon');
  });

  test('add two suggestions in one plan', async ({ page }) => {
    await openDemo(page, 'suggestions');
    await page.getByLabel('Choose Newsletters', { exact: true }).check();
    await page.getByLabel('Choose Marketing and offers', { exact: true }).check();
    const bar = page.getByRole('region', { name: 'Chosen suggestions' });
    await expect(bar).toContainText('2 suggestions chosen');
    await bar.getByRole('button', { name: 'Add 2 filters' }).click();
    await expect(page.getByRole('dialog').locator('.step-create')).toHaveCount(2);
    await confirmPlan(page, 'Create 2 filters');
    await closeDialog(page);
    expect(await filterCount(page)).toBe(68);
  });

  test('tidy: delete duplicates, then merge the group of 4', async ({ page }) => {
    await openDemo(page, 'tidy');
    await page.getByRole('button', { name: 'Delete 1 duplicate' }).click();
    await confirmPlan(page, 'Delete 1 duplicate filter');
    await closeDialog(page);
    await expect(page.locator('.merge-card')).toContainText('4 filters become 1');
    await page.getByRole('button', { name: 'Merge 4 filters into 1' }).click();
    await expect(page.getByRole('dialog')).toContainText('After this change');
    await confirmPlan(page, 'Merge 4 filters into 1');
    await closeDialog(page);
    expect(await filterCount(page)).toBe(62);
  });

  test('settings: theme choice persists after a reload', async ({ page }) => {
    await openDemo(page, 'settings');
    await page.getByRole('radio', { name: 'Dark' }).check();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByRole('radio', { name: 'Dark' })).toBeChecked();
  });

  test('keyboard shortcuts work and can be turned off', async ({ page }) => {
    await openDemo(page, 'overview');
    await page.keyboard.press('n');
    await expect(page).toHaveURL(/#\/filters\/new$/);
    await page.getByLabel('From', { exact: true }).fill('n');
    await expect(page).toHaveURL(/#\/filters\/new$/);
    await page.goto('/app/?demo#/settings');
    await page.getByRole('switch', { name: 'Keyboard shortcuts' }).uncheck();
    await page.locator('h1').focus();
    await page.keyboard.press('n');
    await page.keyboard.press('/');
    await expect(page).toHaveURL(/#\/settings$/);
    await page.reload();
    await expect(page.getByRole('switch', { name: 'Keyboard shortcuts' })).not.toBeChecked();
  });

  test('delete all local data', async ({ page }) => {
    await openDemo(page, 'settings');
    await page.getByRole('radio', { name: 'Dark' }).check();
    await page.getByRole('button', { name: 'Delete all local data' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete local data' }).click();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme');
    const keys = await page.evaluate(() =>
      Object.keys(localStorage).filter((k) => k.startsWith('3bm:')),
    );
    expect(keys).toEqual([]);
    await expect(page.getByRole('radio', { name: 'System' })).toBeChecked();
  });

  test('bulk export downloads a JSON backup', async ({ page }) => {
    await openDemo(page, 'filters');
    await page.getByLabel(/^Select all 66 shown/).check();
    await expect(page.getByRole('region', { name: 'Selected filters' })).toContainText(
      '66 selected',
    );
    await page.getByRole('button', { name: 'More actions' }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export as a JSON backup' }).click();
    expect((await download).suggestedFilename()).toMatch(/^3b-mailbox-backup-.*\.json$/);
  });
});

test.describe('more settings and editor flows', () => {
  test('also apply to existing mail: explain, grant, count, then change old mail', async ({
    page,
  }) => {
    await openDemo(page, 'filters/new');
    await page.getByLabel('From', { exact: true }).fill('github.com');
    await page.getByLabel('Star it').check();
    await page.getByLabel('Also apply to existing mail').check();
    const ask = page.getByRole('dialog', { name: /Apply filters to existing mail/ });
    await expect(ask).toContainText('optional');
    await ask.getByRole('button', { name: 'Allow in the demo' }).click();
    await expect(page.locator('.apply-existing')).toContainText(/\d+ emails? match now/);
    await page.getByRole('button', { name: 'Create filter' }).click();
    await expect(page.getByRole('dialog')).toContainText('It also changes the mail you have now');
    await confirmPlan(page, 'Create filter');
    await expect(page.getByRole('dialog')).toContainText(/existing emails? changed/);
  });

  test('restore a JSON backup through the plan preview', async ({ page }) => {
    await openDemo(page, 'settings');
    const backup = {
      app: '3b-mailbox',
      version: 1,
      exportedAt: '2026-10-01T09:00:00.000Z',
      filters: [{ criteria: { from: 'restored@example.com' }, action: { addLabelIds: ['L9'] } }],
      labels: [{ id: 'L9', name: 'Restored', type: 'user' }],
    };
    await page.getByLabel('Restore from a JSON backup').setInputFiles({
      name: 'backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(backup)),
    });
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Make the label');
    await confirmPlan(page, 'Restore 1 filter from a backup');
    await closeDialog(page);
    expect(await filterCount(page)).toBe(67);
  });

  test('a backup that is not valid shows a plain message', async ({ page }) => {
    await openDemo(page, 'settings');
    await page.getByLabel('Restore from a JSON backup').setInputFiles({
      name: 'bad.json',
      mimeType: 'application/json',
      buffer: Buffer.from('not json'),
    });
    await expect(page.locator('#section-set-backup')).toContainText('It is not JSON');
  });

  test('measure the criteria length limit, and clean up', async ({ page }) => {
    test.setTimeout(60000);
    await openDemo(page, 'settings');
    await page.getByRole('button', { name: 'Measure the limit' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Start the test' }).click();
    await expect(page.locator('#section-set-diag')).toContainText('1,469 characters', {
      timeout: 30000,
    });
    await expect(page.locator('#section-set-diag')).toContainText('All test filters are deleted');
    expect(await filterCount(page)).toBe(66);
  });

  test('turning a permission on and off in settings', async ({ page }) => {
    await openDemo(page, 'settings');
    const preview = page.getByRole('switch', { name: 'Preview matching mail' });
    await expect(preview).not.toBeChecked();
    await preview.check();
    await page.getByRole('dialog').getByRole('button', { name: 'Allow in the demo' }).click();
    await expect(preview).toBeChecked();
    await preview.uncheck();
    await expect(preview).not.toBeChecked();
    await expect(page.getByRole('switch', { name: 'Manage filters' })).toBeDisabled();
  });
});

test.describe('a full account', () => {
  test('1,000 filters stay quick to show and search', async ({ page }) => {
    await page.goto('/app/?demo&size=1000#/filters');
    await expect(page.locator('.result-count')).toHaveText('1,000 filters', { timeout: 10000 });
    await expect(page.locator('.filter-card')).toHaveCount(100);
    const started = Date.now();
    await page.getByLabel('Search filters').fill('shop999.');
    await expect(page.locator('.filter-card')).toHaveCount(1);
    expect(Date.now() - started).toBeLessThan(2000);
    await page.getByLabel('Search filters').fill('');
    await expect(page.locator('.result-count')).toHaveText('1,000 filters');
    await page.getByRole('button', { name: 'Show more filters' }).click();
    await expect(page.locator('.filter-card')).toHaveCount(200);
    await page.getByRole('link', { name: 'Overview' }).click();
    await expect(page.getByRole('meter', { name: 'Filters' })).toHaveAttribute(
      'aria-valuetext',
      /At the limit/,
    );
  });
});
