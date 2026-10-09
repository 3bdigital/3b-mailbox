// Shared view parts: the data gate (signed out, loading, error, ready), and journal helpers.

import { h, replace } from '../dom.js';
import { button, emptyState, skeleton } from '../components/widgets.js';

/**
 * Shows the right state for the account data, and calls render when the data is ready.
 * Re-renders when any of the watched state keys change.
 * @param {any} ctx
 * @param {{render: (state: any) => Node|Node[], watch?: string[], watchOnly?: string[], skeletonKind?: 'cards'|'stats', rows?: number}} opts
 * @returns {{el: HTMLElement, destroy: () => void, refresh: () => void}}
 */
export function dataGate(ctx, opts) {
  const el = h('div', { class: 'data-gate' });
  const watch = new Set(
    opts.watchOnly ?? [
      'status',
      'auth',
      'online',
      ...(opts.watch ?? ['filters', 'labels', 'issues', 'forwarding']),
    ],
  );
  let lastStatus = '';

  function draw() {
    const s = ctx.state.get();
    if (s.status === 'ready') {
      const out = opts.render(s);
      replace(el, out);
    } else if (s.status === 'loading') {
      if (lastStatus !== 'loading')
        replace(el, skeleton({ kind: opts.skeletonKind, rows: opts.rows }));
    } else if (s.status === 'error') {
      replace(
        el,
        emptyState({
          tone: 'danger',
          icon: s.online ? 'error' : 'wifiOff',
          title: s.online ? '3B Mailbox could not load your filters' : 'You are offline',
          text: s.online
            ? s.error
            : '3B Mailbox needs the internet to reach Gmail. Your data is safe. Try again when you are back online.',
          actions: [
            button({
              label: 'Try again',
              variant: 'primary',
              icon: 'undo',
              onClick: () => ctx.reload(),
            }),
          ],
        }),
      );
    } else if (ctx.mode === 'google') {
      replace(
        el,
        emptyState({
          icon: 'lock',
          title: 'Sign in to see your filters',
          text: '3B Mailbox asks Google for permission to manage your filters. Your data goes only between this browser and Google.',
          actions: [
            button({
              label: 'Sign in with Google',
              variant: 'primary',
              icon: 'signin',
              onClick: () => ctx.signIn(),
            }),
          ],
        }),
      );
    } else {
      replace(el, skeleton({ kind: opts.skeletonKind, rows: opts.rows }));
    }
    lastStatus = s.status;
  }

  draw();
  const unsub = ctx.state.subscribe((_s, changed) => {
    for (const k of changed) {
      if (watch.has(k)) {
        draw();
        return;
      }
    }
  });
  return { el, destroy: unsub, refresh: draw };
}
