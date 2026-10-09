// Hash router. Routes: #/setup, #/overview, #/filters, #/filters/new, #/filters/:id, #/suggestions,
// #/tidy, #/settings.

/**
 * @typedef {object} Route
 * @property {string} name     'setup'|'overview'|'filters'|'editor'|'suggestions'|'tidy'|'settings'|'not-found'
 * @property {Record<string, string>} params
 * @property {string} path
 */

/**
 * Reads a hash into a route.
 * @param {string} hash
 * @returns {Route}
 */
export function parseHash(hash) {
  const path = (hash || '').replace(/^#/, '') || '/';
  const parts = path.split('?')[0].split('/').filter(Boolean);
  const [first, second] = parts;
  /** @type {Route} */
  const route = { name: 'not-found', params: {}, path };
  if (parts.length === 0) route.name = 'home';
  else if (first === 'filters' && second === 'new' && parts.length === 2) route.name = 'editor';
  else if (first === 'filters' && second && parts.length === 2) {
    route.name = 'editor';
    route.params.id = decodeURIComponent(second);
  } else if (
    parts.length === 1 &&
    ['setup', 'overview', 'filters', 'suggestions', 'tidy', 'settings'].includes(first)
  ) {
    route.name = first;
  }
  return route;
}

/**
 * Starts the router. Calls onRoute now and on every hash change.
 * @param {(route: Route) => void} onRoute
 * @returns {{navigate: (hash: string, opts?: {replace?: boolean}) => void, current: () => Route, stop: () => void}}
 */
export function startRouter(onRoute) {
  let current = parseHash(location.hash);
  const handler = () => {
    current = parseHash(location.hash);
    onRoute(current);
  };
  addEventListener('hashchange', handler);
  queueMicrotask(handler);
  return {
    navigate(hash, opts = {}) {
      const target = hash.startsWith('#') ? hash : `#${hash}`;
      if (location.hash === target) {
        handler();
        return;
      }
      if (opts.replace) {
        history.replaceState(null, '', `${location.pathname}${location.search}${target}`);
        handler();
      } else location.hash = target;
    },
    current: () => current,
    stop: () => removeEventListener('hashchange', handler),
  };
}
