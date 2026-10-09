// A tiny, test-only model of Gmail matching. It is not Gmail: it only needs to be consistent,
// so that we can prove two queries match the same fake messages.
import { parse as parseRaw } from '../../../site/app/js/core/query.js';

const cache = new Map();
/** Parses once per string. Trees are not changed by the matcher, so sharing them is safe. */
function parse(q) {
  let t = cache.get(q);
  if (!t) {
    t = parseRaw(q);
    cache.set(q, t);
  }
  return t;
}

/** @typedef {{from: string, to: string, subject: string, body: string, hasAttachment: boolean}} FakeMessage */

const FIELDS = { from: 'from', to: 'to', cc: 'to', subject: 'subject', deliveredto: 'to' };

/**
 * @param {FakeMessage} msg
 * @param {string|null} field
 */
function haystack(msg, field) {
  if (field) return msg[field].toLowerCase();
  return `${msg.from} ${msg.to} ${msg.subject} ${msg.body}`.toLowerCase();
}

/**
 * @param {any} node
 * @param {FakeMessage} msg
 * @param {string|null} [field]
 * @returns {boolean}
 */
export function evalNode(node, msg, field = null) {
  switch (node.type) {
    case 'term':
      return node.value === '' ? true : haystack(msg, field).includes(node.value.toLowerCase());
    case 'group':
      return evalNode(node.item, msg, field);
    case 'and':
      return node.items.every((i) => evalNode(i, msg, field));
    case 'or':
      return node.items.some((i) => evalNode(i, msg, field));
    case 'not':
      return !evalNode(node.item, msg, field);
    case 'around':
      return node.items.every((i) => evalNode(i, msg, field));
    case 'op': {
      if (node.name === 'has') {
        const v = typeof node.value === 'string' ? node.value : node.value.value;
        return v === 'attachment' ? msg.hasAttachment : false;
      }
      const f = FIELDS[node.name];
      if (!f) return false;
      if (typeof node.value === 'string') {
        return node.value === '' ? true : msg[f].toLowerCase().includes(node.value.toLowerCase());
      }
      return evalNode(node.value, msg, f);
    }
    default:
      throw new Error(`Unknown node ${node.type}`);
  }
}

/**
 * @param {string} q
 * @param {FakeMessage} msg
 */
export function matchesQuery(q, msg) {
  return evalNode(parse(q), msg);
}

/**
 * Evaluates filter criteria the way Gmail combines the fields: all fields must match.
 * @param {import('../../../site/app/js/types.js').FilterCriteria} c
 * @param {FakeMessage} msg
 */
export function matchesCriteria(c, msg) {
  if (c.from && !evalNode(parse(c.from), msg, 'from')) return false;
  if (c.to && !evalNode(parse(c.to), msg, 'to')) return false;
  if (c.subject && !evalNode(parse(c.subject), msg, 'subject')) return false;
  if (c.query && !evalNode(parse(c.query), msg)) return false;
  if (c.negatedQuery && evalNode(parse(`{${c.negatedQuery}}`), msg)) return false;
  if (c.hasAttachment && !msg.hasAttachment) return false;
  return true;
}

/**
 * A small seeded random number generator (mulberry32).
 * @param {number} seed
 */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @template T
 * @param {() => number} rand
 * @param {T[]} list
 * @returns {T}
 */
export function pick(rand, list) {
  return list[Math.floor(rand() * list.length)];
}

export const SENDERS = [
  'ann@shop.co.uk',
  'bob@bank.com',
  'cat@shop.co.uk',
  'news@club.org',
  'dan@mail.net',
];
export const RECIPIENTS = ['me@home.uk', 'team@work.com', 'me+shop@home.uk'];
export const WORDS = ['invoice', 'receipt', 'order', 'hello', 'parcel', 'sale', 'code', 'meeting'];

/**
 * @param {() => number} rand
 * @returns {FakeMessage}
 */
export function randomMessage(rand) {
  const words = () =>
    Array.from({ length: 1 + Math.floor(rand() * 3) }, () => pick(rand, WORDS)).join(' ');
  return {
    from: pick(rand, SENDERS),
    to: pick(rand, RECIPIENTS),
    subject: words(),
    body: words(),
    hasAttachment: rand() < 0.3,
  };
}

/**
 * Every combination is too many, so this makes a good spread of messages.
 * @param {number} n
 * @param {number} [seed]
 */
export function messages(n, seed = 1) {
  const rand = rng(seed);
  return Array.from({ length: n }, () => randomMessage(rand));
}
