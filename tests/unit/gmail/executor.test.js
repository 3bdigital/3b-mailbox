import { describe, expect, it, vi } from 'vitest';
import {
  PlanError,
  orderSteps,
  resolvePlaceholders,
  runPlan,
} from '../../../site/app/js/gmail/executor.js';
import { createMockGmail } from '../../../site/app/js/gmail/mock.js';
import { GmailError } from '../../../site/app/js/gmail/client.js';

const labels = [
  { id: 'INBOX', name: 'INBOX', type: 'system' },
  { id: 'Label_1', name: 'Receipts', type: 'user' },
];

const old1 = {
  id: 'f1',
  criteria: { from: 'a@example.com' },
  action: { addLabelIds: ['Label_1'] },
};
const old2 = {
  id: 'f2',
  criteria: { from: 'b@example.com' },
  action: { addLabelIds: ['Label_1'] },
};
const old3 = {
  id: 'f3',
  criteria: { from: 'c@example.com' },
  action: { removeLabelIds: ['INBOX'] },
};

function mock(extra = {}) {
  return createMockGmail({ filters: [old1, old2, old3], labels, ...extra });
}

/** Wraps an api so every call goes into one shared log, with a journal in the same log. */
function traced(api) {
  const log = [];
  const wrapped = {};
  for (const [name, fn] of Object.entries(api)) {
    wrapped[name] = async (...args) => {
      log.push([name, ...args.map((a) => (typeof a === 'string' ? a : (a?.criteria?.from ?? a)))]);
      return fn(...args);
    };
  }
  const journal = { record: vi.fn((entry) => log.push(['journal', entry.op, entry.filterId])) };
  return { api: wrapped, log, journal };
}

describe('orderSteps', () => {
  it('puts createLabel first, delete last, and keeps plan order in between', () => {
    const steps = [
      { op: 'delete', filterId: 'x', previous: old1 },
      { op: 'create', filter: { criteria: { from: '1' }, action: {} } },
      { op: 'createLabel', name: 'A' },
      { op: 'replace', filterId: 'y', previous: old2, filter: old2 },
      { op: 'create', filter: { criteria: { from: '2' }, action: {} } },
      { op: 'createLabel', name: 'B' },
    ];
    expect(orderSteps(steps).map((s) => s.op + (s.name ?? s.filter?.criteria.from ?? ''))).toEqual([
      'createLabelA',
      'createLabelB',
      'create1',
      'replaceb@example.com',
      'create2',
      'delete',
    ]);
  });
});

describe('resolvePlaceholders', () => {
  it('swaps new:<name> in add and remove lists and leaves the input alone', () => {
    const filter = {
      criteria: { from: 'x' },
      action: { addLabelIds: ['new:Bills', 'STARRED'], removeLabelIds: ['new:Bills'] },
    };
    const out = resolvePlaceholders(filter, new Map([['Bills', 'Label_7']]));
    expect(out.action).toEqual({
      addLabelIds: ['Label_7', 'STARRED'],
      removeLabelIds: ['Label_7'],
    });
    expect(filter.action.addLabelIds[0]).toBe('new:Bills');
  });

  it('throws a PlanError for a label that was not made', () => {
    expect(() =>
      resolvePlaceholders({ criteria: {}, action: { addLabelIds: ['new:Nope'] } }, new Map()),
    ).toThrow(PlanError);
  });
});

describe('runPlan', () => {
  it('runs every step in the right order and journals before each delete', async () => {
    const { api, log, journal } = traced(mock());
    const plan = {
      title: 'Tidy up',
      filterDelta: 0,
      steps: [
        { op: 'delete', filterId: 'f3', previous: old3 },
        {
          op: 'replace',
          filterId: 'f1',
          previous: old1,
          filter: { criteria: { from: 'a@example.com' }, action: { addLabelIds: ['new:Bills'] } },
        },
        { op: 'createLabel', name: 'Bills' },
        {
          op: 'create',
          filter: { criteria: { from: 'new@example.com' }, action: { addLabelIds: ['STARRED'] } },
        },
      ],
    };
    const progress = [];
    const result = await runPlan(plan, api, {
      journal,
      onProgress: (p) => progress.push([p.done, p.total, p.step.op]),
      now: () => Date.parse('2026-10-09T10:00:00Z'),
    });
    expect(result.error).toBeNull();
    expect(result.failed).toBeNull();
    expect(result.done).toBe(4);
    expect(log.map((l) => l.slice(0, 2).join(' '))).toEqual([
      'createLabel Bills',
      'createFilter a@example.com',
      'journal replace',
      'deleteFilter f1',
      'createFilter new@example.com',
      'journal delete',
      'deleteFilter f3',
    ]);
    expect(progress).toEqual([
      [1, 4, 'createLabel'],
      [2, 4, 'replace'],
      [3, 4, 'create'],
      [4, 4, 'delete'],
    ]);
    expect(result.created).toHaveLength(2);
    expect(result.created[0].action.addLabelIds[0]).toMatch(/^Label_\d+$/);
    expect(result.created[0].id).toBeTruthy();

    const entry = journal.record.mock.calls[0][0];
    expect(entry).toMatchObject({
      title: 'Tidy up',
      op: 'replace',
      filterId: 'f1',
      previous: old1,
      time: '2026-10-09T10:00:00.000Z',
    });
    expect(entry.replacement.id).toBe(result.created[0].id);
    expect(journal.record.mock.calls[1][0].batch).toBe(entry.batch);
    expect(journal.record.mock.calls[1][0].replacement).toBeUndefined();
  });

  it('works without a journal or options', async () => {
    const api = mock();
    const result = await runPlan(
      { title: 'x', filterDelta: -1, steps: [{ op: 'delete', filterId: 'f1', previous: old1 }] },
      api,
    );
    expect(result).toEqual({ done: 1, failed: null, error: null, created: [] });
    expect(api.snapshot().filters.map((f) => f.id)).toEqual(['f2', 'f3']);
  });

  it('handles an empty or missing plan', async () => {
    expect(await runPlan({ title: '', steps: [], filterDelta: 0 }, mock())).toMatchObject({
      done: 0,
    });
    expect(await runPlan(undefined, mock())).toMatchObject({ done: 0, error: null });
  });

  it('journals a placeholder previous when the step has none', async () => {
    const journal = { record: vi.fn() };
    await runPlan(
      { title: 't', steps: [{ op: 'delete', filterId: 'f2' }], filterDelta: -1 },
      mock(),
      {
        journal,
      },
    );
    expect(journal.record.mock.calls[0][0].previous).toEqual({
      id: 'f2',
      criteria: {},
      action: {},
    });
  });

  it('stops at the first failure and reports what finished', async () => {
    const api = mock({
      failOn: { method: 'createFilter', nth: 2, status: 400, message: 'Filter already exists' },
    });
    const plan = {
      title: 'Make 3',
      filterDelta: 3,
      steps: [1, 2, 3].map((n) => ({
        op: 'create',
        filter: { criteria: { from: `${n}@example.com` }, action: { addLabelIds: ['STARRED'] } },
      })),
    };
    const result = await runPlan(plan, api);
    expect(result.done).toBe(1);
    expect(result.failed).toBe(plan.steps[1]);
    expect(result.error).toBeInstanceOf(GmailError);
    expect(result.error.message).toBe('Gmail already has a filter that does exactly this.');
    expect(result.created.map((f) => f.criteria.from)).toEqual(['1@example.com']);
    expect(api.calls().filter((c) => c === 'createFilter')).toHaveLength(2);
  });

  it('does not delete anything when a create fails first', async () => {
    const api = mock({ failOn: { method: 'createFilter', status: 500 } });
    const result = await runPlan(
      {
        title: 'Edit',
        filterDelta: 0,
        steps: [
          {
            op: 'replace',
            filterId: 'f1',
            previous: old1,
            filter: { criteria: { from: 'z' }, action: { addLabelIds: ['STARRED'] } },
          },
          { op: 'delete', filterId: 'f2', previous: old2 },
        ],
      },
      api,
    );
    expect(result.done).toBe(0);
    expect(result.failed.op).toBe('replace');
    expect(api.calls()).not.toContain('deleteFilter');
    expect(api.snapshot().filters).toHaveLength(3);
  });

  it('explains a replace whose delete failed: both filters now exist', async () => {
    const api = mock({ failOn: { method: 'deleteFilter', status: 503 } });
    const step = {
      op: 'replace',
      filterId: 'f1',
      previous: old1,
      filter: {
        criteria: { from: 'a@example.com', subject: 'bill' },
        action: { addLabelIds: ['Label_1'] },
      },
    };
    const result = await runPlan({ title: 'Edit', filterDelta: 0, steps: [step] }, api);
    expect(result.done).toBe(0);
    expect(result.failed).toBe(step);
    expect(result.error).toBeInstanceOf(PlanError);
    expect(result.error.code).toBe('replace-delete-failed');
    expect(result.error.message).toMatch(/You now have both filters\. Nothing is lost\./);
    expect(result.error.cause).toBeInstanceOf(GmailError);
    expect(result.created).toHaveLength(1);
    expect(api.snapshot().filters).toHaveLength(4);
  });

  it('does not delete when the journal fails', async () => {
    const api = mock();
    const journal = {
      record: () => {
        throw new Error('QuotaExceededError');
      },
    };
    const result = await runPlan(
      {
        title: 'Delete',
        filterDelta: -1,
        steps: [{ op: 'delete', filterId: 'f1', previous: old1 }],
      },
      api,
      { journal },
    );
    expect(result.error.code).toBe('journal-failed');
    expect(result.error.message).toMatch(/was not deleted/);
    expect(api.calls()).not.toContain('deleteFilter');
  });

  it('awaits an async journal before the delete', async () => {
    const order = [];
    const api = mock();
    const realDelete = api.deleteFilter;
    api.deleteFilter = async (id) => {
      order.push('delete');
      return realDelete(id);
    };
    const journal = {
      record: async () => {
        await new Promise((r) => setTimeout(r, 5));
        order.push('journal');
      },
    };
    await runPlan(
      { title: 'd', filterDelta: -1, steps: [{ op: 'delete', filterId: 'f1', previous: old1 }] },
      api,
      {
        journal,
      },
    );
    expect(order).toEqual(['journal', 'delete']);
  });

  it('fails a step whose placeholder label was never made', async () => {
    const result = await runPlan(
      {
        title: 'x',
        filterDelta: 1,
        steps: [
          {
            op: 'create',
            filter: { criteria: { from: 'q' }, action: { addLabelIds: ['new:Ghost'] } },
          },
        ],
      },
      mock(),
    );
    expect(result.error.code).toBe('missing-label');
    expect(result.error.message).toContain('"Ghost"');
  });

  it('uses an existing label when createLabel says it exists (409)', async () => {
    const api = mock();
    const result = await runPlan(
      {
        title: 'x',
        filterDelta: 1,
        steps: [
          { op: 'createLabel', name: 'receipts' },
          {
            op: 'create',
            filter: { criteria: { from: 'q' }, action: { addLabelIds: ['new:receipts'] } },
          },
        ],
      },
      api,
    );
    expect(result.error).toBeNull();
    expect(result.created[0].action.addLabelIds).toEqual(['Label_1']);
  });

  it('fails when createLabel says 409 but the label cannot be found', async () => {
    const api = mock({ failOn: { method: 'createLabel', status: 409 } });
    const result = await runPlan(
      { title: 'x', filterDelta: 0, steps: [{ op: 'createLabel', name: 'New' }] },
      api,
    );
    expect(result.failed.op).toBe('createLabel');
    expect(result.error.status).toBe(409);
  });

  it('fails on other createLabel errors', async () => {
    const api = mock({ failOn: { method: 'createLabel', status: 500 } });
    const result = await runPlan(
      { title: 'x', filterDelta: 0, steps: [{ op: 'createLabel', name: 'New' }] },
      api,
    );
    expect(result.error.status).toBe(500);
    expect(api.calls()).not.toContain('listLabels');
  });

  it('stops before the first step when the signal is already aborted', async () => {
    const api = mock();
    const ctrl = new AbortController();
    ctrl.abort();
    const result = await runPlan(
      { title: 'x', filterDelta: -1, steps: [{ op: 'delete', filterId: 'f1', previous: old1 }] },
      api,
      { signal: ctrl.signal },
    );
    expect(result).toMatchObject({ done: 0, failed: null, created: [] });
    expect(result.error.code).toBe('aborted');
    expect(result.error.message).toBe('Stopped. 0 of 1 changes are done.');
    expect(api.calls()).toEqual([]);
  });

  it('stops between steps when aborted part way', async () => {
    const api = mock();
    const ctrl = new AbortController();
    const steps = [
      { op: 'delete', filterId: 'f1', previous: old1 },
      { op: 'delete', filterId: 'f2', previous: old2 },
      { op: 'delete', filterId: 'f3', previous: old3 },
    ];
    const result = await runPlan({ title: 'x', filterDelta: -3, steps }, api, {
      signal: ctrl.signal,
      onProgress: ({ done }) => done === 2 && ctrl.abort(),
    });
    expect(result.done).toBe(2);
    expect(result.error.message).toBe('Stopped. 2 of 3 changes are done.');
    expect(api.snapshot().filters.map((f) => f.id)).toEqual(['f3']);
  });

  it('rejects an unknown step', async () => {
    const result = await runPlan({ title: 'x', filterDelta: 0, steps: [{ op: 'rename' }] }, mock());
    expect(result.error.code).toBe('step-failed');
  });

  it('wraps a thrown value that is not an Error', async () => {
    const api = {
      createFilter: async () => {
        throw 'boom';
      },
    };
    const result = await runPlan(
      {
        title: 'x',
        filterDelta: 1,
        steps: [{ op: 'create', filter: { criteria: { from: 'a' }, action: {} } }],
      },
      api,
    );
    expect(result.error).toBeInstanceOf(PlanError);
    expect(result.error.message).toBe('boom 0 of 1 changes are done.');
  });

  it('includes a non-Error cause in the replace message', async () => {
    const api = {
      createFilter: async (f) => ({ ...f, id: 'n1' }),
      deleteFilter: async () => {
        throw 'gone';
      },
    };
    const result = await runPlan(
      {
        title: 'x',
        filterDelta: 0,
        steps: [{ op: 'replace', filterId: 'f', previous: old1, filter: old1 }],
      },
      api,
    );
    expect(result.error.message).toContain('(gone)');
  });

  it('runs writes one at a time', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const api = {
      createFilter: async (f) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 2));
        inFlight--;
        return { ...f, id: String(Math.random()) };
      },
    };
    const steps = Array.from({ length: 5 }, (_, i) => ({
      op: 'create',
      filter: { criteria: { from: `${i}` }, action: {} },
    }));
    await runPlan({ title: 'x', filterDelta: 5, steps }, api);
    expect(maxInFlight).toBe(1);
  });
});
