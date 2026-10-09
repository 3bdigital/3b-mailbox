import { describe, expect, it } from 'vitest';
import {
  describeAction,
  describeCriteria,
  describeFilter,
  formatSize,
  groupFilters,
  joinList,
  senderDomains,
} from '../../../site/app/js/core/summarise.js';

const labels = new Map([
  ['L1', { id: 'L1', name: 'Receipts', type: 'user' }],
  ['L2', { id: 'L2', name: 'Travel', type: 'user' }],
]);

describe('joinList', () => {
  it('joins in UK style with no Oxford comma', () => {
    expect(joinList([])).toBe('');
    expect(joinList(['a'])).toBe('a');
    expect(joinList(['a', 'b'])).toBe('a or b');
    expect(joinList(['a', 'b', 'c'], 'and')).toBe('a, b and c');
    expect(joinList(['a', 'b', 'c', 'd'], 'or', 2)).toBe('a, b or 2 more');
  });
});

describe('formatSize', () => {
  it('uses MB, KB or bytes', () => {
    expect(formatSize(5 * 1024 * 1024)).toBe('5 MB');
    expect(formatSize(1536)).toBe('1.5 KB');
    expect(formatSize(12)).toBe('12 bytes');
  });
});

describe('describeCriteria', () => {
  it('describes senders and subject', () => {
    expect(describeCriteria({ from: 'amazon.co.uk OR ebay.co.uk', subject: 'invoice' })).toBe(
      'From amazon.co.uk or ebay.co.uk, with "invoice" in the subject',
    );
  });

  it('describes every field', () => {
    expect(
      describeCriteria({
        from: '{a@x.com b@y.com}',
        to: 'me@home.uk',
        subject: 'invoice receipt',
        query: 'vat OR "tax return"',
        negatedQuery: 'spam scam',
        hasAttachment: true,
        size: 2 * 1024 * 1024,
        sizeComparison: 'larger',
        excludeChats: true,
      }),
    ).toBe(
      'From a@x.com or b@y.com, sent to me@home.uk, with "invoice" and "receipt" in the subject, ' +
        'containing "vat" or "tax return", not containing "spam" or "scam", with an attachment, ' +
        'larger than 2 MB, not including chats',
    );
  });

  it('starts with "Mail" when there is no sender', () => {
    expect(describeCriteria({ subject: 'invoice' })).toBe('Mail with "invoice" in the subject');
    expect(describeCriteria({ size: 1024, sizeComparison: 'smaller' })).toBe(
      'Mail smaller than 1 KB',
    );
    expect(describeCriteria({ to: 'a@b.com' })).toBe('Sent to a@b.com');
    expect(describeCriteria({})).toBe('All mail');
    expect(describeCriteria(undefined)).toBe('All mail');
  });

  it('shows complex searches as they are', () => {
    expect(
      describeCriteria({ query: 'from:a -b', subject: '-x', negatedQuery: 'a AROUND 2 b' }),
    ).toBe(
      'Mail with a subject that matches -x, matching the search from:a -b, not matching the search a AROUND 2 b',
    );
    expect(describeCriteria({ from: 'list:x OR y' })).toBe('From list:x OR y');
  });

  it('quotes sender phrases and limits long lists', () => {
    expect(describeCriteria({ from: '"John Smith"' })).toBe('From "John Smith"');
    expect(describeCriteria({ from: 'a OR b OR c OR d' }, { maxItems: 2 })).toBe(
      'From a, b or 2 more',
    );
  });

  it('never uses em dashes or curly quotes', () => {
    const text = describeCriteria({ from: 'a', subject: 'b', query: 'c', negatedQuery: 'd' });
    expect(text).not.toMatch(/[—–‘’“”]/);
  });
});

describe('describeAction', () => {
  it('describes a common action', () => {
    expect(
      describeAction({ removeLabelIds: ['INBOX', 'UNREAD'], addLabelIds: ['L1'] }, labels),
    ).toBe('Skip the inbox, mark as read, apply label Receipts');
  });

  it('describes every action', () => {
    expect(
      describeAction(
        {
          addLabelIds: ['STARRED', 'L1', 'L2', 'CATEGORY_UPDATES', 'IMPORTANT', 'TRASH', 'SENT'],
          removeLabelIds: ['SPAM', 'Label_x'],
          forward: 'a@b.com',
        },
        labels,
      ),
    ).toBe(
      'Star it, apply labels Receipts and Travel, categorise as Updates, always mark as important, ' +
        'never send to spam, forward to a@b.com, delete it, add SENT, remove Label_x',
    );
    expect(describeAction({ removeLabelIds: ['IMPORTANT'] }, labels)).toBe(
      'Never mark as important',
    );
  });

  it('names new and missing labels', () => {
    expect(describeAction({ addLabelIds: ['new:Bills'] }, labels)).toBe('Apply label Bills');
    expect(describeAction({ addLabelIds: ['Label_gone'] }, labels)).toBe(
      'Apply label a missing label',
    );
    expect(describeAction({}, labels)).toBe('Do nothing');
    expect(describeAction({ addLabelIds: ['Label_gone'] }, undefined)).toBe(
      'Apply label a missing label',
    );
  });
});

describe('describeFilter', () => {
  it('gives when, then and full text', () => {
    expect(
      describeFilter(
        { criteria: { from: 'amazon.co.uk' }, action: { removeLabelIds: ['INBOX'] } },
        labels,
      ),
    ).toEqual({
      when: 'From amazon.co.uk',
      then: 'Skip the inbox',
      text: 'From amazon.co.uk. Skip the inbox.',
    });
  });
});

describe('senderDomains', () => {
  it('finds domains in from and in from: terms', () => {
    expect(
      senderDomains({
        criteria: {
          from: 'Ann@Shop.co.uk OR @bank.com OR *.club.org OR bob',
          query: 'from:(x@news.org OR "y@news.org") from:z.net subject:a.com',
        },
        action: {},
      }),
    ).toEqual(['shop.co.uk', 'bank.com', 'club.org', 'news.org', 'z.net']);
    expect(senderDomains({ criteria: {}, action: {} })).toEqual([]);
    expect(senderDomains(undefined)).toEqual([]);
  });
});

describe('groupFilters', () => {
  const fs = [
    { id: '1', criteria: { from: 'a@shop.co.uk' }, action: { addLabelIds: ['L1'] } },
    { id: '2', criteria: { from: 'b@shop.co.uk' }, action: { addLabelIds: ['L1'] } },
    {
      id: '3',
      criteria: { from: 'c@bank.com' },
      action: { addLabelIds: ['L1', 'L2'], forward: 'x@y.com' },
    },
    { id: '4', criteria: { subject: 'hi' }, action: { addLabelIds: ['TRASH'] } },
  ];
  const ids = (groups) => groups.map((g) => [g.title, g.filters.map((f) => f.id)]);

  it('groups by action', () => {
    expect(ids(groupFilters(fs, 'action', labels))).toEqual([
      ['Apply label Receipts', ['1', '2']],
      ['Apply labels Receipts and Travel, forward to x@y.com', ['3']],
      ['Delete it', ['4']],
    ]);
  });

  it('groups by label', () => {
    expect(ids(groupFilters(fs, 'label', labels))).toEqual([
      ['Receipts', ['1', '2', '3']],
      ['Travel', ['3']],
      ['No label', ['4']],
    ]);
  });

  it('groups by domain', () => {
    expect(ids(groupFilters(fs, 'domain', labels))).toEqual([
      ['shop.co.uk', ['1', '2']],
      ['bank.com', ['3']],
      ['No sender domain', ['4']],
    ]);
  });

  it('groups by risk', () => {
    expect(ids(groupFilters(fs, 'risk', labels))).toEqual([
      ['Other filters', ['1', '2']],
      ['Risky filters', ['3', '4']],
    ]);
    expect(groupFilters(undefined, 'risk', labels)).toEqual([]);
  });
});
