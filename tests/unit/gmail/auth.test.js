import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AuthError,
  EXPIRY_WARNING_MS,
  GIS_URL,
  SCOPES,
  createAuth,
  loadScriptOnce,
  popupError,
  validateClientId,
} from '../../../site/app/js/gmail/auth.js';

const CLIENT_ID = '123456789012-abc123def456.apps.googleusercontent.com';
const LABELS_SCOPE = 'https://www.googleapis.com/auth/gmail.labels';

/**
 * A fake `google` global. `respond(config, state)` decides what the popup does.
 * By default it grants every requested scope plus the ones granted before.
 */
function fakeGoogle(respond) {
  const state = { granted: new Set(), configs: [], revoked: [], count: 0 };
  const grantAll = (config) => {
    for (const s of config.scope.split(' ')) state.granted.add(s);
    state.count++;
    config.callback({
      access_token: `token-${state.count}`,
      expires_in: 3600,
      scope: [...state.granted].join(' '),
      token_type: 'Bearer',
    });
  };
  const google = {
    accounts: {
      oauth2: {
        initTokenClient(config) {
          state.configs.push(config);
          return {
            requestAccessToken() {
              (respond ?? grantAll)(config, state, grantAll);
            },
          };
        },
        hasGrantedAllScopes(response, ...scopes) {
          const have = new Set(String(response.scope).split(' '));
          return scopes.every((s) => have.has(s));
        },
        revoke: vi.fn((token, done) => {
          state.revoked.push(token);
          done({ successful: true });
        }),
      },
    },
  };
  return { google, state };
}

function setup({ respond, now, clientId = CLIENT_ID, loadScript } = {}) {
  const { google, state } = fakeGoogle(respond);
  const auth = createAuth({
    clientId,
    getGoogle: () => google,
    loadScript: loadScript ?? (async () => {}),
    ...(now ? { now } : {}),
  });
  const events = [];
  auth.onChange((e) => events.push(e));
  return { auth, google, state, events };
}

describe('validateClientId', () => {
  it('accepts a real-shaped client ID', () => {
    expect(validateClientId(CLIENT_ID)).toBe(true);
    expect(validateClientId(`  ${CLIENT_ID} `)).toBe(true);
  });
  it('rejects bad IDs', () => {
    expect(validateClientId('')).toBe(false);
    expect(validateClientId('abc.apps.googleusercontent.com')).toBe(false);
    expect(validateClientId('123-ABC.apps.googleusercontent.com')).toBe(false);
    expect(validateClientId(undefined)).toBe(false);
  });
});

describe('SCOPES', () => {
  it('adds scopes tier by tier', () => {
    expect(SCOPES.basic).toHaveLength(2);
    expect(SCOPES.preview).toEqual([
      ...SCOPES.basic,
      'https://www.googleapis.com/auth/gmail.readonly',
    ]);
    expect(SCOPES.apply).toEqual([
      ...SCOPES.preview,
      'https://www.googleapis.com/auth/gmail.modify',
    ]);
  });
});

describe('createAuth', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-09T10:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('signs in with the basic tier and keeps the token in memory', async () => {
    const { auth, state, events } = setup();
    expect(auth.getToken()).toBeNull();
    expect(auth.expiresAt()).toBeNull();
    await auth.signIn();
    expect(auth.getToken()).toBe('token-1');
    expect(auth.hasTier('basic')).toBe(true);
    expect(auth.hasTier('preview')).toBe(false);
    expect(auth.hasTier('nope')).toBe(false);
    expect(auth.expiresAt()).toBe(Date.parse('2026-10-09T11:00:00Z'));
    expect(state.configs[0].include_granted_scopes).toBe(true);
    expect(state.configs[0].client_id).toBe(CLIENT_ID);
    expect(state.configs[0].scope).toBe(SCOPES.basic.join(' '));
    expect(events.map((e) => e.type)).toEqual(['signed-in']);
  });

  it('loads the GIS script lazily, only when google is missing', async () => {
    const { google } = fakeGoogle();
    let loaded = false;
    const loadScript = vi.fn(async () => {
      loaded = true;
    });
    const auth = createAuth({
      clientId: CLIENT_ID,
      loadScript,
      getGoogle: () => (loaded ? google : undefined),
    });
    expect(loadScript).not.toHaveBeenCalled();
    await auth.signIn('basic');
    expect(loadScript).toHaveBeenCalledWith(GIS_URL);
    await auth.signIn('basic');
    expect(loadScript).toHaveBeenCalledTimes(1);
  });

  it('uses the global google object by default', async () => {
    const { google } = fakeGoogle();
    globalThis.google = google;
    try {
      const auth = createAuth({ clientId: CLIENT_ID, loadScript: async () => {} });
      await auth.signIn();
      expect(auth.getToken()).toBe('token-1');
    } finally {
      delete globalThis.google;
    }
  });

  it('explains a script that fails to load', async () => {
    const auth = createAuth({
      clientId: CLIENT_ID,
      getGoogle: () => undefined,
      loadScript: async () => {
        throw new Error('blocked');
      },
    });
    await expect(auth.signIn()).rejects.toMatchObject({ code: 'script-failed' });
  });

  it('explains a script that loads but has no google object', async () => {
    const auth = createAuth({
      clientId: CLIENT_ID,
      getGoogle: () => undefined,
      loadScript: async () => {},
    });
    const err = await auth.signIn().catch((e) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect(err.code).toBe('script-failed');
    expect(err.message).toMatch(/Reload the page/);
  });

  it('rejects a bad client ID before it opens a popup', async () => {
    const { auth, state } = setup({ clientId: 'not-a-client-id' });
    await expect(auth.signIn()).rejects.toMatchObject({ code: 'invalid-client-id' });
    expect(state.configs).toHaveLength(0);
  });

  it('upgrade asks only for the extra scopes', async () => {
    const { auth, state } = setup();
    await auth.signIn('basic');
    await auth.upgrade('preview');
    expect(state.configs[1].scope).toBe('https://www.googleapis.com/auth/gmail.readonly');
    expect(state.configs[1].include_granted_scopes).toBe(true);
    expect(auth.hasTier('preview')).toBe(true);
    expect(auth.getToken()).toBe('token-2');
    await auth.upgrade('apply');
    expect(state.configs[2].scope).toBe('https://www.googleapis.com/auth/gmail.modify');
    expect(auth.hasTier('apply')).toBe(true);
  });

  it('upgrade does nothing when the tier is already granted', async () => {
    const { auth, state } = setup();
    await auth.signIn('apply');
    await auth.upgrade('preview');
    expect(state.configs).toHaveLength(1);
  });

  it('upgrade signs in with the full tier when signed out', async () => {
    const { auth, state } = setup();
    await auth.upgrade('preview');
    expect(state.configs[0].scope).toBe(SCOPES.preview.join(' '));
    expect(auth.hasTier('preview')).toBe(true);
  });

  it('shares one popup between calls made at the same time', async () => {
    let finish;
    const { auth, state } = setup({
      respond: (config, _state, grantAll) => {
        finish = () => grantAll(config);
      },
    });
    const a = auth.signIn();
    const b = auth.signIn();
    expect(a).toBe(b);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    finish();
    await Promise.all([a, b]);
    expect(state.configs).toHaveLength(1);
  });

  it.each([
    ['popup_closed', 'popup-closed', /closed before sign-in finished/],
    ['popup_failed_to_open', 'popup-blocked', /Allow pop-ups/],
    ['unknown', 'unknown', /did not work/],
  ])('handles the popup error %s', async (type, code, text) => {
    const { auth, events } = setup({
      respond: (config) => config.error_callback({ type, message: 'x' }),
    });
    const err = await auth.signIn().catch((e) => e);
    expect(err.code).toBe(code);
    expect(err.message).toMatch(text);
    expect(events.at(-1)).toMatchObject({ type: 'error', error: err });
    expect(auth.getToken()).toBeNull();
  });

  it('popupError copes with no details', () => {
    expect(popupError(undefined).code).toBe('unknown');
  });

  it.each([
    ['access_denied', 'access-denied'],
    ['invalid_client', 'invalid-client-id'],
    ['server_error', 'unknown'],
  ])('handles the token error %s', async (error, code) => {
    const { auth } = setup({ respond: (config) => config.callback({ error }) });
    await expect(auth.signIn()).rejects.toMatchObject({ code });
  });

  it('handles an empty token response', async () => {
    const { auth } = setup({ respond: (config) => config.callback(undefined) });
    await expect(auth.signIn()).rejects.toMatchObject({ code: 'unknown' });
  });

  it('names the permission the user unticked', async () => {
    const { auth, events } = setup({
      respond: (config) => {
        const scope = config.scope
          .split(' ')
          .filter((s) => s !== LABELS_SCOPE)
          .join(' ');
        config.callback({ access_token: 'partial', expires_in: 3600, scope });
      },
    });
    const err = await auth.signIn().catch((e) => e);
    expect(err.code).toBe('missing-scopes');
    expect(err.missingScopes).toEqual([LABELS_SCOPE]);
    expect(err.message).toContain('"See and edit your email labels"');
    expect(err.message).toMatch(/tick that box/);
    expect(auth.hasTier('basic')).toBe(false);
    expect(events.at(-1).type).toBe('error');
  });

  it('handles initTokenClient throwing', async () => {
    const { google } = fakeGoogle();
    google.accounts.oauth2.initTokenClient = () => {
      throw new Error('bad config');
    };
    const auth = createAuth({ clientId: CLIENT_ID, getGoogle: () => google });
    await expect(auth.signIn()).rejects.toMatchObject({ code: 'unknown' });
  });

  it('warns 5 minutes before expiry, then expires', async () => {
    const { auth, events } = setup();
    await auth.signIn();
    vi.advanceTimersByTime(3600 * 1000 - EXPIRY_WARNING_MS - 1);
    expect(events.map((e) => e.type)).toEqual(['signed-in']);
    vi.advanceTimersByTime(1);
    expect(events.at(-1)).toMatchObject({ type: 'expiring', expiresAt: auth.expiresAt() });
    vi.advanceTimersByTime(EXPIRY_WARNING_MS);
    expect(events.at(-1).type).toBe('expired');
    expect(auth.getToken()).toBeNull();
    expect(auth.hasTier('basic')).toBe(false);
    expect(auth.expiresAt()).toBeNull();
  });

  it('warns at once when the token is short-lived', async () => {
    const { auth, events } = setup({
      respond: (config) =>
        config.callback({ access_token: 't', expires_in: 60, scope: config.scope }),
    });
    await auth.signIn();
    vi.advanceTimersByTime(0);
    expect(events.map((e) => e.type)).toEqual(['signed-in', 'expiring']);
  });

  it('defaults to one hour when expires_in is missing', async () => {
    const { auth } = setup({
      respond: (config) => config.callback({ access_token: 't', scope: config.scope }),
    });
    await auth.signIn();
    expect(auth.expiresAt()).toBe(Date.now() + 3600 * 1000);
  });

  it('getToken notices expiry even if timers did not run (sleeping laptop)', async () => {
    let clock = 1_000_000;
    const { google } = fakeGoogle();
    const auth = createAuth({
      clientId: CLIENT_ID,
      getGoogle: () => google,
      now: () => clock,
      setTimer: () => 0,
      clearTimer: () => {},
    });
    const events = [];
    auth.onChange((e) => events.push(e.type));
    await auth.signIn();
    clock += 3600 * 1000;
    expect(auth.hasTier('basic')).toBe(false);
    expect(auth.getToken()).toBeNull();
    expect(events).toEqual(['signed-in', 'expired']);
  });

  it('signOut revokes the token and forgets it', async () => {
    const { auth, google, state, events } = setup();
    await auth.signIn();
    await auth.signOut();
    expect(google.accounts.oauth2.revoke).toHaveBeenCalledTimes(1);
    expect(state.revoked).toEqual(['token-1']);
    expect(auth.getToken()).toBeNull();
    expect(events.at(-1).type).toBe('signed-out');
    vi.advanceTimersByTime(4 * 3600 * 1000);
    expect(events.at(-1).type).toBe('signed-out');
  });

  it('signOut when signed out does not call revoke', async () => {
    const { auth, google, events } = setup();
    await auth.signOut();
    expect(google.accounts.oauth2.revoke).not.toHaveBeenCalled();
    expect(events.map((e) => e.type)).toEqual(['signed-out']);
  });

  it('signOut still signs out when revoke throws', async () => {
    const { auth, google } = setup();
    await auth.signIn();
    google.accounts.oauth2.revoke = () => {
      throw new Error('offline');
    };
    await auth.signOut();
    expect(auth.getToken()).toBeNull();
  });

  it('a failing listener does not stop others; unsubscribe works', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { auth, events } = setup();
    auth.onChange(() => {
      throw new Error('listener bug');
    });
    const later = [];
    const off = auth.onChange((e) => later.push(e.type));
    await auth.signIn();
    expect(events).toHaveLength(1);
    expect(later).toEqual(['signed-in']);
    off();
    await auth.signOut();
    expect(later).toEqual(['signed-in']);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('loadScriptOnce', () => {
  afterEach(() => {
    delete globalThis.document;
  });

  function fakeDocument(outcome) {
    const appended = [];
    globalThis.document = {
      createElement: () => ({ remove: vi.fn() }),
      head: {
        appendChild(el) {
          appended.push(el);
          queueMicrotask(() => (outcome === 'load' ? el.onload() : el.onerror()));
        },
      },
    };
    return appended;
  }

  it('adds one script tag and caches it', async () => {
    const appended = fakeDocument('load');
    await loadScriptOnce('https://example.com/a.js');
    await loadScriptOnce('https://example.com/a.js');
    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({ src: 'https://example.com/a.js', async: true });
  });

  it('allows a retry after a failure', async () => {
    const appended = fakeDocument('error');
    await expect(loadScriptOnce('https://example.com/b.js')).rejects.toThrow();
    expect(appended[0].remove).toHaveBeenCalled();
    await expect(loadScriptOnce('https://example.com/b.js')).rejects.toThrow();
    expect(appended).toHaveLength(2);
  });
});
