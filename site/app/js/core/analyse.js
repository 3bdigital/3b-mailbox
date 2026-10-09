// @ts-check
// Health checks across all filters.

import { SYSTEM_LABELS, actionKey, isSystemLabelId, toFriendly } from './actions.js';
import { checkFilter } from './limits.js';
import { canonicalize, normaliseQuery, parse } from './query.js';

/** @typedef {import('../types.js').Filter} Filter */
/** @typedef {import('../types.js').FilterCriteria} FilterCriteria */
/** @typedef {import('../types.js').Label} Label */
/** @typedef {import('../types.js').Issue} Issue */
/** @typedef {import('../types.js').ForwardingAddress} ForwardingAddress */

/**
 * A canonical key for criteria. Equal keys match the same mail.
 * Addresses and words are compared without case, extra spaces, brackets or OR order.
 * @param {FilterCriteria} criteria
 * @returns {string}
 */
export function criteriaKey(criteria) {
  const c = criteria ?? {};
  const sized = c.size > 0 && (c.sizeComparison === 'larger' || c.sizeComparison === 'smaller');
  return JSON.stringify([
    normaliseQuery(c.from ?? ''),
    normaliseQuery(c.to ?? ''),
    normaliseQuery(c.subject ?? ''),
    normaliseQuery(c.query ?? ''),
    // Gmail treats "Doesn't have" words as alternatives, so "a b" and "b a" and "a OR b" are equal.
    normaliseQuery(`{${c.negatedQuery ?? ''}}`),
    Boolean(c.hasAttachment),
    Boolean(c.excludeChats),
    sized ? c.sizeComparison : '',
    sized ? c.size : 0,
  ]);
}

/** @param {Filter} f */
const idOf = (f) => f.id ?? '';

/**
 * @template T
 * @param {T[]} items
 * @param {(item: T) => string} keyFn
 * @returns {Map<string, T[]>}
 */
function groupBy(items, keyFn) {
  /** @type {Map<string, T[]>} */
  const map = new Map();
  for (const item of items) {
    const k = keyFn(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}

/**
 * Filters with the same criteria and the same action.
 * @param {Filter[]} filters
 * @returns {Issue[]}
 */
export function findDuplicates(filters) {
  /** @type {Issue[]} */
  const issues = [];
  const groups = groupBy(filters ?? [], (f) => `${criteriaKey(f.criteria)}#${actionKey(f.action)}`);
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    issues.push({
      code: 'duplicate',
      severity: 'warning',
      filterIds: group.map(idOf),
      message: `These ${group.length} filters do the same thing.`,
      fix: 'Delete all of them except one.',
    });
  }
  return issues;
}

/**
 * Filters with the same criteria but different actions. They should usually be one filter.
 * @param {Filter[]} filters
 * @returns {Issue[]}
 */
export function findSameCriteria(filters) {
  /** @type {Issue[]} */
  const issues = [];
  const groups = groupBy(filters ?? [], (f) => criteriaKey(f.criteria));
  for (const group of groups.values()) {
    const actions = new Set(group.map((f) => actionKey(f.action)));
    if (actions.size < 2) continue;
    issues.push({
      code: 'same-criteria',
      severity: 'info',
      filterIds: group.map(idOf),
      message: `These ${group.length} filters match the same mail but do different things.`,
      fix: 'Combine them into one filter that does all the actions.',
    });
  }
  return issues;
}

/**
 * The sender values in a `from` field when it is a plain list, in lower case.
 * @param {FilterCriteria} criteria
 * @returns {string[]}
 */
function senderSet(criteria) {
  const from = (criteria?.from ?? '').trim();
  if (!from) return [];
  const node = canonicalize(parse(from));
  const items = node.type === 'or' ? node.items : [node];
  /** @type {string[]} */
  const out = [];
  for (const item of items) if (item.type === 'term') out.push(item.value.replace(/^@/, ''));
  return out;
}

/**
 * True when sender value a is the same as b or inside b's domain.
 * @param {string} a
 * @param {string} b
 */
function senderOverlap(a, b) {
  return (
    a === b ||
    a.endsWith(`@${b}`) ||
    a.endsWith(`.${b}`) ||
    b.endsWith(`@${a}`) ||
    b.endsWith(`.${a}`)
  );
}

/**
 * Filters that act on the same or overlapping mail in opposite ways.
 * Overlap means the same criteria, or a shared sender (or sender domain).
 * @param {Filter[]} filters
 * @returns {Issue[]}
 */
export function findConflicts(filters) {
  const list = (filters ?? []).map((f) => {
    const fr = toFriendly(f.action);
    return {
      filter: f,
      key: criteriaKey(f.criteria),
      senders: senderSet(f.criteria),
      trash: fr.trash,
      keeps: !fr.trash && (fr.star || fr.labelIds.length > 0),
      important: fr.important,
    };
  });
  /** @type {Issue[]} */
  const issues = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      const overlap =
        a.key === b.key || a.senders.some((s) => b.senders.some((t) => senderOverlap(s, t)));
      if (!overlap) continue;
      const ids = [idOf(a.filter), idOf(b.filter)];
      if ((a.trash && b.keeps) || (b.trash && a.keeps)) {
        issues.push({
          code: 'conflict-delete',
          severity: 'warning',
          filterIds: ids,
          message: 'One filter deletes this mail, but another filter labels or stars it.',
          fix: 'Change one of the filters so they do not match the same mail.',
        });
      }
      if (a.important && b.important && a.important !== b.important) {
        issues.push({
          code: 'conflict-important',
          severity: 'warning',
          filterIds: ids,
          message:
            'One filter marks this mail as important, but another filter marks it as not important.',
          fix: 'Keep only one of these actions.',
        });
      }
    }
  }
  return issues;
}

/**
 * Filters that use a label that does not exist.
 * Placeholder IDs ("new:<name>") and system label IDs are not reported.
 * @param {Filter[]} filters
 * @param {Label[]} labels
 * @returns {Issue[]}
 */
export function findMissingLabels(filters, labels) {
  const known = new Set((labels ?? []).map((l) => l.id));
  for (const id of Object.values(SYSTEM_LABELS)) known.add(id);
  /** @type {Issue[]} */
  const issues = [];
  for (const f of filters ?? []) {
    const ids = [...(f.action?.addLabelIds ?? []), ...(f.action?.removeLabelIds ?? [])];
    const missing = ids.filter(
      (id) => !known.has(id) && !id.startsWith('new:') && !isSystemLabelId(id),
    );
    if (missing.length === 0) continue;
    issues.push({
      code: 'missing-label',
      severity: 'error',
      filterIds: [idOf(f)],
      message:
        missing.length === 1
          ? 'This filter uses a label that does not exist any more.'
          : `This filter uses ${missing.length} labels that do not exist any more.`,
      fix: 'Choose a different label, or delete the filter.',
    });
  }
  return issues;
}

/**
 * Filters that forward to an address that is not verified.
 * @param {Filter[]} filters
 * @param {ForwardingAddress[]} forwardingAddresses
 * @returns {Issue[]}
 */
export function findForwardingProblems(filters, forwardingAddresses) {
  /** @type {Map<string, ForwardingAddress['verificationStatus']>} */
  const status = new Map();
  for (const a of forwardingAddresses ?? []) {
    status.set(a.forwardingEmail.trim().toLowerCase(), a.verificationStatus);
  }
  /** @type {Issue[]} */
  const issues = [];
  for (const f of filters ?? []) {
    const to = f.action?.forward?.trim();
    if (!to) continue;
    const s = status.get(to.toLowerCase());
    if (s === 'accepted') continue;
    issues.push({
      code: 'forward-not-verified',
      severity: 'error',
      filterIds: [idOf(f)],
      message: s
        ? `This filter forwards to ${to}, but that address is not verified yet.`
        : `This filter forwards to ${to}, but that address is not in your forwarding list.`,
      fix: 'Add and verify the address in Gmail settings, under Forwarding and POP/IMAP.',
    });
  }
  return issues;
}

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 };

/**
 * Runs every check and sorts the results: errors first, then warnings, then hints.
 * @param {{filters: Filter[], labels?: Label[], forwardingAddresses?: ForwardingAddress[]}} input
 * @returns {Issue[]}
 */
export function analyse({ filters, labels = [], forwardingAddresses = [] }) {
  const all = [
    ...findDuplicates(filters),
    ...findSameCriteria(filters),
    ...findConflicts(filters),
    ...findMissingLabels(filters, labels),
    ...findForwardingProblems(filters, forwardingAddresses),
    ...(filters ?? []).flatMap((f) => checkFilter(f)),
  ];
  return all
    .map((issue, i) => ({ issue, i }))
    .sort(
      (a, b) => SEVERITY_ORDER[a.issue.severity] - SEVERITY_ORDER[b.issue.severity] || a.i - b.i,
    )
    .map((x) => x.issue);
}
