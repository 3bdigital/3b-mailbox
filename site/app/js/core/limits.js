// @ts-check
// Gmail limits and per-filter checks. Update LIMITS when Google changes a limit or a live test measures it.

import { findUnsafeOperators } from './query.js';

/** @typedef {import('../types.js').Filter} Filter */
/** @typedef {import('../types.js').FilterCriteria} FilterCriteria */
/** @typedef {import('../types.js').Label} Label */
/** @typedef {import('../types.js').Issue} Issue */
/** @typedef {'ok'|'warn'|'danger'|'full'} UsageLevel */
/** @typedef {{used: number, max: number, ratio: number, level: UsageLevel}} Usage */

/**
 * The one place for Gmail limits.
 * criteriaCharsHard is the shortest length that third-party tests saw fail. criteriaCharsSafe is our cap.
 */
export const LIMITS = Object.freeze({
  maxFilters: 1000,
  criteriaCharsSafe: 1400,
  criteriaCharsHard: 1469,
  maxLabels: 10000,
  warnRatio: 0.8,
  dangerRatio: 0.95,
});

const MB = 1024 * 1024;

/**
 * A size in bytes as a Gmail search value: '5M' when it is a whole number of megabytes, otherwise bytes.
 * @param {number} bytes
 * @returns {string}
 */
export function sizeToSearch(bytes) {
  const n = Math.max(0, Math.round(bytes));
  return n > 0 && n % MB === 0 ? `${n / MB}M` : String(n);
}

/**
 * The single Gmail search string that matches the same mail as the filter criteria.
 * Used for length checks and previews.
 * @param {FilterCriteria} criteria
 * @returns {string}
 */
export function criteriaToSearch(criteria) {
  const c = criteria ?? {};
  /** @type {string[]} */
  const parts = [];
  const from = (c.from ?? '').trim();
  const to = (c.to ?? '').trim();
  const subject = (c.subject ?? '').trim();
  const query = (c.query ?? '').trim();
  const neg = (c.negatedQuery ?? '').trim();
  if (from) parts.push(`from:(${from})`);
  if (to) parts.push(`to:(${to})`);
  if (subject) parts.push(`subject:(${subject})`);
  if (query) parts.push(query);
  if (neg) parts.push(`-{${neg}}`);
  if (c.hasAttachment) parts.push('has:attachment');
  if (c.excludeChats) parts.push('-in:chats');
  if (c.size > 0 && (c.sizeComparison === 'larger' || c.sizeComparison === 'smaller')) {
    parts.push(`${c.sizeComparison}:${sizeToSearch(c.size)}`);
  }
  return parts.join(' ');
}

/**
 * Length of the criteria, measured on criteriaToSearch.
 * @param {FilterCriteria} criteria
 * @returns {number}
 */
export function criteriaLength(criteria) {
  return criteriaToSearch(criteria).length;
}

/**
 * True when the criteria match nothing specific (Gmail rejects such a filter).
 * @param {FilterCriteria} criteria
 * @returns {boolean}
 */
export function isEmptyCriteria(criteria) {
  const c = criteria ?? {};
  return (
    !(c.from ?? '').trim() &&
    !(c.to ?? '').trim() &&
    !(c.subject ?? '').trim() &&
    !(c.query ?? '').trim() &&
    !(c.negatedQuery ?? '').trim() &&
    !c.hasAttachment &&
    !(c.size > 0 && (c.sizeComparison === 'larger' || c.sizeComparison === 'smaller'))
  );
}

/**
 * Checks one filter on its own.
 * @param {Filter} filter
 * @returns {Issue[]}
 */
export function checkFilter(filter) {
  const ids = filter?.id ? [filter.id] : [];
  /** @type {Issue[]} */
  const issues = [];
  const criteria = filter?.criteria ?? {};
  const length = criteriaLength(criteria);
  if (length > LIMITS.criteriaCharsHard) {
    issues.push({
      code: 'too-long',
      severity: 'error',
      filterIds: ids,
      message: `This filter has ${length} characters. Gmail rejects filters longer than about ${LIMITS.criteriaCharsHard}.`,
      fix: 'Split it into two filters.',
    });
  } else if (length > LIMITS.criteriaCharsSafe) {
    issues.push({
      code: 'near-limit',
      severity: 'warning',
      filterIds: ids,
      message: `This filter has ${length} characters. That is close to the Gmail limit.`,
      fix: 'Do not add more to it. Make a new filter instead.',
    });
  }
  if (isEmptyCriteria(criteria)) {
    issues.push({
      code: 'empty-criteria',
      severity: 'error',
      filterIds: ids,
      message: 'This filter has no search terms, so it would act on all mail.',
      fix: 'Add a sender, subject or words to match.',
    });
  }
  const unsafe = [
    ...findUnsafeOperators(criteria.query ?? ''),
    ...findUnsafeOperators(criteria.negatedQuery ?? ''),
  ].filter((v, i, a) => a.indexOf(v) === i);
  if (unsafe.length) {
    issues.push({
      code: 'unsafe-operator',
      severity: 'warning',
      filterIds: ids,
      message: `This filter uses ${unsafe.map((o) => `${o.includes(':') ? o : `${o}:`}`).join(', ')}. These never match new mail in a filter.`,
      fix: 'Remove these search terms.',
    });
  }
  const forward = filter?.action?.forward;
  if (forward) {
    issues.push({
      code: 'forwards',
      severity: 'info',
      filterIds: ids,
      message: `This filter forwards mail to ${forward}.`,
    });
  }
  return issues;
}

/**
 * @param {number} used
 * @param {number} max
 * @returns {Usage}
 */
function usage(used, max) {
  const ratio = max > 0 ? used / max : 1;
  /** @type {UsageLevel} */
  let level = 'ok';
  if (ratio >= 1) level = 'full';
  else if (ratio >= LIMITS.dangerRatio) level = 'danger';
  else if (ratio >= LIMITS.warnRatio) level = 'warn';
  return { used, max, ratio, level };
}

/**
 * How much of each account limit is in use. Only user labels count towards the label limit.
 * @param {Filter[]} filters
 * @param {Label[]} labels
 * @returns {{filters: Usage, labels: Usage}}
 */
export function accountUsage(filters, labels) {
  const userLabels = (labels ?? []).filter((l) => l.type !== 'system').length;
  return {
    filters: usage((filters ?? []).length, LIMITS.maxFilters),
    labels: usage(userLabels, LIMITS.maxLabels),
  };
}

/**
 * True when the account has room for count more filters.
 * @param {Filter[]} filters
 * @param {number} [count]
 * @returns {boolean}
 */
export function canAdd(filters, count = 1) {
  return (filters ?? []).length + count <= LIMITS.maxFilters;
}
