import { describe, expect, it } from 'vitest';
import {
  OPERATORS,
  canonicalize,
  findUnsafeOperators,
  normaliseQuery,
  orJoin,
  parse,
  serialize,
  tokenize,
  walk,
} from '../../../site/app/js/core/query.js';
import { QUERIES } from '../../fixtures/core/queries.js';
import { matchesQuery, messages } from '../../fixtures/core/matcher.js';

const MSGS = messages(400, 7);
// Extra messages that use the words and senders in the query corpus.
const CORPUS_MSGS = [
  ...MSGS,
  ...[
    'amazon.co.uk',
    'ebay.co.uk',
    'noreply@hmrc.gov.uk',
    'a@x.com',
    'b@y.com',
    'noreply@github.com',
    'xero.com',
    'barclays.co.uk',
  ].flatMap((from) =>
    ['invoice', 'receipt', 'tax return', 'order confirmation', 'merged', 'statement'].map(
      (subject, i) => ({
        from,
        to: 'me',
        subject,
        body: i % 2 ? 'unsubscribe vat holiday vacation' : 'hello',
        hasAttachment: i % 3 === 0,
      }),
    ),
  ),
];

describe('tokenize', () => {
  it('splits operators, phrases, brackets and keywords', () => {
    const t = tokenize('from:(a OR b) subject:"x y" -{c | d} AROUND 3 e AND f');
    expect(t.map((x) => x.type)).toEqual([
      'op',
      'lparen',
      'word',
      'or',
      'word',
      'rparen',
      'op',
      'phrase',
      'not',
      'lbrace',
      'word',
      'or',
      'word',
      'rbrace',
      'around',
      'word',
      'and',
      'word',
    ]);
    expect(t[0]).toMatchObject({ value: 'from', attached: true, pos: 0 });
    expect(t[7].value).toBe('x y');
    expect(t[14].value).toBe('3');
  });

  it('keeps operator values attached to the operator', () => {
    expect(tokenize('from:a@b.com')).toEqual([
      { type: 'op', value: 'from', pos: 0, attached: true },
      { type: 'word', value: 'a@b.com', pos: 5 },
    ]);
  });

  it('treats unknown name: words as plain words', () => {
    expect(tokenize('http://x.com foo:bar')).toEqual([
      { type: 'word', value: 'http://x.com', pos: 0 },
      { type: 'word', value: 'foo:bar', pos: 13 },
    ]);
  });

  it('marks an operator with a space after it as having no value', () => {
    expect(tokenize('from: x')[0]).toMatchObject({ type: 'op', attached: false });
  });

  it('only treats AROUND followed by a number as AROUND', () => {
    expect(tokenize('AROUND x').map((t) => t.type)).toEqual(['word', 'word']);
    expect(tokenize('or OR').map((t) => t.type)).toEqual(['word', 'or']);
  });

  it('copes with an unterminated phrase, a dash at the end, and empty input', () => {
    expect(tokenize('"abc')).toEqual([{ type: 'phrase', value: 'abc', pos: 0 }]);
    expect(tokenize('a -').map((t) => t.type)).toEqual(['word', 'word']);
    expect(tokenize('')).toEqual([]);
    expect(tokenize(undefined)).toEqual([]);
  });
});

describe('parse', () => {
  it('gives OR a tighter binding than the implicit AND', () => {
    expect(parse('a b OR c')).toEqual({
      type: 'and',
      items: [
        { type: 'term', value: 'a', quoted: false },
        {
          type: 'or',
          items: [
            { type: 'term', value: 'b', quoted: false },
            { type: 'term', value: 'c', quoted: false },
          ],
        },
      ],
    });
  });

  it('parses operator values: words, groups, phrases and braces', () => {
    expect(parse('from:a')).toEqual({ type: 'op', name: 'from', value: 'a' });
    expect(parse('subject:"x y"')).toEqual({
      type: 'op',
      name: 'subject',
      value: { type: 'term', value: 'x y', quoted: true },
    });
    const grouped = parse('from:(a OR b)');
    expect(grouped).toMatchObject({ type: 'op', name: 'from', value: { type: 'group' } });
    expect(parse('to:{a b}')).toMatchObject({
      type: 'op',
      value: { type: 'or', braces: true },
    });
  });

  it('lower-cases operator names', () => {
    expect(parse('FROM:Bob')).toEqual({ type: 'op', name: 'from', value: 'Bob' });
  });

  it('parses negation, groups and braces', () => {
    expect(parse('-a')).toEqual({ type: 'not', item: { type: 'term', value: 'a', quoted: false } });
    expect(parse('-(a b)')).toMatchObject({ type: 'not', item: { type: 'group' } });
    expect(parse('{a b OR c}')).toEqual({
      type: 'or',
      braces: true,
      items: ['a', 'b', 'c'].map((value) => ({ type: 'term', value, quoted: false })),
    });
    expect(parse('-')).toEqual({ type: 'term', value: '-', quoted: false });
    expect(parse('-)')).toEqual({ type: 'term', value: '-', quoted: false });
  });

  it('parses AROUND', () => {
    expect(parse('a AROUND 5 "b c"')).toEqual({
      type: 'around',
      distance: 5,
      items: [
        { type: 'term', value: 'a', quoted: false },
        { type: 'term', value: 'b c', quoted: true },
      ],
    });
    expect(parse('AROUND 5')).toEqual({ type: 'term', value: 'AROUND 5', quoted: false });
  });

  it('never throws on broken input', () => {
    for (const q of ['(((', ')))', '{{', '}}', 'OR OR', '| a |', '"', '-(', 'from:(', 'AND']) {
      expect(() => parse(q)).not.toThrow();
    }
    expect(parse('')).toEqual({ type: 'and', items: [] });
    expect(parse('from:(')).toEqual({
      type: 'op',
      name: 'from',
      value: { type: 'group', item: { type: 'and', items: [] } },
    });
  });
});

describe('serialize', () => {
  it.each(QUERIES)('round-trips %s', (q) => {
    const tree = parse(q);
    const text = serialize(tree);
    expect(parse(text)).toEqual(tree);
    expect(serialize(parse(text))).toBe(text);
    expect(normaliseQuery(text)).toBe(normaliseQuery(q));
    for (const m of CORPUS_MSGS) expect(matchesQuery(text, m)).toBe(matchesQuery(q, m));
  });

  it('has a corpus of at least 40 queries', () => {
    expect(QUERIES.length).toBeGreaterThanOrEqual(40);
  });

  it('adds brackets where a built tree needs them', () => {
    const t = (value) => ({ type: 'term', value, quoted: false });
    const and = { type: 'and', items: [t('a'), t('b')] };
    expect(serialize({ type: 'or', items: [and, t('c')] })).toBe('(a b) OR c');
    expect(serialize({ type: 'not', item: and })).toBe('-(a b)');
    expect(serialize({ type: 'not', item: t('-') })).toBe('-(-)');
    expect(serialize({ type: 'and', items: [t('x'), and] })).toBe('x (a b)');
    expect(serialize({ type: 'op', name: 'from', value: and })).toBe('from:(a b)');
    expect(serialize({ type: 'op', name: 'from', value: t('a') })).toBe('from:a');
    expect(serialize({ type: 'op', name: 'from', value: 'a b' })).toBe('from:"a b"');
    expect(serialize({ type: 'or', items: [] })).toBe('');
    expect(serialize({ type: 'or', items: [and, t('c')], braces: true })).toBe('{(a b) c}');
    expect(
      serialize({
        type: 'around',
        distance: 2,
        items: [{ type: 'or', items: [t('a'), t('b')] }, and],
      }),
    ).toBe('(a OR b) AROUND 2 (a b)');
    expect(serialize(null)).toBe('');
  });

  it('quotes plain values that would otherwise change meaning', () => {
    const t = (value) => ({ type: 'term', value, quoted: false });
    expect(serialize(t('a b'))).toBe('"a b"');
    expect(serialize(t('OR'))).toBe('"OR"');
    expect(serialize(t('-x'))).toBe('"-x"');
    expect(serialize(t('from:x'))).toBe('"from:x"');
    expect(serialize(t('http://x'))).toBe('http://x');
    expect(serialize({ type: 'term', value: 'a"b', quoted: true })).toBe('"ab"');
  });
});

describe('canonicalize and normaliseQuery', () => {
  it('ignores case, spaces, brackets and OR order', () => {
    expect(normaliseQuery('FROM:(B@X.com OR a@y.com)')).toBe(
      normaliseQuery('from:{a@y.com   b@x.com}'),
    );
    expect(normaliseQuery('a  b')).toBe(normaliseQuery('(b) a'));
    expect(normaliseQuery('"Invoice"')).toBe(normaliseQuery('invoice'));
    expect(normaliseQuery('--a')).toBe('a');
    expect(normaliseQuery('a a')).toBe('a');
    expect(normaliseQuery('(a OR b) OR c')).toBe('a OR b OR c');
    expect(normaliseQuery(undefined)).toBe('');
  });

  it('keeps different queries different', () => {
    expect(normaliseQuery('a b')).not.toBe(normaliseQuery('a OR b'));
    expect(normaliseQuery('subject:"a b"')).not.toBe(normaliseQuery('subject:(a b)'));
  });

  it('handles AROUND and operator values', () => {
    expect(canonicalize(parse('A AROUND 2 B'))).toEqual({
      type: 'around',
      distance: 2,
      items: [
        { type: 'term', value: 'a', quoted: false },
        { type: 'term', value: 'b', quoted: false },
      ],
    });
    expect(canonicalize(parse('from:("Ann")'))).toEqual({ type: 'op', name: 'from', value: 'ann' });
  });
});

describe('walk', () => {
  it('visits operator values and nested nodes', () => {
    const seen = [];
    walk(parse('from:(a OR b) -(c AROUND 1 d)'), (n) => seen.push(n.type));
    expect(seen).toEqual([
      'and',
      'op',
      'group',
      'or',
      'term',
      'term',
      'not',
      'group',
      'around',
      'term',
      'term',
    ]);
    expect(() => walk(null, () => {})).not.toThrow();
  });
});

describe('findUnsafeOperators', () => {
  it('lists operators that never match new mail', () => {
    expect(
      findUnsafeOperators(
        'label:x in:inbox is:unread older_than:1y newer_than:2d after:a before:b',
      ),
    ).toEqual(['label', 'in', 'is', 'older_than', 'newer_than', 'after', 'before']);
    expect(
      findUnsafeOperators('older:a newer:b has:userlabels has:nouserlabels has:yellow-star'),
    ).toEqual(['older', 'newer', 'has:userlabels', 'has:nouserlabels', 'has:yellow-star']);
    expect(findUnsafeOperators('-(label:a OR label:b) has:"red-bang"')).toEqual([
      'label',
      'has:red-bang',
    ]);
  });

  it('accepts operators that work in filters', () => {
    expect(findUnsafeOperators('from:a has:attachment list:x category:social larger:5M')).toEqual(
      [],
    );
    expect(findUnsafeOperators('has:(attachment)')).toEqual([]);
  });
});

describe('orJoin', () => {
  it('joins with OR and adds brackets only where needed', () => {
    expect(orJoin(['a', 'b OR c', 'd e', '', '  '])).toBe('a OR b OR c OR (d e)');
    expect(orJoin(['only'])).toBe('only');
    expect(orJoin([])).toBe('');
    expect(orJoin(['-a', '{b c}'])).toBe('-a OR {b c}');
  });

  it('keeps the meaning', () => {
    const parts = ['from:ann@shop.co.uk invoice', 'order OR sale', '-hello'];
    const joined = orJoin(parts);
    for (const m of MSGS) {
      expect(matchesQuery(joined, m)).toBe(parts.some((p) => matchesQuery(p, m)));
    }
  });
});

describe('OPERATORS', () => {
  it('has every operator with a description, example and flag', () => {
    const names = OPERATORS.map((o) => o.name);
    for (const n of [
      'from',
      'to',
      'cc',
      'bcc',
      'subject',
      'label',
      'has:attachment',
      'has:drive',
      'has:document',
      'has:spreadsheet',
      'has:presentation',
      'has:youtube',
      'list',
      'filename',
      'in',
      'is',
      'after',
      'before',
      'older',
      'newer',
      'older_than',
      'newer_than',
      'size',
      'larger',
      'smaller',
      'deliveredto',
      'category',
      'rfc822msgid',
      'has:userlabels',
      'has:nouserlabels',
      'has:yellow-star',
      'AROUND',
      'OR',
    ]) {
      expect(names).toContain(n);
    }
    for (const o of OPERATORS) {
      expect(o.description).toMatch(/^[A-Z].*\.$/);
      expect(typeof o.filterSafe).toBe('boolean');
      expect(o.example.length).toBeGreaterThan(0);
    }
  });

  it('flags the same operators as unsafe as findUnsafeOperators', () => {
    for (const o of OPERATORS) {
      if (!/^[a-z_]+(:[a-z-]+)?$/.test(o.name)) continue;
      const found = findUnsafeOperators(o.example);
      expect(found.length > 0, o.name).toBe(!o.filterSafe);
    }
  });
});
