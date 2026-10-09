import { describe, expect, it } from 'vitest';
import { createMockGmail, demoData } from '../../../site/app/js/gmail/mock.js';
import { orderSteps, runPlan } from '../../../site/app/js/gmail/executor.js';
import { planDelete, planEdit, planReplaceLabel } from '../../../site/app/js/core/bulk.js';
import { toJson, fromJson } from '../../../site/app/js/core/backup.js';
import {
  filterKey,
  journalBatches,
  planCombine,
  planDedupe,
  planRestoreBackup,
  planRestoreBatch,
  planUndo,
  remainingPlan,
} from '../../../site/app/js/ui/plans.js';

const data = demoData();
const byId = (id) => data.filters.find((f) => f.id === id);

/** Runs a plan on a fresh mock and returns the api, result and journal entries. */
async function run(plan, api = createMockGmail(demoData())) {
  const entries = [];
  const result = await runPlan(plan, api, { journal: { record: (e) => entries.push(e) } });
  return { api, result, entries };
}

describe('planUndo', () => {
  it('puts back a deleted filter', async () => {
    const plan = planDelete([byId('ANe1Bmj0057')], { total: 66 });
    const { api, result, entries } = await run(plan);
    const now = await api.listFilters();
    expect(now).toHaveLength(65);
    const undo = planUndo({ title: plan.title, created: result.created, entries }, now);
    expect(undo.steps.map((s) => s.op)).toEqual(['create']);
    const second = await runPlan(undo, api);
    expect(second.error).toBeNull();
    const after = await api.listFilters();
    expect(after).toHaveLength(66);
    expect(after.map(filterKey)).toContain(filterKey(byId('ANe1Bmj0057')));
  });

  it('reverses a replace: makes the old filter and deletes the new one', async () => {
    const previous = byId('ANe1Bmj0024');
    const plan = planEdit(previous, {
      criteria: { ...previous.criteria, subject: 'parcel' },
      action: previous.action,
    });
    const { api, result, entries } = await run(plan);
    const undo = planUndo(
      { title: plan.title, created: result.created, entries },
      await api.listFilters(),
    );
    expect(undo.steps.map((s) => s.op).sort()).toEqual(['create', 'delete']);
    await runPlan(undo, api);
    const keys = (await api.listFilters()).map(filterKey);
    expect(keys).toContain(filterKey(previous));
    expect(keys).not.toContain(filterKey(result.created[0]));
  });

  it('skips filters that are already back', () => {
    const f = byId('ANe1Bmj0057');
    const undo = planUndo({ title: 't', created: [], entries: [{ previous: f }] }, data.filters);
    expect(undo.steps).toEqual([]);
  });
});

describe('planRestoreBatch and journalBatches', () => {
  it('groups entries by batch, newest first, and restores one batch', async () => {
    const plan = planReplaceLabel(
      [byId('ANe1Bmj0055'), byId('ANe1Bmj0056')],
      'Label_2',
      'Label_6',
      { total: 66 },
    );
    const { api, entries } = await run(plan);
    const batches = journalBatches([...entries].reverse());
    expect(batches).toHaveLength(1);
    expect(batches[0].entries).toHaveLength(2);
    const restore = planRestoreBatch(batches[0].entries, await api.listFilters());
    expect(restore.title).toMatch(/^Restore the filters from before/);
    const r = await runPlan(restore, api);
    expect(r.error).toBeNull();
    const keys = (await api.listFilters()).map(filterKey);
    expect(keys).toContain(filterKey(byId('ANe1Bmj0055')));
  });
});

describe('planCombine and planDedupe', () => {
  it('combines the two github filters into one that does both', async () => {
    const pair = [byId('ANe1Bmj0003'), byId('ANe1Bmj0004')];
    const plan = planCombine(pair, { total: 66 });
    expect(plan.filterDelta).toBe(-1);
    const made = plan.steps.find((s) => s.op === 'create');
    expect(made.filter.action.addLabelIds).toContain('Label_11');
    expect(made.filter.action.removeLabelIds).toContain('UNREAD');
    const { result } = await run(plan);
    expect(result.error).toBeNull();
  });

  it('refuses to combine different forwarding addresses', () => {
    const a = { id: 'a', criteria: { from: 'x.com' }, action: { forward: 'a@example.com' } };
    const b = { id: 'b', criteria: { from: 'x.com' }, action: { forward: 'b@example.com' } };
    expect(() => planCombine([a, b])).toThrow(/different addresses/);
  });

  it('refuses important and not important together', () => {
    const a = { id: 'a', criteria: { from: 'x.com' }, action: { addLabelIds: ['IMPORTANT'] } };
    const b = { id: 'b', criteria: { from: 'x.com' }, action: { removeLabelIds: ['IMPORTANT'] } };
    expect(() => planCombine([a, b])).toThrow(/important/);
  });

  it('deletes every duplicate but the first', () => {
    const plan = planDedupe([byId('ANe1Bmj0001'), byId('ANe1Bmj0002')]);
    expect(plan.title).toBe('Delete 1 duplicate filter');
    expect(plan.steps).toEqual([
      { op: 'delete', filterId: 'ANe1Bmj0002', previous: byId('ANe1Bmj0002') },
    ]);
  });
});

describe('planRestoreBackup', () => {
  it('leaves out filters the account has and maps labels by name', () => {
    const extra = { criteria: { from: 'new@example.com' }, action: { addLabelIds: ['Label_500'] } };
    const backup = fromJson(
      toJson(
        [byId('ANe1Bmj0057'), extra],
        [...data.labels, { id: 'Label_500', name: 'Brand new', type: 'user' }],
      ),
    );
    const { plan, skipped } = planRestoreBackup(backup, data.filters, data.labels, { total: 66 });
    expect(skipped).toBe(1);
    expect(plan.steps).toEqual([
      { op: 'createLabel', name: 'Brand new' },
      {
        op: 'create',
        filter: {
          criteria: { from: 'new@example.com' },
          action: { addLabelIds: ['new:Brand new'] },
        },
      },
    ]);
  });

  it('maps a label with another id in this account to the right id', () => {
    const backup = {
      filters: [{ criteria: { from: 'z@example.com' }, action: { addLabelIds: ['OLD_7'] } }],
      labels: [{ id: 'OLD_7', name: 'shopping', type: 'user' }],
    };
    const { plan } = planRestoreBackup(backup, data.filters, data.labels);
    expect(plan.steps[0].filter.action.addLabelIds).toEqual(['Label_6']);
  });
});

describe('remainingPlan', () => {
  it('keeps label steps and the steps that did not run', () => {
    const plan = {
      title: 'x',
      filterDelta: 0,
      steps: [
        { op: 'delete', filterId: 'a', previous: {} },
        { op: 'createLabel', name: 'L' },
        { op: 'create', filter: { criteria: { from: 'a' }, action: { addLabelIds: ['new:L'] } } },
      ],
    };
    const ordered = orderSteps(plan.steps);
    const rest = remainingPlan(plan, ordered, 2);
    expect(rest.steps.map((s) => s.op)).toEqual(['createLabel', 'delete']);
    expect(rest.filterDelta).toBe(-1);
  });
});
