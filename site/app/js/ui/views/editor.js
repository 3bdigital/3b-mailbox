// #/filters/new and #/filters/:id: the filter editor.
// Simple fields or an advanced Gmail search, actions, live summary, length meter and warnings.
// Unsaved input lives in ctx.drafts, so a sign-in or a trip to another page never loses it.

import { CATEGORIES, emptyFriendly, toApi, toFriendly } from '../../core/actions.js';
import { makePlan, planCreate, planEdit } from '../../core/bulk.js';
import {
  LIMITS,
  checkFilter,
  criteriaLength,
  criteriaToSearch,
  isEmptyCriteria,
} from '../../core/limits.js';
import { findUnsafeOperators } from '../../core/query.js';
import { describeFilter } from '../../core/summarise.js';
import { NEEDS_SIGN_IN } from '../../gmail/file-source.js';
import { labelPicker } from '../components/label-picker.js';
import { showMatches } from '../components/matches.js';
import { ensureTier } from '../components/permission.js';
import { reviewAndRun } from '../components/plan-preview.js';
import { queryEditor } from '../components/query-editor.js';
import { toast } from '../components/toast.js';
import {
  button,
  checkbox,
  emptyState,
  meter,
  notice,
  segmented,
  selectField,
  textField,
  viewHeader,
} from '../components/widgets.js';
import { h, plural, replace } from '../dom.js';
import { icon } from '../icons.js';
import { dataGate } from './common.js';

/** @typedef {import('../../types.js').Filter} Filter */
/** @typedef {import('../../types.js').FilterCriteria} FilterCriteria */
/** @typedef {import('../../types.js').FriendlyAction} FriendlyAction */

const KB = 1024;
const MB = 1024 * 1024;

const CATEGORY_LABELS = {
  CATEGORY_PERSONAL: 'Primary',
  CATEGORY_SOCIAL: 'Social',
  CATEGORY_PROMOTIONS: 'Promotions',
  CATEGORY_UPDATES: 'Updates',
  CATEGORY_FORUMS: 'Forums',
};

/**
 * @typedef {object} Draft
 * @property {'form'|'search'} mode
 * @property {FilterCriteria} criteria
 * @property {FriendlyAction} friendly
 * @property {string} sizeValue
 * @property {'MB'|'KB'|'bytes'} sizeUnit
 * @property {boolean} applyExisting
 * @property {boolean} dirty
 * @property {string} [copiedFrom]
 */

/**
 * @param {Filter|null} filter
 * @returns {Draft}
 */
function draftFrom(filter) {
  const c = structuredClone(filter?.criteria ?? {});
  const size = Number(c.size) || 0;
  let sizeUnit = /** @type {Draft['sizeUnit']} */ ('MB');
  let sizeValue = '';
  if (size > 0) {
    if (size % MB === 0) sizeValue = String(size / MB);
    else if (size % KB === 0) {
      sizeUnit = 'KB';
      sizeValue = String(size / KB);
    } else {
      sizeUnit = 'bytes';
      sizeValue = String(size);
    }
  }
  return {
    mode: 'form',
    criteria: c,
    friendly: filter ? toFriendly(filter.action) : emptyFriendly(),
    sizeValue,
    sizeUnit,
    applyExisting: false,
    dirty: false,
  };
}

/**
 * The criteria in a draft, ready to save. Size comes from the size fields.
 * @param {Draft} d
 * @returns {FilterCriteria}
 */
export function draftCriteria(d) {
  /** @type {FilterCriteria} */
  const out = {};
  const c = d.criteria;
  for (const k of /** @type {const} */ (['from', 'to', 'subject', 'query', 'negatedQuery'])) {
    const v = (c[k] ?? '').trim();
    if (v) out[k] = v;
  }
  if (d.mode === 'form') {
    if (c.hasAttachment) out.hasAttachment = true;
    const n = Number(d.sizeValue);
    if ((c.sizeComparison === 'larger' || c.sizeComparison === 'smaller') && n > 0) {
      out.sizeComparison = c.sizeComparison;
      out.size = Math.round(n * (d.sizeUnit === 'MB' ? MB : d.sizeUnit === 'KB' ? KB : 1));
    }
  }
  if (c.excludeChats) out.excludeChats = true;
  return out;
}

/**
 * @param {any} ctx
 * @param {{id?: string}} params
 */
export function render(ctx, params) {
  const isNew = !params.id;
  const key = isNew ? 'new' : params.id;
  const title = isNew ? 'New filter' : 'Edit filter';

  const gate = dataGate(ctx, {
    watchOnly: ['status'],
    render: (s) => {
      /** @type {Filter|null} */
      const original = isNew ? null : (s.filters.find((f) => f.id === params.id) ?? null);
      if (!isNew && !original) {
        return emptyState({
          icon: 'filter',
          title: 'This filter is not there any more',
          text: 'It may have been changed or deleted. Changed filters get a new ID in Gmail.',
          actions: [button({ label: 'Back to filters', variant: 'primary', href: '#/filters' })],
        });
      }
      const restored = ctx.drafts.has(key);
      /** @type {Draft} */
      let draft = ctx.drafts.get(key);
      if (!draft || !('friendly' in draft)) {
        const base =
          draft && 'criteria' in draft
            ? draftFrom(/** @type {any} */ (draft))
            : draftFrom(original);
        if (draft?.copiedFrom) base.copiedFrom = draft.copiedFrom;
        draft = base;
        ctx.drafts.set(key, draft);
      }
      return editorForm(ctx, s, { draft, original, key, restored: restored && draft.dirty });
    },
  });

  const el = h(
    'div',
    { class: 'view-editor' },
    h(
      'p',
      { class: 'back-link' },
      h(
        'a',
        { href: '#/filters' },
        icon('chevron', { size: 16, class: 'back-icon' }),
        h('span', { text: 'All filters' }),
      ),
    ),
    viewHeader({
      title,
      lead: isNew
        ? 'Choose which mail to catch, then what to do with it.'
        : 'Change which mail it catches or what it does.',
    }),
    gate.el,
  );
  return { el, title, destroy: gate.destroy };
}

/**
 * @param {any} ctx
 * @param {any} s
 * @param {{draft: Draft, original: Filter|null, key: string, restored: boolean}} o
 */
function editorForm(ctx, s, o) {
  const { draft, original, key } = o;
  const touch = () => {
    draft.dirty = true;
    update();
  };

  // ---- Which mail
  const criteriaArea = h('div', { class: 'criteria-area' });
  /** @type {Record<string, any>} */
  const fields = {};

  function buildCriteria() {
    const c = draft.criteria;
    if (draft.mode === 'search') {
      fields.search = queryEditor({
        label: 'Gmail search',
        multiline: true,
        value: c.query ?? '',
        hint: 'Write the search as you would in the Gmail search box. Type an operator such as from: or list: to see suggestions.',
        onInput: (v) => {
          c.query = v;
          touch();
        },
      });
      replace(
        criteriaArea,
        fields.search,
        h('p', {
          class: 'field-hint',
          text: 'Operators marked "Not for filters", such as is: and label:, never match new mail.',
        }),
      );
      return;
    }
    /** @param {'from'|'to'|'subject'|'negatedQuery'} k */
    const text = (k, label, hint, placeholder) => {
      const f = textField({
        label,
        hint,
        value: c[k] ?? '',
        placeholder,
        spellcheck: false,
        onInput: (v) => {
          c[k] = v;
          touch();
        },
      });
      fields[k] = f;
      return f;
    };
    fields.query = queryEditor({
      label: 'Has the words',
      value: c.query ?? '',
      hint: 'Words or a Gmail search. Type an operator such as list: to see suggestions.',
      onInput: (v) => {
        c.query = v;
        touch();
      },
    });
    const attachment = checkbox({
      label: 'Has an attachment',
      checked: c.hasAttachment,
      onChange: (v) => {
        c.hasAttachment = v;
        touch();
      },
    });
    const sizeCmp = selectField({
      label: 'Size',
      value:
        c.sizeComparison === 'larger' || c.sizeComparison === 'smaller' ? c.sizeComparison : '',
      options: [
        { value: '', label: 'Any size' },
        { value: 'larger', label: 'Larger than' },
        { value: 'smaller', label: 'Smaller than' },
      ],
      onChange: (v) => {
        c.sizeComparison = /** @type {any} */ (v || undefined);
        sizeValue.input.disabled = !v;
        sizeUnit.select.disabled = !v;
        touch();
      },
    });
    const sizeValue = textField({
      label: 'Size amount',
      value: draft.sizeValue,
      inputmode: 'decimal',
      onInput: (v) => {
        draft.sizeValue = v;
        touch();
      },
    });
    fields.size = sizeValue;
    const sizeUnit = selectField({
      label: 'Unit',
      value: draft.sizeUnit,
      options: [
        { value: 'MB', label: 'MB' },
        { value: 'KB', label: 'KB' },
        { value: 'bytes', label: 'Bytes' },
      ],
      onChange: (v) => {
        draft.sizeUnit = /** @type {any} */ (v);
        touch();
      },
    });
    sizeValue.input.disabled = !sizeCmp.select.value;
    sizeUnit.select.disabled = !sizeCmp.select.value;
    replace(
      criteriaArea,
      h(
        'div',
        { class: 'form-grid' },
        text(
          'from',
          'From',
          'An address or a domain. Use OR for more than one, for example amazon.co.uk OR ebay.co.uk.',
          '',
        ),
        text('to', 'To', 'Useful for aliases, for example you+shop@gmail.com.', ''),
        text('subject', 'Subject', 'Words in the subject line.', ''),
        fields.query,
        text('negatedQuery', "Doesn't have", 'Mail with any of these words is left alone.', ''),
      ),
      h(
        'div',
        { class: 'form-row-inline' },
        attachment,
        h('div', { class: 'size-row' }, sizeCmp, sizeValue, sizeUnit),
      ),
    );
  }

  const modeSwitch = segmented({
    legend: 'How to choose mail',
    name: `mode-${key}`,
    value: draft.mode,
    options: [
      { value: 'form', label: 'Simple form' },
      { value: 'search', label: 'Advanced: Gmail search' },
    ],
    onChange: (v) => {
      if (v === draft.mode) return;
      const current = draftCriteria(draft);
      if (v === 'search') {
        const query = criteriaToSearch({ ...current, excludeChats: false });
        draft.criteria = { query, excludeChats: current.excludeChats };
      } else {
        draft.criteria = {
          query: draft.criteria.query ?? '',
          excludeChats: draft.criteria.excludeChats,
        };
      }
      draft.mode = /** @type {any} */ (v);
      buildCriteria();
      touch();
    },
  });

  // ---- Actions
  const fr = draft.friendly;
  const flag = (k, label, opts = {}) =>
    checkbox({
      label,
      checked: fr[k],
      danger: opts.danger,
      hint: opts.hint,
      onChange: (v) => {
        fr[k] = v;
        touch();
      },
    });
  const picker = labelPicker({
    labels: s.labels,
    labelsById: s.labelsById,
    selected: fr.labelIds,
    label: 'Apply labels',
    onChange: (ids) => {
      fr.labelIds = ids;
      touch();
    },
  });
  const accepted = s.forwarding.filter((a) => a.verificationStatus === 'accepted');
  const forward = selectField({
    label: 'Forward it to',
    value: fr.forward ?? '',
    hint: h(
      'span',
      null,
      'Only verified addresses work. To add a new address, open Gmail settings, then ',
      h(
        'a',
        {
          href: 'https://mail.google.com/mail/u/0/#settings/fwdandpop',
          target: '_blank',
          rel: 'noopener noreferrer',
        },
        'Forwarding and POP/IMAP',
        h('span', { class: 'visually-hidden', text: ' (opens in a new tab)' }),
      ),
      ', and add it there first.',
    ),
    options: [
      {
        value: '',
        label: accepted.length ? 'Do not forward' : 'Do not forward (no verified addresses)',
      },
      ...s.forwarding.map((a) => ({
        value: a.forwardingEmail,
        label:
          a.verificationStatus === 'accepted'
            ? a.forwardingEmail
            : `${a.forwardingEmail} (waiting for you to verify it in Gmail)`,
        disabled: a.verificationStatus !== 'accepted',
      })),
    ],
    onChange: (v) => {
      fr.forward = v || null;
      touch();
    },
  });
  const important = selectField({
    label: 'Importance',
    value: fr.important ?? '',
    options: [
      { value: '', label: 'Let Gmail decide' },
      { value: 'always', label: 'Always mark as important' },
      { value: 'never', label: 'Never mark as important' },
    ],
    onChange: (v) => {
      fr.important = /** @type {any} */ (v || null);
      touch();
    },
  });
  const category = selectField({
    label: 'Category',
    value: fr.category ?? '',
    options: [
      { value: '', label: 'Let Gmail decide' },
      ...CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] })),
    ],
    onChange: (v) => {
      fr.category = /** @type {any} */ (v || null);
      touch();
    },
  });
  const actionsFieldset = h(
    'fieldset',
    { class: 'fieldset actions-fieldset', id: `actions-${key}`, tabindex: '-1' },
    h('legend', { text: 'Choose at least one action' }),
    h(
      'div',
      { class: 'check-grid' },
      flag('archive', 'Skip the inbox (archive)'),
      flag('markRead', 'Mark as read'),
      flag('star', 'Star it'),
      flag('neverSpam', 'Never send it to spam'),
      flag('trash', 'Delete it', { danger: true, hint: 'Mail goes to the Bin.' }),
    ),
    picker,
    h('div', { class: 'field-row' }, important, category),
    forward,
  );

  // ---- Apply to existing mail
  const applyStatus = h('p', { class: 'field-hint', role: 'status' });
  const noSignIn = ctx.mode === 'file';
  if (noSignIn) draft.applyExisting = false;
  const apply = checkbox({
    label: 'Also apply to existing mail',
    checked: draft.applyExisting,
    disabled: noSignIn,
    hint: noSignIn
      ? NEEDS_SIGN_IN
      : 'Gmail filters only act on new mail. Tick this to also label the mail you have now. This needs an extra permission. Delete and forward only act on new mail.',
    onChange: async (v) => {
      if (v) {
        const ok = await ensureTier(ctx, 'apply', {
          why: 'To change mail you already have, 3B Mailbox needs permission to change labels on your mail.',
        });
        if (!ok) {
          apply.input.checked = false;
          draft.applyExisting = false;
          return;
        }
      }
      draft.applyExisting = v;
      countExisting();
    },
  });
  async function countExisting() {
    if (!draft.applyExisting) {
      applyStatus.textContent = '';
      return;
    }
    const c = draftCriteria(draft);
    if (isEmptyCriteria(c)) {
      applyStatus.textContent = 'Add search terms to see how many emails match.';
      return;
    }
    applyStatus.textContent = 'Counting matching emails...';
    try {
      const found = await ctx.api.searchMessages(criteriaToSearch(c), 100);
      applyStatus.textContent =
        found.length >= 100
          ? 'At least 100 emails match now.'
          : `${plural(found.length, 'email')} match now.`;
    } catch (err) {
      applyStatus.textContent = err.message;
    }
  }

  // ---- Live panel
  const summaryWhen = h('p', { class: 'summary-when' });
  const summaryThen = h('p', { class: 'summary-then' });
  const lengthArea = h('div');
  const warnings = h('div', { class: 'warnings', 'aria-live': 'polite' });
  const errorSummary = h('div', { class: 'error-summary-area' });

  function currentFilter() {
    return { criteria: draftCriteria(draft), action: toApi(draft.friendly) };
  }

  function update() {
    const f = currentFilter();
    const d = describeFilter(f, s.labelsById);
    const empty = isEmptyCriteria(f.criteria);
    summaryWhen.textContent = empty ? 'Add search terms to choose which mail to catch.' : d.when;
    summaryThen.textContent = d.then === 'Do nothing' ? 'Choose at least one action.' : d.then;
    const length = criteriaLength(f.criteria);
    const level =
      length > LIMITS.criteriaCharsHard
        ? 'full'
        : length > LIMITS.criteriaCharsSafe
          ? 'danger'
          : length > LIMITS.criteriaCharsSafe * LIMITS.warnRatio
            ? 'warn'
            : 'ok';
    replace(
      lengthArea,
      meter({
        label: 'Length',
        value: length,
        max: LIMITS.criteriaCharsSafe,
        level,
        valueText: `${length.toLocaleString('en-GB')} of ${LIMITS.criteriaCharsSafe.toLocaleString('en-GB')} characters`,
      }),
    );
    const unsafe = [
      ...findUnsafeOperators(f.criteria.query ?? ''),
      ...findUnsafeOperators(f.criteria.negatedQuery ?? ''),
    ];
    const issues = checkFilter(f).filter(
      (i) => i.code !== 'empty-criteria' && i.code !== 'forwards',
    );
    /** @type {HTMLElement[]} */
    const items = issues.map((i) =>
      notice({
        tone: i.severity === 'error' ? 'danger' : 'warning',
        title: i.message,
        text: i.fix,
      }),
    );
    if (unsafe.length && !issues.some((i) => i.code === 'unsafe-operator')) {
      items.push(
        notice({
          tone: 'warning',
          title: `${unsafe.join(', ')} never matches new mail in a filter.`,
        }),
      );
    }
    if (draft.friendly.trash)
      items.push(
        notice({
          tone: 'danger',
          title: 'This filter deletes mail.',
          text: 'You will be asked to confirm before it is saved.',
        }),
      );
    if (draft.friendly.archive && draft.friendly.markRead) {
      items.push(
        notice({
          tone: 'warning',
          title: 'You may not see this mail.',
          text: 'It skips the inbox and is marked as read.',
        }),
      );
    }
    replace(warnings, items);
    ctx.drafts.set(key, draft);
  }

  // ---- Save
  function validate() {
    /** @type {Array<{text: string, target: HTMLElement}>} */
    const errors = [];
    const f = currentFilter();
    for (const fld of Object.values(fields)) fld.setError?.('');
    if (draft.mode === 'form' && draft.criteria.sizeComparison && !(Number(draft.sizeValue) > 0)) {
      errors.push({ text: 'Enter a size larger than 0.', target: fields.size.input });
      fields.size.setError('Enter a number larger than 0.');
    } else if (isEmptyCriteria(f.criteria)) {
      if (draft.mode === 'search') {
        errors.push({ text: 'Write a Gmail search.', target: fields.search.input });
      } else {
        errors.push({
          text: 'Add at least one search term, for example a sender.',
          target: fields.from.input,
        });
        fields.from.setError('Add a sender or another search term.');
      }
    }
    if (Object.keys(f.action).length === 0) {
      errors.push({ text: 'Choose at least one action.', target: actionsFieldset });
    }
    const length = criteriaLength(f.criteria);
    if (length > LIMITS.criteriaCharsHard) {
      errors.push({
        text: `This filter is ${length} characters long. Make it shorter than ${LIMITS.criteriaCharsHard}.`,
        target: (fields.query ?? fields.search).input,
      });
    }
    if (errors.length === 0) {
      replace(errorSummary);
      return true;
    }
    const summary = h(
      'div',
      { class: 'error-summary', role: 'alert', tabindex: '-1' },
      h(
        'h2',
        { class: 'error-summary-title' },
        icon('error'),
        h('span', { text: `Fix ${plural(errors.length, 'problem')} before you save` }),
      ),
      h(
        'ul',
        null,
        errors.map((e) =>
          h(
            'li',
            null,
            h('a', {
              href: '#',
              text: e.text,
              on: {
                click: (ev) => {
                  ev.preventDefault();
                  e.target?.focus();
                },
              },
            }),
          ),
        ),
      ),
    );
    replace(errorSummary, summary);
    summary.focus();
    return false;
  }

  async function save() {
    if (!validate()) return;
    const f = currentFilter();
    const newLabels = (f.action.addLabelIds ?? [])
      .filter((id) => id.startsWith('new:'))
      .map((id) => id.slice(4));
    const opts = {
      total: s.filters.length,
      labelCount: s.labels.filter((l) => l.type === 'user').length,
    };
    let plan;
    try {
      if (original) {
        plan = planEdit(original, f, opts);
        if (newLabels.length && plan.steps.length) {
          plan = makePlan(
            plan.title,
            [
              ...newLabels.map((name) => ({ op: /** @type {const} */ ('createLabel'), name })),
              ...plan.steps,
            ],
            opts,
          );
        }
      } else plan = planCreate([f], newLabels, opts);
    } catch (err) {
      toast(err.message, { tone: 'danger' });
      return;
    }
    const q = criteriaToSearch(f.criteria);
    const applyNow = draft.applyExisting && ctx.auth?.hasTier('apply');
    const result = await reviewAndRun(ctx, plan, {
      confirmLabel: original ? 'Save changes' : 'Create filter',
      extra: applyNow
        ? notice({
            tone: 'info',
            title: 'It also changes the mail you have now.',
            text: 'Labels, star, read and archive changes also apply to existing emails that match.',
          })
        : undefined,
      after: applyNow
        ? async (run, report) => {
            const made = run.created[run.created.length - 1];
            if (!made) return '';
            const add = (made.action.addLabelIds ?? []).filter((id) => id !== 'TRASH');
            const remove = made.action.removeLabelIds ?? [];
            report('Changing existing mail...');
            const n = await ctx.api.applyToExisting(q, add, remove, (done) =>
              report(`${plural(done, 'email')} changed so far.`),
            );
            return `${plural(n, 'existing email')} changed.`;
          }
        : undefined,
    });
    if (result.ok) {
      ctx.drafts.delete(key);
      ctx.navigate('#/filters');
    }
  }

  function discard() {
    ctx.drafts.delete(key);
    ctx.navigate('#/filters');
  }

  buildCriteria();
  update();

  const form = h(
    'form',
    {
      class: 'editor',
      novalidate: true,
      'aria-label': original ? 'Edit filter' : 'New filter',
      on: {
        submit: (e) => {
          e.preventDefault();
          save();
        },
      },
    },
    errorSummary,
    o.restored &&
      notice({
        tone: 'info',
        text: 'Your unsaved changes are back. Nothing is saved until you choose Save.',
      }),
    draft.copiedFrom &&
      notice({
        tone: 'info',
        text: 'This is a copy. Gmail does not allow two filters that are exactly the same, so change something before you save.',
      }),
    h(
      'div',
      { class: 'editor-layout' },
      h(
        'div',
        { class: 'editor-main' },
        h(
          'section',
          { class: 'card form-section', 'aria-labelledby': `which-${key}` },
          h(
            'h2',
            { id: `which-${key}`, class: 'card-title' },
            h('span', { class: 'step-number', text: '1' }),
            'Which mail',
          ),
          modeSwitch,
          criteriaArea,
          h(
            'div',
            { class: 'inline-actions' },
            button({
              label: 'Show matching mail',
              icon: 'mail',
              disabled: noSignIn,
              describedBy: noSignIn ? `matches-why-${key}` : undefined,
              onClick: () => showMatches(ctx, draftCriteria(draft)),
            }),
            noSignIn &&
              h('span', { id: `matches-why-${key}`, class: 'needs-sign-in', text: NEEDS_SIGN_IN }),
          ),
        ),
        h(
          'section',
          { class: 'card form-section', 'aria-labelledby': `what-${key}` },
          h(
            'h2',
            { id: `what-${key}`, class: 'card-title' },
            h('span', { class: 'step-number', text: '2' }),
            'What to do with it',
          ),
          actionsFieldset,
          h('div', { class: 'apply-existing' }, apply, applyStatus),
        ),
      ),
      h(
        'aside',
        { class: 'editor-side', 'aria-labelledby': `summary-${key}` },
        h(
          'div',
          { class: 'card summary-card' },
          h('h2', { id: `summary-${key}`, class: 'card-title', text: 'Summary' }),
          h(
            'div',
            { class: 'summary' },
            h('p', { class: 'summary-label', text: 'When mail is' }),
            summaryWhen,
            h('p', { class: 'summary-label', text: 'Then' }),
            summaryThen,
          ),
          lengthArea,
          warnings,
          h(
            'div',
            { class: 'editor-buttons' },
            button({
              label: original ? 'Save changes' : 'Create filter',
              variant: 'primary',
              type: 'submit',
              icon: 'check',
            }),
            button({ label: 'Discard', variant: 'quiet', onClick: discard }),
          ),
        ),
      ),
    ),
  );
  if (draft.applyExisting) countExisting();
  return form;
}
