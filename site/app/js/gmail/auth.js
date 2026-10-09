// @ts-check
// Google sign-in with the Google Identity Services (GIS) token model.
// The access token lives in memory only. It is never written to storage.

/** @typedef {import('../types.js').PermissionTier} PermissionTier */

/** URL of the Google Identity Services script. Loaded only when the user signs in. */
export const GIS_URL = 'https://accounts.google.com/gsi/client';

const SCOPE_SETTINGS = 'https://www.googleapis.com/auth/gmail.settings.basic';
const SCOPE_LABELS = 'https://www.googleapis.com/auth/gmail.labels';
const SCOPE_READONLY = 'https://www.googleapis.com/auth/gmail.readonly';
const SCOPE_MODIFY = 'https://www.googleapis.com/auth/gmail.modify';

/**
 * OAuth scopes for each permission tier. Each tier adds scopes to the one before it.
 * @type {Readonly<Record<PermissionTier, readonly string[]>>}
 */
export const SCOPES = Object.freeze({
  basic: Object.freeze([SCOPE_SETTINGS, SCOPE_LABELS]),
  preview: Object.freeze([SCOPE_SETTINGS, SCOPE_LABELS, SCOPE_READONLY]),
  apply: Object.freeze([SCOPE_SETTINGS, SCOPE_LABELS, SCOPE_READONLY, SCOPE_MODIFY]),
});

/**
 * Plain English names for each tier, as the app shows them.
 * @type {Readonly<Record<PermissionTier, string>>}
 */
export const TIER_NAMES = Object.freeze({
  basic: 'Manage filters',
  preview: 'Preview matching mail',
  apply: 'Apply filters to existing mail',
});

/**
 * Plain English names for each scope, as Google shows them on the consent screen (shortened).
 * @type {Readonly<Record<string, string>>}
 */
export const SCOPE_NAMES = Object.freeze({
  [SCOPE_SETTINGS]: 'See, edit, create or change your email settings and filters',
  [SCOPE_LABELS]: 'See and edit your email labels',
  [SCOPE_READONLY]: 'View your email messages and settings',
  [SCOPE_MODIFY]: 'View and change your email, but not delete it',
});

/** Time before expiry when the 'expiring' event fires. */
export const EXPIRY_WARNING_MS = 5 * 60 * 1000;

const CLIENT_ID_PATTERN = /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/;

/**
 * Checks the shape of an OAuth client ID.
 * @param {string} id
 * @returns {boolean}
 */
export function validateClientId(id) {
  return typeof id === 'string' && CLIENT_ID_PATTERN.test(id.trim());
}

/**
 * @typedef {'invalid-client-id'|'script-failed'|'popup-closed'|'popup-blocked'|'access-denied'|
 *   'missing-scopes'|'not-signed-in'|'unknown'} AuthErrorCode
 */

/** A sign-in problem with a plain English message. */
export class AuthError extends Error {
  /**
   * @param {AuthErrorCode} code
   * @param {string} message
   * @param {{missingScopes?: string[], cause?: unknown}} [extra]
   */
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'AuthError';
    /** @type {AuthErrorCode} */
    this.code = code;
    /** @type {string[]} */
    this.missingScopes = extra.missingScopes ?? [];
    if (extra.cause !== undefined) this.cause = extra.cause;
  }
}

/**
 * @typedef {object} AuthEvent
 * @property {'signed-in'|'expiring'|'expired'|'signed-out'|'error'} type
 * @property {number|null} [expiresAt]   Epoch milliseconds.
 * @property {AuthError} [error]         Set when type is 'error'.
 */

/**
 * @typedef {object} Auth
 * @property {(tier?: PermissionTier) => Promise<void>} signIn   Asks for every scope of the tier.
 * @property {(tier: PermissionTier) => Promise<void>} upgrade   Asks only for the scopes the user does not have yet.
 * @property {() => Promise<void>} signOut                       Revokes the token and forgets it.
 * @property {() => string|null} getToken                        The access token, or null when signed out or expired.
 * @property {(tier: PermissionTier) => boolean} hasTier
 * @property {() => number|null} expiresAt                       Epoch milliseconds.
 * @property {(cb: (event: AuthEvent) => void) => () => void} onChange  Returns an unsubscribe function.
 */

/**
 * @typedef {object} AuthOptions
 * @property {string} clientId
 * @property {(src: string) => Promise<void>} [loadScript]   Loads a script once. Tests pass a fake.
 * @property {() => number} [now]
 * @property {() => any} [getGoogle]                        Returns the `google` global. Tests pass a fake.
 * @property {(fn: () => void, ms: number) => any} [setTimer]
 * @property {(handle: any) => void} [clearTimer]
 */

/** @type {Map<string, Promise<void>>} */
const scriptCache = new Map();

/**
 * Adds a script tag once and waits for it to load.
 * @param {string} src
 * @returns {Promise<void>}
 */
export function loadScriptOnce(src) {
  const cached = scriptCache.get(src);
  if (cached) return cached;
  const promise = new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.defer = true;
    el.onload = () => resolve(undefined);
    el.onerror = () => {
      scriptCache.delete(src);
      el.remove();
      reject(new Error('Script failed to load'));
    };
    document.head.appendChild(el);
  });
  scriptCache.set(src, /** @type {Promise<void>} */ (promise));
  return /** @type {Promise<void>} */ (promise);
}

/**
 * Maps a GIS error_callback type to a plain English error.
 * @param {{type?: string, message?: string}} err
 * @returns {AuthError}
 */
export function popupError(err) {
  const type = err?.type;
  if (type === 'popup_closed') {
    return new AuthError(
      'popup-closed',
      'The Google sign-in window closed before sign-in finished. Try again.',
      { cause: err },
    );
  }
  if (type === 'popup_failed_to_open') {
    return new AuthError(
      'popup-blocked',
      'Your browser blocked the Google sign-in window. Allow pop-ups for this site, then try again.',
      { cause: err },
    );
  }
  return new AuthError('unknown', 'Google sign-in did not work. Try again.', { cause: err });
}

/**
 * Maps an OAuth error code from the token response to a plain English error.
 * @param {string} code
 * @returns {AuthError}
 */
function tokenResponseError(code) {
  if (code === 'access_denied') {
    return new AuthError(
      'access-denied',
      'You did not give 3B Mailbox permission to use your Gmail. Sign in again and allow access.',
    );
  }
  if (code === 'invalid_client' || code === 'unauthorized_client') {
    return new AuthError(
      'invalid-client-id',
      'Google did not accept your client ID. Check the client ID and the authorised JavaScript origins in Google Cloud.',
    );
  }
  return new AuthError('unknown', `Google sign-in did not work (${code}). Try again.`);
}

/**
 * Creates the sign-in controller.
 * @param {AuthOptions} options
 * @returns {Auth}
 */
export function createAuth(options) {
  const {
    clientId,
    loadScript = loadScriptOnce,
    now = () => Date.now(),
    getGoogle = () => /** @type {any} */ (globalThis).google,
    setTimer = (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimer = (handle) => globalThis.clearTimeout(handle),
  } = options;

  /** @type {string|null} */
  let token = null;
  /** @type {number|null} */
  let expiry = null;
  /** @type {Set<string>} */
  let granted = new Set();
  /** @type {any[]} */
  let timers = [];
  /** @type {Promise<void>|null} */
  let pending = null;
  /** @type {Set<(event: AuthEvent) => void>} */
  const listeners = new Set();

  /** @param {AuthEvent} event */
  function emit(event) {
    for (const cb of [...listeners]) {
      try {
        cb(event);
      } catch (err) {
        console.error('Auth listener failed', err instanceof Error ? err.name : 'error');
      }
    }
  }

  function clearTimers() {
    for (const t of timers) clearTimer(t);
    timers = [];
  }

  function forget() {
    clearTimers();
    token = null;
    expiry = null;
    granted = new Set();
  }

  function isExpired() {
    return expiry !== null && now() >= expiry;
  }

  function schedule() {
    clearTimers();
    if (expiry === null) return;
    const left = expiry - now();
    timers.push(
      setTimer(
        () => emit({ type: 'expiring', expiresAt: expiry }),
        Math.max(0, left - EXPIRY_WARNING_MS),
      ),
    );
    timers.push(
      setTimer(
        () => {
          const at = expiry;
          forget();
          emit({ type: 'expired', expiresAt: at });
        },
        Math.max(0, left),
      ),
    );
  }

  /** @returns {Promise<any>} The google.accounts.oauth2 object. */
  async function oauth2() {
    if (!validateClientId(clientId)) {
      throw new AuthError(
        'invalid-client-id',
        'The client ID is not in the right format. It ends with ".apps.googleusercontent.com".',
      );
    }
    let g = getGoogle();
    if (!g?.accounts?.oauth2) {
      try {
        await loadScript(GIS_URL);
      } catch (err) {
        throw new AuthError(
          'script-failed',
          'Google sign-in did not load. Check your internet connection. If you use a content blocker, allow accounts.google.com.',
          { cause: err },
        );
      }
      g = getGoogle();
    }
    if (!g?.accounts?.oauth2) {
      throw new AuthError(
        'script-failed',
        'Google sign-in did not load. Reload the page, then try again.',
      );
    }
    return g.accounts.oauth2;
  }

  /**
   * Opens the Google popup for these scopes and stores the token.
   * @param {readonly string[]} requested   Scopes to ask for in this popup.
   * @param {readonly string[]} required    Scopes the token must have when done.
   * @returns {Promise<void>}
   */
  async function request(requested, required) {
    const api = await oauth2();
    await new Promise((resolve, reject) => {
      /** @param {AuthError} err */
      const fail = (err) => {
        emit({ type: 'error', error: err });
        reject(err);
      };
      let client;
      try {
        client = api.initTokenClient({
          client_id: clientId.trim(),
          scope: requested.join(' '),
          include_granted_scopes: true,
          /** @param {any} response */
          callback: (response) => {
            if (!response || response.error) {
              fail(tokenResponseError(response?.error ?? 'unknown'));
              return;
            }
            const scopeList = String(response.scope ?? '')
              .split(/\s+/)
              .filter(Boolean);
            token = response.access_token;
            const seconds = Number(response.expires_in) || 3600;
            expiry = now() + seconds * 1000;
            granted = new Set(scopeList);
            schedule();
            const missing = required.filter((s) => !api.hasGrantedAllScopes(response, s));
            for (const s of required) if (!missing.includes(s)) granted.add(s);
            if (missing.length > 0) {
              const names = missing.map((s) => `"${SCOPE_NAMES[s] ?? s}"`).join(' and ');
              fail(
                new AuthError(
                  'missing-scopes',
                  `3B Mailbox needs the permission ${names}. Sign in again and tick that box on the Google screen.`,
                  { missingScopes: missing },
                ),
              );
              return;
            }
            emit({ type: 'signed-in', expiresAt: expiry });
            resolve(undefined);
          },
          /** @param {any} err */
          error_callback: (err) => fail(popupError(err)),
        });
      } catch (err) {
        fail(new AuthError('unknown', 'Google sign-in did not start. Try again.', { cause: err }));
        return;
      }
      client.requestAccessToken();
    });
  }

  /**
   * Runs one popup at a time. A second call while a popup is open waits for the first.
   * @param {() => Promise<void>} fn
   */
  function single(fn) {
    if (pending) return pending;
    pending = fn().finally(() => {
      pending = null;
    });
    return pending;
  }

  /** @param {PermissionTier} tier */
  function hasTier(tier) {
    if (!token || isExpired()) return false;
    const scopes = SCOPES[tier];
    if (!scopes) return false;
    return scopes.every((s) => granted.has(s));
  }

  return {
    signIn(tier = 'basic') {
      return single(() => request(SCOPES[tier] ?? SCOPES.basic, SCOPES[tier] ?? SCOPES.basic));
    },

    upgrade(tier) {
      return single(async () => {
        const required = SCOPES[tier] ?? SCOPES.basic;
        if (!token || isExpired()) {
          await request(required, required);
          return;
        }
        const extra = required.filter((s) => !granted.has(s));
        if (extra.length === 0) return;
        await request(extra, required);
      });
    },

    async signOut() {
      const old = token;
      forget();
      if (old) {
        const g = getGoogle();
        if (g?.accounts?.oauth2?.revoke) {
          await new Promise((resolve) => {
            try {
              g.accounts.oauth2.revoke(old, () => resolve(undefined));
            } catch {
              resolve(undefined);
            }
          });
        }
      }
      emit({ type: 'signed-out', expiresAt: null });
    },

    getToken() {
      if (!token) return null;
      if (isExpired()) {
        const at = expiry;
        forget();
        emit({ type: 'expired', expiresAt: at });
        return null;
      }
      return token;
    },

    hasTier,

    expiresAt() {
      return token ? expiry : null;
    },

    onChange(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}
