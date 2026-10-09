// #/filters: search, sort, group, select, bulk changes and export.

import { CATEGORIES, isRisky, toFriendly } from '../../core/actions.js';
import { toGmailXml, toJson } from '../../core/backup.js';
import { planAddAction, planDelete, planRemoveAction, planReplaceLabel } from '../../core/bulk.js';
import { criteriaLength } from '../../core/limits.js';
import { describeFilter, groupFilters } from '../../core/summarise.js';
import { openDialog } from '../components/dialog.js';
import { filterCard } from '../components/filter-card.js';
import { labelPicker } from '../components/label-picker.js';
import { showMatches } from '../components/matches.js';
import { menuButton } from '../components/menu.js';
import { reviewAndRun } from '../components/plan-preview.js';
import { announce, toast } from '../components/toast.js';
import {
  button,
  checkbox,
  emptyState,
  notice,
  selectField,
  viewHeader,
} from '../components/widgets.js';
import { debounce, download, h, plural, replace } from '../dom.js';
import { icon } from '../icons.js';
import { dataGate } from './common.js';

/** @typedef {import('../../types.js').Filter} Filter */

const PAGE = 100;

const CATEGORY_LABELS = {
  CATEGORY_PERSONAL: 'Primary',
  CATEGORY_SOCIAL: 'Social',
  CATEGORY_PROMOTIONS: 'Promotions',
  CATEGORY_UPDATES: 'Updates',
  CATEGORY_FORUMS: 'Forums',
};

/** Search text for each filter, cached by the filters array. */
const indexCache = new WeakMap();

/**
 * @param {Filter[]} filters
 * @param {Map<string, any>} labelsById
 * @returns {Map<string, {when: string, then: string, search: string}>}
 */
function searchIndex(filters, labelsById) {
  const hit = indexCache.get(filters);
  if (hit && hit.labelsById === labelsById) return hit.map;
  const map = new Map();
  for (const f of filters) {
    const d = describeFilter(f, labelsById);
    const c = f.criteria ?? {};
    const labels = (f.action?.addLabelIds ?? []).map((id) => labelsById.get(id)?.name ?? '');
    map.set(f.id, {
      when: d.when,
      then: d.then,
      search: [
        d.text,
        c.from,
        c.to,
        c.subject,
        c.query,
        c.negatedQuery,
        f.action?.forward,
        ...labels,
      ]
        .filter(Boolean)
        .join(' \u0000 ')
        .toLowerCase(),
    });
  }
  indexCache.set(filters, { labelsById, map });
  return map;
}

/**
 * Filters that match a search. Every word must appear.
 * @param {Filter[]} filters
 * @param {string} query
 * @param {Map<string, any>} labelsById
 */
export function searchFilters(filters, query, labelsById) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return filters;
  const index = searchIndex(filters, labelsById);
  return filters.filter((f) => {
    const text = index.get(f.id)?.search ?? '';
    return words.every((w) => text.includes(w));
  });
}

/**
 * @param {Filter[]} filters
 * @param {'name'|'label'|'risk'|'length'} by
 * @param {Map<string, any>} labelsById
 */
export function sortFilters(filters, by, labelsById) {
  const index = searchIndex(filters, labelsById);
  const name = (f) => index.get(f.id)?.when.toLowerCase() ?? '';
  const label = (f) => {
    const ids = toFriendly(f.action).labelIds;
    return ids.length ? (labelsById.get(ids[0])?.name ?? '~').toLowerCase() : '￿';
  };
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const list = [...filters];
  if (by === 'label') list.sort((a, b) => cmp(label(a), label(b)) || cmp(name(a), name(b)));
  else if (by === 'risk') {
    list.sort(
      (a, b) =>
        isRisky(b.action).reasons.length - isRisky(a.action).reasons.length ||
        cmp(name(a), name(b)),
    );
  } else if (by === 'length') {
    list.sort(
      (a, b) => criteriaLength(b.criteria) - criteriaLength(a.criteria) || cmp(name(a), name(b)),
    );
  } else list.sort((a, b) => cmp(name(a), name(b)));
  return list;
}

/**
 * Runs a planner and shows its limit or plan error as a toast.
 * @param {() => any} make
 */
function safePlan(make) {
  try {
    return make();
  } catch (err) {
    toast(err instanceof Error ? err.message : String(err), { tone: 'danger' });
    return null;
  }
}

/**
 * @param {any} ctx
 */
export function render(ctx) {
  ctx.filtersUi ??= { query: '', sort: 'name', group: 'none', limit: PAGE };
  const ui = ctx.filtersUi;
  /** @type {string[]} Visible filter ids in order, for shift-click and select all. */
  let visibleIds = [];
  let lastClicked = -1;

  const search = h('input', {
    id: 'filter-search',
    type: 'search',
    class: 'input input-search',
    value: ui.query,
    autocomplete: 'off',
    'aria-describedby': 'filter-search-hint',
  });
  const searchField = h(
    'div',
    { class: 'field field-search' },
    h('label', { for: 'filter-search', class: 'field-label', text: 'Search filters' }),
    h('p', {
      id: 'filter-search-hint',
      class: 'visually-hidden',
      text: 'Matches senders, words, labels and summaries. Press / to come back here.',
    }),
    h('div', { class: 'search-wrap' }, icon('search', { class: 'search-icon' }), search),
  );
  const sort = selectField({
    label: 'Sort by',
    value: ui.sort,
    options: [
      { value: 'name', label: 'Name' },
      { value: 'label', label: 'Label' },
      { value: 'risk', label: 'Risk' },
      { value: 'length', label: 'Length' },
    ],
    onChange: (v) => {
      ui.sort = v;
      drawList();
    },
  });
  const group = selectField({
    label: 'Group by',
    value: ui.group,
    options: [
      { value: 'none', label: 'No groups' },
      { value: 'action', label: 'Action' },
      { value: 'label', label: 'Label' },
      { value: 'domain', label: 'Sender domain' },
      { value: 'risk', label: 'Risk' },
    ],
    onChange: (v) => {
      ui.group = v;
      ui.limit = PAGE;
      drawList();
    },
  });
  const resultCount = h('p', { class: 'result-count', role: 'status' });
  const selectAll = h('input', { type: 'checkbox', id: 'select-all', class: 'checkbox-input' });
  const selectAllLabel = h('label', { for: 'select-all', class: 'check-label' });
  const listArea = h('div', { class: 'filter-list-area' });

  search.addEventListener(
    'input',
    debounce(() => {
      ui.query = search.value;
      ui.limit = PAGE;
      drawList();
    }, 120),
  );

  // Bulk bar
  const selectedCount = h('p', { class: 'bulk-count' });
  const deleteButton = button({ label: 'Delete', variant: 'danger', icon: 'trash', size: 'sm' });
  const clearButton = button({
    label: 'Clear',
    variant: 'quiet',
    size: 'sm',
    class: 'bulk-clear',
    ariaLabel: 'Clear selection',
    onClick: () => {
      setSelection(new Set());
      search.focus();
    },
  });
  const bulkBar = h(
    'div',
    { class: 'bulk-bar', role: 'region', 'aria-label': 'Selected filters', hidden: true },
    selectedCount,
    clearButton,
    h(
      'div',
      { class: 'bulk-actions' },
      button({
        label: 'Change label',
        icon: 'tag',
        size: 'sm',
        onClick: () => changeLabelDialog(),
      }),
      menuButton({
        label: 'More actions',
        buttonClass: 'button button-secondary button-sm',
        direction: 'up',
        items: [
          { label: 'Add an action', icon: 'plus', onSelect: () => addActionDialog() },
          { label: 'Remove an action', icon: 'close', onSelect: () => removeActionDialog() },
          { label: 'Duplicate', icon: 'copy', onSelect: () => duplicate(selectedFilters()) },
          { label: 'Export as a JSON backup', icon: 'download', onSelect: () => exportJson() },
          { label: 'Export for Gmail (XML)', icon: 'download', onSelect: () => exportXml() },
        ],
      }),
      deleteButton,
    ),
  );
  deleteButton.addEventListener('click', () => {
    const list = selectedFilters();
    const plan = safePlan(() => planDelete(list, { total: ctx.state.get().filters.length }));
    if (plan) reviewAndRun(ctx, plan);
  });

  function selectedFilters() {
    const sel = ctx.state.get().selection;
    return ctx.state.get().filters.filter((f) => sel.has(f.id));
  }

  /** @param {Set<string>} next */
  function setSelection(next) {
    ctx.state.set({ selection: next });
  }

  function syncSelection() {
    const sel = ctx.state.get().selection;
    for (const input of listArea.querySelectorAll('.card-check')) {
      const on = sel.has(/** @type {HTMLInputElement} */ (input).dataset.id);
      /** @type {HTMLInputElement} */ (input).checked = on;
      input.closest('.filter-card')?.classList.toggle('is-selected', on);
    }
    const n = sel.size;
    bulkBar.hidden = n === 0;
    document.body.classList.toggle('has-bulk-bar', n > 0);
    selectedCount.textContent = `${n.toLocaleString('en-GB')} selected`;
    replace(
      deleteButton,
      icon('trash', { size: 16 }),
      h('span', null, 'Delete', h('span', { class: 'wide-only', text: ` ${plural(n, 'filter')}` })),
    );
    const visibleSelected = visibleIds.filter((id) => sel.has(id)).length;
    selectAll.checked = visibleIds.length > 0 && visibleSelected === visibleIds.length;
    selectAll.indeterminate = visibleSelected > 0 && visibleSelected < visibleIds.length;
  }

  selectAll.addEventListener('change', () => {
    const sel = new Set(ctx.state.get().selection);
    if (selectAll.checked) for (const id of visibleIds) sel.add(id);
    else for (const id of visibleIds) sel.delete(id);
    setSelection(sel);
    announce(`${sel.size} selected`);
  });

  /**
   * @param {Filter} filter
   * @param {boolean} checked
   * @param {MouseEvent|Event} event
   */
  function onToggle(filter, checked, event) {
    const sel = new Set(ctx.state.get().selection);
    const index = visibleIds.indexOf(filter.id);
    if (/** @type {MouseEvent} */ (event).shiftKey && lastClicked >= 0 && index >= 0) {
      const [a, b] = [Math.min(lastClicked, index), Math.max(lastClicked, index)];
      for (const id of visibleIds.slice(a, b + 1)) {
        if (checked) sel.add(id);
        else sel.delete(id);
      }
    } else if (checked) sel.add(filter.id);
    else sel.delete(filter.id);
    lastClicked = index;
    setSelection(sel);
    announce(`${sel.size} selected`);
  }

  /**
   * @param {'edit'|'duplicate'|'delete'|'matches'} action
   * @param {Filter} filter
   */
  function onAction(action, filter) {
    if (action === 'edit') ctx.navigate(`#/filters/${encodeURIComponent(filter.id)}`);
    else if (action === 'duplicate') duplicate([filter]);
    else if (action === 'matches') showMatches(ctx, filter.criteria);
    else {
      const plan = safePlan(() => planDelete([filter], { total: ctx.state.get().filters.length }));
      if (plan) reviewAndRun(ctx, plan);
    }
  }

  /** @param {Filter[]} list */
  function duplicate(list) {
    if (list.length === 1) {
      ctx.drafts.set('new', {
        criteria: structuredClone(list[0].criteria ?? {}),
        action: structuredClone(list[0].action ?? {}),
        copiedFrom: list[0].id,
      });
      ctx.navigate('#/filters/new');
      return;
    }
    const close = button({ label: 'Close', variant: 'primary' });
    const d = openDialog({
      title: 'Choose one filter to duplicate',
      size: 'sm',
      content: h('p', {
        text: 'Gmail does not allow two filters that are exactly the same. Email Filter opens the copy so you can change it before you save. Select one filter, then choose Duplicate.',
      }),
      footer: close,
    });
    close.addEventListener('click', () => d.close());
  }

  function exportJson() {
    const s = ctx.state.get();
    const list = selectedFilters();
    download(
      `email-filter-backup-${new Date().toISOString().slice(0, 10)}.json`,
      toJson(list, s.labels),
      'application/json',
    );
    toast(`Downloaded a backup of ${plural(list.length, 'filter')}.`, { tone: 'success' });
  }

  function exportXml() {
    const s = ctx.state.get();
    const list = selectedFilters();
    download('mailFilters.xml', toGmailXml(list, s.labelsById), 'application/xml');
    toast(
      `Downloaded ${plural(list.length, 'filter')} for Gmail. Gmail import adds filters. It does not delete the ones you have.`,
      { tone: 'success' },
    );
  }

  function changeLabelDialog() {
    const s = ctx.state.get();
    const list = selectedFilters();
    /** @type {Map<string, number>} */
    const used = new Map();
    for (const f of list)
      for (const id of toFriendly(f.action).labelIds) used.set(id, (used.get(id) ?? 0) + 1);
    const cancel = button({ label: 'Cancel', variant: 'secondary' });
    const next = button({ label: 'Review the change', variant: 'primary' });
    if (used.size === 0) {
      const d = openDialog({
        title: 'Change label',
        size: 'sm',
        content: h('p', {
          text: 'None of the selected filters applies a label. To add one, choose More actions, then Add an action.',
        }),
        footer: cancel,
      });
      cancel.addEventListener('click', () => d.close());
      return;
    }
    const from = selectField({
      label: 'Change this label',
      options: [...used].map(([id, n]) => ({
        value: id,
        label: `${s.labelsById.get(id)?.name ?? 'Missing label'} (${plural(n, 'filter')})`,
      })),
    });
    /** @type {string[]} */
    let to = [];
    const error = h('p', { class: 'field-error', id: 'to-label-error', hidden: true });
    const picker = labelPicker({
      labels: s.labels,
      labelsById: s.labelsById,
      multiple: false,
      label: 'To this label',
      hint: 'Search, or type a name to make a new label.',
      onChange: (ids) => {
        to = ids;
        error.hidden = true;
      },
    });
    const d = openDialog({
      title: 'Change label',
      description: `For ${plural(list.length, 'selected filter')}. Filters without this label stay as they are.`,
      size: 'md',
      content: [from, picker, error],
      footer: [cancel, next],
    });
    cancel.addEventListener('click', () => d.close());
    next.addEventListener('click', () => {
      if (to.length === 0) {
        error.replaceChildren(
          icon('error', { size: 16 }),
          h('span', { text: 'Choose the new label.' }),
        );
        error.hidden = false;
        picker.input.setAttribute('aria-describedby', 'to-label-error');
        picker.input.focus();
        return;
      }
      const target = to[0].startsWith('new:') ? { newLabelName: to[0].slice(4) } : to[0];
      const plan = safePlan(() =>
        planReplaceLabel(list, from.select.value, target, {
          total: s.filters.length,
          labelCount: s.labels.filter((l) => l.type === 'user').length,
        }),
      );
      if (!plan) return;
      d.close();
      d.closed.then(() => reviewAndRun(ctx, plan));
    });
  }

  function addActionDialog() {
    const s = ctx.state.get();
    const list = selectedFilters();
    const archive = checkbox({ label: 'Skip the inbox (archive)' });
    const markRead = checkbox({ label: 'Mark as read' });
    const star = checkbox({ label: 'Star it' });
    const neverSpam = checkbox({ label: 'Never send it to spam' });
    const trash = checkbox({ label: 'Delete it', danger: true, hint: 'Mail goes to the Bin.' });
    const important = selectField({
      label: 'Importance',
      options: [
        { value: '', label: 'No change' },
        { value: 'always', label: 'Always mark as important' },
        { value: 'never', label: 'Never mark as important' },
      ],
    });
    const category = selectField({
      label: 'Category',
      options: [
        { value: '', label: 'No change' },
        ...CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] })),
      ],
    });
    /** @type {string[]} */
    let labelIds = [];
    const picker = labelPicker({
      labels: s.labels,
      labelsById: s.labelsById,
      label: 'Add labels',
      onChange: (ids) => (labelIds = ids),
    });
    const forward = selectField({
      label: 'Forward to',
      options: [
        { value: '', label: 'No change' },
        ...s.forwarding.map((a) => ({
          value: a.forwardingEmail,
          label:
            a.verificationStatus === 'accepted'
              ? a.forwardingEmail
              : `${a.forwardingEmail} (not verified yet)`,
          disabled: a.verificationStatus !== 'accepted',
        })),
      ],
    });
    const cancel = button({ label: 'Cancel', variant: 'secondary' });
    const next = button({ label: 'Review the change', variant: 'primary' });
    const d = openDialog({
      title: 'Add an action',
      description: `To ${plural(list.length, 'selected filter')}.`,
      size: 'md',
      content: [
        h(
          'fieldset',
          { class: 'fieldset' },
          h('legend', { text: 'Actions' }),
          archive,
          markRead,
          star,
          neverSpam,
          trash,
        ),
        picker,
        h('div', { class: 'field-row' }, important, category),
        forward,
      ],
      footer: [cancel, next],
    });
    cancel.addEventListener('click', () => d.close());
    next.addEventListener('click', () => {
      /** @type {any} */
      const patch = {
        archive: archive.input.checked,
        markRead: markRead.input.checked,
        star: star.input.checked,
        neverSpam: neverSpam.input.checked,
        trash: trash.input.checked,
        labelIds,
      };
      if (important.select.value) patch.important = important.select.value;
      if (category.select.value) patch.category = category.select.value;
      if (forward.select.value) patch.forward = forward.select.value;
      const plan = safePlan(() =>
        planAddAction(list, patch, {
          total: s.filters.length,
          labelCount: s.labels.filter((l) => l.type === 'user').length,
        }),
      );
      if (!plan) return;
      d.close();
      d.closed.then(() => reviewAndRun(ctx, plan));
    });
  }

  function removeActionDialog() {
    const s = ctx.state.get();
    const list = selectedFilters();
    const friendly = list.map((f) => toFriendly(f.action));
    /** @type {Array<[string, string]>} */
    const keys = [];
    if (friendly.some((f) => f.archive)) keys.push(['archive', 'Skip the inbox']);
    if (friendly.some((f) => f.markRead)) keys.push(['markRead', 'Mark as read']);
    if (friendly.some((f) => f.star)) keys.push(['star', 'Star it']);
    if (friendly.some((f) => f.important)) keys.push(['important', 'Importance']);
    if (friendly.some((f) => f.category)) keys.push(['category', 'Category']);
    if (friendly.some((f) => f.neverSpam)) keys.push(['neverSpam', 'Never send to spam']);
    if (friendly.some((f) => f.forward)) keys.push(['forward', 'Forward']);
    if (friendly.some((f) => f.trash)) keys.push(['trash', 'Delete it']);
    const labelIds = [...new Set(friendly.flatMap((f) => f.labelIds))];
    for (const id of labelIds)
      keys.push([`label:${id}`, `Label ${s.labelsById.get(id)?.name ?? 'Missing label'}`]);
    const boxes = keys.map(([key, label]) => ({ key, box: checkbox({ label }) }));
    const cancel = button({ label: 'Cancel', variant: 'secondary' });
    const next = button({ label: 'Review the change', variant: 'primary' });
    const error = h('div', { role: 'alert' });
    const d = openDialog({
      title: 'Remove an action',
      description: `From ${plural(list.length, 'selected filter')}. A filter must still do at least one thing.`,
      size: 'md',
      content: [
        h(
          'fieldset',
          { class: 'fieldset' },
          h('legend', { text: 'Remove these actions' }),
          boxes.map((b) => b.box),
        ),
        error,
      ],
      footer: [cancel, next],
    });
    cancel.addEventListener('click', () => d.close());
    next.addEventListener('click', () => {
      const chosen = boxes.filter((b) => b.box.input.checked).map((b) => b.key);
      if (chosen.length === 0) {
        replace(error, notice({ tone: 'danger', text: 'Choose at least one action to remove.' }));
        return;
      }
      let plan;
      try {
        plan = planRemoveAction(list, chosen, { total: s.filters.length });
      } catch (err) {
        replace(error, notice({ tone: 'danger', text: err.message }));
        return;
      }
      d.close();
      d.closed.then(() => reviewAndRun(ctx, plan));
    });
  }

  function drawList() {
    const s = ctx.state.get();
    if (s.status !== 'ready') return;
    const found = searchFilters(s.filters, ui.query, s.labelsById);
    const issuesById = new Map();
    for (const issue of s.issues) {
      for (const id of issue.filterIds) {
        if (!issuesById.has(id)) issuesById.set(id, []);
        issuesById.get(id).push(issue);
      }
    }
    /** @type {Array<{key: string, title: string, filters: Filter[]}>} */
    const groups =
      ui.group === 'none'
        ? [{ key: 'all', title: '', filters: found }]
        : groupFilters(found, ui.group, s.labelsById);
    let shown = 0;
    visibleIds = [];
    const seen = new Set();
    const sections = [];
    groups.forEach((g, gi) => {
      if (shown >= ui.limit) return;
      const sorted = sortFilters(g.filters, ui.sort, s.labelsById).slice(0, ui.limit - shown);
      shown += sorted.length;
      for (const f of sorted) {
        if (!seen.has(f.id)) {
          seen.add(f.id);
          visibleIds.push(f.id);
        }
      }
      const cards = sorted.map((f) => {
        const card = filterCard(f, {
          labelsById: s.labelsById,
          issues: issuesById.get(f.id) ?? [],
          selected: s.selection.has(f.id),
          onToggle,
          onAction,
          noSignIn: ctx.mode === 'file',
        });
        if (ui.group !== 'none') {
          const input = card.querySelector('.card-check');
          const label = card.querySelector('.card-check-label');
          input.id = `select-${gi}-${f.id}`;
          label.setAttribute('for', input.id);
        }
        return card;
      });
      if (ui.group === 'none') sections.push(h('ul', { class: 'filter-list' }, cards));
      else {
        const headId = `group-${gi}`;
        sections.push(
          h(
            'section',
            { class: 'filter-group', 'aria-labelledby': headId },
            h(
              'h2',
              { id: headId, class: 'group-title' },
              h('span', { text: g.title }),
              h('span', { class: 'group-count', text: plural(g.filters.length, 'filter') }),
            ),
            h('ul', { class: 'filter-list' }, cards),
          ),
        );
      }
    });
    const total = found.length;
    resultCount.textContent =
      total === s.filters.length
        ? `${plural(total, 'filter')}`
        : `${plural(total, 'filter')} match "${ui.query.trim()}"`;
    selectAllLabel.textContent = `Select all ${visibleIds.length.toLocaleString('en-GB')} shown`;
    if (total === 0) {
      replace(
        listArea,
        s.filters.length === 0
          ? emptyState({
              icon: 'filter',
              title: 'You have no filters yet',
              text: 'Make your first filter, or pick from the suggestions.',
              actions: [
                button({
                  label: 'New filter',
                  variant: 'primary',
                  icon: 'plus',
                  href: '#/filters/new',
                }),
                button({ label: 'See suggestions', icon: 'suggest', href: '#/suggestions' }),
              ],
            })
          : emptyState({
              icon: 'search',
              title: 'No filters match',
              text: 'Try fewer words, or a sender, label or word from the summary.',
              actions: [
                button({
                  label: 'Clear search',
                  onClick: () => {
                    search.value = '';
                    ui.query = '';
                    drawList();
                    search.focus();
                  },
                }),
              ],
            }),
      );
    } else {
      const more =
        shown < (ui.group === 'none' ? total : groups.reduce((n, g) => n + g.filters.length, 0)) &&
        button({
          label: 'Show more filters',
          icon: 'chevron',
          class: 'show-more',
          onClick: () => {
            ui.limit += PAGE;
            const focusIndex = visibleIds.length;
            drawList();
            /** @type {HTMLElement|undefined} */ (
              listArea.querySelectorAll('.filter-link')[focusIndex]
            )?.focus();
          },
        });
      replace(listArea, sections, more);
    }
    syncSelection();
  }

  const gate = dataGate(ctx, {
    watch: ['filters', 'labels', 'issues'],
    render: () => {
      const frag = [
        h(
          'div',
          { class: 'toolbar' },
          searchField,
          h('div', { class: 'toolbar-selects' }, sort, group),
        ),
        h(
          'div',
          { class: 'list-head' },
          h(
            'div',
            { class: 'check select-all' },
            selectAll,
            h('div', { class: 'check-text' }, selectAllLabel),
          ),
          resultCount,
        ),
        listArea,
      ];
      queueMicrotask(drawList);
      return frag;
    },
  });
  const unsub = ctx.state.subscribe((_s, changed) => {
    if (changed.has('selection')) syncSelection();
  });

  const el = h(
    'div',
    { class: 'view-filters' },
    viewHeader({
      title: 'Filters',
      lead: 'Every Gmail filter, in plain English.',
      actions: [
        button({ label: 'New filter', variant: 'primary', icon: 'plus', href: '#/filters/new' }),
      ],
    }),
    gate.el,
    bulkBar,
  );
  return {
    el,
    title: 'Filters',
    destroy() {
      gate.destroy();
      unsub();
      document.body.classList.remove('has-bulk-bar');
    },
  };
}
