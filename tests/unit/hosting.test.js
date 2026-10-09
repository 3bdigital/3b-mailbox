// Checks the Cloudflare hosting files that the app depends on.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

describe('wrangler.jsonc', () => {
  // JSONC: drop comment lines and trailing commas before parsing.
  const config = JSON.parse(
    read('wrangler.jsonc')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/,(\s*[}\]])/g, '$1'),
  );

  it('serves site/ as static assets from the 3b-mailbox-worker Worker, with no Worker code', () => {
    expect(config.name).toBe('3b-mailbox-worker');
    expect(config.assets.directory).toBe('./site');
    expect(config.main).toBeUndefined();
  });
});

describe('site/_headers', () => {
  const headers = read('site/_headers');

  it('keeps the Google sign-in popup working', () => {
    // "same-origin" would cut the link between the app and the Google popup.
    expect(headers).toContain('Cross-Origin-Opener-Policy: same-origin-allow-popups');
  });

  it('blocks framing and MIME sniffing', () => {
    expect(headers).toContain("frame-ancestors 'none'");
    expect(headers).toContain('X-Content-Type-Options: nosniff');
  });

  it('never caches the service worker file', () => {
    expect(headers).toMatch(/\/app\/sw\.js\n\s+Cache-Control: no-cache/);
  });
});

describe('custom domain', () => {
  it('serves the hosted copy only at mailbox.3bweb.com', () => {
    const text = read('wrangler.jsonc');
    expect(text).toContain('"pattern": "mailbox.3bweb.com", "custom_domain": true');
    expect(text).toContain('"workers_dev": false');
  });
});
