// Gmail search field with operator autocomplete (from OPERATORS).

import { OPERATORS } from '../../core/query.js';
import { h, nextId } from '../dom.js';
import { attachCombobox } from './combobox.js';

const WORD_OPERATORS = OPERATORS.filter((o) => /^[a-z_]+(:[a-z-]+)?$/.test(o.name));

/**
 * The word being typed just before the caret.
 * @param {string} text
 * @param {number} caret
 * @returns {{start: number, word: string}}
 */
export function currentWord(text, caret) {
  const before = text.slice(0, caret);
  const m = /(?:^|[\s({-])([a-z_:-]*)$/i.exec(before);
  const word = m ? m[1] : '';
  return { start: caret - word.length, word };
}

/**
 * Operator suggestions for a partial word.
 * @param {string} word
 * @returns {typeof OPERATORS}
 */
export function suggestOperators(word) {
  const w = word.toLowerCase();
  if (w.length < 1) return [];
  if (w.includes(':')) {
    const [name, rest] = w.split(':');
    if (name !== 'has') return [];
    return WORD_OPERATORS.filter((o) => o.name.startsWith(`has:${rest}`) && o.name !== w);
  }
  return WORD_OPERATORS.filter((o) => o.name.startsWith(w) && o.name !== w).slice(0, 8);
}

/**
 * A text field or textarea for Gmail search, with autocomplete.
 * @param {{label: string, value?: string, hint?: string, multiline?: boolean, onInput: (value: string) => void, describedBy?: string}} opts
 * @returns {HTMLElement & {input: HTMLInputElement|HTMLTextAreaElement, hintId: string, errorEl: HTMLElement}}
 */
export function queryEditor(opts) {
  const id = nextId('query');
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const input = h(opts.multiline ? 'textarea' : 'input', {
    id,
    class: ['input', 'input-mono'],
    type: opts.multiline ? undefined : 'text',
    rows: opts.multiline ? '4' : undefined,
    value: opts.value ?? '',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    'aria-describedby': [hintId, opts.describedBy].filter(Boolean).join(' '),
  });
  const combo = attachCombobox(input, {
    listLabel: 'Search operators',
    getOptions: (el) => {
      const { word } = currentWord(el.value, el.selectionStart ?? el.value.length);
      return suggestOperators(word).map((o) => ({
        label: o.name.includes(':') ? o.name : `${o.name}:`,
        description: o.description,
        badge: o.filterSafe ? undefined : 'Not for filters',
        value: o,
      }));
    },
    onSelect: (option) => {
      const o = option.value;
      const caret = input.selectionStart ?? input.value.length;
      const { start } = currentWord(input.value, caret);
      const insert = o.name.includes(':') ? `${o.name} ` : `${o.name}:`;
      input.value = input.value.slice(0, start) + insert + input.value.slice(caret);
      const pos = start + insert.length;
      input.setSelectionRange(pos, pos);
      input.focus();
      opts.onInput(input.value);
    },
  });
  input.addEventListener('input', () => opts.onInput(input.value));
  const errorEl = h('p', { id: errorId, class: 'field-error', hidden: true });
  const wrap = /** @type {any} */ (
    h(
      'div',
      { class: 'field field-query' },
      h('label', { for: id, class: 'field-label', text: opts.label }),
      h('p', {
        id: hintId,
        class: 'field-hint',
        text:
          opts.hint ??
          'Gmail search words. Start typing an operator such as from: or has: to see suggestions.',
      }),
      errorEl,
      h('div', { class: 'combo' }, input, combo.list),
    )
  );
  wrap.input = input;
  wrap.hintId = hintId;
  wrap.errorEl = errorEl;
  return wrap;
}
