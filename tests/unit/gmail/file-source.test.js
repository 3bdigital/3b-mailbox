import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fromGmailXml, toGmailXml } from '../../../site/app/js/core/backup.js';
import { runPlan } from '../../../site/app/js/gmail/executor.js';
import {
  NEEDS_SIGN_IN,
  contentKey,
  createFileAuth,
  createFileGmail,
  seedFromFile,
} from '../../../site/app/js/gmail/file-source.js';
import { planReplaceLabel } from '../../../site/app/js/core/bulk.js';

const fixture = readFileSync(
  new URL('../../fixtures/core/mailFilters.xml', import.meta.url),
  'utf8',
);

describe('seedFromFile', () => {
  it('makes user labels from names and swaps the placeholders', () => {
    const seed = seedFromFile(fromGmailXml(fixture));
    expect(seed.labels.map((l) => [l.id, l.name, l.type])).toEqual([
      ['Label_1', 'Shopping/Receipts', 'user'],
      ['Label_2', 'Money & Bills', 'user'],
      ['Label_3', 'Money & Bills/Statements', 'user'],
      ['Label_4', 'Documents', 'user'],
      ['Label_5', 'Work/Alerts', 'user'],
      ['Label_6', 'Work/GitHub', 'user'],
      ['Label_7', "Food 'n' Drink", 'user'],
    ]);
    expect(seed.filters[0].action.addLabelIds).toEqual(['Label_1']);
    expect(seed.filters.flatMap((f) => f.action.addLabelIds ?? [])).not.toContainEqual(
      expect.stringMatching(/^new:/),
    );
    expect(seed.forwardingAddresses).toEqual([
      { forwardingEmail: 'partner@example.net', verificationStatus: 'accepted' },
    ]);
  });

  it('does not change the parsed filters', () => {
    const parsed = fromGmailXml(fixture);
    const before = structuredClone(parsed);
    seedFromFile(parsed);
    expect(parsed).toEqual(before);
  });
});

describe('createFileGmail', () => {
  it('serves the file and has no mail', async () => {
    const api = createFileGmail(fromGmailXml(fixture));
    expect(await api.listFilters()).toHaveLength(12);
    expect(await api.listLabels()).toHaveLength(7);
    await expect(api.searchMessages('from:a')).rejects.toThrow(NEEDS_SIGN_IN);
    await expect(api.applyToExisting('from:a', ['Label_1'], [])).rejects.toThrow(NEEDS_SIGN_IN);
  });

  it('keeps Gmail rules: forwarding only to addresses in the file', async () => {
    const api = createFileGmail(fromGmailXml(fixture));
    await expect(
      api.createFilter({ criteria: { from: 'x' }, action: { forward: 'partner@example.net' } }),
    ).resolves.toMatchObject({ id: expect.any(String) });
    await expect(
      api.createFilter({ criteria: { from: 'y' }, action: { forward: 'new@example.net' } }),
    ).rejects.toThrow();
  });

  it('runs a plan and writes the change to the new file', async () => {
    const api = createFileGmail(fromGmailXml(fixture));
    const filters = await api.listFilters();
    const target = filters.filter((f) => f.action.addLabelIds?.includes('Label_5'));
    const plan = planReplaceLabel(target, 'Label_5', { newLabelName: 'Work/On call' });
    const run = await runPlan(plan, api);
    expect(run.error).toBeNull();
    const labels = await api.listLabels();
    const xml = toGmailXml(await api.listFilters(), new Map(labels.map((l) => [l.id, l])));
    expect(xml).toContain("name='label' value='Work/On call'");
    expect(xml).not.toContain("value='Work/Alerts'");
  });
});

describe('createFileAuth', () => {
  it('has only the basic tier and cannot upgrade', async () => {
    const auth = createFileAuth();
    expect(auth.hasTier('basic')).toBe(true);
    expect(auth.hasTier('preview')).toBe(false);
    expect(auth.hasTier('apply')).toBe(false);
    await expect(auth.upgrade()).rejects.toThrow(NEEDS_SIGN_IN);
    expect(auth.getToken()).toBe('file');
    expect(auth.expiresAt()).toBeNull();
    await auth.signIn();
    await auth.signOut();
    auth.revoke();
    expect(typeof auth.onChange(() => {})).toBe('function');
  });
});

describe('contentKey', () => {
  const labels = new Map([
    ['L1', { id: 'L1', name: 'One', type: 'user' }],
    ['L9', { id: 'L9', name: 'One', type: 'user' }],
  ]);
  it('ignores filter IDs, order and label IDs with the same name', () => {
    const a = [
      {
        id: 'a',
        criteria: { from: 'x', subject: 'y' },
        action: { addLabelIds: ['L1', 'STARRED'] },
      },
      { id: 'b', criteria: { to: 'z' }, action: { removeLabelIds: ['INBOX', 'UNREAD'] } },
    ];
    const b = [
      { id: 'c', criteria: { to: 'z' }, action: { removeLabelIds: ['UNREAD', 'INBOX'] } },
      {
        id: 'd',
        criteria: { subject: 'y', from: 'x' },
        action: { addLabelIds: ['STARRED', 'L9'] },
      },
    ];
    expect(contentKey(a, labels)).toBe(contentKey(b, labels));
  });

  it('changes when a filter changes', () => {
    const a = [{ id: 'a', criteria: { from: 'x' }, action: { forward: 'p@x.com' } }];
    const b = [{ id: 'a', criteria: { from: 'x' }, action: { forward: 'q@x.com' } }];
    expect(contentKey(a, labels)).not.toBe(contentKey(b, labels));
    expect(contentKey(a, labels)).not.toBe(contentKey([...a, ...a], labels));
  });
});
