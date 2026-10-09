// Plans that the UI needs on top of core/bulk.js: undo, restore, combine and backup restore.
// Pure functions with no DOM, so they are unit tested in tests/unit/ui/plans.test.js.

import { actionKey, isSystemLabelId } from '../core/actions.js';
import { criteriaKey } from '../core/analyse.js';
import { PlanError, count, makePlan } from '../core/bulk.js';

/** @typedef {import('../types.js').Filter} Filter */
/** @typedef {import('../types.js').Label} Label */
/** @typedef {import('../types.js').Plan} Plan */
/** @typedef {import('../types.js').PlanStep} PlanStep */
/** @typedef {import('../core/journal.js').JournalEntry} JournalEntry */

/**
 * A key that is the same for two filters that do the same thing to the same mail.
 * @param {Filter} f
 */
export function filterKey(f) {
  return `${criteriaKey(f.criteria)}#${actionKey(f.action)}`;
}

/**
 * A copy of a filter with no id.
 * @param {Filter} f
 * @returns {Filter}
 */
function strip(f) {
  return {
    criteria: structuredClone(f.criteria ?? {}),
    action: structuredClone(f.action ?? {}),
  };
}

/**
 * Plans the undo of a run: delete the filters it made, and make again the filters it deleted or
 * replaced. Filters that are already back (same criteria and action) are left alone.
 * @param {{title: string, created: Filter[], entries: Array<Pick<JournalEntry, 'previous'>>}} run
 * @param {Filter[]} current  Filters in the account now.
 * @param {{total?: number}} [opts]
 * @returns {Plan}
 */
export function planUndo(run, current, opts = {}) {
  const byId = new Map(current.map((f) => [f.id, f]));
  /** @type {Map<string, Filter>} key -> filter to delete */
  const toDelete = new Map();
  for (const made of run.created ?? []) {
    const live = made.id ? byId.get(made.id) : undefined;
    if (live) toDelete.set(live.id, live);
  }
  const deleteKeys = new Map([...toDelete.values()].map((f) => [filterKey(f), f.id]));
  const keep = new Set(current.filter((f) => !toDelete.has(f.id)).map(filterKey));
  /** @type {PlanStep[]} */
  const creates = [];
  for (const e of run.entries ?? []) {
    const p = strip(e.previous);
    const key = filterKey(p);
    if (keep.has(key)) continue;
    const same = deleteKeys.get(key);
    if (same) {
      // The filter we would delete is the same as the one we would make. Leave it.
      toDelete.delete(same);
      deleteKeys.delete(key);
      keep.add(key);
      continue;
    }
    keep.add(key);
    creates.push({ op: 'create', filter: p });
  }
  /** @type {PlanStep[]} */
  const deletes = [...toDelete.values()].map((f) => ({
    op: 'delete',
    filterId: /** @type {string} */ (f.id),
    previous: f,
  }));
  return makePlan(`Undo "${run.title}"`, [...creates, ...deletes], opts);
}

/**
 * Plans the restore of one journal batch: the filters as they were before that change.
 * @param {JournalEntry[]} entries   Every entry of one batch.
 * @param {Filter[]} current
 * @param {{total?: number}} [opts]
 * @returns {Plan}
 */
export function planRestoreBatch(entries, current, opts = {}) {
  const title = entries[0]?.title ?? 'a change';
  const created = entries
    .filter((e) => e.op === 'replace' && e.replacement)
    .map((e) => e.replacement);
  const plan = planUndo({ title, created, entries }, current, opts);
  return { ...plan, title: `Restore the filters from before "${title}"` };
}

/**
 * Groups journal entries by batch, newest batch first.
 * @param {JournalEntry[]} entries  Newest first, as journal.list() returns them.
 * @returns {Array<{batch: string, title: string, time: string, entries: JournalEntry[]}>}
 */
export function journalBatches(entries) {
  /** @type {Map<string, {batch: string, title: string, time: string, entries: JournalEntry[]}>} */
  const map = new Map();
  for (const e of entries) {
    let b = map.get(e.batch);
    if (!b) {
      b = { batch: e.batch, title: e.title, time: e.time, entries: [] };
      map.set(e.batch, b);
    }
    b.entries.unshift(e);
  }
  return [...map.values()];
}

/**
 * Plans one filter that does every action of filters that match the same mail, then deletes them.
 * @param {Filter[]} filters  Two or more filters with the same criteria.
 * @param {{total?: number}} [opts]
 * @returns {Plan}
 * @throws {PlanError} When the actions cannot be combined.
 */
export function planCombine(filters, opts = {}) {
  if (filters.length < 2) throw new PlanError('There is nothing to combine.');
  const add = new Set();
  const remove = new Set();
  const forwards = new Set();
  for (const f of filters) {
    for (const id of f.action?.addLabelIds ?? []) add.add(id);
    for (const id of f.action?.removeLabelIds ?? []) remove.add(id);
    if (f.action?.forward) forwards.add(f.action.forward.trim().toLowerCase());
  }
  if (forwards.size > 1) {
    throw new PlanError(
      'These filters forward to different addresses, so they cannot be one filter.',
    );
  }
  if (add.has('IMPORTANT') && remove.has('IMPORTANT')) {
    throw new PlanError(
      'One filter marks this mail as important and another marks it as not important. Choose one first.',
    );
  }
  if ([...add].filter((id) => id.startsWith('CATEGORY_')).length > 1) {
    throw new PlanError('These filters put the mail in different categories. Choose one first.');
  }
  /** @type {Filter['action']} */
  const action = {};
  if (add.size) action.addLabelIds = [...add];
  if (remove.size) action.removeLabelIds = [...remove];
  const forward = filters.find((f) => f.action?.forward)?.action.forward;
  if (forward) action.forward = forward;
  /** @type {PlanStep[]} */
  const steps = [
    { op: 'create', filter: { criteria: structuredClone(filters[0].criteria ?? {}), action } },
    ...filters.map(
      (f) =>
        /** @type {PlanStep} */ ({
          op: 'delete',
          filterId: /** @type {string} */ (f.id),
          previous: f,
        }),
    ),
  ];
  return makePlan(`Combine ${count(filters.length)} into 1`, steps, opts);
}

/**
 * Plans the deletion of every filter in a duplicate group except the first.
 * @param {Filter[]} filters
 * @param {{total?: number}} [opts]
 */
export function planDedupe(filters, opts = {}) {
  const extra = filters.slice(1);
  /** @type {PlanStep[]} */
  const steps = extra.map((f) => ({
    op: 'delete',
    filterId: /** @type {string} */ (f.id),
    previous: f,
  }));
  return makePlan(`Delete ${count(extra.length, 'duplicate filter')}`, steps, opts);
}

/**
 * Plans the restore of a JSON backup: makes every filter in the backup that the account does not
 * have yet. Label IDs are matched by name; labels that do not exist are made first.
 * @param {{filters: Filter[], labels: Label[]}} backup
 * @param {Filter[]} current
 * @param {Label[]} labels  Labels in the account now.
 * @param {{total?: number, labelCount?: number}} [opts]
 * @returns {{plan: Plan, skipped: number}}
 */
export function planRestoreBackup(backup, current, labels, opts = {}) {
  const backupNames = new Map((backup.labels ?? []).map((l) => [l.id, l.name]));
  const byName = new Map(
    labels.filter((l) => l.type !== 'system').map((l) => [l.name.toLowerCase(), l.id]),
  );
  /** @type {Set<string>} */
  const toCreate = new Set();
  /** @param {string} id */
  const mapId = (id) => {
    if (isSystemLabelId(id)) return id;
    const name = backupNames.get(id);
    if (!name) return id;
    const found = byName.get(name.toLowerCase());
    if (found) return found;
    toCreate.add(name);
    return `new:${name}`;
  };
  const have = new Set(current.map(filterKey));
  /** @type {PlanStep[]} */
  const creates = [];
  let skipped = 0;
  for (const f of backup.filters ?? []) {
    /** @type {Filter} */
    const next = {
      criteria: structuredClone(f.criteria ?? {}),
      action: { ...structuredClone(f.action ?? {}) },
    };
    if (next.action.addLabelIds) next.action.addLabelIds = next.action.addLabelIds.map(mapId);
    if (next.action.removeLabelIds)
      next.action.removeLabelIds = next.action.removeLabelIds.map(mapId);
    const key = filterKey(next);
    if (have.has(key)) {
      skipped++;
      continue;
    }
    have.add(key);
    creates.push({ op: 'create', filter: next });
  }
  /** @type {PlanStep[]} */
  const labelSteps = [...toCreate].map((name) => ({ op: 'createLabel', name }));
  return {
    plan: makePlan(
      `Restore ${count(creates.length)} from a backup`,
      [...labelSteps, ...creates],
      opts,
    ),
    skipped,
  };
}

/**
 * The steps of a plan that have not run yet, for resuming after a sign-in. Label steps are kept,
 * because the executor needs them to resolve "new:" placeholders (it reuses labels that exist).
 * @param {Plan} plan
 * @param {PlanStep[]} ordered  The steps in the order the executor ran them.
 * @param {number} done
 * @returns {Plan}
 */
export function remainingPlan(plan, ordered, done) {
  const rest = ordered.slice(done).filter((s) => s.op !== 'createLabel');
  const labels = ordered.filter((s) => s.op === 'createLabel');
  const filterDelta = rest.reduce(
    (n, s) => n + (s.op === 'create' ? 1 : s.op === 'delete' ? -1 : 0),
    0,
  );
  return { title: plan.title, steps: [...labels, ...rest], filterDelta };
}
