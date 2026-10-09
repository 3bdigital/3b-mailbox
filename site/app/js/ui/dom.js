// Small DOM helpers. Text always goes in as text nodes, never as HTML, because filter text is untrusted.

/**
 * @typedef {string|number|Node|null|undefined|false|any[]} Child
 */

let uid = 0;

/**
 * A unique id for linking labels, descriptions and controls.
 * @param {string} [prefix]
 * @returns {string}
 */
export function nextId(prefix = 'ef') {
  uid += 1;
  return `${prefix}-${uid}`;
}

/**
 * @param {Node} parent
 * @param {Child} child
 */
function append(parent, child) {
  if (child === null || child === undefined || child === false) return;
  if (Array.isArray(child)) {
    for (const c of child) append(parent, c);
    return;
  }
  parent.appendChild(
    child instanceof Node ? child : document.createTextNode(String(/** @type {any} */ (child))),
  );
}

/**
 * Creates an element.
 * Props: class, text, on: {event: handler}, dataset: {}, style: {prop: value}, ref: (el) => void,
 * boolean props (hidden, disabled, checked ...) and any attribute (aria-*, role, href ...).
 * @param {string} tag
 * @param {Record<string, any>|null} [props]
 * @param {...Child} children
 * @returns {any}
 */
export function h(tag, props, ...children) {
  const svg = tag.startsWith('svg:');
  const el = svg
    ? document.createElementNS('http://www.w3.org/2000/svg', tag.slice(4))
    : document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class')
      el.setAttribute('class', Array.isArray(value) ? value.filter(Boolean).join(' ') : value);
    else if (key === 'text') el.textContent = String(value);
    else if (key === 'on')
      for (const [ev, fn] of Object.entries(value)) el.addEventListener(ev, fn);
    else if (key === 'dataset') Object.assign(/** @type {HTMLElement} */ (el).dataset, value);
    else if (key === 'style') {
      for (const [p, v] of Object.entries(value))
        /** @type {HTMLElement} */ (el).style.setProperty(p, v);
    } else if (key === 'ref') value(el);
    else if (key === 'value' && 'value' in el) /** @type {any} */ (el).value = value;
    else if (
      !svg &&
      (key === 'checked' || key === 'disabled' || key === 'selected' || key === 'indeterminate')
    ) {
      /** @type {any} */ (el)[key] = Boolean(value);
      if (key !== 'indeterminate' && value) el.setAttribute(key, '');
    } else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }
  for (const c of children) append(el, c);
  return el;
}

/**
 * Removes every child and appends new ones.
 * @param {Element} el
 * @param {...Child} children
 */
export function replace(el, ...children) {
  el.replaceChildren();
  for (const c of children) append(el, c);
}

/**
 * Plural helper: "1 filter", "3 filters".
 * @param {number} n
 * @param {string} word
 * @param {string} [plural]
 */
export function plural(n, word, plural = `${word}s`) {
  return `${n.toLocaleString('en-GB')} ${n === 1 ? word : plural}`;
}

/**
 * Debounce a function.
 * @template {(...args: any[]) => void} T
 * @param {T} fn
 * @param {number} ms
 * @returns {T}
 */
export function debounce(fn, ms) {
  /** @type {any} */
  let t;
  return /** @type {T} */ (
    (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    }
  );
}

/**
 * Saves text as a file download.
 * @param {string} name
 * @param {string} text
 * @param {string} type
 */
export function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: name, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Formats a date and time for people in the UK.
 * @param {string|number|Date} value
 */
export function formatDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * True when the user wants less motion (system setting or our own setting).
 */
export function reducedMotion() {
  return (
    document.documentElement.dataset.motion === 'reduce' ||
    globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}
