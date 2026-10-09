// Modal dialog on the native <dialog> element. showModal() makes the rest of the page inert, so focus
// stays inside. When the dialog closes, focus goes back to the element that opened it.

import { h, nextId, replace } from '../dom.js';
import { icon } from '../icons.js';

/**
 * @typedef {object} DialogOptions
 * @property {string} title
 * @property {string} [description]          Short text under the title.
 * @property {import('../dom.js').Child} [content]
 * @property {import('../dom.js').Child} [footer]
 * @property {'sm'|'md'|'lg'} [size]
 * @property {boolean} [dismissable]          Escape and the close button work. Default true.
 * @property {'heading'|'first'|HTMLElement} [initialFocus]  Default 'first'.
 * @property {(value: any) => void} [onClose]
 * @property {string} [tone]                  'danger' adds a red top edge.
 */

/**
 * @typedef {object} DialogHandle
 * @property {HTMLDialogElement} el
 * @property {HTMLElement} body
 * @property {HTMLElement} footer
 * @property {HTMLElement} heading
 * @property {(title: string) => void} setTitle
 * @property {(...nodes: import('../dom.js').Child[]) => void} setBody
 * @property {(...nodes: import('../dom.js').Child[]) => void} setFooter
 * @property {(on: boolean) => void} setDismissable
 * @property {(value?: any) => void} close
 * @property {Promise<any>} closed
 */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Opens a modal dialog.
 * @param {DialogOptions} opts
 * @returns {DialogHandle}
 */
export function openDialog(opts) {
  const returnTo = /** @type {HTMLElement|null} */ (document.activeElement);
  const titleId = nextId('dlg-title');
  const descId = opts.description ? nextId('dlg-desc') : undefined;
  let dismissable = opts.dismissable !== false;
  /** @type {(value: any) => void} */
  let resolveClosed = () => {};
  const closed = new Promise((resolve) => {
    resolveClosed = resolve;
  });
  let result;

  const heading = h('h2', { id: titleId, class: 'dialog-title', tabindex: '-1', text: opts.title });
  const closeButton = h(
    'button',
    {
      type: 'button',
      class: 'icon-button dialog-close',
      'aria-label': 'Close',
      on: { click: () => dismissable && handle.close() },
    },
    icon('close'),
  );
  const body = h('div', { class: 'dialog-body' });
  const footer = h('div', { class: 'dialog-footer' });
  const el = /** @type {HTMLDialogElement} */ (
    h(
      'dialog',
      {
        class: ['dialog', `dialog-${opts.size ?? 'md'}`, opts.tone && `dialog-${opts.tone}`],
        'aria-labelledby': titleId,
        'aria-describedby': descId,
      },
      h(
        'div',
        { class: 'dialog-header' },
        h(
          'div',
          { class: 'dialog-heading' },
          heading,
          opts.description &&
            h('p', { id: descId, class: 'dialog-description', text: opts.description }),
        ),
        closeButton,
      ),
      body,
      footer,
    )
  );

  el.addEventListener('cancel', (event) => {
    event.preventDefault();
    if (dismissable) handle.close();
  });
  el.addEventListener('close', () => {
    el.remove();
    if (returnTo && returnTo.isConnected) returnTo.focus();
    else /** @type {HTMLElement|null} */ (document.querySelector('main h1'))?.focus();
    opts.onClose?.(result);
    resolveClosed(result);
  });
  // A click on the backdrop (outside the dialog box) closes a dismissable dialog.
  el.addEventListener('mousedown', (event) => {
    if (event.target === el && dismissable) {
      const r = el.getBoundingClientRect();
      const inside =
        event.clientX >= r.left &&
        event.clientX <= r.right &&
        event.clientY >= r.top &&
        event.clientY <= r.bottom;
      if (!inside) handle.close();
    }
  });

  /** @type {DialogHandle} */
  const handle = {
    el,
    body,
    footer,
    heading,
    closed,
    setTitle(title) {
      heading.textContent = title;
    },
    setBody(...nodes) {
      replace(body, nodes);
    },
    setFooter(...nodes) {
      replace(footer, nodes);
      footer.hidden = footer.childElementCount === 0;
    },
    setDismissable(on) {
      dismissable = on;
      closeButton.disabled = !on;
    },
    close(value) {
      result = value;
      if (el.open) el.close();
    },
  };
  if (opts.content) handle.setBody(/** @type {any} */ (opts.content));
  handle.setFooter(.../** @type {any[]} */ ([opts.footer].flat()));
  handle.setDismissable(dismissable);

  document.body.append(el);
  el.showModal();
  const focusTarget =
    opts.initialFocus instanceof HTMLElement
      ? opts.initialFocus
      : opts.initialFocus === 'heading'
        ? heading
        : /** @type {HTMLElement|null} */ (
            body.querySelector(FOCUSABLE) ??
              /** @type {HTMLElement|null} */ (footer.querySelector(FOCUSABLE)) ??
              heading
          );
  focusTarget.focus();
  return handle;
}

/**
 * Asks a yes or no question.
 * @param {{title: string, message: string|Node, confirmLabel: string, cancelLabel?: string, danger?: boolean}} opts
 * @returns {Promise<boolean>}
 */
export function confirmDialog(opts) {
  const cancel = h('button', {
    type: 'button',
    class: 'button button-secondary',
    text: opts.cancelLabel ?? 'Cancel',
  });
  const ok = h('button', {
    type: 'button',
    class: ['button', opts.danger ? 'button-danger' : 'button-primary'],
    text: opts.confirmLabel,
  });
  const d = openDialog({
    title: opts.title,
    size: 'sm',
    content: typeof opts.message === 'string' ? h('p', { text: opts.message }) : opts.message,
    footer: [cancel, ok],
    initialFocus: cancel,
    tone: opts.danger ? 'danger' : undefined,
  });
  cancel.addEventListener('click', () => d.close(false));
  ok.addEventListener('click', () => d.close(true));
  return d.closed.then((v) => v === true);
}
