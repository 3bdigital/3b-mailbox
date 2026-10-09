// #/suggestions: the template catalogue, grouped, with a region filter, options and multi-add.

import { planCreate } from '../../core/bulk.js';
import { TEMPLATES, TEMPLATE_GROUPS, instantiate, matchExisting } from '../../core/templates.js';
import { reviewAndRun } from '../components/plan-preview.js';
import { announce, toast } from '../components/toast.js';
import {
  badge,
  button,
  checkbox,
  notice,
  segmented,
  textField,
  viewHeader,
} from '../components/widgets.js';
import { h, plural, replace } from '../dom.js';
import { icon } from '../icons.js';
import { dataGate } from './common.js';

/** @typedef {import('../../types.js').Template} Template */

/** @type {Record<string, {text: string, tone: 'success'|'warning'|'danger', icon: string}>} */
const RISK = {
  low: { text: 'Low risk', tone: 'success', icon: 'success' },
  medium: { text: 'Medium risk', tone: 'warning', icon: 'warning' },
  high: { text: 'Take care', tone: 'danger', icon: 'warning' },
};

/**
 * @param {Template} t
 * @param {'all'|'global'|'uk'} region
 */
export function inRegion(t, region) {
  const regions = t.regions ?? [];
  if (region === 'global') return regions.length === 0;
  if (region === 'uk') return regions.includes('GB');
  return true;
}

/**
 * @param {any} ctx
 */
export function render(ctx) {
  ctx.suggestionsUi ??= { region: 'all', values: {}, selected: new Set() };
  const ui = ctx.suggestionsUi;

  const addSelected = button({ label: 'Add', variant: 'primary', icon: 'plus', size: 'sm' });
  const selectedText = h('p', { class: 'bulk-count' });
  const bar = h(
    'div',
    { class: 'bulk-bar', role: 'region', 'aria-label': 'Chosen suggestions', hidden: true },
    selectedText,
    h(
      'div',
      { class: 'bulk-actions' },
      addSelected,
      button({
        label: 'Clear',
        variant: 'quiet',
        size: 'sm',
        ariaLabel: 'Clear chosen suggestions',
        onClick: () => {
          ui.selected.clear();
          gate.refresh();
          syncBar();
        },
      }),
    ),
  );

  function syncBar() {
    const n = ui.selected.size;
    bar.hidden = n === 0;
    document.body.classList.toggle('has-bulk-bar', n > 0);
    selectedText.textContent = `${plural(n, 'suggestion')} chosen`;
    replace(
      addSelected,
      icon('plus', { size: 16 }),
      h('span', { text: `Add ${plural(n, 'filter')}` }),
    );
  }

  /** @param {Template[]} list */
  function add(list) {
    const s = ctx.state.get();
    const filters = [];
    /** @type {string[]} */
    const labels = [];
    for (const t of list) {
      try {
        const made = instantiate(t, ui.values[t.id] ?? {}, s.labels);
        filters.push(made.filter);
        labels.push(...made.labelsToCreate);
      } catch (err) {
        toast(`${t.name}: ${err.message}`, { tone: 'danger' });
        return;
      }
    }
    let plan;
    try {
      plan = planCreate(filters, labels, {
        total: s.filters.length,
        labelCount: s.labels.filter((l) => l.type === 'user').length,
      });
    } catch (err) {
      toast(err.message, { tone: 'danger' });
      return;
    }
    plan = {
      ...plan,
      title:
        list.length === 1
          ? `Add "${list[0].name}"`
          : `Add ${plural(list.length, 'suggested filter')}`,
    };
    reviewAndRun(ctx, plan, { confirmLabel: `Create ${plural(list.length, 'filter')}` }).then(
      (r) => {
        if (r.ok) {
          for (const t of list) ui.selected.delete(t.id);
          syncBar();
        }
      },
    );
  }

  addSelected.addEventListener('click', () => add(TEMPLATES.filter((t) => ui.selected.has(t.id))));

  /**
   * @param {Template} t
   * @param {any} s
   */
  function card(t, s) {
    const existing = matchExisting(t, s.filters);
    const risk = RISK[t.risk] ?? RISK.low;
    ui.values[t.id] ??= {};
    const values = ui.values[t.id];
    const choose = checkbox({
      label: h('span', null, h('span', { class: 'visually-hidden', text: 'Choose ' }), t.name),
      checked: ui.selected.has(t.id) && !existing,
      disabled: Boolean(existing),
      onChange: (v) => {
        if (v) ui.selected.add(t.id);
        else ui.selected.delete(t.id);
        syncBar();
        announce(`${plural(ui.selected.size, 'suggestion')} chosen`);
      },
    });
    choose.classList.add('template-choose');
    const optionFields = (t.options ?? []).map((o) => {
      if (o.type === 'boolean') {
        return checkbox({
          label: o.label,
          hint: o.help,
          checked: values[o.key] ?? o.default,
          onChange: (v) => (values[o.key] = v),
        });
      }
      return textField({
        label: o.label,
        hint: o.help,
        value: values[o.key] ?? o.default ?? '',
        spellcheck: false,
        onInput: (v) => (values[o.key] = v),
      });
    });
    return h(
      'li',
      { class: ['template-card', existing && 'is-existing'] },
      h('div', { class: 'template-head' }, h('h3', { class: 'template-name' }, choose)),
      h('p', { class: 'template-desc', text: t.description }),
      h(
        'ul',
        { class: 'chip-list', 'aria-label': 'About this suggestion' },
        h('li', null, badge(risk.text, risk.tone, risk.icon)),
        (t.regions ?? []).includes('GB') && h('li', null, badge('UK', 'neutral')),
        existing && h('li', null, badge('You already have this', 'success', 'check')),
      ),
      h(
        'details',
        { class: 'details' },
        h('summary', { text: 'Why this is good practice' }),
        h('p', { text: t.rationale }),
        t.cautions?.length > 0 &&
          notice({
            tone: 'warning',
            title: 'Before you add it',
            children: [
              h(
                'ul',
                null,
                t.cautions.map((c) => h('li', { text: c })),
              ),
            ],
          }),
      ),
      optionFields.length > 0 &&
        h(
          'details',
          { class: 'details' },
          h('summary', { text: 'Change options' }),
          h('div', { class: 'template-options' }, optionFields),
        ),
      h(
        'div',
        { class: 'template-foot' },
        existing
          ? h(
              'a',
              {
                class: 'button button-quiet button-sm',
                href: `#/filters/${encodeURIComponent(existing.id)}`,
              },
              h('span', { text: 'Open your filter' }),
            )
          : button({
              label: 'Add',
              ariaLabel: `Add ${t.name}`,
              size: 'sm',
              icon: 'plus',
              onClick: () => add([t]),
            }),
      ),
    );
  }

  const gate = dataGate(ctx, {
    watch: ['filters', 'labels'],
    render: (s) => {
      const visible = TEMPLATES.filter((t) => inRegion(t, ui.region));
      return TEMPLATE_GROUPS.map((g, i) => {
        const list = visible.filter((t) => t.group === g);
        if (list.length === 0) return null;
        return h(
          'section',
          { class: 'template-group', 'aria-labelledby': `tg-${i}` },
          h(
            'h2',
            { id: `tg-${i}`, class: 'group-title' },
            h('span', { text: g }),
            h('span', { class: 'group-count', text: plural(list.length, 'suggestion') }),
          ),
          h(
            'ul',
            { class: 'template-grid' },
            list.map((t) => card(t, s)),
          ),
        );
      });
    },
  });

  const region = segmented({
    legend: 'Show suggestions for',
    name: 'region',
    value: ui.region,
    options: [
      { value: 'all', label: 'All' },
      { value: 'global', label: 'Global' },
      { value: 'uk', label: 'UK' },
    ],
    onChange: (v) => {
      ui.region = v;
      gate.refresh();
    },
  });

  syncBar();
  const el = h(
    'div',
    { class: 'view-suggestions' },
    viewHeader({
      title: 'Suggestions',
      lead: 'Ready-made filters based on good practice. Each one adds a label. You choose if it also skips the inbox.',
    }),
    h('div', { class: 'toolbar' }, region),
    gate.el,
    bar,
  );
  return {
    el,
    title: 'Suggestions',
    destroy() {
      gate.destroy();
      document.body.classList.remove('has-bulk-bar');
    },
  };
}
