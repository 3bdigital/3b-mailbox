// The shared preview, confirm and run flow. Every write in the app goes through reviewAndRun().
// 1. Preview: each step in plain English, filter count before and after, warnings.
// 2. Extra confirmation for filters that delete or forward mail.
// 3. Run with a progress bar, a polite live region and a Stop button.
// 4. Result with Undo, or a clear explanation when something went wrong.

import { isRisky, toFriendly } from '../../core/actions.js';
import { checkFilter } from '../../core/limits.js';
import { describeFilter } from '../../core/summarise.js';
import { orderSteps, runPlan } from '../../gmail/executor.js';
import { h, plural } from '../dom.js';
import { icon } from '../icons.js';
import { planUndo, remainingPlan } from '../plans.js';
import { openDialog } from './dialog.js';
import { ensureTier } from './permission.js';
import { announce } from './toast.js';
import { button, checkbox, notice } from './widgets.js';

/** @typedef {import('../../types.js').Plan} Plan */
/** @typedef {import('../../types.js').PlanStep} PlanStep */
/** @typedef {import('../../types.js').Filter} Filter */

/**
 * @typedef {object} ReviewOptions
 * @property {string} [confirmLabel]   Verb label for the confirm button. Default: the plan title.
 * @property {string} [intro]          One sentence above the steps.
 * @property {Node} [extra]            Extra content above the steps (for example a before/after view).
 * @property {(result: any, report: (text: string) => void) => Promise<string|void>} [after]
 *           Runs after a successful plan, inside the progress view. Returns a summary line.
 * @property {boolean} [noUndo]
 */

const MAX_SHOWN = 60;

/**
 * @param {Filter} filter
 * @param {Map<string, any>} labelsById
 */
function filterLine(filter, labelsById) {
  const d = describeFilter(filter, labelsById);
  return h(
    'span',
    { class: 'step-filter' },
    h('span', { class: 'step-when', text: d.when }),
    h(
      'span',
      { class: 'step-then' },
      icon('chevronRight', { size: 16 }),
      h('span', { text: d.then }),
    ),
  );
}

/**
 * @param {PlanStep} step
 * @param {Map<string, any>} labelsById
 */
function stepItem(step, labelsById) {
  if (step.op === 'createLabel') {
    return h(
      'li',
      { class: 'step step-label' },
      icon('tag'),
      h(
        'div',
        null,
        h('strong', { text: 'Make the label ' }),
        h('span', { class: 'step-name', text: `"${step.name}"` }),
      ),
    );
  }
  if (step.op === 'create') {
    return h(
      'li',
      { class: 'step step-create' },
      icon('plus'),
      h(
        'div',
        null,
        h('strong', { class: 'step-verb', text: 'Make a filter' }),
        filterLine(step.filter, labelsById),
      ),
    );
  }
  if (step.op === 'delete') {
    return h(
      'li',
      { class: 'step step-delete' },
      icon('trash'),
      h(
        'div',
        null,
        h('strong', { class: 'step-verb', text: 'Delete a filter' }),
        filterLine(step.previous, labelsById),
      ),
    );
  }
  return h(
    'li',
    { class: 'step step-replace' },
    icon('edit'),
    h(
      'div',
      null,
      h('strong', { class: 'step-verb', text: 'Change a filter' }),
      h(
        'dl',
        { class: 'step-diff' },
        h('dt', { text: 'Before' }),
        h('dd', null, filterLine(step.previous, labelsById)),
        h('dt', { text: 'After' }),
        h('dd', null, filterLine(step.filter, labelsById)),
      ),
    ),
  );
}

/**
 * What a plan needs the user to confirm, and warnings about the filters it makes.
 * @param {Plan} plan
 * @returns {{trash: number, forwards: string[], warnings: string[]}}
 */
export function planRisks(plan) {
  let trash = 0;
  /** @type {Set<string>} */
  const forwards = new Set();
  /** @type {Set<string>} */
  const warnings = new Set();
  for (const step of plan.steps) {
    if (step.op !== 'create' && step.op !== 'replace') continue;
    const f = toFriendly(step.filter.action);
    if (f.trash) trash++;
    if (f.forward) forwards.add(f.forward);
    for (const reason of isRisky(step.filter.action).reasons) {
      if (!reason.startsWith('It deletes') && !reason.startsWith('It forwards'))
        warnings.add(reason);
    }
    for (const issue of checkFilter(step.filter)) {
      if (issue.severity !== 'info') warnings.add(issue.message);
    }
  }
  return { trash, forwards: [...forwards], warnings: [...warnings] };
}

/**
 * Plain English for an error from runPlan, with the kind of help to offer.
 * @param {any} error
 * @returns {{kind: 'auth'|'tier'|'replace'|'aborted'|'other', message: string, tier?: string}}
 */
export function explainError(error) {
  const code = error?.code;
  const status = error?.status;
  if (code === 'aborted') return { kind: 'aborted', message: error.message };
  if (code === 'replace-delete-failed') return { kind: 'replace', message: error.message };
  if (status === 401 || code === 'not-signed-in') {
    return {
      kind: 'auth',
      message: 'Your sign-in ended before every change was done. Sign in again to finish the rest.',
    };
  }
  if (status === 403 && error?.tier && error.tier !== 'basic') {
    return { kind: 'tier', message: error.message, tier: error.tier };
  }
  return { kind: 'other', message: error?.message ?? 'Something went wrong.' };
}

/**
 * Shows a plan, asks for confirmation, runs it and shows the result.
 * @param {any} ctx
 * @param {Plan} plan
 * @param {ReviewOptions} [opts]
 * @returns {Promise<{ok: boolean, result: any}>}
 */
export function reviewAndRun(ctx, plan, opts = {}) {
  const st = ctx.state.get();
  const labelsById = st.labelsById;
  const before = st.filters.length;
  const after = before + plan.filterDelta;

  if (plan.steps.length === 0) {
    const close = button({ label: 'Close', variant: 'primary' });
    const d = openDialog({
      title: 'Nothing to change',
      size: 'sm',
      content: h('p', { text: 'This change would not do anything, so there is nothing to save.' }),
      footer: [close],
    });
    close.addEventListener('click', () => d.close());
    return d.closed.then(() => ({ ok: false, result: null }));
  }

  const risks = planRisks(plan);
  /** @type {HTMLInputElement[]} */
  const confirms = [];
  const confirmBoxes = [];
  if (risks.trash > 0) {
    const c = checkbox({
      label:
        risks.trash === 1
          ? 'I understand this filter will delete mail'
          : `I understand these ${risks.trash} filters will delete mail`,
      hint: 'Deleted mail goes to the Bin. Gmail removes it for good after 30 days.',
      danger: true,
    });
    confirms.push(c.input);
    confirmBoxes.push(c);
  }
  for (const address of risks.forwards) {
    const c = checkbox({
      label: `I understand this will send copies of my mail to ${address}`,
      hint: 'Only do this for an address you trust.',
      danger: true,
    });
    confirms.push(c.input);
    confirmBoxes.push(c);
  }

  const shown = plan.steps.slice(0, MAX_SHOWN);
  const stepList = h(
    'ol',
    { class: 'step-list', 'aria-label': 'Changes' },
    shown.map((s) => stepItem(s, labelsById)),
  );

  const counts = h(
    'div',
    { class: 'plan-counts' },
    h(
      'div',
      { class: 'plan-count' },
      h('span', { class: 'plan-count-label', text: 'Filters now' }),
      h('span', { class: 'plan-count-value', text: before.toLocaleString('en-GB') }),
    ),
    icon('chevronRight', { class: 'plan-count-arrow' }),
    h(
      'div',
      { class: 'plan-count' },
      h('span', { class: 'plan-count-label', text: 'After this change' }),
      h('span', { class: 'plan-count-value', text: after.toLocaleString('en-GB') }),
    ),
  );

  const confirmButton = button({
    label: opts.confirmLabel ?? plan.title,
    variant: risks.trash ? 'danger' : 'primary',
  });
  const cancelButton = button({ label: 'Cancel', variant: 'secondary' });
  const blockReason = h('p', {
    class: 'confirm-reason',
    id: 'confirm-reason',
    'aria-live': 'polite',
  });

  const d = openDialog({
    title: plan.title,
    description:
      opts.intro ??
      (ctx.mode === 'file'
        ? 'Check the changes. Nothing changes until you confirm. Gmail changes only when you import the new file.'
        : 'Check the changes. Nothing changes in Gmail until you confirm.'),
    size: 'lg',
    initialFocus: 'heading',
    content: [
      counts,
      opts.extra,
      risks.warnings.length > 0 &&
        notice({
          tone: 'warning',
          title: 'Check before you confirm',
          children: [
            h(
              'ul',
              null,
              risks.warnings.map((w) => h('li', { text: w })),
            ),
          ],
        }),
      h('h3', { class: 'section-title', text: `${plural(plan.steps.length, 'step')}` }),
      h(
        'div',
        { class: 'step-scroll', tabindex: '0', role: 'region', 'aria-label': 'List of changes' },
        stepList,
      ),
      plan.steps.length > MAX_SHOWN &&
        h('p', {
          class: 'muted',
          text: `And ${plural(plan.steps.length - MAX_SHOWN, 'more step')}.`,
        }),
      confirmBoxes.length > 0 &&
        h(
          'fieldset',
          { class: 'confirm-box' },
          h('legend', { text: 'Please confirm' }),
          confirmBoxes,
        ),
    ],
    footer: [blockReason, cancelButton, confirmButton],
  });

  const update = () => {
    const unticked = confirms.some((c) => !c.checked);
    const canWrite = ctx.canWrite();
    confirmButton.disabled = unticked || !canWrite;
    blockReason.textContent = !canWrite
      ? 'Sign in again to make changes.'
      : unticked
        ? 'Tick the boxes above to confirm.'
        : '';
    if (confirmButton.disabled) confirmButton.setAttribute('aria-describedby', 'confirm-reason');
    else confirmButton.removeAttribute('aria-describedby');
  };
  for (const c of confirms) c.addEventListener('change', update);
  update();
  const unsub = ctx.state.subscribe((_s, changed) => changed.has('auth') && update());

  let outcome = { ok: false, result: null };
  cancelButton.addEventListener('click', () => d.close());
  confirmButton.addEventListener('click', () => run(plan));

  /** @type {Filter[]} */
  const created = [];
  /** @type {any[]} */
  const entries = [];

  /** @param {Plan} current */
  async function run(current) {
    const ordered = orderSteps(current.steps);
    const total = ordered.length;
    const controller = new AbortController();
    const bar = h('span', { class: 'progress-fill' });
    const progress = h(
      'div',
      {
        class: 'progress',
        role: 'progressbar',
        'aria-label': 'Progress',
        'aria-valuemin': '0',
        'aria-valuemax': String(total),
        'aria-valuenow': '0',
      },
      bar,
    );
    const live = h('p', {
      class: 'progress-text',
      role: 'status',
      text: `0 of ${total} changes are done.`,
    });
    const stop = button({ label: 'Stop', variant: 'secondary', icon: 'close' });
    stop.addEventListener('click', () => {
      stop.disabled = true;
      live.textContent = 'Stopping after the current change...';
      controller.abort();
    });
    d.setDismissable(false);
    d.setTitle(`${current.title}...`);
    d.setBody(
      h(
        'div',
        { class: 'run' },
        h('p', {
          text:
            ctx.mode === 'file'
              ? 'Making the changes. Keep this page open.'
              : 'Making the changes in Gmail. Keep this page open.',
        }),
        progress,
        live,
      ),
    );
    d.setFooter(stop);
    stop.focus();

    const result = await runPlan(current, ctx.api, {
      signal: controller.signal,
      journal: {
        record: (e) => {
          entries.push(e);
          return ctx.journal.record(e);
        },
      },
      onProgress: ({ done }) => {
        progress.setAttribute('aria-valuenow', String(done));
        bar.style.setProperty('--fill', String(done / total));
        if (done === total || done % 3 === 0)
          live.textContent = `${done} of ${total} changes are done.`;
      },
    });
    created.push(...result.created);
    if (entries.length) ctx.state.set({ journalVersion: ctx.state.get().journalVersion + 1 });

    let afterText = '';
    if (!result.error && opts.after) {
      try {
        afterText = (await opts.after(result, (t) => (live.textContent = t))) || '';
      } catch (err) {
        afterText = err instanceof Error ? err.message : String(err);
      }
    }
    await ctx.reload({ quiet: true });
    showResult(current, ordered, result, afterText);
  }

  /**
   * @param {Plan} current
   * @param {PlanStep[]} ordered
   * @param {any} result
   * @param {string} afterText
   */
  function showResult(current, ordered, result, afterText) {
    d.setDismissable(true);
    const close = button({ label: 'Close', variant: 'primary' });
    close.addEventListener('click', () => d.close());
    const undo = button({ label: 'Undo', variant: 'secondary', icon: 'undo' });
    const canUndo = !opts.noUndo && (created.length > 0 || entries.length > 0);
    undo.addEventListener('click', async () => {
      const now = ctx.state.get().filters;
      let undoPlan;
      try {
        undoPlan = planUndo({ title: plan.title, created, entries }, now, { total: now.length });
      } catch (err) {
        announce(err.message);
        return;
      }
      d.close();
      await d.closed;
      reviewAndRun(ctx, undoPlan, {
        noUndo: false,
        intro: 'This puts your filters back as they were.',
      });
    });
    const count = ctx.state.get().filters.length;

    if (!result.error) {
      outcome = { ok: true, result };
      d.setTitle('Done');
      d.setBody(
        h(
          'div',
          { class: 'result result-success', role: 'status' },
          icon('success', { size: 28 }),
          h(
            'div',
            null,
            h('p', { class: 'result-title', text: `${current.title}: done.` }),
            h('p', { text: `You now have ${plural(count, 'filter')}.` }),
            afterText && h('p', { text: afterText }),
            ctx.mode === 'file' &&
              h('p', {
                text: 'Gmail does not change until you download the new file and import it.',
              }),
            canUndo &&
              h('p', {
                class: 'muted',
                text: 'Changed your mind? Undo puts back the filters as they were.',
              }),
          ),
        ),
      );
      d.setFooter(canUndo && undo, close);
      close.focus();
      return;
    }

    const info = explainError(result.error);
    const doneText = `${result.done} of ${ordered.length} changes are done.`;
    /** @type {any[]} */
    const buttons = [];
    if (info.kind === 'auth' && ctx.mode === 'google') {
      buttons.push(
        button({
          label: 'Sign in and finish',
          variant: 'primary',
          icon: 'signin',
          onClick: async () => {
            if (await ctx.signIn()) run(remainingPlan(current, ordered, result.done));
          },
        }),
      );
    }
    if (info.kind === 'tier') {
      buttons.push(
        button({
          label: 'Allow and finish',
          variant: 'primary',
          onClick: async () => {
            if (await ensureTier(ctx, /** @type {any} */ (info.tier)))
              run(remainingPlan(current, ordered, result.done));
          },
        }),
      );
    }
    d.setTitle(info.kind === 'aborted' ? 'Stopped' : 'Not every change was made');
    d.setBody(
      h(
        'div',
        {
          class: ['result', info.kind === 'aborted' ? 'result-warning' : 'result-danger'],
          role: 'alert',
        },
        icon(info.kind === 'aborted' ? 'warning' : 'error', { size: 28 }),
        h(
          'div',
          null,
          h('p', { class: 'result-title', text: info.message }),
          info.kind !== 'aborted' && h('p', { text: doneText }),
          info.kind === 'replace'
            ? h('p', {
                text: 'Your mail is safe. A copy of the old filter is in Change history in Settings.',
              })
            : h('p', {
                class: 'muted',
                text: 'Changes that finished are saved. The rest did not run.',
              }),
        ),
      ),
    );
    d.setFooter(canUndo && undo, ...buttons, close);
    (buttons[0] ?? close).focus();
  }

  return d.closed.then(() => {
    unsub();
    return outcome;
  });
}
