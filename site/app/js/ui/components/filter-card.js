// One filter as a card: plain English when and then, label chips, risk badges, issue markers,
// a criteria length meter, a selection checkbox and a row menu.

import { toFriendly } from '../../core/actions.js';
import { LIMITS, criteriaLength } from '../../core/limits.js';
import { describeFilter } from '../../core/summarise.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { menuButton } from './menu.js';
import { badge, labelChip } from './widgets.js';

/** @typedef {import('../../types.js').Filter} Filter */
/** @typedef {import('../../types.js').Issue} Issue */

/**
 * Short risk badges for a filter, with icons and words.
 * @param {Filter} filter
 * @returns {HTMLElement[]}
 */
export function riskBadges(filter) {
  const f = toFriendly(filter.action);
  /** @type {HTMLElement[]} */
  const out = [];
  if (f.trash) out.push(badge('Deletes mail', 'danger', 'trash'));
  if (f.forward) out.push(badge(`Forwards to ${f.forward}`, 'warning', 'forward'));
  if (f.archive && f.markRead) out.push(badge('Hidden from inbox, marked read', 'warning', 'eye'));
  if (f.neverSpam) out.push(badge('Never spam', 'info', 'shield'));
  return out;
}

const SEVERITY = {
  error: { icon: 'error', tone: 'danger', word: 'Problem' },
  warning: { icon: 'warning', tone: 'warning', word: 'Warning' },
  info: { icon: 'info', tone: 'info', word: 'Hint' },
};

/**
 * A small length meter for the criteria.
 * @param {number} length
 */
export function lengthMeter(length) {
  const max = LIMITS.criteriaCharsSafe;
  const level =
    length > LIMITS.criteriaCharsHard
      ? 'full'
      : length > max
        ? 'danger'
        : length > max * LIMITS.warnRatio
          ? 'warn'
          : 'ok';
  const fill = h('span', { class: 'mini-meter-fill' });
  fill.style.setProperty('--fill', String(Math.min(1, length / max)));
  return h(
    'span',
    { class: ['mini-meter', `meter-${level}`] },
    h('span', { class: 'mini-meter-track', 'aria-hidden': 'true' }, fill),
    h('span', {
      class: 'mini-meter-text',
      text: `${length.toLocaleString('en-GB')} of ${max.toLocaleString('en-GB')} characters`,
    }),
  );
}

/**
 * @typedef {object} CardOptions
 * @property {Map<string, any>} labelsById
 * @property {Issue[]} issues            Issues for this filter.
 * @property {boolean} selected
 * @property {(filter: Filter, checked: boolean, event: MouseEvent|Event) => void} onToggle
 * @property {(action: 'edit'|'duplicate'|'delete'|'matches', filter: Filter) => void} onAction
 * @property {boolean} [noSignIn]       No sign-in mode: matching mail is not available.
 */

/**
 * @param {Filter} filter
 * @param {CardOptions} opts
 * @returns {HTMLElement}
 */
export function filterCard(filter, opts) {
  const d = describeFilter(filter, opts.labelsById);
  const f = toFriendly(filter.action);
  const checkId = `select-${filter.id}`;
  const check = h('input', {
    type: 'checkbox',
    id: checkId,
    class: 'checkbox-input card-check',
    checked: opts.selected,
    dataset: { id: filter.id },
  });
  check.addEventListener('click', (/** @type {MouseEvent} */ e) =>
    opts.onToggle(filter, check.checked, e),
  );
  const shownIssues = opts.issues.filter((i) => i.code !== 'forwards');
  const length = criteriaLength(filter.criteria);
  const badges = riskBadges(filter);
  return h(
    'li',
    { class: ['filter-card', opts.selected && 'is-selected'], dataset: { id: filter.id } },
    h(
      'div',
      { class: 'card-select' },
      check,
      h(
        'label',
        { for: checkId, class: 'card-check-label' },
        h('span', { class: 'visually-hidden', text: `Select filter: ${d.when}` }),
      ),
    ),
    h(
      'div',
      { class: 'card-main' },
      h(
        'h3',
        { class: 'filter-when' },
        h('a', {
          href: `#/filters/${encodeURIComponent(filter.id)}`,
          class: 'filter-link',
          text: d.when,
        }),
      ),
      h(
        'p',
        { class: 'filter-then' },
        icon('chevronRight', { size: 16 }),
        h('span', { text: d.then }),
      ),
      shownIssues.length > 0 &&
        h(
          'ul',
          { class: 'card-issues' },
          shownIssues
            .slice(0, 3)
            .map((i) =>
              h(
                'li',
                { class: ['card-issue', `card-issue-${i.severity}`] },
                icon(SEVERITY[i.severity].icon, { size: 16 }),
                h(
                  'span',
                  null,
                  h('span', { class: 'visually-hidden', text: `${SEVERITY[i.severity].word}: ` }),
                  i.message,
                ),
              ),
            ),
        ),
      h(
        'div',
        { class: 'card-foot' },
        (f.labelIds.length > 0 || badges.length > 0) &&
          h(
            'ul',
            { class: 'chip-list', 'aria-label': 'Labels and warnings' },
            f.labelIds.map((id) => h('li', null, labelChip(id, opts.labelsById))),
            badges.map((b) => h('li', null, b)),
          ),
        lengthMeter(length),
      ),
    ),
    h(
      'div',
      { class: 'card-menu' },
      menuButton({
        label: `Actions for filter: ${d.when}`,
        iconOnly: true,
        buttonIcon: 'more',
        items: [
          { label: 'Edit', icon: 'edit', onSelect: () => opts.onAction('edit', filter) },
          { label: 'Duplicate', icon: 'copy', onSelect: () => opts.onAction('duplicate', filter) },
          {
            label: opts.noSignIn
              ? 'Show matching mail (needs Google sign-in)'
              : 'Show matching mail',
            icon: 'mail',
            disabled: opts.noSignIn,
            onSelect: () => opts.onAction('matches', filter),
          },
          {
            label: 'Delete',
            icon: 'trash',
            danger: true,
            onSelect: () => opts.onAction('delete', filter),
          },
        ],
      }),
    ),
  );
}
