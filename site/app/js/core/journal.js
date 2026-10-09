// @ts-check
// The undo journal: a copy of every filter we delete or replace, so the user can restore it.
// gmail/executor.js calls record() once per delete or replace step. All entries from one plan run
// share the same `batch` string.

import { KEYS } from './storage.js';

/** @typedef {import('../types.js').Filter} Filter */
/** @typedef {import('./storage.js').Store} Store */

/**
 * @typedef {object} JournalEntry
 * @property {string} batch          The same for every entry from one plan run.
 * @property {string} title          The plan title.
 * @property {string} time           ISO 8601.
 * @property {'delete'|'replace'} op
 * @property {string} filterId       The ID of the filter that was deleted or replaced.
 * @property {Filter} previous       The filter as it was before the change.
 * @property {Filter} [replacement]  For 'replace': the new filter.
 */

/**
 * @typedef {object} Journal
 * @property {(entry: JournalEntry) => JournalEntry|null} record  Stores the entry. Returns null if it is not valid.
 * @property {() => JournalEntry[]} list         Newest first.
 * @property {() => void} clear
 * @property {() => JournalEntry[]} lastBatch    Every entry of the most recent batch, in the order recorded.
 */

/**
 * @param {unknown} e
 * @returns {e is JournalEntry}
 */
function isEntry(e) {
  if (typeof e !== 'object' || e === null) return false;
  const x = /** @type {Record<string, unknown>} */ (e);
  return (
    typeof x.batch === 'string' &&
    typeof x.title === 'string' &&
    typeof x.time === 'string' &&
    (x.op === 'delete' || x.op === 'replace') &&
    typeof x.filterId === 'string' &&
    typeof x.previous === 'object' &&
    x.previous !== null
  );
}

/**
 * Creates the undo journal over a store. It keeps the newest `max` entries and drops the oldest.
 * It never throws: if the store fails, the journal works with what it can read.
 * @param {Store} store
 * @param {number} [max]
 * @param {{now?: () => Date}} [opts]  now: used when an entry has no time.
 * @returns {Journal}
 */
export function createJournal(store, max = 200, opts = {}) {
  const now = opts.now ?? (() => new Date());

  /** @returns {JournalEntry[]} Oldest first, as stored. */
  function read() {
    try {
      const raw = store?.get(KEYS.journal, []);
      return Array.isArray(raw) ? raw.filter(isEntry) : [];
    } catch {
      return [];
    }
  }

  /** @param {JournalEntry[]} entries */
  function write(entries) {
    try {
      store?.set(KEYS.journal, entries);
    } catch {
      // The journal is a safety net. If we cannot save it, the change still goes ahead.
    }
  }

  return {
    record(entry) {
      /** @type {JournalEntry} */
      let stored;
      try {
        stored = structuredClone({ ...entry, time: entry?.time ?? now().toISOString() });
      } catch {
        return null;
      }
      if (!isEntry(stored)) return null;
      const entries = [...read(), stored];
      write(entries.slice(Math.max(0, entries.length - max)));
      return stored;
    },
    list() {
      return read().reverse();
    },
    clear() {
      try {
        store?.remove(KEYS.journal);
      } catch {
        write([]);
      }
    },
    lastBatch() {
      const entries = read();
      const last = entries[entries.length - 1];
      if (!last) return [];
      return entries.filter((e) => e.batch === last.batch);
    },
  };
}
