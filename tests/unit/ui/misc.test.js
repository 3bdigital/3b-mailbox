import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseHash } from '../../../site/app/js/ui/router.js';
import { currentWord, suggestOperators } from '../../../site/app/js/ui/components/query-editor.js';
import { contrastRatio, readableLabelColour } from '../../../site/app/js/ui/components/widgets.js';
import { probeQuery } from '../../../site/app/js/ui/views/settings.js';
import { criteriaLength } from '../../../site/app/js/core/limits.js';

describe('parseHash', () => {
  it.each([
    ['', 'home', {}],
    ['#/', 'home', {}],
    ['#/overview', 'overview', {}],
    ['#/filters', 'filters', {}],
    ['#/filters/new', 'editor', {}],
    ['#/filters/ANe1%2F2', 'editor', { id: 'ANe1/2' }],
    ['#/suggestions', 'suggestions', {}],
    ['#/tidy', 'tidy', {}],
    ['#/settings', 'settings', {}],
    ['#/setup', 'setup', {}],
    ['#/nope', 'not-found', {}],
    ['#main', 'not-found', {}],
  ])('%s is %s', (hash, name, params) => {
    const r = parseHash(hash);
    expect(r.name).toBe(name);
    expect(r.params).toEqual(params);
  });
});

describe('operator autocomplete', () => {
  it('finds the word before the caret', () => {
    expect(currentWord('subject:x fr', 12)).toEqual({ start: 10, word: 'fr' });
    expect(currentWord('(lis', 4)).toEqual({ start: 1, word: 'lis' });
    expect(currentWord('a ', 2)).toEqual({ start: 2, word: '' });
  });

  it('suggests operators by prefix, and has: values', () => {
    expect(suggestOperators('fr').map((o) => o.name)).toEqual(['from']);
    expect(suggestOperators('has:att').map((o) => o.name)).toEqual(['has:attachment']);
    expect(suggestOperators('')).toEqual([]);
    expect(suggestOperators('from')).toEqual([]);
    expect(suggestOperators('is').every((o) => o.filterSafe === false)).toBe(true);
  });
});

describe('label colours', () => {
  it('keeps every chip readable at 4.5:1 or better', () => {
    const colours = ['#16a765', '#a479e2', '#4986e7', '#fad165', '#000000', '#ffffff', '#fb4c2f'];
    for (const bg of colours) {
      const c = readableLabelColour({ backgroundColor: bg, textColor: '#ffffff' });
      expect(c).not.toBeNull();
      expect(contrastRatio(c.fg, c.bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('falls back to the tokens when the colour is missing or not valid', () => {
    expect(readableLabelColour(undefined)).toBeNull();
    expect(readableLabelColour({ backgroundColor: 'red' })).toBeNull();
  });
});

describe('length probe', () => {
  it.each([1000, 1001, 1469, 2000])('builds a query of exactly %i characters', (n) => {
    const q = probeQuery(n);
    expect(q).toHaveLength(n);
    expect(criteriaLength({ query: q })).toBe(n);
  });
});

describe('service worker shell list', () => {
  const app = new URL('../../../site/app/', import.meta.url).pathname;
  const sw = readFileSync(join(app, 'sw.js'), 'utf8');
  const listed = new Set([...sw.matchAll(/^\s+'([^']+)',$/gm)].map((m) => m[1]));

  /** @param {string} dir */
  const walk = (dir) =>
    readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      return statSync(full).isDirectory() ? walk(full) : [relative(app, full)];
    });

  it('lists every file the app needs, and nothing that does not exist', () => {
    const files = walk(app).filter(
      (f) => /\.(js|css|html|png|svg|webmanifest)$/.test(f) && f !== 'sw.js',
    );
    const needed = files.filter((f) => f !== 'icons/icon-maskable.svg');
    for (const f of needed) expect(listed, `${f} is missing from sw.js`).toContain(f);
    for (const f of listed) if (f !== './') expect(files).toContain(f);
  });

  it('never caches other origins', () => {
    expect(sw).toMatch(/url\.origin !== self\.location\.origin\) return/);
    expect(sw).not.toMatch(/googleapis\.com['"]/);
  });
});
