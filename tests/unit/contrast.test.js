// Checks colour contrast of design token pairs in light and dark themes.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../site/app/css/tokens.css', import.meta.url), 'utf8');

/** Reads `--name: #hex;` declarations from one CSS block. */
function tokens(block) {
  const out = {};
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)) out[m[1]] = m[2];
  return out;
}

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const light = tokens(css.slice(0, css.indexOf('@media (prefers-color-scheme: dark)')));
const darkStart = css.indexOf(":root[data-theme='dark']");
const dark = { ...light, ...tokens(css.slice(darkStart, css.indexOf('}', darkStart))) };

// [foreground, background, minimum ratio]
const PAIRS = [
  ['text', 'surface', 7],
  ['text', 'surface-raised', 7],
  ['text', 'surface-sunken', 7],
  ['text-muted', 'surface', 7],
  ['text-muted', 'surface-raised', 7],
  ['text-inverse', 'surface-inverse', 7],
  ['accent-text', 'accent', 7],
  ['accent-text', 'accent-hover', 7],
  ['accent', 'surface', 4.5],
  ['accent', 'surface-raised', 4.5],
  ['accent-soft-text', 'accent-soft', 7],
  ['success', 'success-soft', 4.5],
  ['warning', 'warning-soft', 4.5],
  ['danger', 'danger-soft', 4.5],
  ['danger', 'surface-raised', 4.5],
  ['info', 'info-soft', 4.5],
  ['border-strong', 'surface-raised', 3],
  ['focus-ring', 'surface', 3],
  ['focus-ring', 'surface-raised', 3],
];

describe.each([
  ['light', light],
  ['dark', dark],
])('%s theme contrast', (_name, t) => {
  it.each(PAIRS)('%s on %s is at least %d:1', (fg, bg, min) => {
    expect(t[fg], `missing --${fg}`).toBeDefined();
    expect(t[bg], `missing --${bg}`).toBeDefined();
    expect(ratio(t[fg], t[bg])).toBeGreaterThanOrEqual(min);
  });
});

describe('theme blocks', () => {
  it('the media-query dark block matches the data-theme dark block', () => {
    const mq = css.indexOf(":root:not([data-theme='light'])");
    const mqTokens = tokens(css.slice(mq, css.indexOf('}', mq)));
    const explicit = tokens(css.slice(darkStart, css.indexOf('}', darkStart)));
    expect(mqTokens).toEqual(explicit);
  });
});
