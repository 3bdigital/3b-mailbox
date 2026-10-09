// #/setup: first run. Three steps, this page's origin to copy, the client ID field, permission tiers,
// and the demo.

import { TIER_NAMES, validateClientId } from '../../gmail/auth.js';
import { TIER_EXPLAIN, scopeDetails } from '../components/permission.js';
import { announce } from '../components/toast.js';
import { button, notice, textField, viewHeader } from '../components/widgets.js';
import { h, replace } from '../dom.js';
import { icon } from '../icons.js';

/**
 * Copies text, with a fallback that selects it for the user.
 * @param {string} text
 * @param {HTMLElement} [selectEl]
 */
export async function copyText(text, selectEl) {
  try {
    await navigator.clipboard.writeText(text);
    announce('Copied.');
    return true;
  } catch {
    if (selectEl) {
      const range = document.createRange();
      range.selectNodeContents(selectEl);
      const sel = getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    announce(
      'Your browser did not allow copying. The text is selected. Copy it with your keyboard.',
    );
    return false;
  }
}

/**
 * The page origin with a copy button.
 */
export function originBox() {
  const code = h('code', { class: 'origin-code', text: location.origin });
  const copied = h('span', { class: 'copy-done', 'aria-hidden': 'true' });
  const copy = button({
    label: 'Copy',
    icon: 'copy',
    size: 'sm',
    ariaLabel: 'Copy this address',
    onClick: async () => {
      if (await copyText(location.origin, code)) {
        copied.textContent = 'Copied';
        setTimeout(() => (copied.textContent = ''), 2500);
      }
    },
  });
  return h('div', { class: 'origin-box' }, code, copy, copied);
}

/**
 * @param {any} ctx
 */
export function render(ctx) {
  const field = textField({
    label: 'Your client ID',
    hint: 'It looks like 123456789012-abc123.apps.googleusercontent.com',
    value: ctx.prefs.get('clientId', ''),
    spellcheck: false,
    autocomplete: 'off',
    mono: true,
  });
  const summary = h('div');
  const form = h(
    'form',
    {
      class: 'client-form',
      novalidate: true,
      on: {
        submit: (e) => {
          e.preventDefault();
          const value = field.input.value.trim();
          if (!validateClientId(value)) {
            const msg = value
              ? 'This is not a client ID. It must end with .apps.googleusercontent.com and start with numbers.'
              : 'Enter your client ID.';
            field.setError(msg);
            replace(
              summary,
              h(
                'div',
                { class: 'error-summary', role: 'alert' },
                h(
                  'h3',
                  { class: 'error-summary-title' },
                  icon('error'),
                  h('span', { text: 'There is a problem' }),
                ),
                h(
                  'ul',
                  null,
                  h(
                    'li',
                    null,
                    h('a', {
                      href: '#',
                      text: msg,
                      on: {
                        click: (ev) => {
                          ev.preventDefault();
                          field.input.focus();
                        },
                      },
                    }),
                  ),
                ),
              ),
            );
            field.input.focus();
            return;
          }
          field.setError('');
          replace(summary);
          ctx.setClientId(value);
        },
      },
    },
    summary,
    field,
    button({ label: 'Save and continue', variant: 'primary', type: 'submit', icon: 'check' }),
  );

  const tiers = /** @type {const} */ (['basic', 'preview', 'apply']).map((t) =>
    h(
      'li',
      { class: 'tier-card' },
      h(
        'h3',
        { class: 'tier-name' },
        icon(t === 'basic' ? 'filter' : t === 'preview' ? 'eye' : 'tag'),
        h('span', { text: TIER_NAMES[t] }),
      ),
      h('p', {
        class: 'tier-when',
        text: t === 'basic' ? 'Always needed.' : 'Optional. Asked for only when you use it.',
      }),
      h(
        'ul',
        { class: 'tick-list' },
        TIER_EXPLAIN[t].map((x) => h('li', { text: x })),
      ),
      scopeDetails(t, false),
    ),
  );

  const el = h(
    'div',
    { class: 'view-setup' },
    viewHeader({
      title: 'Set up Email Filter',
      lead: 'To use your own Gmail, you need a free Google Cloud client ID. It takes about 10 minutes. You can try the demo first.',
      actions: [
        button({
          label: 'Try the demo',
          variant: 'secondary',
          icon: 'beaker',
          href: './?demo#/overview',
        }),
      ],
    }),
    h(
      'ol',
      { class: 'setup-steps' },
      h(
        'li',
        { class: 'setup-step card' },
        h('h2', { class: 'card-title', text: 'Make a Google Cloud project' }),
        h('p', {
          text: 'Make a free project in Google Cloud and turn on the Gmail API. Set up the consent screen. For a personal Gmail account, add yourself as a test user.',
        }),
        h(
          'p',
          null,
          h(
            'a',
            { href: '../index.html#setup', class: 'link-strong' },
            'Read the step-by-step guide',
            icon('chevronRight', { size: 16 }),
          ),
        ),
      ),
      h(
        'li',
        { class: 'setup-step card' },
        h('h2', { class: 'card-title', text: 'Make a client ID for this page' }),
        h('p', {
          text: 'Make an OAuth client ID of type "Web application". Under "Authorised JavaScript origins", add this exact address:',
        }),
        originBox(),
        notice({
          tone: 'info',
          text: 'It must match exactly, with no slash at the end. If you open Email Filter from another address later, add that address too.',
        }),
      ),
      h(
        'li',
        { class: 'setup-step card' },
        h('h2', { class: 'card-title', text: 'Paste your client ID' }),
        h('p', {
          text: 'Email Filter keeps it in this browser only. It is not a secret, but it is yours.',
        }),
        form,
      ),
    ),
    h(
      'section',
      { class: 'section', 'aria-labelledby': 'setup-perms' },
      h('h2', {
        id: 'setup-perms',
        class: 'section-title',
        text: 'What Email Filter asks Google for',
      }),
      h('p', {
        class: 'section-lead',
        text: 'Permissions come in three steps. Email Filter asks for the next step only when you turn on a feature that needs it.',
      }),
      h('ul', { class: 'tier-grid' }, tiers),
    ),
  );
  return { el, title: 'Set up' };
}
