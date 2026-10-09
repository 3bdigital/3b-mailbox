// ARIA 1.2 combobox with a listbox popup, for an input or textarea.
// Keys: Down and Up move (and open), Enter picks the active option, Escape closes, Tab leaves.

import { h, nextId } from '../dom.js';

/**
 * @typedef {object} ComboOption
 * @property {string} label
 * @property {string} [description]
 * @property {string} [badge]
 * @property {boolean} [disabled]
 * @property {any} [value]
 * @property {string} [swatch]   A colour for a small swatch.
 */

/**
 * @param {HTMLInputElement|HTMLTextAreaElement} input
 * @param {{getOptions: (input: HTMLInputElement|HTMLTextAreaElement) => ComboOption[], onSelect: (option: ComboOption) => void, listLabel: string, openOnFocus?: boolean}} opts
 * @returns {{list: HTMLElement, refresh: () => void, close: () => void}}
 */
export function attachCombobox(input, opts) {
  const listId = nextId('listbox');
  const status = h('span', { class: 'visually-hidden', role: 'status' });
  const list = h('ul', {
    id: listId,
    role: 'listbox',
    class: 'listbox',
    'aria-label': opts.listLabel,
    hidden: true,
  });
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', listId);
  /** @type {ComboOption[]} */
  let options = [];
  let active = -1;

  function close() {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  }

  /** @param {number} i */
  function setActive(i) {
    active = i;
    [...list.children].forEach((li, j) => li.setAttribute('aria-selected', String(j === i)));
    if (i >= 0) {
      const el = /** @type {HTMLElement} */ (list.children[i]);
      input.setAttribute('aria-activedescendant', el.id);
      el.scrollIntoView?.({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  }

  /** @param {ComboOption} o */
  function pick(o) {
    if (o.disabled) return;
    close();
    opts.onSelect(o);
  }

  function refresh() {
    options = opts.getOptions(input);
    list.replaceChildren(
      ...options.map((o, i) => {
        const li = h(
          'li',
          {
            id: `${listId}-${i}`,
            role: 'option',
            class: ['option', o.disabled && 'option-disabled'],
            'aria-selected': 'false',
            'aria-disabled': o.disabled ? 'true' : undefined,
          },
          o.swatch !== undefined && h('span', { class: 'option-swatch', 'aria-hidden': 'true' }),
          h(
            'span',
            { class: 'option-main' },
            h('span', { class: 'option-label', text: o.label }),
            o.description && h('span', { class: 'option-desc', text: o.description }),
          ),
          o.badge && h('span', { class: 'option-badge', text: o.badge }),
        );
        if (o.swatch) li.querySelector('.option-swatch').style.setProperty('--swatch', o.swatch);
        li.addEventListener('mousedown', (e) => e.preventDefault());
        li.addEventListener('click', () => pick(o));
        return li;
      }),
    );
    if (options.length === 0) {
      close();
      return;
    }
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    setActive(-1);
    status.textContent = `${options.length} suggestion${options.length === 1 ? '' : 's'}. Use the arrow keys to choose.`;
  }

  input.addEventListener('input', refresh);
  if (opts.openOnFocus) input.addEventListener('focus', refresh);
  input.addEventListener('blur', () => setTimeout(close, 100));
  input.addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => {
    const open = !list.hidden;
    if (e.key === 'ArrowDown') {
      if (!open) refresh();
      if (options.length === 0) return;
      e.preventDefault();
      setActive((active + 1) % options.length);
    } else if (e.key === 'ArrowUp' && open) {
      e.preventDefault();
      setActive(active <= 0 ? options.length - 1 : active - 1);
    } else if (e.key === 'Enter' && open && active >= 0) {
      e.preventDefault();
      pick(options[active]);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') close();
  });

  const wrap = h('div', { class: 'combo-popup' }, list, status);
  return { list: wrap, refresh, close };
}
