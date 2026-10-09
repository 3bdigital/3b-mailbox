// Toasts and screen reader announcements.
// A toast with an action stays until the user closes it, so there is no time limit on acting.

import { h } from '../dom.js';
import { icon } from '../icons.js';

/**
 * Says something to screen reader users through the polite live region.
 * @param {string} text
 */
export function announce(text) {
  const region = document.getElementById('announcer');
  if (!region) return;
  region.textContent = '';
  // A short delay makes screen readers notice the same text twice in a row.
  setTimeout(() => {
    region.textContent = text;
  }, 50);
}

/**
 * @typedef {object} ToastOptions
 * @property {'info'|'success'|'warning'|'danger'} [tone]
 * @property {{label: string, onClick: () => void}} [action]
 * @property {number} [timeout]   Milliseconds. 0 keeps it open. Default 6000 without an action, 0 with one.
 */

const TONE_ICON = { info: 'info', success: 'success', warning: 'warning', danger: 'error' };

/**
 * Shows a toast.
 * @param {string} message
 * @param {ToastOptions} [opts]
 * @returns {() => void} Closes the toast.
 */
export function toast(message, opts = {}) {
  const region = document.getElementById('toasts');
  if (!region) return () => {};
  const tone = opts.tone ?? 'info';
  const timeout = opts.timeout ?? (opts.action ? 0 : 6000);
  /** @type {any} */
  let timer;
  const close = () => {
    clearTimeout(timer);
    el.classList.add('toast-leaving');
    setTimeout(() => el.remove(), 180);
  };
  const el = h(
    'div',
    { class: ['toast', `toast-${tone}`] },
    icon(TONE_ICON[tone]),
    h('p', { class: 'toast-message', text: message }),
    opts.action &&
      h('button', {
        type: 'button',
        class: 'button button-quiet button-sm toast-action',
        text: opts.action.label,
        on: {
          click: () => {
            close();
            opts.action.onClick();
          },
        },
      }),
    h(
      'button',
      {
        type: 'button',
        class: 'icon-button icon-button-sm',
        'aria-label': 'Close message',
        on: { click: close },
      },
      icon('close', { size: 16 }),
    ),
  );
  const start = () => {
    if (timeout > 0) timer = setTimeout(close, timeout);
  };
  el.addEventListener('mouseenter', () => clearTimeout(timer));
  el.addEventListener('focusin', () => clearTimeout(timer));
  el.addEventListener('mouseleave', start);
  region.append(el);
  start();
  return close;
}
