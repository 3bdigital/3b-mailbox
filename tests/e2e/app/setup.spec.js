import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test.describe('first run and the app shell', () => {
  test('setup shows this origin, validates the client ID and offers the demo', async ({
    page,
    baseURL,
  }) => {
    await page.goto('/app/');
    await expect(page).toHaveURL(/#\/setup$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Set up Email Filter');
    const origin = new URL(/** @type {string} */ (baseURL)).origin;
    await expect(page.locator('.origin-code')).toHaveText(origin);
    await expect(page.getByRole('button', { name: 'Copy this address' })).toBeVisible();
    await expect(page.getByRole('link', { name: /step-by-step guide/ })).toHaveAttribute(
      'href',
      '../index.html#setup',
    );
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();

    await page.getByLabel('Your client ID').fill('not-a-client-id');
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await expect(page.getByLabel('Your client ID')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('alert')).toContainText('This is not a client ID');

    await page.locator('details').first().locator('summary').click();
    await expect(page.locator('code.scope').first()).toContainText('gmail.settings.basic');

    await page.getByRole('link', { name: 'Try the demo' }).click();
    await expect(page).toHaveURL(/\?demo#\/overview$/);
    await expect(page.getByText('Demo account.')).toBeVisible();
  });

  test('a valid client ID moves on to sign in, with no request to Google until asked', async ({
    page,
  }) => {
    /** @type {string[]} */
    const google = [];
    page.on('request', (req) => {
      if (/google/.test(new URL(req.url()).hostname)) google.push(req.url());
    });
    await page.goto('/app/#/setup');
    await page
      .getByLabel('Your client ID')
      .fill('123456789012-abc123def.apps.googleusercontent.com');
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in to see your filters' })).toBeVisible();
    await expect(page.locator('#auth-status')).toContainText('Signed out');
    await expect(page.getByRole('banner').getByRole('button', { name: 'Sign in' })).toBeVisible();
    const stored = await page.evaluate(() => localStorage.getItem('ef:clientId'));
    expect(stored).toBe('"123456789012-abc123def.apps.googleusercontent.com"');
    const tokenLike = await page.evaluate(() =>
      Object.entries(localStorage).filter(([, v]) => /ya29\.|access_token/.test(v)),
    );
    expect(tokenLike).toEqual([]);
    expect(google).toEqual([]);
  });

  test('the page has a strict CSP and a web app manifest', async ({ page, request }) => {
    await page.goto('/app/?demo');
    const csp = await page
      .locator('meta[http-equiv="Content-Security-Policy"]')
      .getAttribute('content');
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' https://accounts.google.com/gsi/client");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain('unsafe-inline');
    const manifest = await (await request.get('/app/manifest.webmanifest')).json();
    expect(manifest).toMatchObject({
      name: 'Email Filter',
      short_name: 'Filters',
      start_url: './',
      scope: './',
      display: 'standalone',
    });
    expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true);
    for (const icon of manifest.icons) {
      expect((await request.get(`/app/${icon.src}`)).status()).toBe(200);
    }
    const html = await (await request.get('/app/')).text();
    expect(html).not.toMatch(/\sstyle=/);
    expect(html).not.toMatch(/<script(?![^>]*\ssrc=)/);
  });

  test('unknown routes go to the overview', async ({ page }) => {
    await page.goto('/app/?demo#/nowhere');
    await expect(page).toHaveURL(/#\/overview$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Overview');
  });

  test('a filter that no longer exists shows a clear message', async ({ page }) => {
    await page.goto('/app/?demo#/filters/missing-id');
    await expect(
      page.getByRole('heading', { name: 'This filter is not there any more' }),
    ).toBeVisible();
  });

  test('offline shows a notice', async ({ page, context }) => {
    await page.goto('/app/?demo#/overview');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Overview');
    await context.setOffline(true);
    await expect(page.getByText('You are offline.')).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByText('You are offline.')).toHaveCount(0);
  });
});

test.describe('service worker', () => {
  test.use({ serviceWorkers: 'allow' });

  test('registers and caches the shell but not Google', async ({ page }) => {
    await page.goto('/app/?demo');
    const keys = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      const cache = await caches.open((await caches.keys())[0]);
      const requests = await cache.keys();
      return { scope: reg.scope, urls: requests.map((r) => r.url) };
    });
    expect(keys.scope).toMatch(/\/app\/$/);
    expect(keys.urls.some((u) => u.endsWith('/app/js/main.js'))).toBe(true);
    expect(keys.urls.every((u) => !/google/.test(u))).toBe(true);
  });
});
