// The app: shell, data source, session, banners, keyboard shortcuts and view switching.

import { analyse } from '../core/analyse.js';
import { createJournal } from '../core/journal.js';
import { KEYS, createStore, memoryStorage } from '../core/storage.js';
import { SCOPES, createAuth, validateClientId } from '../gmail/auth.js';
import { createGmailClient } from '../gmail/client.js';
import { createMockGmail, demoData } from '../gmail/mock.js';
import { openDialog } from './components/dialog.js';
import { announce, toast } from './components/toast.js';
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
 * @param {{demo: boolean, store?: import('../core/storage.js').Store}} opts
 */
export function startApp(opts) {
  const prefs = opts.store ?? createStore();
  applyAppearance(prefs);
  const clientId = prefs.get(KEYS.clientId, '');
  const demo = opts.demo;
  /** @type {'demo'|'google'|'setup'} */
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
    api = createMockGmail({ ...demoData(), latencyMs: 150 });
  } else if (mode === 'google') {
    auth = createAuth({ clientId });
    api = createGmailClient({ getToken: () => auth.getToken() });
  }

  const ctx = {
    mode,
    demo,
    state,
    prefs,
    journal,
    api,
    auth,
    clientId,
    /** Unsaved editor input, kept in memory so a sign-in or route change never loses it. */
    drafts: new Map(),
    /** @param {string} hash */
    navigate: (hash) => router.navigate(hash),
    canWrite() {
      if (!api) return false;
      if (demo) return true;
      return Boolean(auth?.getToken()) && state.get().online;
    },
    /** @param {PermissionTier} [tier] */
    async signIn(tier) {
      if (!auth) return false;
      if (demo) return true;
      try {
        const wanted = tier ?? prefs.get(KEYS.tierWanted, 'basic');
        await auth.signIn(SCOPES[wanted] ? wanted : 'basic');
        await ctx.reload();
        return true;
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), { tone: 'danger', timeout: 0 });
        return false;
      }
    },
    async signOut() {
      if (!auth || demo) return;
      await auth.signOut();
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
      if (!api || (!demo && !auth?.getToken())) {
        state.set({ status: 'idle' });
        return;
      }
      if (!o.quiet) state.set({ status: 'loading', error: '' });
      try {
        const [filters, labels, forwarding] = await Promise.all([
          api.listFilters(),
          api.listLabels(),
          api.listForwardingAddresses(),
        ]);
        const ids = new Set(filters.map((f) => f.id));
        const selection = new Set([...state.get().selection].filter((id) => ids.has(id)));
        state.set({
          status: 'ready',
          error: '',
          filters,
          labels,
          labelsById: new Map(labels.map((l) => [l.id, l])),
          forwarding,
          issues: analyse({ filters, labels, forwardingAddresses: forwarding }),
          selection,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (o.quiet && state.get().status === 'ready') toast(message, { tone: 'danger' });
        else state.set({ status: 'error', error: message });
      }
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
    applyAppearance: () => applyAppearance(prefs),
    showShortcuts,
  };

  setupShell(ctx);

  /** @type {null|{destroy?: () => void}} */
  let currentView = null;
  const viewRoot = /** @type {HTMLElement} */ (document.getElementById('view'));

  const router = startRouter((route) => {
    let name = route.name;
    let redirect = '';
    if (name === 'home' || name === 'not-found') redirect = mode === 'setup' ? 'setup' : 'overview';
    else if (mode === 'setup' && name !== 'setup' && name !== 'settings') redirect = 'setup';
    else if (mode !== 'setup' && name === 'setup' && mode === 'demo') redirect = 'overview';
    if (redirect) {
      router.navigate(`#/${redirect}`, { replace: true });
      return;
    }
    currentView?.destroy?.();
    const view = VIEWS[name];
    const rendered = view.render(ctx, route.params);
    currentView = rendered;
    replace(viewRoot, rendered.el);
    document.title = `${rendered.title} - Email Filter`;
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
    if (s.mode === 'demo') {
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
            s.mode === 'demo'
              ? 'The demo still works.'
              : 'You can look around, but Email Filter cannot reach Gmail until you are back online.',
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
    if (changed.has('auth') || changed.has('online')) renderBanners();
  });

  ctx.auth?.onChange?.((/** @type {any} */ e) => {
    if (ctx.demo) return;
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
