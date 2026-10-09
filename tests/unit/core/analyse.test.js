import { describe, expect, it } from 'vitest';
import {
  analyse,
  criteriaKey,
  findConflicts,
  findDuplicates,
  findForwardingProblems,
  findMissingLabels,
  findSameCriteria,
} from '../../../site/app/js/core/analyse.js';

const f = (id, criteria, action = { addLabelIds: ['L1'] }) => ({ id, criteria, action });

describe('criteriaKey', () => {
  it('normalises case, spaces, brackets and OR order', () => {
    expect(criteriaKey({ from: 'A@X.com OR b@y.com', subject: ' Invoice ' })).toBe(
      criteriaKey({ from: '(b@y.com)  OR  a@x.com', subject: 'invoice' }),
    );
    expect(criteriaKey({ negatedQuery: 'a b' })).toBe(criteriaKey({ negatedQuery: 'b OR a' }));
    expect(criteriaKey({ hasAttachment: false })).toBe(criteriaKey({}));
    expect(criteriaKey({ size: 10, sizeComparison: 'unspecified' })).toBe(criteriaKey({}));
    expect(criteriaKey(undefined)).toBe(criteriaKey({}));
  });

  it('keeps different criteria apart', () => {
    expect(criteriaKey({ from: 'a' })).not.toBe(criteriaKey({ to: 'a' }));
    expect(criteriaKey({ size: 10, sizeComparison: 'larger' })).not.toBe(
      criteriaKey({ size: 10, sizeComparison: 'smaller' }),
    );
  });
});

describe('findDuplicates', () => {
  it('finds filters with the same criteria and action', () => {
    const issues = findDuplicates([
      f('1', { from: 'A@x.com OR b@y.com' }, { addLabelIds: ['L1', 'STARRED'] }),
      f('2', { from: 'b@y.com | a@x.com' }, { addLabelIds: ['STARRED', 'L1'] }),
      f('3', { from: 'a@x.com' }),
    ]);
    expect(issues).toEqual([
      {
        code: 'duplicate',
        severity: 'warning',
        filterIds: ['1', '2'],
        message: 'These 2 filters do the same thing.',
        fix: 'Delete all of them except one.',
      },
    ]);
    expect(findDuplicates(undefined)).toEqual([]);
  });
});

describe('findSameCriteria', () => {
  it('finds filters with the same criteria but different actions', () => {
    const issues = findSameCriteria([
      f('1', { from: 'a' }, { addLabelIds: ['L1'] }),
      f('2', { from: 'A' }, { removeLabelIds: ['INBOX'] }),
      f('3', { from: 'b' }),
      f('4', { from: 'b' }),
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: 'same-criteria',
      severity: 'info',
      filterIds: ['1', '2'],
    });
  });
});

describe('findConflicts', () => {
  it('finds delete against label or star on overlapping senders', () => {
    const issues = findConflicts([
      f('1', { from: 'shop.co.uk' }, { addLabelIds: ['TRASH'] }),
      f('2', { from: 'ann@shop.co.uk OR bob@bank.com' }, { addLabelIds: ['L1'] }),
      f('3', { from: 'news.shop.co.uk' }, { addLabelIds: ['STARRED'] }),
      f('4', { from: 'other.com' }, { addLabelIds: ['L1'] }),
    ]);
    expect(issues.map((i) => i.filterIds)).toEqual([
      ['1', '2'],
      ['1', '3'],
    ]);
    expect(issues[0].code).toBe('conflict-delete');
  });

  it('finds important against not important on the same criteria', () => {
    const issues = findConflicts([
      f('1', { subject: 'x' }, { addLabelIds: ['IMPORTANT'] }),
      f('2', { subject: 'X' }, { removeLabelIds: ['IMPORTANT'] }),
      f('3', { subject: 'X' }, { removeLabelIds: ['IMPORTANT'] }),
    ]);
    expect(issues.map((i) => [i.code, i.filterIds])).toEqual([
      ['conflict-important', ['1', '2']],
      ['conflict-important', ['1', '3']],
    ]);
  });

  it('ignores filters that do not overlap, or that both delete', () => {
    expect(
      findConflicts([
        f('1', { from: 'a.com' }, { addLabelIds: ['TRASH'] }),
        f('2', { from: 'b.com' }, { addLabelIds: ['L1'] }),
        f('3', { from: 'a.com' }, { addLabelIds: ['TRASH', 'L1'] }),
        f('4', { query: 'x' }, { addLabelIds: ['L1'] }),
      ]),
    ).toEqual([]);
    expect(findConflicts(undefined)).toEqual([]);
  });
});

describe('findMissingLabels', () => {
  const labels = [{ id: 'L1', name: 'Receipts', type: 'user' }];
  it('finds label IDs that do not exist', () => {
    const issues = findMissingLabels(
      [
        f('1', { from: 'a' }, { addLabelIds: ['L1', 'INBOX', 'CATEGORY_SOCIAL', 'new:Bills'] }),
        f('2', { from: 'a' }, { addLabelIds: ['Label_gone'] }),
        f('3', { from: 'a' }, { addLabelIds: ['Label_a'], removeLabelIds: ['Label_b'] }),
        { criteria: {}, action: {} },
      ],
      labels,
    );
    expect(issues.map((i) => [i.filterIds, i.message])).toEqual([
      [['2'], 'This filter uses a label that does not exist any more.'],
      [['3'], 'This filter uses 2 labels that do not exist any more.'],
    ]);
    expect(issues[0].severity).toBe('error');
    expect(findMissingLabels(undefined, undefined)).toEqual([]);
  });
});

describe('findForwardingProblems', () => {
  it('finds forwards to addresses that are not accepted', () => {
    const issues = findForwardingProblems(
      [
        f('1', { from: 'a' }, { forward: 'OK@x.com' }),
        f('2', { from: 'a' }, { forward: 'wait@x.com' }),
        f('3', { from: 'a' }, { forward: 'unknown@x.com' }),
        f('4', { from: 'a' }, {}),
      ],
      [
        { forwardingEmail: 'ok@x.com', verificationStatus: 'accepted' },
        { forwardingEmail: 'wait@x.com', verificationStatus: 'pending' },
      ],
    );
    expect(issues.map((i) => [i.filterIds[0], i.message])).toEqual([
      ['2', 'This filter forwards to wait@x.com, but that address is not verified yet.'],
      [
        '3',
        'This filter forwards to unknown@x.com, but that address is not in your forwarding list.',
      ],
    ]);
    expect(findForwardingProblems(undefined, undefined)).toEqual([]);
  });
});

describe('analyse', () => {
  it('runs every check and sorts by severity', () => {
    const issues = analyse({
      filters: [
        f('1', { from: 'a' }, { forward: 'x@y.com' }),
        f('2', { from: 'a' }, { forward: 'x@y.com' }),
        f('3', {}, { addLabelIds: ['Label_gone'] }),
      ],
      labels: [],
      forwardingAddresses: [],
    });
    const severities = issues.map((i) => i.severity);
    expect(severities).toEqual([...severities].sort((a, b) => order(a) - order(b)));
    const codes = issues.map((i) => i.code);
    for (const c of [
      'duplicate',
      'missing-label',
      'forward-not-verified',
      'empty-criteria',
      'forwards',
    ]) {
      expect(codes).toContain(c);
    }
    expect(analyse({ filters: [] })).toEqual([]);
  });
});

function order(s) {
  return { error: 0, warning: 1, info: 2 }[s];
}
