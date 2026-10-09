// @ts-check
// Runs a change Plan against a GmailApi, one write at a time.

/** @typedef {import('../types.js').Filter} Filter */
/** @typedef {import('../types.js').Plan} Plan */
/** @typedef {import('../types.js').PlanStep} PlanStep */
/** @typedef {import('../types.js').GmailApi} GmailApi */

/** Prefix for a label ID that the plan creates first. */
export const NEW_LABEL_PREFIX = 'new:';

/**
 * What the executor writes to the undo journal before each delete.
 * @typedef {object} JournalEntry
 * @property {string} batch          Same for every entry of one runPlan call.
 * @property {string} title          The plan title.
 * @property {string} time           ISO 8601.
 * @property {'delete'|'replace'} op
 * @property {string} filterId       The filter that is about to be deleted.
 * @property {Filter} previous       The filter as it was, so the user can restore it.
 * @property {Filter} [replacement]  For 'replace': the new filter that took its place.
 */

/**
 * @typedef {object} JournalLike
 * @property {(entry: JournalEntry) => unknown} record
 */

/**
 * @typedef {object} RunProgress
 * @property {number} done
 * @property {number} total
 * @property {PlanStep} step         The step that just finished.
 */

/**
 * @typedef {object} RunOptions
 * @property {(progress: RunProgress) => void} [onProgress]
 * @property {JournalLike} [journal]
 * @property {AbortSignal} [signal]
 * @property {() => number} [now]
 */

/**
 * @typedef {object} RunResult
 * @property {number} done           Steps that finished.
 * @property {PlanStep|null} failed  The step that failed, or null.
 * @property {Error|null} error      Why it stopped, or null when every step finished.
 * @property {Filter[]} created      Filters made by this run, with their new ids.
 */

/** A step failed. The message is plain English and says what state the account is in. */
export class PlanError extends Error {
  /**
   * @param {string} message
   * @param {{code: 'aborted'|'missing-label'|'step-failed'|'replace-delete-failed'|'journal-failed', cause?: unknown}} info
   */
  constructor(message, info) {
    super(message);
    this.name = 'PlanError';
    this.code = info.code;
    if (info.cause !== undefined) this.cause = info.cause;
  }
}

/**
 * Sorts steps into the order the executor runs them: createLabel, then create and replace
 * (in plan order), then delete.
 * @param {PlanStep[]} steps
 * @returns {PlanStep[]}
 */
export function orderSteps(steps) {
  const rank = { createLabel: 0, create: 1, replace: 1, delete: 2 };
  return steps
    .map((step, index) => ({ step, index }))
    .sort((a, b) => rank[a.step.op] - rank[b.step.op] || a.index - b.index)
    .map((x) => x.step);
}

/**
 * Swaps "new:<name>" placeholders for real label IDs.
 * @param {Filter} filter
 * @param {Map<string, string>} labelIds   Label name to real ID.
 * @returns {Filter}
 */
export function resolvePlaceholders(filter, labelIds) {
  /** @param {string[]|undefined} list */
  const swap = (list) =>
    list?.map((id) => {
      if (!id.startsWith(NEW_LABEL_PREFIX)) return id;
      const name = id.slice(NEW_LABEL_PREFIX.length);
      const real = labelIds.get(name);
      if (!real) {
        throw new PlanError(`The label "${name}" was not made, so this filter cannot use it.`, {
          code: 'missing-label',
        });
      }
      return real;
    });
  const action = { ...filter.action };
  if (action.addLabelIds) action.addLabelIds = swap(action.addLabelIds);
  if (action.removeLabelIds) action.removeLabelIds = swap(action.removeLabelIds);
  const out = { criteria: { ...filter.criteria }, action };
  return out;
}

/** @param {unknown} err */
function message(err) {
  return err instanceof Error ? err.message : String(err);
}

/**
 * @param {number} done
 * @param {number} total
 */
function progressText(done, total) {
  return `${done} of ${total} changes are done.`;
}

/**
 * Runs a plan. Writes run one at a time. Stops at the first failure.
 * @param {Plan} plan
 * @param {GmailApi} api
 * @param {RunOptions} [options]
 * @returns {Promise<RunResult>}
 */
export async function runPlan(plan, api, options = {}) {
  const { onProgress, journal, signal, now = () => Date.now() } = options;
  const steps = orderSteps(plan?.steps ?? []);
  const total = steps.length;
  const batch = `run-${now().toString(36)}`;
  const title = plan?.title ?? '';
  /** @type {Filter[]} */
  const created = [];
  /** @type {Map<string, string>} */
  const labelIds = new Map();
  let done = 0;

  /**
   * @param {'delete'|'replace'} op
   * @param {string} filterId
   * @param {Filter} previous
   * @param {Filter} [replacement]
   */
  async function writeJournal(op, filterId, previous, replacement) {
    if (!journal) return;
    /** @type {JournalEntry} */
    const entry = {
      batch,
      title,
      time: new Date(now()).toISOString(),
      op,
      filterId,
      previous: structuredClone(previous ?? { id: filterId, criteria: {}, action: {} }),
    };
    if (replacement) entry.replacement = structuredClone(replacement);
    try {
      await journal.record(entry);
    } catch (err) {
      throw new PlanError(
        'The undo record could not be saved, so the old filter was not deleted. Free some browser storage, then try again.',
        { code: 'journal-failed', cause: err },
      );
    }
  }

  /** @param {string} name */
  async function makeLabel(name) {
    try {
      const label = await api.createLabel(name);
      labelIds.set(name, label.id);
    } catch (err) {
      // 409: the label exists already (for example from an earlier run). Use it.
      if (/** @type {any} */ (err)?.status === 409) {
        const labels = await api.listLabels();
        const found = labels.find((l) => l.name.toLowerCase() === name.toLowerCase());
        if (found) {
          labelIds.set(name, found.id);
          return;
        }
      }
      throw err;
    }
  }

  for (const step of steps) {
    if (signal?.aborted) {
      return {
        done,
        failed: null,
        error: new PlanError(`Stopped. ${progressText(done, total)}`, {
          code: 'aborted',
          cause: signal.reason,
        }),
        created,
      };
    }
    try {
      if (step.op === 'createLabel') {
        await makeLabel(step.name);
      } else if (step.op === 'create') {
        const made = await api.createFilter(resolvePlaceholders(step.filter, labelIds));
        created.push(made);
      } else if (step.op === 'replace') {
        const made = await api.createFilter(resolvePlaceholders(step.filter, labelIds));
        created.push(made);
        try {
          await writeJournal('replace', step.filterId, step.previous, made);
          await api.deleteFilter(step.filterId);
        } catch (err) {
          throw new PlanError(
            `The new filter was made, but the old filter was not deleted. You now have both filters. Nothing is lost. Delete the old filter, or run the change again. (${message(err)}) ${progressText(done, total)}`,
            { code: 'replace-delete-failed', cause: err },
          );
        }
      } else if (step.op === 'delete') {
        await writeJournal('delete', step.filterId, step.previous);
        await api.deleteFilter(step.filterId);
      } else {
        throw new PlanError('This plan has a step that 3B Mailbox does not know.', {
          code: 'step-failed',
        });
      }
    } catch (err) {
      // Keep the original error (for example a GmailError with its status) so the UI can act on it.
      const error =
        err instanceof Error
          ? err
          : new PlanError(`${message(err)} ${progressText(done, total)}`, {
              code: 'step-failed',
              cause: err,
            });
      return { done, failed: step, error, created };
    }
    done++;
    onProgress?.({ done, total, step });
  }
  return { done, failed: null, error: null, created };
}
