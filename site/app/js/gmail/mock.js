// @ts-check
// In-memory GmailApi for demo mode and tests. It copies Google's behaviour and limits,
// so it keeps its own constants and does not import from core/.

import { GmailError, friendlyMessage } from './client.js';
import { DEMO_NOW } from './demo-data.js';

export { demoData, DEMO_NOW, DEMO_USER, DELETED_LABEL_ID } from './demo-data.js';

/** @typedef {import('../types.js').Filter} Filter */
/** @typedef {import('../types.js').FilterCriteria} FilterCriteria */
/** @typedef {import('../types.js').Label} Label */
/** @typedef {import('../types.js').ForwardingAddress} ForwardingAddress */
/** @typedef {import('../types.js').MessagePreview} MessagePreview */
/** @typedef {import('../types.js').GmailApi} GmailApi */
/** @typedef {import('./demo-data.js').DemoMessage} DemoMessage */

/** Google's limits as the mock enforces them. */
export const MOCK_LIMITS = Object.freeze({
  maxFilters: 1000,
  criteriaCharsHard: 1469,
  maxLabels: 10000,
});

/** System labels that are always valid in a filter action. */
const SYSTEM_IDS = new Set([
  'INBOX',
  'SENT',
  'DRAFT',
  'SPAM',
  'TRASH',
  'UNREAD',
  'STARRED',
  'IMPORTANT',
  'CHAT',
  'CATEGORY_PERSONAL',
  'CATEGORY_SOCIAL',
  'CATEGORY_PROMOTIONS',
  'CATEGORY_UPDATES',
  'CATEGORY_FORUMS',
]);

/** Names Gmail keeps for itself. */
const RESERVED_NAMES = new Set([
  'inbox',
  'sent',
  'drafts',
  'draft',
  'spam',
  'trash',
  'bin',
  'starred',
  'important',
  'chats',
  'unread',
  'all mail',
  'snoozed',
  'scheduled',
]);

/**
 * When a call should fail. Either a function, or a rule such as
 * `{method: 'createFilter', nth: 2, status: 500}` (fail the 2nd createFilter call).
 * Without `method`, `nth` counts every call. `times` repeats the failure (default 1).
 * @typedef {{method?: keyof GmailApi, nth?: number, times?: number, status: number, reason?: string, message?: string}} FailRule
 * @typedef {FailRule | FailRule[] | ((method: string, callNumber: number, args: unknown[]) => (null|undefined|{status: number, reason?: string, message?: string}))} FailOn
 */

/**
 * @typedef {object} MockOptions
 * @property {Filter[]} [filters]
 * @property {Label[]} [labels]
 * @property {ForwardingAddress[]} [forwardingAddresses]
 * @property {DemoMessage[]} [messages]
 * @property {number} [latencyMs]    Wait before each call. Default 0.
 * @property {FailOn} [failOn]
 * @property {string} [now]          ISO date used for older_than/newer_than. Default DEMO_NOW.
 */

/**
 * @typedef {GmailApi & {
 *   snapshot: () => {filters: Filter[], labels: Label[], forwardingAddresses: ForwardingAddress[], messages: DemoMessage[]},
 *   calls: () => string[],
 * }} MockGmail
 */

/**
 * @template T
 * @param {T} value
 * @returns {T}
 */
const copy = (value) => structuredClone(value);

/**
 * The single search string Gmail would see for these criteria. Used for the length limit.
 * @param {FilterCriteria} c
 * @returns {string}
 */
export function mockCriteriaString(c = {}) {
  const parts = [];
  if (c.from) parts.push(`from:(${c.from})`);
  if (c.to) parts.push(`to:(${c.to})`);
  if (c.subject) parts.push(`subject:(${c.subject})`);
  if (c.query) parts.push(c.query);
  if (c.negatedQuery) parts.push(`-{${c.negatedQuery}}`);
  if (c.hasAttachment) parts.push('has:attachment');
  if (c.excludeChats) parts.push('-in:chats');
  if (c.size && c.sizeComparison && c.sizeComparison !== 'unspecified') {
    parts.push(`${c.sizeComparison}:${c.size}`);
  }
  return parts.join(' ');
}

/**
 * Canonical form of a filter, for the "already exists" check.
 * @param {Filter} f
 */
function filterKey(f) {
  const c = f.criteria ?? {};
  const a = f.action ?? {};
  const norm = (/** @type {unknown} */ v) => (typeof v === 'string' ? v.trim() : v);
  const criteria = Object.keys(c)
    .sort()
    .filter((k) => c[k] !== undefined && c[k] !== '' && c[k] !== false)
    .map((k) => [k, norm(c[k])]);
  return JSON.stringify([
    criteria,
    [...(a.addLabelIds ?? [])].sort(),
    [...(a.removeLabelIds ?? [])].sort(),
    a.forward ?? '',
  ]);
}

/**
 * @param {number} status
 * @param {string} reason
 * @param {string} detail
 */
function fail(status, reason, detail) {
  return new GmailError(friendlyMessage(status, reason, detail), { status, reason, detail });
}

// ---------------------------------------------------------------------------
// Simple Gmail search matcher. Good enough for demos, not a full parser.

/**
 * @typedef {{type: 'and'|'or', items: Node[]} | {type: 'not', item: Node} |
 *   {type: 'term', value: string, quoted: boolean} | {type: 'op', name: string, value: Node}} Node
 */

/**
 * @param {string} q
 * @returns {string[]}
 */
function tokenize(q) {
  /** @type {string[]} */
  const out = [];
  let i = 0;
  while (i < q.length) {
    const ch = q[i];
    if (/\s/.test(ch)) {
      i++;
    } else if ('(){}|'.includes(ch)) {
      out.push(ch);
      i++;
    } else if (ch === '"') {
      const end = q.indexOf('"', i + 1);
      const stop = end === -1 ? q.length : end;
      out.push(q.slice(i, stop + 1));
      i = stop + 1;
    } else if (ch === '-' && i + 1 < q.length && !/\s/.test(q[i + 1])) {
      out.push('-');
      i++;
    } else {
      let j = i;
      while (j < q.length && !/[\s(){}|"]/.test(q[j])) {
        j++;
        // op:"quoted value" or op:(group) stays with the operator.
        if (q[j - 1] === ':' && (q[j] === '"' || q[j] === '(')) break;
      }
      out.push(q.slice(i, j));
      i = j;
    }
  }
  return out;
}

/**
 * @param {string} q
 * @returns {Node}
 */
export function parseSearch(q) {
  const tokens = tokenize(q);
  let pos = 0;
  const peek = () => tokens[pos];

  /** @returns {Node} */
  function parseOr() {
    const items = [parseAnd()];
    while (peek() === 'OR' || peek() === '|') {
      pos++;
      items.push(parseAnd());
    }
    return items.length === 1 ? items[0] : { type: 'or', items };
  }

  /** @returns {Node} */
  function parseAnd() {
    /** @type {Node[]} */
    const items = [];
    while (pos < tokens.length) {
      const t = peek();
      if (t === ')' || t === '}' || t === 'OR' || t === '|') break;
      if (t === 'AND') {
        pos++;
        continue;
      }
      items.push(parseUnary());
    }
    return items.length === 1 ? items[0] : { type: 'and', items };
  }

  /** @returns {Node} */
  function parseUnary() {
    if (peek() === '-') {
      pos++;
      return { type: 'not', item: parseUnary() };
    }
    return parsePrimary();
  }

  /** @returns {Node} */
  function parsePrimary() {
    const t = tokens[pos++];
    if (t === '(') {
      const inner = parseOr();
      if (peek() === ')') pos++;
      return inner;
    }
    if (t === '{') {
      /** @type {Node[]} */
      const items = [];
      while (pos < tokens.length && peek() !== '}') {
        if (peek() === 'OR' || peek() === '|') {
          pos++;
          continue;
        }
        items.push(parseUnary());
      }
      if (peek() === '}') pos++;
      return { type: 'or', items };
    }
    const m = /^([a-zA-Z_]+):(.*)$/.exec(t);
    if (m) {
      const name = m[1].toLowerCase();
      let rest = m[2];
      /** @type {Node} */
      let value;
      if (rest === '' && (peek() === '(' || peek() === '{')) {
        value = parsePrimary();
      } else if (rest === '' && peek()?.startsWith('"')) {
        value = term(tokens[pos++]);
      } else {
        value = term(rest);
      }
      return { type: 'op', name, value };
    }
    return term(t);
  }

  /**
   * @param {string} raw
   * @returns {Node}
   */
  function term(raw) {
    const quoted = raw.startsWith('"');
    const value = quoted ? raw.replace(/^"|"$/g, '') : raw;
    return { type: 'term', value: value.toLowerCase(), quoted };
  }

  if (tokens.length === 0) return { type: 'and', items: [] };
  return parseOr();
}

const UNITS = { d: 86400000, m: 30 * 86400000, y: 365 * 86400000 };

/**
 * @param {string} text  For example "10M", "500K" or "2000".
 */
function parseSize(text) {
  const m = /^(\d+(?:\.\d+)?)([kKmM]?)/.exec(text);
  if (!m) return 0;
  const mult = { k: 1024, m: 1024 * 1024 }[m[2].toLowerCase()] ?? 1;
  return Number(m[1]) * mult;
}

/**
 * @param {Node} node
 * @param {DemoMessage} msg
 * @param {{now: number, labelNames: Map<string, string>}} ctx
 * @param {string|null} [field]   Text to match terms against (inside an operator).
 * @returns {boolean}
 */
function matches(node, msg, ctx, field = null) {
  switch (node.type) {
    case 'and':
      return node.items.every((n) => matches(n, msg, ctx, field));
    case 'or':
      return node.items.some((n) => matches(n, msg, ctx, field));
    case 'not':
      return !matches(node.item, msg, ctx, field);
    case 'term': {
      const hay =
        field ?? [msg.from, msg.to, msg.subject, msg.snippet, msg.body].join('\n').toLowerCase();
      return node.value === '' || hay.includes(node.value);
    }
    case 'op':
      return matchOp(node.name, node.value, msg, ctx);
    default:
      return false;
  }
}

/**
 * @param {Node} node
 * @returns {string}
 */
function flatValue(node) {
  if (node.type === 'term') return node.value;
  if (node.type === 'not') return flatValue(node.item);
  if (node.type === 'op') return `${node.name}:${flatValue(node.value)}`;
  return node.items.map(flatValue).join(' ');
}

/**
 * @param {string} name
 * @param {Node} value
 * @param {DemoMessage} msg
 * @param {{now: number, labelNames: Map<string, string>}} ctx
 */
function matchOp(name, value, msg, ctx) {
  const v = flatValue(value);
  const labels = new Set(msg.labelIds);
  switch (name) {
    case 'from':
      return matches(value, msg, ctx, msg.from.toLowerCase());
    case 'to':
    case 'deliveredto':
      return matches(value, msg, ctx, msg.to.toLowerCase());
    case 'subject':
      return matches(value, msg, ctx, msg.subject.toLowerCase());
    case 'list':
      return matches(value, msg, ctx, (msg.list ?? '').toLowerCase()) && Boolean(msg.list);
    case 'has':
      if (v === 'attachment') return msg.hasAttachment;
      if (v === 'userlabels') return msg.labelIds.some((id) => !SYSTEM_IDS.has(id));
      if (v === 'nouserlabels') return msg.labelIds.every((id) => SYSTEM_IDS.has(id));
      return false;
    case 'filename':
      return msg.hasAttachment && (v === 'ics' ? /invit/i.test(msg.subject) : true);
    case 'is':
      if (v === 'unread') return labels.has('UNREAD');
      if (v === 'read') return !labels.has('UNREAD');
      if (v === 'starred') return labels.has('STARRED');
      if (v === 'important') return labels.has('IMPORTANT');
      return false;
    case 'in':
      if (v === 'anywhere') return true;
      return labels.has(v.toUpperCase());
    case 'category':
      return labels.has(`CATEGORY_${v.toUpperCase()}`);
    case 'label': {
      const id = ctx.labelNames.get(v.replace(/-/g, ' ')) ?? ctx.labelNames.get(v);
      return Boolean(id) && labels.has(id);
    }
    case 'larger':
      return msg.size > parseSize(v);
    case 'smaller':
      return msg.size < parseSize(v);
    case 'older_than':
    case 'newer_than': {
      const m = /^(\d+)([dmy])$/.exec(v);
      if (!m) return false;
      const cutoff = ctx.now - Number(m[1]) * UNITS[m[2]];
      const t = Date.parse(msg.date);
      return name === 'older_than' ? t < cutoff : t >= cutoff;
    }
    default:
      // Unknown operator: treat as plain text, as Gmail roughly does.
      return [msg.from, msg.to, msg.subject, msg.body]
        .join('\n')
        .toLowerCase()
        .includes(`${name}:${v}`);
  }
}

/**
 * Finds demo messages that match a Gmail search.
 * @param {DemoMessage[]} messages
 * @param {string} q
 * @param {{now?: number, labels?: Label[]}} [opts]
 * @returns {DemoMessage[]} Newest first.
 */
export function searchDemoMessages(messages, q, opts = {}) {
  const node = parseSearch(String(q ?? ''));
  const ctx = {
    now: opts.now ?? Date.parse(DEMO_NOW),
    labelNames: new Map((opts.labels ?? []).map((l) => [l.name.toLowerCase(), l.id])),
  };
  return messages
    .filter((m) => !m.labelIds.includes('TRASH') && !m.labelIds.includes('SPAM'))
    .filter((m) => matches(node, m, ctx))
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}

// ---------------------------------------------------------------------------

/**
 * Creates the in-memory Gmail API.
 * @param {MockOptions} [options]
 * @returns {MockGmail}
 */
export function createMockGmail(options = {}) {
  const state = {
    filters: copy(options.filters ?? []),
    labels: copy(options.labels ?? []),
    forwardingAddresses: copy(options.forwardingAddresses ?? []),
    messages: copy(options.messages ?? []),
  };
  const latencyMs = options.latencyMs ?? 0;
  const failOn = options.failOn;
  const now = Date.parse(options.now ?? DEMO_NOW);
  /** @type {string[]} */
  const callLog = [];
  /** @type {Record<string, number>} */
  const perMethod = {};

  let nextFilter = 1;
  let nextLabel =
    state.labels.reduce((max, l) => {
      const m = /^Label_(\d+)$/.exec(l.id);
      return m ? Math.max(max, Number(m[1])) : max;
    }, 0) + 1;

  /**
   * @param {string} method
   * @param {unknown[]} args
   */
  async function enter(method, args) {
    callLog.push(method);
    perMethod[method] = (perMethod[method] ?? 0) + 1;
    const total = callLog.length;
    if (latencyMs > 0) await new Promise((r) => globalThis.setTimeout(r, latencyMs));
    if (!failOn) return;
    if (typeof failOn === 'function') {
      const spec = failOn(method, total, args);
      if (spec) throw fail(spec.status, spec.reason ?? '', spec.message ?? '');
      return;
    }
    for (const rule of Array.isArray(failOn) ? failOn : [failOn]) {
      if (rule.method && rule.method !== method) continue;
      const count = rule.method ? perMethod[method] : total;
      const nth = rule.nth ?? 1;
      const times = rule.times ?? 1;
      if (count >= nth && count < nth + times) {
        throw fail(rule.status, rule.reason ?? '', rule.message ?? '');
      }
    }
  }

  /** @param {string} id */
  function labelExists(id) {
    return SYSTEM_IDS.has(id) || state.labels.some((l) => l.id === id);
  }

  /** @param {string[]} ids */
  function checkLabels(ids) {
    for (const id of ids) {
      if (!labelExists(id)) throw fail(400, 'invalidArgument', `Invalid label: ${id}`);
    }
  }

  return {
    async listFilters() {
      await enter('listFilters', []);
      return copy(state.filters);
    },

    async createFilter(filter) {
      await enter('createFilter', [filter]);
      const criteria = copy(filter?.criteria ?? {});
      const action = copy(filter?.action ?? {});
      if (state.filters.length >= MOCK_LIMITS.maxFilters) {
        throw fail(400, 'failedPrecondition', 'Too many filters');
      }
      const search = mockCriteriaString(criteria);
      if (search.trim() === '') {
        throw fail(400, 'invalidArgument', "Filter doesn't have any criteria");
      }
      const hasAction =
        (action.addLabelIds?.length ?? 0) > 0 ||
        (action.removeLabelIds?.length ?? 0) > 0 ||
        Boolean(action.forward);
      if (!hasAction) throw fail(400, 'invalidArgument', "Filter doesn't have any actions");
      if (search.length > MOCK_LIMITS.criteriaCharsHard) {
        throw fail(400, 'invalidArgument', 'The specified filter is too long');
      }
      checkLabels([...(action.addLabelIds ?? []), ...(action.removeLabelIds ?? [])]);
      if (action.forward) {
        const addr = state.forwardingAddresses.find(
          (a) => a.forwardingEmail.toLowerCase() === String(action.forward).toLowerCase(),
        );
        if (!addr || addr.verificationStatus !== 'accepted') {
          throw fail(400, 'invalidArgument', 'Unrecognized forwarding address');
        }
      }
      const key = filterKey({ criteria, action });
      if (state.filters.some((f) => filterKey(f) === key)) {
        throw fail(400, 'invalidArgument', 'Filter already exists');
      }
      let id;
      do {
        id = `ANe1BmjM${String(nextFilter++).padStart(4, '0')}`;
      } while (state.filters.some((f) => f.id === id));
      /** @type {Filter} */
      const made = { id, criteria, action };
      state.filters.push(made);
      return copy(made);
    },

    async deleteFilter(id) {
      await enter('deleteFilter', [id]);
      const i = state.filters.findIndex((f) => f.id === id);
      if (i === -1) throw fail(404, 'notFound', 'Requested entity was not found.');
      state.filters.splice(i, 1);
    },

    async listLabels() {
      await enter('listLabels', []);
      return copy(state.labels);
    },

    async createLabel(name) {
      await enter('createLabel', [name]);
      const clean = String(name ?? '').trim();
      if (clean === '') throw fail(400, 'invalidArgument', 'Invalid label name');
      if (RESERVED_NAMES.has(clean.toLowerCase())) {
        throw fail(400, 'invalidArgument', 'Invalid label name');
      }
      if (state.labels.some((l) => l.name.toLowerCase() === clean.toLowerCase())) {
        throw fail(409, 'alreadyExists', 'Label name exists or conflicts');
      }
      if (state.labels.filter((l) => l.type === 'user').length >= MOCK_LIMITS.maxLabels) {
        throw fail(400, 'failedPrecondition', 'Too many labels');
      }
      let id;
      do {
        id = `Label_${nextLabel++}`;
      } while (state.labels.some((l) => l.id === id));
      /** @type {Label} */
      const label = {
        id,
        name: clean,
        type: 'user',
        labelListVisibility: 'labelShow',
        messageListVisibility: 'show',
      };
      state.labels.push(label);
      return copy(label);
    },

    async listForwardingAddresses() {
      await enter('listForwardingAddresses', []);
      return copy(state.forwardingAddresses);
    },

    async searchMessages(q, max = 20) {
      await enter('searchMessages', [q, max]);
      return searchDemoMessages(state.messages, q, { now, labels: state.labels })
        .slice(0, Math.max(1, max))
        .map((m) => ({
          id: m.id,
          from: m.from,
          subject: m.subject,
          date: m.date,
          snippet: m.snippet,
        }));
    },

    async applyToExisting(q, add, remove, onProgress) {
      await enter('applyToExisting', [q, add, remove]);
      const addIds = add ?? [];
      const removeIds = remove ?? [];
      checkLabels([...addIds, ...removeIds]);
      const found = searchDemoMessages(state.messages, q, { now, labels: state.labels });
      let done = 0;
      for (let i = 0; i < found.length; i += 1000) {
        for (const m of found.slice(i, i + 1000)) {
          const set = new Set(m.labelIds);
          for (const id of removeIds) set.delete(id);
          for (const id of addIds) set.add(id);
          m.labelIds = [...set];
          done++;
        }
        onProgress?.(done);
      }
      return done;
    },

    snapshot() {
      return copy(state);
    },

    calls() {
      return [...callLog];
    },
  };
}
