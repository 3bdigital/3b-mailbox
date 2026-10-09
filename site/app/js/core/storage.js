// @ts-check
// A small wrapper over localStorage. Every call is safe: with no storage, or storage that throws,
// values live in memory for this page only.

/**
 * The keys the app uses.
 */
export const KEYS = Object.freeze({
  clientId: 'clientId',
  theme: 'theme',
  density: 'density',
  journal: 'journal',
  dismissed: 'dismissed',
  tierWanted: 'tierWanted',
});

/**
 * The part of the Web Storage API that we use.
 * @typedef {Pick<Storage, 'getItem'|'setItem'|'removeItem'|'key'|'length'>} StorageLike
 */

/**
 * @typedef {object} Store
 * @property {<T>(key: string, fallback?: T) => T} get   Returns fallback when the key is missing or unreadable.
 * @property {(key: string, value: unknown) => boolean} set  Returns false when the value could not be saved.
 * @property {(key: string) => void} remove
 * @property {() => void} clearAll   Removes every key with our prefix, and nothing else.
 * @property {boolean} persistent    False when values live in memory only.
 */

/**
 * An in-memory StorageLike.
 * @returns {StorageLike}
 */
export function memoryStorage() {
  /** @type {Map<string, string>} */
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? /** @type {string} */ (map.get(k)) : null),
    setItem: (k, v) => {
      map.set(k, String(v));
    },
    removeItem: (k) => {
      map.delete(k);
    },
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

/**
 * Finds a working backend, or null.
 * @param {StorageLike|null|undefined} backend
 * @param {string} prefix
 * @returns {StorageLike|null}
 */
function probe(backend, prefix) {
  try {
    if (!backend) return null;
    const k = `${prefix}__probe__`;
    backend.setItem(k, '1');
    backend.removeItem(k);
    return backend;
  } catch {
    return null;
  }
}

/** @returns {StorageLike|null} */
function defaultBackend() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Some browsers throw on any access to localStorage when site data is blocked.
    return null;
  }
}

/**
 * Creates a key-value store over a Storage backend. Values are saved as JSON.
 * @param {StorageLike|null} [backend]  Defaults to globalThis.localStorage.
 * @param {string} [prefix]
 * @returns {Store}
 */
export function createStore(backend, prefix = 'ef:') {
  const real = probe(backend === undefined ? defaultBackend() : backend, prefix);
  const store = real ?? memoryStorage();
  return {
    persistent: real !== null,
    get(key, fallback) {
      try {
        const raw = store.getItem(prefix + key);
        if (raw === null || raw === undefined) return fallback;
        return JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        store.setItem(prefix + key, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    },
    remove(key) {
      try {
        store.removeItem(prefix + key);
      } catch {
        // Nothing to do: the value is gone or was never there.
      }
    },
    clearAll() {
      try {
        /** @type {string[]} */
        const keys = [];
        for (let i = 0; i < store.length; i++) {
          const k = store.key(i);
          if (k !== null && k.startsWith(prefix)) keys.push(k);
        }
        for (const k of keys) store.removeItem(k);
      } catch {
        // Storage is not usable. There is nothing we can clear.
      }
    },
  };
}
