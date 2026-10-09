import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = join(import.meta.dirname, '../../../site/app/js/core');

describe('core source text', () => {
  const files = readdirSync(dir).filter((f) => f.endsWith('.js'));
  it.each(files)('%s has no em dashes, en dashes or curly quotes', (file) => {
    const text = readFileSync(join(dir, file), 'utf8');
    expect(text).not.toMatch(/[–—‘’“”]/);
  });

  it.each(files)('%s is type-checked', (file) => {
    expect(readFileSync(join(dir, file), 'utf8').startsWith('// @ts-check')).toBe(true);
  });
});
