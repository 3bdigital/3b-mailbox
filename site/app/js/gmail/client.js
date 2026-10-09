// @ts-check
// Gmail API v1 client over fetch. Implements the GmailApi contract from ../types.js.
// It never logs message content.

/** @typedef {import('../types.js').Filter} Filter */
/** @typedef {import('../types.js').Label} Label */
/** @typedef {import('../types.js').ForwardingAddress} ForwardingAddress */
/** @typedef {import('../types.js').MessagePreview} MessagePreview */
/** @typedef {import('../types.js').GmailApi} GmailApi */
/** @typedef {import('../types.js').PermissionTier} PermissionTier */

/** Base URL for every call. */
export const API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

/** HTTP statuses that we retry. */
export const RETRY_STATUSES = Object.freeze([429, 500, 502, 503, 504]);

/** 403 reasons that mean "slow down" (Gmail sometimes uses 403 for rate limits). */
const RATE_LIMIT_REASONS = ['rateLimitExceeded', 'userRateLimitExceeded'];

/** The most ids that messages.batchModify takes in one call. */
export const BATCH_MODIFY_MAX = 1000;

/** The most results that messages.list returns in one page. */
export const LIST_PAGE_MAX = 500;

const TIER_LABELS = {
  basic: 'Manage filters',
  preview: 'Preview matching mail',
  apply: 'Apply filters to existing mail',
};

/** A Gmail API problem with a plain English message. */
export class GmailError extends Error {
  /**
   * @param {string} message                Plain English, safe to show.
   * @param {{status?: number, reason?: string, detail?: string, tier?: PermissionTier|null, cause?: unknown}} [info]
   */
  constructor(message, info = {}) {
    super(message);
    this.name = 'GmailError';
    /** HTTP status, or 0 for a network problem. */
    this.status = info.status ?? 0;
    /** Google's reason, for example 'insufficientPermissions' or 'FAILED_PRECONDITION'. */
    this.reason = info.reason ?? '';
    /** Google's own message (English, technical). Never contains mail content. */
    this.detail = info.detail ?? '';
    /** The permission tier this call needs, when a scope is missing. */
    this.tier = info.tier ?? null;
    if (info.cause !== undefined) this.cause = info.cause;
  }
}

/**
 * Turns an HTTP status and Google's error into a plain English message.
 * @param {number} status
 * @param {string} reason
 * @param {string} detail       Google's message.
 * @param {PermissionTier} [tier]  The tier the call needs.
 * @returns {string}
 */
export function friendlyMessage(status, reason, detail, tier = 'basic') {
  const d = String(detail || '').toLowerCase();
  const r = String(reason || '');
  if (status === 0) return 'Could not reach Gmail. Check your internet connection, then try again.';
  if (
    d.includes('forward') &&
    (d.includes('admin') || d.includes('disabled') || d.includes('policy') || d.includes('domain'))
  ) {
    return 'Your organisation does not allow automatic forwarding. Filters that forward mail are blocked. Ask your administrator if you need this.';
  }
  if (status === 400) {
    if (d.includes('too long')) {
      return 'This filter is too long for Gmail. Make the search shorter, or split it into two filters.';
    }
    if (d.includes('already exists')) return 'Gmail already has a filter that does exactly this.';
    if (d.includes('too many filters') || d.includes('filter limit')) {
      return 'You have reached the Gmail limit of 1,000 filters. Delete or merge some filters first.';
    }
    if (d.includes('too many labels') || d.includes('label limit')) {
      return 'You have reached the Gmail limit for labels. Delete some labels first.';
    }
    if (d.includes('forward')) {
      return 'Gmail does not accept this forwarding address. Add and verify the address in Gmail settings first.';
    }
    if (d.includes('label')) {
      return 'A label in this filter does not exist. Pick the label again, then save.';
    }
    if (d.includes('criteria') || d.includes('action')) {
      return 'This filter needs at least one search condition and at least one action.';
    }
    return 'Gmail did not accept this change. Check the filter, then try again.';
  }
  if (status === 401) return 'Your sign-in has ended. Sign in again to continue.';
  if (status === 403) {
    if (
      r === 'insufficientPermissions' ||
      r === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' ||
      d.includes('insufficient authentication scopes') ||
      d.includes('insufficient permission')
    ) {
      return `This needs the "${TIER_LABELS[tier] ?? tier}" permission. Turn it on in Settings, then try again.`;
    }
    if (
      r === 'accessNotConfigured' ||
      r === 'SERVICE_DISABLED' ||
      d.includes('has not been used') ||
      d.includes('is disabled')
    ) {
      return 'The Gmail API is not turned on in your Google Cloud project. Turn it on, wait a few minutes, then try again.';
    }
    if (RATE_LIMIT_REASONS.includes(r)) {
      return 'Gmail is busy. Wait a minute, then try again.';
    }
    if (r === 'domainPolicy') {
      return 'Your organisation does not allow this app to use Gmail. Ask your administrator.';
    }
    return 'Gmail did not allow this change. Check that you are signed in to the right account.';
  }
  if (status === 404) {
    return 'Gmail could not find this item. It may be deleted already. Reload the list.';
  }
  if (status === 409) return 'A label with this name already exists. Use a different name.';
  if (status === 429) return 'Gmail is busy. Wait a minute, then try again.';
  if (status >= 500) return 'Gmail had a problem. Wait a moment, then try again.';
  return `Gmail did not accept this request (error ${status}). Try again.`;
}

/**
 * Reads a Retry-After header value. It can be a number of seconds or an HTTP date.
 * @param {string|null|undefined} value
 * @param {number} [nowMs]
 * @returns {number|null} Milliseconds to wait, or null if the value is missing or bad.
 */
export function parseRetryAfter(value, nowMs = Date.now()) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (text === '') return null;
  if (/^\d+(\.\d+)?$/.test(text)) return Math.round(Number(text) * 1000);
  const at = Date.parse(text);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - nowMs);
}

/**
 * Backoff delay before the next try.
 * @param {number} attempt     1 for the first retry.
 * @param {number} baseMs
 * @param {number} maxMs
 * @param {() => number} random
 * @returns {number}
 */
export function backoffDelay(attempt, baseMs, maxMs, random) {
  const exp = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
  // "Equal jitter": half fixed, half random. It spreads retries but never waits zero.
  return Math.round(exp / 2 + random() * (exp / 2));
}

/**
 * @typedef {object} ClientOptions
 * @property {() => string|null} getToken
 * @property {typeof globalThis.fetch} [fetch]
 * @property {(ms: number) => Promise<void>} [sleep]
 * @property {() => number} [random]
 * @property {() => number} [now]
 * @property {number} [maxAttempts]      Default 5.
 * @property {number} [baseDelayMs]      Default 1000.
 * @property {number} [maxDelayMs]       Default 32000.
 * @property {number} [maxRetryAfterMs]  Longest Retry-After we accept. Default 120000.
 */

/**
 * @typedef {object} RequestOptions
 * @property {Record<string, string|number|string[]|undefined>} [query]
 * @property {unknown} [body]
 * @property {PermissionTier} [tier]
 */

/**
 * Builds a URL with query parameters. Arrays repeat the key.
 * @param {string} path
 * @param {RequestOptions['query']} [query]
 */
function buildUrl(path, query) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === '') continue;
    if (Array.isArray(value)) for (const v of value) params.append(key, v);
    else params.append(key, String(value));
  }
  const qs = params.toString();
  return `${API_BASE}/${path}${qs ? `?${qs}` : ''}`;
}

/**
 * Reads Google's error body.
 * @param {Response} res
 * @returns {Promise<{reason: string, detail: string}>}
 */
async function readError(res) {
  try {
    const data = await res.json();
    const err = data?.error ?? {};
    const first = Array.isArray(err.errors) ? err.errors[0] : null;
    return {
      reason: String(first?.reason || err.status || ''),
      detail: String(err.message || first?.message || ''),
    };
  } catch {
    return { reason: '', detail: '' };
  }
}

/**
 * Finds one header value in a messages.get payload.
 * @param {any} message
 * @param {string} name
 */
function header(message, name) {
  const headers = message?.payload?.headers ?? [];
  const lower = name.toLowerCase();
  const found = headers.find((h) => String(h?.name).toLowerCase() === lower);
  return found ? String(found.value ?? '') : '';
}

/**
 * Converts a Date header (or internalDate) to ISO 8601.
 * @param {string} dateHeader
 * @param {string|number|undefined} internalDate   Epoch milliseconds as a string.
 */
function toIso(dateHeader, internalDate) {
  const ms = Number(internalDate);
  if (internalDate !== undefined && Number.isFinite(ms)) return new Date(ms).toISOString();
  const parsed = Date.parse(dateHeader);
  return Number.isNaN(parsed) ? '' : new Date(parsed).toISOString();
}

/**
 * Creates the real Gmail API client.
 * @param {ClientOptions} options
 * @returns {GmailApi & {request: (method: string, path: string, opts?: RequestOptions) => Promise<any>}}
 */
export function createGmailClient(options) {
  const {
    getToken,
    fetch: fetchFn = (input, init) => globalThis.fetch(input, init),
    sleep = (ms) => new Promise((resolve) => globalThis.setTimeout(resolve, ms)),
    random = Math.random,
    now = () => Date.now(),
    maxAttempts = 5,
    baseDelayMs = 1000,
    maxDelayMs = 32000,
    maxRetryAfterMs = 120000,
  } = options;

  /**
   * One API call, with retries.
   * @param {string} method
   * @param {string} path         Relative to API_BASE.
   * @param {RequestOptions} [opts]
   * @returns {Promise<any>}
   */
  async function request(method, path, opts = {}) {
    const tier = opts.tier ?? 'basic';
    const url = buildUrl(path, opts.query);
    const idempotent = method === 'GET';
    for (let attempt = 1; ; attempt++) {
      const token = getToken();
      if (!token) {
        throw new GmailError('You are not signed in. Sign in, then try again.', {
          status: 401,
          reason: 'notSignedIn',
          tier,
        });
      }
      /** @type {Record<string, string>} */
      const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
      /** @type {RequestInit} */
      const init = { method, headers };
      if (opts.body !== undefined) {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(opts.body);
      }

      /** @type {Response} */
      let res;
      try {
        res = await fetchFn(url, init);
      } catch (err) {
        if (err && /** @type {any} */ (err).name === 'AbortError') throw err;
        // A network failure on a write may still have reached Gmail, so only GETs retry.
        if (idempotent && attempt < maxAttempts) {
          await sleep(backoffDelay(attempt, baseDelayMs, maxDelayMs, random));
          continue;
        }
        throw new GmailError(friendlyMessage(0, '', '', tier), {
          status: 0,
          reason: 'networkError',
          tier,
          cause: err,
        });
      }

      if (res.ok) {
        if (res.status === 204) return null;
        const text = await res.text();
        return text ? JSON.parse(text) : null;
      }

      const { reason, detail } = await readError(res);
      // 429 and rate-limit 403s mean Gmail did nothing, so any method can retry.
      // A 5xx on a write may have been applied, so only GETs retry it here.
      // createFilter and deleteFilter check the real state before they try again.
      const rateLimited =
        res.status === 429 || (res.status === 403 && RATE_LIMIT_REASONS.includes(reason));
      const retryable = rateLimited || (idempotent && RETRY_STATUSES.includes(res.status));
      if (retryable && attempt < maxAttempts) {
        const after = parseRetryAfter(res.headers?.get?.('Retry-After'), now());
        const wait =
          after !== null
            ? Math.min(after, maxRetryAfterMs)
            : backoffDelay(attempt, baseDelayMs, maxDelayMs, random);
        await sleep(wait);
        continue;
      }
      throw new GmailError(friendlyMessage(res.status, reason, detail, tier), {
        status: res.status,
        reason,
        detail,
        tier: res.status === 403 ? tier : null,
      });
    }
  }

  /**
   * Pages through messages.list.
   * @param {string} q
   * @param {number} limit        Stop after this many ids.
   * @param {PermissionTier} tier
   * @returns {Promise<string[]>}
   */
  async function listMessageIds(q, limit, tier) {
    /** @type {string[]} */
    const ids = [];
    /** @type {string|undefined} */
    let pageToken;
    do {
      const data = await request('GET', 'messages', {
        query: { q, maxResults: Math.min(LIST_PAGE_MAX, limit - ids.length), pageToken },
        tier,
      });
      for (const m of data?.messages ?? []) {
        if (ids.length >= limit) break;
        ids.push(m.id);
      }
      pageToken = data?.nextPageToken || undefined;
    } while (pageToken && ids.length < limit);
    return ids;
  }

  const api = {
    request,

    async listFilters() {
      const data = await request('GET', 'settings/filters');
      // Gmail leaves out the "filter" key when the account has no filters.
      return Array.isArray(data?.filter) ? data.filter : [];
    },

    async createFilter(filter) {
      const body = { criteria: filter.criteria ?? {}, action: filter.action ?? {} };
      try {
        return await request('POST', 'settings/filters', { body });
      } catch (err) {
        if (!isServerError(err)) throw err;
        // The create may have worked. Look before trying again, so we never make a duplicate.
        const existing = (await api.listFilters()).find((f) => sameFilter(f, body));
        if (existing) return existing;
        return request('POST', 'settings/filters', { body });
      }
    },

    async deleteFilter(id) {
      const path = `settings/filters/${encodeURIComponent(id)}`;
      try {
        await request('DELETE', path);
      } catch (err) {
        if (!isServerError(err)) throw err;
        const stillThere = (await api.listFilters()).some((f) => f.id === id);
        if (stillThere) await request('DELETE', path);
      }
    },

    async listLabels() {
      const data = await request('GET', 'labels');
      return Array.isArray(data?.labels) ? data.labels : [];
    },

    async createLabel(name) {
      return request('POST', 'labels', {
        body: { name, labelListVisibility: 'labelShow', messageListVisibility: 'show' },
      });
    },

    async listForwardingAddresses() {
      const data = await request('GET', 'settings/forwardingAddresses');
      return Array.isArray(data?.forwardingAddresses) ? data.forwardingAddresses : [];
    },

    async searchMessages(q, max = 20) {
      const ids = await listMessageIds(q, Math.max(1, max), 'preview');
      /** @type {MessagePreview[]} */
      const out = [];
      // One at a time keeps us well inside the per-user quota.
      for (const id of ids) {
        const m = await request('GET', `messages/${encodeURIComponent(id)}`, {
          query: { format: 'metadata', metadataHeaders: ['From', 'Subject', 'Date'] },
          tier: 'preview',
        });
        out.push({
          id: m?.id ?? id,
          from: header(m, 'From'),
          subject: header(m, 'Subject'),
          date: toIso(header(m, 'Date'), m?.internalDate),
          snippet: m?.snippet ?? '',
        });
      }
      return out;
    },

    async applyToExisting(q, add, remove, onProgress) {
      // Collect every id first: changing labels while paging can move mail out of the result set.
      const ids = await listMessageIds(q, Number.MAX_SAFE_INTEGER, 'apply');
      let done = 0;
      for (let i = 0; i < ids.length; i += BATCH_MODIFY_MAX) {
        const chunk = ids.slice(i, i + BATCH_MODIFY_MAX);
        await request('POST', 'messages/batchModify', {
          body: { ids: chunk, addLabelIds: add ?? [], removeLabelIds: remove ?? [] },
          tier: 'apply',
        });
        done += chunk.length;
        onProgress?.(done);
      }
      return done;
    },
  };
  return api;
}

/** @param {unknown} err */
function isServerError(err) {
  return err instanceof GmailError && err.status >= 500;
}

/** Order-independent comparison of the parts Gmail stores. */
function sameFilter(a, b) {
  return (
    canonical(a.criteria) === canonical(b.criteria) && canonical(a.action) === canonical(b.action)
  );
}

function canonical(value) {
  if (Array.isArray(value)) return JSON.stringify([...value].map(canonical).sort());
  if (value && typeof value === 'object') {
    const keys = Object.keys(value)
      .filter((k) => value[k] !== undefined && !(Array.isArray(value[k]) && value[k].length === 0))
      .sort();
    return JSON.stringify(keys.map((k) => [k, canonical(value[k])]));
  }
  return JSON.stringify(value);
}
