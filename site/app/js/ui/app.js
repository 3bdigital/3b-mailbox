// The app: shell, data source, session, banners, keyboard shortcuts and view switching.

import { analyse } from '../core/analyse.js';
import { fromGmailXml } from '../core/backup.js';
import { createJournal } from '../core/journal.js';
import { KEYS, createStore, memoryStorage } from '../core/storage.js';
import { SCOPES, createAuth, validateClientId } from '../gmail/auth.js';
import { createGmailClient } from '../gmail/client.js';
import { contentKey, createFileAuth, createFileGmail } from '../gmail/file-source.js';
import { createMockGmail, demoData } from '../gmail/mock.js';
import { openDialog } from './components/dialog.js';
import { announce, toast } from './components/toast.js';
import { downloadDialog } from './components/download.js';
import { button } from './components/widgets.js';
import { h, replace } from './dom.js';
import { icon } from './icons.js';
import { startRouter } from './router.js';
import { PREFS, createState } from './state.js';
import * as editorView from './views/editor.js';
import * as filtersView from './views/filters.js';
import * as overviewView from './views/overview.js';
import * as settingsView from './views/settings.js';
import * as setupView from './views/setup.js';
import * as suggestionsView from './views/suggestions.js';
import * as tidyView from './views/tidy.js';

/** @typedef {import('../types.js').PermissionTier} PermissionTier */

const VIEWS = {
  setup: setupView,
  overview: overviewView,
  filters: filtersView,
  editor: editorView,
  suggestions: suggestionsView,
  tidy: tidyView,
  settings: settingsView,
};

export { PREFS };

/**
 * A stand-in for gmail/auth.js in demo mode. Permissions are granted at once, in memory.
 */
export function createDemoAuth() {
  /** @type {Set<PermissionTier>} */
  const granted = new Set(['basic']);
  const listeners = new Set();
  return {
    async signIn() {},
    /** @param {PermissionTier} tier */
    async upgrade(tier) {
      granted.add('basic');
      if (tier === 'preview' || tier === 'apply') granted.add('preview');
      if (tier === 'apply') granted.add('apply');
      for (const cb of listeners) cb({ type: 'signed-in', expiresAt: null });
    },
    /** @param {PermissionTier} tier */
    revoke(tier) {
      if (tier === 'preview') {
        granted.delete('preview');
        granted.delete('apply');
      }
      if (tier === 'apply') granted.delete('apply');
    },
    async signOut() {},
    getToken: () => 'demo',
    /** @param {PermissionTier} tier */
    hasTier: (tier) => granted.has(tier),
    expiresAt: () => null,
    /** @param {(e: any) => void} cb */
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

/**
 * Demo data, padded with made-up filters up to `size` (for trying a full account of 1,000).
 * @param {number} size
 */
export function bigDemo(size) {
  const data = demoData();
  const labels = data.labels.filter((l) => l.type === 'user').map((l) => l.id);
  const words = ['news', 'offers', 'billing', 'alerts', 'team', 'hello', 'support', 'updates'];
  for (let i = data.filters.length; i < Math.min(size, 1000); i++) {
    data.filters.push({
      id: `ANdemo${String(i).padStart(5, '0')}`,
      criteria: { from: `${words[i % words.length]}@shop${i}.example.com` },
      action: {
        addLabelIds: [labels[i % labels.length]],
        ...(i % 3 === 0 ? { removeLabelIds: ['INBOX'] } : {}),
      },
    });
  }
  return data;
}

/**
 * Applies the appearance preferences to <html>.
 * @param {import('../core/storage.js').Store} prefs
 */
export function applyAppearance(prefs) {
  const root = document.documentElement;
  const theme = /** @type {string} */ (prefs.get(KEYS.theme, 'system'));
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
  const density = /** @type {string} */ (prefs.get(KEYS.density, 'comfortable'));
  if (density === 'compact') root.dataset.density = 'compact';
  else delete root.dataset.density;
  if (/** @type {string} */ (prefs.get(PREFS.motion, 'system')) === 'reduce')
    root.dataset.motion = 'reduce';
  else delete root.dataset.motion;
}

/**
 * Starts the app.
 * @param {{demo: boolean, demoSize?: number, store?: import('../core/storage.js').Store}} opts
 */
export function startApp(opts) {
  const prefs = opts.store ?? createStore();
  applyAppearance(prefs);
  const clientId = prefs.get(KEYS.clientId, '');
  const demo = opts.demo;
  /** @type {'demo'|'google'|'setup'|'file'} */
  const mode = demo ? 'demo' : validateClientId(clientId) ? 'google' : 'setup';
  const state = createState({
    mode,
    auth: demo ? 'demo' : 'signed-out',
    online: navigator.onLine !== false,
  });
  // Demo changes stay in this tab, so the demo has its own journal in memory.
  const journal = createJournal(demo ? createStore(memoryStorage(), 'demo:') : prefs);

  /** @type {any} */
  let auth = null;
  /** @type {any} */
  let api = null;
  if (demo) {
    auth = createDemoAuth();
    api = createMockGmail({ ...bigDemo(opts.demoSize ?? 0), latencyMs: 150 });
  } else if (mode === 'google') {
    auth = createAuth({ clientId });
  }
  if (mode === 'google') api = createGmailClient({ getToken: () => auth.getToken() });

  const ctx = {
    /** @type {'demo'|'google'|'setup'|'file'} Changes to 'file' when the user opens a filter file. */
    mode,
    demo,
    state,
    prefs,
    journal,
    api,
    auth,
    clientId,
    /**
     * No sign-in mode: the file the user opened, the original text and what the last download held.
     * @type {null|{name: string, text: string, baseline: string, warnings: string[]}}
     */
    file: null,
    /** Unsaved editor input, kept in memory so a sign-in or route change never loses it. */
    drafts: new Map(),
    /** @param {string} hash */
    navigate: (hash) => router.navigate(hash),
    /** True when a feature needs Google: matching mail, apply to existing mail, permissions. */
    noSignIn: () => ctx.mode === 'file',
    canWrite() {
      if (!ctx.api) return false;
      if (ctx.mode === 'demo' || ctx.mode === 'file') return true;
      return Boolean(ctx.auth?.getToken()) && state.get().online;
    },
    /** @param {PermissionTier} [tier] */
    async signIn(tier) {
      if (!ctx.auth) return false;
      if (ctx.mode !== 'google') return true;
      try {
        const wanted = tier ?? prefs.get(KEYS.tierWanted, 'basic');
        await ctx.auth.signIn(SCOPES[wanted] ? wanted : 'basic');
        await ctx.reload();
        return true;
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), { tone: 'danger', timeout: 0 });
        return false;
      }
    },
    async signOut() {
      if (!ctx.auth || ctx.mode !== 'google') return;
      await ctx.auth.signOut();
      state.set({
        filters: [],
        labels: [],
        labelsById: new Map(),
        forwarding: [],
        issues: [],
        status: 'idle',
        selection: new Set(),
      });
      announce('You are signed out.');
    },
    /** @param {{quiet?: boolean}} [o] */
    async reload(o = {}) {
      if (!ctx.api || (ctx.mode === 'google' && !ctx.auth?.getToken())) {
        state.set({ status: 'idle' });
        return;
      }
      if (!o.quiet) state.set({ status: 'loading', error: '' });
      try {
        const [filters, labels, forwarding] = await Promise.all([
          ctx.api.listFilters(),
          ctx.api.listLabels(),
          ctx.api.listForwardingAddresses(),
        ]);
        const ids = new Set(filters.map((f) => f.id));
        const selection = new Set([...state.get().selection].filter((id) => ids.has(id)));
        const labelsById = new Map(labels.map((l) => [l.id, l]));
        state.set({
          status: 'ready',
          error: '',
          filters,
          labels,
          labelsById,
          forwarding,
          issues: analyse({ filters, labels, forwardingAddresses: forwarding }),
          selection,
          ...(ctx.file ? { fileDirty: contentKey(filters, labelsById) !== ctx.file.baseline } : {}),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (o.quiet && state.get().status === 'ready') toast(message, { tone: 'danger' });
        else state.set({ status: 'error', error: message });
      }
    },
    /**
     * Starts no sign-in mode with a mailFilters.xml file from Gmail. Throws BackupError.
     * @param {string} text
     * @param {string} name
     */
    async openFile(text, name) {
      const parsed = fromGmailXml(text);
      const fileApi = createFileGmail(parsed);
      const [filters, labels] = await Promise.all([fileApi.listFilters(), fileApi.listLabels()]);
      ctx.file = {
        name,
        text,
        baseline: contentKey(filters, new Map(labels.map((l) => [l.id, l]))),
        warnings: parsed.warnings,
      };
      ctx.mode = 'file';
      ctx.api = fileApi;
      ctx.auth = createFileAuth();
      // Changes stay in this tab, so this mode has its own journal in memory.
      ctx.journal = createJournal(createStore(memoryStorage(), 'file:'));
      ctx.drafts.clear();
      document.body.dataset.mode = 'file';
      state.set({
        mode: 'file',
        auth: 'file',
        selection: new Set(),
        fileDirty: false,
        fileName: name,
        journalVersion: state.get().journalVersion + 1,
      });
      await ctx.reload();
      return parsed;
    },
    /** Opens the "Download for Gmail" dialog with the steps to put the filters back. */
    downloadForGmail: () => downloadDialog(ctx),
    /** Records that the filters on screen are now downloaded. */
    markDownloaded() {
      if (!ctx.file) return;
      const s = state.get();
      ctx.file.baseline = contentKey(s.filters, s.labelsById);
      state.set({ fileDirty: false });
    },
    onTierChange() {
      state.set({ journalVersion: state.get().journalVersion + 1 });
    },
    /** @param {string} id */
    setClientId(id) {
      prefs.set(KEYS.clientId, id.trim());
      location.hash = '#/overview';
      location.reload();
    },
    clearClientId() {
      prefs.remove(KEYS.clientId);
      location.hash = '#/setup';
      location.reload();
    },
    /** Leaves no sign-in mode and starts again. The beforeunload guard warns about changes. */
    leaveMode() {
      location.hash = '#/setup';
      location.reload();
    },
    applyAppearance: () => applyAppearance(prefs),
    showShortcuts,
  };

  // Warn before the tab closes or reloads with changes that are not downloaded yet.
  addEventListener('beforeunload', (event) => {
    if (ctx.mode !== 'file' || !state.get().fileDirty) return;
    event.preventDefault();
    event.returnValue = '';
  });

  setupShell(ctx);

  /** @type {null|{destroy?: () => void}} */
  let currentView = null;
  const viewRoot = /** @type {HTMLElement} */ (document.getElementById('view'));

  const router = startRouter((route) => {
    let name = route.name;
    let redirect = '';
    const m = ctx.mode;
    if (name === 'home' || name === 'not-found') redirect = m === 'setup' ? 'setup' : 'overview';
    else if (m === 'setup' && name !== 'setup' && name !== 'settings') redirect = 'setup';
    else if (name === 'setup' && m === 'demo') redirect = 'overview';
    if (redirect) {
      router.navigate(`#/${redirect}`, { replace: true });
      return;
    }
    // A new page closes dialogs that belong to the old one. A running change keeps its dialog.
    for (const d of document.querySelectorAll('dialog[open][data-dismissable="true"]')) {
      /** @type {HTMLDialogElement} */ (d).close();
    }
    currentView?.destroy?.();
    const view = VIEWS[name];
    const rendered = view.render(ctx, route.params);
    currentView = rendered;
    replace(viewRoot, rendered.el);
    document.title = `${rendered.title} - 3B Mailbox`;
    for (const link of document.querySelectorAll('.nav-link')) {
      const target = /** @type {HTMLElement} */ (link).dataset.route;
      const active = target === name || (target === 'filters' && name === 'editor');
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    document.body.dataset.route = name;
    const h1 = /** @type {HTMLElement|null} */ (viewRoot.querySelector('h1'));
    if (h1) {
      h1.setAttribute('tabindex', '-1');
      h1.focus({ preventScroll: true });
    }
    window.scrollTo({ top: 0 });
  });

  if (mode !== 'setup') ctx.reload();
  return ctx;
}

/**
 * Header status, sign in and out, banners, offline notice and shortcuts.
 * @param {any} ctx
 */
function setupShell(ctx) {
  const { state, prefs } = ctx;
  for (const el of document.querySelectorAll('[data-icon]')) {
    el.replaceWith(icon(/** @type {HTMLElement} */ (el).dataset.icon));
  }
  document.body.dataset.mode = state.get().mode;
  state.subscribe((s, changed) => {
    if (changed.has('mode')) document.body.dataset.mode = s.mode;
  });
  // The skip link must not change the hash, because the hash is the route.
  document.getElementById('skip-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('main')?.focus();
  });
  const status = /** @type {HTMLElement} */ (document.getElementById('auth-status'));
  const authArea = /** @type {HTMLElement} */ (document.getElementById('auth-action'));
  const banners = /** @type {HTMLElement} */ (document.getElementById('banners'));

  const STATUS = {
    demo: { text: 'Demo', icon: 'beaker', tone: 'info' },
    file: { text: 'No sign-in', icon: 'upload', tone: 'info' },
    'signed-in': { text: 'Signed in', icon: 'success', tone: 'success' },
    'signed-out': { text: 'Signed out', icon: 'user', tone: 'neutral' },
    expiring: { text: 'Session ending soon', icon: 'clock', tone: 'warning' },
    expired: { text: 'Signed out', icon: 'user', tone: 'neutral' },
  };

  function renderStatus() {
    const s = state.get();
    if (s.mode === 'setup') {
      replace(
        status,
        h(
          'span',
          { class: 'status-pill status-neutral' },
          icon('settings', { size: 16 }),
          h('span', { text: 'Not set up' }),
        ),
      );
      replace(authArea);
      return;
    }
    const info = STATUS[s.auth];
    replace(
      status,
      h(
        'span',
        { class: ['status-pill', `status-${info.tone}`] },
        icon(info.icon, { size: 16 }),
        h('span', { text: info.text }),
      ),
    );
    if (s.mode === 'demo' || s.mode === 'file') {
      replace(authArea);
    } else if (s.auth === 'signed-in' || s.auth === 'expiring') {
      replace(
        authArea,
        button({
          label: 'Sign out',
          variant: 'quiet',
          size: 'sm',
          icon: 'signout',
          onClick: () => ctx.signOut(),
        }),
      );
    } else {
      replace(
        authArea,
        button({
          label: 'Sign in',
          variant: 'primary',
          size: 'sm',
          icon: 'signin',
          onClick: () => ctx.signIn(),
        }),
      );
    }
  }

  function renderBanners() {
    const s = state.get();
    /** @type {HTMLElement[]} */
    const items = [];
    if (s.mode === 'demo') {
      items.push(
        h(
          'div',
          { class: 'banner banner-info' },
          icon('beaker'),
          h(
            'p',
            null,
            h('strong', { text: 'Demo account. ' }),
            'Changes stay in this tab. Nothing connects to Google. ',
            h('a', { href: './', class: 'banner-link' }, 'Leave the demo'),
          ),
        ),
      );
    }
    if (s.mode === 'file') items.push(fileBanner(ctx));
    if (!s.online) {
      items.push(
        h(
          'div',
          { class: 'banner banner-warning', role: 'status' },
          icon('wifiOff'),
          h(
            'p',
            null,
            h('strong', { text: 'You are offline. ' }),
            s.mode === 'demo' || s.mode === 'file'
              ? 'You can keep working. Nothing here needs the internet.'
              : 'You can look around, but 3B Mailbox cannot reach Gmail until you are back online.',
          ),
        ),
      );
    }
    if (s.auth === 'expiring') {
      items.push(
        h(
          'div',
          { class: 'banner banner-warning', role: 'status' },
          icon('clock'),
          h(
            'p',
            null,
            h('strong', { text: 'Your sign-in ends in a few minutes. ' }),
            'Your work is safe. Stay signed in to keep going.',
          ),
          button({
            label: 'Stay signed in',
            variant: 'primary',
            size: 'sm',
            onClick: () => ctx.signIn(),
          }),
        ),
      );
    }
    if (s.auth === 'expired') {
      items.push(
        h(
          'div',
          { class: 'banner banner-danger', role: 'alert' },
          icon('lock'),
          h(
            'p',
            null,
            h('strong', { text: 'Your sign-in has ended. ' }),
            'Nothing is lost. Changes are paused until you sign in again.',
          ),
          button({
            label: 'Sign in again',
            variant: 'primary',
            size: 'sm',
            onClick: () => ctx.signIn(),
          }),
        ),
      );
    }
    replace(banners, items);
  }

  renderStatus();
  renderBanners();
  state.subscribe((_s, changed) => {
    if (changed.has('auth') || changed.has('mode')) renderStatus();
    if (
      changed.has('auth') ||
      changed.has('online') ||
      changed.has('mode') ||
      changed.has('fileDirty') ||
      changed.has('fileName')
    ) {
      renderBanners();
    }
  });

  ctx.auth?.onChange?.((/** @type {any} */ e) => {
    if (ctx.mode !== 'google') return;
    if (e.type === 'signed-in') state.set({ auth: 'signed-in' });
    else if (e.type === 'expiring') state.set({ auth: 'expiring' });
    else if (e.type === 'expired') state.set({ auth: 'expired' });
    else if (e.type === 'signed-out') state.set({ auth: 'signed-out' });
  });

  addEventListener('online', () => state.set({ online: true }));
  addEventListener('offline', () => state.set({ online: false }));

  document.addEventListener('keydown', (e) => {
    if (prefs.get(PREFS.shortcuts, true) === false) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = /** @type {HTMLElement} */ (e.target);
    if (t.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (document.querySelector('dialog[open]')) return;
    if (e.key === '/') {
      e.preventDefault();
      if (!location.hash.startsWith('#/filters') || location.hash.startsWith('#/filters/')) {
        ctx.navigate('#/filters');
      }
      setTimeout(() => document.getElementById('filter-search')?.focus(), 0);
    } else if (e.key === 'n') {
      e.preventDefault();
      ctx.navigate('#/filters/new');
    } else if (e.key === '?') {
      e.preventDefault();
      showShortcuts();
    }
  });
}

/**
 * The banner for no sign-in mode: changes stay in this tab until the user downloads them.
 * @param {any} ctx
 */
function fileBanner(ctx) {
  const s = ctx.state.get();
  const warnings = ctx.file?.warnings ?? [];
  return h(
    'div',
    { class: 'banner banner-info banner-file' },
    icon('upload'),
    h(
      'p',
      null,
      h('strong', { text: 'No sign-in mode. ' }),
      'Your changes stay in this tab until you download them. ',
      s.fileDirty
        ? h('span', { class: 'banner-state', text: 'You have changes to download.' })
        : h('span', {
            class: 'banner-state',
            text: 'No changes since you opened or downloaded the file.',
          }),
      ' ',
      h(
        'a',
        {
          href: '../index.html#no-sign-in',
          class: 'banner-link',
          target: '_blank',
          rel: 'noopener',
        },
        'How to put them back in Gmail',
        h('span', { class: 'visually-hidden', text: ' (opens in a new tab)' }),
      ),
      ' ',
      h('a', { href: '#/setup', class: 'banner-link', text: 'Change mode' }),
    ),
    button({
      label: 'Download for Gmail',
      variant: 'primary',
      size: 'sm',
      icon: 'download',
      onClick: () => ctx.downloadForGmail(),
    }),
    warnings.length > 0 &&
      h(
        'details',
        { class: 'details banner-details' },
        h('summary', {
          text: `${warnings.length === 1 ? '1 thing' : `${warnings.length} things`} in your file to check`,
        }),
        h(
          'p',
          { class: 'muted' },
          '3B Mailbox could not keep these. Before you delete your filters in Gmail, note them down so you can set them up again.',
        ),
        h(
          'ul',
          { class: 'warning-list' },
          warnings.map((w) => h('li', { text: w })),
        ),
      ),
  );
}

/** The keyboard shortcuts dialog. */
export function showShortcuts() {
  const close = button({ label: 'Close', variant: 'primary' });
  const rows = [
    ['/', 'Search your filters'],
    ['n', 'Make a new filter'],
    ['?', 'Show this list'],
    ['Esc', 'Close a dialog or menu'],
  ];
  const d = openDialog({
    title: 'Keyboard shortcuts',
    size: 'sm',
    description:
      'Shortcuts do not work while you type in a field. You can turn them off in Settings.',
    content: h(
      'dl',
      { class: 'shortcut-list' },
      rows.map(([k, text]) =>
        h('div', { class: 'shortcut' }, h('dt', null, h('kbd', { text: k })), h('dd', { text })),
      ),
    ),
    footer: close,
  });
  close.addEventListener('click', () => d.close());
}
