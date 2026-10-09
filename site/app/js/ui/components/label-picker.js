// Label picker: search labels, pick one or more, or make a new one. Picked labels show as chips.

import { h, nextId } from '../dom.js';
import { icon } from '../icons.js';
import { attachCombobox } from './combobox.js';
import { labelChip, readableLabelColour } from './widgets.js';

/** @typedef {import('../../types.js').Label} Label */

const RESERVED = new Set([
  'inbox',
  'spam',
  'trash',
  'bin',
  'unread',
  'starred',
  'important',
  'sent',
  'draft',
  'drafts',
  'chat',
  'chats',
  'all mail',
  'scheduled',
  'snoozed',
]);

/**
 * @param {{labels: Label[], labelsById: Map<string, Label>, selected?: string[], multiple?: boolean, label?: string, hint?: string, onChange: (ids: string[]) => void}} opts
 * @returns {HTMLElement & {getSelected: () => string[], input: HTMLInputElement}}
 */
export function labelPicker(opts) {
  const id = nextId('labels');
  const hintId = `${id}-hint`;
  /** @type {string[]} */
  let selected = [...(opts.selected ?? [])];
  const userLabels = opts.labels
    .filter((l) => l.type !== 'system')
    .sort((a, b) => a.name.localeCompare(b.name, 'en-GB'));
  const chips = h('ul', { class: 'chip-list picker-chips', 'aria-label': 'Chosen labels' });
  const input = h('input', {
    id,
    type: 'text',
    class: 'input',
    autocomplete: 'off',
    placeholder: 'Search or type a new label name',
    'aria-describedby': hintId,
  });

  /** @param {string} lid */
  const nameOf = (lid) =>
    opts.labelsById.get(lid)?.name ?? (lid.startsWith('new:') ? lid.slice(4) : lid);

  function renderChips() {
    chips.replaceChildren(
      ...selected.map((lid) =>
        h(
          'li',
          { class: 'picker-chip' },
          labelChip(lid, opts.labelsById),
          h(
            'button',
            {
              type: 'button',
              class: 'icon-button icon-button-sm',
              'aria-label': `Remove label ${nameOf(lid)}`,
              on: {
                click: () => {
                  selected = selected.filter((x) => x !== lid);
                  renderChips();
                  opts.onChange([...selected]);
                  input.focus();
                },
              },
            },
            icon('close', { size: 16 }),
          ),
        ),
      ),
    );
    chips.hidden = selected.length === 0;
  }

  /** @param {string} lid */
  function add(lid) {
    if (opts.multiple === false) selected = [lid];
    else if (!selected.includes(lid)) selected.push(lid);
    input.value = '';
    renderChips();
    opts.onChange([...selected]);
  }

  const combo = attachCombobox(input, {
    listLabel: 'Labels',
    openOnFocus: true,
    getOptions: (el) => {
      const q = el.value.trim();
      const lower = q.toLowerCase();
      const matches = userLabels
        .filter((l) => !selected.includes(l.id) && l.name.toLowerCase().includes(lower))
        .slice(0, 50)
        .map(
          (l) =>
            /** @type {import('./combobox.js').ComboOption} */ ({
              label: l.name,
              value: l.id,
              swatch: readableLabelColour(l.color)?.bg ?? '',
            }),
        );
      const exact = userLabels.some((l) => l.name.toLowerCase() === lower);
      const clean = q.replace(/\s*\/\s*/g, '/').replace(/^\/+|\/+$/g, '');
      if (clean && !exact) {
        const reserved = RESERVED.has(clean.toLowerCase());
        matches.unshift({
          label: `Make a new label "${clean}"`,
          value: `new:${clean}`,
          description: reserved
            ? 'Gmail keeps this name for itself. Choose another name.'
            : '3B Mailbox makes it when you save.',
          disabled: reserved,
          swatch: undefined,
        });
      }
      return matches;
    },
    onSelect: (o) => add(o.value),
  });

  renderChips();
  const wrap = /** @type {any} */ (
    h(
      'div',
      { class: 'field label-picker' },
      h('label', { for: id, class: 'field-label', text: opts.label ?? 'Labels' }),
      h('p', {
        id: hintId,
        class: 'field-hint',
        text: opts.hint ?? 'Type to search. Use / to nest a label, for example Finance/Bills.',
      }),
      chips,
      h('div', { class: 'combo' }, input, combo.list),
    )
  );
  wrap.getSelected = () => [...selected];
  wrap.input = input;
  return wrap;
}
