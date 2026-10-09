// @ts-check
// Merges filters that do the same thing into fewer filters.

import { actionKey } from './actions.js';
import { count, makePlan } from './bulk.js';
import { LIMITS, criteriaLength } from './limits.js';
import { normaliseQuery, orJoin, parse } from './query.js';

/** @typedef {import('../types.js').Filter} Filter */
/** @typedef {import('../types.js').FilterCriteria} FilterCriteria */
/** @typedef {import('../types.js').Plan} Plan */
/** @typedef {import('../types.js').PlanStep} PlanStep */
/** @typedef {{key: string, filters: Filter[], reason: string}} MergeGroup */

const POSITIVE = /** @type {const} */ (['from', 'to', 'subject', 'query']);

/**
 * @param {string|undefined} v
 */
const text = (v) => (v ?? '').trim();

/**
 * The fields that must be equal for two filters to merge.
 * @param {FilterCriteria} c
 * @returns {string}
 */
function sharedKey(c) {
  const sized = c.size > 0 && (c.sizeComparison === 'larger' || c.sizeComparison === 'smaller');
  return JSON.stringify([
    normaliseQuery(`{${text(c.negatedQuery)}}`),
    Boolean(c.hasAttachment),
    Boolean(c.excludeChats),
    sized ? c.sizeComparison : '',
    sized ? c.size : 0,
  ]);
}

/**
 * True when the criteria have at least one positive field (from, to, subject or query).
 * @param {FilterCriteria} c
 */
function hasPositive(c) {
  return POSITIVE.some((k) => text(c?.[k]) !== '');
}

/**
 * Finds filters that do the same thing and have compatible criteria. Only groups of 2 or more.
 * Filters with no id or no positive search terms are left out.
 * @param {Filter[]} filters
 * @returns {MergeGroup[]}
 */
export function findMergeGroups(filters) {
  /** @type {Map<string, Filter[]>} */
  const map = new Map();
  for (const f of filters ?? []) {
    if (!f.id || !hasPositive(f.criteria)) continue;
    const key = `${actionKey(f.action)}#${sharedKey(f.criteria)}`;
    const list = map.get(key);
    if (list) list.push(f);
    else map.set(key, [f]);
  }
  /** @type {MergeGroup[]} */
  const groups = [];
  for (const [key, list] of map) {
    if (list.length < 2) continue;
    groups.push({
      key,
      filters: list,
      reason: `These ${list.length} filters do the same thing to different mail.`,
    });
  }
  return groups;
}

/**
 * Wraps a query in brackets when it is more than one search term joined by spaces.
 * @param {string} q
 */
function unit(q) {
  const node = parse(q);
  return node.type === 'and' && node.items.length > 1 ? `(${q})` : q;
}

/**
 * The positive part of one filter as a single search unit, for example "(from:(a) subject:(b))".
 * @param {FilterCriteria} c
 */
function branch(c) {
  /** @type {string[]} */
  const parts = [];
  if (text(c.from)) parts.push(`from:(${text(c.from)})`);
  if (text(c.to)) parts.push(`to:(${text(c.to)})`);
  if (text(c.subject)) parts.push(`subject:(${text(c.subject)})`);
  if (text(c.query)) parts.push(parts.length ? `(${text(c.query)})` : unit(text(c.query)));
  return parts.length === 1 ? parts[0] : `(${parts.join(' ')})`;
}

/**
 * Removes repeats, comparing by the normalised query.
 * @param {string[]} items
 */
function uniqueQueries(items) {
  const seen = new Set();
  return items.filter((q) => {
    const k = normaliseQuery(q);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Merges criteria into one that matches the mail any of them match (the OR of the inputs).
 * When every input uses only `from`, the result is "from: a OR b" (the same for `to` and `subject`).
 * Otherwise each input becomes one alternative in `query`, for example {(from:a subject:b) from:c}.
 * The shared fields (negatedQuery, hasAttachment, excludeChats, size) must be equal and stay as they are.
 * @param {FilterCriteria[]} criteriaList
 * @returns {FilterCriteria}
 * @throws {Error} When the list is empty or the shared fields differ.
 */
export function mergeCriteria(criteriaList) {
  if (!criteriaList.length) throw new Error('There is nothing to merge.');
  const first = criteriaList[0] ?? {};
  const shared = sharedKey(first);
  for (const c of criteriaList) {
    if (sharedKey(c ?? {}) !== shared) {
      throw new Error(
        'These filters cannot be merged, because their other settings are different.',
      );
    }
    if (!hasPositive(c ?? {})) {
      throw new Error('A filter with no search terms cannot be merged.');
    }
  }
  /** @type {FilterCriteria} */
  const out = {};
  if (text(first.negatedQuery)) out.negatedQuery = text(first.negatedQuery);
  if (first.hasAttachment) out.hasAttachment = true;
  if (first.excludeChats) out.excludeChats = true;
  if (first.size > 0 && (first.sizeComparison === 'larger' || first.sizeComparison === 'smaller')) {
    out.size = first.size;
    out.sizeComparison = first.sizeComparison;
  }
  for (const field of /** @type {const} */ (['from', 'to', 'subject'])) {
    const only = criteriaList.every((c) =>
      POSITIVE.every((k) => (k === field ? text(c[k]) !== '' : text(c[k]) === '')),
    );
    if (only) {
      return { [field]: orJoin(uniqueQueries(criteriaList.map((c) => text(c[field])))), ...out };
    }
  }
  const branches = uniqueQueries(criteriaList.map(branch));
  if (branches.length === 1) {
    /** @type {FilterCriteria} */
    const single = {};
    for (const k of POSITIVE) if (text(first[k])) single[k] = text(first[k]);
    return { ...single, ...out };
  }
  return { query: `{${branches.join(' ')}}`, ...out };
}

/**
 * Plans the merge of one group. Creates merged filter(s), then deletes the originals.
 * Splits into several merged filters when one would go over the limit (LIMITS.criteriaCharsSafe by default).
 * A filter that is too long to merge with any other stays as it is.
 * @param {MergeGroup|{filters: Filter[]}} group
 * @param {{limit?: number, total?: number}} [opts]
 * @returns {Plan}
 */
export function planMerge(group, opts = {}) {
  const limit = opts.limit ?? LIMITS.criteriaCharsSafe;
  /** @type {Filter[][]} */
  const chunks = [];
  /** @type {Filter[]} */
  let current = [];
  for (const f of group.filters) {
    if (current.length === 0) {
      current = [f];
      continue;
    }
    const merged = mergeCriteria([...current, f].map((x) => x.criteria));
    if (criteriaLength(merged) > limit) {
      chunks.push(current);
      current = [f];
    } else {
      current.push(f);
    }
  }
  if (current.length) chunks.push(current);
  /** @type {PlanStep[]} */
  const creates = [];
  /** @type {PlanStep[]} */
  const deletes = [];
  let merged = 0;
  for (const chunk of chunks) {
    if (chunk.length < 2) continue;
    merged += chunk.length;
    creates.push({
      op: 'create',
      filter: {
        criteria: mergeCriteria(chunk.map((x) => x.criteria)),
        action: structuredClone(chunk[0].action ?? {}),
      },
    });
    for (const f of chunk) {
      deletes.push({ op: 'delete', filterId: /** @type {string} */ (f.id), previous: f });
    }
  }
  const title = creates.length
    ? `Merge ${count(merged)} into ${creates.length}`
    : 'Nothing to merge';
  return makePlan(title, [...creates, ...deletes], { total: opts.total });
}

/**
 * Plans every possible merge. Plans with no steps are left out.
 * @param {Filter[]} filters
 * @param {{limit?: number}} [opts]
 * @returns {Plan[]}
 */
export function planAllMerges(filters, opts = {}) {
  return findMergeGroups(filters)
    .map((g) => planMerge(g, { limit: opts.limit }))
    .filter((p) => p.steps.length > 0);
}
