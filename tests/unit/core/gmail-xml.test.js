import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { toFriendly } from '../../../site/app/js/core/actions.js';
import {
  BackupError,
  XML_LIMITS,
  fromGmailXml,
  toGmailXml,
  xmlDecode,
} from '../../../site/app/js/core/backup.js';

const fixture = readFileSync(
  new URL('../../fixtures/core/mailFilters.xml', import.meta.url),
  'utf8',
);

/**
 * A feed around some entries, in Gmail's own style.
 * @param {string[]} entries  The property lines of each entry.
 * @param {string} [q]  Quote character for the attributes.
 */
function feed(entries, q = "'") {
  return [
    `<?xml version=${q}1.0${q} encoding=${q}UTF-8${q}?><feed xmlns=${q}http://www.w3.org/2005/Atom${q} xmlns:apps=${q}http://schemas.google.com/apps/2006${q}>`,
    '<title>Mail Filters</title>',
    ...entries.map((props, i) =>
      [
        '<entry>',
        `<category term=${q}filter${q}></category>`,
        '<title>Mail Filter</title>',
        `<id>tag:mail.google.com,2008:filter:${i + 1}</id>`,
        '<content></content>',
        props,
        '</entry>',
      ].join('\n'),
    ),
    '</feed>',
  ].join('\n');
}

/** @param {string} name @param {string} value */
const prop = (name, value, q = "'") =>
  `<apps:property name=${q}${name}${q} value=${q}${value}${q}/>`;

describe('xmlDecode', () => {
  it('decodes named, decimal and hex references and keeps unknown ones', () => {
    expect(xmlDecode('a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;')).toBe(`a & b <c> "d" 'e'`);
    expect(xmlDecode('&#233;&#xE9;&#X1F600;')).toBe('éé\u{1F600}');
    expect(xmlDecode('&nbsp; &#xD800; &#99999999; & alone')).toBe(
      '&nbsp; &#xD800; &#99999999; & alone',
    );
    expect(xmlDecode('&amp;lt;')).toBe('&lt;');
  });
});

describe('fromGmailXml: the Gmail export fixture', () => {
  const out = fromGmailXml(fixture);

  it('reads every entry as its own filter', () => {
    expect(out.filters).toHaveLength(12);
    expect(out.warnings).toEqual([]);
    expect(out.filters[0].id).toBe('z0000001696000000001_4826351840128731001');
    expect(new Set(out.filters.map((f) => f.id)).size).toBe(12);
  });

  it('lists label names in order of first use, keeping nested names', () => {
    expect(out.labelNames).toEqual([
      'Shopping/Receipts',
      'Money & Bills',
      'Money & Bills/Statements',
      'Documents',
      'Work/Alerts',
      'Work/GitHub',
      "Food 'n' Drink",
    ]);
    expect(out.forwardAddresses).toEqual(['partner@example.net']);
  });

  it('maps criteria and actions', () => {
    const [amazon, ebay, invoices, news, boss, social, spam, bank, docs, alerts, github, cafe] =
      out.filters;
    expect(amazon).toEqual({
      id: amazon.id,
      criteria: { from: 'auto-confirm@amazon.co.uk' },
      action: { addLabelIds: ['new:Shopping/Receipts'], removeLabelIds: ['INBOX'] },
    });
    expect(ebay.action).toEqual({ addLabelIds: ['new:Shopping/Receipts'] });
    expect(invoices.criteria).toEqual({
      query: 'subject:(invoice OR receipt OR "order confirmation")',
      negatedQuery: 'from:me',
    });
    expect(invoices.action).toEqual({
      addLabelIds: ['new:Money & Bills'],
      removeLabelIds: ['SPAM'],
    });
    expect(news.criteria).toEqual({ query: 'list:(<news.example.org>)' });
    expect(news.action).toEqual({
      addLabelIds: ['CATEGORY_PROMOTIONS'],
      removeLabelIds: ['INBOX', 'UNREAD'],
    });
    expect(boss.action).toEqual({ addLabelIds: ['STARRED', 'IMPORTANT'] });
    expect(social.action).toEqual({
      addLabelIds: ['CATEGORY_SOCIAL'],
      removeLabelIds: ['IMPORTANT'],
    });
    expect(spam.action).toEqual({ addLabelIds: ['TRASH'] });
    expect(bank).toMatchObject({
      criteria: { to: 'sam.example+bank@gmail.com', subject: 'Your statement is ready' },
      action: { addLabelIds: ['new:Money & Bills/Statements'], forward: 'partner@example.net' },
    });
    expect(docs.criteria).toEqual({
      query: 'has:attachment filename:pdf',
      hasAttachment: true,
      excludeChats: true,
      size: 5 * 1024 * 1024,
      sizeComparison: 'larger',
    });
    expect(alerts.criteria).toEqual({
      from: 'alerts@monitoring.example.com',
      size: 200 * 1024,
      sizeComparison: 'smaller',
    });
    expect(github.action.addLabelIds).toEqual(['CATEGORY_UPDATES', 'new:Work/GitHub']);
    expect(cafe.criteria.from).toBe('Café René <hello@cafe.example>');
    expect(cafe.action.addLabelIds).toEqual(['CATEGORY_FORUMS', "new:Food 'n' Drink"]);
  });

  it('ignores a size operator and unit with no size, as Gmail writes them', () => {
    expect(out.filters[0].criteria.size).toBeUndefined();
    expect(out.filters[0].criteria.sizeComparison).toBeUndefined();
  });

  it('writes the same filters back out', () => {
    const again = fromGmailXml(toGmailXml(out.filters, new Map()));
    expect(again.filters).toEqual(out.filters);
    expect(again.labelNames).toEqual(out.labelNames);
  });
});

describe('fromGmailXml: properties and quoting', () => {
  it('reads double quotes, attributes in any order and > inside a value', () => {
    const xml = feed(
      [
        [
          prop('from', 'a@x.com', '"'),
          `<apps:property value="x > y" name="subject" />`,
          `<apps:property  name = 'hasTheWord'  value = "it's" />`,
          prop('label', 'Q', '"'),
        ].join('\n'),
      ],
      '"',
    );
    const out = fromGmailXml(xml);
    expect(out.filters[0].criteria).toEqual({ from: 'a@x.com', subject: 'x > y', query: "it's" });
    expect(out.filters[0].action).toEqual({ addLabelIds: ['new:Q'] });
  });

  it('reads sizes in bytes, KB and MB', () => {
    const sized = (size, op, unit) =>
      fromGmailXml(
        feed([
          [
            prop('from', 'a'),
            prop('label', 'L'),
            prop('size', size),
            prop('sizeOperator', op),
            prop('sizeUnit', unit),
          ].join(''),
        ]),
      ).filters[0].criteria;
    expect(sized('100', 's_sl', 's_sb')).toMatchObject({ size: 100, sizeComparison: 'larger' });
    expect(sized('2', 's_ss', 's_skb')).toMatchObject({ size: 2048, sizeComparison: 'smaller' });
    expect(sized('3', 's_sl', 's_smb')).toMatchObject({ size: 3145728 });
    expect(sized('0', 's_sl', 's_smb')).toEqual({ from: 'a' });
  });

  it('warns about a size with no unit or operator, and a size that is not a number', () => {
    const out = fromGmailXml(
      feed([
        [prop('from', 'a'), prop('label', 'L'), prop('size', '7')].join(''),
        [prop('from', 'b'), prop('label', 'L'), prop('size', 'big'), prop('sizeUnit', 's_sb')].join(
          '',
        ),
      ]),
    );
    expect(out.filters[0].criteria).toEqual({ from: 'a', size: 7, sizeComparison: 'larger' });
    expect(out.filters[1].criteria).toEqual({ from: 'b' });
    expect(out.warnings).toEqual([
      'Filter 1 has a size with no unit. 3B Mailbox reads it as bytes.',
      'Filter 1 has a size but does not say larger or smaller. 3B Mailbox reads it as larger.',
      'Filter 2 has a size that is not a number. The size is left out.',
    ]);
  });

  it('treats only "true" as true', () => {
    const out = fromGmailXml(
      feed([
        [
          prop('from', 'a'),
          prop('hasAttachment', 'false'),
          prop('excludeChats', 'TRUE'),
          prop('shouldArchive', 'false'),
          prop('shouldStar', 'True'),
        ].join(''),
      ]),
    );
    expect(out.filters[0]).toMatchObject({
      criteria: { from: 'a', excludeChats: true },
      action: { addLabelIds: ['STARRED'] },
    });
    expect(out.filters[0].criteria.hasAttachment).toBeUndefined();
  });

  it('puts unknown properties and categories in warnings, not errors', () => {
    const out = fromGmailXml(
      feed([
        [
          prop('from', 'a'),
          prop('label', 'L'),
          prop('cannedResponse', 'x'),
          prop('shouldSendTemplate', 'true'),
        ].join(''),
        [
          prop('from', 'b'),
          prop('smartLabelToApply', '^smartlabel_unknown'),
          prop('shouldStar', 'true'),
        ].join(''),
      ]),
    );
    expect(out.filters).toHaveLength(2);
    expect(out.warnings).toEqual([
      'Filter 1 uses "cannedResponse", "shouldSendTemplate", which 3B Mailbox does not know. They are left out of the new file.',
      'Filter 2 puts mail in a category 3B Mailbox does not know ("^smartlabel_unknown"). The category is left out.',
    ]);
  });

  it('leaves out entries with no search terms, no known action, or that are not filters', () => {
    const xml = feed([
      prop('label', 'L'),
      [prop('from', 'a'), prop('mystery', 'x')].join(''),
      [prop('from', 'ok'), prop('shouldStar', 'true')].join(''),
    ]).replace(
      '</feed>',
      "<entry><category term='other'></category><apps:property name='from' value='z'/></entry></feed>",
    );
    const out = fromGmailXml(xml);
    expect(out.filters.map((f) => f.criteria.from)).toEqual(['ok']);
    expect(out.warnings).toEqual([
      'Filter 1 has no search terms. It is left out.',
      'Filter 2 uses "mystery", which 3B Mailbox does not know. It is left out of the new file.',
      'Filter 2 has no action that 3B Mailbox knows. It is left out.',
      'Entry 4 is not a filter. It is left out.',
    ]);
  });

  it('keeps "always important" when a filter also says "never important"', () => {
    const out = fromGmailXml(
      feed([
        [
          prop('from', 'a'),
          prop('shouldNeverMarkAsImportant', 'true'),
          prop('shouldAlwaysMarkAsImportant', 'true'),
        ].join(''),
      ]),
    );
    expect(out.filters[0].action).toEqual({ addLabelIds: ['IMPORTANT'] });
  });

  it('lists each forwarding address once, ignoring case', () => {
    const out = fromGmailXml(
      feed([
        [prop('from', 'a'), prop('forwardTo', 'Me@X.com')].join(''),
        [prop('from', 'b'), prop('forwardTo', 'me@x.com')].join(''),
        [prop('from', 'c'), prop('forwardTo', 'you@x.com')].join(''),
      ]),
    );
    expect(out.forwardAddresses).toEqual(['Me@X.com', 'you@x.com']);
  });

  it('makes unique ids, and ids for entries that have none', () => {
    const xml = feed([prop('from', 'a') + prop('shouldStar', 'true')])
      .replace('</feed>', `<entry>${prop('from', 'b')}${prop('shouldStar', 'true')}</entry></feed>`)
      .replace(
        '</feed>',
        `<entry><id>tag:mail.google.com,2008:filter:1</id>${prop('from', 'c')}${prop('shouldStar', 'true')}</entry></feed>`,
      );
    const ids = fromGmailXml(xml).filters.map((f) => f.id);
    expect(ids).toEqual(['1', 'file2', '1-3']);
  });

  it('accepts a byte order mark, comments and no XML declaration', () => {
    const xml = `\uFEFF<!-- saved by hand -->${feed([prop('from', 'a') + prop('shouldStar', 'true')]).replace(/^<\?xml[^>]*\?>/, '')}`;
    expect(fromGmailXml(xml).filters).toHaveLength(1);
  });
});

describe('fromGmailXml: files it rejects', () => {
  const cases = [
    ['', 'This file is empty.'],
    ['   ', 'This file is empty.'],
    ['{"app":"3b-mailbox"}', 'This is not a Gmail filter file.'],
    ['<html><body>hi</body></html>', 'This is not a Gmail filter file.'],
    ["<?xml version='1.0'?><rss></rss>", 'This is not a Gmail filter file.'],
    [feed([prop('from', 'a')]).replace('</feed>', ''), 'This is not a Gmail filter file.'],
    [feed([]), 'This file has no filters in it.'],
    [feed(['<from>a</from>']), 'This is not a Gmail filter file.'],
    [feed([prop('from', 'a')]).replace('</entry>', ''), 'This file is damaged.'],
    [feed([prop('label', 'L')]), '3B Mailbox could not read any filters in this file.'],
  ];
  for (const [text, message] of cases) {
    it(`rejects: ${JSON.stringify(text.slice(0, 40))}...`, () => {
      expect(() => fromGmailXml(text)).toThrow(BackupError);
      expect(() => fromGmailXml(text)).toThrow(message);
    });
  }

  it('rejects text that is not a string', () => {
    expect(() => fromGmailXml(/** @type {any} */ (null))).toThrow('This file is empty.');
  });

  it('rejects a file over 5 MB', () => {
    const big = feed([prop('from', 'a') + prop('shouldStar', 'true')]).replace(
      '<title>Mail Filters</title>',
      `<title>${'x'.repeat(XML_LIMITS.maxBytes)}</title>`,
    );
    expect(() => fromGmailXml(big)).toThrow('This file is too big');
  });

  it('reads 2,000 entries and rejects 2,001', () => {
    const entry = prop('from', 'a') + prop('shouldStar', 'true');
    expect(fromGmailXml(feed(Array(2000).fill(entry))).filters).toHaveLength(2000);
    expect(() => fromGmailXml(feed(Array(2001).fill(entry)))).toThrow(
      'This file has 2,001 entries. 3B Mailbox reads up to 2,000.',
    );
  });
});

// ---------------------------------------------------------------------------- round trip

/** A small seeded random number generator, so a failure can be repeated. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const WORDS = [
  'invoice',
  'news',
  'a@x.com',
  'Tom & Jerry',
  '"order confirmation"',
  "don't",
  '<b>',
  'Café',
  'from:(a OR b)',
  '{x y}',
  '-label:z',
  '100%',
  'emoji \u{1F600}',
  'tab\there',
];

/**
 * Builds filters that Gmail could hold, each with one user label at most.
 * @param {number} count
 * @param {number} seed
 */
function generate(count, seed) {
  const r = rng(seed);
  const pick = (list) => list[Math.floor(r() * list.length)];
  const text = () => Array.from({ length: 1 + Math.floor(r() * 3) }, () => pick(WORDS)).join(' ');
  const labels = Array.from({ length: 12 }, (_, i) => ({
    id: `Label_${i + 1}`,
    name: i % 3 === 0 ? `Parent ${i}/Child & co` : `Label ${i} ${pick(WORDS)}`,
    type: 'user',
  }));
  const filters = [];
  for (let i = 0; i < count; i++) {
    const criteria = {};
    for (const k of ['from', 'to', 'subject', 'query', 'negatedQuery']) {
      if (r() < 0.35) criteria[k] = text();
    }
    if (r() < 0.2) criteria.hasAttachment = true;
    if (r() < 0.1) criteria.excludeChats = true;
    if (r() < 0.2) {
      criteria.size = 1 + Math.floor(r() * 50_000_000);
      criteria.sizeComparison = r() < 0.5 ? 'larger' : 'smaller';
    }
    if (Object.keys(criteria).length === 0) criteria.from = `sender${i}@example.com`;
    const add = [];
    const remove = [];
    if (r() < 0.6) add.push(pick(labels).id);
    if (r() < 0.3) remove.push('INBOX');
    if (r() < 0.2) remove.push('UNREAD');
    if (r() < 0.1) add.push('STARRED');
    if (r() < 0.05) add.push('TRASH');
    if (r() < 0.1) remove.push('SPAM');
    const imp = r();
    if (imp < 0.1) add.push('IMPORTANT');
    else if (imp < 0.2) remove.push('IMPORTANT');
    if (r() < 0.15)
      add.push(
        pick([
          'CATEGORY_PERSONAL',
          'CATEGORY_SOCIAL',
          'CATEGORY_PROMOTIONS',
          'CATEGORY_UPDATES',
          'CATEGORY_FORUMS',
        ]),
      );
    const action = {};
    if (add.length) action.addLabelIds = add;
    if (remove.length) action.removeLabelIds = remove;
    if (r() < 0.1 || (!add.length && !remove.length)) action.forward = `fw${i % 4}@example.net`;
    filters.push({ id: `f${i}`, criteria, action });
  }
  return { filters, labels };
}

/**
 * The same filter with label IDs swapped for names and the action in a fixed order.
 * @param {any} filter
 * @param {(id: string) => string} nameOf
 */
function comparable(filter, nameOf) {
  const f = toFriendly(filter.action);
  return {
    id: filter.id,
    criteria: filter.criteria,
    action: { ...f, labelIds: f.labelIds.map(nameOf).sort() },
  };
}

describe('fromGmailXml(toGmailXml(x)) round trip', () => {
  for (const seed of [1, 2, 3]) {
    it(`gives back the same 1,000 filters (seed ${seed})`, () => {
      const { filters, labels } = generate(1000, seed);
      const byId = new Map(labels.map((l) => [l.id, l]));
      const out = fromGmailXml(toGmailXml(filters, byId));
      expect(out.warnings).toEqual([]);
      expect(out.filters).toHaveLength(filters.length);
      const before = filters.map((f) => comparable(f, (id) => byId.get(id).name));
      const after = out.filters.map((f) => comparable(f, (id) => id.replace(/^new:/, '')));
      expect(after).toEqual(before);
      const used = new Set(filters.flatMap((f) => f.action.addLabelIds ?? []));
      expect(new Set(out.labelNames)).toEqual(
        new Set(labels.filter((l) => used.has(l.id)).map((l) => l.name)),
      );
      const forwards = new Set(filters.map((f) => f.action.forward).filter(Boolean));
      expect(new Set(out.forwardAddresses)).toEqual(forwards);
    });
  }

  it('splits a filter with several labels into entries that together do the same', () => {
    const labels = [
      { id: 'L1', name: 'One', type: 'user' },
      { id: 'L2', name: 'Two/Three', type: 'user' },
    ];
    const filter = {
      id: 'f1',
      criteria: { from: 'a@x.com', size: 10, sizeComparison: 'larger' },
      action: { addLabelIds: ['L1', 'L2', 'STARRED'], removeLabelIds: ['INBOX'] },
    };
    const out = fromGmailXml(toGmailXml([filter], new Map(labels.map((l) => [l.id, l]))));
    expect(out.filters).toHaveLength(2);
    expect(out.filters.every((f) => f.criteria.from === 'a@x.com' && f.criteria.size === 10)).toBe(
      true,
    );
    expect(out.filters[0].action).toEqual({
      addLabelIds: ['STARRED', 'new:One'],
      removeLabelIds: ['INBOX'],
    });
    expect(out.filters[1].action).toEqual({ addLabelIds: ['new:Two/Three'] });
    expect(out.filters.map((f) => f.id)).toEqual(['f1', 'f1-2']);
  });
});
