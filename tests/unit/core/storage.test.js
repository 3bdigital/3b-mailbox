import { afterEach, describe, expect, it, vi } from 'vitest';
import { KEYS, createStore, memoryStorage } from '../../../site/app/js/core/storage.js';

const thrower = () => {
  throw new Error('SecurityError');
};

describe('memoryStorage', () => {
  it('behaves like Web Storage', () => {
    const m = memoryStorage();
    m.setItem('a', 1);
    expect(m.getItem('a')).toBe('1');
    expect(m.getItem('b')).toBeNull();
    expect(m.length).toBe(1);
    expect(m.key(0)).toBe('a');
    expect(m.key(5)).toBeNull();
    m.removeItem('a');
    expect(m.length).toBe(0);
  });
});

describe('createStore', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('saves JSON values under a prefix', () => {
    const backend = memoryStorage();
    const s = createStore(backend);
    expect(s.persistent).toBe(true);
    expect(s.set('theme', { mode: 'dark' })).toBe(true);
    expect(backend.getItem('3bm:theme')).toBe('{"mode":"dark"}');
    expect(s.get('theme')).toEqual({ mode: 'dark' });
    expect(s.get('missing', 'x')).toBe('x');
    s.remove('theme');
    expect(s.get('theme', null)).toBeNull();
  });

  it('returns the fallback for values that are not JSON', () => {
    const backend = memoryStorage();
    backend.setItem('3bm:bad', '{nope');
    expect(createStore(backend).get('bad', 7)).toBe(7);
  });

  it('clears only its own keys', () => {
    const backend = memoryStorage();
    backend.setItem('other', 'keep');
    const s = createStore(backend, 'p:');
    s.set('a', 1);
    s.set('b', 2);
    s.clearAll();
    expect(backend.getItem('other')).toBe('keep');
    expect(backend.length).toBe(1);
  });

  it('falls back to memory when there is no backend', () => {
    const s = createStore(null);
    expect(s.persistent).toBe(false);
    s.set('x', 1);
    expect(s.get('x')).toBe(1);
  });

  it('falls back to memory when the backend throws on every call', () => {
    const backend = {
      getItem: thrower,
      setItem: thrower,
      removeItem: thrower,
      key: thrower,
      length: 0,
    };
    const s = createStore(backend);
    expect(s.persistent).toBe(false);
    expect(s.set('x', 1)).toBe(true);
    expect(s.get('x')).toBe(1);
  });

  it('never throws when a working backend starts to fail', () => {
    let broken = false;
    const real = memoryStorage();
    const backend = {
      getItem: (k) => (broken ? thrower() : real.getItem(k)),
      setItem: (k, v) => (broken ? thrower() : real.setItem(k, v)),
      removeItem: (k) => (broken ? thrower() : real.removeItem(k)),
      key: (i) => (broken ? thrower() : real.key(i)),
      get length() {
        return real.length;
      },
    };
    const s = createStore(backend);
    s.set('a', 1);
    broken = true;
    expect(s.get('a', 'fallback')).toBe('fallback');
    expect(s.set('a', 2)).toBe(false);
    expect(() => s.remove('a')).not.toThrow();
    expect(() => s.clearAll()).not.toThrow();
  });

  it('cannot save values that are not JSON', () => {
    const s = createStore(memoryStorage());
    const loop = {};
    loop.self = loop;
    expect(s.set('loop', loop)).toBe(false);
  });

  it('uses globalThis.localStorage by default, and copes when access throws', () => {
    vi.stubGlobal('localStorage', memoryStorage());
    const s = createStore();
    expect(s.persistent).toBe(true);
    s.set('k', 1);
    expect(globalThis.localStorage.getItem('3bm:k')).toBe('1');
    vi.unstubAllGlobals();

    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: thrower });
    try {
      const t = createStore();
      expect(t.persistent).toBe(false);
      t.set('k', 2);
      expect(t.get('k')).toBe(2);
    } finally {
      delete globalThis.localStorage;
    }
  });

  it('lists the keys in use', () => {
    expect(Object.values(KEYS)).toEqual([
      'clientId',
      'theme',
      'density',
      'journal',
      'dismissed',
      'tierWanted',
    ]);
  });
});
