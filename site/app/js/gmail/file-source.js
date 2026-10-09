// @ts-check
// The data source for "no sign-in" mode: an in-memory Gmail seeded from the user's mailFilters.xml.
// It makes no network requests. Matching mail and "apply to existing mail" need Google sign-in.

import { GmailError } from './client.js';
import { createMockGmail } from './mock.js';

/** @typedef {import('../types.js').Filter} Filter */
/** @typedef {import('../types.js').Label} Label */
/** @typedef {import('../types.js').PermissionTier} PermissionTier */
/** @typedef {import('./mock.js').MockGmail} MockGmail */

/** The reason shown for every feature that needs Google. */
export const NEEDS_SIGN_IN = 'Needs Google sign-in.';

/**
 * @typedef {object} ParsedFile
 * @property {Filter[]} filters        Label IDs are "new:<name>" placeholders.
 * @property {string[]} labelNames
 * @property {string[]} forwardAddresses
 */

/**
 * Turns the parsed file into account data: one user label per name, every forwarding address
 * treated as verified (the filters worked in Gmail), and label placeholders swapped for label IDs.
 * @param {ParsedFile} parsed
 * @returns {{filters: Filter[], labels: Label[], forwardingAddresses: import('../types.js').ForwardingAddress[]}}
 */
export function seedFromFile(parsed) {
  /** @type {Label[]} */
  const labels = parsed.labelNames.map((name, i) => ({
    id: `Label_${i + 1}`,
    name,
    type: 'user',
    labelListVisibility: 'labelShow',
    messageListVisibility: 'show',
  }));
  const idByName = new Map(labels.map((l) => [l.name, l.id]));
  /** @param {string} id */
  const swap = (id) => (id.startsWith('new:') ? (idByName.get(id.slice(4)) ?? id) : id);
  const filters = parsed.filters.map((f) => {
    const action = { ...f.action };
    if (action.addLabelIds) action.addLabelIds = action.addLabelIds.map(swap);
    return { ...f, criteria: { ...f.criteria }, action };
  });
  return {
    filters,
    labels,
    forwardingAddresses: parsed.forwardAddresses.map((forwardingEmail) => ({
      forwardingEmail,
      verificationStatus: 'accepted',
    })),
  };
}

/**
 * A key for what a set of filters does, with no filter IDs and with label names in place of IDs.
 * Two sets with the same key give the same mailFilters.xml. Used for "changed since last download".
 * @param {Filter[]} filters
 * @param {Map<string, Label>} labelsById
 * @returns {string}
 */
export function contentKey(filters, labelsById) {
  /** @param {string} id */
  const name = (id) => labelsById.get(id)?.name ?? id;
  return JSON.stringify(
    filters
      .map((f) => {
        const c = f.criteria ?? {};
        const a = f.action ?? {};
        return JSON.stringify([
          Object.keys(c)
            .sort()
            .map((k) => [k, c[/** @type {keyof typeof c} */ (k)]]),
          (a.addLabelIds ?? []).map(name).sort(),
          [...(a.removeLabelIds ?? [])].sort(),
          a.forward ?? '',
        ]);
      })
      .sort(),
  );
}

/**
 * A stand-in for gmail/auth.js in no sign-in mode. Only the basic tier exists.
 */
export function createFileAuth() {
  return {
    async signIn() {},
    async upgrade() {
      throw new Error(NEEDS_SIGN_IN);
    },
    revoke() {},
    async signOut() {},
    getToken: () => 'file',
    /** @param {PermissionTier} tier */
    hasTier: (tier) => tier === 'basic',
    expiresAt: () => null,
    onChange: () => () => {},
  };
}

/**
 * The GmailApi for no sign-in mode.
 * @param {ParsedFile} parsed
 * @returns {MockGmail}
 */
export function createFileGmail(parsed) {
  const mock = createMockGmail({ ...seedFromFile(parsed), messages: [] });
  const unavailable = () =>
    Promise.reject(
      new GmailError(NEEDS_SIGN_IN, { status: 403, reason: 'noSignIn', detail: NEEDS_SIGN_IN }),
    );
  return { ...mock, searchMessages: unavailable, applyToExisting: unavailable };
}
