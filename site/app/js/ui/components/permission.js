// Explain-then-grant: before asking Google for a wider permission, say in plain words what it
// allows, that it is optional, and the exact scopes.

import { SCOPES, SCOPE_NAMES, TIER_NAMES } from '../../gmail/auth.js';
import { h } from '../dom.js';
import { openDialog } from './dialog.js';
import { button, notice } from './widgets.js';

/** @typedef {import('../../types.js').PermissionTier} PermissionTier */

/** What each tier lets the app do, in plain words. */
export const TIER_EXPLAIN = {
  basic: [
    'See, make and delete your Gmail filters.',
    'See your labels and make new labels for your filters.',
    'See your list of forwarding addresses.',
  ],
  preview: [
    'Search your mail to show which emails a filter would catch.',
    'Email Filter shows the sender, subject and date of up to 25 emails, only on this screen.',
    'It does not keep your mail or send it anywhere.',
  ],
  apply: [
    'Add or remove labels on emails you already have, so a new filter can also sort old mail.',
    'Email Filter does this only when you tick "Also apply to existing mail" and confirm.',
  ],
};

/**
 * The scopes a tier adds on top of the tier before it.
 * @param {PermissionTier} tier
 * @returns {string[]}
 */
export function addedScopes(tier) {
  const before = tier === 'apply' ? SCOPES.preview : tier === 'preview' ? SCOPES.basic : [];
  return SCOPES[tier].filter((s) => !before.includes(s));
}

/**
 * A details element with the exact scopes of a tier.
 * @param {PermissionTier} tier
 * @param {boolean} [onlyAdded]
 */
export function scopeDetails(tier, onlyAdded = true) {
  const scopes = onlyAdded ? addedScopes(tier) : [...SCOPES[tier]];
  return h(
    'details',
    { class: 'details' },
    h('summary', { text: 'Show the exact Google permission' }),
    h(
      'ul',
      { class: 'scope-list' },
      scopes.map((s) =>
        h(
          'li',
          null,
          h('span', { text: SCOPE_NAMES[s] ?? s }),
          h('code', { class: 'scope', text: s }),
        ),
      ),
    ),
  );
}

/**
 * Makes sure the user has a permission tier. Explains it first, then asks Google.
 * @param {any} ctx
 * @param {PermissionTier} tier
 * @param {{why?: string}} [opts]
 * @returns {Promise<boolean>} True when the tier is granted.
 */
export function ensureTier(ctx, tier, opts = {}) {
  if (ctx.auth?.hasTier(tier)) return Promise.resolve(true);
  const status = h('div', { role: 'status', class: 'dialog-status' });
  const grant = button({
    label: ctx.mode === 'demo' ? 'Allow in the demo' : 'Continue to Google',
    variant: 'primary',
    icon: 'shield',
  });
  const notNow = button({ label: 'Not now', variant: 'secondary' });
  const d = openDialog({
    title: `Allow "${TIER_NAMES[tier]}"?`,
    description: opts.why,
    size: 'md',
    content: [
      h('p', { text: 'This extra permission lets Email Filter:' }),
      h(
        'ul',
        { class: 'tick-list' },
        TIER_EXPLAIN[tier].map((t) => h('li', { text: t })),
      ),
      notice({
        tone: 'info',
        text: 'This is optional. Everything else works without it. You can remove it at any time in your Google Account.',
      }),
      ctx.mode === 'demo'
        ? h('p', { class: 'muted', text: 'This is the demo, so no Google window opens.' })
        : h('p', {
            class: 'muted',
            text: 'Google opens a window and asks you to confirm. Tick the box for this permission.',
          }),
      scopeDetails(tier),
      status,
    ],
    footer: [notNow, grant],
    initialFocus: grant,
  });
  notNow.addEventListener('click', () => d.close(false));
  grant.addEventListener('click', async () => {
    grant.disabled = true;
    status.replaceChildren(h('p', { text: 'Waiting for Google...' }));
    try {
      await ctx.auth.upgrade(tier);
      d.close(ctx.auth.hasTier(tier));
    } catch (err) {
      grant.disabled = false;
      status.replaceChildren(
        notice({ tone: 'danger', text: err instanceof Error ? err.message : String(err) }),
      );
    }
  });
  return d.closed.then((v) => {
    ctx.onTierChange?.();
    return v === true;
  });
}
