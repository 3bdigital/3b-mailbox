import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MOCK_LIMITS,
  createMockGmail,
  demoData,
  mockCriteriaString,
  parseSearch,
  searchDemoMessages,
} from '../../../site/app/js/gmail/mock.js';
import { GmailError } from '../../../site/app/js/gmail/client.js';

const labels = [
  { id: 'INBOX', name: 'INBOX', type: 'system' },
  { id: 'Label_1', name: 'Receipts', type: 'user' },
  { id: 'Label_7', name: 'Work/Team', type: 'user' },
];
const forwardingAddresses = [
  { forwardingEmail: 'ok@example.com', verificationStatus: 'accepted' },
  { forwardingEmail: 'wait@example.com', verificationStatus: 'pending' },
];
const star = { addLabelIds: ['STARRED'] };

function base(extra = {}) {
  return createMockGmail({ labels, forwardingAddresses, ...extra });
}

async function rejection(promise) {
  const err = await promise.catch((e) => e);
  expect(err).toBeInstanceOf(GmailError);
  return err;
}

describe('createMockGmail: data safety', () => {
  it('copies input and output so callers cannot change its state', async () => {
    const filters = [{ id: 'f1', criteria: { from: 'a' }, action: star }];
    const api = createMockGmail({ filters, labels, forwardingAddresses });
    filters[0].criteria.from = 'changed';
    const out = await api.listFilters();
    expect(out[0].criteria.from).toBe('a');
    out[0].criteria.from = 'changed again';
    expect((await api.listFilters())[0].criteria.from).toBe('a');
    const made = await api.createFilter({ criteria: { from: 'b' }, action: star });
    made.criteria.from = 'zzz';
    expect((await api.listFilters())[1].criteria.from).toBe('b');
    const snap = api.snapshot();
    snap.filters.length = 0;
    expect(await api.listFilters()).toHaveLength(2);
    const l = await api.listLabels();
    l[0].name = 'x';
    expect((await api.listLabels())[0].name).toBe('INBOX');
    const fa = await api.listForwardingAddresses();
    fa[0].verificationStatus = 'pending';
    expect((await api.listForwardingAddresses())[0].verificationStatus).toBe('accepted');
  });

  it('works with no options', async () => {
    const api = createMockGmail();
    expect(await api.listFilters()).toEqual([]);
    expect(await api.searchMessages('x')).toEqual([]);
  });

  it('records calls', async () => {
    const api = base();
    await api.listFilters();
    await api.listLabels();
    expect(api.calls()).toEqual(['listFilters', 'listLabels']);
  });
});

describe('createFilter rules', () => {
  it('gives each new filter an id', async () => {
    const api = base({ filters: [{ id: 'ANe1BmjM0001', criteria: { from: 'x' }, action: star }] });
    const made = await api.createFilter({ criteria: { from: 'a' }, action: star });
    expect(made.id).toBe('ANe1BmjM0002');
  });

  it('allows 1,000 filters and refuses the 1,001st', async () => {
    const filters = Array.from({ length: MOCK_LIMITS.maxFilters - 1 }, (_, i) => ({
      id: `f${i}`,
      criteria: { from: `s${i}@example.com` },
      action: star,
    }));
    const api = base({ filters });
    await api.createFilter({ criteria: { from: 'last@example.com' }, action: star });
    const err = await rejection(api.createFilter({ criteria: { from: 'one-more' }, action: star }));
    expect(err.status).toBe(400);
    expect(err.message).toMatch(/limit of 1,000 filters/);
  });

  it('refuses criteria over 1,469 characters', async () => {
    const api = base();
    const fits = 'a'.repeat(MOCK_LIMITS.criteriaCharsHard - 'from:()'.length);
    await api.createFilter({ criteria: { from: fits }, action: star });
    const err = await rejection(api.createFilter({ criteria: { from: `${fits}b` }, action: star }));
    expect(err.status).toBe(400);
    expect(err.detail).toBe('The specified filter is too long');
    expect(err.message).toMatch(/too long/);
  });

  it('refuses an identical filter, ignoring key and label order', async () => {
    const api = base();
    await api.createFilter({
      criteria: { from: 'a', subject: 'b' },
      action: { addLabelIds: ['STARRED', 'Label_1'] },
    });
    const err = await rejection(
      api.createFilter({
        criteria: { subject: 'b ', from: 'a', hasAttachment: false },
        action: { addLabelIds: ['Label_1', 'STARRED'] },
      }),
    );
    expect(err.detail).toBe('Filter already exists');
    // Same criteria with a different action is fine.
    await api.createFilter({
      criteria: { from: 'a', subject: 'b' },
      action: { addLabelIds: ['Label_1'] },
    });
  });

  it('refuses an unknown label ID in add or remove', async () => {
    const api = base();
    const a = await rejection(
      api.createFilter({ criteria: { from: 'a' }, action: { addLabelIds: ['Label_99'] } }),
    );
    expect(a.status).toBe(400);
    expect(a.message).toMatch(/label/);
    await rejection(
      api.createFilter({ criteria: { from: 'a' }, action: { removeLabelIds: ['Nope'] } }),
    );
    // System labels are valid even when the label list leaves them out.
    await api.createFilter({
      criteria: { from: 'a' },
      action: { addLabelIds: ['TRASH', 'Label_7'] },
    });
  });

  it('refuses a forward to an address that is not accepted', async () => {
    const api = base();
    for (const forward of ['wait@example.com', 'stranger@example.com']) {
      const err = await rejection(
        api.createFilter({ criteria: { from: 'a' }, action: { forward } }),
      );
      expect(err.status).toBe(400);
      expect(err.message).toMatch(/forwarding address/);
    }
    const ok = await api.createFilter({
      criteria: { from: 'a' },
      action: { forward: 'OK@example.com' },
    });
    expect(ok.action.forward).toBe('OK@example.com');
  });

  it('refuses empty criteria or an empty action', async () => {
    const api = base();
    await rejection(api.createFilter({ criteria: {}, action: star }));
    await rejection(api.createFilter({ criteria: { from: 'a' }, action: {} }));
    await rejection(api.createFilter(undefined));
  });
});

describe('deleteFilter, labels and forwarding', () => {
  it('deletes a filter and returns 404 for an unknown one', async () => {
    const api = base({ filters: [{ id: 'f1', criteria: { from: 'a' }, action: star }] });
    await api.deleteFilter('f1');
    expect(await api.listFilters()).toEqual([]);
    const err = await rejection(api.deleteFilter('f1'));
    expect(err.status).toBe(404);
  });

  it('creates labels with the next free ID', async () => {
    const api = base();
    const label = await api.createLabel('  Bills ');
    expect(label).toEqual({
      id: 'Label_8',
      name: 'Bills',
      type: 'user',
      labelListVisibility: 'labelShow',
      messageListVisibility: 'show',
    });
    expect((await api.createLabel('Bills/Water')).id).toBe('Label_9');
  });

  it('refuses a duplicate, reserved or empty label name', async () => {
    const api = base();
    expect((await rejection(api.createLabel('receipts'))).status).toBe(409);
    expect((await rejection(api.createLabel('Inbox'))).status).toBe(400);
    expect((await rejection(api.createLabel(''))).status).toBe(400);
    expect((await rejection(api.createLabel(undefined))).status).toBe(400);
  });

  it('refuses a label over the label limit', async () => {
    const many = Array.from({ length: MOCK_LIMITS.maxLabels }, (_, i) => ({
      id: `Label_${i + 1}`,
      name: `L${i}`,
      type: 'user',
    }));
    const api = createMockGmail({ labels: many });
    const err = await rejection(api.createLabel('One more'));
    expect(err.message).toMatch(/limit for labels/);
  });
});

describe('failOn and latency', () => {
  afterEach(() => vi.useRealTimers());

  it('fails the Nth call of a method', async () => {
    const api = base({ failOn: { method: 'listLabels', nth: 2, status: 503 } });
    await api.listFilters();
    await api.listLabels();
    const err = await rejection(api.listLabels());
    expect(err.status).toBe(503);
    await api.listLabels();
  });

  it('fails the Nth call overall, more than once with times', async () => {
    const api = base({
      failOn: { nth: 2, times: 2, status: 500, reason: 'backendError', message: 'Backend' },
    });
    await api.listFilters();
    const err = await rejection(api.listLabels());
    expect(err).toMatchObject({ status: 500, reason: 'backendError', detail: 'Backend' });
    await rejection(api.listForwardingAddresses());
    await api.listFilters();
  });

  it('takes a list of rules', async () => {
    const api = base({
      failOn: [
        { method: 'listFilters', status: 401 },
        { method: 'listLabels', status: 403, reason: 'insufficientPermissions' },
      ],
    });
    expect((await rejection(api.listFilters())).status).toBe(401);
    expect((await rejection(api.listLabels())).message).toMatch(/permission/);
  });

  it('takes a function', async () => {
    const seen = [];
    const api = base({
      failOn: (method, n, args) => {
        seen.push([method, n, args]);
        return method === 'deleteFilter' ? { status: 404 } : null;
      },
    });
    await api.listFilters();
    expect((await rejection(api.deleteFilter('x'))).status).toBe(404);
    expect(seen).toEqual([
      ['listFilters', 1, []],
      ['deleteFilter', 2, ['x']],
    ]);
  });

  it('waits latencyMs before each call', async () => {
    vi.useFakeTimers();
    const api = base({ latencyMs: 200 });
    let done = false;
    const p = api.listFilters().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(199);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(done).toBe(true);
  });
});

describe('mockCriteriaString', () => {
  it('builds one search string from every field', () => {
    expect(
      mockCriteriaString({
        from: 'a',
        to: 'b',
        subject: 'c',
        query: 'd',
        negatedQuery: 'e',
        hasAttachment: true,
        excludeChats: true,
        size: 100,
        sizeComparison: 'larger',
      }),
    ).toBe('from:(a) to:(b) subject:(c) d -{e} has:attachment -in:chats larger:100');
    expect(mockCriteriaString({ size: 5, sizeComparison: 'unspecified' })).toBe('');
    expect(mockCriteriaString()).toBe('');
  });
});

describe('search matcher', () => {
  const data = demoData();
  const msgs = data.messages;
  const search = (q) => searchDemoMessages(msgs, q, { labels: data.labels });

  it('parses the main forms', () => {
    expect(parseSearch('')).toEqual({ type: 'and', items: [] });
    expect(parseSearch('a OR b')).toMatchObject({
      type: 'or',
      items: [{ value: 'a' }, { value: 'b' }],
    });
    expect(parseSearch('-a')).toMatchObject({ type: 'not', item: { value: 'a' } });
    expect(parseSearch('subject:"a b"')).toMatchObject({
      type: 'op',
      name: 'subject',
      value: { type: 'term', value: 'a b', quoted: true },
    });
    expect(parseSearch('from:(a | b)')).toMatchObject({ type: 'op', value: { type: 'or' } });
    expect(parseSearch('{a b}')).toMatchObject({ type: 'or', items: [{}, {}] });
    expect(parseSearch('a AND b')).toMatchObject({ type: 'and', items: [{}, {}] });
    expect(parseSearch('"unclosed')).toMatchObject({ type: 'term', value: 'unclosed' });
  });

  it('matches from:, to:, subject: and plain words', () => {
    const amazon = search('from:amazon.co.uk');
    expect(amazon.length).toBeGreaterThan(0);
    expect(amazon.every((m) => m.from.includes('amazon.co.uk'))).toBe(true);
    expect(search('to:sam.jones@example.com')).toHaveLength(msgs.length);
    expect(search('subject:statement').every((m) => /statement/i.test(m.subject))).toBe(true);
    expect(search('parcel').length).toBeGreaterThan(0);
  });

  it('matches quoted phrases, OR, braces and negation', () => {
    const unsub = search('"unsubscribe"');
    expect(unsub.length).toBeGreaterThan(10);
    expect(unsub.every((m) => /unsubscribe/i.test(m.body))).toBe(true);
    const either = search('from:(monzo.com OR starlingbank.com)');
    expect(either.length).toBe(
      search('from:monzo.com').length + search('from:starlingbank.com').length,
    );
    expect(search('{from:monzo.com from:starlingbank.com}')).toHaveLength(either.length);
    const notGithub = search('-from:github.com');
    expect(notGithub.length).toBe(msgs.length - search('from:github.com').length);
    expect(search('subject:"council tax"').every((m) => /council tax/i.test(m.subject))).toBe(true);
  });

  it('matches has:, list:, is:, in:, category:, label:, size and age', () => {
    expect(search('has:attachment').every((m) => m.hasAttachment)).toBe(true);
    expect(search('has:attachment').length).toBeGreaterThan(0);
    expect(search('list:github.com').every((m) => m.list)).toBe(true);
    expect(search('list:github.com').length).toBeGreaterThan(0);
    expect(search('is:unread').every((m) => m.labelIds.includes('UNREAD'))).toBe(true);
    expect(search('is:read').length + search('is:unread').length).toBe(msgs.length);
    expect(search('is:starred').length + search('-is:starred').length).toBe(msgs.length);
    expect(search('is:important')).toEqual([]);
    expect(search('is:muted')).toEqual([]);
    expect(search('in:inbox')).toHaveLength(msgs.length);
    expect(search('in:anywhere')).toHaveLength(msgs.length);
    expect(search('category:promotions').length).toBeGreaterThan(0);
    expect(search('label:receipts')).toEqual([]);
    expect(search('has:nouserlabels')).toHaveLength(msgs.length);
    expect(search('has:userlabels')).toEqual([]);
    expect(search('has:yellow-star')).toEqual([]);
    expect(search('larger:100K').every((m) => m.size > 100 * 1024)).toBe(true);
    expect(search('smaller:1M')).toHaveLength(msgs.length);
    expect(search('larger:big')).toHaveLength(msgs.length);
    const week = search('newer_than:7d');
    expect(week.length).toBeGreaterThan(0);
    expect(week.length + search('older_than:7d').length).toBe(msgs.length);
    expect(search('older_than:1y')).toEqual([]);
    expect(search('newer_than:soon')).toEqual([]);
    expect(search('filename:ics').every((m) => m.hasAttachment)).toBe(true);
    expect(search('filename:pdf').every((m) => m.hasAttachment)).toBe(true);
    expect(search('deliveredto:sam.jones@example.com')).toHaveLength(msgs.length);
    expect(search('weird:thing')).toEqual([]);
  });

  it('returns newest first and skips spam and trash', () => {
    const all = search('');
    expect(all).toHaveLength(msgs.length);
    for (let i = 1; i < all.length; i++) expect(all[i - 1].date >= all[i].date).toBe(true);
    const trashed = [{ ...msgs[0], labelIds: ['TRASH'] }];
    expect(searchDemoMessages(trashed, '')).toEqual([]);
    expect(searchDemoMessages(msgs, undefined)).toHaveLength(msgs.length);
  });

  it('finds label: by name', () => {
    const tagged = [{ ...msgs[0], labelIds: ['Label_2'] }];
    expect(
      searchDemoMessages(tagged, 'label:finance/receipts', { labels: data.labels }),
    ).toHaveLength(1);
    expect(searchDemoMessages(tagged, 'label:kids-clubs', { labels: data.labels })).toHaveLength(0);
    expect(searchDemoMessages(tagged, 'has:userlabels', { labels: data.labels })).toHaveLength(1);
  });
});

describe('searchMessages and applyToExisting', () => {
  it('searchMessages returns MessagePreview objects, max 20 by default', async () => {
    const api = createMockGmail(demoData());
    const out = await api.searchMessages('from:github.com');
    expect(out.length).toBeLessThanOrEqual(20);
    expect(Object.keys(out[0]).sort()).toEqual(['date', 'from', 'id', 'snippet', 'subject']);
    expect(await api.searchMessages('from:github.com', 2)).toHaveLength(2);
  });

  it('applyToExisting changes labels and reports progress', async () => {
    const api = createMockGmail(demoData());
    const progress = [];
    const count = await api.applyToExisting('from:amazon.co.uk', ['Label_2'], ['INBOX'], (n) =>
      progress.push(n),
    );
    expect(count).toBeGreaterThan(0);
    expect(progress).toEqual([count]);
    const amazon = api.snapshot().messages.filter((m) => m.from.includes('amazon.co.uk'));
    expect(
      amazon.every((m) => m.labelIds.includes('Label_2') && !m.labelIds.includes('INBOX')),
    ).toBe(true);
    expect(await api.searchMessages('in:inbox from:amazon.co.uk')).toEqual([]);
  });

  it('applyToExisting works without arrays or callback and checks labels', async () => {
    const api = createMockGmail(demoData());
    expect(await api.applyToExisting('nothing-matches-this', undefined, undefined)).toBe(0);
    const err = await rejection(api.applyToExisting('x', ['Label_99'], []));
    expect(err.status).toBe(400);
  });

  it('reports progress per 1,000 messages', async () => {
    const one = demoData().messages[0];
    const messages = Array.from({ length: 2300 }, (_, i) => ({ ...one, id: `m${i}` }));
    const api = createMockGmail({ messages });
    const progress = [];
    expect(await api.applyToExisting('', ['STARRED'], [], (n) => progress.push(n))).toBe(2300);
    expect(progress).toEqual([1000, 2000, 2300]);
  });
});
