// #/settings: client ID, permissions, appearance, shortcuts, backups, change history, diagnostics,
// local data and sign out.

import { BackupError, fromJson, toGmailXml, toJson } from '../../core/backup.js';
import { LIMITS } from '../../core/limits.js';
import { KEYS } from '../../core/storage.js';
import { TIER_NAMES, validateClientId } from '../../gmail/auth.js';
import { confirmDialog, openDialog } from '../components/dialog.js';
import { TIER_EXPLAIN, ensureTier, scopeDetails } from '../components/permission.js';
import { reviewAndRun } from '../components/plan-preview.js';
import { announce, toast } from '../components/toast.js';
import {
  button,
  checkbox,
  notice,
  segmented,
  textField,
  viewHeader,
} from '../components/widgets.js';
import { download, formatDate, h, plural, replace } from '../dom.js';
import { icon } from '../icons.js';
import { journalBatches, planRestoreBackup, planRestoreBatch } from '../plans.js';
import { PREFS } from '../state.js';
import { originBox } from './setup.js';

/** The label for temporary test filters. */
export const PROBE_LABEL = 'zz-ef-test/probe';

/**
 * A query string of exactly n characters for the length test.
 * @param {number} n
 */
export function probeQuery(n) {
  let s = 'zzefprobe';
  while (s.length < n) s += ' x';
  s = s.slice(0, n);
  if (s.endsWith(' ')) s = `${s.slice(0, -1)}y`;
  return s;
}

/**
 * @param {string} id
 * @param {string} title
 * @param {string} iconName
 * @param {...any} children
 */
function section(id, title, iconName, ...children) {
  return h(
    'section',
    { class: 'card settings-section', 'aria-labelledby': id, id: `section-${id}` },
    h('h2', { id, class: 'card-title' }, icon(iconName), h('span', { text: title })),
    ...children,
  );
}

/**
 * @param {any} ctx
 */
export function render(ctx) {
  const { prefs } = ctx;
  const cleanups = [];

  // ---- Client ID
  const clientField = textField({
    label: 'Client ID',
    value: prefs.get(KEYS.clientId, ''),
    hint: 'From your Google Cloud project. It ends with .apps.googleusercontent.com.',
    spellcheck: false,
    mono: true,
  });
  const clientSection = section(
    'set-client',
    'Google client ID',
    'lock',
    ctx.mode === 'demo' &&
      notice({
        tone: 'info',
        text: 'You are in the demo. A client ID is only needed for your own Gmail.',
      }),
    h(
      'form',
      {
        class: 'stack',
        novalidate: true,
        on: {
          submit: (e) => {
            e.preventDefault();
            const v = clientField.input.value.trim();
            if (!validateClientId(v)) {
              clientField.setError(
                'This is not a client ID. It ends with .apps.googleusercontent.com.',
              );
              clientField.input.focus();
              return;
            }
            ctx.setClientId(v);
          },
        },
      },
      clientField,
      h('p', {
        class: 'field-hint',
        text: 'Add this address to "Authorised JavaScript origins" in Google Cloud:',
      }),
      originBox(),
      h(
        'div',
        { class: 'button-row' },
        button({ label: 'Save client ID', variant: 'primary', type: 'submit' }),
        prefs.get(KEYS.clientId, '') &&
          button({
            label: 'Remove client ID',
            variant: 'quiet',
            onClick: async () => {
              const ok = await confirmDialog({
                title: 'Remove your client ID?',
                message:
                  'Email Filter forgets your client ID and signs you out. Your filters in Gmail do not change.',
                confirmLabel: 'Remove client ID',
                danger: true,
              });
              if (ok) {
                await ctx.signOut?.();
                ctx.clearClientId();
              }
            },
          }),
      ),
    ),
  );

  // ---- Permissions
  const permList = h('ul', { class: 'perm-list' });
  function drawPerms() {
    const signedIn = ctx.mode === 'demo' || Boolean(ctx.auth?.getToken());
    replace(
      permList,
      /** @type {const} */ (['basic', 'preview', 'apply']).map((tier) => {
        const on = signedIn && Boolean(ctx.auth?.hasTier(tier));
        const sw = checkbox({
          label: TIER_NAMES[tier],
          switch: true,
          checked: tier === 'basic' ? signedIn : on,
          disabled: tier === 'basic' || ctx.mode === 'setup',
          hint: h(
            'span',
            null,
            TIER_EXPLAIN[tier].join(' '),
            tier === 'basic' ? ' Always needed.' : ' Optional.',
          ),
          onChange: async (checked) => {
            if (checked) {
              prefs.set(KEYS.tierWanted, tier);
              const ok = await ensureTier(ctx, tier);
              if (!ok) sw.input.checked = false;
              drawPerms();
              return;
            }
            if (ctx.mode === 'demo') {
              ctx.auth.revoke(tier);
              announce(`${TIER_NAMES[tier]} is off.`);
              drawPerms();
              return;
            }
            prefs.set(KEYS.tierWanted, tier === 'apply' ? 'preview' : 'basic');
            sw.input.checked = true;
            const close = button({ label: 'Close', variant: 'primary' });
            const d = openDialog({
              title: 'Remove a permission',
              size: 'sm',
              content: [
                h('p', {
                  text: 'Email Filter will not ask for this permission again. Google keeps it until you remove it.',
                }),
                h(
                  'p',
                  null,
                  'To remove it now, open ',
                  h(
                    'a',
                    {
                      href: 'https://myaccount.google.com/permissions',
                      target: '_blank',
                      rel: 'noopener noreferrer',
                    },
                    'your Google Account permissions',
                    h('span', { class: 'visually-hidden', text: ' (opens in a new tab)' }),
                  ),
                  ', remove Email Filter, then sign in again.',
                ),
              ],
              footer: close,
            });
            close.addEventListener('click', () => d.close());
          },
        });
        return h('li', { class: 'perm-item' }, sw, scopeDetails(tier, tier !== 'basic'));
      }),
    );
  }
  drawPerms();
  cleanups.push(
    ctx.state.subscribe(
      (_s, changed) => (changed.has('auth') || changed.has('journalVersion')) && drawPerms(),
    ),
  );
  const permSection = section(
    'set-perms',
    'Permissions',
    'shield',
    h('p', {
      class: 'muted',
      text: 'Email Filter asks for the smallest permission it needs. Turn on more only when you want the feature.',
    }),
    permList,
    h(
      'p',
      null,
      h(
        'a',
        {
          href: 'https://myaccount.google.com/permissions',
          target: '_blank',
          rel: 'noopener noreferrer',
          class: 'link-strong',
        },
        'Review or remove access in your Google Account',
        icon('external', { size: 16 }),
        h('span', { class: 'visually-hidden', text: ' (opens in a new tab)' }),
      ),
    ),
  );

  // ---- Appearance
  const setPref = (key, value) => {
    prefs.set(key, value);
    ctx.applyAppearance();
  };
  const appearanceSection = section(
    'set-look',
    'Appearance',
    'sun',
    segmented({
      legend: 'Theme',
      name: 'theme',
      value: prefs.get(KEYS.theme, 'system'),
      options: [
        { value: 'system', label: 'System', icon: 'monitor' },
        { value: 'light', label: 'Light', icon: 'sun' },
        { value: 'dark', label: 'Dark', icon: 'moon' },
      ],
      onChange: (v) => setPref(KEYS.theme, v),
    }),
    segmented({
      legend: 'Density',
      name: 'density',
      value: prefs.get(KEYS.density, 'comfortable'),
      options: [
        { value: 'comfortable', label: 'Comfortable' },
        { value: 'compact', label: 'Compact' },
      ],
      onChange: (v) => setPref(KEYS.density, v),
    }),
    checkbox({
      label: 'Reduce motion',
      switch: true,
      checked: prefs.get(PREFS.motion, 'system') === 'reduce',
      hint: 'Turns off animations, even if your device allows them.',
      onChange: (v) => setPref(PREFS.motion, v ? 'reduce' : 'system'),
    }),
    checkbox({
      label: 'Keyboard shortcuts',
      switch: true,
      checked: prefs.get(PREFS.shortcuts, true) !== false,
      hint: 'Single keys: / to search, n for a new filter, ? for help. Turn them off if you use speech input or they get in your way.',
      onChange: (v) => prefs.set(PREFS.shortcuts, v),
    }),
    button({
      label: 'Show keyboard shortcuts',
      variant: 'quiet',
      icon: 'keyboard',
      onClick: () => ctx.showShortcuts(),
    }),
  );

  // ---- Backups
  const fileInput = h('input', {
    type: 'file',
    id: 'restore-file',
    accept: 'application/json,.json',
    class: 'file-input',
  });
  const restoreStatus = h('div', { role: 'status' });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    replace(restoreStatus);
    try {
      const backup = fromJson(await file.text());
      const s = ctx.state.get();
      const { plan, skipped } = planRestoreBackup(backup, s.filters, s.labels, {
        total: s.filters.length,
        labelCount: s.labels.filter((l) => l.type === 'user').length,
      });
      const intro = `${plural(backup.filters.length, 'filter')} in the backup${backup.exportedAt ? ` from ${formatDate(backup.exportedAt)}` : ''}. ${skipped ? `${plural(skipped, 'filter')} you have already ${skipped === 1 ? 'is' : 'are'} left out.` : ''}`;
      await reviewAndRun(ctx, plan, { intro });
    } catch (err) {
      replace(
        restoreStatus,
        notice({
          tone: 'danger',
          text: err instanceof BackupError || err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      fileInput.value = '';
    }
  });
  const ready = () => ctx.state.get().status === 'ready';
  const backupSection = section(
    'set-backup',
    'Backups',
    'download',
    h('p', {
      class: 'muted',
      text: 'Keep a copy of your filters on your own device. Do this before big changes.',
    }),
    h(
      'div',
      { class: 'button-row' },
      button({
        label: 'Download a JSON backup',
        icon: 'download',
        onClick: () => {
          if (!ready()) return toast('Your filters are not loaded yet.', { tone: 'warning' });
          const s = ctx.state.get();
          download(
            `email-filter-backup-${new Date().toISOString().slice(0, 10)}.json`,
            toJson(s.filters, s.labels),
            'application/json',
          );
          toast(`Downloaded ${plural(s.filters.length, 'filter')}.`, { tone: 'success' });
        },
      }),
      button({
        label: 'Download for Gmail (XML)',
        icon: 'download',
        onClick: () => {
          if (!ready()) return toast('Your filters are not loaded yet.', { tone: 'warning' });
          const s = ctx.state.get();
          download('mailFilters.xml', toGmailXml(s.filters, s.labelsById), 'application/xml');
          toast(`Downloaded ${plural(s.filters.length, 'filter')} for Gmail.`, { tone: 'success' });
        },
      }),
    ),
    notice({
      tone: 'info',
      text: 'Gmail import (Settings, Filters and blocked addresses, Import filters) adds the filters in the file. It does not delete the filters you have, so you may get copies.',
    }),
    h(
      'div',
      { class: 'field' },
      h('label', { for: 'restore-file', class: 'field-label', text: 'Restore from a JSON backup' }),
      h('p', {
        class: 'field-hint',
        text: 'Email Filter shows you every change before it makes any. Filters you already have are left out.',
      }),
      fileInput,
    ),
    restoreStatus,
  );

  // ---- Change history
  const historyArea = h('div');
  function drawHistory() {
    const batches = journalBatches(ctx.journal.list());
    if (batches.length === 0) {
      replace(
        historyArea,
        h('p', {
          class: 'muted',
          text: 'No changes yet. Email Filter keeps a copy of each filter it changes or deletes, in this browser only.',
        }),
      );
      return;
    }
    replace(
      historyArea,
      h(
        'ul',
        { class: 'history-list' },
        batches.map((b) =>
          h(
            'li',
            { class: 'history-item' },
            h('span', { class: 'history-icon' }, icon('history')),
            h(
              'div',
              { class: 'history-text' },
              h('p', { class: 'history-title', text: b.title }),
              h('p', {
                class: 'history-meta',
                text: `${formatDate(b.time)}. ${plural(b.entries.length, 'filter')} saved.`,
              }),
            ),
            button({
              label: 'Restore',
              ariaLabel: `Restore: ${b.title}`,
              size: 'sm',
              icon: 'undo',
              onClick: () => {
                if (!ready()) return;
                const now = ctx.state.get().filters;
                reviewAndRun(ctx, planRestoreBatch(b.entries, now, { total: now.length }));
              },
            }),
          ),
        ),
      ),
      button({
        label: 'Clear change history',
        variant: 'quiet',
        icon: 'trash',
        onClick: async () => {
          if (
            await confirmDialog({
              title: 'Clear change history?',
              message:
                'You will not be able to undo or restore these changes. Your filters in Gmail do not change.',
              confirmLabel: 'Clear history',
              danger: true,
            })
          ) {
            ctx.journal.clear();
            ctx.state.set({ journalVersion: ctx.state.get().journalVersion + 1 });
            announce('Change history cleared.');
          }
        },
      }),
    );
  }
  drawHistory();
  cleanups.push(
    ctx.state.subscribe((_s, changed) => changed.has('journalVersion') && drawHistory()),
  );
  const historySection = section('set-history', 'Change history', 'history', historyArea);

  // ---- Diagnostics
  const measureResult = h('div', { role: 'status' });
  const diagSection = section(
    'set-diag',
    'Diagnostics',
    'beaker',
    h('h3', { class: 'subhead', text: 'Measure the filter length limit' }),
    h('p', {
      text: `Google does not publish the longest filter it accepts. Email Filter assumes ${LIMITS.criteriaCharsHard.toLocaleString('en-GB')} characters and keeps each filter under ${LIMITS.criteriaCharsSafe.toLocaleString('en-GB')}. This test finds the real limit for your account.`,
    }),
    h('p', {
      class: 'muted',
      text: `It makes and deletes about 22 test filters with the label ${PROBE_LABEL}. It takes about a minute. The label stays, so you can delete it in Gmail afterwards.`,
    }),
    button({
      label: 'Measure the limit',
      icon: 'beaker',
      onClick: () => measure(ctx, measureResult),
    }),
    measureResult,
  );

  // ---- Local data
  const dataSection = section(
    'set-data',
    'Data in this browser',
    'trash',
    h('p', {
      text: 'Email Filter keeps your settings, client ID and change history in this browser only. It never stores your Google sign-in.',
    }),
    h(
      'div',
      { class: 'button-row' },
      button({
        label: 'Delete all local data',
        variant: 'danger',
        icon: 'trash',
        onClick: async () => {
          const ok = await confirmDialog({
            title: 'Delete all local data?',
            message:
              'This removes your settings, client ID and change history from this browser. You cannot undo it. Your filters in Gmail do not change.',
            confirmLabel: 'Delete local data',
            danger: true,
          });
          if (!ok) return;
          prefs.clearAll();
          ctx.journal.clear();
          ctx.drafts.clear();
          ctx.applyAppearance();
          ctx.state.set({ journalVersion: ctx.state.get().journalVersion + 1 });
          toast('All local data is deleted.', { tone: 'success' });
          if (ctx.mode === 'google') {
            await ctx.signOut();
            ctx.clearClientId();
          } else ctx.navigate('#/settings');
        },
      }),
      ctx.mode === 'google' &&
        button({ label: 'Sign out', icon: 'signout', onClick: () => ctx.signOut() }),
    ),
  );

  const el = h(
    'div',
    { class: 'view-settings' },
    viewHeader({
      title: 'Settings',
      lead: 'Your client ID, permissions, appearance, backups and history.',
    }),
    h(
      'nav',
      { class: 'settings-toc', 'aria-label': 'Settings sections' },
      h(
        'ul',
        { class: 'toc-list' },
        [
          ['set-look', 'Appearance'],
          ['set-perms', 'Permissions'],
          ['set-client', 'Client ID'],
          ['set-backup', 'Backups'],
          ['set-history', 'History'],
          ['set-diag', 'Diagnostics'],
          ['set-data', 'Local data'],
        ].map(([id, text]) =>
          h(
            'li',
            null,
            h('a', {
              href: `#/settings`,
              text,
              on: {
                click: (e) => {
                  e.preventDefault();
                  const target = document.getElementById(`section-${id}`);
                  target?.scrollIntoView({ block: 'start' });
                  document.getElementById(id)?.setAttribute('tabindex', '-1');
                  document.getElementById(id)?.focus({ preventScroll: true });
                },
              },
            }),
          ),
        ),
      ),
    ),
    h(
      'div',
      { class: 'settings-grid' },
      appearanceSection,
      permSection,
      clientSection,
      backupSection,
      historySection,
      diagSection,
      dataSection,
    ),
  );
  return { el, title: 'Settings', destroy: () => cleanups.forEach((c) => c()) };
}

/**
 * Finds the longest filter Gmail accepts, with a binary search between 1,000 and 2,000 characters.
 * Every test filter is deleted, even when something fails.
 * @param {any} ctx
 * @param {HTMLElement} out
 */
async function measure(ctx, out) {
  if (!ctx.canWrite()) {
    replace(out, notice({ tone: 'warning', text: 'Sign in first.' }));
    return;
  }
  const ok = await confirmDialog({
    title: 'Measure the filter length limit?',
    message: `Email Filter will make and delete about 22 test filters with the label ${PROBE_LABEL}. They catch no real mail. It takes about a minute. Keep this page open.`,
    confirmLabel: 'Start the test',
  });
  if (!ok) return;
  const live = h('p', { role: 'status', text: 'Starting...' });
  const bar = h('span', { class: 'progress-fill' });
  const progress = h(
    'div',
    {
      class: 'progress',
      role: 'progressbar',
      'aria-label': 'Test progress',
      'aria-valuemin': '0',
      'aria-valuemax': '12',
      'aria-valuenow': '0',
    },
    bar,
  );
  const stop = button({ label: 'Stop', icon: 'close' });
  const controller = new AbortController();
  stop.addEventListener('click', () => {
    controller.abort();
    stop.disabled = true;
  });
  const d = openDialog({
    title: 'Measuring the limit',
    size: 'sm',
    dismissable: false,
    content: [progress, live],
    footer: stop,
  });
  /** @type {string[]} */
  const made = [];
  let steps = 0;
  const tick = (text) => {
    steps++;
    progress.setAttribute('aria-valuenow', String(Math.min(steps, 12)));
    bar.style.setProperty('--fill', String(Math.min(1, steps / 12)));
    live.textContent = text;
  };
  let resultText;
  let tone = 'success';
  let leftover = false;
  try {
    const labels = await ctx.api.listLabels();
    /** @param {string} name */
    const ensureLabel = async (name) => {
      const found = labels.find((l) => l.name.toLowerCase() === name.toLowerCase());
      if (found) return found.id;
      try {
        return (await ctx.api.createLabel(name)).id;
      } catch (err) {
        if (err?.status === 409)
          return (await ctx.api.listLabels()).find(
            (l) => l.name.toLowerCase() === name.toLowerCase(),
          )?.id;
        throw err;
      }
    };
    await ensureLabel('zz-ef-test');
    const labelId = await ensureLabel(PROBE_LABEL);
    /** @param {number} n */
    const tryLength = async (n) => {
      if (controller.signal.aborted) throw new Error('Stopped.');
      try {
        const f = await ctx.api.createFilter({
          criteria: { query: probeQuery(n) },
          action: { addLabelIds: [labelId] },
        });
        made.push(f.id);
        await ctx.api.deleteFilter(f.id);
        made.splice(made.indexOf(f.id), 1);
        return true;
      } catch (err) {
        const text = `${err?.detail ?? ''} ${err?.message ?? ''}`.toLowerCase();
        if (err?.status === 400 && text.includes('too long')) return false;
        throw err;
      }
    };
    let lo = 1000;
    let hi = 2000;
    tick('Testing 1,000 characters...');
    if (!(await tryLength(lo))) {
      resultText = 'Gmail did not accept a filter of 1,000 characters. Keep your filters short.';
      tone = 'warning';
    } else {
      tick('Testing 2,000 characters...');
      if (await tryLength(hi)) {
        resultText =
          'Gmail accepted a filter of 2,000 characters. The limit is higher than this test checks.';
      } else {
        while (hi - lo > 1) {
          const mid = Math.floor((lo + hi) / 2);
          tick(`Testing ${mid.toLocaleString('en-GB')} characters...`);
          if (await tryLength(mid)) lo = mid;
          else hi = mid;
        }
        resultText = `The longest filter Gmail accepted is ${lo.toLocaleString('en-GB')} characters. Email Filter keeps filters under ${LIMITS.criteriaCharsSafe.toLocaleString('en-GB')}.`;
      }
    }
  } catch (err) {
    tone = 'danger';
    resultText = `The test stopped: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    for (const id of [...made]) {
      try {
        await ctx.api.deleteFilter(id);
      } catch {
        tone = 'danger';
        leftover = true;
      }
    }
  }
  d.close();
  replace(
    out,
    notice({
      tone: /** @type {any} */ (tone),
      title: resultText,
      text: leftover
        ? `A test filter could not be deleted. In Gmail, delete the filters with the label ${PROBE_LABEL}.`
        : 'All test filters are deleted.',
    }),
  );
  await ctx.reload({ quiet: true });
}
