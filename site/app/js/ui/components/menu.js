// Disclosure menu: a button that shows a list of actions. Escape and a click outside close it.
// Arrow keys move between the items. This is a disclosure, not an ARIA menu, so screen readers
// treat the items as normal buttons.

import { h, nextId } from '../dom.js';
import { icon } from '../icons.js';

/**
 * @typedef {object} MenuItem
 * @property {string} label
 * @property {string} [icon]
 * @property {() => void} onSelect
 * @property {boolean} [danger]
 * @property {boolean} [disabled]
 * @property {string} [href]
 */

/** @type {null|(() => void)} */
let openMenuClose = null;

/**
 * @param {{label: string, items: MenuItem[], buttonClass?: string, iconOnly?: boolean, buttonIcon?: string, align?: 'start'|'end', direction?: 'down'|'up'}} opts
 * @returns {HTMLElement}
 */
export function menuButton(opts) {
  const id = nextId('menu');
  const button = h(
    'button',
    {
      type: 'button',
      class: opts.buttonClass ?? (opts.iconOnly ? 'icon-button' : 'button button-secondary'),
      'aria-expanded': 'false',
      'aria-controls': id,
      'aria-label': opts.iconOnly ? opts.label : undefined,
    },
    opts.buttonIcon && icon(opts.buttonIcon),
    !opts.iconOnly && h('span', { text: opts.label }),
    !opts.iconOnly && icon('chevron', { size: 16, class: 'menu-chevron' }),
  );
  const list = h('ul', { class: 'menu-list', role: 'list' });
  const panel = h(
    'div',
    {
      id,
      class: ['menu-panel', `menu-${opts.align ?? 'end'}`, opts.direction === 'up' && 'menu-up'],
      hidden: true,
    },
    list,
  );
  const wrap = h('div', { class: 'menu' }, button, panel);

  const items = opts.items.map((item) => {
    const control = item.href
      ? h('a', { class: ['menu-item', item.danger && 'menu-item-danger'], href: item.href })
      : h('button', {
          type: 'button',
          class: ['menu-item', item.danger && 'menu-item-danger'],
          disabled: item.disabled,
        });
    if (item.icon) control.append(icon(item.icon));
    control.append(h('span', { text: item.label }));
    control.addEventListener('click', () => {
      close(false);
      item.onSelect();
    });
    list.append(h('li', null, control));
    return control;
  });

  /** @param {MouseEvent} event */
  const outside = (event) => {
    if (!wrap.contains(/** @type {Node} */ (event.target))) close(false);
  };

  function open() {
    openMenuClose?.();
    panel.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    document.addEventListener('mousedown', outside);
    openMenuClose = () => close(false);
    /** @type {HTMLElement|undefined} */ (items.find((i) => !i.disabled))?.focus();
  }

  /** @param {boolean} refocus */
  function close(refocus) {
    if (panel.hidden) return;
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', outside);
    if (openMenuClose) openMenuClose = null;
    if (refocus) button.focus();
  }

  button.addEventListener('click', () => (panel.hidden ? open() : close(true)));
  wrap.addEventListener('keydown', (event) => {
    if (panel.hidden) return;
    const enabled = items.filter((i) => !i.disabled);
    const index = enabled.indexOf(/** @type {any} */ (document.activeElement));
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      enabled[(index + 1) % enabled.length]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      enabled[(index - 1 + enabled.length) % enabled.length]?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      enabled[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      enabled[enabled.length - 1]?.focus();
    }
  });
  wrap.addEventListener('focusout', (event) => {
    const next = /** @type {Node|null} */ (event.relatedTarget);
    if (next && !wrap.contains(next)) close(false);
  });
  return wrap;
}
