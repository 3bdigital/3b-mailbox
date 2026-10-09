import { describe, expect, it } from 'vitest';
import {
  BackupError,
  SMART_LABELS,
  fromJson,
  toGmailXml,
  toJson,
  xmlEscape,
} from '../../../site/app/js/core/backup.js';

const now = new Date('2026-10-09T12:34:56.789Z');
const labels = [
  { id: 'L1', name: 'Receipts', type: 'user' },
  { id: 'L2', name: 'Money/Bills', type: 'user' },
];
const labelsById = new Map(labels.map((l) => [l.id, l]));

describe('toJson and fromJson', () => {
  it('round-trips filters and labels', () => {
    const filters = [
      {
        id: 'f1',
        criteria: {
          from: 'a@x.com',
          hasAttachment: true,
          size: 10,
          sizeComparison: 'larger',
          excludeChats: true,
        },
        action: { addLabelIds: ['L1'], removeLabelIds: ['INBOX'], forward: 'b@y.com' },
      },
    ];
    const text = toJson(filters, labels, { now });
    expect(JSON.parse(text)).toMatchObject({
      app: '3b-mailbox',
      version: 1,
      exportedAt: now.toISOString(),
    });
    expect(fromJson(text)).toEqual({ filters, labels, exportedAt: now.toISOString() });
  });

  it('works with defaults', () => {
    const back = fromJson(toJson(undefined, undefined));
    expect(back.filters).toEqual([]);
    expect(back.labels).toEqual([]);
    expect(typeof back.exportedAt).toBe('string');
  });

  it('tidies empty fields and accepts missing labels', () => {
    const text = JSON.stringify({
      app: '3b-mailbox',
      version: 1,
      filters: [
        {
          criteria: { from: ' ', to: null, hasAttachment: false, sizeComparison: null, size: null },
          action: { addLabelIds: [], forward: ' ', removeLabelIds: null },
        },
      ],
      labels: [
        { id: 'S', name: 'INBOX', type: 'system' },
        { id: 'X', name: 'x' },
      ],
    });
    expect(fromJson(text)).toEqual({
      filters: [{ criteria: {}, action: {} }],
      labels: [
        { id: 'S', name: 'INBOX', type: 'system' },
        { id: 'X', name: 'x', type: 'user' },
      ],
      exportedAt: null,
    });
    expect(fromJson('{"app":"3b-mailbox","version":1,"filters":[]}').labels).toEqual([]);
  });

  it.each([
    ['not json', 'not JSON'],
    ['[]', 'not a 3B Mailbox backup'],
    ['{"app":"other"}', 'not a 3B Mailbox backup'],
    ['{"app":"3b-mailbox","version":2,"filters":[]}', 'newer version'],
    ['{"app":"3b-mailbox","version":"1","filters":[]}', 'newer version'],
    ['{"app":"3b-mailbox","version":1}', 'no list of filters'],
    ['{"app":"3b-mailbox","version":1,"filters":[1]}', 'Filter 1 is not valid'],
    ['{"app":"3b-mailbox","version":1,"filters":[{"action":{}}]}', 'no search criteria'],
    ['{"app":"3b-mailbox","version":1,"filters":[{"criteria":{}}]}', 'no action'],
    [
      '{"app":"3b-mailbox","version":1,"filters":[{"criteria":{"from":1},"action":{}}]}',
      'not text',
    ],
    [
      '{"app":"3b-mailbox","version":1,"filters":[{"criteria":{"hasAttachment":"y"},"action":{}}]}',
      'true or false',
    ],
    ['{"app":"3b-mailbox","version":1,"filters":[{"criteria":{"size":-1},"action":{}}]}', 'size'],
    [
      '{"app":"3b-mailbox","version":1,"filters":[{"criteria":{"sizeComparison":"big"},"action":{}}]}',
      'comparison',
    ],
    [
      '{"app":"3b-mailbox","version":1,"filters":[{"criteria":{},"action":{"addLabelIds":[1]}}]}',
      'label list',
    ],
    [
      '{"app":"3b-mailbox","version":1,"filters":[{"criteria":{},"action":{"forward":3}}]}',
      'forward',
    ],
    ['{"app":"3b-mailbox","version":1,"filters":[],"labels":{}}', 'labels that is not valid'],
    ['{"app":"3b-mailbox","version":1,"filters":[],"labels":[{"id":1}]}', 'Label 1 is not valid'],
  ])('rejects %s', (text, message) => {
    expect(() => fromJson(text)).toThrow(BackupError);
    expect(() => fromJson(text)).toThrow(message);
  });
});

describe('xmlEscape', () => {
  it('escapes markup and removes control characters', () => {
    expect(xmlEscape(`a&b<c>'d"\u0001\te`)).toBe('a&amp;b&lt;c&gt;&apos;d&quot;\te');
  });
});

describe('toGmailXml', () => {
  it('writes the Gmail mailFilters.xml format', () => {
    const xml = toGmailXml(
      [
        {
          id: 'f1',
          criteria: {
            from: 'a@x.com',
            to: 'me@home.uk',
            subject: 'Tom & Jerry',
            query: '"order" OR <b>',
            negatedQuery: "don't",
            hasAttachment: true,
            excludeChats: true,
            size: 2048,
            sizeComparison: 'smaller',
          },
          action: {
            addLabelIds: ['L1', 'STARRED', 'TRASH', 'IMPORTANT', 'CATEGORY_UPDATES'],
            removeLabelIds: ['INBOX', 'UNREAD', 'SPAM'],
            forward: 'fw@x.com',
          },
        },
      ],
      labelsById,
      { now, author: { name: 'Jo & Co', email: 'jo@x.com' } },
    );
    expect(xml).toBe(
      [
        "<?xml version='1.0' encoding='UTF-8'?><feed xmlns='http://www.w3.org/2005/Atom' xmlns:apps='http://schemas.google.com/apps/2006'>",
        '\t<title>Mail Filters</title>',
        '\t<id>tag:mail.google.com,2008:filters:f1</id>',
        '\t<updated>2026-10-09T12:34:56Z</updated>',
        '\t<author>',
        '\t\t<name>Jo &amp; Co</name>',
        '\t\t<email>jo@x.com</email>',
        '\t</author>',
        '\t<entry>',
        "\t\t<category term='filter'></category>",
        '\t\t<title>Mail Filter</title>',
        '\t\t<id>tag:mail.google.com,2008:filter:f1</id>',
        '\t\t<updated>2026-10-09T12:34:56Z</updated>',
        '\t\t<content></content>',
        "\t\t<apps:property name='from' value='a@x.com'/>",
        "\t\t<apps:property name='to' value='me@home.uk'/>",
        "\t\t<apps:property name='subject' value='Tom &amp; Jerry'/>",
        "\t\t<apps:property name='hasTheWord' value='&quot;order&quot; OR &lt;b&gt;'/>",
        "\t\t<apps:property name='doesNotHaveTheWord' value='don&apos;t'/>",
        "\t\t<apps:property name='hasAttachment' value='true'/>",
        "\t\t<apps:property name='excludeChats' value='true'/>",
        "\t\t<apps:property name='size' value='2048'/>",
        "\t\t<apps:property name='sizeOperator' value='s_ss'/>",
        "\t\t<apps:property name='sizeUnit' value='s_sb'/>",
        "\t\t<apps:property name='label' value='Receipts'/>",
        "\t\t<apps:property name='shouldArchive' value='true'/>",
        "\t\t<apps:property name='shouldMarkAsRead' value='true'/>",
        "\t\t<apps:property name='shouldStar' value='true'/>",
        "\t\t<apps:property name='shouldTrash' value='true'/>",
        "\t\t<apps:property name='shouldNeverSpam' value='true'/>",
        "\t\t<apps:property name='shouldAlwaysMarkAsImportant' value='true'/>",
        "\t\t<apps:property name='smartLabelToApply' value='^smartlabel_notification'/>",
        "\t\t<apps:property name='forwardTo' value='fw@x.com'/>",
        '\t</entry>',
        '</feed>',
        '',
      ].join('\n'),
    );
  });

  it('splits a filter with several labels into one entry per label', () => {
    const xml = toGmailXml(
      [
        {
          id: 'f1',
          criteria: { from: 'a' },
          action: {
            addLabelIds: ['L1', 'L2', 'new:Later', 'Label_gone'],
            removeLabelIds: ['INBOX'],
          },
        },
      ],
      labelsById,
      { now },
    );
    const entries = xml.split('<entry>').slice(1);
    expect(entries).toHaveLength(4);
    expect(entries.map((e) => /name='label' value='([^']*)'/.exec(e)[1])).toEqual([
      'Receipts',
      'Money/Bills',
      'Later',
      'Label_gone',
    ]);
    expect(entries.map((e) => e.includes('shouldArchive'))).toEqual([true, false, false, false]);
    expect(entries.every((e) => e.includes("name='from' value='a'"))).toBe(true);
    expect(xml).toContain('filters:f1,f1-2,f1-3,f1-4</id>');
    expect(xml).not.toContain('<author>');
  });

  it('maps categories, never important, larger size and filters with no id', () => {
    const xml = toGmailXml(
      [
        {
          criteria: { size: 5, sizeComparison: 'larger' },
          action: { removeLabelIds: ['IMPORTANT'] },
        },
        ...Object.keys(SMART_LABELS).map((c) => ({
          criteria: { from: 'x' },
          action: { addLabelIds: [c] },
        })),
      ],
      undefined,
      { now },
    );
    expect(xml).toContain("name='sizeOperator' value='s_sl'");
    expect(xml).toContain("name='shouldNeverMarkAsImportant' value='true'");
    expect(xml).toContain('filter:new1</id>');
    for (const v of ['personal', 'social', 'promo', 'notification', 'group']) {
      expect(xml).toContain(`value='^smartlabel_${v}'`);
    }
  });

  it('works with defaults and no filters', () => {
    const xml = toGmailXml(undefined, new Map());
    expect(xml).toContain('<title>Mail Filters</title>');
    expect(xml).not.toContain('<entry>');
    expect(toGmailXml([{ criteria: undefined, action: undefined }], new Map(), { now })).toContain(
      '<entry>',
    );
  });
});
