import { describe, expect, it } from 'vitest';
import {
  LimitError,
  PlanError,
  count,
  makePlan,
  planAddAction,
  planCreate,
  planDelete,
  planDuplicate,
  planEdit,
  planRemoveAction,
  planReplaceLabel,
} from '../../../site/app/js/core/bulk.js';

const a = {
  id: 'a',
  criteria: { from: 'a@x.com' },
  action: { addLabelIds: ['L1'], removeLabelIds: ['INBOX'] },
};
const b = { id: 'b', criteria: { from: 'b@x.com' }, action: { addLabelIds: ['L2'] } };
const long = { criteria: { query: 'x'.repeat(1500) }, action: { addLabelIds: ['L1'] } };

describe('count', () => {
  it('uses the plural only when needed', () => {
    expect(count(1)).toBe('1 filter');
    expect(count(0)).toBe('0 filters');
    expect(count(2, 'label')).toBe('2 labels');
  });
});

describe('makePlan', () => {
  it('works out the filter delta', () => {
    const plan = makePlan('t', [
      { op: 'createLabel', name: 'x' },
      { op: 'create', filter: b },
      { op: 'delete', filterId: 'a', previous: a },
      { op: 'delete', filterId: 'b', previous: b },
      { op: 'replace', filterId: 'b', previous: b, filter: b },
    ]);
    expect(plan.filterDelta).toBe(-1);
  });

  it('throws LimitError for too many filters, too-long criteria and too many labels', () => {
    expect(() => makePlan('t', [{ op: 'create', filter: b }], { total: 1000 })).toThrow(LimitError);
    expect(() =>
      makePlan('t', [{ op: 'replace', filterId: 'b', previous: b, filter: b }], { total: 1000 }),
    ).toThrow(/room for 1001 filters/);
    expect(() =>
      makePlan('t', [{ op: 'replace', filterId: 'b', previous: b, filter: b }], { total: 999 }),
    ).not.toThrow();
    try {
      makePlan('t', [{ op: 'create', filter: long }]);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(LimitError);
      expect(e.code).toBe('too-long');
      expect(e.name).toBe('LimitError');
    }
    expect(() => makePlan('t', [{ op: 'createLabel', name: 'x' }], { labelCount: 10000 })).toThrow(
      /labels/,
    );
  });
});

describe('planDelete', () => {
  it('deletes and keeps the previous filter', () => {
    expect(planDelete([a, b])).toEqual({
      title: 'Delete 2 filters',
      filterDelta: -2,
      steps: [
        { op: 'delete', filterId: 'a', previous: a },
        { op: 'delete', filterId: 'b', previous: b },
      ],
    });
  });

  it('refuses a filter with no id', () => {
    expect(() => planDelete([{ criteria: {}, action: {} }])).toThrow(PlanError);
  });
});

describe('planDuplicate', () => {
  it('creates copies with no id', () => {
    const plan = planDuplicate([a]);
    expect(plan.title).toBe('Copy 1 filter');
    expect(plan.steps).toEqual([
      { op: 'create', filter: { criteria: a.criteria, action: a.action } },
    ]);
    expect(plan.steps[0].filter.criteria).not.toBe(a.criteria);
    expect(plan.filterDelta).toBe(1);
  });

  it('checks the filter limit', () => {
    expect(() => planDuplicate([a, b], { total: 999 })).toThrow(LimitError);
  });
});

describe('planReplaceLabel', () => {
  it('changes one label to another in the filters that use it', () => {
    const c = { id: 'c', criteria: { from: 'c' }, action: { addLabelIds: ['L1', 'L2'] } };
    const plan = planReplaceLabel([a, b, c], 'L1', 'L2');
    expect(plan.title).toBe('Change the label in 2 filters');
    expect(plan.steps).toEqual([
      {
        op: 'replace',
        filterId: 'a',
        previous: a,
        filter: {
          criteria: a.criteria,
          action: { addLabelIds: ['L2'], removeLabelIds: ['INBOX'] },
        },
      },
      {
        op: 'replace',
        filterId: 'c',
        previous: c,
        filter: { criteria: c.criteria, action: { addLabelIds: ['L2'] } },
      },
    ]);
  });

  it('can create a new label', () => {
    const plan = planReplaceLabel([a], 'L1', { newLabelName: ' Bills ' });
    expect(plan.steps[0]).toEqual({ op: 'createLabel', name: 'Bills' });
    expect(plan.steps[1].filter.action.addLabelIds).toEqual(['new:Bills']);
  });

  it('does nothing when no filter uses the label', () => {
    expect(planReplaceLabel([b], 'L1', { newLabelName: 'X' })).toEqual({
      title: 'Change the label in 0 filters',
      steps: [],
      filterDelta: 0,
    });
  });

  it('changes system-style IDs too', () => {
    const s = { id: 's', criteria: { from: 's' }, action: { addLabelIds: ['SENT'] } };
    expect(planReplaceLabel([s], 'SENT', 'L1').steps[0].filter.action.addLabelIds).toEqual(['L1']);
  });
});

describe('planAddAction', () => {
  it('adds actions and labels, and skips filters that already do it', () => {
    const plan = planAddAction([a, b], {
      archive: true,
      markRead: true,
      labelIds: ['L1', 'new:Later'],
      important: 'never',
      category: 'CATEGORY_UPDATES',
      forward: 'x@y.com',
    });
    expect(plan.steps[0]).toEqual({ op: 'createLabel', name: 'Later' });
    const replaced = plan.steps.slice(1);
    expect(replaced).toHaveLength(2);
    expect(replaced[0].filter.action).toEqual({
      addLabelIds: ['CATEGORY_UPDATES', 'L1', 'new:Later'],
      removeLabelIds: ['INBOX', 'UNREAD', 'IMPORTANT'],
      forward: 'x@y.com',
    });
    expect(planAddAction([a], { archive: true }).steps).toEqual([]);
    expect(planAddAction([a], { star: true }).title).toBe('Change 1 filter');
  });
});

describe('planRemoveAction', () => {
  it('removes actions by key', () => {
    const c = {
      id: 'c',
      criteria: { from: 'c' },
      action: {
        addLabelIds: ['L1', 'L2', 'STARRED', 'IMPORTANT', 'CATEGORY_SOCIAL'],
        removeLabelIds: ['INBOX'],
        forward: 'f@x.com',
      },
    };
    const plan = planRemoveAction(
      [c],
      ['label:L1', 'star', 'important', 'category', 'forward', 'nonsense'],
    );
    expect(plan.steps[0].filter.action).toEqual({ addLabelIds: ['L2'], removeLabelIds: ['INBOX'] });
    expect(planRemoveAction([c], ['labelIds']).steps[0].filter.action.addLabelIds).toEqual([
      'STARRED',
      'IMPORTANT',
      'CATEGORY_SOCIAL',
    ]);
  });

  it('refuses to leave a filter that does nothing', () => {
    expect(() => planRemoveAction([b], ['labelIds'])).toThrow(PlanError);
  });
});

describe('planEdit', () => {
  it('makes one replace step', () => {
    const next = { ...a, criteria: { from: 'new@x.com' } };
    expect(planEdit(a, next)).toEqual({
      title: 'Save changes to 1 filter',
      filterDelta: 0,
      steps: [
        {
          op: 'replace',
          filterId: 'a',
          previous: a,
          filter: { criteria: next.criteria, action: a.action },
        },
      ],
    });
  });

  it('makes no steps when nothing changed', () => {
    const same = {
      criteria: { from: 'A@x.com ' },
      action: { removeLabelIds: ['INBOX'], addLabelIds: ['L1'] },
    };
    expect(planEdit(a, same).steps).toEqual([]);
  });

  it('checks the length limit', () => {
    expect(() => planEdit(a, long)).toThrow(LimitError);
  });
});

describe('planCreate', () => {
  it('creates labels first, then filters', () => {
    const plan = planCreate(
      [{ criteria: { from: 'x' }, action: { addLabelIds: ['new:Bills'] } }],
      ['Bills', 'Bills', ' '],
    );
    expect(plan.steps.map((s) => s.op)).toEqual(['createLabel', 'create']);
    expect(plan.title).toBe('Create 1 filter');
    expect(plan.filterDelta).toBe(1);
    expect(planCreate([b]).steps).toHaveLength(1);
  });

  it('checks the filter limit', () => {
    expect(() => planCreate([b], [], { total: 1000 })).toThrow(LimitError);
    expect(() => planCreate([long])).toThrow(LimitError);
  });
});
