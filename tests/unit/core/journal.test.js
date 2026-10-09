import { describe, expect, it } from 'vitest';
import { createJournal } from '../../../site/app/js/core/journal.js';
import { createStore, memoryStorage } from '../../../site/app/js/core/storage.js';

const filter = (id) => ({ id, criteria: { from: `${id}@x.com` }, action: { addLabelIds: ['L1'] } });
const entry = (batch, id, extra = {}) => ({
  batch,
  title: `Plan ${batch}`,
  time: '2026-10-09T10:00:00.000Z',
  op: 'delete',
  filterId: id,
  previous: filter(id),
  ...extra,
});

describe('createJournal', () => {
  it('stores entries as given, lists newest first, and returns the last batch in order', () => {
    const j = createJournal(createStore(memoryStorage()));
    j.record(entry('b1', 'a'));
    j.record(entry('b2', 'b'));
    const replacement = filter('c2');
    j.record(entry('b2', 'c', { op: 'replace', replacement }));
    expect(j.list().map((e) => e.filterId)).toEqual(['c', 'b', 'a']);
    expect(j.lastBatch().map((e) => e.filterId)).toEqual(['b', 'c']);
    expect(j.lastBatch()[1]).toEqual(entry('b2', 'c', { op: 'replace', replacement }));
  });

  it('copies the entry so later changes do not leak in', () => {
    const j = createJournal(createStore(memoryStorage()));
    const e = entry('b', 'a');
    j.record(e);
    e.previous.criteria.from = 'changed';
    expect(j.list()[0].previous.criteria.from).toBe('a@x.com');
  });

  it('fills in a missing time', () => {
    const j = createJournal(createStore(memoryStorage()), 200, {
      now: () => new Date('2026-01-02T03:04:05Z'),
    });
    const stored = j.record({ ...entry('b', 'a'), time: undefined });
    expect(stored.time).toBe('2026-01-02T03:04:05.000Z');
    const plain = createJournal(createStore(memoryStorage()));
    expect(typeof plain.record({ ...entry('b', 'a'), time: undefined }).time).toBe('string');
  });

  it('refuses entries that are not valid', () => {
    const j = createJournal(createStore(memoryStorage()));
    expect(j.record({ batch: 'b' })).toBeNull();
    expect(j.record(entry('b', 'a', { op: 'create' }))).toBeNull();
    expect(j.record(entry('b', 'a', { previous: () => {} }))).toBeNull();
    expect(j.list()).toEqual([]);
  });

  it('keeps only the newest entries', () => {
    const j = createJournal(createStore(memoryStorage()), 3);
    for (const id of ['1', '2', '3', '4', '5']) j.record(entry('b', id));
    expect(j.list().map((e) => e.filterId)).toEqual(['5', '4', '3']);
  });

  it('clears', () => {
    const j = createJournal(createStore(memoryStorage()));
    j.record(entry('b', 'a'));
    j.clear();
    expect(j.list()).toEqual([]);
    expect(j.lastBatch()).toEqual([]);
  });

  it('ignores bad stored data', () => {
    const store = createStore(memoryStorage());
    store.set('journal', { not: 'a list' });
    expect(createJournal(store).list()).toEqual([]);
    store.set('journal', [entry('b', 'a'), { junk: true }, null]);
    expect(createJournal(store).list()).toHaveLength(1);
  });

  it('never throws when the store throws', () => {
    const boom = () => {
      throw new Error('broken');
    };
    const bad = { get: boom, set: boom, remove: boom, clearAll: boom, persistent: false };
    const j = createJournal(bad);
    expect(j.record(entry('b', 'a'))).toMatchObject({ filterId: 'a' });
    expect(j.list()).toEqual([]);
    expect(j.lastBatch()).toEqual([]);
    expect(() => j.clear()).not.toThrow();
    const none = createJournal(undefined);
    expect(none.list()).toEqual([]);
    expect(() => none.record(entry('b', 'a'))).not.toThrow();
    expect(() => none.clear()).not.toThrow();
  });

  it('works over a store whose backend throws', () => {
    const throwing = {
      getItem() {
        throw new Error('x');
      },
      setItem() {
        throw new Error('x');
      },
      removeItem() {
        throw new Error('x');
      },
      key() {
        throw new Error('x');
      },
      length: 0,
    };
    const j = createJournal(createStore(throwing));
    j.record(entry('b', 'a'));
    expect(j.list()).toHaveLength(1);
  });
});
