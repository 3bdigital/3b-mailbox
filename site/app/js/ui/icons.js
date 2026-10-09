// Inline SVG icons on a 20px grid with a 1.5px stroke. Icons are decorative: the text next to them,
// or the aria-label of the button they are in, carries the meaning.

/** @type {Record<string, string[]>} Path data for each icon. */
const PATHS = {
  overview: [
    'M3 3.5h5.5V9H3z',
    'M11.5 3.5H17V7h-5.5z',
    'M11.5 10H17v6.5h-5.5z',
    'M3 12h5.5v4.5H3z',
  ],
  filter: ['M3 4h14l-5.5 6.5v4.5l-3 1.5v-6z'],
  suggest: [
    'M10 2.5v2.5',
    'M10 15v2.5',
    'M2.5 10H5',
    'M15 10h2.5',
    'M10 6.5l1.1 2.4 2.4 1.1-2.4 1.1L10 13.5l-1.1-2.4L6.5 10l2.4-1.1z',
    'M4.7 4.7l1.4 1.4',
    'M13.9 13.9l1.4 1.4',
  ],
  tidy: ['M12.5 3l4.5 4.5', 'M11 4.5l4.5 4.5-7 7H4v-4.5z', 'M7.5 8l4.5 4.5'],
  settings: [
    'M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
    'M8.6 2.5h2.8l.4 2 1.6.9 1.9-.7 1.4 2.4-1.5 1.4v1.9l1.5 1.4-1.4 2.4-1.9-.7-1.6.9-.4 2H8.6l-.4-2-1.6-.9-1.9.7-1.4-2.4 1.5-1.4V9L3.3 7.6l1.4-2.4 1.9.7 1.6-.9z',
  ],
  plus: ['M10 4v12', 'M4 10h12'],
  search: ['M8.75 14.5a5.75 5.75 0 1 0 0-11.5 5.75 5.75 0 0 0 0 11.5z', 'M13 13l4 4'],
  trash: ['M3.5 5.5h13', 'M8 5.5V3.5h4v2', 'M5 5.5l.8 11h8.4l.8-11', 'M8.5 8.5v5', 'M11.5 8.5v5'],
  copy: ['M7 7h9.5v9.5H7z', 'M13 7V3.5H3.5V13H7'],
  tag: ['M3 3h6.5l7.5 7.5-6.5 6.5L3 9.5z', 'M6.75 7.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5z'],
  check: ['M4 10.5l4 4 8-9'],
  close: ['M5 5l10 10', 'M15 5L5 15'],
  more: [
    'M4.5 10.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5z',
    'M10 10.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5z',
    'M15.5 10.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5z',
  ],
  warning: ['M10 3l7.5 13.5h-15z', 'M10 8v4', 'M10 14.5v.01'],
  error: ['M7 2.5h6L17.5 7v6L13 17.5H7L2.5 13V7z', 'M10 6.5v4.5', 'M10 13.5v.01'],
  info: ['M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15z', 'M10 9v5', 'M10 6v.01'],
  success: ['M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15z', 'M6.5 10.25l2.5 2.5 4.5-5'],
  forward: ['M11 4l5 5-5 5', 'M16 9H8a4.5 4.5 0 0 0-4.5 4.5V16'],
  mail: ['M2.5 4.5h15v11h-15z', 'M2.5 5l7.5 6 7.5-6'],
  download: ['M10 3v9.5', 'M6 8.5l4 4 4-4', 'M3.5 16.5h13'],
  upload: ['M10 13V3.5', 'M6 7.5l4-4 4 4', 'M3.5 16.5h13'],
  undo: ['M7 4L3.5 7.5 7 11', 'M3.5 7.5h8a5 5 0 0 1 0 10H8'],
  star: ['M10 2.75l2.2 4.6 5 .65-3.65 3.5.9 5-4.45-2.4-4.45 2.4.9-5L2.8 8l5-.65z'],
  archive: ['M2.5 4h15v3.5h-15z', 'M3.5 7.5v8.5h13V7.5', 'M8 10.5h4'],
  eye: [
    'M1.75 10S4.75 4.5 10 4.5 18.25 10 18.25 10 15.25 15.5 10 15.5 1.75 10 1.75 10z',
    'M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  ],
  shield: ['M10 2.5l6.5 2.5v4.5c0 4-2.75 6.75-6.5 8-3.75-1.25-6.5-4-6.5-8V5z', 'M7 10l2 2 4-4'],
  lock: ['M4.5 9h11v8.5h-11z', 'M7 9V6.5a3 3 0 0 1 6 0V9'],
  signin: ['M11.5 3.5h5v13h-5', 'M3 10h9', 'M8.5 6.5L12 10l-3.5 3.5'],
  signout: ['M8.5 3.5h-5v13h5', 'M8 10h9', 'M13.5 6.5L17 10l-3.5 3.5'],
  sun: [
    'M10 13.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
    'M10 1.5v2',
    'M10 16.5v2',
    'M1.5 10h2',
    'M16.5 10h2',
    'M4 4l1.4 1.4',
    'M14.6 14.6L16 16',
    'M4 16l1.4-1.4',
    'M14.6 5.4L16 4',
  ],
  moon: ['M16.5 12.5A7 7 0 0 1 7.5 3.5a7 7 0 1 0 9 9z'],
  monitor: ['M2.5 3.5h15v10h-15z', 'M7 17h6', 'M10 13.5V17'],
  chevron: ['M5.5 7.75L10 12.25l4.5-4.5'],
  chevronRight: ['M7.75 5.5L12.25 10l-4.5 4.5'],
  external: ['M11.5 3.5h5v5', 'M16.5 3.5L9 11', 'M14 11.5v5H3.5V6h5'],
  keyboard: ['M2 5h16v10H2z', 'M5 8h.01', 'M8 8h.01', 'M11 8h.01', 'M14 8h.01', 'M6 12h8'],
  clock: ['M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15z', 'M10 6v4.25l3 1.75'],
  merge: ['M5 3v4c0 3 5 3 5 6v4', 'M15 3v4c0 3-5 3-5 6', 'M7 14.5l3 3 3-3'],
  edit: ['M13 3.5l3.5 3.5L7 16.5H3.5V13z', 'M11 5.5l3.5 3.5'],
  label: ['M3 5.5h10.5l3.5 4.5-3.5 4.5H3z'],
  wifiOff: [
    'M2.5 2.5l15 15',
    'M10 15.5v.01',
    'M7.25 12.5a4 4 0 0 1 5.5 0',
    'M4.5 9.5a8 8 0 0 1 3-1.8',
    'M12.5 7.7a8 8 0 0 1 3 1.8',
    'M2 6.5a12 12 0 0 1 3-2',
    'M9 3.55A12 12 0 0 1 18 6.5',
  ],
  user: [
    'M10 9.5a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5z',
    'M3.5 17.5c.5-3.5 3.25-5.5 6.5-5.5s6 2 6.5 5.5',
  ],
  beaker: [
    'M7.5 2.5h5',
    'M8.5 2.5v5L3.75 16a1 1 0 0 0 .9 1.5h10.7a1 1 0 0 0 .9-1.5L11.5 7.5v-5',
    'M5.5 12.5h9',
  ],
  history: ['M3.5 10a6.5 6.5 0 1 0 2-4.7', 'M3 3v3.5h3.5', 'M10 6.5V10l2.5 1.5'],
};

/**
 * An inline SVG icon. Hidden from assistive technology.
 * @param {keyof typeof PATHS | string} name
 * @param {{size?: number, class?: string}} [opts]
 * @returns {SVGSVGElement}
 */
export function icon(name, opts = {}) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = /** @type {SVGSVGElement} */ (document.createElementNS(ns, 'svg'));
  const size = String(opts.size ?? 20);
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', `icon${opts.class ? ` ${opts.class}` : ''}`);
  for (const d of PATHS[name] ?? PATHS.info) {
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

export const ICON_NAMES = Object.keys(PATHS);
