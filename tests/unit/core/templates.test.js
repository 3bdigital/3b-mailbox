import { describe, it, expect } from 'vitest';
import {
  TEMPLATES,
  TEMPLATE_GROUPS,
  instantiate,
  matchExisting,
} from '../../../site/app/js/core/templates.js';

const CAP = 1400;

/** Same idea as core/limits.js criteriaToSearch, kept local so this test stands alone. */
function toSearch(c) {
  const parts = [];
  if (c.from) parts.push(`from:(${c.from})`);
  if (c.to) parts.push(`to:(${c.to})`);
  if (c.subject) parts.push(`subject:(${c.subject})`);
  if (c.query) parts.push(c.query);
  if (c.negatedQuery) parts.push(`-{${c.negatedQuery}}`);
  if (c.hasAttachment) parts.push('has:attachment');
  if (c.size) parts.push(`${c.sizeComparison === 'smaller' ? 'smaller' : 'larger'}:${c.size}`);
  return parts.join(' ');
}

/** Removes quoted phrases so operator checks only look at real syntax. */
function stripQuotes(s) {
  return s.replace(/"[^"]*"/g, '""');
}

/** Operators that never match incoming mail, or that we must not depend on. */
const UNSAFE = [
  /(^|[\s(){}-])label:/i,
  /(^|[\s(){}-])in:/i,
  /(^|[\s(){}-])is:/i,
  /(^|[\s(){}-])category:/i,
  /(^|[\s(){}-])(older_than|newer_than|older|newer|after|before):/i,
  /has:(userlabels|nouserlabels)/i,
  /has:[a-z]+-(star|bang|guillemet|question|check|info)/i,
];

const ALLOWED_OPERATORS = new Set([
  'from',
  'to',
  'cc',
  'bcc',
  'subject',
  'list',
  'filename',
  'has',
  'larger',
  'smaller',
  'deliveredto',
]);

function allStrings(c) {
  return ['from', 'to', 'subject', 'query', 'negatedQuery'].map((k) => c[k]).filter(Boolean);
}

function checkBalanced(s) {
  const quotes = (s.match(/"/g) || []).length;
  if (quotes % 2 !== 0) return false;
  const bare = stripQuotes(s);
  let round = 0;
  let curly = 0;
  for (const ch of bare) {
    if (ch === '(') round += 1;
    if (ch === ')') round -= 1;
    if (ch === '{') curly += 1;
    if (ch === '}') curly -= 1;
    if (round < 0 || curly < 0) return false;
  }
  return round === 0 && curly === 0;
}

const labels = [
  { id: 'INBOX', name: 'INBOX', type: 'system' },
  { id: 'STARRED', name: 'STARRED', type: 'system' },
  { id: 'Label_1', name: 'receipts', type: 'user' },
  { id: 'Label_2', name: 'finance', type: 'user' },
];

const byId = (id) => TEMPLATES.find((t) => t.id === id);

describe('catalogue shape', () => {
  it('has between 30 and 60 templates', () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(30);
    expect(TEMPLATES.length).toBeLessThanOrEqual(60);
  });

  it('has unique ids in kebab case', () => {
    const ids = TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('puts every template in a known group, and every group has a template', () => {
    for (const t of TEMPLATES) expect(TEMPLATE_GROUPS).toContain(t.group);
    for (const g of TEMPLATE_GROUPS) expect(TEMPLATES.some((t) => t.group === g)).toBe(true);
  });

  it('fills every required field', () => {
    for (const t of TEMPLATES) {
      expect(t.name, t.id).toBeTruthy();
      expect(t.description.length, t.id).toBeGreaterThan(10);
      expect(t.rationale.length, t.id).toBeGreaterThan(20);
      expect(['low', 'medium', 'high']).toContain(t.risk);
      expect(Array.isArray(t.cautions)).toBe(true);
      expect(Array.isArray(t.regions)).toBe(true);
      expect(t.defaults.labelName, t.id).toBeTruthy();
      expect(Array.isArray(t.options)).toBe(true);
      expect(t.options.some((o) => o.key === 'labelName')).toBe(true);
      for (const o of t.options) expect(['boolean', 'text']).toContain(o.type);
      expect(Object.keys(t.criteria).length, t.id).toBeGreaterThan(0);
    }
  });

  it('includes the two templates the maintainer asked for', () => {
    expect(byId('has-unsubscribe').defaults.labelName).toBe('has-unsubscribe');
    expect(byId('receipts').defaults.labelName).toBe('Receipts');
  });

  it('marks UK-only templates with GB and has some of them', () => {
    const gb = TEMPLATES.filter((t) => t.regions.includes('GB'));
    expect(gb.length).toBeGreaterThanOrEqual(10);
    for (const id of ['hmrc', 'gov-uk', 'uk-couriers', 'uk-rail', 'uk-banks', 'uk-utilities']) {
      expect(byId(id).regions).toEqual(['GB']);
    }
  });

  it('defaults to label only: no archive, no mark read, no delete, no forward', () => {
    for (const t of TEMPLATES) {
      expect(t.defaults.archive, t.id).toBe(false);
      expect(t.defaults.markRead, t.id).toBe(false);
      expect(t.defaults.important, t.id).toBeNull();
      expect(t.defaults.neverSpam, t.id).toBe(false);
      const { filter } = instantiate(t, {}, []);
      expect(filter.action.removeLabelIds, t.id).toBeUndefined();
      expect(filter.action.addLabelIds).not.toContain('TRASH');
      expect(filter.action.forward).toBeUndefined();
    }
  });

  it('never offers skip inbox or mark read on security templates', () => {
    for (const t of TEMPLATES.filter((x) => x.group === 'Security and accounts')) {
      const keys = t.options.map((o) => o.key);
      expect(keys, t.id).not.toContain('skipInbox');
      expect(keys, t.id).not.toContain('markRead');
    }
  });
});

describe('criteria syntax', () => {
  it('keeps every criteria string well under the length cap', () => {
    for (const t of TEMPLATES) {
      expect(toSearch(t.criteria).length, t.id).toBeLessThan(1000);
      // With the safety exclusion and all options on, still under the cap.
      const on = Object.fromEntries(
        t.options.filter((o) => o.type === 'boolean').map((o) => [o.key, true]),
      );
      const { filter } = instantiate(t, on, []);
      expect(toSearch(filter.criteria).length, t.id).toBeLessThan(CAP);
    }
  });

  it('uses no operator that never matches incoming mail', () => {
    for (const t of TEMPLATES) {
      for (const s of allStrings(t.criteria)) {
        const bare = stripQuotes(s);
        for (const re of UNSAFE) expect(re.test(bare), `${t.id}: ${s}`).toBe(false);
      }
    }
  });

  it('uses only known filter-safe operators', () => {
    for (const t of TEMPLATES) {
      for (const s of allStrings(t.criteria)) {
        const ops = stripQuotes(s).match(/[a-z_]+(?=:)/gi) || [];
        for (const op of ops)
          expect(ALLOWED_OPERATORS.has(op.toLowerCase()), `${t.id}: ${op}`).toBe(true);
      }
    }
  });

  it('has balanced brackets and quotes', () => {
    for (const t of TEMPLATES) {
      for (const s of allStrings(t.criteria)) expect(checkBalanced(s), `${t.id}: ${s}`).toBe(true);
      const { filter } = instantiate(t, { skipInbox: true, markRead: true }, []);
      for (const s of allStrings(filter.criteria)) expect(checkBalanced(s), t.id).toBe(true);
    }
  });

  it('writes OR in capitals and uses no wildcards or regex', () => {
    for (const t of TEMPLATES) {
      for (const s of allStrings(t.criteria)) {
        const bare = stripQuotes(s);
        expect(/\s(or|Or)\s/.test(bare), `${t.id}: lower-case or`).toBe(false);
        expect(/\sAND\s/.test(bare), `${t.id}: AND is not needed`).toBe(false);
        expect(/[*?\\[\]^$]/.test(bare), `${t.id}: wildcard or regex`).toBe(false);
        expect(/\s{2,}/.test(s), `${t.id}: double space`).toBe(false);
        expect(s).toBe(s.trim());
      }
    }
  });

  it('uses straight quotes only', () => {
    for (const t of TEMPLATES) {
      const text = JSON.stringify(t);
      expect(/[\u2018\u2019\u201C\u201D\u2014]/.test(text), t.id).toBe(false);
    }
  });

  it('uses a valid size for the large attachment template', () => {
    const t = byId('large-attachments');
    expect(t.criteria).toEqual({ hasAttachment: true, size: 10485760, sizeComparison: 'larger' });
  });
});

describe('instantiate', () => {
  it('produces the Gmail API filter shape', () => {
    for (const t of TEMPLATES) {
      const { filter, labelsToCreate } = instantiate(t, {}, []);
      expect(Object.keys(filter).sort()).toEqual(['action', 'criteria']);
      const allowed = [
        'from',
        'to',
        'subject',
        'query',
        'negatedQuery',
        'hasAttachment',
        'excludeChats',
        'size',
        'sizeComparison',
      ];
      for (const k of Object.keys(filter.criteria)) expect(allowed).toContain(k);
      for (const k of Object.keys(filter.action)) {
        expect(['addLabelIds', 'removeLabelIds', 'forward']).toContain(k);
      }
      expect(Array.isArray(filter.action.addLabelIds)).toBe(true);
      expect(filter.action.addLabelIds.length).toBeGreaterThan(0);
      expect(Array.isArray(labelsToCreate)).toBe(true);
      expect(filter.id).toBeUndefined();
    }
  });

  it('uses a "new:" placeholder for a label that does not exist', () => {
    const { filter, labelsToCreate } = instantiate(byId('has-unsubscribe'), {}, labels);
    expect(filter.action.addLabelIds).toEqual(['new:has-unsubscribe']);
    expect(labelsToCreate).toEqual(['has-unsubscribe']);
  });

  it('matches existing label names without regard to case', () => {
    const { filter, labelsToCreate } = instantiate(byId('receipts'), {}, labels);
    expect(filter.action.addLabelIds).toEqual(['Label_1']);
    expect(labelsToCreate).toEqual([]);
  });

  it('creates parents before children and keeps an existing parent spelling', () => {
    const r1 = instantiate(byId('uk-banks'), {}, labels);
    expect(r1.labelsToCreate).toEqual(['finance/Banking']);
    expect(r1.filter.action.addLabelIds).toEqual(['new:finance/Banking']);

    const r2 = instantiate(byId('github-needs-you'), {}, []);
    expect(r2.labelsToCreate).toEqual(['Dev', 'Dev/GitHub', 'Dev/GitHub/Needs you']);
    expect(r2.filter.action.addLabelIds).toEqual(['new:Dev/GitHub/Needs you']);
  });

  it('does not match system labels by name', () => {
    const { filter } = instantiate(byId('travel-bookings'), {}, [
      { id: 'SYS', name: 'Travel', type: 'system' },
    ]);
    expect(filter.action.addLabelIds).toEqual(['new:Travel']);
  });

  it('applies skip inbox, mark read and star', () => {
    const { filter } = instantiate(
      byId('social'),
      { skipInbox: true, markRead: true, keepSafetyMail: false },
      [],
    );
    expect(filter.action.removeLabelIds).toEqual(['INBOX', 'UNREAD']);
    expect(filter.criteria.negatedQuery).toBeUndefined();

    const starred = instantiate(byId('hmrc'), { star: true }, []);
    expect(starred.filter.action.addLabelIds).toEqual(['new:Government/HMRC', 'STARRED']);
    expect(starred.labelsToCreate).toEqual(['Government', 'Government/HMRC']);
  });

  it('adds the safety exclusion when it archives, unless turned off', () => {
    const on = instantiate(byId('has-unsubscribe'), { skipInbox: true }, []);
    expect(on.filter.criteria.negatedQuery).toContain('"verification code"');
    expect(on.filter.criteria.negatedQuery).toContain('"security alert"');
    const labelOnly = instantiate(byId('has-unsubscribe'), {}, []);
    expect(labelOnly.filter.criteria.negatedQuery).toBeUndefined();
    const off = instantiate(
      byId('has-unsubscribe'),
      { skipInbox: true, keepSafetyMail: false },
      [],
    );
    expect(off.filter.criteria.negatedQuery).toBeUndefined();
  });

  it('ignores options that a template does not offer', () => {
    const { filter } = instantiate(byId('one-time-codes'), { skipInbox: true, markRead: true }, []);
    expect(filter.action.removeLabelIds).toBeUndefined();
  });

  it('uses a custom label name and cleans it', () => {
    const { filter, labelsToCreate } = instantiate(
      byId('receipts'),
      { labelName: '  Money //  Receipts / ' },
      [],
    );
    expect(labelsToCreate).toEqual(['Money', 'Money/Receipts']);
    expect(filter.action.addLabelIds).toEqual(['new:Money/Receipts']);
  });

  it('falls back to the default label when the custom name is empty', () => {
    const { filter } = instantiate(byId('receipts'), { labelName: '   ' }, []);
    expect(filter.action.addLabelIds).toEqual(['new:Receipts']);
  });

  it('refuses reserved label names', () => {
    expect(() => instantiate(byId('receipts'), { labelName: 'Inbox' }, [])).toThrow(/Gmail keeps/);
    expect(() => instantiate(byId('receipts'), { labelName: 'starred' }, [])).toThrow();
  });

  it('adds extra senders to the from field', () => {
    const { filter } = instantiate(
      byId('school'),
      { extraSenders: 'myschool.org.uk, @office.example.com  head@example.org' },
      [],
    );
    expect(
      filter.criteria.from.endsWith('OR myschool.org.uk OR office.example.com OR head@example.org'),
    ).toBe(true);
  });

  it('adds extra senders to a query as an OR branch', () => {
    const { filter } = instantiate(byId('receipts'), { extraSenders: 'xero.com' }, []);
    expect(filter.criteria.query.startsWith('(subject:(')).toBe(true);
    expect(filter.criteria.query.endsWith(') OR from:(xero.com)')).toBe(true);
    expect(checkBalanced(filter.criteria.query)).toBe(true);
  });

  it('drops sender text that could inject operators', () => {
    const { filter } = instantiate(
      byId('school'),
      { extraSenders: 'label:inbox (evil) "x" OR is:unread good.example' },
      [],
    );
    expect(filter.criteria.from).not.toMatch(/label:|is:|\(evil\)|"/);
    expect(filter.criteria.from.endsWith('OR good.example')).toBe(true);
  });

  it('refuses a filter that would go over the cap', () => {
    const many = Array.from({ length: 120 }, (_, i) => `sender${i}.example.com`).join(' ');
    expect(() => instantiate(byId('school'), { extraSenders: many }, [])).toThrow(/too long/);
  });

  it('replaces the list query when a list ID is given, and checks it', () => {
    const { filter } = instantiate(byId('group-lists'), { listId: 'Parents.MySchool.sch.uk' }, []);
    expect(filter.criteria.query).toBe('list:parents.myschool.sch.uk');
    expect(() => instantiate(byId('group-lists'), { listId: 'a OR label:x' }, [])).toThrow();
  });

  it('keeps size criteria for the large attachments template', () => {
    const { filter } = instantiate(byId('large-attachments'), {}, []);
    expect(filter.criteria).toEqual({
      hasAttachment: true,
      size: 10485760,
      sizeComparison: 'larger',
    });
  });

  it('does not change the template object', () => {
    const t = byId('school');
    const before = JSON.stringify(t);
    instantiate(t, { extraSenders: 'x.example', skipInbox: true }, []);
    expect(JSON.stringify(t)).toBe(before);
  });

  it('rejects an invalid template', () => {
    expect(() => instantiate(/** @type {any} */ (null))).toThrow();
  });
});

describe('matchExisting', () => {
  const t = byId('uk-couriers');

  it('finds a filter with the same criteria in a different order and case', () => {
    const reversed = t.criteria.from.split(' OR ').reverse().join(' OR ').replace(/\.com/g, '.COM');
    const existing = {
      id: 'f1',
      criteria: { from: `(${reversed})` },
      action: { addLabelIds: ['Label_9'], removeLabelIds: ['INBOX'] },
    };
    expect(matchExisting(t, [existing])).toBe(existing);
  });

  it('finds the filter that instantiate made, including the safety exclusion', () => {
    for (const tpl of TEMPLATES) {
      const made = instantiate(tpl, { skipInbox: true }, []).filter;
      const existing = { id: 'x', ...made };
      expect(matchExisting(tpl, [existing]), tpl.id).toBe(existing);
    }
  });

  it('ignores filters with different criteria or no user label', () => {
    const other = { id: 'f2', criteria: { from: 'evri.com' }, action: { addLabelIds: ['L'] } };
    const archiveOnly = {
      id: 'f3',
      criteria: { ...t.criteria },
      action: { removeLabelIds: ['INBOX'], addLabelIds: ['STARRED'] },
    };
    expect(matchExisting(t, [other, archiveOnly])).toBeNull();
  });

  it('treats query spacing and outer brackets as equal', () => {
    const q = byId('calendar-invites');
    const existing = {
      id: 'f4',
      criteria: { query: '(  FILENAME:ics   OR filename:VCS )' },
      action: { addLabelIds: ['Label_3'] },
    };
    expect(matchExisting(q, [existing])).toBe(existing);
  });

  it('copes with bad input', () => {
    expect(matchExisting(t, /** @type {any} */ (null))).toBeNull();
    expect(
      matchExisting(t, [/** @type {any} */ (null), { criteria: null, action: {} }]),
    ).toBeNull();
    expect(matchExisting(/** @type {any} */ (null), [])).toBeNull();
  });
});
