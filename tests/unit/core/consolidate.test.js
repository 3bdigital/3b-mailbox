import { describe, expect, it } from 'vitest';
import {
  findMergeGroups,
  mergeCriteria,
  planAllMerges,
  planMerge,
} from '../../../site/app/js/core/consolidate.js';
import { LimitError } from '../../../site/app/js/core/bulk.js';
import { LIMITS, criteriaLength } from '../../../site/app/js/core/limits.js';
import {
  RECIPIENTS,
  SENDERS,
  WORDS,
  matchesCriteria,
  messages,
  pick,
  rng,
} from '../../fixtures/core/matcher.js';

const MSGS = messages(600, 42);

/**
 * Proves merged criteria match exactly the messages that any input matches.
 * @param {object[]} list
 */
function expectEquivalent(list) {
  const merged = mergeCriteria(list);
  for (const m of MSGS) {
    const any = list.some((c) => matchesCriteria(c, m));
    if (matchesCriteria(merged, m) !== any) {
      throw new Error(
        `Not equivalent for ${JSON.stringify(m)}\ninputs ${JSON.stringify(list)}\nmerged ${JSON.stringify(merged)}`,
      );
    }
  }
  return merged;
}

/** Random criteria built from the same small vocabulary as the messages. */
function randomCriteria(rand, shared) {
  const c = { ...shared };
  const fields = ['from', 'to', 'subject', 'query'].filter(() => rand() < 0.45);
  if (fields.length === 0) fields.push(pick(rand, ['from', 'to', 'subject', 'query']));
  for (const k of fields) {
    if (k === 'from') {
      c.from =
        rand() < 0.5 ? pick(rand, SENDERS) : `${pick(rand, SENDERS)} OR ${pick(rand, SENDERS)}`;
    } else if (k === 'to') {
      c.to = pick(rand, RECIPIENTS);
    } else if (k === 'subject') {
      c.subject = rand() < 0.5 ? pick(rand, WORDS) : `${pick(rand, WORDS)} ${pick(rand, WORDS)}`;
    } else {
      c.query = pick(rand, [
        pick(rand, WORDS),
        `${pick(rand, WORDS)} OR ${pick(rand, WORDS)}`,
        `${pick(rand, WORDS)} ${pick(rand, WORDS)}`,
        `-${pick(rand, WORDS)}`,
        `from:${pick(rand, SENDERS)} ${pick(rand, WORDS)}`,
        `{${pick(rand, WORDS)} ${pick(rand, WORDS)}}`,
        `(${pick(rand, WORDS)} -${pick(rand, WORDS)})`,
        'has:attachment',
      ]);
    }
  }
  return c;
}

describe('mergeCriteria', () => {
  it('joins from-only filters with OR', () => {
    expect(
      mergeCriteria([{ from: 'a@x.com' }, { from: 'b@y.com OR c@z.com' }, { from: 'A@x.com' }]),
    ).toEqual({
      from: 'a@x.com OR b@y.com OR c@z.com',
    });
    expect(mergeCriteria([{ to: 'me@a.com' }, { to: 'me@b.com' }])).toEqual({
      to: 'me@a.com OR me@b.com',
    });
    expect(mergeCriteria([{ subject: 'invoice receipt' }, { subject: 'bill' }])).toEqual({
      subject: '(invoice receipt) OR bill',
    });
  });

  it('makes one OR branch per filter when fields are mixed', () => {
    expect(
      mergeCriteria([
        { from: 'a', subject: 'b' },
        { from: 'c' },
        { query: 'x y' },
        { query: 'z OR w' },
      ]),
    ).toEqual({ query: '{(from:(a) subject:(b)) from:(c) (x y) z OR w}' });
    expect(mergeCriteria([{ from: 'a', query: 'p OR q' }, { to: 'b' }])).toEqual({
      query: '{(from:(a) (p OR q)) to:(b)}',
    });
  });

  it('keeps shared fields', () => {
    const shared = {
      negatedQuery: 'spam',
      hasAttachment: true,
      excludeChats: true,
      size: 100,
      sizeComparison: 'larger',
    };
    expect(
      mergeCriteria([
        { from: 'a', ...shared },
        { from: 'b', ...shared },
      ]),
    ).toEqual({
      from: 'a OR b',
      ...shared,
    });
  });

  it('returns the single filter when every input is the same', () => {
    expect(
      mergeCriteria([
        { from: 'a', subject: 'b' },
        { from: 'A', subject: 'B' },
      ]),
    ).toEqual({
      from: 'a',
      subject: 'b',
    });
  });

  it('refuses inputs that cannot be merged', () => {
    expect(() => mergeCriteria([])).toThrow('nothing to merge');
    expect(() => mergeCriteria([{ from: 'a' }, { from: 'b', hasAttachment: true }])).toThrow(
      'cannot be merged',
    );
    expect(() => mergeCriteria([{ from: 'a' }, { hasAttachment: false }])).toThrow(
      'no search terms',
    );
  });

  it('is equivalent to the OR of the inputs (generated cases)', () => {
    const rand = rng(2026);
    let cases = 0;
    for (let i = 0; i < 300; i++) {
      const shared =
        rand() < 0.3
          ? { negatedQuery: pick(rand, WORDS) }
          : rand() < 0.2
            ? { hasAttachment: true }
            : {};
      const n = 2 + Math.floor(rand() * 4);
      const list = Array.from({ length: n }, () => randomCriteria(rand, shared));
      expectEquivalent(list);
      cases++;
    }
    expect(cases).toBe(300);
  });

  it('is equivalent for hand-picked tricky cases', () => {
    expectEquivalent([{ from: 'ann@shop.co.uk', subject: 'invoice' }, { from: 'bob@bank.com' }]);
    expectEquivalent([{ query: 'invoice receipt' }, { query: 'order' }]);
    expectEquivalent([{ query: '-hello' }, { subject: 'code' }]);
    expectEquivalent([{ query: 'invoice OR sale' }, { query: 'from:dan@mail.net code' }]);
    expectEquivalent([{ subject: 'invoice order' }, { subject: 'sale' }]);
    expectEquivalent([
      { from: 'shop.co.uk', negatedQuery: 'sale order' },
      { to: 'me+shop', negatedQuery: 'order sale' },
    ]);
  });
});

describe('findMergeGroups', () => {
  it('groups filters with the same action and compatible criteria', () => {
    const groups = findMergeGroups([
      { id: '1', criteria: { from: 'a' }, action: { addLabelIds: ['L1'] } },
      { id: '2', criteria: { from: 'b' }, action: { addLabelIds: ['L1'] } },
      { id: '3', criteria: { from: 'c', hasAttachment: true }, action: { addLabelIds: ['L1'] } },
      { id: '4', criteria: { from: 'd' }, action: { addLabelIds: ['L2'] } },
      { criteria: { from: 'e' }, action: { addLabelIds: ['L1'] } },
      { id: '6', criteria: { hasAttachment: true }, action: { addLabelIds: ['L1'] } },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].filters.map((f) => f.id)).toEqual(['1', '2']);
    expect(groups[0].reason).toBe('These 2 filters do the same thing to different mail.');
    expect(findMergeGroups(undefined)).toEqual([]);
  });
});

describe('planMerge', () => {
  it('creates the merged filter and deletes the originals', () => {
    const a = { id: '1', criteria: { from: 'a' }, action: { addLabelIds: ['L1'] } };
    const b = { id: '2', criteria: { from: 'b' }, action: { addLabelIds: ['L1'] } };
    const plan = planMerge({ filters: [a, b] });
    expect(plan).toEqual({
      title: 'Merge 2 filters into 1',
      filterDelta: -1,
      steps: [
        { op: 'create', filter: { criteria: { from: 'a OR b' }, action: { addLabelIds: ['L1'] } } },
        { op: 'delete', filterId: '1', previous: a },
        { op: 'delete', filterId: '2', previous: b },
      ],
    });
  });

  it('splits when a merged filter would go over the limit', () => {
    const filters = Array.from({ length: 80 }, (_, i) => ({
      id: `f${i}`,
      criteria: { from: `someone.with.a.long.name.${i}@example-company.co.uk` },
      action: { removeLabelIds: ['INBOX'] },
    }));
    const plan = planMerge({ filters });
    const creates = plan.steps.filter((s) => s.op === 'create');
    expect(creates.length).toBeGreaterThan(1);
    for (const s of creates)
      expect(criteriaLength(s.filter.criteria)).toBeLessThanOrEqual(LIMITS.criteriaCharsSafe);
    expect(plan.steps.filter((s) => s.op === 'delete')).toHaveLength(80);
    expect(plan.filterDelta).toBe(creates.length - 80);
    // Every original sender is in exactly one merged filter.
    const all = creates.map((s) => s.filter.criteria.from).join(' OR ');
    for (const f of filters) expect(all.split(' OR ')).toContain(f.criteria.from);
  });

  it('respects a custom limit and leaves a filter alone when it cannot merge', () => {
    const filters = [
      { id: '1', criteria: { from: 'x'.repeat(60) }, action: {} },
      { id: '2', criteria: { from: 'a' }, action: {} },
      { id: '3', criteria: { from: 'b' }, action: {} },
    ];
    const plan = planMerge({ filters }, { limit: 50 });
    expect(plan.title).toBe('Merge 2 filters into 1');
    expect(plan.steps.map((s) => s.op)).toEqual(['create', 'delete', 'delete']);
    expect(planMerge({ filters: filters.slice(0, 1) })).toEqual({
      title: 'Nothing to merge',
      steps: [],
      filterDelta: 0,
    });
  });

  it('throws LimitError when the account has no room for the merged filter', () => {
    const group = {
      filters: [
        { id: '1', criteria: { from: 'a' }, action: {} },
        { id: '2', criteria: { from: 'b' }, action: {} },
      ],
    };
    expect(() => planMerge(group, { total: 1000 })).toThrow(LimitError);
  });
});

describe('planAllMerges', () => {
  it('plans every group', () => {
    const plans = planAllMerges(
      [
        { id: '1', criteria: { from: 'a' }, action: { addLabelIds: ['L1'] } },
        { id: '2', criteria: { from: 'b' }, action: { addLabelIds: ['L1'] } },
        { id: '3', criteria: { from: 'c' }, action: { addLabelIds: ['L2'] } },
        { id: '4', criteria: { from: 'd' }, action: { addLabelIds: ['L2'] } },
        { id: '5', criteria: { query: 'x'.repeat(30) }, action: { addLabelIds: ['L3'] } },
        { id: '6', criteria: { query: 'y'.repeat(30) }, action: { addLabelIds: ['L3'] } },
      ],
      { limit: 40 },
    );
    expect(plans.map((p) => p.title)).toEqual(['Merge 2 filters into 1', 'Merge 2 filters into 1']);
  });
});
