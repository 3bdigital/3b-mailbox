// Bootstrap. Picks the data source, starts the app and registers the service worker.

import { startApp } from './ui/app.js';
import { toast } from './ui/components/toast.js';

const params = new URLSearchParams(location.search);
startApp({ demo: params.has('demo'), demoSize: Number(params.get('size')) || 0 });

/** Registers the service worker and offers a reload when a new version is waiting. */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (location.protocol !== 'https:' && !local) return;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker
    .register('sw.js', { scope: './' })
    .then((reg) => {
      /** @param {ServiceWorker} worker */
      const offer = (worker) =>
        toast('An update is available.', {
          action: { label: 'Reload', onClick: () => worker.postMessage({ type: 'SKIP_WAITING' }) },
        });
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) offer(worker);
        });
      });
    })
    .catch(() => {
      // The app works without the service worker. It just does not work offline.
    });
}

registerServiceWorker();
