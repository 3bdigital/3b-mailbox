// #/tidy: health check issues by severity, safe one-click fixes, and merging of filters that do
// the same thing. Every fix goes through the plan preview.

import { criteriaKey } from '../../core/analyse.js';
import { findMergeGroups, planMerge } from '../../core/consolidate.js';
import { criteriaToSearch } from '../../core/limits.js';
import { describeFilter } from '../../core/summarise.js';
import { reviewAndRun } from '../components/plan-preview.js';
import { toast } from '../components/toast.js';
import { button, emptyState, viewHeader } from '../components/widgets.js';
import { h, plural } from '../dom.js';
import { icon } from '../icons.js';
import { planCombine, planDedupe } from '../plans.js';
import { dataGate } from './common.js';

/** @typedef {import('../../types.js').Filter} Filter */
/** @typedef {import('../../types.js').Issue} Issue */

const SEVERITIES = [
  {
    key: 'error',
    title: 'Problems',
    lead: 'These filters do not work as you expect. Fix them first.',
    icon: 'error',
    tone: 'danger',
  },
  {
    key: 'warning',
    title: 'Warnings',
    lead: 'These filters work, but they may cause trouble.',
    icon: 'warning',
    tone: 'warning',
  },
  {
    key: 'info',
    title: 'Hints',
    lead: 'Small things you may want to check.',
    icon: 'info',
    tone: 'info',
  },
];

/**
 * Merge groups that are not just exact duplicates (those have their own fix).
 * @param {Filter[]} filters
 */
export function realMergeGroups(filters) {
  return findMergeGroups(filters).filter(
    (g) => new Set(g.filters.map((f) => criteriaKey(f.criteria))).size > 1,
  );
}

/**
 * @param {Filter} f
 * @param {Map<string, any>} labelsById
 */
function filterRow(f, labelsById) {
  const d = describeFilter(f, labelsById);
  return h(
    'li',
    { class: 'mini-filter' },
    h('a', {
      href: `#/filters/${encodeURIComponent(f.id ?? '')}`,
      class: 'mini-when',
      text: d.when,
    }),
    h(
      'span',
      { class: 'mini-then' },
      icon('chevronRight', { size: 16 }),
      h('span', { text: d.then }),
    ),
  );
}

/**
 * @param {any} ctx
 */
export function render(ctx) {
  /** @param {() => any} make */
  const run = (make, opts) => {
    try {
      reviewAndRun(ctx, make(), opts);
    } catch (err) {
      toast(err.message, { tone: 'danger' });
    }
  };

  const gate = dataGate(ctx, {
    render: (s) => {
      const byId = new Map(s.filters.map((f) => [f.id, f]));
      const total = s.filters.length;
      /** @param {Issue} issue */
      const filtersOf = (issue) => issue.filterIds.map((id) => byId.get(id)).filter(Boolean);

      /**
       * @param {Issue} issue
       * @param {Filter[]} list
       */
      function fixButton(issue, list) {
        if (issue.code === 'duplicate') {
          return button({
            label: `Delete ${plural(list.length - 1, 'duplicate')}`,
            variant: 'primary',
            icon: 'trash',
            size: 'sm',
            onClick: () =>
              run(() => planDedupe(list, { total }), {
                intro:
                  '3B Mailbox keeps one of them and deletes the rest. They all do the same thing.',
              }),
          });
        }
        if (issue.code === 'same-criteria') {
          let ok = true;
          try {
            planCombine(list, { total });
          } catch {
            ok = false;
          }
          if (ok) {
            return button({
              label: `Combine into 1 filter`,
              variant: 'primary',
              icon: 'merge',
              size: 'sm',
              onClick: () =>
                run(() => planCombine(list, { total }), {
                  intro: 'One new filter does every action. Then the old filters are deleted.',
                }),
            });
          }
        }
        if (list.length === 1) {
          return button({
            label: 'Edit the filter',
            size: 'sm',
            icon: 'edit',
            href: `#/filters/${encodeURIComponent(list[0].id)}`,
          });
        }
        return null;
      }

      /** @param {Issue[]} issues */
      function issueCards(issues) {
        /** @type {Array<{issue: Issue, filters: Filter[], title: string}>} */
        const cards = [];
        const forwards = issues.filter((i) => i.code === 'forwards');
        for (const issue of issues) {
          if (issue.code === 'forwards') continue;
          cards.push({ issue, filters: filtersOf(issue), title: issue.message });
        }
        if (forwards.length) {
          cards.push({
            issue: {
              ...forwards[0],
              filterIds: forwards.flatMap((i) => i.filterIds),
              fix: 'Check that you still want each copy to go to these addresses.',
            },
            filters: forwards.flatMap(filtersOf),
            title: `${plural(forwards.length, 'filter')} forward copies of your mail.`,
          });
        }
        return cards.map(({ issue, filters, title }) => {
          const fix = fixButton(issue, filters);
          return h(
            'li',
            { class: ['issue-card', `issue-card-${issue.severity}`] },
            h(
              'div',
              { class: 'issue-card-head' },
              icon(SEVERITIES.find((x) => x.key === issue.severity).icon),
              h('h3', { class: 'issue-title', text: title }),
            ),
            issue.fix && h('p', { class: 'issue-fix', text: issue.fix }),
            filters.length > 0 &&
              h(
                'ul',
                { class: 'mini-filters', 'aria-label': 'Filters' },
                filters.map((f) => filterRow(f, s.labelsById)),
              ),
            fix && h('div', { class: 'issue-actions' }, fix),
          );
        });
      }

      const groups = realMergeGroups(s.filters);
      const mergeCards = groups
        .map((g, i) => {
          let plan;
          try {
            plan = planMerge(g, { total });
          } catch {
            return null;
          }
          if (plan.steps.length === 0) return null;
          const creates = plan.steps.filter((st) => st.op === 'create');
          const saved = -plan.filterDelta;
          return h(
            'li',
            { class: 'merge-card' },
            h('h3', {
              class: 'merge-title',
              id: `merge-${i}`,
              text: `${plural(g.filters.length, 'filter')} become ${creates.length}`,
            }),
            h(
              'p',
              { class: 'merge-saving' },
              icon('success', { size: 16 }),
              h('span', {
                text: `You save ${plural(saved, 'filter')}. They all ${describeFilter(g.filters[0], s.labelsById).then.toLowerCase()}.`,
              }),
            ),
            h(
              'div',
              { class: 'before-after' },
              h(
                'div',
                { class: 'ba-col' },
                h('h4', { class: 'ba-title', text: 'Before' }),
                h(
                  'ul',
                  { class: 'mini-filters' },
                  g.filters.map((f) => filterRow(f, s.labelsById)),
                ),
              ),
              h('div', { class: 'ba-arrow', 'aria-hidden': 'true' }, icon('chevronRight')),
              h(
                'div',
                { class: 'ba-col' },
                h('h4', { class: 'ba-title', text: 'After' }),
                h(
                  'ul',
                  { class: 'mini-filters' },
                  creates.map((st) =>
                    h(
                      'li',
                      { class: 'mini-filter' },
                      h('span', {
                        class: 'mini-when',
                        text: describeFilter(st.filter, s.labelsById).when,
                      }),
                      h('code', {
                        class: 'mini-query',
                        text: criteriaToSearch(st.filter.criteria),
                      }),
                    ),
                  ),
                ),
              ),
            ),
            h(
              'div',
              { class: 'issue-actions' },
              button({
                label: plan.title,
                variant: 'primary',
                icon: 'merge',
                size: 'sm',
                onClick: () => reviewAndRun(ctx, plan),
              }),
            ),
          );
        })
        .filter(Boolean);

      const sections = SEVERITIES.map((sev) => {
        const list = s.issues.filter((i) => i.severity === sev.key);
        if (list.length === 0) return null;
        return h(
          'section',
          { class: ['tidy-section', `tidy-${sev.tone}`], 'aria-labelledby': `tidy-${sev.key}` },
          h(
            'h2',
            { id: `tidy-${sev.key}`, class: 'group-title' },
            icon(sev.icon),
            h('span', { text: sev.title }),
            h('span', { class: 'group-count', text: String(issueCards(list).length) }),
          ),
          h('p', { class: 'section-lead', text: sev.lead }),
          h('ul', { class: 'issue-list' }, issueCards(list)),
        );
      });

      if (s.issues.length === 0 && mergeCards.length === 0) {
        return emptyState({
          icon: 'success',
          tone: 'success',
          title: 'Everything is tidy',
          text: '3B Mailbox found no problems and nothing to merge.',
        });
      }
      return [
        ...sections,
        h(
          'section',
          { class: 'tidy-section tidy-merge', 'aria-labelledby': 'tidy-merge' },
          h(
            'h2',
            { id: 'tidy-merge', class: 'group-title' },
            icon('merge'),
            h('span', { text: 'Merge filters' }),
            h('span', { class: 'group-count', text: String(mergeCards.length) }),
          ),
          h('p', {
            class: 'section-lead',
            text: 'Filters that do exactly the same thing to different mail can be one filter. You see the result before anything changes.',
          }),
          mergeCards.length
            ? h('ul', { class: 'merge-list' }, mergeCards)
            : h('p', { class: 'muted', text: 'Nothing to merge.' }),
        ),
      ];
    },
  });

  const el = h(
    'div',
    { class: 'view-tidy' },
    viewHeader({
      title: 'Tidy up',
      lead: 'Find problems, remove duplicates and merge filters that do the same job.',
    }),
    gate.el,
  );
  return { el, title: 'Tidy up', destroy: gate.destroy };
}
