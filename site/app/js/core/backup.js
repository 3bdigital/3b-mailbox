// @ts-check
// Backups: our own JSON format, and Gmail's mailFilters.xml format for import in Gmail settings.

import { toApi, toFriendly } from './actions.js';

/** @typedef {import('../types.js').Filter} Filter */
/** @typedef {import('../types.js').FilterCriteria} FilterCriteria */
/** @typedef {import('../types.js').FilterAction} FilterAction */
/** @typedef {import('../types.js').Label} Label */

export const BACKUP_APP = '3b-mailbox';
export const BACKUP_VERSION = 1;

/** Thrown when a backup file cannot be read. The message is plain English. */
export class BackupError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'BackupError';
  }
}

/**
 * A versioned JSON backup.
 * @param {Filter[]} filters
 * @param {Label[]} labels
 * @param {{now?: Date}} [opts]
 * @returns {string}
 */
export function toJson(filters, labels, opts = {}) {
  const exportedAt = (opts.now ?? new Date()).toISOString();
  return JSON.stringify(
    {
      app: BACKUP_APP,
      version: BACKUP_VERSION,
      exportedAt,
      filters: filters ?? [],
      labels: labels ?? [],
    },
    null,
    2,
  );
}

const STRING_FIELDS = /** @type {const} */ (['from', 'to', 'subject', 'query', 'negatedQuery']);

/**
 * @param {unknown} v
 * @returns {v is Record<string, any>}
 */
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * @param {unknown} raw
 * @param {number} n  1-based position, for the error message.
 * @returns {FilterCriteria}
 */
function readCriteria(raw, n) {
  if (!isObject(raw)) throw new BackupError(`Filter ${n} has no search criteria.`);
  /** @type {FilterCriteria} */
  const c = {};
  for (const k of STRING_FIELDS) {
    if (raw[k] === undefined || raw[k] === null) continue;
    if (typeof raw[k] !== 'string')
      throw new BackupError(`Filter ${n} has a field "${k}" that is not text.`);
    if (raw[k].trim()) c[k] = raw[k];
  }
  for (const k of /** @type {const} */ (['hasAttachment', 'excludeChats'])) {
    if (raw[k] === undefined || raw[k] === null) continue;
    if (typeof raw[k] !== 'boolean')
      throw new BackupError(`Filter ${n} has a field "${k}" that is not true or false.`);
    if (raw[k]) c[k] = true;
  }
  if (raw.size !== undefined && raw.size !== null) {
    if (typeof raw.size !== 'number' || !Number.isFinite(raw.size) || raw.size < 0) {
      throw new BackupError(`Filter ${n} has a size that is not a number.`);
    }
    c.size = raw.size;
  }
  if (raw.sizeComparison !== undefined && raw.sizeComparison !== null) {
    if (!['larger', 'smaller', 'unspecified'].includes(raw.sizeComparison)) {
      throw new BackupError(`Filter ${n} has a size comparison that is not known.`);
    }
    c.sizeComparison = raw.sizeComparison;
  }
  return c;
}

/**
 * @param {unknown} raw
 * @param {number} n
 * @returns {FilterAction}
 */
function readAction(raw, n) {
  if (!isObject(raw)) throw new BackupError(`Filter ${n} has no action.`);
  /** @type {FilterAction} */
  const a = {};
  for (const k of /** @type {const} */ (['addLabelIds', 'removeLabelIds'])) {
    if (raw[k] === undefined || raw[k] === null) continue;
    if (
      !Array.isArray(raw[k]) ||
      raw[k].some((/** @type {unknown} */ id) => typeof id !== 'string')
    ) {
      throw new BackupError(`Filter ${n} has a label list that is not valid.`);
    }
    if (raw[k].length) a[k] = [...raw[k]];
  }
  if (raw.forward !== undefined && raw.forward !== null) {
    if (typeof raw.forward !== 'string')
      throw new BackupError(`Filter ${n} has a forward address that is not text.`);
    if (raw.forward.trim()) a.forward = raw.forward.trim();
  }
  return a;
}

/**
 * Reads and checks a JSON backup.
 * @param {string} text
 * @returns {{filters: Filter[], labels: Label[], exportedAt: string|null}}
 * @throws {BackupError}
 */
export function fromJson(text) {
  /** @type {unknown} */
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new BackupError('This file is not a valid backup. It is not JSON.');
  }
  if (!isObject(data) || data.app !== BACKUP_APP) {
    throw new BackupError('This file is not a 3B Mailbox backup.');
  }
  if (typeof data.version !== 'number' || data.version > BACKUP_VERSION || data.version < 1) {
    throw new BackupError(
      'This backup is from a newer version of 3B Mailbox. Update the app and try again.',
    );
  }
  if (!Array.isArray(data.filters)) throw new BackupError('This backup has no list of filters.');
  const filters = data.filters.map((/** @type {unknown} */ raw, /** @type {number} */ i) => {
    if (!isObject(raw)) throw new BackupError(`Filter ${i + 1} is not valid.`);
    /** @type {Filter} */
    const f = {
      criteria: readCriteria(raw.criteria, i + 1),
      action: readAction(raw.action, i + 1),
    };
    if (typeof raw.id === 'string' && raw.id) f.id = raw.id;
    return f;
  });
  const rawLabels = data.labels ?? [];
  if (!Array.isArray(rawLabels))
    throw new BackupError('This backup has a list of labels that is not valid.');
  /** @type {Label[]} */
  const labels = rawLabels.map((/** @type {unknown} */ raw, /** @type {number} */ i) => {
    if (!isObject(raw) || typeof raw.id !== 'string' || typeof raw.name !== 'string') {
      throw new BackupError(`Label ${i + 1} is not valid.`);
    }
    return /** @type {Label} */ ({ ...raw, type: raw.type === 'system' ? 'system' : 'user' });
  });
  return {
    filters,
    labels,
    exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt : null,
  };
}

/**
 * Escapes text for an XML attribute in single or double quotes.
 * @param {string} s
 * @returns {string}
 */
export function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&apos;')
    .replace(/"/g, '&quot;')
    .split('')
    .filter((ch) => {
      // XML 1.0 does not allow control characters other than tab, line feed and carriage return.
      const code = ch.charCodeAt(0);
      return code >= 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
    })
    .join('');
}

/** Gmail's smart label names for each category, as used in mailFilters.xml. */
export const SMART_LABELS = Object.freeze({
  CATEGORY_PERSONAL: '^smartlabel_personal',
  CATEGORY_SOCIAL: '^smartlabel_social',
  CATEGORY_PROMOTIONS: '^smartlabel_promo',
  CATEGORY_UPDATES: '^smartlabel_notification',
  CATEGORY_FORUMS: '^smartlabel_group',
});

/**
 * The apps:property pairs for the criteria part of an entry.
 * @param {FilterCriteria} c
 * @returns {Array<[string, string]>}
 */
function criteriaProps(c) {
  /** @type {Array<[string, string]>} */
  const props = [];
  /** @param {string} name @param {string|undefined} v */
  const str = (name, v) => {
    if (v && v.trim()) props.push([name, v.trim()]);
  };
  str('from', c.from);
  str('to', c.to);
  str('subject', c.subject);
  str('hasTheWord', c.query);
  str('doesNotHaveTheWord', c.negatedQuery);
  if (c.hasAttachment) props.push(['hasAttachment', 'true']);
  if (c.excludeChats) props.push(['excludeChats', 'true']);
  if (c.size > 0 && (c.sizeComparison === 'larger' || c.sizeComparison === 'smaller')) {
    props.push(['size', String(Math.round(c.size))]);
    props.push(['sizeOperator', c.sizeComparison === 'larger' ? 's_sl' : 's_ss']);
    props.push(['sizeUnit', 's_sb']);
  }
  return props;
}

/**
 * Gmail's mailFilters.xml format (an Atom feed), for "Import filters" in Gmail settings.
 * Gmail allows one label property per entry, so a filter with several labels becomes several entries
 * with the same criteria: the first entry has every other action, the rest add one more label each.
 * Label IDs are written as label names; an unknown ID is written as it is. Unknown system label IDs
 * (otherAdd / otherRemove) have no XML property and are left out.
 * Gmail import adds filters. It does not replace or delete the filters you have.
 * @param {Filter[]} filters
 * @param {Map<string, Label>} labelsById
 * @param {{now?: Date, author?: {name?: string, email?: string}}} [opts]
 * @returns {string}
 */
export function toGmailXml(filters, labelsById, opts = {}) {
  const updated = (opts.now ?? new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z');
  /** @param {string} id */
  const nameOf = (id) => labelsById?.get(id)?.name ?? (id.startsWith('new:') ? id.slice(4) : id);
  /** @type {string[]} */
  const entries = [];
  /** @type {string[]} */
  const ids = [];
  (filters ?? []).forEach((filter, index) => {
    const base = criteriaProps(filter.criteria ?? {});
    const f = toFriendly(filter.action ?? {});
    /** @type {Array<[string, string]>} */
    const actions = [];
    if (f.archive) actions.push(['shouldArchive', 'true']);
    if (f.markRead) actions.push(['shouldMarkAsRead', 'true']);
    if (f.star) actions.push(['shouldStar', 'true']);
    if (f.trash) actions.push(['shouldTrash', 'true']);
    if (f.neverSpam) actions.push(['shouldNeverSpam', 'true']);
    if (f.important === 'always') actions.push(['shouldAlwaysMarkAsImportant', 'true']);
    if (f.important === 'never') actions.push(['shouldNeverMarkAsImportant', 'true']);
    if (f.category) actions.push(['smartLabelToApply', SMART_LABELS[f.category]]);
    if (f.forward) actions.push(['forwardTo', f.forward]);
    const labelNames = f.labelIds.map(nameOf);
    /** @type {Array<Array<[string, string]>>} */
    const sets = [];
    if (labelNames.length === 0) sets.push([...base, ...actions]);
    labelNames.forEach((name, i) => {
      sets.push([...base, ['label', name], ...(i === 0 ? actions : [])]);
    });
    sets.forEach((props, i) => {
      const id = `${filter.id ?? `new${index + 1}`}${i ? `-${i + 1}` : ''}`;
      ids.push(id);
      entries.push(
        [
          '\t<entry>',
          "\t\t<category term='filter'></category>",
          '\t\t<title>Mail Filter</title>',
          `\t\t<id>tag:mail.google.com,2008:filter:${xmlEscape(id)}</id>`,
          `\t\t<updated>${updated}</updated>`,
          '\t\t<content></content>',
          ...props.map(
            ([name, value]) => `\t\t<apps:property name='${name}' value='${xmlEscape(value)}'/>`,
          ),
          '\t</entry>',
        ].join('\n'),
      );
    });
  });
  /** @type {string[]} */
  const author = [];
  if (opts.author?.name || opts.author?.email) {
    author.push('\t<author>');
    if (opts.author.name) author.push(`\t\t<name>${xmlEscape(opts.author.name)}</name>`);
    if (opts.author.email) author.push(`\t\t<email>${xmlEscape(opts.author.email)}</email>`);
    author.push('\t</author>');
  }
  return [
    "<?xml version='1.0' encoding='UTF-8'?><feed xmlns='http://www.w3.org/2005/Atom' xmlns:apps='http://schemas.google.com/apps/2006'>",
    '\t<title>Mail Filters</title>',
    `\t<id>tag:mail.google.com,2008:filters:${xmlEscape(ids.join(','))}</id>`,
    `\t<updated>${updated}</updated>`,
    ...author,
    ...entries,
    '</feed>',
    '',
  ].join('\n');
}

/** Limits for reading a mailFilters.xml file. Gmail allows 1,000 filters, so these leave room. */
export const XML_LIMITS = Object.freeze({ maxBytes: 5 * 1024 * 1024, maxEntries: 2000 });

/** The ID prefix for a label known by name only. toGmailXml, templates and the executor know it. */
export const NAME_PREFIX = 'new:';

/** @type {Record<string, number>} */
const SIZE_UNITS = { s_sb: 1, s_skb: 1024, s_smb: 1024 * 1024 };

/** @type {Record<string, string>} */
const CATEGORY_BY_SMART_LABEL = Object.fromEntries(
  Object.entries(SMART_LABELS).map(([category, smart]) => [smart, category]),
);

/** @type {Record<string, string>} */
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

const NOT_GMAIL =
  'This is not a Gmail filter file. In Gmail, export your filters and choose the mailFilters.xml file.';

/**
 * Decodes the five XML entities and numeric character references. Anything else stays as it is.
 * @param {string} s
 * @returns {string}
 */
export function xmlDecode(s) {
  return String(s).replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, ref) => {
    if (ref[0] !== '#') return NAMED_ENTITIES[ref] ?? whole;
    const code = /x/i.test(ref[1]) ? parseInt(ref.slice(2), 16) : Number(ref.slice(1));
    if (!Number.isInteger(code) || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
      return whole;
    }
    return String.fromCodePoint(code);
  });
}

/**
 * Reads the attributes of one tag, in either quote style.
 * @param {string} text  The part of the tag after its name.
 * @returns {Record<string, string>}
 */
function readAttributes(text) {
  /** @type {Record<string, string>} */
  const out = {};
  const re = /([\w:.-]+)\s*=\s*(?:'([^']*)'|"([^"]*)")/g;
  let m;
  while ((m = re.exec(text))) out[m[1]] = xmlDecode(m[2] ?? m[3] ?? '');
  return out;
}

/** @param {string} value */
const isTrue = (value) => value.trim().toLowerCase() === 'true';

/**
 * @typedef {object} GmailXmlImport
 * @property {Filter[]} filters        One filter per entry, as in Gmail. Labels use "new:<name>" IDs.
 * @property {string[]} labelNames     Every label name used, in order of first use.
 * @property {string[]} forwardAddresses  Every forwarding address used.
 * @property {string[]} warnings       Plain English. Things that were left out or guessed.
 */

/**
 * Reads Gmail's mailFilters.xml (Gmail settings, Filters and blocked addresses, Export).
 * Each entry becomes one filter, as in Gmail. The file names labels, not IDs, so a label becomes
 * the placeholder ID "new:<name>". Properties 3B Mailbox does not know go into warnings.
 * It does not use DOMParser, so it runs in Node and in the browser.
 * @param {string} text
 * @returns {GmailXmlImport}
 * @throws {BackupError}
 */
export function fromGmailXml(text) {
  if (typeof text !== 'string' || text.trim() === '') throw new BackupError('This file is empty.');
  if (text.length > XML_LIMITS.maxBytes) {
    throw new BackupError(
      'This file is too big for a Gmail filter file. The limit is 5 MB. Check that you chose mailFilters.xml.',
    );
  }
  const clean = text.replace(/^\uFEFF/, '').replace(/<!--[\s\S]*?-->/g, '');
  if (!/^\s*(<\?xml[^>]*\?>\s*)?<feed\b[^>]*>/.test(clean) || !/<\/feed>\s*$/.test(clean)) {
    throw new BackupError(NOT_GMAIL);
  }
  const entryCount = (clean.match(/<entry\b/g) ?? []).length;
  if (entryCount > XML_LIMITS.maxEntries) {
    throw new BackupError(
      `This file has ${entryCount.toLocaleString('en-GB')} entries. 3B Mailbox reads up to ${XML_LIMITS.maxEntries.toLocaleString('en-GB')}. Gmail allows 1,000 filters.`,
    );
  }
  const entries = [...clean.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/g)].map((m) => m[1]);
  if (entries.length !== entryCount) {
    throw new BackupError('This file is damaged. One of the filters in it is not complete.');
  }
  if (entries.length === 0) {
    throw new BackupError(
      'This file has no filters in it. In Gmail, select all your filters before you choose Export.',
    );
  }
  if (!/<apps:property\b/.test(clean)) throw new BackupError(NOT_GMAIL);

  /** @type {Filter[]} */
  const filters = [];
  /** @type {string[]} */
  const labelNames = [];
  /** @type {string[]} */
  const forwardAddresses = [];
  /** @type {string[]} */
  const warnings = [];
  const usedIds = new Set();

  entries.forEach((body, i) => {
    const n = i + 1;
    const category = /<category\b([^>]*)>/.exec(body);
    const term = category ? readAttributes(category[1]).term : undefined;
    if (term !== undefined && term !== 'filter') {
      warnings.push(`Entry ${n} is not a filter. It is left out.`);
      return;
    }
    /** @type {Record<string, string>} */
    const props = {};
    const re = /<apps:property\b((?:\s+[\w:.-]+\s*=\s*(?:'[^']*'|"[^"]*"))*)\s*\/?>/g;
    let m;
    while ((m = re.exec(body))) {
      const attrs = readAttributes(m[1]);
      if (typeof attrs.name === 'string') props[attrs.name] = attrs.value ?? '';
    }

    /** @type {FilterCriteria} */
    const criteria = {};
    /** @type {Partial<import('../types.js').FriendlyAction>} */
    const friendly = { labelIds: [] };
    /** @type {string[]} */
    const unknown = [];
    for (const [name, raw] of Object.entries(props)) {
      const value = raw.trim();
      switch (name) {
        case 'from':
        case 'to':
        case 'subject':
          if (value) criteria[name] = value;
          break;
        case 'hasTheWord':
          if (value) criteria.query = value;
          break;
        case 'doesNotHaveTheWord':
          if (value) criteria.negatedQuery = value;
          break;
        case 'hasAttachment':
        case 'excludeChats':
          if (isTrue(value)) criteria[name] = true;
          break;
        case 'size':
        case 'sizeOperator':
        case 'sizeUnit':
          break; // Read together below.
        case 'label':
          if (value) {
            friendly.labelIds = [`${NAME_PREFIX}${value}`];
            if (!labelNames.includes(value)) labelNames.push(value);
          }
          break;
        case 'shouldArchive':
          friendly.archive = isTrue(value);
          break;
        case 'shouldMarkAsRead':
          friendly.markRead = isTrue(value);
          break;
        case 'shouldStar':
          friendly.star = isTrue(value);
          break;
        case 'shouldTrash':
          friendly.trash = isTrue(value);
          break;
        case 'shouldNeverSpam':
          friendly.neverSpam = isTrue(value);
          break;
        case 'shouldAlwaysMarkAsImportant':
          if (isTrue(value)) friendly.important = 'always';
          break;
        case 'shouldNeverMarkAsImportant':
          if (isTrue(value) && friendly.important !== 'always') friendly.important = 'never';
          break;
        case 'smartLabelToApply':
          if (CATEGORY_BY_SMART_LABEL[value]) {
            friendly.category = /** @type {any} */ (CATEGORY_BY_SMART_LABEL[value]);
          } else if (value) {
            warnings.push(
              `Filter ${n} puts mail in a category 3B Mailbox does not know ("${value}"). The category is left out.`,
            );
          }
          break;
        case 'forwardTo':
          if (value) {
            friendly.forward = value;
            if (!forwardAddresses.some((a) => a.toLowerCase() === value.toLowerCase())) {
              forwardAddresses.push(value);
            }
          }
          break;
        default:
          unknown.push(name);
      }
    }

    if (props.size !== undefined && props.size.trim() !== '') {
      const amount = Number(props.size.trim());
      const unit = SIZE_UNITS[(props.sizeUnit ?? '').trim()];
      const operator = (props.sizeOperator ?? '').trim();
      if (!Number.isFinite(amount) || amount < 0) {
        warnings.push(`Filter ${n} has a size that is not a number. The size is left out.`);
      } else if (amount > 0) {
        if (!unit) {
          warnings.push(`Filter ${n} has a size with no unit. 3B Mailbox reads it as bytes.`);
        }
        if (operator !== 's_sl' && operator !== 's_ss') {
          warnings.push(
            `Filter ${n} has a size but does not say larger or smaller. 3B Mailbox reads it as larger.`,
          );
        }
        criteria.size = Math.round(amount * (unit ?? 1));
        criteria.sizeComparison = operator === 's_ss' ? 'smaller' : 'larger';
      }
    }

    if (unknown.length) {
      warnings.push(
        `Filter ${n} uses ${unknown.map((u) => `"${u}"`).join(', ')}, which 3B Mailbox does not know. ${unknown.length === 1 ? 'It is' : 'They are'} left out of the new file.`,
      );
    }
    const action = toApi(friendly);
    if (Object.keys(criteria).length === 0) {
      warnings.push(`Filter ${n} has no search terms. It is left out.`);
      return;
    }
    if (Object.keys(action).length === 0) {
      warnings.push(`Filter ${n} has no action that 3B Mailbox knows. It is left out.`);
      return;
    }
    // Gmail IDs look like z0000001687000000000*1234567890123456. Keep them safe for HTML ids and URLs.
    const idMatch = /<id>\s*tag:mail\.google\.com,2008:filter:([^<\s]{1,80})\s*<\/id>/.exec(body);
    let id = idMatch ? idMatch[1].replace(/[^\w-]/g, '_') : `file${n}`;
    while (usedIds.has(id)) id = `${id}-${n}`;
    usedIds.add(id);
    filters.push({ id, criteria, action });
  });

  if (filters.length === 0) {
    throw new BackupError(
      '3B Mailbox could not read any filters in this file. Check that you chose mailFilters.xml from Gmail.',
    );
  }
  return { filters, labelNames, forwardAddresses, warnings };
}
