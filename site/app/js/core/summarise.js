// @ts-check
// Plain English descriptions of filters, and grouping for the overview.

import { actionKey, isRisky, toFriendly } from './actions.js';
import { parse, walk } from './query.js';

/** @typedef {import('../types.js').Filter} Filter */
/** @typedef {import('../types.js').FilterCriteria} FilterCriteria */
/** @typedef {import('../types.js').FilterAction} FilterAction */
/** @typedef {import('../types.js').Label} Label */
/** @typedef {import('./query.js').Node} Node */
/** @typedef {{key: string, title: string, filters: Filter[]}} FilterGroup */

const CATEGORY_NAMES = {
  CATEGORY_PERSONAL: 'Primary',
  CATEGORY_SOCIAL: 'Social',
  CATEGORY_PROMOTIONS: 'Promotions',
  CATEGORY_UPDATES: 'Updates',
  CATEGORY_FORUMS: 'Forums',
};

/**
 * Joins a list in UK style: "a", "a or b", "a, b or c".
 * @param {string[]} items
 * @param {string} [word]  'or' or 'and'.
 * @param {number} [max]   Show at most this many, then "and N more".
 * @returns {string}
 */
export function joinList(items, word = 'or', max = Infinity) {
  let list = items;
  let more = 0;
  if (items.length > max) {
    list = items.slice(0, max);
    more = items.length - max;
  }
  if (more > 0) return `${list.join(', ')} ${word} ${more} more`;
  if (list.length <= 1) return list[0] ?? '';
  return `${list.slice(0, -1).join(', ')} ${word} ${list[list.length - 1]}`;
}

/**
 * The simple alternatives in a value, for example "a OR b" gives ['a', 'b'].
 * Returns null when the value is not a plain list of words or phrases.
 * @param {Node} node
 * @returns {{values: string[], quoted: boolean[], mode: 'or'|'and'}|null}
 */
function alternatives(node) {
  if (node.type === 'group') return alternatives(node.item);
  if (node.type === 'term') return { values: [node.value], quoted: [node.quoted], mode: 'or' };
  if (node.type === 'or' || node.type === 'and') {
    if (node.items.length === 0) return null;
    /** @type {string[]} */
    const values = [];
    /** @type {boolean[]} */
    const quoted = [];
    for (const item of node.items) {
      const inner = item.type === 'group' ? item.item : item;
      if (inner.type !== 'term') return null;
      values.push(inner.value);
      quoted.push(inner.quoted);
    }
    return { values, quoted, mode: node.type };
  }
  return null;
}

/**
 * @param {string} text
 * @param {'address'|'words'} style
 * @param {number} max
 * @param {'or'|'and'} [defaultMode]
 */
function describeValue(text, style, max, defaultMode = 'or') {
  const alt = alternatives(parse(text));
  if (!alt) return null;
  const mode = alt.values.length === 1 ? defaultMode : alt.mode;
  const shown = alt.values.map((v, i) =>
    style === 'words' || alt.quoted[i] || /\s/.test(v) ? `"${v}"` : v,
  );
  return joinList(shown, mode, max);
}

/**
 * A size in bytes in plain English, for example "5 MB".
 * @param {number} bytes
 * @returns {string}
 */
export function formatSize(bytes) {
  const MB = 1024 * 1024;
  if (bytes >= MB) return `${Number((bytes / MB).toFixed(1))} MB`;
  if (bytes >= 1024) return `${Number((bytes / 1024).toFixed(1))} KB`;
  return `${bytes} bytes`;
}

/**
 * Describes filter criteria in plain English, for example
 * 'From amazon.co.uk or ebay.co.uk, with "invoice" in the subject'.
 * @param {FilterCriteria} criteria
 * @param {{maxItems?: number}} [opts]  maxItems: show at most this many alternatives per field.
 * @returns {string}
 */
export function describeCriteria(criteria, opts = {}) {
  const c = criteria ?? {};
  const max = opts.maxItems ?? 5;
  /** @type {string[]} */
  const clauses = [];
  let lead = false;
  const from = (c.from ?? '').trim();
  const to = (c.to ?? '').trim();
  const subject = (c.subject ?? '').trim();
  const query = (c.query ?? '').trim();
  const neg = (c.negatedQuery ?? '').trim();
  if (from) {
    clauses.push(`From ${describeValue(from, 'address', max) ?? from}`);
    lead = true;
  }
  if (to) {
    clauses.push(`${lead ? 'sent' : 'Sent'} to ${describeValue(to, 'address', max) ?? to}`);
    lead = true;
  }
  if (subject) {
    const v = describeValue(subject, 'words', max, 'and');
    clauses.push(v ? `with ${v} in the subject` : `with a subject that matches ${subject}`);
  }
  if (query) {
    const v = describeValue(query, 'words', max, 'and');
    clauses.push(v ? `containing ${v}` : `matching the search ${query}`);
  }
  if (neg) {
    // Gmail treats the words in "Doesn't have" as alternatives: any one of them stops a match.
    const alt = alternatives(parse(neg));
    const v = alt
      ? joinList(
          alt.values.map((w) => `"${w}"`),
          'or',
          max,
        )
      : null;
    clauses.push(v ? `not containing ${v}` : `not matching the search ${neg}`);
  }
  if (c.hasAttachment) clauses.push('with an attachment');
  if (c.size > 0 && c.sizeComparison === 'larger') {
    clauses.push(`larger than ${formatSize(c.size)}`);
  } else if (c.size > 0 && c.sizeComparison === 'smaller') {
    clauses.push(`smaller than ${formatSize(c.size)}`);
  }
  if (c.excludeChats) clauses.push('not including chats');
  if (clauses.length === 0) return 'All mail';
  if (!lead) return `Mail ${clauses.join(', ')}`;
  return clauses.join(', ');
}

/**
 * @param {string} id
 * @param {Map<string, Label>} labelsById
 */
function labelName(id, labelsById) {
  const label = labelsById?.get(id);
  if (label) return label.name;
  if (id.startsWith('new:')) return id.slice(4);
  return 'a missing label';
}

/**
 * Describes a filter action in plain English, for example "Skip the inbox, apply label Receipts".
 * @param {FilterAction} action
 * @param {Map<string, Label>} labelsById
 * @returns {string}
 */
export function describeAction(action, labelsById) {
  const f = toFriendly(action);
  /** @type {string[]} */
  const parts = [];
  if (f.archive) parts.push('skip the inbox');
  if (f.markRead) parts.push('mark as read');
  if (f.star) parts.push('star it');
  if (f.labelIds.length === 1) parts.push(`apply label ${labelName(f.labelIds[0], labelsById)}`);
  if (f.labelIds.length > 1) {
    parts.push(
      `apply labels ${joinList(
        f.labelIds.map((id) => labelName(id, labelsById)),
        'and',
      )}`,
    );
  }
  if (f.category) parts.push(`categorise as ${CATEGORY_NAMES[f.category]}`);
  if (f.important === 'always') parts.push('always mark as important');
  if (f.important === 'never') parts.push('never mark as important');
  if (f.neverSpam) parts.push('never send to spam');
  if (f.forward) parts.push(`forward to ${f.forward}`);
  if (f.trash) parts.push('delete it');
  for (const id of f.otherAdd) parts.push(`add ${labelsById?.get(id)?.name ?? id}`);
  for (const id of f.otherRemove) parts.push(`remove ${labelsById?.get(id)?.name ?? id}`);
  if (parts.length === 0) return 'Do nothing';
  const text = parts.join(', ');
  return text[0].toUpperCase() + text.slice(1);
}

/**
 * Describes a whole filter.
 * @param {Filter} filter
 * @param {Map<string, Label>} labelsById
 * @returns {{when: string, then: string, text: string}}
 */
export function describeFilter(filter, labelsById) {
  const when = describeCriteria(filter.criteria);
  const then = describeAction(filter.action, labelsById);
  return { when, then, text: `${when}. ${then}.` };
}

/**
 * The domain part of a sender value, or '' when there is none.
 * @param {string} value
 */
function domainOf(value) {
  let v = value
    .trim()
    .toLowerCase()
    .replace(/^[<"]+|[>"]+$/g, '');
  const at = v.lastIndexOf('@');
  if (at >= 0) v = v.slice(at + 1);
  v = v.replace(/^\*?\.?/, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(v) ? v : '';
}

/**
 * Sender domains in the filter's `from` field and in `from:` terms of its query, for grouping.
 * @param {Filter} filter
 * @returns {string[]}
 */
export function senderDomains(filter) {
  /** @type {string[]} */
  const found = [];
  /** @param {string} v */
  const add = (v) => {
    const d = domainOf(v);
    if (d && !found.includes(d)) found.push(d);
  };
  const from = filter?.criteria?.from ?? '';
  if (from.trim()) {
    walk(parse(from), (n) => {
      if (n.type === 'term') add(n.value);
    });
  }
  const query = filter?.criteria?.query ?? '';
  if (query.trim()) {
    walk(parse(query), (n) => {
      if (n.type !== 'op' || n.name !== 'from') return;
      if (typeof n.value === 'string') add(n.value);
      else {
        walk(n.value, (m) => {
          if (m.type === 'term') add(m.value);
        });
      }
    });
  }
  return found;
}

/**
 * Groups filters for the overview. A filter with several labels or domains is in several groups.
 * Groups are sorted by size (largest first), then by title. The "No label" or "No sender domain"
 * group (key '') is always last.
 * @param {Filter[]} filters
 * @param {'action'|'label'|'domain'|'risk'} by
 * @param {Map<string, Label>} labelsById
 * @returns {FilterGroup[]}
 */
export function groupFilters(filters, by, labelsById) {
  /** @type {Map<string, FilterGroup>} */
  const groups = new Map();
  /**
   * @param {string} key
   * @param {string} title
   * @param {Filter} filter
   */
  const put = (key, title, filter) => {
    let g = groups.get(key);
    if (!g) {
      g = { key, title, filters: [] };
      groups.set(key, g);
    }
    g.filters.push(filter);
  };
  for (const filter of filters ?? []) {
    if (by === 'action') {
      put(actionKey(filter.action), describeAction(filter.action, labelsById), filter);
    } else if (by === 'label') {
      const ids = toFriendly(filter.action).labelIds;
      if (ids.length === 0) put('', 'No label', filter);
      for (const id of ids) put(id, labelName(id, labelsById), filter);
    } else if (by === 'domain') {
      const domains = senderDomains(filter);
      if (domains.length === 0) put('', 'No sender domain', filter);
      for (const d of domains) put(d, d, filter);
    } else {
      const risky = isRisky(filter.action).risky;
      put(risky ? 'risky' : 'safe', risky ? 'Risky filters' : 'Other filters', filter);
    }
  }
  /** @param {FilterGroup} g */
  const sortTitle = (g) => g.title.toLowerCase();
  return [...groups.values()].sort(
    (a, b) =>
      Number(a.key === '') - Number(b.key === '') ||
      b.filters.length - a.filters.length ||
      (sortTitle(a) < sortTitle(b) ? -1 : sortTitle(a) > sortTitle(b) ? 1 : 0),
  );
}
