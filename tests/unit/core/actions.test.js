import { describe, expect, it } from 'vitest';
import {
  CATEGORIES,
  SYSTEM_LABELS,
  actionKey,
  emptyFriendly,
  isEmptyAction,
  isRisky,
  isSystemLabelId,
  toApi,
  toFriendly,
} from '../../../site/app/js/core/actions.js';

describe('SYSTEM_LABELS', () => {
  it('has the system label IDs', () => {
    expect(SYSTEM_LABELS.INBOX).toBe('INBOX');
    expect(SYSTEM_LABELS.CATEGORY_FORUMS).toBe('CATEGORY_FORUMS');
    expect(Object.isFrozen(SYSTEM_LABELS)).toBe(true);
    for (const c of CATEGORIES) expect(SYSTEM_LABELS[c]).toBe(c);
  });

  it('tells system IDs from user IDs', () => {
    expect(isSystemLabelId('INBOX')).toBe(true);
    expect(isSystemLabelId('SENT')).toBe(true);
    expect(isSystemLabelId('CATEGORY_RESERVATIONS')).toBe(true);
    expect(isSystemLabelId('Label_12')).toBe(false);
    expect(isSystemLabelId('new:Receipts')).toBe(false);
  });
});

describe('toFriendly', () => {
  it('maps every Gmail action', () => {
    expect(
      toFriendly({
        addLabelIds: [
          'STARRED',
          'TRASH',
          'IMPORTANT',
          'CATEGORY_PROMOTIONS',
          'Label_1',
          'Label_1',
          'SENT',
        ],
        removeLabelIds: ['INBOX', 'UNREAD', 'SPAM', 'Label_9'],
        forward: ' x@y.com ',
      }),
    ).toEqual({
      archive: true,
      markRead: true,
      star: true,
      trash: true,
      neverSpam: true,
      important: 'always',
      category: 'CATEGORY_PROMOTIONS',
      labelIds: ['Label_1'],
      forward: 'x@y.com',
      otherAdd: ['SENT'],
      otherRemove: ['Label_9'],
    });
  });

  it('maps never important, and keeps a second category as other', () => {
    const f = toFriendly({
      addLabelIds: ['CATEGORY_SOCIAL', 'CATEGORY_UPDATES'],
      removeLabelIds: ['IMPORTANT'],
    });
    expect(f.important).toBe('never');
    expect(f.category).toBe('CATEGORY_SOCIAL');
    expect(f.otherAdd).toEqual(['CATEGORY_UPDATES']);
  });

  it('copes with missing or broken input', () => {
    expect(toFriendly(undefined)).toEqual(emptyFriendly());
    expect(toFriendly({ addLabelIds: 'x', forward: '  ' })).toEqual(emptyFriendly());
  });
});

describe('toApi', () => {
  it('leaves out empty arrays and a null forward', () => {
    expect(toApi(emptyFriendly())).toEqual({});
    expect(toApi({ ...emptyFriendly(), archive: true })).toEqual({ removeLabelIds: ['INBOX'] });
  });

  it('round-trips with toFriendly', () => {
    const actions = [
      { addLabelIds: ['Label_1', 'STARRED'], removeLabelIds: ['INBOX', 'UNREAD'] },
      { addLabelIds: ['TRASH'] },
      { removeLabelIds: ['SPAM', 'IMPORTANT'], forward: 'a@b.com' },
      { addLabelIds: ['IMPORTANT', 'CATEGORY_FORUMS', 'SENT'], removeLabelIds: ['Label_x'] },
    ];
    for (const a of actions) {
      expect(actionKey(toApi(toFriendly(a)))).toBe(actionKey(a));
    }
  });

  it('accepts a partial friendly action', () => {
    expect(toApi({ labelIds: ['Label_2', 'Label_2'], important: 'never' })).toEqual({
      addLabelIds: ['Label_2'],
      removeLabelIds: ['IMPORTANT'],
    });
  });
});

describe('actionKey', () => {
  it('does not depend on order, repeats or forward case', () => {
    expect(actionKey({ addLabelIds: ['b', 'a', 'a'], forward: 'X@Y.com' })).toBe(
      actionKey({ addLabelIds: ['a', 'b'], forward: 'x@y.com ' }),
    );
    expect(actionKey({})).toBe(actionKey({ addLabelIds: [], removeLabelIds: [] }));
    expect(actionKey(undefined)).toBe(actionKey({}));
  });

  it('tells add from remove', () => {
    expect(actionKey({ addLabelIds: ['IMPORTANT'] })).not.toBe(
      actionKey({ removeLabelIds: ['IMPORTANT'] }),
    );
  });
});

describe('isEmptyAction', () => {
  it('finds actions that do nothing', () => {
    expect(isEmptyAction({})).toBe(true);
    expect(isEmptyAction({ addLabelIds: [], forward: ' ' })).toBe(true);
    expect(isEmptyAction({ forward: 'a@b.com' })).toBe(false);
    expect(isEmptyAction({ removeLabelIds: ['INBOX'] })).toBe(false);
  });
});

describe('isRisky', () => {
  it('finds trash, forward, archive with mark read, and never spam', () => {
    expect(isRisky({ addLabelIds: ['TRASH'] })).toEqual({
      risky: true,
      reasons: ['It deletes mail.'],
    });
    expect(isRisky({ forward: 'a@b.com' }).reasons).toEqual(['It forwards mail to a@b.com.']);
    expect(isRisky({ removeLabelIds: ['INBOX', 'UNREAD'] }).risky).toBe(true);
    expect(isRisky({ removeLabelIds: ['SPAM'] }).risky).toBe(true);
  });

  it('accepts ordinary actions', () => {
    expect(isRisky({ removeLabelIds: ['INBOX'], addLabelIds: ['Label_1'] })).toEqual({
      risky: false,
      reasons: [],
    });
  });
});
