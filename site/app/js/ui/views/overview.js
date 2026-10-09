// #/overview: limits, key counts, issues, a chart of filters by action, and recent changes.

import { toFriendly } from '../../core/actions.js';
import { LIMITS, accountUsage, criteriaLength } from '../../core/limits.js';
import { reviewAndRun } from '../components/plan-preview.js';
import { button, meter, viewHeader } from '../components/widgets.js';
import { formatDate, h, plural } from '../dom.js';
import { icon } from '../icons.js';
import { journalBatches, planRestoreBatch } from '../plans.js';
import { dataGate } from './common.js';

/** @typedef {import('../../types.js').Filter} Filter */

/**
 * Counts filters by the kind of action they do. A filter with two actions counts twice.
 * @param {Filter[]} filters
 * @returns {Array<{key: string, label: string, count: number}>}
 */
export function actionCounts(filters) {
  const rows = [
    { key: 'label', label: 'Apply a label', test: (f) => f.labelIds.length > 0 },
    { key: 'archive', label: 'Skip the inbox', test: (f) => f.archive },
    { key: 'markRead', label: 'Mark as read', test: (f) => f.markRead },
    { key: 'star', label: 'Star', test: (f) => f.star },
    { key: 'important', label: 'Change importance', test: (f) => f.important !== null },
    { key: 'category', label: 'Choose a category', test: (f) => f.category !== null },
    { key: 'forward', label: 'Forward', test: (f) => Boolean(f.forward) },
    { key: 'neverSpam', label: 'Never send to spam', test: (f) => f.neverSpam },
    { key: 'trash', label: 'Delete', test: (f) => f.trash },
  ];
  const friendly = filters.map((f) => toFriendly(f.action));
  return rows
    .map((r) => ({ key: r.key, label: r.label, count: friendly.filter(r.test).length }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);
}

/**
 * @param {string} label
 * @param {number} value
 * @param {string} iconName
 * @param {{tone?: string, href?: string, note?: string}} [opts]
 */
function stat(label, value, iconName, opts = {}) {
  const inner = [
    h('span', { class: 'stat-icon' }, icon(iconName)),
    h('span', { class: 'stat-value', text: value.toLocaleString('en-GB') }),
    h('span', { class: 'stat-label', text: label }),
    opts.note && h('span', { class: 'stat-note', text: opts.note }),
  ];
  return h(
    'li',
    { class: ['stat', opts.tone && `stat-${opts.tone}`] },
    opts.href
      ? h('a', { class: 'stat-body stat-link', href: opts.href }, inner)
      : h('div', { class: 'stat-body' }, inner),
  );
}

/**
 * @param {any} ctx
 */
export function render(ctx) {
  const gate = dataGate(ctx, {
    skeletonKind: 'stats',
    watch: ['filters', 'labels', 'issues', 'forwarding', 'journalVersion'],
    render: (s) => {
      const filters = /** @type {Filter[]} */ (s.filters);
      const usage = accountUsage(filters, s.labels);
      const friendly = filters.map((f) => toFriendly(f.action));
      const labelsUsed = new Set(
        friendly.flatMap((f) => f.labelIds).filter((id) => s.labelsById.has(id)),
      ).size;
      const forwarding = friendly.filter((f) => f.forward).length;
      const deleting = friendly.filter((f) => f.trash).length;
      const issues = s.issues.filter((i) => i.code !== 'forwards');
      const errors = issues.filter((i) => i.severity === 'error');
      const warnings = issues.filter((i) => i.severity === 'warning');
      const hints = issues.filter((i) => i.severity === 'info');
      const longest = filters.reduce((m, f) => Math.max(m, criteriaLength(f.criteria)), 0);
      const lengthLevel =
        longest > LIMITS.criteriaCharsHard
          ? 'full'
          : longest > LIMITS.criteriaCharsSafe
            ? 'danger'
            : longest > LIMITS.criteriaCharsSafe * LIMITS.warnRatio
              ? 'warn'
              : 'ok';

      const counts = actionCounts(filters);
      const max = Math.max(1, ...counts.map((c) => c.count));

      const issueCard = (title, list, tone, iconName, empty) =>
        h(
          'li',
          { class: ['issue-summary', `issue-summary-${tone}`] },
          h(
            'a',
            { class: 'issue-summary-link', href: '#/tidy' },
            h(
              'span',
              { class: 'issue-summary-head' },
              icon(iconName),
              h('span', { class: 'issue-summary-count', text: String(list.length) }),
              h('span', { class: 'issue-summary-title', text: title }),
            ),
            h('span', { class: 'issue-summary-text', text: list[0]?.message ?? empty }),
            h(
              'span',
              { class: 'issue-summary-more' },
              h('span', { text: 'Review in Tidy up' }),
              icon('chevronRight', { size: 16 }),
            ),
          ),
        );

      const batches = journalBatches(ctx.journal.list()).slice(0, 5);

      return [
        h(
          'section',
          { class: 'section', 'aria-labelledby': 'ov-counts' },
          h('h2', { id: 'ov-counts', class: 'visually-hidden', text: 'Key numbers' }),
          h(
            'ul',
            { class: 'stats' },
            stat('Filters', filters.length, 'filter', { href: '#/filters' }),
            stat('Labels used', labelsUsed, 'tag'),
            stat('Forward mail', forwarding, 'forward', {
              tone: forwarding ? 'warning' : undefined,
            }),
            stat('Delete mail', deleting, 'trash', { tone: deleting ? 'danger' : undefined }),
            stat('Issues to check', errors.length + warnings.length, 'warning', {
              href: '#/tidy',
              tone: errors.length ? 'danger' : warnings.length ? 'warning' : 'success',
            }),
          ),
        ),
        h(
          'div',
          { class: 'overview-grid' },
          h(
            'section',
            { class: 'card', 'aria-labelledby': 'ov-limits' },
            h('h2', { id: 'ov-limits', class: 'card-title', text: 'Gmail limits' }),
            h(
              'div',
              { class: 'meter-stack' },
              meter({
                label: 'Filters',
                value: usage.filters.used,
                max: usage.filters.max,
                level: usage.filters.level,
              }),
              meter({
                label: 'Labels',
                value: usage.labels.used,
                max: usage.labels.max,
                level: usage.labels.level,
              }),
              meter({
                label: 'Longest filter',
                value: longest,
                max: LIMITS.criteriaCharsSafe,
                level: lengthLevel,
                levelText:
                  lengthLevel === 'full'
                    ? 'Too long for Gmail. Split it in Tidy up'
                    : lengthLevel === 'danger'
                      ? 'Over the safe length. Shorten or split it'
                      : undefined,
                valueText: `${longest.toLocaleString('en-GB')} of ${LIMITS.criteriaCharsSafe.toLocaleString('en-GB')} characters`,
              }),
            ),
            h('p', {
              class: 'card-note',
              text: 'Gmail allows 1,000 filters. A filter stops working at about 1,469 characters, so Email Filter keeps each one under 1,400.',
            }),
          ),
          h(
            'section',
            { class: 'card', 'aria-labelledby': 'ov-actions' },
            h('h2', { id: 'ov-actions', class: 'card-title', text: 'What your filters do' }),
            h(
              'table',
              { class: 'bar-table' },
              h('caption', {
                class: 'visually-hidden',
                text: 'Number of filters for each kind of action. A filter can do more than one thing.',
              }),
              h(
                'thead',
                { class: 'visually-hidden' },
                h(
                  'tr',
                  null,
                  h('th', { scope: 'col', text: 'Action' }),
                  h('th', { scope: 'col', text: 'Filters' }),
                ),
              ),
              h(
                'tbody',
                null,
                counts.map((c) => {
                  const bar = h('span', { class: ['bar', `bar-${c.key}`], 'aria-hidden': 'true' });
                  bar.style.setProperty('--bar', `${(c.count / max) * 100}%`);
                  return h(
                    'tr',
                    null,
                    h('th', { scope: 'row', class: 'bar-label', text: c.label }),
                    h(
                      'td',
                      { class: 'bar-cell' },
                      h('span', { class: 'bar-track' }, bar),
                      h('span', { class: 'bar-value', text: String(c.count) }),
                    ),
                  );
                }),
              ),
            ),
          ),
        ),
        h(
          'section',
          { class: 'section', 'aria-labelledby': 'ov-issues' },
          h('h2', { id: 'ov-issues', class: 'section-title', text: 'Health check' }),
          h(
            'ul',
            { class: 'issue-summaries' },
            issueCard(
              errors.length === 1 ? 'Problem' : 'Problems',
              errors,
              'danger',
              'error',
              'No problems found.',
            ),
            issueCard(
              warnings.length === 1 ? 'Warning' : 'Warnings',
              warnings,
              'warning',
              'warning',
              'No warnings.',
            ),
            issueCard(hints.length === 1 ? 'Hint' : 'Hints', hints, 'info', 'info', 'No hints.'),
          ),
        ),
        h(
          'section',
          { class: 'section', 'aria-labelledby': 'ov-recent' },
          h(
            'div',
            { class: 'section-head' },
            h('h2', { id: 'ov-recent', class: 'section-title', text: 'Recent changes' }),
            batches.length > 0 &&
              h('a', { href: '#/settings', class: 'link-quiet' }, 'All changes'),
          ),
          batches.length === 0
            ? h('p', {
                class: 'muted',
                text: 'No changes yet. When you change or delete filters, Email Filter keeps a copy here so you can undo it.',
              })
            : h(
                'ul',
                { class: 'history-list' },
                batches.map((b) =>
                  h(
                    'li',
                    { class: 'history-item' },
                    h('span', { class: 'history-icon' }, icon('history')),
                    h(
                      'div',
                      { class: 'history-text' },
                      h('p', { class: 'history-title', text: b.title }),
                      h('p', {
                        class: 'history-meta',
                        text: `${formatDate(b.time)}. ${plural(b.entries.length, 'filter')} saved for undo.`,
                      }),
                    ),
                    button({
                      label: 'Undo',
                      ariaLabel: `Undo: ${b.title}`,
                      size: 'sm',
                      icon: 'undo',
                      onClick: () => {
                        const now = ctx.state.get().filters;
                        reviewAndRun(ctx, planRestoreBatch(b.entries, now, { total: now.length }), {
                          intro: 'This puts back the filters as they were before this change.',
                        });
                      },
                    }),
                  ),
                ),
              ),
        ),
      ];
    },
  });

  const el = h(
    'div',
    { class: 'view-overview' },
    viewHeader({
      title: 'Overview',
      lead: 'Your Gmail filters at a glance.',
      actions: [
        button({ label: 'New filter', variant: 'primary', icon: 'plus', href: '#/filters/new' }),
      ],
    }),
    gate.el,
  );
  return { el, title: 'Overview', destroy: gate.destroy };
}
