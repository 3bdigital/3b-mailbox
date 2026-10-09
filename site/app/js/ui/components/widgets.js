// Small shared building blocks: meters, chips, badges, fields, switches, segmented controls,
// empty, loading and error states.

import { h, nextId } from '../dom.js';
import { icon } from '../icons.js';

/** @typedef {import('../../types.js').Label} Label */

/* ------------------------------------------------------------------ meter */

const LEVEL_TEXT = {
  ok: '',
  warn: 'Getting close to the limit',
  danger: 'Nearly at the limit',
  full: 'At the limit',
};

/**
 * A labelled meter. Level is shown with colour, an icon and words.
 * @param {{label: string, value: number, max: number, level?: 'ok'|'warn'|'danger'|'full', valueText?: string, levelText?: string, compact?: boolean, hint?: string}} opts
 * @returns {HTMLElement}
 */
export function meter(opts) {
  const level = opts.level ?? 'ok';
  const levelText = opts.levelText ?? LEVEL_TEXT[level];
  const pct = Math.max(0, Math.min(100, (opts.value / Math.max(1, opts.max)) * 100));
  const labelId = nextId('meter');
  const valueText =
    opts.valueText ??
    `${opts.value.toLocaleString('en-GB')} of ${opts.max.toLocaleString('en-GB')}`;
  const fill = h('span', { class: 'meter-fill' });
  fill.style.setProperty('--fill', String(pct / 100));
  return h(
    'div',
    { class: ['meter', `meter-${level}`, opts.compact && 'meter-compact'] },
    h(
      'div',
      { class: 'meter-head' },
      h('span', { id: labelId, class: 'meter-label', text: opts.label }),
      h('span', { class: 'meter-value', text: valueText }),
    ),
    h(
      'div',
      {
        class: 'meter-track',
        role: 'meter',
        'aria-labelledby': labelId,
        'aria-valuemin': '0',
        'aria-valuemax': String(opts.max),
        'aria-valuenow': String(opts.value),
        'aria-valuetext': `${valueText}${levelText ? `. ${levelText}` : ''}`,
      },
      fill,
    ),
    (levelText || opts.hint) &&
      h(
        'p',
        { class: 'meter-note' },
        levelText && icon(level === 'warn' ? 'warning' : 'error', { size: 16 }),
        h('span', { text: [levelText, opts.hint].filter(Boolean).join('. ') }),
      ),
  );
}

/* ------------------------------------------------------------------ colour */

/** @param {string} hex */
function luminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '');
  if (!m) return null;
  const n = m[1];
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(n.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Contrast ratio of two hex colours, or 0 when one is not valid.
 * @param {string} a
 * @param {string} b
 */
export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return 0;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Picks a readable text colour for a Gmail label background. Uses Gmail's own text colour when it
 * reaches 7:1, otherwise near-black or white, whichever is better. Returns null when the
 * background is not usable, so the chip falls back to the design tokens.
 * @param {{textColor?: string, backgroundColor?: string}|undefined} color
 * @returns {{bg: string, fg: string}|null}
 */
export function readableLabelColour(color) {
  const bg = color?.backgroundColor;
  if (!bg || luminance(bg) === null) return null;
  if (color.textColor && contrastRatio(color.textColor, bg) >= 7)
    return { bg, fg: color.textColor };
  const dark = '#111318';
  const light = '#ffffff';
  const fg = contrastRatio(dark, bg) >= contrastRatio(light, bg) ? dark : light;
  if (contrastRatio(fg, bg) < 4.5) return null;
  return { bg, fg };
}

/* ------------------------------------------------------------------ chips and badges */

/**
 * A label chip. Uses the Gmail colour when it is readable.
 * @param {string} id
 * @param {Map<string, Label>} labelsById
 * @returns {HTMLElement}
 */
export function labelChip(id, labelsById) {
  const label = labelsById.get(id);
  const missing = !label && !id.startsWith('new:');
  const name = label?.name ?? (id.startsWith('new:') ? id.slice(4) : 'Missing label');
  const colour = readableLabelColour(label?.color);
  const chip = h(
    'span',
    { class: ['chip', 'chip-label', colour && 'chip-coloured', missing && 'chip-missing'] },
    icon(missing ? 'warning' : 'label', { size: 14 }),
    h('span', { class: 'chip-text', text: name }),
  );
  if (colour) {
    chip.style.setProperty('--chip-bg', colour.bg);
    chip.style.setProperty('--chip-fg', colour.fg);
  }
  return chip;
}

/**
 * A status badge with an icon and words, never colour alone.
 * @param {string} text
 * @param {'neutral'|'info'|'success'|'warning'|'danger'|'accent'} [tone]
 * @param {string} [iconName]
 */
export function badge(text, tone = 'neutral', iconName) {
  return h(
    'span',
    { class: ['badge', `badge-${tone}`] },
    iconName && icon(iconName, { size: 14 }),
    h('span', { text }),
  );
}

/* ------------------------------------------------------------------ fields */

/**
 * A labelled text field with optional hint and error. Returns the wrapper; the input is `.input`.
 * @param {{label: string, name?: string, value?: string, hint?: string|Node, type?: string, placeholder?: string, required?: boolean, autocomplete?: string, inputmode?: string, spellcheck?: boolean, multiline?: boolean, rows?: number, mono?: boolean, onInput?: (value: string) => void}} opts
 * @returns {HTMLElement & {input: HTMLInputElement, setError: (msg: string) => void}}
 */
export function textField(opts) {
  const id = nextId('field');
  const hintId = opts.hint ? `${id}-hint` : '';
  const errorId = `${id}-error`;
  const input = h(opts.multiline ? 'textarea' : 'input', {
    id,
    class: ['input', opts.mono && 'input-mono'],
    name: opts.name,
    type: opts.multiline ? undefined : (opts.type ?? 'text'),
    value: opts.value ?? '',
    placeholder: opts.placeholder,
    required: opts.required,
    autocomplete: opts.autocomplete ?? 'off',
    inputmode: opts.inputmode,
    spellcheck: opts.spellcheck === undefined ? undefined : String(opts.spellcheck),
    rows: opts.multiline ? String(opts.rows ?? 3) : undefined,
    'aria-describedby': hintId || undefined,
  });
  if (opts.onInput) input.addEventListener('input', () => opts.onInput(input.value));
  const error = h('p', { id: errorId, class: 'field-error', hidden: true });
  const wrap = /** @type {any} */ (
    h(
      'div',
      { class: 'field' },
      h('label', { for: id, class: 'field-label', text: opts.label }),
      opts.hint && h('p', { id: hintId, class: 'field-hint' }, opts.hint),
      error,
      input,
    )
  );
  wrap.input = input;
  wrap.setError = (/** @type {string} */ msg) => setFieldError(input, error, hintId, msg);
  return wrap;
}

/**
 * Shows or clears an error on an input, linked with aria-describedby and aria-invalid.
 * @param {HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement} input
 * @param {HTMLElement} errorEl
 * @param {string} hintId
 * @param {string} msg
 */
export function setFieldError(input, errorEl, hintId, msg) {
  errorEl.replaceChildren();
  if (msg) {
    errorEl.append(icon('error', { size: 16 }), h('span', { text: msg }));
    errorEl.hidden = false;
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', [errorEl.id, hintId].filter(Boolean).join(' '));
  } else {
    errorEl.hidden = true;
    input.removeAttribute('aria-invalid');
    if (hintId) input.setAttribute('aria-describedby', hintId);
    else input.removeAttribute('aria-describedby');
  }
}

/**
 * A native select with a visible label.
 * @param {{label: string, options: Array<{value: string, label: string, disabled?: boolean}>, value?: string, hint?: string|Node, onChange?: (value: string) => void, inline?: boolean}} opts
 * @returns {HTMLElement & {select: HTMLSelectElement}}
 */
export function selectField(opts) {
  const id = nextId('select');
  const hintId = opts.hint ? `${id}-hint` : undefined;
  const select = h(
    'select',
    { id, class: 'select', 'aria-describedby': hintId },
    opts.options.map((o) =>
      h('option', {
        value: o.value,
        disabled: o.disabled,
        selected: o.value === opts.value,
        text: o.label,
      }),
    ),
  );
  if (opts.value !== undefined) select.value = opts.value;
  if (opts.onChange) select.addEventListener('change', () => opts.onChange(select.value));
  const wrap = /** @type {any} */ (
    h(
      'div',
      { class: ['field', opts.inline && 'field-inline'] },
      h('label', { for: id, class: 'field-label', text: opts.label }),
      opts.hint && h('p', { id: hintId, class: 'field-hint' }, opts.hint),
      select,
    )
  );
  wrap.select = select;
  return wrap;
}

/**
 * A checkbox with a label and an optional hint. role=switch when `switch` is true.
 * @param {{label: string|Node, checked?: boolean, hint?: string|Node, switch?: boolean, disabled?: boolean, danger?: boolean, onChange?: (checked: boolean) => void, name?: string, value?: string}} opts
 * @returns {HTMLElement & {input: HTMLInputElement}}
 */
export function checkbox(opts) {
  const id = nextId('check');
  const hintId = opts.hint ? `${id}-hint` : undefined;
  const input = h('input', {
    id,
    type: 'checkbox',
    class: opts.switch ? 'switch-input' : 'checkbox-input',
    role: opts.switch ? 'switch' : undefined,
    checked: opts.checked,
    disabled: opts.disabled,
    name: opts.name,
    value: opts.value,
    'aria-describedby': hintId,
  });
  if (opts.onChange) input.addEventListener('change', () => opts.onChange(input.checked));
  const wrap = /** @type {any} */ (
    h(
      'div',
      { class: ['check', opts.switch && 'check-switch', opts.danger && 'check-danger'] },
      input,
      h(
        'div',
        { class: 'check-text' },
        h('label', { for: id, class: 'check-label' }, opts.label),
        opts.hint && h('p', { id: hintId, class: 'field-hint' }, opts.hint),
      ),
    )
  );
  wrap.input = input;
  return wrap;
}

/**
 * A segmented control built from radio buttons in a fieldset.
 * @param {{legend: string, name: string, options: Array<{value: string, label: string, icon?: string}>, value: string, onChange: (value: string) => void, hideLegend?: boolean}} opts
 * @returns {HTMLFieldSetElement}
 */
export function segmented(opts) {
  return h(
    'fieldset',
    { class: 'segmented' },
    h('legend', {
      class: ['segmented-legend', opts.hideLegend && 'visually-hidden'],
      text: opts.legend,
    }),
    h(
      'div',
      { class: 'segmented-options' },
      opts.options.map((o) => {
        const id = nextId('seg');
        const input = h('input', {
          type: 'radio',
          id,
          name: opts.name,
          value: o.value,
          checked: o.value === opts.value,
          class: 'segmented-input',
        });
        input.addEventListener('change', () => input.checked && opts.onChange(o.value));
        return h(
          'span',
          { class: 'segmented-option' },
          input,
          h(
            'label',
            { for: id, class: 'segmented-label' },
            o.icon && icon(o.icon, { size: 16 }),
            o.label,
          ),
        );
      }),
    ),
  );
}

/* ------------------------------------------------------------------ buttons */

/**
 * @param {{label: string, icon?: string, variant?: 'primary'|'secondary'|'quiet'|'danger', size?: 'sm'|'md'|'lg', onClick?: (e: MouseEvent) => void, type?: string, disabled?: boolean, href?: string, class?: string, describedBy?: string, ariaLabel?: string}} opts
 */
export function button(opts) {
  const cls = [
    'button',
    `button-${opts.variant ?? 'secondary'}`,
    opts.size && opts.size !== 'md' && `button-${opts.size}`,
    opts.class,
  ];
  const el = opts.href
    ? h('a', { class: cls, href: opts.href })
    : h('button', {
        type: opts.type ?? 'button',
        class: cls,
        disabled: opts.disabled,
        'aria-describedby': opts.describedBy,
      });
  if (opts.ariaLabel) el.setAttribute('aria-label', opts.ariaLabel);
  if (opts.icon) el.append(icon(opts.icon, { size: opts.size === 'sm' ? 16 : 20 }));
  el.append(h('span', { text: opts.label }));
  if (opts.onClick) el.addEventListener('click', opts.onClick);
  return el;
}

/**
 * An icon-only button. The label is required, for screen readers and as a tooltip.
 * @param {{label: string, icon: string, onClick?: (e: MouseEvent) => void, size?: 'sm'|'md'}} opts
 */
export function iconButton(opts) {
  const el = h(
    'button',
    {
      type: 'button',
      class: ['icon-button', opts.size === 'sm' && 'icon-button-sm'],
      'aria-label': opts.label,
      title: opts.label,
    },
    icon(opts.icon, { size: opts.size === 'sm' ? 16 : 20 }),
  );
  if (opts.onClick) el.addEventListener('click', opts.onClick);
  return el;
}

/* ------------------------------------------------------------------ states */

/**
 * @param {{title: string, text?: string, icon?: string, actions?: Node[], tone?: 'neutral'|'danger'|'success'}} opts
 */
export function emptyState(opts) {
  return h(
    'div',
    { class: ['empty', opts.tone && `empty-${opts.tone}`] },
    h('div', { class: 'empty-icon' }, icon(opts.icon ?? 'info', { size: 28 })),
    h('h2', { class: 'empty-title', text: opts.title }),
    opts.text && h('p', { class: 'empty-text', text: opts.text }),
    opts.actions?.length && h('div', { class: 'empty-actions' }, opts.actions),
  );
}

/**
 * Loading placeholder with a hidden status for screen readers.
 * @param {{rows?: number, kind?: 'cards'|'stats', label?: string}} [opts]
 */
export function skeleton(opts = {}) {
  const rows = opts.rows ?? 4;
  return h(
    'div',
    { class: ['skeleton-group', `skeleton-${opts.kind ?? 'cards'}`], role: 'status' },
    h('span', { class: 'visually-hidden', text: opts.label ?? 'Loading your filters' }),
    Array.from({ length: rows }, () =>
      h(
        'div',
        { class: 'skeleton-card', 'aria-hidden': 'true' },
        h('span', { class: 'skeleton-line skeleton-line-lg' }),
        h('span', { class: 'skeleton-line' }),
        h('span', { class: 'skeleton-line skeleton-line-sm' }),
      ),
    ),
  );
}

/**
 * A notice box with an icon.
 * @param {{tone?: 'info'|'success'|'warning'|'danger', title?: string, text?: string|Node, children?: Node[], role?: string}} opts
 */
export function notice(opts) {
  const tone = opts.tone ?? 'info';
  const iconName = { info: 'info', success: 'success', warning: 'warning', danger: 'error' }[tone];
  return h(
    'div',
    { class: ['notice', `notice-${tone}`], role: opts.role },
    icon(iconName),
    h(
      'div',
      { class: 'notice-body' },
      opts.title && h('p', { class: 'notice-title', text: opts.title }),
      opts.text && (typeof opts.text === 'string' ? h('p', { text: opts.text }) : opts.text),
      opts.children,
    ),
  );
}

/**
 * The view header: h1 (focus target on navigation), lead text and actions.
 * @param {{title: string, lead?: string, actions?: Node[]}} opts
 */
export function viewHeader(opts) {
  return h(
    'header',
    { class: 'view-header' },
    h(
      'div',
      { class: 'view-heading' },
      h('h1', { class: 'view-title', tabindex: '-1', text: opts.title }),
      opts.lead && h('p', { class: 'view-lead', text: opts.lead }),
    ),
    opts.actions?.length && h('div', { class: 'view-actions' }, opts.actions),
  );
}
