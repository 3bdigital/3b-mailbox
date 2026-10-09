import { describe, expect, it, vi } from 'vitest';
import {
  API_BASE,
  GmailError,
  backoffDelay,
  createGmailClient,
  friendlyMessage,
  parseRetryAfter,
} from '../../../site/app/js/gmail/client.js';

function json(status, body, headers = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function apiError(status, message, reason, statusText) {
  return json(status, {
    error: {
      code: status,
      message,
      status: statusText,
      errors: reason ? [{ reason, message }] : undefined,
    },
  });
}

/** A fake fetch that answers from a queue of responses or a handler. */
function fakeFetch(handler) {
  const calls = [];
  const fn = vi.fn(async (url, init) => {
    calls.push({ url: String(url), init, body: init.body ? JSON.parse(init.body) : undefined });
    const out =
      typeof handler === 'function' ? handler(String(url), init, calls.length) : handler.shift();
    if (out instanceof Error) throw out;
    return out;
  });
  return { fn, calls };
}

function client(handler, extra = {}) {
  const f = fakeFetch(handler);
  const sleep = vi.fn(async () => {});
  const api = createGmailClient({
    getToken: () => 'tok',
    fetch: f.fn,
    sleep,
    random: () => 0.5,
    now: () => Date.parse('2026-10-09T10:00:00Z'),
    ...extra,
  });
  return { api, calls: f.calls, fetch: f.fn, sleep };
}

describe('endpoints', () => {
  it('listFilters returns [] when the filter key is absent', async () => {
    const { api, calls } = client([json(200, {})]);
    expect(await api.listFilters()).toEqual([]);
    expect(calls[0].url).toBe(`${API_BASE}/settings/filters`);
    expect(calls[0].init.method).toBe('GET');
    expect(calls[0].init.headers.Authorization).toBe('Bearer tok');
  });

  it('listFilters returns the filters', async () => {
    const filter = [{ id: 'a', criteria: { from: 'x' }, action: { addLabelIds: ['STARRED'] } }];
    const { api } = client([json(200, { filter })]);
    expect(await api.listFilters()).toEqual(filter);
  });

  it('createFilter posts criteria and action only', async () => {
    const { api, calls } = client([json(200, { id: 'new1', criteria: { from: 'x' }, action: {} })]);
    const made = await api.createFilter({ id: 'old', criteria: { from: 'x' }, action: {} });
    expect(made.id).toBe('new1');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers['Content-Type']).toBe('application/json');
    expect(calls[0].body).toEqual({ criteria: { from: 'x' }, action: {} });
  });

  it('createFilter fills in missing parts', async () => {
    const { api, calls } = client([json(200, { id: 'n' })]);
    await api.createFilter({});
    expect(calls[0].body).toEqual({ criteria: {}, action: {} });
  });

  it('deleteFilter sends DELETE and handles 204', async () => {
    const { api, calls } = client([new Response(null, { status: 204 })]);
    expect(await api.deleteFilter('a/b')).toBeUndefined();
    expect(calls[0].url).toBe(`${API_BASE}/settings/filters/a%2Fb`);
    expect(calls[0].init.method).toBe('DELETE');
  });

  it('handles a 200 with an empty body', async () => {
    const { api } = client([new Response('', { status: 200 })]);
    expect(await api.listLabels()).toEqual([]);
  });

  it('listLabels and createLabel', async () => {
    const { api, calls } = client([
      json(200, { labels: [{ id: 'L1', name: 'A', type: 'user' }] }),
      json(200, { id: 'L2', name: 'B', type: 'user' }),
    ]);
    expect(await api.listLabels()).toHaveLength(1);
    expect((await api.createLabel('B')).id).toBe('L2');
    expect(calls[1].url).toBe(`${API_BASE}/labels`);
    expect(calls[1].body).toEqual({
      name: 'B',
      labelListVisibility: 'labelShow',
      messageListVisibility: 'show',
    });
  });

  it('listForwardingAddresses copes with no key', async () => {
    const { api, calls } = client([
      json(200, {}),
      json(200, { forwardingAddresses: [{ forwardingEmail: 'a@example.com' }] }),
    ]);
    expect(await api.listForwardingAddresses()).toEqual([]);
    expect(await api.listForwardingAddresses()).toHaveLength(1);
    expect(calls[0].url).toBe(`${API_BASE}/settings/forwardingAddresses`);
  });

  it('refuses to call when there is no token', async () => {
    const { api, fetch } = client([], { getToken: () => null });
    const err = await api.listFilters().catch((e) => e);
    expect(err).toBeInstanceOf(GmailError);
    expect(err.status).toBe(401);
    expect(err.reason).toBe('notSignedIn');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses globalThis.fetch by default', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => json(200, { labels: [] }));
    try {
      const api = createGmailClient({ getToken: () => 't' });
      expect(await api.listLabels()).toEqual([]);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('retries', () => {
  it('retries 503 with exponential backoff and jitter', async () => {
    const { api, sleep, fetch } = client([
      apiError(503, 'Backend Error', 'backendError'),
      apiError(500, 'Backend Error'),
      apiError(502, 'Bad gateway'),
      json(200, { filter: [] }),
    ]);
    expect(await api.listFilters()).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(4);
    // base 1000, random 0.5: exp/2 + 0.5*exp/2 = 0.75*exp
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([750, 1500, 3000]);
  });

  it('stops after 5 attempts', async () => {
    const { api, sleep, fetch } = client(() => apiError(504, 'Timeout'));
    const err = await api.listLabels().catch((e) => e);
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(sleep).toHaveBeenCalledTimes(4);
    expect(err.status).toBe(504);
    expect(err.message).toMatch(/Gmail had a problem/);
  });

  it('honours Retry-After in seconds', async () => {
    const { api, sleep } = client([
      json(429, { error: { code: 429, message: 'Too many' } }, { 'Retry-After': '7' }),
      json(200, { labels: [] }),
    ]);
    await api.listLabels();
    expect(sleep).toHaveBeenCalledWith(7000);
  });

  it('honours Retry-After as an HTTP date', async () => {
    const { api, sleep } = client([
      json(429, {}, { 'Retry-After': 'Fri, 09 Oct 2026 10:00:12 GMT' }),
      json(200, { labels: [] }),
    ]);
    await api.listLabels();
    expect(sleep).toHaveBeenCalledWith(12000);
  });

  it('caps a very long Retry-After', async () => {
    const { api, sleep } = client([json(429, {}, { 'Retry-After': '99999' }), json(200, {})]);
    await api.listLabels();
    expect(sleep).toHaveBeenCalledWith(120000);
  });

  it('retries a 403 rate limit', async () => {
    const { api, fetch } = client([
      apiError(403, 'User Rate Limit Exceeded', 'userRateLimitExceeded'),
      json(200, {}),
    ]);
    await api.listFilters();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 400', async () => {
    const { api, fetch } = client(() => apiError(400, 'Filter already exists', 'invalidArgument'));
    const err = await api.createFilter({ criteria: { from: 'a' }, action: {} }).catch((e) => e);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(err.message).toBe('Gmail already has a filter that does exactly this.');
    expect(err.reason).toBe('invalidArgument');
    expect(err.detail).toBe('Filter already exists');
  });

  it('retries a network error on GET', async () => {
    const { api, fetch } = client([new TypeError('Failed to fetch'), json(200, {})]);
    await api.listLabels();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not retry a network error on a write', async () => {
    const { api, fetch } = client([new TypeError('Failed to fetch')]);
    const err = await api.createLabel('x').catch((e) => e);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(err.status).toBe(0);
    expect(err.reason).toBe('networkError');
    expect(err.message).toMatch(/internet connection/);
  });

  it('gives up on network errors after 5 GETs', async () => {
    const { api, fetch } = client(() => new TypeError('Failed to fetch'));
    await expect(api.listLabels()).rejects.toMatchObject({ status: 0 });
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  it('passes an AbortError through', async () => {
    const abort = new DOMException('Aborted', 'AbortError');
    const { api } = client([abort]);
    await expect(api.listLabels()).rejects.toBe(abort);
  });

  it('uses the real sleep by default', async () => {
    vi.useFakeTimers();
    try {
      const f = fakeFetch([apiError(503, 'x'), json(200, {})]);
      const api = createGmailClient({ getToken: () => 't', fetch: f.fn, random: () => 0 });
      const p = api.listLabels();
      await vi.advanceTimersByTimeAsync(500);
      await expect(p).resolves.toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('error mapping', () => {
  it('403 insufficient scope names the tier the call needs', async () => {
    const { api } = client(() =>
      apiError(403, 'Request had insufficient authentication scopes.', 'insufficientPermissions'),
    );
    const err = await api.searchMessages('x').catch((e) => e);
    expect(err.status).toBe(403);
    expect(err.tier).toBe('preview');
    expect(err.message).toBe(
      'This needs the "Preview matching mail" permission. Turn it on in Settings, then try again.',
    );
  });

  it('reads the reason from error.status when errors[] is missing', async () => {
    const { api } = client(() =>
      apiError(403, 'Scope missing', undefined, 'ACCESS_TOKEN_SCOPE_INSUFFICIENT'),
    );
    const err = await api.applyToExisting('x', [], []).catch((e) => e);
    expect(err.reason).toBe('ACCESS_TOKEN_SCOPE_INSUFFICIENT');
    expect(err.tier).toBe('apply');
    expect(err.message).toContain('"Apply filters to existing mail"');
  });

  it('copes with a body that is not JSON', async () => {
    const { api } = client([new Response('<html>oops</html>', { status: 400 })]);
    const err = await api.listFilters().catch((e) => e);
    expect(err.reason).toBe('');
    expect(err.message).toMatch(/did not accept this change/);
  });

  it.each([
    [400, '', 'The specified filter is too long', /too long for Gmail/],
    [400, '', 'Too many filters', /limit of 1,000 filters/],
    [400, '', 'Too many labels', /limit for labels/],
    [400, '', 'Unrecognized forwarding address', /forwarding address/],
    [400, '', 'Invalid label: Label_9', /label in this filter does not exist/],
    [400, '', "Filter doesn't have any criteria", /at least one search condition/],
    [400, '', 'Something else', /did not accept this change/],
    [401, '', 'Invalid Credentials', /Sign in again/],
    [
      403,
      '',
      'Forwarding is disabled by your administrator',
      /does not allow automatic forwarding/,
    ],
    [400, 'FAILED_PRECONDITION', 'Forwarding features disabled by domain policy', /administrator/],
    [
      403,
      'accessNotConfigured',
      'Gmail API has not been used in project 1',
      /Gmail API is not turned on/,
    ],
    [403, 'SERVICE_DISABLED', '', /Gmail API is not turned on/],
    [403, 'rateLimitExceeded', '', /busy/],
    [403, 'domainPolicy', '', /organisation does not allow this app/],
    [403, 'forbidden', 'Forbidden', /right account/],
    [403, '', 'Insufficient Permission', /"Manage filters" permission/],
    [404, 'notFound', 'Requested entity was not found.', /could not find/],
    [409, 'alreadyExists', 'Label name exists or conflicts', /already exists/],
    [429, '', '', /busy/],
    [500, '', '', /Gmail had a problem/],
    [418, '', '', /error 418/],
    [0, '', '', /internet connection/],
  ])('%i %s %s', (status, reason, detail, text) => {
    const msg = friendlyMessage(status, reason, detail);
    expect(msg).toMatch(text);
    // House style: no em dashes, straight quotes only.
    expect(msg).not.toMatch(/[—‘’“”]/);
  });

  it('friendlyMessage uses an unknown tier name as is', () => {
    expect(friendlyMessage(403, 'insufficientPermissions', '', 'other')).toContain('"other"');
  });

  it('friendlyMessage copes with empty input', () => {
    expect(friendlyMessage(400, undefined, undefined)).toMatch(/did not accept/);
  });

  it('GmailError has defaults', () => {
    const e = new GmailError('x');
    expect(e).toMatchObject({ status: 0, reason: '', detail: '', tier: null, name: 'GmailError' });
    expect(new GmailError('y', { cause: 1 }).cause).toBe(1);
  });
});

describe('parseRetryAfter and backoffDelay', () => {
  const now = Date.parse('2026-10-09T10:00:00Z');
  it.each([
    [null, null],
    [undefined, null],
    ['', null],
    ['  ', null],
    ['3', 3000],
    ['1.5', 1500],
    ['Fri, 09 Oct 2026 10:00:05 GMT', 5000],
    ['Fri, 09 Oct 2026 09:00:00 GMT', 0],
    ['soon', null],
  ])('%s', (value, expected) => {
    expect(parseRetryAfter(value, now)).toBe(expected);
  });

  it('uses Date.now by default', () => {
    expect(parseRetryAfter('2')).toBe(2000);
  });

  it('doubles and caps', () => {
    expect(backoffDelay(1, 1000, 32000, () => 0)).toBe(500);
    expect(backoffDelay(1, 1000, 32000, () => 1)).toBe(1000);
    expect(backoffDelay(3, 1000, 32000, () => 1)).toBe(4000);
    expect(backoffDelay(10, 1000, 32000, () => 1)).toBe(32000);
  });
});

function metadata(id, from, subject, date, extra = {}) {
  return json(200, {
    id,
    snippet: `snippet ${id}`,
    payload: {
      headers: [
        { name: 'From', value: from },
        { name: 'subject', value: subject },
        { name: 'Date', value: date },
      ],
    },
    ...extra,
  });
}

describe('searchMessages', () => {
  it('pages through messages.list and reads metadata', async () => {
    const { api, calls } = client((url) => {
      const u = new URL(url);
      if (u.pathname.endsWith('/messages')) {
        if (!u.searchParams.get('pageToken')) {
          return json(200, { messages: [{ id: 'm1' }, { id: 'm2' }], nextPageToken: 'p2' });
        }
        return json(200, { messages: [{ id: 'm3' }, { id: 'm4' }], nextPageToken: 'p3' });
      }
      const id = u.pathname.split('/').pop();
      return metadata(
        id,
        `Shop <${id}@example.com>`,
        `Hello ${id}`,
        'Thu, 08 Oct 2026 09:30:00 +0100',
        {
          internalDate: id === 'm1' ? '1791450000000' : undefined,
        },
      );
    });
    const out = await api.searchMessages('from:shop', 3);
    expect(out.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
    expect(out[0]).toEqual({
      id: 'm1',
      from: 'Shop <m1@example.com>',
      subject: 'Hello m1',
      date: new Date(1791450000000).toISOString(),
      snippet: 'snippet m1',
    });
    expect(out[1].date).toBe('2026-10-08T08:30:00.000Z');

    const list1 = new URL(calls[0].url);
    expect(list1.searchParams.get('q')).toBe('from:shop');
    expect(list1.searchParams.get('maxResults')).toBe('3');
    const list2 = new URL(calls[1].url);
    expect(list2.searchParams.get('pageToken')).toBe('p2');
    expect(list2.searchParams.get('maxResults')).toBe('1');
    const get = new URL(calls[2].url);
    expect(get.pathname).toBe('/gmail/v1/users/me/messages/m1');
    expect(get.searchParams.get('format')).toBe('metadata');
    expect(get.searchParams.getAll('metadataHeaders')).toEqual(['From', 'Subject', 'Date']);
    expect(calls).toHaveLength(5);
  });

  it('returns [] when nothing matches, and copes with odd metadata', async () => {
    const { api } = client([json(200, { resultSizeEstimate: 0 })]);
    expect(await api.searchMessages('nothing')).toEqual([]);

    const b = client([json(200, { messages: [{ id: 'x' }] }), json(200, { payload: {} })]);
    expect(await b.api.searchMessages('q', 0)).toEqual([
      { id: 'x', from: '', subject: '', date: '', snippet: '' },
    ]);
  });

  it('defaults to 20 results', async () => {
    const { api, calls } = client([json(200, {})]);
    await api.searchMessages('q');
    expect(new URL(calls[0].url).searchParams.get('maxResults')).toBe('20');
  });
});

describe('applyToExisting', () => {
  it('collects every id, then calls batchModify in chunks of 1000', async () => {
    const ids = Array.from({ length: 2500 }, (_, i) => ({ id: `m${i}` }));
    const { api, calls } = client((url) => {
      const u = new URL(url);
      if (u.pathname.endsWith('/batchModify')) return new Response(null, { status: 204 });
      const page = Number(u.searchParams.get('pageToken') ?? 0);
      const next = page + 1;
      return json(200, {
        messages: ids.slice(page * 500, next * 500),
        ...(next * 500 < ids.length ? { nextPageToken: String(next) } : {}),
      });
    });
    const progress = [];
    const n = await api.applyToExisting('from:a', ['Label_1'], ['INBOX'], (d) => progress.push(d));
    expect(n).toBe(2500);
    expect(progress).toEqual([1000, 2000, 2500]);
    const lists = calls.filter((c) => c.url.includes('/messages?'));
    expect(lists).toHaveLength(5);
    expect(new URL(lists[0].url).searchParams.get('maxResults')).toBe('500');
    const batches = calls.filter((c) => c.url.endsWith('/messages/batchModify'));
    expect(batches.map((b) => b.body.ids.length)).toEqual([1000, 1000, 500]);
    expect(batches[0].body).toMatchObject({ addLabelIds: ['Label_1'], removeLabelIds: ['INBOX'] });
    expect(batches[0].init.method).toBe('POST');
    // Every list call happens before the first modify.
    const firstBatch = calls.findIndex((c) => c.url.endsWith('/batchModify'));
    expect(calls.slice(firstBatch).every((c) => c.url.endsWith('/batchModify'))).toBe(true);
  });

  it('does nothing when no mail matches', async () => {
    const { api, calls } = client([json(200, {})]);
    expect(await api.applyToExisting('q', undefined, undefined)).toBe(0);
    expect(calls).toHaveLength(1);
  });

  it('sends empty arrays when add or remove is missing', async () => {
    const { api, calls } = client([json(200, { messages: [{ id: 'a' }] }), json(200, {})]);
    await api.applyToExisting('q', null, null);
    expect(calls[1].body).toEqual({ ids: ['a'], addLabelIds: [], removeLabelIds: [] });
  });
});

describe('request helper', () => {
  it('skips empty query values and supports arrays', async () => {
    const { api, calls } = client([json(200, {})]);
    await api.request('GET', 'messages', { query: { q: '', a: undefined, b: ['1', '2'], c: 3 } });
    expect(calls[0].url).toBe(`${API_BASE}/messages?b=1&b=2&c=3`);
  });
});
