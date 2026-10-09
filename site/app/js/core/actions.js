// @ts-check
// Converts between the Gmail API action shape and the friendly UI shape.

/** @typedef {import('../types.js').FilterAction} FilterAction */
/** @typedef {import('../types.js').FriendlyAction} FriendlyAction */

/**
 * Gmail system label IDs that filters use.
 * @type {Readonly<{INBOX: 'INBOX', UNREAD: 'UNREAD', STARRED: 'STARRED', TRASH: 'TRASH', SPAM: 'SPAM',
 *   IMPORTANT: 'IMPORTANT', CATEGORY_PERSONAL: 'CATEGORY_PERSONAL', CATEGORY_SOCIAL: 'CATEGORY_SOCIAL',
 *   CATEGORY_PROMOTIONS: 'CATEGORY_PROMOTIONS', CATEGORY_UPDATES: 'CATEGORY_UPDATES', CATEGORY_FORUMS: 'CATEGORY_FORUMS'}>}
 */
export const SYSTEM_LABELS = Object.freeze({
  INBOX: 'INBOX',
  UNREAD: 'UNREAD',
  STARRED: 'STARRED',
  TRASH: 'TRASH',
  SPAM: 'SPAM',
  IMPORTANT: 'IMPORTANT',
  CATEGORY_PERSONAL: 'CATEGORY_PERSONAL',
  CATEGORY_SOCIAL: 'CATEGORY_SOCIAL',
  CATEGORY_PROMOTIONS: 'CATEGORY_PROMOTIONS',
  CATEGORY_UPDATES: 'CATEGORY_UPDATES',
  CATEGORY_FORUMS: 'CATEGORY_FORUMS',
});

/** Category label IDs, in the order Gmail shows the tabs. */
export const CATEGORIES = /** @type {const} */ ([
  'CATEGORY_PERSONAL',
  'CATEGORY_SOCIAL',
  'CATEGORY_PROMOTIONS',
  'CATEGORY_UPDATES',
  'CATEGORY_FORUMS',
]);

/** Other Gmail system label IDs. They are kept in otherAdd / otherRemove, never in labelIds. */
const OTHER_SYSTEM = new Set(['SENT', 'DRAFT', 'CHAT']);

/**
 * True when an ID is a Gmail system label ID (all capitals), not a user label ID.
 * @param {string} id
 * @returns {boolean}
 */
export function isSystemLabelId(id) {
  return (
    Object.prototype.hasOwnProperty.call(SYSTEM_LABELS, id) ||
    OTHER_SYSTEM.has(id) ||
    /^[A-Z][A-Z_]*$/.test(id)
  );
}

/**
 * A friendly action that does nothing.
 * @returns {FriendlyAction}
 */
export function emptyFriendly() {
  return {
    archive: false,
    markRead: false,
    star: false,
    trash: false,
    neverSpam: false,
    important: null,
    category: null,
    labelIds: [],
    forward: null,
    otherAdd: [],
    otherRemove: [],
  };
}

/**
 * @param {string[]} list
 * @param {string} value
 */
function pushUnique(list, value) {
  if (!list.includes(value)) list.push(value);
}

/**
 * Converts a Gmail API action to the friendly shape.
 * @param {FilterAction} action
 * @returns {FriendlyAction}
 */
export function toFriendly(action) {
  const f = emptyFriendly();
  const add = Array.isArray(action?.addLabelIds) ? action.addLabelIds : [];
  const remove = Array.isArray(action?.removeLabelIds) ? action.removeLabelIds : [];
  for (const id of add) {
    if (id === 'STARRED') f.star = true;
    else if (id === 'TRASH') f.trash = true;
    else if (id === 'IMPORTANT') f.important = 'always';
    else if (/** @type {readonly string[]} */ (CATEGORIES).includes(id) && f.category === null) {
      f.category = /** @type {FriendlyAction['category']} */ (id);
    } else if (isSystemLabelId(id)) pushUnique(f.otherAdd, id);
    else pushUnique(f.labelIds, id);
  }
  for (const id of remove) {
    if (id === 'INBOX') f.archive = true;
    else if (id === 'UNREAD') f.markRead = true;
    else if (id === 'SPAM') f.neverSpam = true;
    else if (id === 'IMPORTANT' && f.important !== 'always') f.important = 'never';
    else pushUnique(f.otherRemove, id);
  }
  if (typeof action?.forward === 'string' && action.forward.trim())
    f.forward = action.forward.trim();
  return f;
}

/**
 * Converts a friendly action to the Gmail API shape. Empty arrays and a null forward are left out.
 * @param {Partial<FriendlyAction>} friendly
 * @returns {FilterAction}
 */
export function toApi(friendly) {
  /** @type {string[]} */
  const add = [];
  /** @type {string[]} */
  const remove = [];
  if (friendly.archive) remove.push('INBOX');
  if (friendly.markRead) remove.push('UNREAD');
  if (friendly.neverSpam) remove.push('SPAM');
  if (friendly.important === 'never') remove.push('IMPORTANT');
  if (friendly.star) add.push('STARRED');
  if (friendly.trash) add.push('TRASH');
  if (friendly.important === 'always') add.push('IMPORTANT');
  if (friendly.category) add.push(friendly.category);
  for (const id of friendly.labelIds ?? []) pushUnique(add, id);
  for (const id of friendly.otherAdd ?? []) pushUnique(add, id);
  for (const id of friendly.otherRemove ?? []) pushUnique(remove, id);
  /** @type {FilterAction} */
  const out = {};
  if (add.length) out.addLabelIds = add;
  if (remove.length) out.removeLabelIds = remove;
  if (friendly.forward) out.forward = friendly.forward;
  return out;
}

/**
 * A canonical, order-independent key. Two actions with the same key do the same thing.
 * @param {FilterAction} action
 * @returns {string}
 */
export function actionKey(action) {
  const add = [...new Set(action?.addLabelIds ?? [])].sort();
  const remove = [...new Set(action?.removeLabelIds ?? [])].sort();
  const forward = (action?.forward ?? '').trim().toLowerCase();
  return `add:${add.join(',')}|remove:${remove.join(',')}|forward:${forward}`;
}

/**
 * True when the action does nothing at all.
 * @param {FilterAction} action
 * @returns {boolean}
 */
export function isEmptyAction(action) {
  return (
    !(action?.addLabelIds?.length > 0) &&
    !(action?.removeLabelIds?.length > 0) &&
    !(typeof action?.forward === 'string' && action.forward.trim())
  );
}

/**
 * Finds actions that can hide or send away mail.
 * @param {FilterAction} action
 * @returns {{risky: boolean, reasons: string[]}}
 */
export function isRisky(action) {
  const f = toFriendly(action);
  /** @type {string[]} */
  const reasons = [];
  if (f.trash) reasons.push('It deletes mail.');
  if (f.forward) reasons.push(`It forwards mail to ${f.forward}.`);
  if (f.archive && f.markRead) {
    reasons.push('It skips the inbox and marks mail as read, so you may not see it.');
  }
  if (f.neverSpam) reasons.push('It stops Gmail from sending this mail to spam.');
  return { risky: reasons.length > 0, reasons };
}
