import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

const CLIENT_ID = '123456789012-abc123def.apps.googleusercontent.com';

/**
 * Fakes Google Identity Services and the Gmail API, so the signed-in mode can be tested offline.
 * @param {import('@playwright/test').Page} page
 * @param {number} expiresIn  Seconds.
 */
async function fakeGoogle(page, expiresIn) {
  await page.addInitScript(
    ({ clientId, expiresIn: seconds }) => {
      localStorage.setItem('ef:clientId', JSON.stringify(clientId));
      /** @type {any} */ (window).google = {
        accounts: {
          oauth2: {
            initTokenClient: (cfg) => ({
              requestAccessToken: () =>
                setTimeout(
                  () =>
                    cfg.callback({
                      access_token: 'fake-token',
                      expires_in: seconds,
                      scope: cfg.scope,
                    }),
                  10,
                ),
            }),
            hasGrantedAllScopes: () => true,
            revoke: (_t, done) => done(),
          },
        },
      };
    },
    { clientId: CLIENT_ID, expiresIn },
  );
  await page.route('https://gmail.googleapis.com/**', (route) => {
    const url = route.request().url();
    const json = (body) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (url.endsWith('/settings/filters')) {
      return json({
        filter: [
          {
            id: 'f1',
            criteria: { from: 'shop.example.com' },
            action: { addLabelIds: ['Label_1'] },
          },
        ],
      });
    }
    if (url.endsWith('/labels'))
      return json({ labels: [{ id: 'Label_1', name: 'Shopping', type: 'user' }] });
    if (url.endsWith('/settings/forwardingAddresses')) return json({ forwardingAddresses: [] });
    return route.fulfill({ status: 404, body: '{}' });
  });
}

test.describe('signed in with Google (faked)', () => {
  test('sign in loads the filters and sign out clears them', async ({ page }) => {
    await fakeGoogle(page, 3600);
    await page.goto('/app/#/filters');
    await page.getByRole('main').getByRole('button', { name: 'Sign in with Google' }).click();
    await expect(page.locator('#auth-status')).toContainText('Signed in');
    await expect(page.locator('.filter-card')).toHaveCount(1);
    await expect(page.locator('.filter-card .chip')).toHaveText('Shopping');
    const stored = await page.evaluate(() => JSON.stringify(localStorage));
    expect(stored).not.toContain('fake-token');
    await page.getByRole('banner').getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in to see your filters' })).toBeVisible();
  });

  test('a session ending soon shows a banner with Stay signed in', async ({
    page,
  }) => {
    await fakeGoogle(page, 303);
    await page.goto('/app/#/filters');
    await page.getByRole('main').getByRole('button', { name: 'Sign in with Google' }).click();
    await expect(page.locator('.filter-card')).toHaveCount(1);
    await expect(page.locator('#auth-status')).toContainText('Session ending soon', {
      timeout: 8000,
    });
    await expect(page.getByRole('button', { name: 'Stay signed in' })).toBeVisible();
    await page.getByRole('button', { name: 'Stay signed in' }).click();
    await expect(page.locator('#auth-status')).toContainText('Signed in');
  });

  test('when the session ends, writes wait for a new sign-in and the draft is kept', async ({
    page,
  }) => {
    await fakeGoogle(page, 4);
    await page.goto('/app/#/filters/new');
    await page.getByRole('main').getByRole('button', { name: 'Sign in with Google' }).click();
    await page.getByLabel('From', { exact: true }).fill('keep@example.com');
    await page.getByLabel('Star it').check();
    await expect(page.getByText('Your sign-in has ended.')).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Create filter' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: 'Create filter' })).toBeDisabled();
    await expect(dialog).toContainText('Sign in again to make changes.');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByLabel('From', { exact: true })).toHaveValue('keep@example.com');
  });
});
