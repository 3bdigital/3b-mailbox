// @ts-check
// Gmail search syntax: tokenizer, parser and serialiser.
//
// Precedence, from tightest to loosest (this matches Gmail):
//   operator value  >  - (not)  >  AROUND n  >  OR / |  >  implicit AND (space)
// So "a b OR c" means "a AND (b OR c)".

/**
 * @typedef {'lparen'|'rparen'|'lbrace'|'rbrace'|'or'|'and'|'not'|'around'|'op'|'phrase'|'word'} TokenType
 */

/**
 * @typedef {object} Token
 * @property {TokenType} type
 * @property {string} value     For 'op': the operator name in lower case. For 'around': the distance.
 * @property {number} pos       Index in the source string.
 * @property {boolean} [attached] For 'op': a bracket, brace or quote follows with no space.
 */

/**
 * @typedef {{type: 'and', items: Node[]}} AndNode
 * @typedef {{type: 'or', items: Node[], braces?: boolean}} OrNode
 * @typedef {{type: 'not', item: Node}} NotNode
 * @typedef {{type: 'term', value: string, quoted: boolean}} TermNode
 * @typedef {{type: 'op', name: string, value: Node|string}} OpNode
 * @typedef {{type: 'group', item: Node}} GroupNode
 * @typedef {{type: 'around', items: [Node, Node], distance: number}} AroundNode
 * @typedef {AndNode|OrNode|NotNode|TermNode|OpNode|GroupNode|AroundNode} Node
 */

/**
 * @typedef {object} OperatorInfo
 * @property {string} name          For example 'from' or 'has:attachment'.
 * @property {string} description   Plain English.
 * @property {string} example
 * @property {boolean} filterSafe   False when the operator never matches incoming mail in a filter.
 */

const STAR_TYPES = [
  'yellow-star',
  'orange-star',
  'red-star',
  'purple-star',
  'blue-star',
  'green-star',
  'red-bang',
  'orange-guillemet',
  'yellow-bang',
  'green-check',
  'blue-info',
  'purple-question',
];

/** @type {OperatorInfo[]} */
export const OPERATORS = [
  {
    name: 'from',
    description: 'The sender.',
    example: 'from:amazon.co.uk',
    filterSafe: true,
  },
  {
    name: 'to',
    description: 'A recipient in the To field.',
    example: 'to:me@example.com',
    filterSafe: true,
  },
  {
    name: 'cc',
    description: 'A recipient in the Cc field.',
    example: 'cc:team@example.com',
    filterSafe: true,
  },
  {
    name: 'bcc',
    description: 'A recipient in the Bcc field. This only works for mail that you send.',
    example: 'bcc:boss@example.com',
    filterSafe: true,
  },
  {
    name: 'subject',
    description: 'Words in the subject line.',
    example: 'subject:"order confirmation"',
    filterSafe: true,
  },
  {
    name: 'deliveredto',
    description: 'The address that the mail was delivered to. Useful for aliases.',
    example: 'deliveredto:me+shop@gmail.com',
    filterSafe: true,
  },
  {
    name: 'list',
    description: 'Mail from a mailing list.',
    example: 'list:info@example.com',
    filterSafe: true,
  },
  {
    name: 'filename',
    description: 'The name or type of an attachment.',
    example: 'filename:pdf',
    filterSafe: true,
  },
  {
    name: 'has:attachment',
    description: 'Mail with an attachment.',
    example: 'has:attachment',
    filterSafe: true,
  },
  {
    name: 'has:drive',
    description: 'Mail with a Google Drive file attached.',
    example: 'has:drive',
    filterSafe: true,
  },
  {
    name: 'has:document',
    description: 'Mail with a Google Docs file attached.',
    example: 'has:document',
    filterSafe: true,
  },
  {
    name: 'has:spreadsheet',
    description: 'Mail with a Google Sheets file attached.',
    example: 'has:spreadsheet',
    filterSafe: true,
  },
  {
    name: 'has:presentation',
    description: 'Mail with a Google Slides file attached.',
    example: 'has:presentation',
    filterSafe: true,
  },
  {
    name: 'has:youtube',
    description: 'Mail with a YouTube video.',
    example: 'has:youtube',
    filterSafe: true,
  },
  {
    name: 'size',
    description: 'Mail larger than a size in bytes.',
    example: 'size:1000000',
    filterSafe: true,
  },
  {
    name: 'larger',
    description: 'Mail larger than a size. Use K or M for kilobytes or megabytes.',
    example: 'larger:10M',
    filterSafe: true,
  },
  {
    name: 'smaller',
    description: 'Mail smaller than a size. Use K or M for kilobytes or megabytes.',
    example: 'smaller:100K',
    filterSafe: true,
  },
  {
    name: 'category',
    description:
      'Mail in an inbox category: primary, social, promotions, updates, forums or reservations.',
    example: 'category:promotions',
    filterSafe: true,
  },
  {
    name: 'rfc822msgid',
    description: 'One message, found by its Message-ID header.',
    example: 'rfc822msgid:200503292@example.com',
    filterSafe: true,
  },
  {
    name: 'label',
    description:
      'Mail with a label. New mail has no labels yet, so this does not work in a filter.',
    example: 'label:receipts',
    filterSafe: false,
  },
  {
    name: 'in',
    description:
      'Mail in a place, such as in:inbox, in:spam or in:anywhere. This does not work in a filter.',
    example: 'in:inbox',
    filterSafe: false,
  },
  {
    name: 'is',
    description:
      'Mail with a state, such as is:unread or is:starred. This does not work in a filter.',
    example: 'is:unread',
    filterSafe: false,
  },
  {
    name: 'has:userlabels',
    description: 'Mail that has a label of yours. This does not work in a filter.',
    example: 'has:userlabels',
    filterSafe: false,
  },
  {
    name: 'has:nouserlabels',
    description: 'Mail that has none of your labels. This does not work in a filter.',
    example: 'has:nouserlabels',
    filterSafe: false,
  },
  ...STAR_TYPES.map((star) => ({
    name: `has:${star}`,
    description: `Mail with the ${star.replace('-', ' ')} star. This does not work in a filter.`,
    example: `has:${star}`,
    filterSafe: false,
  })),
  {
    name: 'after',
    description: 'Mail sent after a date. This does not work in a filter.',
    example: 'after:2025/01/31',
    filterSafe: false,
  },
  {
    name: 'before',
    description: 'Mail sent before a date. This does not work in a filter.',
    example: 'before:2025/01/31',
    filterSafe: false,
  },
  {
    name: 'older',
    description: 'Mail sent before a date. This does not work in a filter.',
    example: 'older:2025/01/31',
    filterSafe: false,
  },
  {
    name: 'newer',
    description: 'Mail sent after a date. This does not work in a filter.',
    example: 'newer:2025/01/31',
    filterSafe: false,
  },
  {
    name: 'older_than',
    description: 'Mail older than a time, such as 2d, 3m or 1y. This does not work in a filter.',
    example: 'older_than:1y',
    filterSafe: false,
  },
  {
    name: 'newer_than',
    description: 'Mail newer than a time, such as 2d, 3m or 1y. This does not work in a filter.',
    example: 'newer_than:7d',
    filterSafe: false,
  },
  {
    name: 'OR',
    description: 'Either word or search. You can also use |.',
    example: 'from:amazon.co.uk OR from:ebay.co.uk',
    filterSafe: true,
  },
  {
    name: '{ }',
    description: 'Any of the words or searches in the braces.',
    example: '{invoice receipt}',
    filterSafe: true,
  },
  {
    name: '-',
    description: 'Leave out mail that matches the word or search.',
    example: '-unsubscribe',
    filterSafe: true,
  },
  {
    name: '( )',
    description: 'Groups words or searches together.',
    example: 'subject:(invoice receipt)',
    filterSafe: true,
  },
  {
    name: '" "',
    description: 'An exact phrase.',
    example: '"order confirmation"',
    filterSafe: true,
  },
  {
    name: 'AROUND',
    description: 'Two words near each other. The number is the most words between them.',
    example: 'invoice AROUND 5 overdue',
    filterSafe: true,
  },
];

/** Operator names that the tokenizer knows (the part before the colon). */
const OP_NAMES = new Set(
  OPERATORS.filter((o) => /^[a-z_0-9]+(:|$)/.test(o.name) && o.name !== 'OR').map(
    (o) => o.name.split(':')[0],
  ),
);

/** Operators (name only) that never match incoming mail. */
const UNSAFE_NAMES = new Set([
  'label',
  'in',
  'is',
  'after',
  'before',
  'older',
  'newer',
  'older_than',
  'newer_than',
]);

/** has: values that never match incoming mail. */
const UNSAFE_HAS = new Set(['userlabels', 'nouserlabels', ...STAR_TYPES]);

const BREAK = /[\s(){}"|]/;

/**
 * Splits a Gmail search string into tokens.
 * @param {string} q
 * @returns {Token[]}
 */
export function tokenize(q) {
  const s = String(q ?? '');
  /** @type {Token[]} */
  const tokens = [];
  const n = s.length;
  let i = 0;
  while (i < n) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const pos = i;
    if (c === '(' || c === ')' || c === '{' || c === '}' || c === '|') {
      /** @type {Record<string, TokenType>} */
      const map = { '(': 'lparen', ')': 'rparen', '{': 'lbrace', '}': 'rbrace', '|': 'or' };
      tokens.push({ type: map[c], value: c, pos });
      i++;
      continue;
    }
    if (c === '"') {
      const end = s.indexOf('"', i + 1);
      const stop = end === -1 ? n : end;
      tokens.push({ type: 'phrase', value: s.slice(i + 1, stop), pos });
      i = end === -1 ? n : end + 1;
      continue;
    }
    if (c === '-' && i + 1 < n && !/\s/.test(s[i + 1])) {
      tokens.push({ type: 'not', value: '-', pos });
      i++;
      continue;
    }
    while (i < n && !BREAK.test(s[i])) i++;
    const word = s.slice(pos, i);
    if (word === 'OR') {
      tokens.push({ type: 'or', value: word, pos });
      continue;
    }
    if (word === 'AND') {
      tokens.push({ type: 'and', value: word, pos });
      continue;
    }
    if (word === 'AROUND') {
      const m = /^\s+(\d+)(?=[\s(){}"|]|$)/.exec(s.slice(i));
      if (m) {
        tokens.push({ type: 'around', value: m[1], pos });
        i += m[0].length;
        continue;
      }
    }
    const op = /^([A-Za-z_]+):/.exec(word);
    if (op && OP_NAMES.has(op[1].toLowerCase())) {
      const rest = word.slice(op[0].length);
      const attached = rest === '' && i < n && (s[i] === '(' || s[i] === '{' || s[i] === '"');
      tokens.push({
        type: 'op',
        value: op[1].toLowerCase(),
        pos,
        attached: rest !== '' || attached,
      });
      if (rest !== '') tokens.push({ type: 'word', value: rest, pos: pos + op[0].length });
      continue;
    }
    tokens.push({ type: 'word', value: word, pos });
  }
  return tokens;
}

/**
 * Parses a Gmail search string into a tree. It never throws: stray brackets are ignored.
 * @param {string} q
 * @returns {Node}
 */
export function parse(q) {
  const tokens = tokenize(q);
  let p = 0;

  /** @param {'rparen'|'rbrace'|null} stop */
  function parseList(stop) {
    /** @type {Node[]} */
    const items = [];
    while (p < tokens.length) {
      const t = tokens[p];
      if (t.type === stop) break;
      if (t.type === 'rparen' || t.type === 'rbrace' || t.type === 'and' || t.type === 'or') {
        p++;
        continue;
      }
      const node = parseOr();
      /* c8 ignore next */
      if (node) items.push(node);
      else p++;
    }
    return items;
  }

  /** @returns {Node|null} */
  function parseOr() {
    const first = parseAround();
    if (!first) return null;
    /** @type {Node[]} */
    const items = [first];
    while (tokens[p]?.type === 'or') {
      const save = p;
      p++;
      const next = parseAround();
      if (!next) {
        p = save + 1;
        break;
      }
      items.push(next);
    }
    return items.length === 1 ? first : { type: 'or', items };
  }

  /** @returns {Node|null} */
  function parseAround() {
    let left = parseUnary();
    if (!left) return null;
    while (tokens[p]?.type === 'around') {
      const distance = Number(tokens[p].value);
      p++;
      const right = parseUnary();
      if (!right) {
        p--;
        break;
      }
      left = { type: 'around', items: [left, right], distance };
    }
    return left;
  }

  /** @returns {Node|null} */
  function parseUnary() {
    const t = tokens[p];
    if (!t) return null;
    if (t.type === 'not') {
      p++;
      const item = parseUnary();
      return item ? { type: 'not', item } : { type: 'term', value: '-', quoted: false };
    }
    return parsePrimary();
  }

  /** @returns {Node|null} */
  function parsePrimary() {
    const t = tokens[p];
    if (!t) return null;
    switch (t.type) {
      case 'lparen': {
        p++;
        const items = parseList('rparen');
        if (tokens[p]?.type === 'rparen') p++;
        return { type: 'group', item: items.length === 1 ? items[0] : { type: 'and', items } };
      }
      case 'lbrace': {
        p++;
        const raw = parseList('rbrace');
        if (tokens[p]?.type === 'rbrace') p++;
        /** @type {Node[]} */
        const items = [];
        for (const item of raw) {
          if (item.type === 'or' && !item.braces) items.push(...item.items);
          else items.push(item);
        }
        return { type: 'or', items, braces: true };
      }
      case 'phrase':
        p++;
        return { type: 'term', value: t.value, quoted: true };
      case 'word':
        p++;
        return { type: 'term', value: t.value, quoted: false };
      case 'around':
        // AROUND with nothing on its left: keep it as plain text.
        p++;
        return { type: 'term', value: `AROUND ${t.value}`, quoted: false };
      case 'op': {
        p++;
        if (!t.attached) return { type: 'op', name: t.value, value: '' };
        const v = parsePrimary();
        /* c8 ignore next */
        if (!v) return { type: 'op', name: t.value, value: '' };
        return { type: 'op', name: t.value, value: v.type === 'term' && !v.quoted ? v.value : v };
      }
      default:
        return null;
    }
  }

  const items = parseList(null);
  return items.length === 1 ? items[0] : { type: 'and', items };
}

/**
 * True when a plain value must be quoted to stay one term.
 * @param {string} value
 */
function needsQuote(value) {
  if (value === '' || value === 'OR' || value === 'AND' || value.startsWith('-')) return true;
  if (/[\s(){}"|]/.test(value)) return true;
  const op = /^([A-Za-z_]+):/.exec(value);
  return Boolean(op && OP_NAMES.has(op[1].toLowerCase()));
}

/**
 * @param {Node} node
 * @param {(n: Node) => boolean} wrapIf
 */
function wrapped(node, wrapIf) {
  const s = serialize(node);
  return wrapIf(node) ? `(${s})` : s;
}

/** @param {Node} n */
const isAndLike = (n) => n.type === 'and' && n.items.length > 1;
/** @param {Node} n */
const isLoose = (n) =>
  isAndLike(n) || (n.type === 'or' && !n.braces && n.items.length > 1) || n.type === 'around';

/**
 * Turns a tree back into a Gmail search string. Adds brackets where they are needed to keep the meaning.
 * @param {Node} node
 * @returns {string}
 */
export function serialize(node) {
  if (!node) return '';
  switch (node.type) {
    case 'term': {
      if (node.quoted) return `"${node.value.replace(/"/g, '')}"`;
      if (node.value === '-' || /^AROUND \d+$/.test(node.value)) return node.value;
      return needsQuote(node.value) ? `"${node.value.replace(/"/g, '')}"` : node.value;
    }
    case 'group':
      return `(${serialize(node.item)})`;
    case 'and':
      return node.items
        .map((i) => wrapped(i, isAndLike))
        .filter((s) => s !== '')
        .join(' ');
    case 'or': {
      if (node.braces) return `{${node.items.map((i) => wrapped(i, isAndLike)).join(' ')}}`;
      if (node.items.length === 0) return '';
      return node.items.map((i) => wrapped(i, isAndLike)).join(' OR ');
    }
    case 'not':
      return `-${wrapped(node.item, (n) => isLoose(n) || (n.type === 'term' && !n.quoted && n.value === '-'))}`;
    case 'around': {
      const [a, b] = node.items;
      const left = wrapped(a, (n) => isAndLike(n) || (n.type === 'or' && !n.braces));
      return `${left} AROUND ${node.distance} ${wrapped(b, isLoose)}`;
    }
    case 'op': {
      const v = node.value;
      if (typeof v === 'string') {
        return `${node.name}:${/[\s(){}"|]/.test(v) ? `"${v.replace(/"/g, '')}"` : v}`;
      }
      if (v.type === 'group' || (v.type === 'or' && v.braces) || (v.type === 'term' && v.quoted)) {
        return `${node.name}:${serialize(v)}`;
      }
      if (v.type === 'term') return serialize({ type: 'op', name: node.name, value: v.value });
      return `${node.name}:(${serialize(v)})`;
    }
    /* c8 ignore next 2 */
    default:
      return '';
  }
}

/**
 * Calls fn for every node in the tree, including operator values.
 * @param {Node} node
 * @param {(n: Node) => void} fn
 */
export function walk(node, fn) {
  if (!node) return;
  fn(node);
  switch (node.type) {
    case 'and':
    case 'or':
    case 'around':
      for (const i of node.items) walk(i, fn);
      break;
    case 'not':
    case 'group':
      walk(node.item, fn);
      break;
    case 'op':
      if (typeof node.value !== 'string') walk(node.value, fn);
      break;
  }
}

/**
 * The string value of an operator node, or '' when the value is a tree.
 * @param {OpNode} node
 */
function opText(node) {
  if (typeof node.value === 'string') return node.value;
  if (node.value.type === 'term') return node.value.value;
  return '';
}

/**
 * Lists the operators in a query that never match incoming mail in a filter, for example 'label' or 'is'.
 * Names match OPERATORS entries.
 * @param {string} q
 * @returns {string[]}
 */
export function findUnsafeOperators(q) {
  /** @type {string[]} */
  const found = [];
  walk(parse(q), (n) => {
    if (n.type !== 'op') return;
    let name = '';
    if (UNSAFE_NAMES.has(n.name)) name = n.name;
    else if (n.name === 'has' && UNSAFE_HAS.has(opText(n).toLowerCase())) {
      name = `has:${opText(n).toLowerCase()}`;
    }
    if (name && !found.includes(name)) found.push(name);
  });
  return found;
}

/**
 * Joins sub-queries with OR. Adds brackets only where a part would change meaning without them.
 * @param {string[]} parts
 * @returns {string}
 */
export function orJoin(parts) {
  const clean = parts.map((p) => String(p ?? '').trim()).filter(Boolean);
  if (clean.length <= 1) return clean[0] ?? '';
  return clean.map((p) => (isAndLike(parse(p)) ? `(${p})` : p)).join(' OR ');
}

/**
 * Compares two strings by code unit, for a stable sort.
 * @param {string} a
 * @param {string} b
 */
function cmp(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Returns a canonical tree: lower case, no redundant brackets, AND and OR items sorted and de-duplicated.
 * Two queries with the same canonical form match the same mail.
 * @param {Node} node
 * @returns {Node}
 */
export function canonicalize(node) {
  switch (node.type) {
    case 'term':
      return { type: 'term', value: node.value.toLowerCase(), quoted: false };
    case 'group':
      return canonicalize(node.item);
    case 'not': {
      const item = canonicalize(node.item);
      return item.type === 'not' ? item.item : { type: 'not', item };
    }
    case 'around':
      return {
        type: 'around',
        items: [canonicalize(node.items[0]), canonicalize(node.items[1])],
        distance: node.distance,
      };
    case 'op': {
      if (typeof node.value === 'string') {
        return { type: 'op', name: node.name, value: node.value.toLowerCase() };
      }
      const v = canonicalize(node.value);
      if (v.type === 'term') return { type: 'op', name: node.name, value: v.value };
      return { type: 'op', name: node.name, value: v };
    }
    case 'and':
    case 'or': {
      /** @type {Node[]} */
      const flat = [];
      for (const raw of node.items) {
        const c = canonicalize(raw);
        if (c.type === node.type) flat.push(...c.items);
        else flat.push(c);
      }
      /** @type {Map<string, Node>} */
      const unique = new Map();
      for (const c of flat) unique.set(serialize(c), c);
      const items = [...unique.keys()].sort(cmp).map((k) => /** @type {Node} */ (unique.get(k)));
      if (items.length === 1) return items[0];
      return node.type === 'and' ? { type: 'and', items } : { type: 'or', items };
    }
    /* c8 ignore next 2 */
    default:
      return node;
  }
}

/**
 * A canonical string for a query. Equal strings match the same mail.
 * @param {string} q
 * @returns {string}
 */
export function normaliseQuery(q) {
  return serialize(canonicalize(parse(q ?? '')));
}
