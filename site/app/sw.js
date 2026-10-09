// Service worker: caches the app shell only. It never caches or touches Google requests
// (googleapis.com, accounts.google.com) or any other origin. Change VERSION on every release.

const VERSION = 'v1';
const CACHE = `email-filter-shell-${VERSION}`;

/** Every file of the app shell, relative to this file. tests/unit/ui/sw.test.js checks the list. */
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/tokens.css',
  'css/base.css',
  'css/components.css',
  'css/app.css',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'js/main.js',
  'js/types.js',
  'js/core/actions.js',
  'js/core/analyse.js',
  'js/core/backup.js',
  'js/core/bulk.js',
  'js/core/consolidate.js',
  'js/core/journal.js',
  'js/core/limits.js',
  'js/core/query.js',
  'js/core/storage.js',
  'js/core/summarise.js',
  'js/core/templates.js',
  'js/gmail/auth.js',
  'js/gmail/client.js',
  'js/gmail/demo-data.js',
  'js/gmail/executor.js',
  'js/gmail/mock.js',
  'js/ui/app.js',
  'js/ui/dom.js',
  'js/ui/icons.js',
  'js/ui/plans.js',
  'js/ui/router.js',
  'js/ui/state.js',
  'js/ui/components/combobox.js',
  'js/ui/components/dialog.js',
  'js/ui/components/filter-card.js',
  'js/ui/components/label-picker.js',
  'js/ui/components/matches.js',
  'js/ui/components/menu.js',
  'js/ui/components/permission.js',
  'js/ui/components/plan-preview.js',
  'js/ui/components/query-editor.js',
  'js/ui/components/toast.js',
  'js/ui/components/widgets.js',
  'js/ui/views/common.js',
  'js/ui/views/editor.js',
  'js/ui/views/filters.js',
  'js/ui/views/overview.js',
  'js/ui/views/settings.js',
  'js/ui/views/setup.js',
  'js/ui/views/suggestions.js',
  'js/ui/views/tidy.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('email-filter-shell-') && k !== CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// The page asks the waiting worker to take over when the user chooses "Reload".
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Only our own files. Google sign-in and the Gmail API go straight to the network.
  if (url.origin !== self.location.origin) return;
  const scope = new URL(self.registration.scope);
  if (!url.pathname.startsWith(scope.pathname)) return;

  const isPage =
    request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html');
  if (isPage) {
    // Network first for HTML, so a new release shows at once. The cached shell works offline.
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put('index.html', copy));
          }
          return response;
        })
        .catch(() => caches.match('index.html', { ignoreSearch: true })),
    );
    return;
  }

  // Cache first for the versioned static files of the shell.
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then(
      (cached) =>
        cached ??
        fetch(request).then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
