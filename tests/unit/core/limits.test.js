import { describe, expect, it } from 'vitest';
import {
  LIMITS,
  accountUsage,
  canAdd,
  checkFilter,
  criteriaLength,
  criteriaToSearch,
  isEmptyCriteria,
  sizeToSearch,
} from '../../../site/app/js/core/limits.js';
import { parse, serialize } from '../../../site/app/js/core/query.js';

const filters = (n) =>
  Array.from({ length: n }, (_, i) => ({ id: `f${i}`, criteria: { from: 'a' }, action: {} }));

describe('LIMITS', () => {
  it('has exactly the documented values', () => {
    expect(LIMITS).toEqual({
      maxFilters: 1000,
      criteriaCharsSafe: 1400,
      criteriaCharsHard: 1469,
      maxLabels: 10000,
      warnRatio: 0.8,
      dangerRatio: 0.95,
    });
    expect(Object.isFrozen(LIMITS)).toBe(true);
  });
});

describe('criteriaToSearch', () => {
  it('builds one Gmail search string from every field', () => {
    const q = criteriaToSearch({
      from: 'a@x.com OR b@y.com',
      to: 'me@home.uk',
      subject: 'invoice',
      query: 'vat OR receipt',
      negatedQuery: 'spam scam',
      hasAttachment: true,
      excludeChats: true,
      size: 5 * 1024 * 1024,
      sizeComparison: 'larger',
    });
    expect(q).toBe(
      'from:(a@x.com OR b@y.com) to:(me@home.uk) subject:(invoice) vat OR receipt -{spam scam} has:attachment -in:chats larger:5M',
    );
    // It is valid Gmail syntax: it parses and serialises back to the same text.
    expect(serialize(parse(q))).toBe(q);
  });

  it('uses bytes when the size is not a whole number of megabytes', () => {
    expect(criteriaToSearch({ size: 1500, sizeComparison: 'smaller' })).toBe('smaller:1500');
    expect(criteriaToSearch({ size: 1500, sizeComparison: 'unspecified' })).toBe('');
    expect(criteriaToSearch({ size: 0, sizeComparison: 'larger' })).toBe('');
    expect(sizeToSearch(-4)).toBe('0');
  });

  it('copes with empty criteria', () => {
    expect(criteriaToSearch({})).toBe('');
    expect(criteriaToSearch(undefined)).toBe('');
    expect(criteriaLength({ from: '  a  ' })).toBe('from:(a)'.length);
  });
});

describe('isEmptyCriteria', () => {
  it('finds criteria with no search terms', () => {
    expect(isEmptyCriteria({})).toBe(true);
    expect(isEmptyCriteria(undefined)).toBe(true);
    expect(isEmptyCriteria({ from: '  ', excludeChats: true })).toBe(true);
    expect(isEmptyCriteria({ hasAttachment: true })).toBe(false);
    expect(isEmptyCriteria({ size: 10, sizeComparison: 'larger' })).toBe(false);
    expect(isEmptyCriteria({ negatedQuery: 'x' })).toBe(false);
  });
});

describe('checkFilter', () => {
  it('passes a normal filter', () => {
    expect(
      checkFilter({ id: 'a', criteria: { from: 'x@y.com' }, action: { addLabelIds: ['L'] } }),
    ).toEqual([]);
  });

  it('finds a filter that is too long, or close to the limit', () => {
    const long = { id: 'a', criteria: { query: 'x'.repeat(1500) }, action: {} };
    expect(checkFilter(long).map((i) => [i.code, i.severity])).toEqual([['too-long', 'error']]);
    const near = { criteria: { query: 'x'.repeat(1450) }, action: {} };
    const issues = checkFilter(near);
    expect(issues.map((i) => [i.code, i.severity])).toEqual([['near-limit', 'warning']]);
    expect(issues[0].filterIds).toEqual([]);
  });

  it('finds empty criteria', () => {
    expect(checkFilter({ id: 'a', criteria: {}, action: {} })[0]).toMatchObject({
      code: 'empty-criteria',
      severity: 'error',
      filterIds: ['a'],
    });
    expect(checkFilter(undefined)[0].code).toBe('empty-criteria');
  });

  it('warns about operators that never match new mail', () => {
    const issues = checkFilter({
      id: 'a',
      criteria: { query: 'label:x is:unread', negatedQuery: 'has:userlabels label:y' },
      action: {},
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'unsafe-operator', severity: 'warning' });
    expect(issues[0].message).toBe(
      'This filter uses "label:", "is:", "has:userlabels". These never match new mail in a filter.',
    );
  });

  it('notes a forward', () => {
    expect(
      checkFilter({ id: 'a', criteria: { from: 'x' }, action: { forward: 'a@b.com' } }),
    ).toEqual([
      {
        code: 'forwards',
        severity: 'info',
        filterIds: ['a'],
        message: 'This filter forwards mail to a@b.com.',
      },
    ]);
  });
});

describe('accountUsage', () => {
  it('gives the right level for each ratio', () => {
    expect(accountUsage(filters(10), []).filters).toEqual({
      used: 10,
      max: 1000,
      ratio: 0.01,
      level: 'ok',
    });
    expect(accountUsage(filters(800), []).filters.level).toBe('warn');
    expect(accountUsage(filters(950), []).filters.level).toBe('danger');
    expect(accountUsage(filters(1000), []).filters.level).toBe('full');
  });

  it('counts only user labels', () => {
    const labels = [
      { id: 'INBOX', name: 'INBOX', type: 'system' },
      { id: 'L1', name: 'Receipts', type: 'user' },
    ];
    expect(accountUsage([], labels).labels).toEqual({
      used: 1,
      max: 10000,
      ratio: 0.0001,
      level: 'ok',
    });
    expect(accountUsage(undefined, undefined).filters.used).toBe(0);
  });
});

describe('canAdd', () => {
  it('checks room for more filters', () => {
    expect(canAdd(filters(999))).toBe(true);
    expect(canAdd(filters(1000))).toBe(false);
    expect(canAdd(filters(998), 3)).toBe(false);
    expect(canAdd(undefined, 1000)).toBe(true);
  });
});
