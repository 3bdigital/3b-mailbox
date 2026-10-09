// A small store for app state. Views subscribe and update the parts they show.

/**
 * @typedef {import('../types.js').Filter} Filter
 * @typedef {import('../types.js').Label} Label
 * @typedef {import('../types.js').ForwardingAddress} ForwardingAddress
 * @typedef {import('../types.js').Issue} Issue
 */

/** Preference keys beyond core/storage KEYS. */
export const PREFS = Object.freeze({ motion: 'motion', shortcuts: 'shortcuts' });

/**
 * @typedef {object} AppState
 * @property {'demo'|'google'|'setup'|'file'} mode     'file' is no sign-in mode (a mailFilters.xml file).
 * @property {'idle'|'loading'|'ready'|'error'} status   Data status.
 * @property {string} error                               Plain English, when status is 'error'.
 * @property {'demo'|'file'|'signed-in'|'signed-out'|'expiring'|'expired'} auth
 * @property {Filter[]} filters
 * @property {Label[]} labels
 * @property {Map<string, Label>} labelsById
 * @property {ForwardingAddress[]} forwarding
 * @property {Issue[]} issues
 * @property {Set<string>} selection                      Selected filter ids.
 * @property {boolean} online
 * @property {number} journalVersion                      Bumps when the undo journal changes.
 * @property {boolean} fileDirty                          No sign-in mode: changed since the last download.
 * @property {string} fileName                            No sign-in mode: the name of the file opened.
 */

/**
 * @param {Partial<AppState>} [initial]
 */
export function createState(initial = {}) {
  /** @type {AppState} */
  let state = {
    mode: 'setup',
    status: 'idle',
    error: '',
    auth: 'signed-out',
    filters: [],
    labels: [],
    labelsById: new Map(),
    forwarding: [],
    issues: [],
    selection: new Set(),
    online: true,
    journalVersion: 0,
    fileDirty: false,
    fileName: '',
    ...initial,
  };
  /** @type {Set<(state: AppState, changed: Set<string>) => void>} */
  const listeners = new Set();

  return {
    /** @returns {AppState} */
    get() {
      return state;
    },
    /**
     * Merges a patch and tells subscribers which keys changed.
     * @param {Partial<AppState>} patch
     */
    set(patch) {
      const changed = new Set(Object.keys(patch).filter((k) => state[k] !== patch[k]));
      if (changed.size === 0) return;
      state = { ...state, ...patch };
      for (const cb of [...listeners]) cb(state, changed);
    },
    /**
     * @param {(state: AppState, changed: Set<string>) => void} cb
     * @returns {() => void}
     */
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

/** @typedef {ReturnType<typeof createState>} StateStore */
