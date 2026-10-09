// #/setup: first run and changing mode. Three ways in: sign in with your own client ID (three steps,
// this page's origin to copy, the client ID field, permission tiers), work without signing in (open
// a mailFilters.xml file from Gmail), or try the demo.

import { BackupError, XML_LIMITS } from '../../core/backup.js';
import { TIER_NAMES, validateClientId } from '../../gmail/auth.js';
import { confirmDialog } from '../components/dialog.js';
import { TIER_EXPLAIN, scopeDetails } from '../components/permission.js';
import { announce } from '../components/toast.js';
import { button, notice, textField, viewHeader } from '../components/widgets.js';
import { h, plural, replace } from '../dom.js';
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
 * An error summary with one message. The link moves focus to the field.
 * @param {string} msg
 * @param {HTMLElement} target
 */
function errorSummary(msg, target) {
  return h(
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
              target.focus();
            },
          },
        }),
      ),
    ),
  );
}

/**
 * Moves to a part of this page. The hash is the route, so this cannot be a normal anchor link.
 * @param {string} id
 * @param {HTMLElement} [focusEl]
 */
function goTo(id, focusEl) {
  const target = document.getElementById(id);
  target?.scrollIntoView({ block: 'start' });
  if (focusEl) {
    focusEl.focus({ preventScroll: true });
  } else if (target) {
    target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  }
}

/** What to do, in order, to work without signing in. */
export const FILE_STEPS = [
  'In Gmail, open Settings, then See all settings, then Filters and blocked addresses. Select all your filters and choose Export. Your browser saves a file called mailFilters.xml.',
  'Open that file here.',
  'Change your filters as normal: tidy up, make bulk changes, add suggestions and undo.',
  'Choose Download for Gmail to save the new file.',
  'In Gmail, delete your old filters. Then choose Import filters and pick the new file. Gmail import adds filters and never deletes them, so delete the old ones first.',
];

/**
 * "Work without signing in": the steps, and a file picker with a drop zone.
 * @param {any} ctx
 */
function fileSection(ctx) {
  const input = /** @type {HTMLInputElement} */ (
    h('input', {
      type: 'file',
      id: 'filter-file',
      accept: '.xml,application/xml,text/xml',
      class: 'file-input',
      'aria-describedby': 'filter-file-hint',
    })
  );
  const errors = h('div', { class: 'error-summary-area' });
  const status = h('p', { role: 'status', class: 'muted' });
  const zone = h(
    'div',
    { class: 'drop-zone' },
    icon('upload', { size: 28 }),
    h('label', {
      for: 'filter-file',
      class: 'field-label',
      text: 'Choose your mailFilters.xml file',
    }),
    h('p', {
      id: 'filter-file-hint',
      class: 'field-hint',
      text: 'Or drag the file here. 3B Mailbox reads it in this tab only.',
    }),
    input,
  );

  /** @param {string} msg */
  function showError(msg) {
    status.textContent = '';
    replace(errors, errorSummary(msg, input));
    input.setAttribute('aria-invalid', 'true');
    /** @type {HTMLElement|null} */ (errors.querySelector('a'))?.focus();
  }

  /** @param {File|undefined|null} file */
  async function open(file) {
    if (!file) return;
    replace(errors);
    input.removeAttribute('aria-invalid');
    try {
      if (file.size > XML_LIMITS.maxBytes) {
        showError(
          'This file is too big for a Gmail filter file. The limit is 5 MB. Check that you chose mailFilters.xml.',
        );
        return;
      }
      if (
        ctx.mode === 'file' &&
        ctx.state.get().fileDirty &&
        !(await confirmDialog({
          title: 'Open another file?',
          message:
            'You have changes that are not downloaded. If you open another file, you lose them.',
          confirmLabel: 'Open the file',
          danger: true,
        }))
      ) {
        return;
      }
      status.textContent = 'Reading the file...';
      const parsed = await ctx.openFile(await file.text(), file.name);
      status.textContent = '';
      announce(`Opened ${plural(parsed.filters.length, 'filter')} from ${file.name}.`);
      ctx.navigate('#/overview');
    } catch (err) {
      showError(
        err instanceof BackupError
          ? err.message
          : '3B Mailbox could not read this file. Check that you chose mailFilters.xml from Gmail.',
      );
    } finally {
      input.value = '';
    }
  }

  input.addEventListener('change', () => open(input.files?.[0]));
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('drop-zone-active');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('drop-zone-active'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('drop-zone-active');
    open(e.dataTransfer?.files?.[0]);
  });

  return {
    input,
    el: h(
      'section',
      {
        class: 'section card file-setup',
        id: 'setup-file',
        'aria-labelledby': 'setup-file-title',
      },
      h('h2', { id: 'setup-file-title', class: 'section-title', text: 'Work without signing in' }),
      h('p', {
        class: 'section-lead',
        text: 'You need no Google Cloud client ID and no Google permission. 3B Mailbox reads only the file you choose. Nothing leaves your browser.',
      }),
      h(
        'ol',
        { class: 'file-steps' },
        FILE_STEPS.map((t) => h('li', { text: t })),
      ),
      errors,
      zone,
      status,
      notice({
        tone: 'info',
        title: 'What you give up',
        text: '3B Mailbox cannot show matching mail or apply a filter to mail you already have. You delete and import your filters in Gmail yourself.',
      }),
    ),
  };
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
            replace(summary, errorSummary(msg, field.input));
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
        'h4',
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

  const file = fileSection(ctx);

  /**
   * @param {string} iconName
   * @param {string} title
   * @param {string} text
   * @param {Node} action
   */
  const choice = (iconName, title, text, action) =>
    h(
      'li',
      { class: 'choice-card' },
      h('h2', { class: 'tier-name' }, icon(iconName), h('span', { text: title })),
      h('p', { text }),
      action,
    );

  const el = h(
    'div',
    { class: 'view-setup' },
    viewHeader({
      title: 'Set up 3B Mailbox',
      lead: 'Choose how to use 3B Mailbox. You can change this later.',
    }),
    ctx.mode === 'file' &&
      notice({
        tone: 'info',
        title: `You are in no sign-in mode with ${ctx.state.get().fileName || 'your file'}.`,
        text: 'You can open another file, or sign in with your own client ID instead. Download your changes first if you want to keep them.',
        children: [
          h(
            'div',
            { class: 'button-row' },
            button({
              label: 'Back to your filters',
              variant: 'primary',
              size: 'sm',
              href: '#/overview',
            }),
            button({
              label: 'Download for Gmail',
              size: 'sm',
              icon: 'download',
              onClick: () => ctx.downloadForGmail(),
            }),
            button({
              label: 'Leave no sign-in mode',
              variant: 'quiet',
              size: 'sm',
              onClick: () => ctx.leaveMode(),
            }),
          ),
        ],
      }),
    h(
      'ul',
      { class: 'choice-grid', 'aria-label': 'Ways to use 3B Mailbox' },
      choice(
        'signin',
        'Sign in with your own Google client ID',
        'Best for regular use. Changes go straight to Gmail, and you can see matching mail. Setup takes about 10 minutes.',
        button({ label: 'Set up sign-in', onClick: () => goTo('setup-signin') }),
      ),
      choice(
        'upload',
        'Work without signing in',
        'No Google setup. Export your filters from Gmail, change them here, then import the new file in Gmail.',
        button({ label: 'Open your filter file', onClick: () => goTo('setup-file', file.input) }),
      ),
      choice(
        'beaker',
        'Try the demo',
        'Look around with made-up filters. Nothing connects to Google.',
        button({ label: 'Try the demo', href: './?demo#/overview' }),
      ),
    ),
    h('h2', {
      id: 'setup-signin',
      class: 'section-title setup-path-title',
      text: 'Sign in with your own Google client ID',
    }),
    h(
      'ol',
      { class: 'setup-steps' },
      h(
        'li',
        { class: 'setup-step card' },
        h('h3', { class: 'card-title', text: 'Make a Google Cloud project' }),
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
        h('h3', { class: 'card-title', text: 'Make a client ID for this page' }),
        h('p', {
          text: 'Make an OAuth client ID of type "Web application". Under "Authorised JavaScript origins", add this exact address:',
        }),
        originBox(),
        notice({
          tone: 'info',
          text: 'It must match exactly, with no slash at the end. If you open 3B Mailbox from another address later, add that address too.',
        }),
      ),
      h(
        'li',
        { class: 'setup-step card' },
        h('h3', { class: 'card-title', text: 'Paste your client ID' }),
        h('p', {
          text: '3B Mailbox keeps it in this browser only. It is not a secret, but it is yours.',
        }),
        form,
      ),
    ),
    h(
      'section',
      { class: 'section', 'aria-labelledby': 'setup-perms' },
      h('h3', {
        id: 'setup-perms',
        class: 'section-title',
        text: 'What 3B Mailbox asks Google for',
      }),
      h('p', {
        class: 'section-lead',
        text: 'Permissions come in three steps. 3B Mailbox asks for the next step only when you turn on a feature that needs it.',
      }),
      h('ul', { class: 'tier-grid' }, tiers),
    ),
    file.el,
  );
  return { el, title: 'Set up' };
}
