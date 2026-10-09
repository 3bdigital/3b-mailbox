// @ts-check
// Planners for bulk changes. A planner never calls the API: it returns a Plan that gmail/executor.js runs.

import { actionKey, isEmptyAction, toApi, toFriendly } from './actions.js';
import { criteriaKey } from './analyse.js';
import { LIMITS, criteriaLength } from './limits.js';

/** @typedef {import('../types.js').Filter} Filter */
/** @typedef {import('../types.js').FriendlyAction} FriendlyAction */
/** @typedef {import('../types.js').Plan} Plan */
/** @typedef {import('../types.js').PlanStep} PlanStep */

/**
 * Account context for limit checks.
 * total: filters in the account now. labelCount: user labels in the account now.
 * @typedef {{total?: number, labelCount?: number}} PlanOptions
 */

/** Thrown when a plan would go over a Gmail limit. The message is plain English. */
export class LimitError extends Error {
  /**
   * @param {string} message
   * @param {'too-many-filters'|'too-long'|'too-many-labels'} code
   */
  constructor(message, code) {
    super(message);
    this.name = 'LimitError';
    this.code = code;
  }
}

/** Thrown when a change cannot make a valid filter. The message is plain English. */
export class PlanError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'PlanError';
  }
}

/**
 * "1 filter", "3 filters".
 * @param {number} n
 * @param {string} [word]
 */
export function count(n, word = 'filter') {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * A deep copy of a filter with no id, ready to create.
 * @param {Filter} filter
 * @returns {Filter}
 */
function fresh(filter) {
  return {
    criteria: structuredClone(filter.criteria ?? {}),
    action: structuredClone(filter.action ?? {}),
  };
}

/** @param {Filter} filter */
function requireId(filter) {
  if (!filter?.id)
    throw new PlanError('This filter is not saved in Gmail yet, so it cannot be changed.');
  return filter.id;
}

/**
 * Builds a Plan and checks it against LIMITS.
 * The executor creates before it deletes, so the peak filter count is the current total plus every create,
 * plus one while a replace runs.
 * @param {string} title
 * @param {PlanStep[]} steps
 * @param {PlanOptions} [opts]
 * @returns {Plan}
 * @throws {LimitError}
 */
export function makePlan(title, steps, opts = {}) {
  let creates = 0;
  let deletes = 0;
  let replaces = 0;
  let labels = 0;
  for (const step of steps) {
    if (step.op === 'create') creates++;
    else if (step.op === 'delete') deletes++;
    else if (step.op === 'replace') replaces++;
    else labels++;
    if (step.op === 'create' || step.op === 'replace') {
      const length = criteriaLength(step.filter.criteria);
      if (length > LIMITS.criteriaCharsHard) {
        throw new LimitError(
          `A filter would have ${length} characters. Gmail allows about ${LIMITS.criteriaCharsHard}.`,
          'too-long',
        );
      }
    }
  }
  const total = opts.total ?? 0;
  const peak = total + creates + (replaces > 0 ? 1 : 0);
  if (peak > LIMITS.maxFilters) {
    throw new LimitError(
      `This change needs room for ${peak} filters. Gmail allows ${LIMITS.maxFilters}. Delete some filters first.`,
      'too-many-filters',
    );
  }
  if ((opts.labelCount ?? 0) + labels > LIMITS.maxLabels) {
    throw new LimitError(
      `This change needs ${labels} new labels. Gmail allows ${LIMITS.maxLabels} labels.`,
      'too-many-labels',
    );
  }
  return { title, steps, filterDelta: creates - deletes };
}

/**
 * createLabel steps for "new:<name>" placeholder IDs, without repeats.
 * @param {string[]} ids
 * @returns {PlanStep[]}
 */
function labelSteps(ids) {
  const names = [...new Set(ids.filter((id) => id.startsWith('new:')).map((id) => id.slice(4)))];
  return names.map((name) => ({ op: 'createLabel', name }));
}

/**
 * Deletes filters.
 * @param {Filter[]} filters
 * @param {PlanOptions} [opts]
 * @returns {Plan}
 */
export function planDelete(filters, opts) {
  /** @type {PlanStep[]} */
  const steps = filters.map((f) => ({ op: 'delete', filterId: requireId(f), previous: f }));
  return makePlan(`Delete ${count(steps.length)}`, steps, opts);
}

/**
 * Creates copies of filters. Gmail allows identical filters, so the UI should warn.
 * @param {Filter[]} filters
 * @param {PlanOptions} [opts]
 * @returns {Plan}
 */
export function planDuplicate(filters, opts) {
  /** @type {PlanStep[]} */
  const steps = filters.map((f) => ({ op: 'create', filter: fresh(f) }));
  return makePlan(`Copy ${count(steps.length)}`, steps, opts);
}

/**
 * Replace steps for every filter whose action changes.
 * @param {Filter[]} filters
 * @param {(f: FriendlyAction) => FriendlyAction} change
 * @returns {PlanStep[]}
 */
function changeActions(filters, change) {
  /** @type {PlanStep[]} */
  const steps = [];
  for (const f of filters) {
    const next = toApi(change(toFriendly(f.action)));
    if (actionKey(next) === actionKey(f.action)) continue;
    if (isEmptyAction(next)) {
      throw new PlanError(
        'A filter must do at least one thing. This change would leave a filter that does nothing.',
      );
    }
    steps.push({
      op: 'replace',
      filterId: requireId(f),
      previous: f,
      filter: { criteria: structuredClone(f.criteria ?? {}), action: next },
    });
  }
  return steps;
}

/**
 * Changes a label in many filters. The target is a label ID, or a new label to create.
 * Filters that do not use fromLabelId are left alone.
 * @param {Filter[]} filters
 * @param {string} fromLabelId
 * @param {string|{newLabelName: string}} to
 * @param {PlanOptions} [opts]
 * @returns {Plan}
 */
export function planReplaceLabel(filters, fromLabelId, to, opts) {
  const toId = typeof to === 'string' ? to : `new:${to.newLabelName.trim()}`;
  const using = filters.filter((f) => (f.action?.addLabelIds ?? []).includes(fromLabelId));
  const steps = changeActions(using, (fr) => {
    const replaceIn = (/** @type {string[]} */ list) => [
      ...new Set(list.map((id) => (id === fromLabelId ? toId : id))),
    ];
    return { ...fr, labelIds: replaceIn(fr.labelIds), otherAdd: replaceIn(fr.otherAdd) };
  });
  const all = steps.length ? [...labelSteps([toId]), ...steps] : steps;
  return makePlan(`Change the label in ${count(steps.length)}`, all, opts);
}

/**
 * Adds actions to many filters. Booleans set to true are added; labelIds are added to the existing ones;
 * important, category and forward replace the existing value when given.
 * Label IDs of the form "new:<name>" add a createLabel step.
 * @param {Filter[]} filters
 * @param {Partial<FriendlyAction>} patch
 * @param {PlanOptions} [opts]
 * @returns {Plan}
 */
export function planAddAction(filters, patch, opts) {
  const steps = changeActions(filters, (fr) => {
    const next = { ...fr, labelIds: [...fr.labelIds] };
    for (const key of /** @type {const} */ ([
      'archive',
      'markRead',
      'star',
      'trash',
      'neverSpam',
    ])) {
      if (patch[key]) next[key] = true;
    }
    if (patch.important) next.important = patch.important;
    if (patch.category) next.category = patch.category;
    if (patch.forward) next.forward = patch.forward;
    for (const id of patch.labelIds ?? []) if (!next.labelIds.includes(id)) next.labelIds.push(id);
    return next;
  });
  const all = steps.length ? [...labelSteps(patch.labelIds ?? []), ...steps] : steps;
  return makePlan(`Change ${count(steps.length)}`, all, opts);
}

/**
 * Removes actions from many filters. Keys are FriendlyAction keys ('archive', 'markRead', 'star', 'trash',
 * 'neverSpam', 'important', 'category', 'forward', 'labelIds' for all labels) or 'label:<id>' for one label.
 * Throws PlanError if a filter would be left with no action.
 * @param {Filter[]} filters
 * @param {string[]} keys
 * @param {PlanOptions} [opts]
 * @returns {Plan}
 */
export function planRemoveAction(filters, keys, opts) {
  const steps = changeActions(filters, (fr) => {
    /** @type {Record<string, any>} */
    const next = { ...fr, labelIds: [...fr.labelIds] };
    for (const key of keys) {
      if (key.startsWith('label:')) {
        next.labelIds = next.labelIds.filter((/** @type {string} */ id) => id !== key.slice(6));
      } else if (key === 'labelIds') next.labelIds = [];
      else if (key === 'important' || key === 'category' || key === 'forward') next[key] = null;
      else if (typeof next[key] === 'boolean') next[key] = false;
    }
    return /** @type {FriendlyAction} */ (next);
  });
  return makePlan(`Change ${count(steps.length)}`, steps, opts);
}

/**
 * Saves an edit as one replace step. Returns a plan with no steps when nothing changed.
 * @param {Filter} previous
 * @param {Filter} next
 * @param {PlanOptions} [opts]
 * @returns {Plan}
 */
export function planEdit(previous, next, opts) {
  const id = requireId(previous);
  const same =
    criteriaKey(previous.criteria) === criteriaKey(next.criteria) &&
    actionKey(previous.action) === actionKey(next.action);
  if (same) return makePlan('No changes', [], opts);
  return makePlan(
    'Save changes to 1 filter',
    [{ op: 'replace', filterId: id, previous, filter: fresh(next) }],
    opts,
  );
}

/**
 * Creates new filters, and the labels they need first.
 * @param {Filter[]} filters
 * @param {string[]} [labelsToCreate]  Label names.
 * @param {PlanOptions} [opts]
 * @returns {Plan}
 */
export function planCreate(filters, labelsToCreate = [], opts) {
  const names = [...new Set(labelsToCreate.map((n) => n.trim()).filter(Boolean))];
  /** @type {PlanStep[]} */
  const steps = [
    ...names.map((name) => /** @type {PlanStep} */ ({ op: 'createLabel', name })),
    ...filters.map((f) => /** @type {PlanStep} */ ({ op: 'create', filter: fresh(f) })),
  ];
  return makePlan(`Create ${count(filters.length)}`, steps, opts);
}
